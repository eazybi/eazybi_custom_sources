describe("app.importers.customers", () => {
  var swept = {id: 5, firstName: "Vernon", lastName: "Bear", jobTitle: "Bear",
               location: "Boston", organization: "Acme Inc", organizationId: 7001,
               _embedded: {emails: [{id: 1, value: "vbear@mywork.com"}]}};

  beforeEach(() => {
    mock.extraOptions({time_dimension_time_zone: "UTC"});
    importRun.prepare();
    app.importers.customers.reset();
  });

  test("stores the customer with the organization of the customer endpoint", () => {
    app.importers.customers.storeCustomer(swept);

    expect(dwh.dimensions.customers.rows({
      columns: ["id", "display_name", "email", "job_title", "organization_name"]})).
      toEqual([{id: 5, display_name: "Vernon Bear", email: "vbear@mywork.com",
                job_title: "Bear", organization_name: "Acme Inc"}]);
    expect(dwh.dimensions.organizations.rows({columns: ["id", "name"]})).
      toEqual([{id: 7001, name: "Acme Inc"}]);
    // The sweep resolved this customer, so its organization costs no request.
    expect(app.importers.customers.organizationIdFor({id: 5})).not.toBeNull();
    expect(mock.requests()).toEqual([]);
  });

  test("requests a customer the sweep did not return", () => {
    mock.get("/v2/customers/9", {json: {id: 9, firstName: "Rob", organization: "Other Inc",
      organizationId: 7002}});

    app.importers.customers.organizationIdFor({id: 9});

    expect(dwh.dimensions.organizations.rows({columns: ["id", "name"]})).
      toEqual([{id: 7002, name: "Other Inc"}]);
    // The response is memoized for the whole import, so a second customer costs no request.
    app.importers.customers.organizationIdFor({id: 9});
    expect(mock.requests()).toHaveLength(1);

    // A customer without an organization gets none, and costs no further request.
    app.importers.customers.storeCustomer({id: 6, firstName: "No", lastName: "Org"});
    expect(app.importers.customers.organizationIdFor({id: 6})).toBeNull();
    expect(mock.requests()).toHaveLength(1);
  });

});
