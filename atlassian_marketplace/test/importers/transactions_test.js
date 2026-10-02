// One exported transaction row, with the columns the importer reads.
function transaction(attributes) {
  var record = {
    saleDate: "2026-09-02", transactionId: "IN-001-000-000", addonLicenseId: "",
    hostLicenseId: "", licenseId: "", addonName: "Acme App", addonKey: "com.acme.app",
    licenseType: "COMMERCIAL", hosting: "Cloud", changeInBillingPeriod: "No",
    oldBillingPeriod: "", billingPeriod: "Monthly", changeInTier: "Increase",
    oldTier: "10 User", tier: "25 Users", appEntitlementId: "ent-1",
    appEntitlementNumber: "E-001-AAA-BBB-CCC", parentProductName: "Jira",
    changeInParentProductEdition: "No", oldParentProductEdition: "Premium",
    parentProductEdition: "Premium", hostEntitlementId: "host-1",
    hostEntitlementNumber: "E-002-AAA-BBB-CCC", cloudId: "cloud-1",
    maintenanceStartDate: "2026-09-01", maintenanceEndDate: "2026-10-01", saleType: "Renewal",
    purchasePrice: "252.0", vendorAmount: "211.68", partnerDiscountAmount: "",
    proratedDetails: "[]", paymentStatus: "Fully paid", dunningStatus: "[]", refundReason: "",
    creditNoteReason: "", loyaltyDiscountAmount: "", loyaltyDiscountReason: "",
    marketplacePromotionDiscountAmount: "", marketplacePromotionDiscountCode: "",
    marketplacePromotionDiscountReason: "", expertDiscountAmount: "", expertDiscountReason: "",
    manualDiscountAmount: "", manualDiscountReason: "", paymentTerms: "",
    originalTransactionId: "", originalTransactionSaleDate: "", company: "Acme Inc",
    country: "Latvia", region: "EMEA", technicalContactName: "Tech Contact",
    technicalContactEmail: "tech@acme.example", billingContactName: "Bill Contact",
    billingContactEmail: "bill@acme.example", partnerType: "", partnerName: "",
    partnerContactEmail: "", partnerContactName: "", lastUpdated: "2026-09-02",
    transactionLineItemId: "line-1", appEdition: "", licenseLevel: "single-instance",
    productId: "product-1", cloudComplianceBoundaries: "commercial"
  };
  for (var key in (attributes || {})) record[key] = attributes[key];
  return record;
}

function prepareImport() {
  mock.extraOptions({time_dimension_time_zone: "UTC"});
  importRun.prepare();
  app.importers.apps.reset();
}

function sumOf(rows, column) {
  return _.reduce(rows, (total, row) => total + (row[column] || 0), 0);
}

