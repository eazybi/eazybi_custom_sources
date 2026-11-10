// Everything comes from the Atlassian organizations REST API (https://api.atlassian.com/admin), which
// an organization API key authenticates as a Bearer token. The v2 endpoints page with a cursor answered
// in links.next of every page, as the token or in a URL (nextCursor); the v1 users endpoint answers the next
// page URL itself.

var PAGE_LIMIT = 100;
// The workspaces endpoint accepts up to 1000 per page; every product of every site is one workspace.
var WORKSPACES_PAGE_LIMIT = 250;
// The canonical Atlassian roles a user can hold on a product workspace. The users search answers no roles,
// so each one is searched on its own; a role id not listed here is not imported, but its holders still have
// the product access. The viewer role is not listed because the users search cannot filter by it.
var PRODUCT_ROLES = [
  {id: "atlassian/user", name: "User"},
  {id: "atlassian/admin", name: "Admin"},
  {id: "atlassian/user-access-admin", name: "User access admin"},
  {id: "atlassian/contributor", name: "Contributor"},
  {id: "atlassian/basic", name: "Basic"},
  {id: "atlassian/stakeholder", name: "Stakeholder"},
  {id: "atlassian/customer", name: "Customer"},
  {id: "atlassian/guest", name: "Guest"}
];
var PRODUCT_ADMIN_ROLE_ID = "atlassian/admin";
// The roles that take a license of the product: both give the product access, while the contributor,
// basic, stakeholder, customer and guest roles are not billed and the user access admin has no access.
var LICENSED_ROLE_IDS = ["atlassian/user", "atlassian/admin"];
// The products whose roles take no license of their own: Assets comes with Jira Service Management, Guard
// Detect ("beacon") is billed for the whole organization, and Atlas, Goals, Projects, Studio and Rovo are
// included in the other products. Atlassian answers them on a free plan or without one, and reports no
// activity for most of them. One of them on a paid plan is licensed after all, so that a product Atlassian
// starts to bill on its own is not left out.
var UNLICENSED_PRODUCT_KEYS = ["assets", "beacon", "goal", "project", "rovo", "studio", "townsquare"];
var FREE_PLAN_KEY = "free";
// The products served for a site from a host that is not the site's own, such as the detect.atlassian.com of
// Guard Detect.
var OTHER_HOST_PRODUCT_KEYS = ["beacon", "rovo", "townsquare"];

// The workspaces API and the product access of the users name some products with different keys, so both
// go through productKey before they are compared or displayed. The platform "jira" workspace and the
// "jira-core" access (the former Jira Work Management, merged into Jira) are the Jira product, and the
// Assets workspace has the "cmdb" type key while its access is "assets".
var PRODUCT_KEY_ALIASES = {
  jira: "jira-software",
  "jira-core": "jira-software",
  "jira-servicedesk": "jira-service-desk",
  cmdb: "assets"
};
var PRODUCT_NAMES = {
  "jira-software": "Jira",
  "jira-service-desk": "Jira Service Management",
  "jira-customer-service": "Customer Service Management",
  "jira-product-discovery": "Jira Product Discovery",
  confluence: "Confluence",
  assets: "Assets",
  bitbucket: "Bitbucket",
  trello: "Trello",
  opsgenie: "Opsgenie",
  statuspage: "Statuspage",
  compass: "Compass",
  loom: "Loom",
  goal: "Goals",
  project: "Projects",
  townsquare: "Atlas",
  rovo: "Rovo",
  beacon: "Guard Detect",
  studio: "Studio"
};
// The source selection key of a whole site; a workspace key is its ARI without the "ari:cloud:" prefix
// ("confluence/site/<cloud id>"), so the two never collide.
var SITE_KEY_PREFIX = "site/";

// The selectable user profile and security attributes. Their values arrive with the directory user
// search the import performs anyway, so offering a field costs no extra requests; the catalog is fixed
// by the Atlassian user schema, only the values are per organization.
var USER_CUSTOM_FIELDS = [
  {key: "department", name: "Department", dimension: true},
  {key: "job_title", name: "Job title", dimension: true},
  {key: "organization", name: "Organization", dimension: true},
  {key: "location", name: "Location", dimension: true},
  {key: "time_zone", name: "Time zone", dimension: true},
  {key: "mfa_enabled", name: "Two-step verification", dimension: true},
  {key: "management_source", name: "Management source", dimension: true},
  {key: "claim_status", name: "Claim status", dimension: true},
  {key: "nickname", name: "Nickname"},
  {key: "email_verified", name: "Email verified"},
  {key: "added_to_org", name: "Added to org", dataType: "datetime"}
];

