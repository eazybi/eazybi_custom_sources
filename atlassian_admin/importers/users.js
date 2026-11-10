// The users of the organization: the User dimension members and one users fact row per user, plus one
// product access fact row per product and site the user has access to.
//
// The users are driven by the v2 directory search — the v1 org users endpoint answers only the managed
// accounts, which can be none — and enriched from the v1 endpoint where it answers them. A user only the v1
// endpoint answers is imported too.

var LEFTOVER_BATCH_SIZE = 500;
// The most rows one importRows call takes.
var MAX_IMPORT_ROWS = 10000;
var ADMIN_ROLE_ORDINALS = {"Org admin": 1, "Site admin": 2, "Product admin": 3, "No admin role": 4};
// The composite account status of the v2 directory search, with the v1 account_status values as the
// fallback of a user the directory search did not answer.
var STATUS_NAMES = {
  active: "Active",
  suspended: "Suspended",
  not_invited: "Not invited",
  deactivated: "Deactivated",
  for_deletion: "For deletion"
};
var V1_STATUS_NAMES = {active: "Active", inactive: "Deactivated", closed: "Closed"};
var STATUS_ORDINALS = {
  Active: 1, Suspended: 2, "Not invited": 3, Deactivated: 4, "For deletion": 5, Closed: 6
};
// The products whose activity on their own workspace the directory user search does not answer — of Studio
// it answers only the activity recorded under the site — so it is read from the last active dates of every
// user with access to them, with one request per user.
var WORKSPACE_ACTIVITY_PRODUCT_KEYS = ["studio"];
// The last active dates answer the day of the activity as a date without a time, next to its timestamp.
var DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var UNKNOWN_STATUS = "(unknown)";
// The Site member keys are the site keys of the workspace catalog ("site/<cloud id>", or the workspace key of
// a product without a site), "removed/<cloud id or URL>" of a site the organization no longer has, and this one.
var NO_SITE_KEY = "(no site)";
var NO_SITE_NAME = "(no site)";
var REMOVED_SITE_SUFFIX = " (removed)";
// The Activity Tracking members, stored on the Product Access members.
var TRACKING_VALUES = {
  tracked: {activity_tracking: "Tracked", activity_tracking_ordinal: 1},
  notTracked: {activity_tracking: "Not tracked", activity_tracking_ordinal: 2}
};

