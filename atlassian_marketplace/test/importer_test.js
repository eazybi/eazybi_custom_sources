var DEVELOPER_ID = "11111111-2222-3333-4444-555555555555";
var BASE = "/marketplace/rest/3";
var REPORTING_PATH = `${BASE}/reporting/developer-space/${DEVELOPER_ID}`;
var LICENSES_EXPORT_PATH = `${REPORTING_PATH}/licenses/async/export`;
var TRANSACTIONS_EXPORT_PATH = `${REPORTING_PATH}/sales/transactions/async/export`;
var LICENSES_EXPORT_ID = "aaaa1111-bbbb-2222-cccc-333333333333";
var TRANSACTIONS_EXPORT_ID = "dddd4444-eeee-5555-ffff-666666666666";
var JIRA_APP = "com.eazybi.jira.plugins.eazybi-jira";

// The mocked Marketplace of one developer space with three apps, whose exports answer the license
// and the transaction fixtures cut from a real export.
function mockMarketplace(extraOptions) {
  mock.sourceParams({developer_id: DEVELOPER_ID, username: "vendor@example.com",
                     api_token: "secret-token"});
  var options = {
    time_dimension_time_zone: "UTC",
    import_licenses: true,
    import_transactions: true,
    include_atlassian_licenses: false,
    transactions_history: "0"
  };
  for (var key in (extraOptions || {})) options[key] = extraOptions[key];
  mock.extraOptions(options);

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

function sumOf(rows, column) {
  return _.reduce(rows, (total, row) => total + (row[column] || 0), 0);
}

function requestOf(path) {
  return _.find(mock.requests(), (request) => request.path === path);
}

describe("app.importer.importAll", () => {
  describe("of a full import", () => {
    beforeAll(() => {
      mockMarketplace();

      importRun.run();
    });

    test("imports the apps of the developer space that are selected", () => {
      // Nothing is selected, so every app of the listings is imported — but not the deleted one.
      expect(dwh.dimensions.apps.rows({columns: ["app_key", "name", "state"], orderBy: "name"})).
        toEqual([
          {app_key: "com.eazybi.confluence.plugins.eazybi-confluence",
           name: "eazyBI for Confluence Reports, Charts, and Dashboards", state: "Public"},
          {app_key: JIRA_APP,
           name: "eazyBI for Jira Reports, Charts, and Dashboards", state: "Public"},
          {app_key: "com.eazybi.atlassian-connect.eazybi-jira",
           name: "eazyBI for Jira Reports, Charts, and Dashboards (old)", state: "Private"}
        ]);
    });

    test("seeds the known members of the small dimensions in their reading order", () => {
      expect(dwh.dimensions.hostings.rows({columns: ["hosting_key"], orderBy: "position"})).
        toEqual([{hosting_key: "Cloud"}, {hosting_key: "Data Center"}, {hosting_key: "Server"}]);
      expect(_.map(dwh.dimensions.sale_types.rows({columns: ["sale_type_key"],
        orderBy: "position"}), (row) => row.sale_type_key)).
        toEqual(["New", "Renewal", "Upgrade", "Downgrade", "Refund"]);
      expect(_.map(dwh.dimensions.license_types.rows({columns: ["license_type_key"],
        orderBy: "position"}), (row) => row.license_type_key)).
        toEqual(["Commercial", "Academic", "Social impact", "Evaluation", "Demonstration",
                 "Free", "Legacy free", "Community", "Open source", "Classroom"]);
    });

    test("imports the license tiers with the user range each of them belongs to", () => {
      var tiers = dwh.dimensions.license_tiers.rows({
        columns: ["tier_key", "users", "range_key", "range_max"], orderBy: "tier_key"});
      expect(_.find(tiers, (tier) => tier.tier_key === "25 Users")).
        toEqual({tier_key: "25 Users", users: 25, range_key: "11-25 Users", range_max: 25});
      expect(_.find(tiers, (tier) => tier.tier_key === "2000 Users")).
        toEqual({tier_key: "2000 Users", users: 2000, range_key: "501-2000 Users",
                 range_max: 2000});
      // A tier which names no user count at all is its own member in the "Other" range.
      expect(_.find(tiers, (tier) => tier.tier_key === "Evaluation")).
        toEqual({tier_key: "Evaluation", users: null, range_key: "Other", range_max: 0});
      expect(_.find(tiers, (tier) => tier.tier_key === "Unlimited Users")).
        toEqual({tier_key: "Unlimited Users", users: 1000000, range_key: "Unlimited Users",
                 range_max: 1000000});
      // The per unit pricing tiers of the transactions name their user count in the tier name.
      expect(_.find(tiers, (tier) => tier.tier_key === "Per Unit Pricing (84 Users)").users).
        toBe(84);
    });

    test("imports the countries of their region and the customers", () => {
      expect(dwh.dimensions.countries.rows({columns: ["region", "country"], orderBy: "country"})).
        toContainEqual({region: "APAC", country: "India"});
      expect(dwh.dimensions.customers.rows({columns: ["name", "country", "region"],
        orderBy: "name"})[0]).
        toEqual({name: "Company 1", country: "India", region: "APAC"});
    });

    // The same partner is reported under different partner types over time, so the dimension has
    // one row per name and type and its main hierarchy joins them again.
    test("imports one partner member per partner name and partner type with its group", () => {
      var partners = dwh.dimensions.partners.rows({
        columns: ["name", "partner_type", "partner_group"], orderBy: ["name", "partner_type"]});
      expect(partners).toContainEqual(
        {name: "Partner 8", partner_type: "Expert", partner_group: "Partner 8"});
      expect(partners).toContainEqual(
        {name: "Partner 8", partner_type: "Reseller", partner_group: "Partner 8"});
      // A record without a partner is a direct sale, which is a member of its own.
      expect(partners).toContainEqual(
        {name: "(direct)", partner_type: "Direct", partner_group: "(direct)"});
    });

    // The Marketplace reports the sales of many solution partners under the "Unknown" type.
    test("reads the unknown partner type as the expert type", () => {
      var partners = dwh.dimensions.partners.rows({columns: ["name", "partner_type"]});
      expect(_.pluck(partners, "partner_type")).not.toContain("Unknown");
      expect(partners).toContainEqual({name: "Partner 12", partner_type: "Expert"});
    });

    test("imports the licenses with their properties", () => {
      var license = _.find(dwh.dimensions.licenses.rows({columns: [
        "license_key", "license_sen", "app_name", "hosting", "license_type", "status", "tier",
        "start_date", "end_date", "customer", "partner", "partner_type", "cloud_site_hostname"]}),
        (row) => row.license_key === "E-001-AAA-BBB-CCC");
      expect(license).toEqual({
        license_key: "E-001-AAA-BBB-CCC",
        license_sen: null,
        app_name: "eazyBI for Jira Reports, Charts, and Dashboards",
        hosting: "Cloud",
        license_type: "Evaluation",
        status: "Active",
        tier: "Evaluation",
        start_date: "2026-09-02",
        end_date: "2026-10-02",
        customer: "Company 1",
        partner: "Partner 1",
        partner_type: "Expert",
        cloud_site_hostname: "site1.atlassian.net"
      });
    });

    // A server or data center license is identified by its license id, a cloud license by its app
    // entitlement number.
    test("identifies a license by its license ID or by its app entitlement number", () => {
      var keys = _.map(dwh.dimensions.licenses.rows({columns: ["license_key", "license_sen"]}),
        (row) => row.license_key);
      expect(keys).toContain("L1000009");
      expect(keys).toContain("E-001-AAA-BBB-CCC");
      expect(_.find(dwh.dimensions.licenses.rows({columns: ["license_key", "license_sen"]}),
        (row) => row.license_key === "L1000009").license_sen).toBe("SEN-L1000009");
    });

    test("counts a license when it starts and again when it ends", () => {
      var rows = dwh.measures.licenses.rows();
      // Every license starts, and the four free licenses without an end date never end.
      expect(sumOf(rows, "licenses")).toBe(15);
      expect(sumOf(rows, "licenses_ending")).toBe(11);
      expect(rows).toHaveLength(26);
    });

    test("imports the transaction lines with their properties", () => {
      var transaction = _.find(dwh.dimensions.transactions.rows({columns: [
        "transaction_key", "transaction_id", "sale_date", "sale_type", "payment_status",
        "billing_period", "product_edition", "tier", "old_tier", "customer", "payment_attempts"]}),
        (row) => row.transaction_id === "IN-030-000-000");
      expect(transaction).toMatchObject({
        transaction_id: "IN-030-000-000",
        sale_date: "2026-09-02",
        sale_type: "Renewal",
        payment_status: "Open",
        billing_period: "Monthly",
        product_edition: "Premium",
        tier: "2 Users",
        old_tier: "Per Unit Pricing (68 Users)",
        customer: "Company 15",
        // The transaction whose payment failed once and is retried.
        payment_attempts: 1
      });
    });

    // A credit note reuses the line item id of the invoice it credits, so the transaction id
    // belongs in the key that identifies the line.
    test("tells a credit note apart from the invoice it credits", () => {
      var lineId = "c811df4c-3b52-5f9b-ab19-d6405d58fa2d";
      var lines = _.filter(dwh.dimensions.transactions.rows({
        columns: ["transaction_key", "transaction_id", "line_item_id", "sale_type"]}),
        (row) => row.line_item_id === lineId);
      expect(_.sortBy(lines, "transaction_id")).toEqual([
        {transaction_key: `CN-072-000-000-1/${lineId}`, transaction_id: "CN-072-000-000-1",
         line_item_id: lineId, sale_type: "Refund"},
        {transaction_key: `IN-073-000-000/${lineId}`, transaction_id: "IN-073-000-000",
         line_item_id: lineId, sale_type: "Renewal"}
      ]);
    });

    // Two lines of one invoice share the transaction ID, which names the member, so the names
    // are made unique after the last batch.
    test("names the lines of one invoice apart", () => {
      var names = _.map(_.filter(dwh.dimensions.transactions.rows({
        columns: ["transaction_id", "name"]}),
        (row) => row.transaction_id === "IN-033-000-000"), (row) => row.name);
      expect(names).toHaveLength(2);
      expect(_.uniq(names)).toHaveLength(2);
      names.forEach((name) => expect(name).toContain("IN-033-000-000"));
    });

    test("counts the sales with their amounts and discounts", () => {
      var rows = dwh.measures.transactions.rows();
      expect(sumOf(rows, "transactions")).toBe(17);
      expect(sumOf(rows, "purchase_price")).toBeCloseTo(17369.70);
      expect(sumOf(rows, "vendor_amount")).toBeCloseTo(14390.88);
      expect(sumOf(rows, "partner_discount_amount")).toBeCloseTo(2737.16);
      expect(sumOf(rows, "promotion_discount_amount")).toBeCloseTo(543.60);
      expect(sumOf(rows, "manual_discount_amount")).toBeCloseTo(1395.00);
    });

    // A refund reverses the sale and the maintenance period it paid for, so it counts negative
    // and a cumulative sum of the maintenance rows needs no special case for it.
    test("counts the maintenance periods, reversed for a refund", () => {
      var rows = dwh.measures.transactions.rows();
      expect(sumOf(rows, "maintenance_started")).toBe(15);
      expect(sumOf(rows, "maintenance_ended")).toBe(15);
      // One sale row and two maintenance rows per transaction line.
      expect(rows).toHaveLength(51);

      var refundRows = _.filter(
        dwh.measures.transactions.rows({columns: ["_source_id", "maintenance_started",
          "maintenance_ended", "vendor_amount"]}),
        (row) => row._source_id.indexOf("CN-072-000-000-1/") === 0);
      expect(sumOf(refundRows, "maintenance_started")).toBe(-1);
      expect(sumOf(refundRows, "maintenance_ended")).toBe(-1);
      expect(sumOf(refundRows, "vendor_amount")).toBeCloseTo(-305.46);
    });

    test("names every imported row after the record it belongs to", () => {
      expect(_.uniq(_.map(dwh.measures.licenses.rows({columns: ["_source_name"]}),
        (row) => row._source_name))).toEqual(["custom_atlassian_marketplace license"]);
      expect(_.uniq(_.map(dwh.measures.transactions.rows({columns: ["_source_name"]}),
        (row) => row._source_name))).toEqual(["custom_atlassian_marketplace transaction"]);
    });

    test("exports everything of a first import and stores the marks of both data sets", () => {
      var licensesRequest = requestOf(LICENSES_EXPORT_PATH);
      expect(licensesRequest.params.accept).toBe("csv");
      expect(licensesRequest.params.lastUpdated).toBeUndefined();
      // The option is off, so the Atlassian licenses are not asked for at all.
      expect(licensesRequest.params.includeAtlassianLicenses).toBeUndefined();

      expect(importRun.objectFailures()).toEqual([]);
      expect(importRun.maxParams().licenses_last_updated).toMatch(/^\d{4}-\d\d-\d\d$/);
      expect(importRun.maxParams().transactions_last_updated).toMatch(/^\d{4}-\d\d-\d\d$/);
    });

    test("reports what it is doing while the exports are prepared and read", () => {
      expect(importRun.statusMessages()).toContain("Preparing the licenses export");
      expect(importRun.statusMessages()).toContain("Importing licenses, 15 read of 15 (100%)");
      expect(importRun.statusMessages()).
        toContain("Importing transactions, 17 read of 17 (100%)");
    });
  });

  describe("of an import that changes what is imported", () => {
    beforeEach(() => mockMarketplace());

    test("imports only the selected apps and asks the Marketplace for them", () => {
      mock.sourceSelection([JIRA_APP]);

      importRun.run();

      expect(_.map(dwh.dimensions.apps.rows({columns: ["app_key"]}), (row) => row.app_key)).
        toEqual([JIRA_APP]);
      expect(requestOf(LICENSES_EXPORT_PATH).params.addon).toBe(JIRA_APP);
      // The two records of the other apps are filtered out of the exported file as well.
      expect(sumOf(dwh.measures.licenses.rows(), "licenses")).toBe(12);
      expect(sumOf(dwh.measures.transactions.rows(), "transactions")).toBe(16);
    });

    test("imports no transactions when the option is off", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_licenses: true,
        import_transactions: false, include_atlassian_licenses: false,
        transactions_history: "0"});

      importRun.run();

      expect(dwh.measures.transactions.rows()).toEqual([]);
      expect(sumOf(dwh.measures.licenses.rows(), "licenses")).toBe(15);
      expect(mock.requestedPaths()).not.toContain(TRANSACTIONS_EXPORT_PATH);
      expect(importRun.maxParams().transactions_last_updated).toBeUndefined();
    });

    test("imports no licenses when the option is off", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_licenses: false,
        import_transactions: true, include_atlassian_licenses: false,
        transactions_history: "0"});

      importRun.run();

      expect(dwh.measures.licenses.rows()).toEqual([]);
      expect(mock.requestedPaths()).not.toContain(LICENSES_EXPORT_PATH);
    });

    test("asks for the Atlassian licenses when the option is on", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_licenses: true,
        import_transactions: true, include_atlassian_licenses: true,
        transactions_history: "0"});

      importRun.run();

      expect(requestOf(LICENSES_EXPORT_PATH).params.includeAtlassianLicenses).toBe("true");
    });

    test("limits the first transactions export to the chosen history", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_licenses: true,
        import_transactions: true, include_atlassian_licenses: false,
        transactions_history: "2"});

      importRun.run();

      var startDate = requestOf(TRANSACTIONS_EXPORT_PATH).params.startDate;
      expect(startDate).toMatch(/^\d{4}-\d\d-\d\d$/);
      expect(parseInt(startDate.substring(0, 4), 10)).
        toBe(new Date().getFullYear() - 2);
      // The licenses are always exported in full.
      expect(requestOf(LICENSES_EXPORT_PATH).params.startDate).toBeUndefined();
    });

    // The Marketplace filters by whole days, and a record changed while the previous import ran
    // carries the date of that day — the overlap makes sure the next import sees it.
    test("continues from the stored mark with an overlap on an incremental import", () => {
      mock.maxParams({licenses_last_updated: "2026-09-02",
                      transactions_last_updated: "2026-09-01"});

      importRun.run();

      expect(requestOf(LICENSES_EXPORT_PATH).params.lastUpdated).toBe("2026-08-30");
      expect(requestOf(TRANSACTIONS_EXPORT_PATH).params.lastUpdated).toBe("2026-08-29");
      // The history of the option belongs to the first import only.
      expect(requestOf(TRANSACTIONS_EXPORT_PATH).params.startDate).toBeUndefined();
    });

    test("ignores the stored marks on a reimport", () => {
      mock.maxParams({licenses_last_updated: "2026-09-02",
                      transactions_last_updated: "2026-09-01"});

      importRun.run({reimport: true});

      expect(requestOf(LICENSES_EXPORT_PATH).params.lastUpdated).toBeUndefined();
      expect(requestOf(TRANSACTIONS_EXPORT_PATH).params.lastUpdated).toBeUndefined();
    });

    test("keeps the marks unstored when a record failed", () => {
      mock.spyOn(app.importers.licenses, "buildRows").mockImplementation(() => {
        throw new Error("no rows today");
      });

      importRun.run();

      expect(importRun.objectFailures()).toHaveLength(15);
      expect(importRun.warnings()[0].message).toContain("no rows today");
      expect(importRun.maxParams().licenses_last_updated).toBeUndefined();
      expect(importRun.maxParams().transactions_last_updated).toBeUndefined();
    });

    test("fails the import when the export failed", () => {
      mock.get(`${LICENSES_EXPORT_PATH}/${LICENSES_EXPORT_ID}/status`,
        {json: {export: {id: LICENSES_EXPORT_ID, status: "FAILED"}}});

      expect(() => importRun.run()).toThrow("licenses export failed");
    });
  });

  // The exports answer plain calendar dates without a time and without a time zone, and eazyBI
  // converts every timestamp into the Time dimension time zone — a date must not slip into the
  // day before or after on the way.
  describe("in another Time dimension time zone", () => {
    // Pacific/Kiritimati is UTC+14 and Pacific/Midway UTC-11, the two ends of what a user can
    // choose — a date read at a time of day instead of as a plain date lands on another day in
    // one of them.
    ["UTC", "Pacific/Kiritimati", "Pacific/Midway"].forEach((timeZone) => {
      test(`keeps the calendar dates of a record in ${timeZone}`, () => {
        mockMarketplace({time_dimension_time_zone: timeZone});

        importRun.run();

        expect(_.find(dwh.dimensions.licenses.rows({columns: ["license_key", "start_date",
          "end_date"]}), (row) => row.license_key === "E-001-AAA-BBB-CCC")).
          toEqual({license_key: "E-001-AAA-BBB-CCC", start_date: "2026-09-02",
                   end_date: "2026-10-02"});
        // The Time member of the fact row has to be the same day as the property of the license.
        expect(olap.results(`
          SELECT NON EMPTY [Time].[Day].Members ON ROWS, {[Measures].[Licenses]} ON COLUMNS
          FROM [Atlassian Marketplace]
          WHERE [License].[E-001-AAA-BBB-CCC]`)).toEqual([["Sep 02 2026", 1]]);
      });
    });
  });
});
