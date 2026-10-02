// One exported license row, with the columns the importer reads. Every test overrides only the
// columns it is about.
function license(attributes) {
  var record = {
    addonLicenseId: "", hostLicenseId: "", licenseId: "",
    addonKey: "com.acme.app", addonName: "Acme App",
    licenseType: "COMMERCIAL", maintenanceStartDate: "2026-03-01",
    maintenanceEndDate: "2027-03-01", status: "active", hosting: "Cloud", tier: "25 Users",
    company: "Acme Inc", country: "Latvia", region: "EMEA",
    technicalContactName: "Tech Contact", technicalContactEmail: "tech@acme.example",
    billingContactName: "Bill Contact", billingContactEmail: "bill@acme.example",
    partnerType: "", partnerName: "", partnerContactName: "", partnerContactEmail: "",
    lastUpdated: "2026-09-02", appEntitlementId: "ent-1",
    appEntitlementNumber: "E-001-AAA-BBB-CCC", hostEntitlementId: "host-1",
    hostEntitlementNumber: "E-002-AAA-BBB-CCC", cloudId: "cloud-1",
    cloudSiteHostname: "acme.atlassian.net", cmtStatus: "", cmtRelatedOnPremLicense: "",
    extendedServerSupport: "NA", licenseSourceType: "Non-Atlassian",
    transactionAccountId: "account-1", newBillingSystem: "Yes",
    latestMaintenanceStartDate: "2026-03-01", latestEvaluationStartDate: "",
    appEdition: "", upgradeEvaluatingEdition: "", upgradeEvaluationStartDate: "",
    licenseLevel: "single-instance", multiInstanceEntitlementId: "",
    multiInstanceEntitlementNumber: "", inGracePeriod: "No", productId: "product-1",
    cloudComplianceBoundaries: "commercial"
  };
  for (var key in (attributes || {})) record[key] = attributes[key];
  return record;
}

function prepareImport() {
  mock.extraOptions({time_dimension_time_zone: "UTC"});
  importRun.prepare();
  app.importers.apps.reset();
}

