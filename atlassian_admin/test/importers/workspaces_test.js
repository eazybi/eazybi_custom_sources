describe("app.importers.workspaces", () => {
  beforeEach(() => {
    mock.sourceParams({org_id: "org-1", api_key: "secret-key"});
    mock.post("/admin/v2/orgs/org-1/workspaces", {fixture: "workspaces_page1", requestBody: '{"limit":250}'});
    mock.post("/admin/v2/orgs/org-1/workspaces",
      {fixture: "workspaces_page2", requestBody: '{"cursor":"WSCURSOR2"}'});
  });

  test("selects all products of a selected site and a single selected product", () => {
    importRun.prepare();

    var context = app.importers.workspaces.importAll(["site/site-acme", "jira-software/site/site-beta"]);

    expect(context.selectedWorkspaces.map((workspace) => workspace.key)).toEqual([
      "cmdb/site/site-acme",
      "confluence/site/site-acme",
      "beacon/site/site-acme",
      "jira-software/site/site-acme",
      "jira-software/site/site-beta"
    ]);
    // The detection of product admins searches both workspaces of the Jira product.
    expect(context.selectedWorkspaces[3].aris).toHaveLength(2);
  });

  test("imports the licenses of the selected products only", () => {
    importRun.prepare();

    app.importers.workspaces.importAll(["jira-software/site/site-beta"]);

    expect(dwh.measures.licenses.rows({columns: ["_source_id", "license_seats"]})).toEqual([
      {_source_id: "jira-software/site/site-beta", license_seats: 50}
    ]);
  });

  test("selects every product with Select all", () => {
    importRun.prepare();

    var context = app.importers.workspaces.importAll(["(all)"]);

    expect(context.selectedWorkspaces).toHaveLength(8);
    expect(dwh.dimensions.sites.rows({columns: ["name"]}).map((row) => row.name).sort()).toEqual([
      "Acme Trello", "acme.atlassian.net", "beta.atlassian.net", "bitbucket.org/acme-dev",
      "gamma.atlassian.net"
    ]);
  });

  test("keeps two workspaces of the same name apart", () => {
    var workspaces = mock.fixture("workspaces_page2");
    workspaces.data.push({id: "ari:cloud:trello::workspace/ws-trello-2", type: "workspaces",
      attributes: {name: "Acme Trello", typeKey: "trello", type: "Trello", hostUrl: null}});
    mock.post("/admin/v2/orgs/org-1/workspaces", {json: workspaces, requestBody: '{"cursor":"WSCURSOR2"}'});
    importRun.prepare();

    app.importers.workspaces.importAll(["trello/workspace/ws-trello", "trello/workspace/ws-trello-2"]);

    expect(_.sortBy(dwh.dimensions.sites.rows({columns: ["site_key", "name"]}), "site_key")).toEqual([
      {site_key: "trello/workspace/ws-trello", name: "Acme Trello"},
      {site_key: "trello/workspace/ws-trello-2", name: "Acme Trello"}
    ]);
  });
});