describe("app.importers.transactions", () => {
  beforeEach(prepareImport);

  test("counts the sale and the maintenance period it paid for", () => {
    var rows = [];

    expect(app.importers.transactions.importOne(transaction(), rows)).toBe(1);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      _source_id: "IN-001-000-000/line-1", _source_name: "transaction",
      transactions: 1, purchase_price: 252, vendor_amount: 211.68
    });
    expect(rows[1]).toMatchObject({maintenance_started: 1});
    expect(rows[2]).toMatchObject({maintenance_ended: 1});
  });

  // A refund reverses the sale and the maintenance period of the sale it credits, so a cumulative
  // sum of the maintenance rows needs no special case for it.
  test("counts a refund and its maintenance period negative", () => {
    var rows = [];

    app.importers.transactions.importOne(transaction({
      transactionId: "CN-001-000-000-1", saleType: "Refund", purchasePrice: "-252.0",
      vendorAmount: "-211.68", paymentStatus: "Refunded"}), rows);

    expect(sumOf(rows, "vendor_amount")).toBeCloseTo(-211.68);
    expect(sumOf(rows, "maintenance_started")).toBe(-1);
    expect(sumOf(rows, "maintenance_ended")).toBe(-1);
  });

  test("counts the discounts of a sale in their own measures", () => {
    var rows = [];

    app.importers.transactions.importOne(transaction({
      expertDiscountAmount: "19.2", marketplacePromotionDiscountAmount: "543.6",
      manualDiscountAmount: "1395.0", loyaltyDiscountAmount: "5.5"}), rows);

    expect(rows[0]).toMatchObject({
      partner_discount_amount: 19.2,
      promotion_discount_amount: 543.6,
      manual_discount_amount: 1395,
      loyalty_discount_amount: 5.5
    });
  });

  // The data center invoices repeat the expert discount, rounded differently, in a legacy column
  // of their own, and the oldest server invoices report their discount only there.
  test("reads the legacy partner discount column when the expert discount is empty", () => {
    var rows = [];

    app.importers.transactions.importOne(transaction({
      expertDiscountAmount: "119.0", partnerDiscountAmount: "118.33333333333333"}), rows);
    app.importers.transactions.importOne(transaction({transactionId: "AT-002-000-000",
      expertDiscountAmount: "", partnerDiscountAmount: "118.33333333333333"}), rows);

    expect(rows[0].partner_discount_amount).toBe(119);
    expect(rows[3].partner_discount_amount).toBe(118.33);
  });

  test("stores the transaction line with the properties of a sales report", () => {
    app.importers.transactions.importOne(transaction({
      paymentTerms: "Net30", originalTransactionId: "IN-000-999-999",
      originalTransactionSaleDate: "2026-08-01",
      dunningStatus: '[{"attemptCount":1.0},{"attemptCount":2.0}]'}), []);

    expect(dwh.dimensions.transactions.rows({columns: [
      "transaction_key", "transaction_id", "line_item_id", "sale_date", "sale_type",
      "payment_status", "payment_terms", "tier", "old_tier", "change_in_tier", "billing_period",
      "product_edition", "customer", "license_key", "original_transaction_id",
      "original_sale_date", "payment_attempts"]})).toEqual([{
        transaction_key: "IN-001-000-000/line-1",
        transaction_id: "IN-001-000-000",
        line_item_id: "line-1",
        sale_date: "2026-09-02",
        sale_type: "Renewal",
        payment_status: "Fully paid",
        payment_terms: "Net30",
        tier: "25 Users",
        // A tier of the previous transaction is normalized the same way as the current one.
        old_tier: "10 Users",
        change_in_tier: "Increase",
        billing_period: "Monthly",
        product_edition: "Premium",
        customer: "Acme Inc",
        license_key: "E-001-AAA-BBB-CCC",
        original_transaction_id: "IN-000-999-999",
        original_sale_date: "2026-08-01",
        payment_attempts: 2
      }]);
  });

  test("looks up the dimension members of the transaction", () => {
    app.importers.transactions.importOne(transaction({partnerName: "Partner 1",
      partnerType: "Corporate_reseller"}), []);

    expect(dwh.dimensions.sale_types.rows({columns: ["sale_type_key"]})).
      toEqual([{sale_type_key: "Renewal"}]);
    expect(dwh.dimensions.billing_periods.rows({columns: ["billing_period_key"]})).
      toEqual([{billing_period_key: "Monthly"}]);
    expect(dwh.dimensions.payment_statuses.rows({columns: ["payment_status_key"]})).
      toEqual([{payment_status_key: "Fully paid"}]);
    expect(dwh.dimensions.product_editions.rows({columns: ["product_edition_key"]})).
      toEqual([{product_edition_key: "Premium"}]);
    expect(dwh.dimensions.partners.rows({columns: ["name", "partner_type", "partner_group"]})).
      toEqual([{name: "Partner 1", partner_type: "Corporate reseller",
                partner_group: "Partner 1"}]);
  });

  // A transaction of a license which the licenses export did not answer still belongs to that
  // license, so the member is created bare and the next licenses import fills its attributes.
  test("references the license of the transaction without overwriting it", () => {
    dwh.dimensions.licenses.createAndLookupId({license_key: "E-001-AAA-BBB-CCC"},
      {customer: "Acme Inc", status: "Active"});
    prepareImport();

    app.importers.transactions.importOne(transaction(), []);

    expect(dwh.dimensions.licenses.rows({columns: ["license_key", "customer", "status"]})).
      toEqual([{license_key: "E-001-AAA-BBB-CCC", customer: "Acme Inc", status: "Active"}]);
  });

  test("skips a transaction of an app that is not imported", () => {
    app.importers.apps.selectedKeys = ["com.other.app"];
    var rows = [];

    expect(app.importers.transactions.importOne(transaction(), rows)).toBe(0);
    expect(rows).toEqual([]);
  });

  test("warns about a transaction which carries no transaction ID", () => {
    var rows = [];

    expect(app.importers.transactions.importOne(transaction({transactionId: ""}), rows)).toBe(0);

    expect(rows).toEqual([]);
    expect(importRun.warnings()[0].key).toBe("transaction/unidentified");
  });

  test("reports a transaction it can not import", () => {
    mock.spyOn(app.importers.transactions, "buildRows").
      mockImplementation(() => { throw new Error("broken row"); });

    expect(app.importers.transactions.importOne(transaction(), [])).toBe(0);

    expect(importRun.objectFailures()).toEqual(["transaction/IN-001-000-000/line-1"]);
  });

  // The warning is shared by every transaction without an id, so no transaction clears it — the
  // next import does, before it exports anything.
  test("clears the warning about a transaction without an id on the next import", () => {
    var clearOld = mock.spyOn(source.warnings, "clearOld");
    mock.spyOn(app.importers.exports, "run").mockImplementation(() => 0);

    app.importers.transactions.importAll("developer-1", {appKeys: []});

    expect(clearOld).toHaveBeenCalledWith("transaction/unidentified");
  });
});