app.importers.users = {
  importAll(workspaces, directories, productRoles) {
    var shared = {
      importProductRoles: source.getExtraOption("import_product_roles") === true,
      productRoles: productRoles,
      customFields: source.getCustomFields(),
      tracking: {groups: {}, activeGroups: {}}
    };
    var v1Users = this.collectOrgUsers();
    var progress = {imported: 0};
    var seen = {};

    directories.forEach((directory) =>
      this.importDirectoryUsers(directory, workspaces, shared, v1Users, seen, progress));

    var leftoverIds = Object.keys(v1Users.byAccountId).filter((accountId) => seen[accountId] !== true);
    for (let start = 0; start < leftoverIds.length; start += LEFTOVER_BATCH_SIZE) {
      let batch = leftoverIds.slice(start, start + LEFTOVER_BATCH_SIZE).
        map((accountId) => this.fromOrgUser(v1Users.byAccountId[accountId], workspaces));
      this.importBatch(batch, shared, progress);
    }

    this.markUntrackedGroups(shared.tracking);
  },

  // Atlassian tracks the activity of some products, and of some users of a product, and not of the others —
  // not of Goals and Projects, nor of the portal customers of Jira Service Management — and answers no
  // activity either way. So the import tells them apart by the data: the accesses of one product of a site
  // whose users with the same license state have no activity at all are not tracked, while the others are
  // tracked and never used. A product starts to count as tracked with its first activity.
  trackingGroup(access) {
    return `${access.siteKey}|${access.productKey}|${access.licensed ? "licensed" : "unlicensed"}`;
  },

  // After every user is imported, as only the whole organization tells whether anybody in a group was active.
  markUntrackedGroups(tracking) {
    var generation = app.importers.sweep.generation;
    Object.keys(tracking.groups).forEach((group) => {
      if (tracking.activeGroups[group]) return;

      dwh.dimensions.product_accesses.update(TRACKING_VALUES.notTracked,
        {tracking_group: group, generation: generation});
    });
  },

  // The users the v1 endpoint answers, keyed by account id — the enrichment of every directory user and
  // the fallback list of the users no directory search answered. Only the attributes the import reads are
  // kept, as the whole organization is held in memory.
  collectOrgUsers() {
    var byAccountId = {};

    app.api.eachOrgUsersPage((users) => {
      users.forEach((user) => {
        if (!user || !user.account_id) return;
        byAccountId[user.account_id] = {
          account_id: user.account_id,
          account_type: user.account_type,
          account_status: user.account_status,
          name: user.name,
          email: user.email,
          product_access: (user.product_access || []).map((access) =>
            ({key: access.key, url: access.url, last_active: access.last_active}))
        };
      });
    });

    return {byAccountId: byAccountId};
  },

  // A directory page the API answers with an error, also after the retries of eazyBI, fails the import: the
  // users of the pages not read would be imported from the v1 list alone, without their admin roles, groups
  // and profile values, replacing their stored rows. An error of the import of a page that was read is
  // rethrown as it is.
  importDirectoryUsers(directory, workspaces, shared, v1Users, seen, progress) {
    var importError = null;

    try {
      app.api.eachDirectoryUsersPage(directory.directoryId, (users) => {
        try {
          this.importPage(users, workspaces, shared, v1Users, seen, progress);
        } catch (error) {
          importError = error;
          throw error;
        }
      });
    } catch (error) {
      if (error === importError) throw error;
      source.checkCanceling();
      throw new Error(`The users of the directory ${directory.name || directory.directoryId} could not be` +
        ` read: ${error.message}`);
    }
  },

  importPage(users, workspaces, shared, v1Users, seen, progress) {
    var batch = [];
    users.forEach((user) => {
      if (!user || !user.accountId || seen[user.accountId] === true) return;
      seen[user.accountId] = true;
      batch.push(this.fromDirectoryUser(user, v1Users.byAccountId[user.accountId], workspaces));
    });
    this.importBatch(batch, shared, progress);
  },

  importBatch(batch, shared, progress) {
    if (batch.length === 0) return;

    logger.startImport("users");
    var rowsOfUsers = batch.map((user) => this.importOne(user, shared)).filter(Boolean);
    dwh.measures.users.importRows(rowsOfUsers.map((rows) => rows.user));
    this.importProductAccessRows(rowsOfUsers.map((rows) => rows.productAccess));
    logger.finishImport("users", batch.length);

    progress.imported += batch.length;
    source.setStatusMessage(`Importing users (${progress.imported} imported)`);
  },

  // The product access rows of many users per call, within the row limit of a call. The rows of one user
  // are one import scope, so they are never split between two calls.
  importProductAccessRows(rowsOfUsers) {
    var batch = [];
    rowsOfUsers.forEach((rows) => {
      if (batch.length > 0 && batch.length + rows.length > MAX_IMPORT_ROWS) {
        dwh.measures.product_access.importRows(batch);
        batch = [];
      }
      batch = batch.concat(rows);
    });
    if (batch.length > 0) dwh.measures.product_access.importRows(batch);
  },

  // The unified user of a v2 directory search answer, enriched from the v1 answer of the same account.
  // The v2 product accesses win when they are answered — they carry the site id and a precise timestamp —
  // and the v1 accesses of the enrichment stand in when they are not.
  fromDirectoryUser(user, v1User, workspaces) {
    var groups = [];
    (user.groups || []).forEach((group) => {
      if (!group || !group.name) return;
      if (!groups.some((existing) => existing.name === group.name)) {
        groups.push({name: group.name, externalId: app.importers.directory.groupExternalId(group)});
      }
    });

    var activeAccesses = (user.productAccess || []).length > 0
      ? this.resolveV2Accesses(user.productAccess, workspaces)
      : this.resolveV1Accesses((v1User && v1User.product_access) || [], workspaces);
    var workspaceActivity = this.workspaceActivity(user.accountId, workspaces);
    var activity = activeAccesses.concat(workspaceActivity.accesses);
    var accesses = this.withProductUsers(user.accountId,
      this.withoutRevokedAccesses(user.accountId, activity, workspaces), workspaces);

    return {
      accountId: user.accountId,
      name: user.name || (v1User && v1User.name) || user.accountId,
      email: user.email || (v1User && v1User.email) || null,
      accountType: user.accountType || (v1User && v1User.account_type) || null,
      status: this.statusName(user.status, v1User && v1User.account_status),
      platformRoles: user.platformRoles || [],
      groups: groups,
      lastActive: this.lastActive(activity),
      accesses: accesses,
      profile: this.profileValues(user),
      error: workspaceActivity.error
    };
  },

  // The accesses of the WORKSPACE_ACTIVITY_PRODUCT_KEYS products the user was active in, read only for a user
  // the access search of such a selected workspace found. A request that fails is the error of the user.
  workspaceActivity(accountId, workspaces) {
    var found = (workspaces.productUsers || {})[accountId] || {};
    var hasAccess = Object.keys(found).some((workspaceKey) =>
      WORKSPACE_ACTIVITY_PRODUCT_KEYS.indexOf(found[workspaceKey].productKey) >= 0);
    if (!hasAccess) return {accesses: [], error: null};

    var lastActiveDates;
    try {
      lastActiveDates = app.api.getUserLastActiveDates(accountId);
    } catch (error) {
      source.checkCanceling();
      return {accesses: [], error: new Error(`The last activity could not be read: ${error.message}`)};
    }

    // The activity recorded under the site comes with the directory user search.
    var productAccess = lastActiveDates.
      filter((access) => WORKSPACE_ACTIVITY_PRODUCT_KEYS.indexOf(app.api.productKey(access.key)) >= 0 &&
        workspaces.catalog.byAri[access.id]).
      map((access) => ({key: access.key, id: access.id,
        lastActiveTimestamp: access.last_active_timestamp || access.last_active || null}));
    return {accesses: this.resolveV2Accesses(productAccess, workspaces), error: null};
  },

  // The values of the selectable user profile fields (see USER_CUSTOM_FIELDS in api.js), keyed by the
  // field key. Only the directory user search answers them — a user of the v1 fallback has none.
  profileValues(user) {
    return {
      department: user.department || null,
      job_title: user.jobTitle || null,
      organization: user.organization || null,
      location: user.location || null,
      time_zone: user.timeZone || null,
      nickname: user.nickname || null,
      mfa_enabled: this.yesNo(user.mfaEnabled),
      email_verified: this.yesNo(user.emailVerified),
      management_source: this.humanized(user.managementSource),
      claim_status: this.humanized(user.claimStatus),
      added_to_org: user.addedToOrg || null
    };
  },

  yesNo(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";

    return null;
  },

  humanized(value) {
    if (!value) return null;

    var text = String(value).replace(/_/g, " ").toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  },

  // The unified user of a v1 answer alone — an account no directory search returned.
  fromOrgUser(v1User, workspaces) {
    var activity = this.resolveV1Accesses(v1User.product_access || [], workspaces);
    var accesses = this.withProductUsers(v1User.account_id,
      this.withoutRevokedAccesses(v1User.account_id, activity, workspaces), workspaces);

    return {
      accountId: v1User.account_id,
      name: v1User.name || v1User.account_id,
      email: v1User.email || null,
      accountType: v1User.account_type || null,
      status: this.statusName(null, v1User.account_status),
      platformRoles: [],
      groups: [],
      lastActive: this.lastActive(activity),
      accesses: accesses,
      profile: {}
    };
  },

  // The rows of the user, or null when they could not all be built: a partial set would replace the stored
  // product access of the user.
  importOne(user, shared) {
    var warningKey = `user/${user.accountId}`;
    try {
      if (user.error) throw user.error;
      var rows = this.buildRows(user, shared);
      source.warnings.clearOld(warningKey);
      return rows;
    } catch (error) {
      source.warnings.addObjectFailure(warningKey, `Import of the user ${user.accountId} failed: ${error.message}`);
      // The stored rows of the user stay, so its activity still counts for the tracking of its products. A
      // WORKSPACE_ACTIVITY_PRODUCT_KEYS product counts as active when its last active dates could not be read,
      // so that it is not marked Not tracked by an activity this import did not read.
      (user.accesses || []).forEach((access) => {
        var unread = !!user.error && WORKSPACE_ACTIVITY_PRODUCT_KEYS.indexOf(access.productKey) >= 0;
        if (!access.skipped && (access.lastActive || unread)) {
          shared.tracking.activeGroups[this.trackingGroup(access)] = true;
        }
      });
      return null;
    }
  },

  buildRows(user, shared) {
    var generation = app.importers.sweep.generation;
    var rolesOf = shared.productRoles[user.accountId] || {};
    var adminRole = this.adminRoleName(user, rolesOf);
    var customFieldValues = this.customFieldValues(user, shared.customFields);

    var userAttributes = {
      display_name: user.name,
      email: user.email,
      account_type: user.accountType,
      status: user.status,
      admin_role: adminRole,
      last_active: dwh.datetimeValue(user.lastActive, "last active"),
      generation: generation
    };
    var userId = dwh.dimensions.users.createAndLookupId({account_id: user.accountId},
      _.extend(userAttributes, customFieldValues.properties));
    var adminRoleId = dwh.dimensions.admin_roles.createAndLookupId({name: adminRole},
      {ordinal: ADMIN_ROLE_ORDINALS[adminRole], generation: generation});
    var statusId = dwh.dimensions.statuses.createAndLookupId({name: user.status},
      {ordinal: STATUS_ORDINALS[user.status] || 9, generation: generation});
    var groupBtId = dwh.dimensions.groups_bt.btIdFor(user.groups.map((group) =>
      dwh.dimensions.groups.createAndLookupId({name: group.name},
        {external_id: group.externalId || null, generation: generation})));

    var userRow = _.extend({
      _source_id: user.accountId,
      _source_name: app.importers.sweep.SOURCE_NAMES.users,
      user_id: userId,
      admin_role_id: adminRoleId,
      status_id: statusId,
      group_bt_id: groupBtId,
      time_id: this.lastActiveTimeId(user.lastActive, "last active"),
      users_count: 1,
      active_users: user.status === "Active" ? 1 : null,
      inactive_users: user.status === "Active" ? null : 1,
      generation: generation
    }, customFieldValues.foreignKeys);

    var productAccessRows = [];
    user.accesses.forEach((access) => {
      if (access.skipped) return;

      var accessRoles = rolesOf[access.workspaceKey];
      var lastActiveTs = this.lastActiveTimestamp(access.lastActive);
      var trackingGroup = this.trackingGroup(access);
      if (access.lastActive) shared.tracking.activeGroups[trackingGroup] = true;
      shared.tracking.groups[trackingGroup] = true;
      var productAccessId = dwh.dimensions.product_accesses.createAndLookupId(
        {access_key: `${user.accountId}|${access.siteKey}|${access.productKey}`},
        _.extend({last_active_ts: lastActiveTs, tracking_group: trackingGroup, generation: generation},
          TRACKING_VALUES.tracked));
      productAccessRows.push(_.extend({
        _source_id: user.accountId,
        _source_name: app.importers.sweep.SOURCE_NAMES.productAccess,
        user_id: userId,
        product_access_id: productAccessId,
        admin_role_id: adminRoleId,
        status_id: statusId,
        group_bt_id: groupBtId,
        site_id: access.siteId,
        product_id: access.productId,
        plan_id: access.planId,
        time_id: this.lastActiveTimeId(access.lastActive, "product last active"),
        product_users: 1,
        licensed_users: access.licensed ? 1 : null,
        product_role_bt_id: shared.importProductRoles ? this.productRoleBtId(accessRoles) : null,
        product_admins: this.holdsRole(accessRoles, app.api.PRODUCT_ADMIN_ROLE_ID) ? 1 : null,
        unused_licenses: access.licensed && !access.lastActive ? 1 : null,
        product_last_active_ts: lastActiveTs,
        generation: generation
      }, customFieldValues.foreignKeys));
    });

    return {user: userRow, productAccess: productAccessRows};
  },

  // The cf_ property columns of the User member and the cf_ dimension foreign keys of the fact rows,
  // for the fields selected on the Custom fields tab.
  customFieldValues(user, customFields) {
    var values = {properties: {}, foreignKeys: {}};

    customFields.forEach((field) => {
      var value = user.profile[field.key] || null;
      if (field.property) {
        values.properties[`cf_${field.key}`] = field.dataType === "datetime"
          ? dwh.datetimeValue(value, field.name) : value;
      }
      if (field.dimension) {
        values.foreignKeys[`cf_${field.key}_id`] = value
          ? dwh.dimensions[`cf_${field.key}`].createAndLookupId({name: value},
            {generation: app.importers.sweep.generation}) : null;
      }
    });

    return values;
  },

  // The highest admin role of the user; the product admin role is known only with the product roles imported.
  adminRoleName(user, rolesOf) {
    if (user.platformRoles.indexOf("atlassian/org-admin") >= 0) return "Org admin";
    if (user.platformRoles.indexOf("atlassian/site-admin") >= 0) return "Site admin";
    var productAdmin = Object.keys(rolesOf).some((workspaceKey) =>
      this.holdsRole(rolesOf[workspaceKey], app.api.PRODUCT_ADMIN_ROLE_ID));
    if (productAdmin) return "Product admin";

    return "No admin role";
  },

  holdsRole(roleIds, roleId) {
    return (roleIds || []).indexOf(roleId) >= 0;
  },

  // The Product Role bridge id of the roles of one product access, in the order of PRODUCT_ROLES.
  productRoleBtId(roleIds) {
    var roleMemberIds = [];
    app.api.PRODUCT_ROLES.forEach((role, index) => {
      if (!this.holdsRole(roleIds, role.id)) return;
      roleMemberIds.push(dwh.dimensions.product_roles.createAndLookupId({role_key: role.id},
        {name: role.name, ordinal: index + 1, generation: app.importers.sweep.generation}));
    });
    return dwh.dimensions.product_roles_bt.btIdFor(roleMemberIds);
  },

  statusName(directoryStatus, v1Status) {
    return (directoryStatus && STATUS_NAMES[directoryStatus]) ||
      V1_STATUS_NAMES[v1Status] || UNKNOWN_STATUS;
  },

  // The last activity of the user in the selected products, also in one the user no longer has access to. The
  // last activity of the v1 user is left out, as it counts the products that are not selected too.
  lastActive(accesses) {
    var candidates = accesses.filter((access) => !access.skipped).map((access) => access.lastActive).
      filter(Boolean);
    if (candidates.length === 0) return null;

    return candidates.reduce((max, candidate) => this.isLater(candidate, max) ? candidate : max);
  },

  // Compared by time: the v1 and v2 endpoints may format the same instant differently (with or without
  // milliseconds, with an offset).
  isLater(timestamp, other) {
    if (!timestamp) return false;
    if (!other) return true;

    return this.activityMilliseconds(timestamp) > this.activityMilliseconds(other);
  },

  // A last activity without a time is the midnight of its day in the Time dimension time zone, where
  // lastActiveTimestamp places it: as midnight UTC, it would come before an activity of the previous evening
  // in a time zone behind UTC.
  activityMilliseconds(lastActive) {
    return DATE_ONLY_PATTERN.test(lastActive)
      ? this.lastActiveTimestamp(lastActive) * 1000 : Date.parse(lastActive);
  },

  // A last activity without a time is the day it is written as: converted as midnight UTC, it would be the
  // previous day in a time zone behind UTC.
  lastActiveTimeId(lastActive, name) {
    return DATE_ONLY_PATTERN.test(lastActive || "")
      ? dwh.lookupDateId(lastActive, name) : dwh.lookupTimeId(lastActive, name);
  },

  // The epoch seconds of a last activity, which TimestampToDate shows in the Time dimension time zone. One
  // without a time is the midnight of its day in that time zone, the day lastActiveTimeId looks up: placed by
  // the offset of the time zone at its midnight UTC, and then by the offset at that instant, which differs on
  // a daylight saving change between the two midnights. A day without a midnight, which starts with the
  // change, starts at the later of the two instants, the first time of the day.
  lastActiveTimestamp(lastActive) {
    if (!lastActive) return null;
    if (!DATE_ONLY_PATTERN.test(lastActive)) return Math.floor(Date.parse(lastActive) / 1000);

    var utcMidnight = Date.parse(`${lastActive}T00:00:00Z`);
    var first = 2 * utcMidnight - this.wallClock(utcMidnight);
    var second = first + utcMidnight - this.wallClock(first);
    var midnight = this.wallClock(second) === utcMidnight ? second : Math.max(first, second);
    return midnight / 1000;
  },

  // The time of an instant in the Time dimension time zone, as the milliseconds of a UTC clock showing it.
  wallClock(milliseconds) {
    var value = dwh.datetimeValue(new Date(milliseconds), "product last active");
    return Date.parse(`${value.replace(" ", "T")}Z`);
  },

  // A v2 product access names its workspace by an ARI: the one of the workspace itself, or one of its site
  // with a product key the workspace names differently ("ari:cloud:jira-core::site/<cloud id>").
  resolveV2Accesses(productAccess, workspaces) {
    var catalog = workspaces.catalog;
    return this.uniqueAccesses(productAccess.map((access) => {
      var cloudId = app.api.siteCloudId(access.id);
      var site = cloudId ? catalog.sitesByCloudId[cloudId] || null : null;
      return this.resolveAccess(app.api.productKey(access.key), catalog.byAri[access.id] || null, site,
        access.lastActiveTimestamp || null, workspaces, cloudId ? {cloudId: cloudId} : {ari: access.id});
    }));
  },

  // A v1 product access names its workspace by the product URL — the URL of a site of its own
  // ("https://bitbucket.org/acme"), or the host of a site.
  resolveV1Accesses(productAccess, workspaces) {
    var catalog = workspaces.catalog;
    return this.uniqueAccesses(productAccess.map((access) => {
      var url = app.api.normalizedUrl(access.url);
      var site = (url && catalog.sitesByUrl[url]) || catalog.sitesByHost[app.api.urlHost(access.url)] || null;
      return this.resolveAccess(app.api.productKey(access.key), null, site, access.last_active || null,
        workspaces, {url: url});
    }));
  },

  // The workspace of an access, found by its ARI, by its product on its site, or as the only workspace of its
  // product without a site. An access of a deselected workspace is skipped, and so is an access to a product
  // its site no longer has: Atlassian keeps the activity of its users, who have no access to it. An access the
  // organization has no workspace for is imported only when all products are selected: under a removed site
  // member when it names a site — by the cloud id of a v2 access or the URL of a v1 access, as Atlassian keeps
  // the access to a deleted site or sandbox — and under the "(no site)" member otherwise. The reference is
  // what the access names its workspace by: the cloudId or the ari of a v2 access, the url of a v1 access.
  resolveAccess(productKey, workspace, site, lastActive, workspaces, reference = {}) {
    if (!workspace && site) workspace = site.byProduct[productKey] || null;
    if (!workspace) workspace = this.onlyStandaloneWorkspace(productKey, reference, workspaces);
    if (workspace) site = workspace.site;
    var removedSite = !site ? reference.cloudId || reference.url || null : null;

    var resolved = {
      productKey: productKey,
      lastActive: lastActive,
      workspaceKey: workspace ? workspace.key : null,
      siteKey: site ? site.key : removedSite ? `removed/${removedSite}` : null
    };

    var selected = false;
    if (workspace) selected = app.importers.workspaces.isSelected(workspaces, workspace);
    else if (!site) selected = workspaces.selectAll;
    if (!selected) {
      resolved.skipped = true;
      return resolved;
    }

    var generation = app.importers.sweep.generation;
    var siteName = site ? site.name : removedSite ? removedSite + REMOVED_SITE_SUFFIX : NO_SITE_NAME;
    resolved.siteId = dwh.dimensions.sites.createAndLookupId({site_key: resolved.siteKey || NO_SITE_KEY},
      {name: siteName, generation: generation});
    resolved.productId = dwh.dimensions.products.createAndLookupId(
      {product_key: productKey}, {name: app.api.productName(productKey), generation: generation});
    resolved.planId = workspace && workspace.planId ? workspace.planId : null;
    return resolved;
  },

  // The only workspace of a product without a site stands in for an access that names no other workspace: a
  // Studio access names its site, the Studio workspace has none, and a Trello workspace answers no URL to
  // compare the URL of a v1 access with. An access naming another ARI or URL belongs to a workspace the
  // organization no longer has.
  onlyStandaloneWorkspace(productKey, reference, workspaces) {
    var standalone = workspaces.catalog.standaloneByProduct[productKey] || [];
    if (standalone.length !== 1 || reference.ari || (reference.url && standalone[0].url)) return null;

    return standalone[0];
  },

  // Atlassian keeps the activity of a product after the access of the user to it is removed, so the access of a
  // user is kept only when the access search of its workspace found the user. A workspace whose
  // search finds nobody, such as a Bitbucket workspace, tells no access apart: its active users are its users.
  withoutRevokedAccesses(accountId, accesses, workspaces) {
    var found = (workspaces.productUsers || {})[accountId] || {};
    var searched = workspaces.workspacesWithUsers || {};
    return accesses.filter((access) => access.workspaceKey === null || found[access.workspaceKey] ||
      searched[access.workspaceKey] !== true);
  },

  // The accesses of the products the user was active in, together with the selected products the user has
  // access to but never used — an access of its own without a last activity. Each access is marked whether
  // the user holds a license of its product.
  withProductUsers(accountId, accesses, workspaces) {
    var found = (workspaces.productUsers || {})[accountId] || {};
    var neverUsed = Object.keys(found).map((workspaceKey) => {
      var workspace = found[workspaceKey];
      return this.resolveAccess(workspace.productKey, workspace, workspace.site, null, workspaces);
    });

    var licensed = (workspaces.licensedUsers || {})[accountId] || {};
    var unique = this.uniqueAccesses(accesses.concat(neverUsed));
    unique.forEach((access) => {
      access.licensed = access.workspaceKey !== null && licensed[access.workspaceKey] === true;
    });
    return unique;
  },

  // One access per site and product, with the latest activity: a Jira user is answered both a "jira-software"
  // and a "jira-core" access of the same site, which are the one Jira product.
  uniqueAccesses(accesses) {
    var byProduct = {};
    accesses.forEach((access) => {
      var key = `${access.siteKey}|${access.productKey}`;
      var existing = byProduct[key];
      if (!existing || this.isLater(access.lastActive, existing.lastActive)) byProduct[key] = access;
    });

    return _.values(byProduct);
  }
};
