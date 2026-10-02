var DEVELOPER_ID = "11111111-2222-3333-4444-555555555555";
var BASE = "/marketplace/rest/3";
var REPORTING_PATH = `${BASE}/reporting/developer-space/${DEVELOPER_ID}`;
var LICENSES_EXPORT_PATH = `${REPORTING_PATH}/licenses/async/export`;
var TRANSACTIONS_EXPORT_PATH = `${REPORTING_PATH}/sales/transactions/async/export`;
var LICENSES_EXPORT_ID = "aaaa1111-bbbb-2222-cccc-333333333333";
var TRANSACTIONS_EXPORT_ID = "dddd4444-eeee-5555-ffff-666666666666";
var CUBE = "[Atlassian Marketplace]";

function mockMarketplace() {
  mock.sourceParams({developer_id: DEVELOPER_ID, username: "vendor@example.com",
                     api_token: "secret-token"});
  mock.extraOptions({time_dimension_time_zone: "UTC", import_licenses: true,
    import_transactions: true, include_atlassian_licenses: false, transactions_history: "0"});
  mock.get(`${BASE}/product-listing/developer-space/${DEVELOPER_ID}`,
    {params: {limit: 50, includePrivate: true}, fixture: "listings_page1"});
  mock.get(`${BASE}/product-listing/developer-space/${DEVELOPER_ID}`,
    {params: {limit: 50, includePrivate: true, cursor: "Y3Vyc29yLTI="},
     fixture: "listings_page2"});
  mock.post(LICENSES_EXPORT_PATH, {fixture: "licenses_export_started"});
  mock.get(`${LICENSES_EXPORT_PATH}/${LICENSES_EXPORT_ID}/status`,
    {fixture: "licenses_export_completed"});
  mock.get(`${LICENSES_EXPORT_PATH}/${LICENSES_EXPORT_ID}`, {fixture: "licenses_export.csv"});
  mock.post(TRANSACTIONS_EXPORT_PATH, {fixture: "transactions_export_started"});
  mock.get(`${TRANSACTIONS_EXPORT_PATH}/${TRANSACTIONS_EXPORT_ID}/status`,
    {fixture: "transactions_export_completed"});
  mock.get(`${TRANSACTIONS_EXPORT_PATH}/${TRANSACTIONS_EXPORT_ID}`,
    {fixture: "transactions_export.csv"});
}