describe("app.importers.licenses", () => {
  beforeEach(prepareImport);

  test("counts a license when it starts and again when it ends", () => {
    var rows = [];

    expect(app.importers.licenses.importOne(license(), rows)).toBe(1);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({_source_id: "E-001-AAA-BBB-CCC", _source_name: "license",
                                   licenses: 1});
    expect(rows[1]).toMatchObject({_source_id: "E-001-AAA-BBB-CCC", licenses_ending: 1});
    // Both rows carry the same dimension members, so a report of the endings can be read by the
    // same dimensions as a report of the starts.
    expect(rows[1].app_id).toBe(rows[0].app_id);
    expect(rows[1].license_id).toBe(rows[0].license_id);
  });

  // A free license is in force until the Marketplace says otherwise.
  test("counts no ending for a license without an end date", () => {
    var rows = [];

    app.importers.licenses.importOne(license({licenseType: "LEGACY_FREE",
      maintenanceEndDate: ""}), rows);

    expect(rows).toHaveLength(1);
    expect(rows[0].licenses).toBe(1);
    expect(_.find(dwh.dimensions.licenses.rows({columns: ["license_key", "end_date"]}),
      (row) => row.license_key === "E-001-AAA-BBB-CCC").end_date).toBeNull();
  });

  test("stores the license with the properties of a report of one license", () => {
    app.importers.licenses.importOne(license({addonLicenseId: "L123", licenseId: "SEN-L123",
      hosting: "Data Center", licenseType: "EVALUATION", tier: "Evaluation",
      partnerName: "Partner 1", partnerType: "Expert"}), []);

    expect(dwh.dimensions.licenses.rows({columns: [
      "license_key", "license_sen", "hosting", "license_type", "status", "tier", "start_date",
      "end_date", "customer", "country", "partner", "partner_type", "license_level",
      "extended_server_support"]})).toEqual([{
        license_key: "L123",
        license_sen: "SEN-L123",
        hosting: "Data Center",
        license_type: "Evaluation",
        status: "Active",
        tier: "Evaluation",
        start_date: "2026-03-01",
        end_date: "2027-03-01",
        customer: "Acme Inc",
        country: "Latvia",
        partner: "Partner 1",
        partner_type: "Expert",
        license_level: "single-instance",
        // "NA" is how the Marketplace writes a column which does not apply to the license.
        extended_server_support: null
      }]);
  });

  test("looks up the dimension members of the license", () => {
    var rows = [];

    app.importers.licenses.importOne(license({partnerName: "Partner 1", partnerType: "Expert"}),
      rows);

    expect(dwh.dimensions.hostings.rows({columns: ["hosting_key"]})).
      toEqual([{hosting_key: "Cloud"}]);
    expect(dwh.dimensions.license_types.rows({columns: ["license_type_key"]})).
      toEqual([{license_type_key: "Commercial"}]);
    expect(dwh.dimensions.license_statuses.rows({columns: ["license_status_key"]})).
      toEqual([{license_status_key: "Active"}]);
    expect(dwh.dimensions.countries.rows({columns: ["region", "country"]})).
      toEqual([{region: "EMEA", country: "Latvia"}]);
    expect(dwh.dimensions.partners.rows({columns: ["name", "partner_type"]})).
      toEqual([{name: "Partner 1", partner_type: "Expert"}]);
    expect(dwh.dimensions.customers.rows({columns: ["name", "country", "region"]})).
      toEqual([{name: "Acme Inc", country: "Latvia", region: "EMEA"}]);
    expect(rows[0].license_tier_id).toBeDefined();
  });

  // The Marketplace answers the contacts of a customer who asked to be forgotten as "RTBF".
  test("stores an anonymized contact as the Marketplace answers it", () => {
    app.importers.licenses.importOne(license({technicalContactName: "RTBF",
      technicalContactEmail: "RTBF"}), []);

    expect(dwh.dimensions.licenses.rows({columns: ["technical_contact_name",
      "technical_contact_email"]})).
      toEqual([{technical_contact_name: "RTBF", technical_contact_email: "RTBF"}]);
  });

  test("skips a license of an app that is not imported", () => {
    app.importers.apps.selectedKeys = ["com.other.app"];
    var rows = [];

    expect(app.importers.licenses.importOne(license(), rows)).toBe(0);
    expect(rows).toEqual([]);
  });

  // A license which can not be identified can not be imported incrementally either, so it is
  // reported instead of being written under a key which the next import would not recognize.
  test("warns about a license which carries no identifier", () => {
    var rows = [];

    expect(app.importers.licenses.importOne(
      license({addonLicenseId: "", appEntitlementNumber: "", appEntitlementId: ""}), rows)).toBe(0);

    expect(rows).toEqual([]);
    expect(importRun.warnings()[0].key).toBe("license/unidentified");
    expect(importRun.objectFailures()).toEqual([]);
  });

  // The warning is shared by every license without an identifier, so no license clears it — the
  // next import does, before it exports anything.
  test("clears the warning about a license without an identifier on the next import", () => {
    app.importers.licenses.importOne(
      license({addonLicenseId: "", appEntitlementNumber: "", appEntitlementId: ""}), []);
    var clearOld = mock.spyOn(source.warnings, "clearOld");
    var run = mock.spyOn(app.importers.exports, "run").mockImplementation(() => 0);

    app.importers.licenses.importAll("developer-1", {appKeys: []});

    expect(clearOld).toHaveBeenCalledWith("license/unidentified");
    expect(run).toHaveBeenCalled();
  });

  // A license that fails is reported and skipped, and its failure holds the incremental mark
  // back so that the next import asks for it again.
  test("reports a license it can not import and imports the rest", () => {
    var failing = mock.spyOn(app.importers.licenses, "buildRows").
      mockImplementation(() => { throw new Error("broken row"); });
    var rows = [];

    expect(app.importers.licenses.importOne(license(), rows)).toBe(0);

    expect(failing).toHaveBeenCalled();
    expect(importRun.objectFailures()).toEqual(["license/E-001-AAA-BBB-CCC"]);
    expect(importRun.warnings()[0].message).
      toContain("Import of license E-001-AAA-BBB-CCC failed: broken row");
  });

  test("replaces the rows of a license which changed since the previous import", () => {
    dwh.measures.licenses.importRows(
      [{_source_id: "E-001-AAA-BBB-CCC", _source_name: "license", licenses: 1}]);
    expect(dwh.measures.licenses.rows()).toHaveLength(1);

    prepareImport();
    var rows = [];
    app.importers.licenses.importOne(license({maintenanceEndDate: "2028-03-01"}), rows);
    dwh.measures.licenses.importRows(rows);

    // The stored row of the same license is replaced by the two rows of the changed one.
    expect(dwh.measures.licenses.rows()).toHaveLength(2);
  });
});
