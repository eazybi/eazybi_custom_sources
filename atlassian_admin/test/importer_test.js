describe("app.importer.importAll", () => {
  var SEARCH_PATH = "/admin/v2/orgs/org-1/directories/dir-1/users/search";

  // The ARIs of every workspace, searched together: the acme Jira is the "jira-software" workspace with
  // the platform "jira" workspace of the same site.
  var ACME_JIRA_ARIS = ["ari:cloud:jira-software::site/site-acme", "ari:cloud:jira::site/site-acme"];
  var ACME_CONFLUENCE_ARIS = ["ari:cloud:confluence::site/site-acme"];
  var ACME_ASSETS_ARIS = ["ari:cloud:cmdb::site/site-acme"];
  var WORKSPACE_ARIS = [ACME_JIRA_ARIS, ACME_CONFLUENCE_ARIS, ACME_ASSETS_ARIS,
    ["ari:cloud:beacon::site/site-acme"], ["ari:cloud:jira-software::site/site-beta"],
    ["ari:cloud:jira-software::site/site-gamma"], ["ari:cloud:trello::workspace/ws-trello"],
    ["ari:cloud:bitbucket::workspace/ws-bitbucket"]];
  var ROLE_IDS = ["atlassian/user", "atlassian/admin", "atlassian/user-access-admin", "atlassian/contributor",
    "atlassian/basic", "atlassian/stakeholder", "atlassian/customer", "atlassian/guest"];
  var LICENSED_ROLE_IDS = ["atlassian/user", "atlassian/admin"];

  function roleSearchBody(workspaceAris, roleIds) {
    return JSON.stringify({roleIds: roleIds, resourceIds: workspaceAris, limit: 100});
  }

  function productUsersSearchBody(workspaceAris) {
    return JSON.stringify({resourceIds: workspaceAris, limit: 100});
  }

  // The mocked organization: the whole acme site selected (Jira and Assets on a free, Confluence on a
  // standard plan, and Guard Detect), the Jira of the beta site on a standard plan and the Trello workspace
  // selected, the gamma site and the Bitbucket workspace not. Alice and Bob have access to the acme Jira
  // with the user role, and to the acme Assets, which Bob never used and holds the user role of. Bob holds
  // the product admin role of the acme Jira workspace as well.
  function mockOrganization() {
    mock.sourceParams({org_id: "org-1", api_key: "secret-key"});
    mock.sourceSelection(["site/site-acme", "jira-software/site/site-beta", "trello/workspace/ws-trello"]);
    mock.extraOptions({import_product_roles: true, time_dimension_time_zone: "UTC"});

    mock.post("/admin/v2/orgs/org-1/workspaces", {fixture: "workspaces_page1", requestBody: '{"limit":250}'});
    mock.post("/admin/v2/orgs/org-1/workspaces",
      {fixture: "workspaces_page2", requestBody: '{"cursor":"WSCURSOR2"}'});
    mock.get("/admin/v2/orgs/org-1/directories", {fixture: "directories"});
    mock.post(SEARCH_PATH, {fixture: "directory_users"});
    WORKSPACE_ARIS.forEach((aris) => {
      mock.post(SEARCH_PATH, {fixture: "role_admins_empty", requestBody: productUsersSearchBody(aris)});
      mock.post(SEARCH_PATH, {fixture: "role_admins_empty", requestBody: roleSearchBody(aris, LICENSED_ROLE_IDS)});
      ROLE_IDS.forEach((roleId) => {
        mock.post(SEARCH_PATH, {fixture: "role_admins_empty", requestBody: roleSearchBody(aris, [roleId])});
      });
    });
    mock.post(SEARCH_PATH, {fixture: "product_users_acme_jira",
      requestBody: roleSearchBody(ACME_JIRA_ARIS, ["atlassian/user"])});
    mock.post(SEARCH_PATH, {fixture: "role_admins_acme_jira",
      requestBody: roleSearchBody(ACME_JIRA_ARIS, ["atlassian/admin"])});
    mock.post(SEARCH_PATH, {fixture: "product_users_acme_jira",
      requestBody: roleSearchBody(ACME_JIRA_ARIS, LICENSED_ROLE_IDS)});
    mock.post(SEARCH_PATH, {fixture: "product_users_acme_jira",
      requestBody: productUsersSearchBody(ACME_JIRA_ARIS)});
    // Bob holds the user role of the Assets, which comes with Jira Service Management and takes no license.
    mock.post(SEARCH_PATH, {fixture: "product_users_acme_assets",
      requestBody: roleSearchBody(ACME_ASSETS_ARIS, ["atlassian/user"])});
    mock.post(SEARCH_PATH, {fixture: "product_users_acme_jira",
      requestBody: productUsersSearchBody(ACME_ASSETS_ARIS)});
    mock.get("/admin/v1/orgs/org-1/users", {fixture: "org_users_page1"});
    mock.get("/admin/v1/orgs/org-1/users", {fixture: "org_users_page2", params: {cursor: "USERSCURSOR2"}});
  }

  describe("of the selected products", () => {
    beforeAll(() => {
      mockOrganization();

      importRun.run();
    });

    test("imports the sites of the selected products", () => {
      expect(dwh.dimensions.sites.rows({columns: ["name"]}).map((row) => row.name).sort()).
        toEqual(["Acme Trello", "acme.atlassian.net", "beta.atlassian.net"]);
    });

    test("imports the products and plans of the workspaces", () => {
      expect(dwh.dimensions.products.rows({columns: ["product_key", "name"], orderBy: "product_key"})).
        toEqual([
          {product_key: "assets", name: "Assets"},
          {product_key: "beacon", name: "Guard Detect"},
          {product_key: "confluence", name: "Confluence"},
          {product_key: "jira-software", name: "Jira"},
          {product_key: "trello", name: "Trello"}
        ]);
      // The platform "jira" workspace without a plan is part of the Jira product and adds no plan.
      expect(dwh.dimensions.plans.rows({columns: ["plan_key", "name", "ordinal"], orderBy: "ordinal"})).
        toEqual([
          {plan_key: "free", name: "Free", ordinal: 1},
          {plan_key: "standard", name: "Standard", ordinal: 2}
        ]);
    });

    test("imports one licenses row per selected product", () => {
      var rows = dwh.measures.licenses.rows({columns: ["_source_id", "license_seats", "workspaces_count"]});
      expect(_.sortBy(rows, "_source_id")).toEqual([
        {_source_id: "beacon/site/site-acme", license_seats: null, workspaces_count: 1},
        {_source_id: "cmdb/site/site-acme", license_seats: null, workspaces_count: 1},
        {_source_id: "confluence/site/site-acme", license_seats: 25, workspaces_count: 1},
        {_source_id: "jira-software/site/site-acme", license_seats: 10, workspaces_count: 1},
        {_source_id: "jira-software/site/site-beta", license_seats: 50, workspaces_count: 1},
        {_source_id: "trello/workspace/ws-trello", license_seats: null, workspaces_count: 1}
      ]);
    });

    test("imports the users with their role and status", () => {
      expect(dwh.dimensions.users.rows({
        columns: ["account_id", "display_name", "admin_role", "status"],
        orderBy: "account_id"
      })).toEqual([
        {account_id: "acc-alice", display_name: "Alice Admin", admin_role: "Org admin", status: "Active"},
        {account_id: "acc-bob", display_name: "Bob Builder", admin_role: "Product admin", status: "Active"},
        {account_id: "acc-carol", display_name: "Carol Gone", admin_role: "No admin role",
          status: "Deactivated"},
        {account_id: "acc-dave", display_name: "Dave Distant", admin_role: "No admin role", status: "Active"}
      ]);
    });

    test("counts the active and inactive users", () => {
      expect(dwh.measures.users.rows({
        columns: ["_source_id", "users_count", "active_users", "inactive_users"],
        orderBy: "_source_id"
      })).toEqual([
        {_source_id: "acc-alice", users_count: 1, active_users: 1, inactive_users: null},
        {_source_id: "acc-bob", users_count: 1, active_users: 1, inactive_users: null},
        {_source_id: "acc-carol", users_count: 1, active_users: null, inactive_users: 1},
        {_source_id: "acc-dave", users_count: 1, active_users: 1, inactive_users: null}
      ]);
    });

    test("imports the product access of the selected products", () => {
      var rows = dwh.measures.product_access.rows({
        columns: ["_source_id", "product_users", "product_admins"], orderBy: "_source_id"
      });

      // Alice: acme Jira (her "jira-software" and "jira-core" accesses), acme Assets, beta Jira and Trello,
      // her Bitbucket access is not selected; Bob: acme Jira (the v1 "jira" key normalized) and the acme
      // Assets he has access to but never used. Dave's only access is on the deselected gamma site and Carol
      // has none.
      expect(rows).toHaveLength(6);
      expect(rows).toContainEqual({_source_id: "acc-bob", product_users: 1, product_admins: 1});
      expect(rows.filter((row) => row._source_id === "acc-alice")).toHaveLength(4);
      expect(rows.filter((row) => row._source_id === "acc-bob")).toHaveLength(2);
      expect(rows.filter((row) => row.product_admins === 1)).toHaveLength(1);
    });

    test("aggregates the product users by their product roles", () => {
      // Alice's beta Jira has no role found, so it counts in the total only.
      expect(olap.results(`
        SELECT NON EMPTY [Product Role].[Product Role].Members ON COLUMNS,
               [Product].[Product].[Jira] ON ROWS
        FROM [Atlassian Admin]
        WHERE [Measures].[Product users]
      `)).toEqual([["Jira", 2, 1]]);
      expect(olap.results(`
        SELECT [Measures].[Product users] ON COLUMNS, [Product].[Product].[Jira] ON ROWS
        FROM [Atlassian Admin]
      `)).toEqual([["Jira", 3]]);
    });

    // Alice's beta Jira and Trello have no role found, so they are not licensed, and the Assets roles take no
    // license.
    test("counts the users holding a license of the product", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Product].[Product].Members ON ROWS,
               {[Measures].[Product users], [Measures].[Licensed users], [Measures].[Unused licenses]} ON COLUMNS
        FROM [Atlassian Admin]
        WHERE [Time].[All Times]
      `)).toEqual([["Assets", 2, null, null], ["Jira", 3, 2, null], ["Trello", 1, null, null]]);
    });

    test("aggregates the users by role", () => {
      expect(olap.results(`
        SELECT [Admin Role].[Admin Role].Members ON ROWS, [Measures].[Users] ON COLUMNS
        FROM [Atlassian Admin]
      `)).toEqual([["Org admin", 1], ["Product admin", 1], ["No admin role", 2]]);
    });

    test("aggregates the users by their org groups", () => {
      var results = olap.results(`
        SELECT [Group].[Group].Members ON ROWS, [Measures].[Users] ON COLUMNS
        FROM [Atlassian Admin]
      `);

      expect(results).toContainEqual(["developers", 1]);
      expect(results).toContainEqual(["org-admins", 1]);
    });

    test("aggregates the license seats by site", () => {
      var results = olap.results(`
        SELECT [Site].[Site].Members ON ROWS,
               {[Measures].[License seats], [Measures].[Product users]} ON COLUMNS
        FROM [Atlassian Admin]
      `);

      expect(results).toContainEqual(["acme.atlassian.net", 35, 4]);
      expect(results).toContainEqual(["beta.atlassian.net", 50, 1]);
    });

    test("compares the seats of every workspace with its own users", () => {
      expect(olap.results(`
        SELECT Filter(NonEmptyCrossJoin([Site].[Site].Members, [Product].[Product].Members),
                 [Measures].[License seats] > 0) ON ROWS,
               {[Measures].[License seats], [Measures].[Product users], [Measures].[Remaining seats]} ON COLUMNS
        FROM [Atlassian Admin]
      `)).toEqual([
        [["acme.atlassian.net", "Confluence"], 25, null, 25],
        [["acme.atlassian.net", "Jira"], 10, 2, 8],
        [["beta.atlassian.net", "Jira"], 50, 1, 49]
      ]);
    });

    test("aggregates the product activity into the Time dimension", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Time].[Month].Members ON ROWS, [Measures].[Product users] ON COLUMNS
        FROM [Atlassian Admin]
      `)).toEqual([
        ["Jul 2026", 1],
        ["Aug 2026", 1],
        ["Sep 2026", 3]
      ]);
    });

    test("shows the user properties as property measures", () => {
      var results = olap.results(`
        SELECT [User].[User].Members ON ROWS,
               {[Measures].[User admin role], [Measures].[User email]} ON COLUMNS
        FROM [Atlassian Admin]
      `);

      expect(results).toContainEqual(["Alice Admin", "Org admin", "alice@acme.com"]);
      expect(results).toContainEqual(["Bob Builder", "Product admin", "bob@acme.com"]);
    });

    var daysSince = (date) => {
      var today = new Date();
      return Math.round((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
        Date.parse(date.slice(0, 10))) / 86400000);
    };

    test("counts the days since the last activity of the user and in a product", () => {
      var inactiveDays = (product) => olap.results(`
        SELECT {[Measures].[Product inactive days], [Measures].[User inactive days]} ON COLUMNS,
               [User].[User].[Bob Builder] ON ROWS
        FROM [Atlassian Admin]
        WHERE [Product].[Product].[${product}]
      `);

      expect(inactiveDays("Jira")).toEqual([["Bob Builder", daysSince("2026-09-01"), daysSince("2026-09-01")]]);
      // Bob never used the Assets he has access to.
      expect(inactiveDays("Assets")).toEqual([["Bob Builder", null, daysSince("2026-09-01")]]);
    });

    // The age buckets of the Inactivity interval move as the days pass, so only the stored last activity and
    // the (none) member of the product never used are asserted.
    test("stores the last activity of every product access for the Inactivity interval", () => {
      var rows = dwh.dimensions.product_accesses.rows({columns: ["access_key", "last_active_ts"]});

      expect(rows).toHaveLength(6);
      expect(rows).toContainEqual({access_key: "acc-bob|site/site-acme|jira-software",
        last_active_ts: Date.parse("2026-09-01T08:00:00Z") / 1000});
      expect(rows).toContainEqual({access_key: "acc-bob|site/site-acme|assets", last_active_ts: null});
      expect(olap.results(`
        SELECT [Measures].[Product users] ON COLUMNS, [Inactivity interval].[(none)] ON ROWS
        FROM [Atlassian Admin]
      `)).toEqual([["(none)", 1]]);
    });

    test("reports the import progress", () => {
      expect(importRun.statusMessages()).toContain("Importing users (4 imported)");
      expect(importRun.objectFailures()).toEqual([]);
    });
  });

  // The organization without the user: neither the directory search nor the v1 users answer it.
  function removeUserFromOrganization(accountId) {
    var directoryUsers = mock.fixture("directory_users");
    directoryUsers.data = directoryUsers.data.filter((user) => user.accountId !== accountId);
    mock.post(SEARCH_PATH, {json: directoryUsers,
      requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100}'});
    var pages = [mock.fixture("org_users_page1"), mock.fixture("org_users_page2")];
    pages.forEach((page) => {
      page.data = page.data.filter((user) => user.account_id !== accountId);
    });
    mock.get("/admin/v1/orgs/org-1/users", {json: pages[0]});
    mock.get("/admin/v1/orgs/org-1/users", {json: pages[1], params: {cursor: "USERSCURSOR2"}});
  }

  function storedGenerations() {
    var tables = app.importers.sweep.factScopes().map((scope) => scope.table).
      concat(app.importers.sweep.dimensionTables());
    return _.uniq(_.flatten(tables.map((table) =>
      table.rows({columns: ["generation"]}).map((row) => row.generation))));
  }

  function storedAccountIds() {
    return {
      members: dwh.dimensions.users.rows({columns: ["account_id"]}).map((row) => row.account_id),
      users: dwh.measures.users.rows({columns: ["_source_id"]}).map((row) => row._source_id),
      productAccess: _.uniq(dwh.measures.product_access.rows({columns: ["_source_id"]}).
        map((row) => row._source_id)),
      productAccessMembers: _.uniq(dwh.dimensions.product_accesses.rows({columns: ["access_key"]}).
        map((row) => row.access_key.split("|")[0]))
    };
  }

  function expectStoredUser(accountId, stored) {
    var accountIds = storedAccountIds();
    Object.keys(accountIds).forEach((key) => {
      if (stored) expect(accountIds[key]).toContain(accountId);
      else expect(accountIds[key]).not.toContain(accountId);
    });
  }

  describe("of what the organization no longer has", () => {
    beforeEach(mockOrganization);

    test("removes a user removed from the organization with the next import", () => {
      importRun.run();
      expectStoredUser("acc-bob", true);
      expect(storedGenerations()).toEqual([1]);
      expect(importRun.maxParams().generation).toBe(1);

      mock.maxParams(importRun.maxParams());
      removeUserFromOrganization("acc-bob");
      importRun.run();

      expectStoredUser("acc-bob", false);
      expectStoredUser("acc-alice", true);
      expect(storedGenerations()).toEqual([2]);
      expect(importRun.maxParams().generation).toBe(2);
    });

    test("removes the licenses and product access of a product taken out of the selection", () => {
      importRun.run();

      mock.maxParams(importRun.maxParams());
      mock.sourceSelection(["site/site-acme"]);
      importRun.run();

      expect(dwh.measures.licenses.rows({columns: ["_source_id"]}).map((row) => row._source_id).sort()).
        toEqual(["beacon/site/site-acme", "cmdb/site/site-acme", "confluence/site/site-acme",
          "jira-software/site/site-acme"]);
      expect(dwh.measures.product_access.rows({columns: ["_source_id"]}).
        filter((row) => row._source_id === "acc-alice")).toHaveLength(2);
      expect(dwh.dimensions.sites.rows({columns: ["name"]}).map((row) => row.name)).
        not.toContain("beta.atlassian.net");
    });

    test("removes nothing while a user fails to import, and catches up with the next import", () => {
      importRun.run();

      mock.maxParams(importRun.maxParams());
      removeUserFromOrganization("acc-bob");
      var buildRows = app.importers.users.buildRows;
      var failingCarol = mock.spyOn(app.importers.users, "buildRows").mockImplementation((user, shared) => {
        if (user.accountId === "acc-carol") throw new Error("unexpected");
        return buildRows.call(app.importers.users, user, shared);
      });
      importRun.run();

      expect(importRun.objectFailures()).toEqual(["user/acc-carol"]);
      expectStoredUser("acc-bob", true);
      expect(importRun.maxParams().generation).toBe(1);

      failingCarol.mockRestore();
      importRun.run();

      expectStoredUser("acc-bob", false);
      // Carol has no product access, only her user row.
      expect(storedAccountIds().users).toContain("acc-carol");
      expect(storedGenerations()).toEqual([2]);
    });

    // A full reimport clears the stored generation.
    test("tells the generation of the stored rows without a stored generation", () => {
      importRun.run();

      removeUserFromOrganization("acc-bob");
      importRun.run();

      expectStoredUser("acc-bob", false);
      expect(storedGenerations()).toEqual([2]);
    });
  });

  describe("with other products selected", () => {
    beforeEach(mockOrganization);

    test("imports no licenses row and no product access of the deselected products", () => {
      mock.sourceSelection(["site/site-acme"]);

      importRun.run();

      var licenseSourceIds = dwh.measures.licenses.rows({columns: ["_source_id"]}).
        map((row) => row._source_id);
      expect(licenseSourceIds.sort()).toEqual(["beacon/site/site-acme", "cmdb/site/site-acme",
        "confluence/site/site-acme", "jira-software/site/site-acme"]);
      // Alice keeps her acme Jira and Assets accesses, the beta Jira and Trello accesses are skipped.
      expect(dwh.measures.product_access.rows({columns: ["_source_id"]}).
        filter((row) => row._source_id === "acc-alice")).toHaveLength(2);
    });

    test("finds the product admins of the deselected products", () => {
      mock.sourceSelection(["trello/workspace/ws-trello"]);

      importRun.run();

      expect(dwh.dimensions.users.lookupId({account_id: "acc-bob"})).not.toBeNull();
      var bob = _.findWhere(dwh.dimensions.users.rows({columns: ["account_id", "admin_role"]}),
        {account_id: "acc-bob"});
      expect(bob.admin_role).toBe("Product admin");
    });

    test("imports every product with Select all", () => {
      mock.sourceSelection(["(all)"]);

      importRun.run();

      expect(dwh.measures.licenses.rows()).toHaveLength(8);
      expect(dwh.measures.product_access.rows({columns: ["_source_id"]}).
        filter((row) => row._source_id === "acc-alice")).toHaveLength(5);
    });
  });

  // The v1 list alone would import the users without their admin roles and groups.
  describe("when the directory users cannot be read", () => {
    beforeEach(() => {
      mockOrganization();
      importRun.run();
      mock.maxParams(importRun.maxParams());
      mock.post(SEARCH_PATH, {status: 403, json: {message: "Forbidden"},
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100}'});
    });

    test("fails the import and keeps the admin roles and groups of the previous import", () => {
      expect(() => importRun.run()).toThrow(/The users of the directory .* could not be read/);
      expect(_.findWhere(dwh.dimensions.users.rows({columns: ["account_id", "admin_role"]}),
        {account_id: "acc-alice"}).admin_role).toBe("Org admin");
      expect(_.pluck(dwh.dimensions.groups.rows({columns: ["name"], orderBy: "name"}), "name")).
        toEqual(["developers", "org-admins"]);
    });
  });

  describe("when the users of a directory page cannot be written", () => {
    test("fails the import with the error of the write", () => {
      mockOrganization();
      mock.spyOn(app.importers.users, "importBatch").mockImplementationOnce(() => {
        throw new Error("write failed");
      });

      expect(() => importRun.run()).toThrow(/^write failed$/);
    });
  });

  // The user profile fields selected on the Custom fields tab become User properties and dimensions.
  describe("with selected user profile fields", () => {
    beforeAll(() => {
      mockOrganization();
      mock.customFields({
        department: {property: true, dimension: true},
        mfa_enabled: {property: true, dimension: true},
        added_to_org: {property: true}
      });

      importRun.run();
    });

    test("declares the selected fields in the schema", () => {
      var properties = schema.dimension("User").level("User").properties();
      expect(properties).toContain("Department");
      expect(properties).toContain("Two-step verification");
      expect(properties).toContain("Added to org");
      expect(schema.dimensions()).toContain("Department");
      expect(schema.dimensions()).toContain("Two-step verification");
      expect(schema.calculatedMembers()).toContain("[Measures].[User department]");
      expect(schema.calculatedMembers()).toContain("[Measures].[User added to org]");
    });

    test("shows the selected fields as property measures", () => {
      var results = olap.results(`
        SELECT [User].[User].Members ON ROWS,
               {[Measures].[User department], [Measures].[User two-step verification]} ON COLUMNS
        FROM [Atlassian Admin]
      `);

      expect(results).toContainEqual(["Alice Admin", "Support", "Yes"]);
      expect(results).toContainEqual(["Bob Builder", "Development", "No"]);
    });

    test("imports the profile values of the directory users", () => {
      expect(dwh.dimensions.users.rows({
        columns: ["account_id", "cf_department", "cf_mfa_enabled"], orderBy: "account_id"
      })).toEqual([
        {account_id: "acc-alice", cf_department: "Support", cf_mfa_enabled: "Yes"},
        {account_id: "acc-bob", cf_department: "Development", cf_mfa_enabled: "No"},
        {account_id: "acc-carol", cf_department: null, cf_mfa_enabled: null},
        {account_id: "acc-dave", cf_department: null, cf_mfa_enabled: null}
      ]);
      var aliceAddedToOrg = dwh.dimensions.users.rows({
        columns: ["cf_added_to_org"], orderBy: "account_id"
      })[0].cf_added_to_org;
      expect(aliceAddedToOrg.substring(0, 19)).toBe("2024-02-01T10:00:00");
    });

    test("aggregates the users and their product access by the selected dimensions", () => {
      var usersByDepartment = olap.results(`
        SELECT [Department].[Department].Members ON ROWS, [Measures].[Users] ON COLUMNS
        FROM [Atlassian Admin]
      `);
      expect(usersByDepartment).toContainEqual(["Support", 1]);
      expect(usersByDepartment).toContainEqual(["Development", 1]);

      expect(olap.results(`
        SELECT [Department].[Department].Members ON ROWS, [Measures].[Product users] ON COLUMNS
        FROM [Atlassian Admin]
      `)).toContainEqual(["Support", 4]);
    });
  });

  // The v1 users endpoint answers only the managed accounts, which can be none: the users then come from the
  // directory search alone.
  describe("of an organization without v1 users", () => {
    beforeEach(() => {
      mockOrganization();
      mock.get("/admin/v1/orgs/org-1/users", {fixture: "org_users_empty"});
    });

    test("imports the directory users", () => {
      importRun.run();

      expect(dwh.dimensions.users.rows({
        columns: ["account_id", "admin_role", "status"], orderBy: "account_id"
      })).toEqual([
        {account_id: "acc-alice", admin_role: "Org admin", status: "Active"},
        {account_id: "acc-bob", admin_role: "Product admin", status: "Active"},
        {account_id: "acc-carol", admin_role: "No admin role", status: "Deactivated"}
      ]);
      // Alice's product accesses come from the directory search, Bob's from the users with access to the
      // acme Jira and Assets.
      expect(dwh.measures.product_access.rows({columns: ["_source_id"]}).map((row) => row._source_id).sort()).
        toEqual(["acc-alice", "acc-alice", "acc-alice", "acc-alice", "acc-bob", "acc-bob"]);
      expect(importRun.warnings()).toEqual([]);
    });
  });

  // Without the product roles, the licensed users come from one search of the user and the admin roles.
  describe("without the product roles", () => {
    beforeAll(() => {
      mockOrganization();
      mock.extraOptions({time_dimension_time_zone: "UTC"});

      importRun.run();
    });

    test("counts the users holding a license of the product", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Product].[Product].Members ON ROWS,
               {[Measures].[Product users], [Measures].[Licensed users]} ON COLUMNS
        FROM [Atlassian Admin]
      `)).toEqual([["Assets", 2, null], ["Jira", 3, 2], ["Trello", 1, null]]);
    });

    test("imports no product roles", () => {
      expect(dwh.dimensions.product_roles.rows()).toEqual([]);
      expect(dwh.dimensions.users.rows({columns: ["admin_role"]}).map((row) => row.admin_role).sort()).
        toEqual(["No admin role", "No admin role", "No admin role", "Org admin"]);
    });
  });

  describe("with a user active today", () => {
    beforeAll(() => {
      mockOrganization();
      var directoryUsers = mock.fixture("directory_users");
      directoryUsers.data[0].productAccess[0].lastActiveTimestamp = new Date().toISOString();
      mock.post(SEARCH_PATH, {json: directoryUsers,
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100}'});

      importRun.run();
    });

    test("counts the users active in the last 30 days", () => {
      expect(olap.results(`
        SELECT [Measures].[Users active in last 30 days] ON COLUMNS,
               {[User].[User].[Alice Admin], [User].[User].[Bob Builder], [User].DefaultMember} ON ROWS
        FROM [Atlassian Admin]
      `)).toEqual([["Alice Admin", 1], ["Bob Builder", null], ["All Users", 1]]);
    });
  });

  // Alice no longer has access to the acme Assets: Atlassian keeps her activity in it, but the access search
  // of the Assets finds only Bob.
  describe("with the activity of a removed product access", () => {
    beforeAll(() => {
      mockOrganization();
      mock.post(SEARCH_PATH, {fixture: "product_users_acme_assets",
        requestBody: productUsersSearchBody(ACME_ASSETS_ARIS)});

      importRun.run();
    });

    test("leaves out the access", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Product].[Product].Members ON ROWS,
               {[Measures].[Product users]} ON COLUMNS
        FROM [Atlassian Admin]
        WHERE [User].[User].[Alice Admin]
      `)).toEqual([["Jira", 2], ["Trello", 1]]);
      expect(olap.results(`
        SELECT [Measures].[Product users] ON COLUMNS, [Product].[Product].[Assets] ON ROWS
        FROM [Atlassian Admin]
      `)).toEqual([["Assets", 1]]);
    });
  });

  // The organization has a Studio workspace too, which Alice has access to. The directory user search answers
  // none of her activity in it, which only her last active dates do.
  describe("with the activity of a Studio workspace", () => {
    var STUDIO_ARIS = ["ari:cloud:studio::workspace/ws-studio"];
    var LAST_ACTIVE_DATES_PATH = "/admin/v1/orgs/org-1/directory/users/acc-alice/last-active-dates";

    function productLastActive(accountId, productName) {
      var product = _.findWhere(dwh.dimensions.products.rows({columns: ["id", "name"]}), {name: productName});
      var row = _.find(dwh.measures.product_access.rows({
        columns: ["_source_id", "product_id", "product_last_active_ts"]
      }), (candidate) => candidate._source_id === accountId && candidate.product_id === product.id);
      return row && row.product_last_active_ts;
    }

    beforeEach(() => {
      mockOrganization();
      mock.sourceSelection(["site/site-acme", "jira-software/site/site-beta", "trello/workspace/ws-trello",
        "studio/workspace/ws-studio"]);
      var workspaces = mock.fixture("workspaces_page2");
      workspaces.data.push({id: STUDIO_ARIS[0], type: "workspaces",
        attributes: {name: "Studio", typeKey: "studio", type: "Studio", status: "online", realm: "us"},
        relationships: {entitlement: [{id: "ent-studio", type: "entitlements",
          attributes: {key: "studio", planKey: "free", plan: "Free"}}]}});
      mock.post("/admin/v2/orgs/org-1/workspaces", {json: workspaces, requestBody: '{"cursor":"WSCURSOR2"}'});
      mock.post(SEARCH_PATH, {fixture: "role_admins_empty", requestBody: roleSearchBody(STUDIO_ARIS, LICENSED_ROLE_IDS)});
      ROLE_IDS.forEach((roleId) => {
        mock.post(SEARCH_PATH, {fixture: "role_admins_empty", requestBody: roleSearchBody(STUDIO_ARIS, [roleId])});
      });
      mock.post(SEARCH_PATH, {json: {data: [{accountId: "acc-alice", accountStatus: "active"}], links: {}},
        requestBody: productUsersSearchBody(STUDIO_ARIS)});
      // The Jira activity is answered by the directory user search, and stays as it answers it.
      mock.get(LAST_ACTIVE_DATES_PATH, {json: {data: {product_access: [
        {id: STUDIO_ARIS[0], key: "studio", last_active: "2026-09-20",
          last_active_timestamp: "2026-09-20T10:00:00Z"},
        {id: "ari:cloud:jira-software::site/site-acme", key: "jira-software", last_active: "2026-10-01",
          last_active_timestamp: "2026-10-01T10:00:00Z"}
      ]}, links: {next: null}}});
    });

    test("reads the last active dates of the Studio users", () => {
      importRun.run();

      expect(productLastActive("acc-alice", "Studio")).toBe(Date.parse("2026-09-20T10:00:00Z") / 1000);
      expect(productLastActive("acc-alice", "Jira")).toBe(Date.parse("2026-09-10T12:00:00Z") / 1000);
      expect(importRun.objectFailures()).toEqual([]);
    });

    test("keeps the stored rows of a user whose last active dates cannot be read", () => {
      importRun.run();
      mock.maxParams(importRun.maxParams());
      mock.get(LAST_ACTIVE_DATES_PATH, {status: 400, json: {message: "Bad request"}});

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["user/acc-alice"]);
      expect(productLastActive("acc-alice", "Studio")).toBe(Date.parse("2026-09-20T10:00:00Z") / 1000);
    });
  });

  // Bob holds the user role of the acme Confluence and never used it.
  describe("with a license that is never used", () => {
    beforeAll(() => {
      mockOrganization();
      mock.post(SEARCH_PATH, {fixture: "product_users_acme_assets",
        requestBody: roleSearchBody(ACME_CONFLUENCE_ARIS, ["atlassian/user"])});
      mock.post(SEARCH_PATH, {fixture: "product_users_acme_assets",
        requestBody: productUsersSearchBody(ACME_CONFLUENCE_ARIS)});

      importRun.run();
    });

    test("counts it as an unused license", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Product].[Product].Members ON ROWS,
               {[Measures].[Licensed users], [Measures].[Unused licenses]} ON COLUMNS
        FROM [Atlassian Admin]
      `)).toEqual([["Confluence", 1, 1], ["Jira", 2, null]]);
    });
  });

  // The acme site has Goals too, which nobody has an activity in, and Jira Service Management, which Alice
  // used as an agent and Bob holds the customer role of. Bob also never used the Assets, which Alice did.
  describe("with products and users of no tracked activity", () => {
    var GOALS_ARIS = ["ari:cloud:goal::site/site-acme"];
    var SERVICE_DESK_ARIS = ["ari:cloud:jira-servicedesk::site/site-acme"];

    function acmeWorkspace(typeKey, type) {
      return {id: `ari:cloud:${typeKey}::site/site-acme`, type: "workspaces",
        attributes: {name: "acme", typeKey: typeKey, type: type, status: "online",
          hostUrl: "https://acme.atlassian.net", realm: "us"},
        relationships: {entitlement: [{id: `ent-acme-${typeKey}`, type: "entitlements",
          attributes: {key: `${typeKey}.ondemand`, planKey: "free", plan: "Free"}}]}};
    }

    function accountsJson(accountIds) {
      return {json: {data: accountIds.map((accountId) => ({accountId: accountId, accountStatus: "active"})),
        links: {}}};
    }

    beforeAll(() => {
      mockOrganization();
      var workspaces = mock.fixture("workspaces_page2");
      workspaces.data.push(acmeWorkspace("goal", "Goals"),
        acmeWorkspace("jira-servicedesk", "Jira Service Desk"));
      mock.post("/admin/v2/orgs/org-1/workspaces",
        {json: workspaces, requestBody: '{"cursor":"WSCURSOR2"}'});
      [GOALS_ARIS, SERVICE_DESK_ARIS].forEach((aris) => {
        mock.post(SEARCH_PATH,
          {fixture: "role_admins_empty", requestBody: roleSearchBody(aris, LICENSED_ROLE_IDS)});
        ROLE_IDS.forEach((roleId) => {
          mock.post(SEARCH_PATH,
            {fixture: "role_admins_empty", requestBody: roleSearchBody(aris, [roleId])});
        });
      });
      mock.post(SEARCH_PATH, Object.assign(accountsJson(["acc-bob"]),
        {requestBody: productUsersSearchBody(GOALS_ARIS)}));
      mock.post(SEARCH_PATH, Object.assign(accountsJson(["acc-bob"]),
        {requestBody: roleSearchBody(GOALS_ARIS, ["atlassian/user"])}));
      mock.post(SEARCH_PATH, Object.assign(accountsJson(["acc-alice", "acc-bob"]),
        {requestBody: productUsersSearchBody(SERVICE_DESK_ARIS)}));
      mock.post(SEARCH_PATH, Object.assign(accountsJson(["acc-alice"]),
        {requestBody: roleSearchBody(SERVICE_DESK_ARIS, ["atlassian/user"])}));
      mock.post(SEARCH_PATH, Object.assign(accountsJson(["acc-bob"]),
        {requestBody: roleSearchBody(SERVICE_DESK_ARIS, ["atlassian/customer"])}));
      var directoryUsers = mock.fixture("directory_users");
      directoryUsers.data[0].productAccess.push({key: "jira-servicedesk", id: SERVICE_DESK_ARIS[0],
        lastActiveTimestamp: "2026-09-12T09:00:00Z"});
      mock.post(SEARCH_PATH, {json: directoryUsers,
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100}'});

      importRun.run();
    });

    test("tells the product access of no tracked activity from the one never used", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Activity Tracking].[Activity Tracking].Members ON COLUMNS,
               NON EMPTY [Product].[Product].Members ON ROWS
        FROM [Atlassian Admin]
        WHERE [Measures].[Product users]
      `)).toEqual([
        ["Assets", 2, null],
        ["Goals", null, 1],
        ["Jira", 3, null],
        ["Jira Service Management", 1, 1],
        ["Trello", 1, null]
      ]);
    });

    test("leaves the access of no tracked activity out of the never used ones", () => {
      expect(olap.results(`
        SELECT {[Activity Tracking].DefaultMember, [Activity Tracking].[Tracked]} ON COLUMNS,
               [Inactivity interval].[(none)] ON ROWS
        FROM [Atlassian Admin]
        WHERE [Measures].[Product users]
      `)).toEqual([["(none)", 3, 1]]);
    });
  });

  // A search that fails, also after the retries of eazyBI, would import the users without the product access
  // and the roles it did not find.
  describe("when a product search fails", () => {
    beforeEach(() => {
      mockOrganization();
      importRun.run();
      mock.maxParams(importRun.maxParams());
    });

    function bobAccessCount() {
      return dwh.measures.product_access.rows({columns: ["_source_id"]}).
        filter((row) => row._source_id === "acc-bob").length;
    }

    test("fails the import and keeps the product access of the previous import", () => {
      mock.post(SEARCH_PATH, {status: 400, json: {message: "Bad request"},
        requestBody: productUsersSearchBody(ACME_ASSETS_ARIS)});

      expect(() => importRun.run()).toThrow(/The users with access to the products could not be read/);
      // Bob's never used Assets access is found only by the failed search.
      expect(bobAccessCount()).toBe(2);
    });

    test("fails the import and keeps the product admins of the previous import", () => {
      mock.post(SEARCH_PATH, {status: 400, json: {message: "Bad request"},
        requestBody: roleSearchBody(ACME_JIRA_ARIS, ["atlassian/admin"])});

      expect(() => importRun.run()).toThrow(/The Admin role holders of the products could not be read/);
      expect(_.findWhere(dwh.dimensions.users.rows({columns: ["account_id", "admin_role"]}),
        {account_id: "acc-bob"}).admin_role).toBe("Product admin");
    });

    test("fails the import when the licensed users cannot be read", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      mock.post(SEARCH_PATH, {status: 400, json: {message: "Bad request"},
        requestBody: roleSearchBody(ACME_JIRA_ARIS, LICENSED_ROLE_IDS)});

      expect(() => importRun.run()).toThrow(/The licensed users of the products could not be read/);
      expect(bobAccessCount()).toBe(2);
    });
  });

  describe("with no products selected", () => {
    test("fails the import with a message naming the selection", () => {
      mock.sourceParams({org_id: "org-1", api_key: "secret-key"});
      mock.sourceSelection([]);

      expect(() => importRun.run()).toThrow(/No Atlassian products selected/);
    });
  });
});
