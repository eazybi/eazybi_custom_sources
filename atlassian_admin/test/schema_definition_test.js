describe("app.defineSchema", () => {
  test("defines the Atlassian Admin cube", () => {
    expect(schema.cubes()).toEqual(["Atlassian Admin"]);
    expect(olap.cubes()).toEqual(["Atlassian Admin"]);
  });

  test("defines the dimensions of the user license analysis", () => {
    ["User", "Admin Role", "User Status", "Group", "Site", "Product", "Plan", "Activity Tracking",
      "Inactivity interval", "Time"].forEach((name) => {
      expect(schema.dimensions()).toContain(name);
    });
  });

  // mock.extraOptions alone does not rebuild the schema of the run, mock.customFields does — and the user
  // profile fields need no requests.
  test("hides the Product Role dimension without the product roles import", () => {
    mock.customFields({});

    expect(schema.dimensions()).toContain("Product Role");
    expect(schema.dimension("Product Role").visible).toBe(false);
  });

  test("shows the Product Role dimension with the product roles import", () => {
    mock.extraOptions({import_product_roles: true});
    mock.customFields({});

    expect(schema.dimension("Product Role").visible).toBe(true);
  });

  test("defines the properties of the User level", () => {
    var properties = schema.dimension("User").level("User").properties();

    ["Email", "Account type", "Status", "Admin role", "Last active"].forEach((property) => {
      expect(properties).toContain(property);
    });
  });

  test("defines the user, product access and license measures", () => {
    ["Users", "Active users", "Inactive users", "Product users", "Licensed users", "Unused licenses",
      "Workspaces", "License seats"].forEach((measure) => {
      expect(schema.measures()).toContain(measure);
    });
  });

  test("defines the calculated members", () => {
    ["[Measures].[Active users %]", "[Measures].[Users active in last 30 days]",
      "[Measures].[Remaining seats]", "[Measures].[Product last active date]", "[Measures].[User admin role]",
      "[Measures].[User last active date]",
      "[Measures].[Product inactive days]", "[Measures].[User inactive days]"].forEach((member) => {
      expect(schema.calculatedMembers()).toContain(member);
    });
  });
});
