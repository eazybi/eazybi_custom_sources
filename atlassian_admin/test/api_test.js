describe("app.api", () => {
  beforeEach(() => {
    mock.sourceParams({org_id: "org-1", api_key: "secret-key"});
  });

  describe("testConnection", () => {
    test("returns the organization name of a working connection", () => {
      mock.get("/admin/v1/orgs/org-1", {fixture: "organization"});

      expect(app.api.testConnection()).toEqual({authentication: {organization: "Acme Org"}});
    });

    test("reports an error on the API key field when the organization is not answered", () => {
      mock.get("/admin/v1/orgs/org-1", {status: 401, json: {message: "Unauthorized"}});

      var result = app.api.testConnection();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("api_key");
    });
  });

  describe("getWorkspaces", () => {
    beforeEach(() => {
      mock.post("/admin/v2/orgs/org-1/workspaces", {fixture: "workspaces_page1", requestBody: '{"limit":250}'});
      mock.post("/admin/v2/orgs/org-1/workspaces",
        {fixture: "workspaces_page2", requestBody: '{"cursor":"WSCURSOR2"}'});
    });

    test("follows the cursor of the links.next URL through all pages", () => {
      var workspaces = app.api.getWorkspaces();

      expect(workspaces).toHaveLength(9);
      expect(workspaces[0].id).toBe("ari:cloud:jira-software::site/site-acme");
      expect(workspaces[8].id).toBe("ari:cloud:bitbucket::workspace/ws-bitbucket");
    });

    test("groups the workspaces into sites by the cloud id of their ARI", () => {
      var catalog = app.api.workspaceCatalog(app.api.getWorkspaces());

      expect(catalog.sites.map((site) => site.name)).toEqual(["acme.atlassian.net", "beta.atlassian.net",
        "gamma.atlassian.net", "Acme Trello", "bitbucket.org/acme-dev"]);
      // Guard Detect is served from another host but belongs to the acme site, and the platform "jira"
      // workspace is the same Jira product as "jira-software".
      var acme = catalog.sitesByCloudId["site-acme"];
      expect(acme.workspaces.map((workspace) => workspace.productName)).
        toEqual(["Assets", "Confluence", "Guard Detect", "Jira"]);
      expect(acme.byProduct["jira-software"].planKey).toBe("free");
      expect(acme.byProduct["jira-software"].aris).toEqual(
        ["ari:cloud:jira-software::site/site-acme", "ari:cloud:jira::site/site-acme"]);
      expect(catalog.byAri["ari:cloud:jira::site/site-acme"].key).toBe("jira-software/site/site-acme");
      expect(catalog.sitesByUrl["bitbucket.org/acme-dev"].workspaces[0].capacity).toBe(5);
      expect(catalog.sitesByUrl["detect.atlassian.com/w/acme-beacon"]).toBe(acme);
      expect(catalog.standaloneByProduct.trello).toHaveLength(1);
    });

    test("names a site by its own host and leaves out a URL that several sites share", () => {
      var siteWorkspace = (typeKey, cloudId, hostUrl) =>
        ({id: `ari:cloud:${typeKey}::site/${cloudId}`, attributes: {typeKey: typeKey, hostUrl: hostUrl}});
      var catalog = app.api.workspaceCatalog([
        siteWorkspace("beacon", "site-one", "https://detect.atlassian.com"),
        siteWorkspace("confluence", "site-one", "https://one.atlassian.net/wiki"),
        siteWorkspace("beacon", "site-two", "https://detect.atlassian.com"),
        siteWorkspace("jira-software", "site-two", "https://two.atlassian.net")
      ]);

      expect(catalog.sites.map((site) => site.name)).toEqual(["one.atlassian.net", "two.atlassian.net"]);
      expect(catalog.sitesByUrl["detect.atlassian.com"]).toBeUndefined();
      expect(catalog.sitesByUrl["one.atlassian.net/wiki"].key).toBe("site/site-one");
    });

    test("leaves out a host that names several sites", () => {
      var catalog = app.api.workspaceCatalog(["site-one", "site-two"].map((cloudId) =>
        ({id: `ari:cloud:beacon::site/${cloudId}`, attributes: {typeKey: "beacon", hostUrl: "https://detect.atlassian.com"}})));

      expect(catalog.sites.map((site) => site.name)).toEqual(["detect.atlassian.com", "detect.atlassian.com"]);
      expect(catalog.sitesByHost["detect.atlassian.com"]).toBeNull();
    });

    test("tells apart the products without a site of the same name by the start of their id", () => {
      var studio = (id) => ({id: `ari:cloud:studio::workspace/${id}`, attributes: {name: "Studio", typeKey: "studio"}});
      var catalog = app.api.workspaceCatalog([studio("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"),
        studio("9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a")]);

      expect(catalog.sites.map((site) => site.name)).toEqual(["Studio (1a2b3c4d)", "Studio (9f8e7d6c)"]);
      expect(app.api.workspaceCatalog([studio("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")]).sites[0].name).
        toBe("Studio");
    });

    test("tells apart the products whose ids start alike by a longer start of their id", () => {
      var trello = (id) => ({id: `ari:cloud:trello::workspace/${id}`, attributes: {name: "Acme", typeKey: "trello"}});
      var catalog = app.api.workspaceCatalog([trello("5f1a2b3c4d"), trello("5f1a2b3c9e"), trello("5f1a2b3c")]);

      expect(catalog.sites.map((site) => site.name).sort()).
        toEqual(["Acme (5f1a2b3c)", "Acme (5f1a2b3c4)", "Acme (5f1a2b3c9)"]);
    });

    test("ends the id start of a product without a site after a separator", () => {
      var trello = (id) => ({id: `ari:cloud:trello::workspace/${id}`, attributes: {name: "Acme", typeKey: "trello"}});
      var catalog = app.api.workspaceCatalog([trello("ws-trello"), trello("ws-trello-2")]);

      expect(catalog.sites.map((site) => site.name).sort()).toEqual(["Acme (ws-trello)", "Acme (ws-trello-2)"]);
    });

    test("leaves the names of the products without a site whose ids are the same", () => {
      var workspace = (typeKey) => ({id: `ari:cloud:${typeKey}::workspace/ws-1`, attributes: {name: "Acme", typeKey: typeKey}});
      var catalog = app.api.workspaceCatalog([workspace("trello"), workspace("compass")]);

      expect(catalog.sites.map((site) => site.name)).toEqual(["Acme", "Acme"]);
    });

    test("tells apart the product whose id differs from the ones that share an id", () => {
      var workspace = (typeKey, id) =>
        ({id: `ari:cloud:${typeKey}::workspace/${id}`, attributes: {name: "Acme", typeKey: typeKey}});
      var catalog = app.api.workspaceCatalog([workspace("goal", "ws-1"), workspace("project", "ws-1"),
        workspace("trello", "5f1a2b3c4d")]);

      expect(catalog.sites.map((site) => site.name).sort()).toEqual(["Acme", "Acme", "Acme (5f1a2b3c)"]);
    });

    test("offers a product without a site of the same name by its name alone", () => {
      mock.post("/admin/v2/orgs/org-1/workspaces", {requestBody: '{"limit":250}', json: {data: [
        {id: "ari:cloud:studio::workspace/1a2b3c4d-5e6f", attributes: {name: "Studio", typeKey: "studio"}},
        {id: "ari:cloud:studio::workspace/9f8e7d6c-5b4a", attributes: {name: "Studio", typeKey: "studio"}}
      ]}});

      expect(app.api.getSourceSelections().options).toEqual([
        {key: "studio/workspace/1a2b3c4d-5e6f", name: "Studio (1a2b3c4d)"},
        {key: "studio/workspace/9f8e7d6c-5b4a", name: "Studio (9f8e7d6c)"}
      ]);
    });

    test("offers every site and every product workspace", () => {
      var selections = app.api.getSourceSelections();

      expect(selections.multiple).toBe(true);
      expect(selections.options).toEqual([
        {key: "site/site-acme", name: "acme.atlassian.net (all products)"},
        {key: "cmdb/site/site-acme", name: "Assets — acme.atlassian.net"},
        {key: "confluence/site/site-acme", name: "Confluence — acme.atlassian.net"},
        {key: "beacon/site/site-acme", name: "Guard Detect — acme.atlassian.net"},
        {key: "jira-software/site/site-acme", name: "Jira — acme.atlassian.net"},
        {key: "site/site-beta", name: "beta.atlassian.net (all products)"},
        {key: "jira-software/site/site-beta", name: "Jira — beta.atlassian.net"},
        {key: "site/site-gamma", name: "gamma.atlassian.net (all products)"},
        {key: "jira-software/site/site-gamma", name: "Jira — gamma.atlassian.net"},
        {key: "trello/workspace/ws-trello", name: "Trello — Acme Trello"},
        {key: "bitbucket/workspace/ws-bitbucket", name: "Bitbucket — bitbucket.org/acme-dev"}
      ]);
    });
  });

  describe("getDirectories", () => {
    test("returns the directories of the organization", () => {
      mock.get("/admin/v2/orgs/org-1/directories", {fixture: "directories"});

      expect(app.api.getDirectories()).toEqual([{directoryId: "dir-1", name: "Managed accounts"}]);
    });
  });

  describe("eachDirectoryUsersPage", () => {
    test("searches with the platform roles and groups expanded and follows the cursor", () => {
      var searchPath = "/admin/v2/orgs/org-1/directories/dir-1/users/search";
      mock.post(searchPath, {
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100}',
        json: {data: [{accountId: "acc-1"}],
          links: {next: `https://api.atlassian.com${searchPath}?cursor=C2`}}
      });
      mock.post(searchPath, {
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100,"cursor":"C2"}',
        json: {data: [{accountId: "acc-2"}], links: {}}
      });

      var accountIds = [];
      app.api.eachDirectoryUsersPage("dir-1", (users) => {
        users.forEach((user) => accountIds.push(user.accountId));
      });

      expect(accountIds).toEqual(["acc-1", "acc-2"]);
    });

    test("follows a links.next that is the cursor itself", () => {
      var searchPath = "/admin/v2/orgs/org-1/directories/dir-1/users/search";
      mock.post(searchPath, {
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100}',
        json: {data: [{accountId: "acc-1"}], links: {self: "ObSbZxpM1f1fzia2_GnuJw", next: "kloHX1ZQ+Va/w=="}}
      });
      mock.post(searchPath, {
        requestBody: '{"expand":["platformRoles","groups","productAccess"],"limit":100,' +
          '"cursor":"kloHX1ZQ+Va/w=="}',
        json: {data: [{accountId: "acc-2"}], links: {self: "kloHX1ZQ+Va/w=="}}
      });

      var accountIds = [];
      app.api.eachDirectoryUsersPage("dir-1", (users) => {
        users.forEach((user) => accountIds.push(user.accountId));
      });

      expect(accountIds).toEqual(["acc-1", "acc-2"]);
    });
  });

  describe("nextCursor", () => {
    test("answers no cursor for a links.next URL without one", () => {
      expect(app.api.nextCursor({links: {next: "https://api.atlassian.com/admin/v2/orgs/org-1/workspaces"}})).
        toBeNull();
      expect(app.api.nextCursor({links: {}})).toBeNull();
    });

    test("answers a token that starts with a slash as the cursor", () => {
      expect(app.api.nextCursor({links: {next: "/w=="}})).toBe("/w==");
    });
  });

  describe("getRoleAccountIds", () => {
    test("searches the users with any of the roles under all ARIs of the workspace at once", () => {
      mock.post("/admin/v2/orgs/org-1/directories/dir-1/users/search", {
        requestBody: '{"roleIds":["atlassian/user","atlassian/admin"],' +
          '"resourceIds":["ari:cloud:jira-software::site/site-acme","ari:cloud:jira::site/site-acme"],' +
          '"limit":100}',
        fixture: "role_admins_acme_jira"
      });

      var accountIds = app.api.getRoleAccountIds("dir-1",
        ["ari:cloud:jira-software::site/site-acme", "ari:cloud:jira::site/site-acme"],
        ["atlassian/user", "atlassian/admin"]);

      expect(accountIds).toEqual(["acc-bob"]);
    });
  });

  describe("getWorkspaceAccountIds", () => {
    test("returns the account ids of the users with access to the workspace", () => {
      mock.post("/admin/v2/orgs/org-1/directories/dir-1/users/search", {
        requestBody: '{"resourceIds":["ari:cloud:cmdb::site/site-acme"],"limit":100}',
        fixture: "product_users_acme_assets"
      });

      expect(app.api.getWorkspaceAccountIds("dir-1", ["ari:cloud:cmdb::site/site-acme"])).toEqual(["acc-bob"]);
    });
  });

  describe("getUsersLastActiveDates", () => {
    var STUDIO_ARI = "ari:cloud:studio::workspace/ws-studio";
    var JIRA_ARI = "ari:cloud:jira-software::site/site-acme";

    function lastActiveDatesPath(encodedAccountId) {
      return `/admin/v1/orgs/org-1/directory/users/${encodedAccountId}/last-active-dates`;
    }

    function lastActiveDates(ari, next) {
      return {json: {data: {product_access: [{id: ari, key: "studio", last_active: "2026-09-20"}]},
        links: {next: next || null}}};
    }

    test("reads the users by their escaped account ids and follows the next pages of a user", () => {
      mock.get(lastActiveDatesPath("acc-1"), lastActiveDates(STUDIO_ARI, "C2"));
      mock.get(lastActiveDatesPath("acc-1"), _.extend({params: {cursor: "C2"}}, lastActiveDates(JIRA_ARI)));
      mock.get(lastActiveDatesPath("557058%3Aacc-2"), lastActiveDates(STUDIO_ARI));

      var result = app.api.getUsersLastActiveDates(["acc-1", "557058:acc-2"]);

      expect(_.mapObject(result.byAccountId, (accesses) => _.pluck(accesses, "id"))).toEqual({
        "acc-1": [STUDIO_ARI, JIRA_ARI],
        "557058:acc-2": [STUDIO_ARI]
      });
      expect(result.errors).toEqual({});
    });

    test("reads the users one by one after a failed request and reports only the failing user", () => {
      mock.get(lastActiveDatesPath("acc-1"), lastActiveDates(STUDIO_ARI));
      mock.get(lastActiveDatesPath("acc-2"), {status: 400, json: {message: "Bad request"}});
      mock.get(lastActiveDatesPath("acc-3"), lastActiveDates(STUDIO_ARI));
      var warn = mock.spyOn(logger, "warn");

      var result = app.api.getUsersLastActiveDates(["acc-1", "acc-2", "acc-3"]);

      expect(Object.keys(result.byAccountId).sort()).toEqual(["acc-1", "acc-3"]);
      expect(Object.keys(result.errors)).toEqual(["acc-2"]);
      expect(warn.mock.calls.length).toBe(1);
      expect(warn.mock.calls[0][0]).toMatch(/^The last activity of the users is read one by one, as a parallel request failed: /);
    });

    test("reports a user whose next page fails without reading the other users again", () => {
      mock.get(lastActiveDatesPath("acc-1"), lastActiveDates(STUDIO_ARI, "C2"));
      mock.get(lastActiveDatesPath("acc-1"), {params: {cursor: "C2"}, status: 400, json: {message: "Bad request"}});
      mock.get(lastActiveDatesPath("acc-2"), lastActiveDates(STUDIO_ARI));
      var warn = mock.spyOn(logger, "warn");

      var result = app.api.getUsersLastActiveDates(["acc-1", "acc-2"]);

      expect(Object.keys(result.byAccountId)).toEqual(["acc-2"]);
      expect(Object.keys(result.errors)).toEqual(["acc-1"]);
      expect(mock.requests().filter((request) => request.url.indexOf("acc-1/last-active-dates") >= 0 &&
        !(request.params && request.params.cursor)).length).toBe(1);
      expect(warn.mock.calls).toEqual([]);
    });

    test("requests nothing without users", () => {
      expect(app.api.getUsersLastActiveDates([])).toEqual({byAccountId: {}, errors: {}});
      expect(mock.requests()).toEqual([]);
    });
  });

  describe("isLicensable", () => {
    var workspace = (typeKey, attributes, planKey) => app.api.workspaceEntry({
      id: `ari:cloud:${typeKey}::site/site-acme`,
      attributes: Object.assign({typeKey: typeKey}, attributes || {}),
      relationships: planKey ? {entitlement: [{attributes: {planKey: planKey}}]} : {}
    });

    test("leaves out the products without a license of their own and the sandboxes", () => {
      expect(app.api.isLicensable(workspace("jira-software"))).toBe(true);
      expect(app.api.isLicensable(workspace("jira-software", {sandbox: {type: "NONE"}}))).toBe(true);
      expect(app.api.isLicensable(workspace("jira-software", {sandbox: {type: "CHILD"}}))).toBe(false);
      ["cmdb", "avp", "beacon", "goal", "project", "rovo", "studio", "townsquare"].forEach((typeKey) => {
        expect(app.api.isLicensable(workspace(typeKey))).toBe(false);
        expect(app.api.isLicensable(workspace(typeKey, {}, "FREE"))).toBe(false);
        expect(app.api.isLicensable(workspace(typeKey, {}, "none"))).toBe(false);
      });
    });

    test("licenses a product without a license of its own on a paid plan", () => {
      expect(app.api.isLicensable(workspace("cmdb", {}, "PREMIUM"))).toBe(true);
      expect(app.api.isLicensable(workspace("rovo", {}, "STANDARD"))).toBe(true);
      expect(app.api.isLicensable(workspace("rovo", {sandbox: {type: "CHILD"}}, "STANDARD"))).toBe(false);
    });
  });

  describe("eachOrgUsersPage", () => {
    test("follows the links.next URL of the v1 users pages", () => {
      mock.get("/admin/v1/orgs/org-1/users", {fixture: "org_users_page1"});
      mock.get("/admin/v1/orgs/org-1/users", {fixture: "org_users_page2", params: {cursor: "USERSCURSOR2"}});

      var accountIds = [];
      app.api.eachOrgUsersPage((users) => {
        users.forEach((user) => accountIds.push(user.account_id));
      });

      expect(accountIds).toEqual(["acc-alice", "acc-bob", "acc-carol", "acc-dave"]);
    });
  });

  describe("getAvailableCustomFields", () => {
    test("offers the user profile fields of the directory user search", () => {
      var fields = app.api.getAvailableCustomFields([]);

      expect(fields).toHaveLength(11);
      expect(fields.map((field) => field.key)).toContain("organization");
      expect(fields.filter((field) => field.key === "department")[0]).toEqual({
        key: "department", name: "Department", dataType: "string", dimension: true,
        group: "User profile"
      });
      var addedToOrg = fields.filter((field) => field.key === "added_to_org")[0];
      expect(addedToOrg.dataType).toBe("datetime");
      expect(addedToOrg.dimension).toBe(false);
    });
  });

  describe("product keys and names", () => {
    test("normalizes the differing product keys of the workspaces and the product access", () => {
      expect(app.api.productKey("jira")).toBe("jira-software");
      expect(app.api.productKey("jira-core")).toBe("jira-software");
      expect(app.api.productKey("jira-software")).toBe("jira-software");
      expect(app.api.productKey("cmdb")).toBe("assets");
      expect(app.api.productKey("CONFLUENCE")).toBe("confluence");
    });

    test("builds a source selection key of a workspace ARI", () => {
      expect(app.api.workspaceKey("ari:cloud:jira-servicedesk::site/00000000-0000-4000-8000-000000000001")).
        toBe("jira-servicedesk/site/00000000-0000-4000-8000-000000000001");
      expect(app.api.workspaceKey("ari:cloud:bitbucket::workspace/{abc}")).toBe("bitbucket/workspace/-abc-");
    });

    test("names the known products and humanizes the unknown ones", () => {
      expect(app.api.productName("jira")).toBe("Jira");
      expect(app.api.productName("jira-service-desk")).toBe("Jira Service Management");
      expect(app.api.productName("townsquare")).toBe("Atlas");
      expect(app.api.productName("avp")).toBe("Atlassian Analytics");
      expect(app.api.productName("some-new-product")).toBe("Some New Product");
    });

    test("extracts the cloud id of a site ARI", () => {
      expect(app.api.siteCloudId("ari:cloud:jira-software::site/site-acme")).toBe("site-acme");
      expect(app.api.siteCloudId("ari:cloud:trello::workspace/ws-trello")).toBeNull();
      expect(app.api.siteCloudId(null)).toBeNull();
    });
  });
});
