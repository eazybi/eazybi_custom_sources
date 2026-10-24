// The generated sample data of test/sample_data.js imports without an unmocked request and fills
// every dimension the sample reports group by.
var CUBE = "[Atlassian Marketplace]";

function membersWith(set, measure, where) {
  return olap.results(`
    SELECT Filter(${set}, NOT IsEmpty([Measures].[${measure}])) ON ROWS,
           {[Measures].[${measure}]} ON COLUMNS
    FROM ${CUBE}${where ? ` WHERE ${where}` : ""}`).map((row) => row[0]);
}

describe("sample data", () => {
  beforeAll(() => {
    mock.sampleData();
    importRun.run();
  });

  test("imports the licenses and the transactions of every app without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    expect(membersWith("[App].[App].Members", "Licenses")).toEqual([
      "Lumen Checklists for Confluence", "Lumen Release Notes for Jira", "Lumen Timeline for Jira"
    ]);
    var totals = olap.results(`
      SELECT {[Measures].[Licenses], [Measures].[Transactions]} ON COLUMNS, {[Time].DefaultMember} ON ROWS
      FROM ${CUBE}`)[0];
    expect(totals[1]).toBeGreaterThan(3000);
    expect(totals[2]).toBeGreaterThan(5000);
  });

  test("sells on every hosting, sale type, billing period and partner type in the last 12 months", () => {
    var lastYear = "[Time].[Last 12 months]";
    expect(membersWith("[Hosting].[Hosting].Members", "Vendor amount", lastYear)).toEqual(["Cloud", "Data Center"]);
    expect(membersWith("[Sale Type].[Sale Type].Members", "Transactions", lastYear)).toEqual([
      "New", "Renewal", "Upgrade", "Downgrade", "Refund"
    ]);
    expect(membersWith("[Billing Period].[Billing Period].Members", "Vendor amount", lastYear)).toEqual([
      "Monthly", "Annual"
    ]);
    expect(membersWith("[Partner.Type].[Type].Members", "Vendor amount", lastYear).sort()).toEqual([
      "Corporate reseller", "Direct", "Expert", "Reseller"
    ]);
  });

  test("groups the subsidiaries of a partner", () => {
    var groups = dwh.dimensions.partners.rows({columns: ["name", "partner_group"], orderBy: "name"})
      .filter((partner) => partner.partner_group === "Cobaltway");
    expect(groups.map((partner) => partner.name)).toEqual([
      "Cobaltway Consulting Ltd", "Cobaltway GmbH", "Cobaltway Pty Ltd"
    ]);
  });

  test("has sales in the last days and licenses of every status", () => {
    var lastDays = olap.results(`
      SELECT {[Measures].[Transactions]} ON COLUMNS, {[Time].[Last 30 days]} ON ROWS
      FROM ${CUBE}`)[0][1];
    expect(lastDays).toBeGreaterThan(100);
    expect(membersWith("[License Status].[License Status].Members", "Licenses")).toEqual([
      "Active", "Inactive", "Cancelled"
    ]);
  });
});
