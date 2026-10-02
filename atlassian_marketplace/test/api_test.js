var DEVELOPER_ID = "11111111-2222-3333-4444-555555555555";
// The paths of the mocked responses are the request paths, which carry the path of the base URL.
var BASE = "/marketplace/rest/3";
var SPACE_PATH = `${BASE}/developer-space/${DEVELOPER_ID}`;
var REPORTING_PATH = `${BASE}/reporting/developer-space/${DEVELOPER_ID}`;
var LISTINGS_PATH = `${BASE}/product-listing/developer-space/${DEVELOPER_ID}`;
var LISTINGS_PARAMS = {limit: 50, includePrivate: true};
var LICENSES_EXPORT_PATH = `${REPORTING_PATH}/licenses/async/export`;
var TRANSACTIONS_EXPORT_PATH = `${REPORTING_PATH}/sales/transactions/async/export`;

describe("app.api", () => {
  beforeEach(() => {
    mock.sourceParams({developer_id: DEVELOPER_ID, username: "vendor@example.com",
                       api_token: "secret-token"});
  });

  describe("testConnection", () => {
    test("names the developer space of a working connection", () => {
      mock.get(SPACE_PATH, {fixture: "developer_space"});
      mock.get(REPORTING_PATH, {fixture: "reporting_links"});

      expect(app.api.testConnection()).toEqual({
        authentication: {developer_space: "Acme Apps", developer_id: DEVELOPER_ID}
      });
    });

    test("reports rejected credentials on the API token field", () => {
      mock.get(SPACE_PATH, {status: 401, json: {code: 401, message: "Unauthorized"}});

      var result = app.api.testConnection();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("api_token");
    });

    test("reports a developer space it can not read on the API token field", () => {
      mock.get(SPACE_PATH, {status: 404, json: {code: 404, message: "Not found"}});

      expect(app.api.testConnection().errors[0].field).toBe("api_token");
    });

    // The credentials can be valid and still have no role which may read the vendor reports,
    // which is a different problem with a different fix.
    test("reports a missing reporting access on the account field", () => {
      mock.get(SPACE_PATH, {fixture: "developer_space"});
      mock.get(REPORTING_PATH, {status: 403, json: {code: 403, message: "Forbidden"}});

      var result = app.api.testConnection();

      expect(result.errors[0].field).toBe("username");
      expect(result.errors[0].message).toContain("Acme Apps");
    });

    test("resolves a numeric vendor ID into the developer space ID", () => {
      mock.sourceParams({developer_id: "123456", username: "vendor@example.com",
                         api_token: "secret-token"});
      mock.get(`${BASE}/developer-space/vendor/123456`, {fixture: "vendor"});
      mock.get(SPACE_PATH, {fixture: "developer_space"});
      mock.get(REPORTING_PATH, {fixture: "reporting_links"});

      expect(app.api.testConnection().authentication.developer_id).toBe(DEVELOPER_ID);
      expect(mock.requestedPaths()).toContain(`${BASE}/developer-space/vendor/123456`);
    });

    test("reports a vendor ID which resolves to nothing", () => {
      mock.sourceParams({developer_id: "42", username: "vendor@example.com",
                         api_token: "secret-token"});
      mock.get(`${BASE}/developer-space/vendor/42`, {status: 404, json: {code: 404}});

      expect(app.api.testConnection().errors[0].field).toBe("developer_id");
    });
  });

  describe("getApps", () => {
    beforeEach(() => {
      mock.get(LISTINGS_PATH, {params: LISTINGS_PARAMS, fixture: "listings_page1"});
      mock.get(LISTINGS_PATH,
        {params: {limit: 50, includePrivate: true, cursor: "Y3Vyc29yLTI="},
         fixture: "listings_page2"});
    });

    test("follows the cursor of the listing pages and skips a deleted app", () => {
      var apps = app.api.getApps(DEVELOPER_ID);

      expect(apps.map((one) => one.appKey)).toEqual([
        "com.eazybi.jira.plugins.eazybi-jira",
        "com.eazybi.confluence.plugins.eazybi-confluence",
        "com.eazybi.atlassian-connect.eazybi-jira"
      ]);
      expect(mock.requests()[0].params).toMatchObject({limit: "50", includePrivate: "true"});
      expect(mock.requests()[1].params.cursor).toBe("Y3Vyc29yLTI=");
    });

    test("offers the apps to select from, marking the ones that are not public", () => {
      var selections = app.api.getSourceSelections();

      expect(selections.multiple).toBe(true);
      expect(selections.options).toEqual([
        {key: "com.eazybi.jira.plugins.eazybi-jira",
         name: "eazyBI for Jira Reports, Charts, and Dashboards"},
        {key: "com.eazybi.confluence.plugins.eazybi-confluence",
         name: "eazyBI for Confluence Reports, Charts, and Dashboards"},
        {key: "com.eazybi.atlassian-connect.eazybi-jira",
         name: "eazyBI for Jira Reports, Charts, and Dashboards (old) (private)"}
      ]);
    });
  });

  describe("presentParams", () => {
    test("leaves out the empty values and an empty app filter", () => {
      expect(app.api.presentParams({
        accept: "csv", addon: [], lastUpdated: null, startDate: "", includeAtlassianLicenses: undefined
      })).toEqual({accept: "csv"});
    });
  });

  describe("the export flow", () => {
    test("starts a licenses export with the filters of the import", () => {
      mock.post(LICENSES_EXPORT_PATH, {
        params: {accept: "csv", addon: "com.eazybi.jira.plugins.eazybi-jira",
                 lastUpdated: "2026-08-30", includeAtlassianLicenses: "true"},
        fixture: "licenses_export_started"});

      var started = app.api.startExport(DEVELOPER_ID, "licenses", {
        accept: "csv", addon: ["com.eazybi.jira.plugins.eazybi-jira"],
        lastUpdated: "2026-08-30", includeAtlassianLicenses: "true"
      });

      expect(started.export.id).toBe("aaaa1111-bbbb-2222-cccc-333333333333");
      expect(mock.requests()[0].url).toContain("accept=csv");
      expect(mock.requests()[0].url).toContain("addon=com.eazybi.jira.plugins.eazybi-jira");
      expect(mock.requests()[0].url).toContain("lastUpdated=2026-08-30");
      expect(mock.requests()[0].url).toContain("includeAtlassianLicenses=true");
    });

    // The Marketplace filters by several apps with the `addon` parameter repeated once per app.
    test("repeats the app filter once per selected app", () => {
      mock.post(LICENSES_EXPORT_PATH, {fixture: "licenses_export_started"});

      app.api.startExport(DEVELOPER_ID, "licenses",
        {accept: "csv", addon: ["com.acme.one", "com.acme.two"], lastUpdated: null});

      var url = mock.requests()[0].url;
      expect(url).toContain("addon=com.acme.one");
      expect(url).toContain("addon=com.acme.two");
      expect(url).not.toContain("lastUpdated");
    });

    test("starts a transactions export at its own path", () => {
      mock.post(TRANSACTIONS_EXPORT_PATH,
        {params: {accept: "csv"}, fixture: "transactions_export_started"});

      expect(app.api.startExport(DEVELOPER_ID, "transactions", {accept: "csv"}).export.id).
        toBe("dddd4444-eeee-5555-ffff-666666666666");
      expect(mock.requestedPaths()).toContain(TRANSACTIONS_EXPORT_PATH);
    });

    // The status and download hrefs the Marketplace answers are relative to `/rest/3` and can not
    // be requested as they are, so both paths are built from the export id.
    test("polls the status until the export is prepared", () => {
      var exportId = "aaaa1111-bbbb-2222-cccc-333333333333";
      mock.get(`${LICENSES_EXPORT_PATH}/${exportId}/status`, {responses: [
        {json: {export: {id: exportId, status: "QUEUED"}}},
        {json: {export: {id: exportId, status: "IN_PROGRESS"}}},
        {fixture: "licenses_export_completed"}
      ]});

      var completed = app.api.waitForExport(DEVELOPER_ID, "licenses", exportId);

      expect(completed.export.status).toBe("COMPLETED");
      expect(mock.requests()).toHaveLength(3);
    });

    test("fails the import when the export failed", () => {
      var exportId = "aaaa1111-bbbb-2222-cccc-333333333333";
      mock.get(`${LICENSES_EXPORT_PATH}/${exportId}/status`,
        {json: {export: {id: exportId, status: "FAILED"}}});

      expect(() => app.api.waitForExport(DEVELOPER_ID, "licenses", exportId)).
        toThrow("licenses export failed");
    });

    test("reads the downloaded CSV export row by row", () => {
      var exportId = "aaaa1111-bbbb-2222-cccc-333333333333";
      mock.get(`${LICENSES_EXPORT_PATH}/${exportId}`, {fixture: "licenses_export.csv"});
      var records = [];

      app.api.downloadExport(DEVELOPER_ID, "licenses", exportId,
        (batch) => batch.forEach((record) => records.push(record)));

      expect(records).toHaveLength(15);
      expect(records[0].addonKey).toBe("com.eazybi.jira.plugins.eazybi-jira");
      expect(records[0].licenseType).toBe("EVALUATION");
    });
  });
});
