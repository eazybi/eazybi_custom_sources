describe("app.importers.users", () => {
  // The selection context of the mocked organization with the given products selected.
  function workspacesContext(selectedKeys) {
    mock.sourceParams({org_id: "org-1", api_key: "secret-key"});
    mock.post("/admin/v2/orgs/org-1/workspaces", {fixture: "workspaces_page1", requestBody: '{"limit":250}'});
    mock.post("/admin/v2/orgs/org-1/workspaces",
      {fixture: "workspaces_page2", requestBody: '{"cursor":"WSCURSOR2"}'});
    importRun.prepare();

    return app.importers.workspaces.importAll(selectedKeys);
  }

  function siteNames() {
    return dwh.dimensions.sites.rows({columns: ["name"]}).map((row) => row.name).sort();
  }

  describe("adminRoleName", () => {
    test("returns the highest admin role of the user", () => {
      expect(app.importers.users.adminRoleName(
        {platformRoles: ["atlassian/site-admin", "atlassian/org-admin"]}, {})).toBe("Org admin");
      expect(app.importers.users.adminRoleName(
        {platformRoles: ["atlassian/site-admin"]},
        {"jira-software/site/site-acme": ["atlassian/admin"]})).toBe("Site admin");
      expect(app.importers.users.adminRoleName(
        {platformRoles: []}, {"jira-software/site/site-acme": ["atlassian/user", "atlassian/admin"]})).
        toBe("Product admin");
      expect(app.importers.users.adminRoleName(
        {platformRoles: []}, {"jira-software/site/site-acme": ["atlassian/user"]})).toBe("No admin role");
      expect(app.importers.users.adminRoleName({platformRoles: []}, {})).toBe("No admin role");
    });
  });

  describe("statusName", () => {
    test("prefers the directory status and falls back to the v1 account status", () => {
      expect(app.importers.users.statusName("not_invited", "active")).toBe("Not invited");
      expect(app.importers.users.statusName(null, "active")).toBe("Active");
      expect(app.importers.users.statusName(null, "inactive")).toBe("Deactivated");
      expect(app.importers.users.statusName(null, "closed")).toBe("Closed");
      expect(app.importers.users.statusName("unknown_status", null)).toBe("(unknown)");
    });
  });

  describe("resolveV1Accesses", () => {
    test("resolves the site by the product URL and skips the deselected products", () => {
      var context = workspacesContext(["site/site-acme"]);

      var accesses = app.importers.users.resolveV1Accesses([
        {key: "jira", url: "https://acme.atlassian.net", last_active: "2026-09-01T08:00:00Z"},
        {key: "jira-software", url: "https://gamma.atlassian.net", last_active: "2026-06-01T10:00:00Z"},
        {key: "bitbucket", url: "https://bitbucket.org/acme-dev", last_active: "2026-05-01T10:00:00Z"},
        {key: "opsgenie", url: "https://acme.app.opsgenie.com", last_active: "2026-04-01T10:00:00Z"}
      ], context);

      expect(accesses).toHaveLength(4);
      expect(accesses[0].skipped).toBeUndefined();
      expect(accesses[0].workspaceKey).toBe("jira-software/site/site-acme");
      expect(accesses[1].skipped).toBe(true);
      expect(accesses[2].skipped).toBe(true);
      expect(accesses[2].workspaceKey).toBe("bitbucket/workspace/ws-bitbucket");
      // A product the organization has no workspace for is imported only when all products are selected.
      expect(accesses[3].skipped).toBe(true);
      expect(siteNames()).toEqual(["acme.atlassian.net"]);
    });

    test("resolves the site of a product served from another host by the product URL", () => {
      var context = workspacesContext(["site/site-acme"]);

      var accesses = app.importers.users.resolveV1Accesses([
        {key: "beacon", url: "https://detect.atlassian.com/w/acme-beacon", last_active: "2026-09-01T08:00:00Z"}
      ], context);

      expect(accesses[0].skipped).toBeUndefined();
      expect(accesses[0].workspaceKey).toBe("beacon/site/site-acme");
    });

    test("resolves the only workspace of a product without a site only for an access naming no other one", () => {
      var context = workspacesContext(["(all)"]);

      var accesses = app.importers.users.resolveV1Accesses([
        {key: "trello", url: "https://trello.com/w/acme", last_active: "2026-07-15T16:30:00Z"},
        {key: "bitbucket", url: "https://bitbucket.org/acme-old", last_active: "2026-05-01T10:00:00Z"}
      ], context);

      expect(_.sortBy(accesses, "productKey").map((access) => [access.productKey, access.siteKey])).toEqual([
        ["bitbucket", "removed/bitbucket.org/acme-old"],
        ["trello", "trello/workspace/ws-trello"]
      ]);
    });

    test("imports the access of a removed site under its URL when all products are selected", () => {
      var context = workspacesContext(["(all)"]);

      var accesses = app.importers.users.resolveV1Accesses([
        {key: "jira-software", url: "https://sandbox.atlassian.net", last_active: "2026-03-01T10:00:00Z"}
      ], context);

      expect(accesses[0].skipped).toBeUndefined();
      expect(accesses[0].siteKey).toBe("removed/sandbox.atlassian.net");
      expect(siteNames()).toContain("sandbox.atlassian.net (removed)");
      expect(siteNames()).not.toContain("(no site)");
    });
  });

  describe("resolveV2Accesses", () => {
    test("resolves the workspace by the ARI and the product of the access", () => {
      var context = workspacesContext(["site/site-acme"]);

      var accesses = app.importers.users.resolveV2Accesses([
        {key: "jira-software", id: "ari:cloud:jira-software::site/site-acme",
          lastActiveTimestamp: "2026-09-01T08:00:00Z"},
        {key: "jira-core", id: "ari:cloud:jira-core::site/site-acme",
          lastActiveTimestamp: "2026-09-05T08:00:00Z"},
        {key: "assets", id: "ari:cloud:assets::site/site-acme", lastActiveTimestamp: "2026-08-01T08:00:00Z"},
        {key: "jira-software", id: "ari:cloud:jira-software::site/site-gamma",
          lastActiveTimestamp: "2026-06-01T10:00:00Z"},
        {key: "studio", id: "ari:cloud:studio::site/site-acme", lastActiveTimestamp: "2026-05-01T10:00:00Z"}
      ], context);

      // The "jira-core" access is the same Jira product, so the two count as one with the latest activity.
      expect(accesses).toHaveLength(4);
      expect(accesses[0].workspaceKey).toBe("jira-software/site/site-acme");
      expect(accesses[0].lastActive).toBe("2026-09-05T08:00:00Z");
      expect(accesses[1].workspaceKey).toBe("cmdb/site/site-acme");
      expect(accesses[2].skipped).toBe(true);
      // The activity in a product its site no longer has is no access to it.
      expect(accesses[3].skipped).toBe(true);
      expect(accesses[3].siteKey).toBe("site/site-acme");
      expect(accesses[3].workspaceKey).toBeNull();
      expect(siteNames()).toEqual(["acme.atlassian.net"]);
    });

    test("imports a product the organization has no workspace for when all products are selected", () => {
      var context = workspacesContext(["(all)"]);

      var accesses = app.importers.users.resolveV2Accesses([
        {key: "loom", id: "ari:cloud:loom::workspace/ws-loom", lastActiveTimestamp: "2026-05-01T10:00:00Z"}
      ], context);

      expect(accesses[0].skipped).toBeUndefined();
      expect(siteNames()).toContain("(no site)");
    });

    test("does not resolve the access of another workspace to the only workspace of its product", () => {
      var context = workspacesContext(["(all)"]);

      var accesses = app.importers.users.resolveV2Accesses([
        {key: "bitbucket", id: "ari:cloud:bitbucket::workspace/ws-old", lastActiveTimestamp: "2026-05-01T10:00:00Z"}
      ], context);

      expect(accesses[0].workspaceKey).toBeNull();
      expect(accesses[0].siteKey).toBeNull();
    });

    test("imports the access of every removed site under its cloud id when all products are selected", () => {
      var context = workspacesContext(["(all)"]);

      var accesses = app.importers.users.resolveV2Accesses([
        {key: "jira-software", id: "ari:cloud:jira-software::site/site-sandbox1",
          lastActiveTimestamp: "2026-03-01T10:00:00Z"},
        {key: "jira-software", id: "ari:cloud:jira-software::site/site-sandbox2",
          lastActiveTimestamp: "2026-04-01T10:00:00Z"}
      ], context);

      expect(_.sortBy(accesses, "siteKey").map((access) => [access.siteKey, access.skipped, access.lastActive]))
        .toEqual([
          ["removed/site-sandbox1", undefined, "2026-03-01T10:00:00Z"],
          ["removed/site-sandbox2", undefined, "2026-04-01T10:00:00Z"]
        ]);
      expect(siteNames()).toContain("site-sandbox1 (removed)");
      expect(siteNames()).toContain("site-sandbox2 (removed)");
      expect(siteNames()).not.toContain("(no site)");
    });

    test("skips the access of a removed site when not all products are selected", () => {
      var context = workspacesContext(["site/site-acme"]);

      var accesses = app.importers.users.resolveV2Accesses([
        {key: "jira-software", id: "ari:cloud:jira-software::site/site-sandbox1",
          lastActiveTimestamp: "2026-03-01T10:00:00Z"}
      ], context);

      expect(accesses[0].skipped).toBe(true);
      expect(siteNames()).toEqual(["acme.atlassian.net"]);
    });
  });

  describe("withoutRevokedAccesses", () => {
    test("drops the activity in a workspace whose access search found other users but not the user", () => {
      var context = workspacesContext(["(all)"]);
      var jira = context.catalog.byAri["ari:cloud:jira-software::site/site-acme"];
      var confluence = context.catalog.byAri["ari:cloud:confluence::site/site-acme"];
      context.productUsers = {"acc-bob": {[jira.key]: jira}, "acc-carol": {[confluence.key]: confluence}};
      context.workspacesWithUsers = app.importers.directory.workspacesWithUsers(context.productUsers);

      var accesses = app.importers.users.withoutRevokedAccesses("acc-bob",
        app.importers.users.resolveV2Accesses([
          {key: "jira-software", id: "ari:cloud:jira-software::site/site-acme",
            lastActiveTimestamp: "2026-09-01T08:00:00Z"},
          {key: "confluence", id: "ari:cloud:confluence::site/site-acme",
            lastActiveTimestamp: "2025-03-01T08:00:00Z"},
          {key: "bitbucket", id: "ari:cloud:bitbucket::workspace/ws-bitbucket",
            lastActiveTimestamp: "2026-08-01T08:00:00Z"},
          {key: "jira-software", id: "ari:cloud:jira-software::site/site-sandbox1",
            lastActiveTimestamp: "2026-03-01T10:00:00Z"}
        ], context), context);

      // Bitbucket answers no users, so its activity stays; so does the access to a removed site.
      expect(_.sortBy(accesses, "siteKey").map((access) => [access.siteKey, access.productKey])).toEqual([
        ["bitbucket/workspace/ws-bitbucket", "bitbucket"],
        ["removed/site-sandbox1", "jira-software"],
        ["site/site-acme", "jira-software"]
      ]);
    });
  });

  describe("fromOrgUser", () => {
    test("drops the activity of a v1 user in a workspace whose access search did not find the user", () => {
      var context = workspacesContext(["site/site-acme"]);
      var confluence = context.catalog.byAri["ari:cloud:confluence::site/site-acme"];
      context.productUsers = {"acc-carol": {[confluence.key]: confluence}};
      context.workspacesWithUsers = app.importers.directory.workspacesWithUsers(context.productUsers);

      var user = app.importers.users.fromOrgUser({account_id: "acc-dave", product_access: [
        {key: "jira-software", url: "https://acme.atlassian.net", last_active: "2026-09-01T08:00:00Z"},
        {key: "confluence", url: "https://acme.atlassian.net", last_active: "2025-03-01T08:00:00Z"}
      ]}, context);

      expect(user.accesses.map((access) => access.productKey)).toEqual(["jira-software"]);
    });

    test("keeps the activity of a revoked access in the last activity of the user", () => {
      var context = workspacesContext(["site/site-acme"]);
      var confluence = context.catalog.byAri["ari:cloud:confluence::site/site-acme"];
      context.productUsers = {"acc-carol": {[confluence.key]: confluence}};
      context.workspacesWithUsers = app.importers.directory.workspacesWithUsers(context.productUsers);

      var user = app.importers.users.fromOrgUser({account_id: "acc-dave", product_access: [
        {key: "confluence", url: "https://acme.atlassian.net", last_active: "2026-09-01T08:00:00Z"}
      ]}, context);

      expect(user.accesses).toEqual([]);
      expect(user.lastActive).toBe("2026-09-01T08:00:00Z");

      var directoryUser = app.importers.users.fromDirectoryUser({accountId: "acc-erin", productAccess: [
        {key: "confluence", id: "ari:cloud:confluence::site/site-acme", lastActiveTimestamp: "2026-09-02T08:00:00Z"}
      ]}, null, context);

      expect(directoryUser.accesses).toEqual([]);
      expect(directoryUser.lastActive).toBe("2026-09-02T08:00:00Z");
    });
  });

  describe("workspaceActivity", () => {
    test("reads the last active dates only of a user with access to a Studio workspace", () => {
      var context = workspacesContext(["site/site-acme"]);
      var jira = context.catalog.byAri["ari:cloud:jira-software::site/site-acme"];
      context.productUsers = {"acc-bob": {[jira.key]: jira}};
      var lastActiveDates = mock.spyOn(app.api, "getUserLastActiveDates").mockImplementation(() => []);

      expect(app.importers.users.workspaceActivity("acc-bob", context)).toEqual({accesses: [], error: null});
      expect(lastActiveDates).not.toHaveBeenCalled();
    });
  });

  describe("withProductUsers", () => {
    test("adds the products a user never used and marks the licensed ones", () => {
      var context = workspacesContext(["site/site-acme"]);
      var jira = context.catalog.byAri["ari:cloud:jira-software::site/site-acme"];
      var confluence = context.catalog.byAri["ari:cloud:confluence::site/site-acme"];
      context.productUsers = {"acc-bob": {[jira.key]: jira, [confluence.key]: confluence}};
      context.licensedUsers = {"acc-bob": {[confluence.key]: true}};

      var accesses = app.importers.users.withProductUsers("acc-bob", app.importers.users.resolveV2Accesses([
        {key: "jira-software", id: "ari:cloud:jira-software::site/site-acme",
          lastActiveTimestamp: "2026-09-01T08:00:00Z"}
      ], context), context);

      expect(_.sortBy(accesses, "productKey").map((access) =>
        [access.productKey, access.lastActive, access.licensed])).toEqual([
        ["confluence", null, true],
        ["jira-software", "2026-09-01T08:00:00Z", false]
      ]);
    });
  });

  describe("profileValues", () => {
    test("normalizes the profile fields of a directory user", () => {
      var profile = app.importers.users.profileValues({
        department: "Support",
        jobTitle: "Engineer",
        mfaEnabled: true,
        emailVerified: false,
        managementSource: "invited",
        claimStatus: "UNCLAIMED",
        addedToOrg: "2024-02-01T10:00:00Z"
      });

      expect(profile.department).toBe("Support");
      expect(profile.job_title).toBe("Engineer");
      expect(profile.organization).toBeNull();
      expect(profile.mfa_enabled).toBe("Yes");
      expect(profile.email_verified).toBe("No");
      expect(profile.management_source).toBe("Invited");
      expect(profile.claim_status).toBe("Unclaimed");
      expect(profile.added_to_org).toBe("2024-02-01T10:00:00Z");
    });
  });

  describe("importOne", () => {
    test("reports a failed user and keeps the import going", () => {
      importRun.prepare();
      mock.spyOn(app.importers.users, "buildRows").mockImplementation(() => {
        throw new Error("unexpected");
      });

      var rows = app.importers.users.importOne(
        {accountId: "acc-broken", name: "Broken", platformRoles: [], groups: [], accesses: [], profile: {}},
        {productRoles: {}, customFields: []});

      expect(importRun.objectFailures()).toEqual(["user/acc-broken"]);
      expect(rows).toBeNull();
      expect(importRun.warnings().map((warning) => warning.message)).
        toEqual(["Import of the user acc-broken failed: unexpected"]);
    });

    test("keeps the products of a failed user tracked by the activity of the user", () => {
      importRun.prepare();
      mock.spyOn(app.importers.users, "buildRows").mockImplementation(() => {
        throw new Error("unexpected");
      });
      var shared = {productRoles: {}, customFields: [], tracking: {groups: {}, activeGroups: {}}};

      app.importers.users.importOne({accountId: "acc-broken", platformRoles: [], groups: [], profile: {},
        accesses: [
          {siteKey: "site/site-acme", productKey: "confluence", licensed: true, lastActive: "2026-09-01T08:00:00Z"},
          {siteKey: "site/site-acme", productKey: "jira-software", licensed: true, lastActive: null},
          {siteKey: "studio/acme", productKey: "studio", licensed: false, lastActive: null}
        ]}, shared);

      expect(shared.tracking.activeGroups).toEqual({"site/site-acme|confluence|licensed": true});
    });

    test("keeps the Studio of a user tracked when its last active dates could not be read", () => {
      importRun.prepare();
      var shared = {productRoles: {}, customFields: [], tracking: {groups: {}, activeGroups: {}}};

      app.importers.users.importOne({accountId: "acc-broken", platformRoles: [], groups: [], profile: {},
        error: new Error("The last activity could not be read: Bad request"),
        accesses: [
          {siteKey: "site/site-acme", productKey: "confluence", licensed: true, lastActive: "2026-09-01T08:00:00Z"},
          {siteKey: "site/site-acme", productKey: "goal", licensed: false, lastActive: null},
          {siteKey: "studio/acme", productKey: "studio", licensed: false, lastActive: null}
        ]}, shared);

      expect(shared.tracking.activeGroups).toEqual(
        {"site/site-acme|confluence|licensed": true, "studio/acme|studio|unlicensed": true});
    });
  });

  describe("importProductAccessRows", () => {
    test("writes the rows of many users per call within the row limit, never splitting a user", () => {
      importRun.prepare();
      var importRows = mock.spyOn(dwh.measures.product_access, "importRows").mockImplementation(() => {});
      var rowsOf = (accountId, count) => _.range(count).map(() => ({_source_id: accountId}));

      app.importers.users.importProductAccessRows(
        [rowsOf("acc-1", 6000), rowsOf("acc-2", 3000), rowsOf("acc-3", 2000)]);

      expect(importRows.mock.calls.map((call) => _.uniq(call[0].map((row) => row._source_id)))).
        toEqual([["acc-1", "acc-2"], ["acc-3"]]);
      expect(importRows.mock.calls.map((call) => call[0].length)).toEqual([9000, 2000]);
    });
  });

  describe("lastActive", () => {
    test("compares the timestamps by time and not as text", () => {
      expect(app.importers.users.lastActive([{lastActive: "2026-09-10T12:00:00Z"},
        {lastActive: "2026-09-10T12:00:00.500Z"}])).toBe("2026-09-10T12:00:00.500Z");
      expect(app.importers.users.lastActive([{lastActive: "2026-09-10T13:00:00+02:00"},
        {lastActive: "2026-09-10T12:00:00Z"}])).toBe("2026-09-10T12:00:00Z");
      expect(app.importers.users.lastActive([])).toBeNull();
    });

    test("compares a last activity without a time as the midnight of its day in the Time dimension time zone", () => {
      mock.extraOptions({time_dimension_time_zone: "America/New_York"});
      importRun.prepare();

      // 02:00 UTC is the evening of September 19, 05:00 UTC the night of September 20 in New York.
      expect(app.importers.users.lastActive([{lastActive: "2026-09-20T02:00:00Z"},
        {lastActive: "2026-09-20"}])).toBe("2026-09-20");
      expect(app.importers.users.lastActive([{lastActive: "2026-09-20"},
        {lastActive: "2026-09-20T05:00:00Z"}])).toBe("2026-09-20T05:00:00Z");
    });

    test("counts only the activity in the selected products", () => {
      expect(app.importers.users.lastActive([{lastActive: "2026-09-01T08:00:00Z"},
        {lastActive: "2026-10-01T08:00:00Z", skipped: true}])).toBe("2026-09-01T08:00:00Z");
      expect(app.importers.users.lastActive([{lastActive: "2026-10-01T08:00:00Z", skipped: true}])).toBeNull();
    });
  });

  describe("lastActiveTimeId", () => {
    test("looks a last activity without a time up as the date it is written as", () => {
      importRun.prepare();
      var lookupTimeId = mock.spyOn(dwh, "lookupTimeId");

      expect(app.importers.users.lastActiveTimeId("2026-09-20", "last active")).
        toBe(dwh.lookupDateId("2026-09-20"));
      expect(lookupTimeId).not.toHaveBeenCalled();
      expect(app.importers.users.lastActiveTimeId("2026-09-20T10:00:00Z", "last active")).
        toBe(dwh.lookupDateId("2026-09-20"));
      expect(lookupTimeId).toHaveBeenCalledWith("2026-09-20T10:00:00Z", "last active");
    });
  });

  describe("lastActiveTimestamp", () => {
    test("takes a last activity without a time as the midnight of its day in the Time dimension time zone", () => {
      mock.extraOptions({time_dimension_time_zone: "America/New_York"});
      importRun.prepare();

      expect(app.importers.users.lastActiveTimestamp("2026-09-20")).toBe(Date.parse("2026-09-20T04:00:00Z") / 1000);
      expect(app.importers.users.lastActiveTimestamp("2026-09-20T10:00:30.500Z")).
        toBe(Date.parse("2026-09-20T10:00:30Z") / 1000);
      expect(app.importers.users.lastActiveTimestamp(null)).toBeNull();
    });

    test("keeps a last activity without a time on its day when daylight saving starts before it", () => {
      mock.extraOptions({time_dimension_time_zone: "Australia/Sydney"});
      importRun.prepare();

      expect(app.importers.users.lastActiveTimestamp("2026-10-04")).toBe(Date.parse("2026-10-03T14:00:00Z") / 1000);
    });

    test("keeps a last activity without a time at its midnight when daylight saving ends before it", () => {
      mock.extraOptions({time_dimension_time_zone: "Australia/Sydney"});
      importRun.prepare();

      expect(app.importers.users.lastActiveTimestamp("2026-04-05")).toBe(Date.parse("2026-04-04T13:00:00Z") / 1000);
    });

    test("starts a last activity without a time at 01:00 on a day without a midnight", () => {
      mock.extraOptions({time_dimension_time_zone: "America/Santiago"});
      importRun.prepare();

      expect(app.importers.users.lastActiveTimestamp("2026-09-06")).toBe(Date.parse("2026-09-06T04:00:00Z") / 1000);
    });

    test("takes a last activity without a time as its midnight UTC in the UTC time zone", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();

      expect(app.importers.users.lastActiveTimestamp("2026-09-20")).toBe(Date.parse("2026-09-20T00:00:00Z") / 1000);
    });
  });

  describe("uniqueAccesses", () => {
    test("keeps the access with the latest activity by time", () => {
      var accesses = app.importers.users.uniqueAccesses([
        {siteKey: "site/site-acme", productKey: "jira-software", lastActive: "2026-09-10T12:00:00.500Z"},
        {siteKey: "site/site-acme", productKey: "jira-software", lastActive: "2026-09-10T12:00:00Z"},
        {siteKey: "site/site-acme", productKey: "confluence", lastActive: null},
        {siteKey: "site/site-acme", productKey: "confluence", lastActive: "2026-08-01T09:00:00Z"}
      ]);

      expect(accesses.map((access) => access.lastActive)).
        toEqual(["2026-09-10T12:00:00.500Z", "2026-08-01T09:00:00Z"]);
    });

    test("keeps a last activity without a time over an activity of the previous evening", () => {
      mock.extraOptions({time_dimension_time_zone: "America/New_York"});
      importRun.prepare();

      var accesses = app.importers.users.uniqueAccesses([
        {siteKey: "site/site-acme", productKey: "studio", lastActive: "2026-09-20T02:00:00Z"},
        {siteKey: "site/site-acme", productKey: "studio", lastActive: "2026-09-20"}
      ]);

      expect(accesses.map((access) => access.lastActive)).toEqual(["2026-09-20"]);
    });
  });
});
