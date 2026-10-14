function mockUsers(users) {
  mock.sourceParams({api_token: "secret-token"});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: "1234567", name: "Acme", product: "harvest"}]}});
  mock.get("/v2/users", {json: {users: users}});
  importRun.prepare();
}

function user(attributes) {
  var record = {id: 312294, first_name: "Riley", last_name: "Smith",
                email: "riley@example.com", is_contractor: false, is_active: true,
                weekly_capacity: 126000, default_hourly_rate: 100, cost_rate: 50, roles: []};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

function personRoles() {
  return dwh.dimensions.person_roles.rows({columns: ["person_id", "name"], orderBy: ["person_id", "name"]});
}

describe("app.importers.users", () => {
  test("appends the Harvest id to the name two people share", () => {
    mockUsers([user(), user({id: 400100}), user({id: 500200, first_name: "Chuck",
                                                 last_name: "Norris"})]);

    app.importers.users.importAll();

    expect(dwh.dimensions.people.rows({columns: ["id", "name"], orderBy: "id"})).toEqual([
      {id: 312294, name: "Riley Smith (312294)"},
      {id: 400100, name: "Riley Smith (400100)"},
      {id: 500200, name: "Chuck Norris"}
    ]);
  });

  test("names a person without a name by the email address", () => {
    mockUsers([user({first_name: null, last_name: null})]);

    app.importers.users.importAll();

    expect(dwh.dimensions.people.rows({columns: ["name", "email"]})).toEqual([
      {name: "riley@example.com", email: "riley@example.com"}
    ]);
  });

  test("writes one role row per Harvest role of a person and one for a person without a role", () => {
    mockUsers([user({roles: ["Consultant", "VIP"]}), user({id: 312875, roles: []})]);

    app.importers.users.importAll();

    expect(personRoles()).toEqual([
      {person_id: 312294, name: "Consultant"}, {person_id: 312294, name: "VIP"},
      {person_id: 312875, name: "(no role)"}
    ]);
  });

  test("writes a role which Harvest names twice for a person once", () => {
    mockUsers([user({roles: ["Consultant", "Consultant"]})]);

    app.importers.users.importAll();

    expect(personRoles()).toEqual([{person_id: 312294, name: "Consultant"}]);
  });
});