describe("app.defineSchema", () => {
  test("defines one cube with the dimensions of a Marketplace vendor", () => {
    expect(schema.cubes()).toEqual(["Atlassian Marketplace"]);
    expect(schema.dimensions()).toEqual([
      "App", "Billing Period", "Country", "Customer", "Hosting", "License", "License Status",
      "License Tier", "License Type", "Partner", "Payment Status", "Product Edition",
      "Sale Type", "Time", "Transaction"
    ]);
  });

  test("defines the levels of the dimensions of more than one level", () => {
    expect(schema.dimension("Country").levels()).toEqual(["Region", "Country"]);
    expect(schema.dimension("License Tier").levels()).toEqual(["Range", "Tier"]);
  });

  // The same partner is reported under different partner types, so the main hierarchy has the
  // partner alone, the Group hierarchy joins the subsidiaries of a partner and the Type hierarchy
  // splits the partners by type.
  test("defines the Partner dimension with a partner, a group and a partner type hierarchy", () => {
    expect(schema.dimension("Partner").hierarchies()).toEqual(["Partner", "Group", "Type"]);
    expect(schema.dimension("Partner").levels()).toEqual(["Partner"]);
    expect(schema.dimension("Partner").hierarchy("Group").levels()).toEqual(["Group", "Partner"]);
    expect(schema.dimension("Partner").hierarchy("Type").levels()).toEqual(["Type", "Partner"]);
  });

  test("defines the license and the transaction measures", () => {
    var measures = schema.measures();
    ["Licenses", "Licenses ending", "Customers with new licenses"].forEach((name) =>
      expect(measures).toContain(name));
    ["Transactions", "Purchase price", "Vendor amount", "Partner discount amount",
     "Promotion discount amount", "Loyalty discount amount", "Manual discount amount",
     "Maintenance started", "Maintenance ended", "Customers"].forEach((name) =>
      expect(measures).toContain(name));
  });

  test("defines the calculated measures of the license types and the amounts", () => {
    var calculatedMembers = schema.calculatedMembers();
    ["Evaluation licenses", "Paid licenses", "Free licenses", "Demonstration licenses",
     "Active licenses", "Active maintained licenses", "Average purchase price",
     "Average vendor amount", "Vendor amount per customer", "Refunded amount",
     "Vendor amount cloud %"].forEach((name) =>
      expect(calculatedMembers).toContain(`[Measures].[${name}]`));
  });

  test("defines a property measure per detail of a transaction and of a license", () => {
    var calculatedMembers = schema.calculatedMembers();
    ["Transaction date", "Transaction customer", "Transaction app", "Transaction sale type",
     "Transaction partner", "Transaction license type", "Transaction billing period",
     "Transaction product edition", "Transaction payment attempts", "Transaction license ID",
     "Transaction maintenance start date", "License customer", "License country",
     "License hosting", "License partner", "License status", "License end date",
     "License latest maintenance start date", "License last updated date"].
      forEach((name) => expect(calculatedMembers).toContain(`[Measures].[${name}]`));
    expect(schema.dimension("Transaction").level("Transaction").properties()).
      toContain("Payment status");
    expect(schema.dimension("License").level("License").properties()).toContain("License SEN");
  });

  describe("queried with MDX", () => {
    beforeAll(() => {
      mockMarketplace();

      importRun.run();
    });

    test("loads the cube of the type", () => {
      expect(olap.cubes()).toEqual(["Atlassian Marketplace"]);
    });

    test("aggregates the sale amounts by hosting", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Hosting].[Hosting].Members ON ROWS,
               {[Measures].[Transactions], [Measures].[Purchase price],
                [Measures].[Vendor amount]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([
          ["Cloud", 14, 15151.26, 12727.05],
          ["Data Center", 2, 1800.44, 1350.33],
          ["Server", 1, 418, 313.5]
        ]);
    });

    test("counts the licenses by license type and the calculated groups of them", () => {
      expect(olap.results(`
        SELECT NON EMPTY [License Type].[License Type].Members ON ROWS,
               {[Measures].[Licenses]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([
          ["Commercial", 5], ["Evaluation", 4], ["Demonstration", 1], ["Free", 1],
          ["Legacy free", 3], ["Open source", 1]
        ]);
      expect(olap.results(`
        SELECT {[Time].DefaultMember} ON ROWS,
               {[Measures].[Paid licenses], [Measures].[Evaluation licenses],
                [Measures].[Free licenses], [Measures].[Demonstration licenses]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["All Times", 5, 4, 5, 1]]);
    });

    // The main hierarchy has to sum the sales of a partner whatever type they were reported
    // under, which is what a vendor asks for when they ask for the sales of one partner.
    test("sums a partner of two partner types in the main hierarchy and splits it by type", () => {
      expect(olap.results(`
        SELECT {[Partner].[Partner 8]} ON ROWS,
               {[Measures].[Vendor amount], [Measures].[Transactions]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["Partner 8", 4301.34, 2]]);

      expect(olap.results(`
        SELECT {([Partner.Type].[Expert].[Partner 8]),
                ([Partner.Type].[Reseller].[Partner 8])} ON ROWS,
               {[Measures].[Vendor amount]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["Partner 8", 551.58], ["Partner 8", 3749.76]]);
    });

    // The group of a partner sums the partner's members of both types the way the main hierarchy
    // does, and the partner is a child of its group.
    test("sums the partners of a group in the Group hierarchy", () => {
      expect(olap.results(`
        SELECT {[Partner.Group].[Partner 8],
                [Partner.Group].[Partner 8].[Partner 8]} ON ROWS,
               {[Measures].[Vendor amount], [Measures].[Transactions]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["Partner 8", 4301.34, 2], ["Partner 8", 4301.34, 2]]);
    });

    test("counts the customers of the period once each", () => {
      expect(olap.results(`
        SELECT {[Time].DefaultMember} ON ROWS,
               {[Measures].[Customers], [Measures].[Transactions]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["All Times", 15, 17]]);
    });

    // A refund reverses the maintenance period of the sale it credits, so the two cancel out.
    test("counts the maintenance periods of the transactions, reversed for a refund", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Sale Type].[Sale Type].Members ON ROWS,
               {[Measures].[Maintenance started], [Measures].[Vendor amount]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([
          ["New", 4, 7112.86], ["Renewal", 8, 642.73], ["Upgrade", 3, 6698.83],
          ["Downgrade", 1, 241.92], ["Refund", -1, -305.46]
        ]);
    });

    // The end dates the export has in 2026, on which the licenses of that year stop being in
    // force. The fixture dates stay where they are while today moves on, so the count of the
    // licenses in force is counted from them rather than written out.
    var END_DATES_2026 = ["2026-09-08", "2026-09-18", "2026-09-26", "2026-09-27", "2026-10-02",
                          "2026-11-07", "2026-12-01"];

    test("adds up the licenses in force at the end of a period", () => {
      // Five of the licenses started before 2024 and two of them ended in it, so three were in
      // force at the end of 2024. All fifteen have started by the end of 2026, and the period
      // that is still running counts up to and including today, so of the seven end dates of
      // that year only those today has reached have taken a license out of force.
      var today = new Date().toISOString().substring(0, 10);
      var ended = END_DATES_2026.filter((date) => date <= today).length;
      expect(olap.results(`
        SELECT {[Time].[2024], [Time].[2026]} ON ROWS,
               {[Measures].[Licenses], [Measures].[Licenses ending],
                [Measures].[Active licenses]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([
          ["2024", null, 2, 3],
          ["2026", 10, 7, 15 - 2 - ended]
        ]);
    });

    test("calculates the amounts per transaction and the cloud share", () => {
      var amounts = olap.results(`
        SELECT {[Time].DefaultMember} ON ROWS,
               {[Measures].[Average purchase price], [Measures].[Average vendor amount],
                [Measures].[Refunded amount], [Measures].[Vendor amount cloud %]} ON COLUMNS
        FROM ${CUBE}`)[0];
      expect(amounts[1]).toBeCloseTo(1021.75);
      expect(amounts[2]).toBeCloseTo(846.52);
      expect(amounts[3]).toBeCloseTo(-305.46);
      expect(amounts[4]).toBeCloseTo(0.8844, 3);
    });

    // The sample reports expand these All members into the members of their level, so their names
    // have to be the ones eazyBI gives them.
    test("names the All members the sample reports expand", () => {
      var allMemberNames = ["App", "Hosting", "Country", "Partner"].map((dimension) =>
        olap.results(`
          SELECT {[${dimension}].DefaultMember} ON ROWS,
                 {[Measures].[Transactions]} ON COLUMNS
          FROM ${CUBE}`)[0][0]);
      expect(allMemberNames).toEqual(["All Apps", "All Hostings", "All Countries", "All Partners"]);
    });

    test("shows the details of a transaction as measures of its member", () => {
      expect(olap.results(`
        SELECT {[Transaction].[IN-030-000-000]} ON ROWS,
               {[Measures].[Transaction customer], [Measures].[Transaction sale type],
                [Measures].[Vendor amount]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["IN-030-000-000", "Company 15", "Renewal", 2.18]]);
    });

    // The record of an older sale names the app by its old name, the property measure by the name
    // of its listing, which the App dimension has.
    test("names the app of a transaction and of a license by its App member", () => {
      var listingName = "eazyBI for Jira Reports, Charts, and Dashboards";
      expect(olap.results(`
        SELECT {[Transaction].[AT-057-000-000]} ON ROWS,
               {[Measures].[Transaction app], [Measures].[Transaction billing period]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["AT-057-000-000", listingName, "Annual"]]);
      expect(olap.results(`
        SELECT {[License].[L1000010]} ON ROWS,
               {[Measures].[License app], [Measures].[License hosting],
                [Measures].[License partner], [Measures].[License country]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["L1000010", listingName, "Server", "Partner 4", "Sweden"]]);
    });

    test("shows the payment attempts of a transaction", () => {
      expect(olap.results(`
        SELECT {[Transaction].[IN-063-000-000]} ON ROWS,
               {[Measures].[Transaction payment attempts]} ON COLUMNS
        FROM ${CUBE}`)).toEqual([["IN-063-000-000", 5]]);
    });
  });
});