app.api = {
  PRODUCT_ROLES: PRODUCT_ROLES,
  PRODUCT_ADMIN_ROLE_ID: PRODUCT_ADMIN_ROLE_ID,
  LICENSED_ROLE_IDS: LICENSED_ROLE_IDS,

  getAvailableCustomFields() {
    return USER_CUSTOM_FIELDS.map((field) => ({
      key: field.key,
      name: field.name,
      dataType: field.dataType || "string",
      dimension: field.dimension === true,
      group: "User profile"
    }));
  },

  testConnection() {
    var response = source.getDocument(this.v1Path(""), {}, {ignoreErrors: [400, 401, 403, 404]});
    var organization = response && response.data;
    if (!organization || !organization.id) {
      return {errors: [{field: "api_key", message: "Atlassian did not answer the organization of this" +
        " ID and API key. Check that the key belongs to this organization and has not expired."}]};
    }

    var name = (organization.attributes && organization.attributes.name) || organization.id;
    return {authentication: {organization: name}};
  },

  getSourceSelections() {
    var options = [];
    this.workspaceCatalog(this.getWorkspaces()).sites.forEach((site) => {
      if (site.cloudId) options.push({key: site.key, name: `${site.name} (all products)`});
      site.workspaces.forEach((workspace) => {
        options.push({
          key: workspace.key,
          name: workspace.productName === site.name ? site.name : `${workspace.productName} — ${site.name}`
        });
      });
    });

    return {
      label: "Select products",
      hint: "The products of the Atlassian Cloud sites of the organization and the products without a site," +
        " such as Bitbucket. All users of the organization are imported, with their access to the selected" +
        " products. Selecting a site imports all of its products, also the ones added later.",
      multiple: true,
      options: options
    };
  },

  // One workspace per product of every site (a site with Jira and Confluence is two workspaces), with
  // the license entitlement of the product in its relationships.
  getWorkspaces() {
    var workspaces = [];
    var body = {limit: WORKSPACES_PAGE_LIMIT};

    for (;;) {
      let page = source.postDocument(this.v2Path("/workspaces"), body);
      ((page && page.data) || []).forEach((workspace) => workspaces.push(workspace));
      let cursor = this.nextCursor(page);
      if (!cursor) return workspaces;

      // A continuation request must carry the cursor and nothing else.
      body = {cursor: cursor};
    }
  },

  // The product workspaces grouped into their sites, with the lookups that resolve the product access of a
  // user to its workspace. A workspace of a site names it by the cloud id of its ARI, which also groups the
  // products served from other hosts (Guard Detect, Rovo, Atlas) into their site; a workspace of another ARI
  // shape (Bitbucket, Trello) is a site of its own. Two workspaces of one site that name the same product
  // (the platform "jira" workspace next to "jira-software") are one product, represented by the one with a
  // real plan, and the ARIs of both stay with it.
  workspaceCatalog(workspaces) {
    var sitesByKey = {};

    workspaces.forEach((workspace) => {
      var entry = this.workspaceEntry(workspace);
      var siteKey = entry.cloudId ? SITE_KEY_PREFIX + entry.cloudId : entry.key;
      var site = sitesByKey[siteKey] ||
        (sitesByKey[siteKey] = {key: siteKey, cloudId: entry.cloudId, entries: [], byProduct: {}});
      site.entries.push(entry);

      var existing = site.byProduct[entry.productKey];
      if (!existing) {
        site.byProduct[entry.productKey] = entry;
      } else if (!this.realPlan(existing) && this.realPlan(entry)) {
        entry.aris = entry.aris.concat(existing.aris);
        site.byProduct[entry.productKey] = entry;
      } else {
        existing.aris = existing.aris.concat(entry.aris);
      }
    });

    var catalog = {sites: [], sitesByKey: sitesByKey, sitesByCloudId: {}, sitesByHost: {},
      sitesByUrl: this.sitesByWorkspaceUrl(sitesByKey), byAri: {}, standaloneByProduct: {}};
    Object.keys(sitesByKey).forEach((siteKey) => {
      var site = sitesByKey[siteKey];
      site.url = site.cloudId ? null : site.entries[0].url;
      site.name = this.siteName(site);
      site.workspaces = _.sortBy(_.values(site.byProduct), "productName");
      site.workspaces.forEach((workspace) => {
        workspace.site = site;
        workspace.aris.forEach((ari) => { catalog.byAri[ari] = workspace; });
        if (!site.cloudId) {
          let standalone = catalog.standaloneByProduct[workspace.productKey] ||
            (catalog.standaloneByProduct[workspace.productKey] = []);
          standalone.push(workspace);
        }
      });
      if (site.cloudId) {
        catalog.sitesByCloudId[site.cloudId] = site;
        // A host that names several sites names none of them.
        catalog.sitesByHost[site.name] = catalog.sitesByHost.hasOwnProperty(site.name) ? null : site;
      }
      catalog.sites.push(site);
    });
    // The sites first, then the products without a site, each by name.
    catalog.sites = _.sortBy(_.sortBy(catalog.sites, (site) => site.name.toLowerCase()),
      (site) => site.cloudId ? 0 : 1);

    return catalog;
  },

  // The site of every workspace URL, which a v1 product access names: also the URL of a product served for a
  // site from another host ("detect.atlassian.com/w/acme"). A URL of the workspaces of several sites names
  // none of them.
  sitesByWorkspaceUrl(sitesByKey) {
    var siteKeysByUrl = {};
    Object.keys(sitesByKey).forEach((siteKey) => {
      sitesByKey[siteKey].entries.forEach((entry) => {
        if (!entry.url) return;
        let siteKeys = siteKeysByUrl[entry.url] || (siteKeysByUrl[entry.url] = []);
        if (siteKeys.indexOf(siteKey) < 0) siteKeys.push(siteKey);
      });
    });

    var sitesByUrl = {};
    Object.keys(siteKeysByUrl).forEach((url) => {
      if (siteKeysByUrl[url].length === 1) sitesByUrl[url] = sitesByKey[siteKeysByUrl[url][0]];
    });
    return sitesByUrl;
  },

  workspaceEntry(workspace) {
    var attributes = workspace.attributes || {};
    var entitlement = this.entitlementAttributes(workspace);
    var productKey = this.productKey(attributes.typeKey);

    return {
      ari: workspace.id,
      aris: [workspace.id],
      key: this.workspaceKey(workspace.id),
      cloudId: this.siteCloudId(workspace.id),
      productKey: productKey,
      productName: this.productName(productKey),
      name: attributes.name || null,
      host: this.urlHost(attributes.hostUrl),
      url: this.normalizedUrl(attributes.hostUrl),
      planKey: entitlement.planKey ? String(entitlement.planKey).toLowerCase() : null,
      planName: entitlement.plan || null,
      capacity: typeof attributes.capacity === "number" ? attributes.capacity : null,
      createdAt: attributes.createdAt || null,
      sandbox: !!attributes.sandbox && attributes.sandbox.type === "CHILD"
    };
  },

  // Whether the roles of a workspace take a license: a sandbox is not billed.
  isLicensable(workspace) {
    if (workspace.sandbox) return false;
    return UNLICENSED_PRODUCT_KEYS.indexOf(workspace.productKey) < 0 || this.paidPlan(workspace);
  },

  // A site is named by the host most of its workspaces are served from (the atlassian.net host), leaving out
  // the hosts of the OTHER_HOST_PRODUCT_KEYS products unless the site has no other; a site of its own by its
  // URL without the scheme ("bitbucket.org/acme"), or by the workspace name when it has no URL.
  siteName(site) {
    if (!site.cloudId) {
      let entry = site.entries[0];
      return entry.url || entry.name || entry.productName;
    }

    var hosted = site.entries.filter((entry) => entry.host);
    var ownHosted = hosted.filter((entry) => OTHER_HOST_PRODUCT_KEYS.indexOf(entry.productKey) < 0);
    var hostCounts = _.countBy(ownHosted.length > 0 ? ownHosted : hosted, "host");
    var hosts = _.sortBy(Object.keys(hostCounts), (host) => -hostCounts[host]);
    return hosts[0] || site.entries[0].name || site.key;
  },

  realPlan(entry) {
    return entry.planKey !== null && entry.planKey !== "none";
  },

  paidPlan(entry) {
    return this.realPlan(entry) && entry.planKey !== FREE_PLAN_KEY;
  },

  // The entitlement of a workspace with a plan — the workspace license.
  entitlementAttributes(workspace) {
    var entitlements = (workspace.relationships && workspace.relationships.entitlement) || [];
    var withPlan = entitlements.filter((entitlement) =>
      entitlement && entitlement.attributes && entitlement.attributes.planKey);

    return withPlan.length > 0 ? withPlan[0].attributes : {};
  },

  // The ARI without its "ari:cloud:" prefix, with the "::" separator as a slash and any character the
  // source selection keys do not allow replaced.
  workspaceKey(ari) {
    return String(ari || "").replace(/^ari:cloud:/, "").replace(/::/g, "/").
      replace(/[^A-Za-z0-9_\-.\/ ]/g, "-");
  },

  urlHost(url) {
    var match = /^https?:\/\/([^\/?#]+)/.exec(String(url || ""));
    return match ? match[1].toLowerCase() : null;
  },

  // "https://bitbucket.org/acme/" → "bitbucket.org/acme": the form a product access URL is compared in.
  normalizedUrl(url) {
    var match = /^https?:\/\/([^?#]+)/.exec(String(url || ""));
    return match ? match[1].replace(/\/+$/, "").toLowerCase() : null;
  },

  // The cloud id of a site ARI ("ari:cloud:jira-software::site/<cloud id>") — how a v2 product access of
  // a user names the workspace it belongs to. A workspace ARI of another shape (Trello, Bitbucket) has no
  // site cloud id.
  siteCloudId(ari) {
    var match = /::site\/(.+)$/.exec(String(ari || ""));
    return match ? match[1] : null;
  },

  getDirectories() {
    var directories = [];
    var params = {};

    for (;;) {
      let page = source.getDocument(this.v2Path("/directories"), params);
      ((page && page.data) || []).forEach((directory) => directories.push(directory));
      let cursor = this.nextCursor(page);
      if (!cursor) return directories;

      params = {cursor: cursor};
    }
  },

  // The directory user search is the one request that answers the org level knowledge about a user: the
  // admin roles, the org group memberships, the account status in the organization and the last activity
  // in every product of every site.
  eachDirectoryUsersPage(directoryId, batchCallback) {
    var cursor = null;

    for (;;) {
      let body = {expand: ["platformRoles", "groups", "productAccess"], limit: PAGE_LIMIT};
      if (cursor) body.cursor = cursor;

      let page = source.postDocument(this.directoryUsersSearchPath(directoryId), body);
      let users = (page && page.data) || [];
      if (users.length > 0) batchCallback(users);

      cursor = this.nextCursor(page);
      if (!cursor) return;
    }
  },

  // The account ids of the users who hold any of the given canonical roles on one workspace, searched under
  // all ARIs of the workspace at once (the Jira product is two).
  getRoleAccountIds(directoryId, workspaceAris, roleIds) {
    return this.searchAccountIds(directoryId, {roleIds: roleIds, resourceIds: workspaceAris});
  },

  // The account ids of the users who have access to one workspace with any role, also the ones who never
  // used it, whom the product access of the user search leaves out.
  getWorkspaceAccountIds(directoryId, workspaceAris) {
    return this.searchAccountIds(directoryId, {resourceIds: workspaceAris});
  },

  searchAccountIds(directoryId, filter) {
    var accountIds = [];
    var cursor = null;

    for (;;) {
      let body = _.extend({}, filter, {limit: PAGE_LIMIT});
      if (cursor) body.cursor = cursor;

      let page = source.postDocument(this.directoryUsersSearchPath(directoryId), body);
      ((page && page.data) || []).forEach((user) => accountIds.push(user.accountId));

      cursor = this.nextCursor(page);
      if (!cursor) return accountIds;
    }
  },

  // The last activity of one user in every product, with one request per user (and page): the activity of
  // the products the directory user search does not answer, keyed by the ARI of the workspace.
  getUserLastActiveDates(accountId) {
    var accesses = [];
    var params = {};

    for (;;) {
      let page = source.getDocument(
        this.v1Path(`/directory/users/${encodeURIComponent(accountId)}/last-active-dates`), params);
      ((page && page.data && page.data.product_access) || []).forEach((access) => accesses.push(access));
      let cursor = this.nextCursor(page);
      if (!cursor) return accesses;

      params = {cursor: cursor};
    }
  },

  // One page of managed accounts per callback: the v1 endpoint answers the per product last active dates of
  // every user, also of the users the directory search does not answer.
  eachOrgUsersPage(batchCallback) {
    source.getAllPaginatedDocuments(this.v1Path("/users"), {
      pagination: "nextUrl",
      nextUrlPath: "links.next",
      arrayKey: "data"
    }, batchCallback);
  },

  productKey(key) {
    var normalized = String(key || "").toLowerCase();
    return PRODUCT_KEY_ALIASES[normalized] || normalized;
  },

  productName(key) {
    var normalized = this.productKey(key);
    return PRODUCT_NAMES[normalized] || normalized.split("-").
      map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  },

  directoryUsersSearchPath(directoryId) {
    return this.v2Path(`/directories/${encodeURIComponent(directoryId)}/users/search`);
  },

  v1Path(suffix) {
    return `/admin/v1/orgs/${encodeURIComponent(source.getSourceParam("org_id") || "")}${suffix}`;
  },

  v2Path(suffix) {
    return `/admin/v2/orgs/${encodeURIComponent(source.getSourceParam("org_id") || "")}${suffix}`;
  },

  // A paged v2 response names the next page in links.next: the continuation token itself, as the API
  // reference shows it, or a URL with the token as its cursor query parameter. Only an absolute URL is
  // told apart from a token: a base64 token can start with a slash.
  nextCursor(page) {
    var next = page && page.links && page.links.next;
    if (!next) return null;

    var match = /[?&]cursor=([^&]+)/.exec(String(next));
    if (match) return decodeURIComponent(match[1]);

    return /^https?:\/\//.test(String(next)) ? null : String(next);
  }
};
