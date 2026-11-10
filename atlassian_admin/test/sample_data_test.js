// The generated sample data of test/sample_data.js imports without an unmocked request and fills every
// dimension the sample reports group by. The reports have no Time page, so the members are checked over all
// times.
describe("sample data", () => {
  // The members of the set which have a value of the measure. Mondrian has no NonEmpty function.
  function membersWith(set, measure, where = "") {
    return olap.results(`
      SELECT Filter(${set}, NOT IsEmpty([Measures].[${measure}])) ON ROWS,
             {[Measures].[${measure}]} ON COLUMNS
      FROM [Atlassian Admin] ${where}`).map((row) => row[0]);
  }

  function total(measure, where = "") {
    return olap.results(`
      SELECT {[Measures].[${measure}]} ON COLUMNS, {[User].DefaultMember} ON ROWS
      FROM [Atlassian Admin] ${where}`)[0][1];
  }

  beforeAll(() => {
    mock.sampleData();
    importRun.run();
  });

  test("imports the users of every account status without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    expect(total("Users")).toBeGreaterThan(300);
    expect(membersWith("[User Status].[User Status].Members", "Users")).toEqual([
      "Active", "Suspended", "Not invited", "Deactivated"
    ]);
  });

  test("has active users of the last 30 days and inactive ones", () => {
    var recent = total("Users active in last 30 days");
    expect(recent).toBeGreaterThan(150);
    expect(recent).toBeLessThan(total("Active users"));
  });

  test("has users of every admin role", () => {
    expect(membersWith("[Admin Role].[Admin Role].Members", "Users")).toEqual([
      "Org admin", "Site admin", "Product admin", "No admin role"
    ]);
    expect(membersWith("[Admin Role].[Admin Role].Members", "Inactive users")).toContain("Site admin");
  });

  test("has the active and inactive users of many groups", () => {
    expect(membersWith("[Group].[Group].Members", "Active users").length).toBeGreaterThan(12);
    expect(membersWith("[Group].[Group].Members", "Inactive users").length).toBeGreaterThan(3);
  });

  test("has the product users and licensed users of every site", () => {
    expect(membersWith("[Site].[Site].Members", "Product users")).toEqual([
      "bitbucket.org/larkspur", "larkspur.atlassian.net", "larkspur-labs.atlassian.net",
      "larkspur-sandbox.atlassian.net"
    ]);
    expect(membersWith("[Site].[Site].Members", "Licensed users")).toEqual([
      "larkspur.atlassian.net", "larkspur-labs.atlassian.net"
    ]);
    expect(total("Unused licenses")).toBeGreaterThan(10);
  });

  test("has the tracked product users of every product in every inactivity interval", () => {
    var tracked = "WHERE [Activity Tracking].[Tracked]";
    expect(membersWith("[Product].[Product].Members", "Product users", tracked)).toEqual([
      "Assets", "Bitbucket", "Confluence", "Jira", "Jira Product Discovery", "Jira Service Management"
    ]);
    expect(membersWith("[Inactivity interval].[Inactivity interval].Members", "Product users", tracked)).
      toEqual(["(none)", "... - 029", "030 - 089", "090 - 179", "180 - ..."]);
    // The portal customers of the service desk.
    expect(membersWith("[Product].[Product].Members", "Product users", "WHERE [Activity Tracking].[Not tracked]")).
      toEqual(["Jira Service Management"]);
  });

  test("has the product roles and the product admins of the products", () => {
    expect(membersWith("[Product Role].[Product Role].Members", "Product users")).toEqual([
      "User", "Admin", "User access admin", "Contributor", "Stakeholder", "Customer", "Guest"
    ]);
    expect(membersWith("[Product].[Product].Members", "Product admins")).toEqual([
      "Assets", "Confluence", "Jira", "Jira Product Discovery", "Jira Service Management"
    ]);
    expect(membersWith("[Site].[Site].Members", "Product admins").length).toBe(3);
  });
});
