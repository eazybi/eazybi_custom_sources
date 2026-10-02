describe("app.importers.users", () => {
  beforeEach(() => {
    mock.extraOptions({time_dimension_time_zone: "UTC"});
    importRun.prepare();
  });

  function user(attributes) {
    return app.importers.rows.merge({
      id: 99, type: "user", firstName: "Mr", lastName: "Robot", email: "mrobot@acme.com",
      jobTitle: "Support agent"
    }, attributes || {});
  }

  describe("storeUser", () => {
    test("stores a real user into all three people dimensions", () => {
      app.importers.users.storeUser(user());

      expect(dwh.dimensions.assignees.rows({columns: ["assignee_key", "display_name"]})).
        toEqual([{assignee_key: "user-99", display_name: "Mr Robot"}]);
      expect(dwh.dimensions.agents.rows({columns: ["agent_key", "display_name"]})).
        toEqual([{agent_key: "user-99", display_name: "Mr Robot"}]);
      expect(dwh.dimensions.closers.rows({columns: ["closed_by_key", "display_name"]})).
        toEqual([{closed_by_key: "user-99", display_name: "Mr Robot"}]);
    });

    // v2 reports an AI powered system user as a plain user — it is a staff member too.
    test("stores a system user the same way", () => {
      app.importers.users.storeUser(user({type: "system_user"}));

      expect(dwh.dimensions.agents.rows({columns: ["agent_key"]})).toEqual([{agent_key: "user-99"}]);
    });
  });

  describe("importAll", () => {
    test("seeds the unassigned and the not-closed members even when nobody is a real user", () => {
      mock.get("/v2/users", {json: {_embedded: {users: []}, _links: {}}});

      app.importers.users.importAll();

      expect(dwh.dimensions.assignees.rows({columns: ["assignee_key"]})).
        toEqual([{assignee_key: "unassigned"}]);
      expect(dwh.dimensions.closers.rows({columns: ["closed_by_key"]})).
        toEqual([{closed_by_key: "not_closed"}]);
    });
  });
});
