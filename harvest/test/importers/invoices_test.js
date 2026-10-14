var COMPANY = {name: "API Examples", base_uri: "https://example.harvestapp.com", expense_feature: true,
               invoice_feature: true};
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";

function mockDimensions() {
  mock.sourceParams({api_token: "secret-token", site_url: COMPANY.base_uri});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: "1234567", name: "Acme", product: "harvest"}]}});
  mock.extraOptions({time_dimension_time_zone: "UTC"});
  mock.get("/v2/clients", {fixture: "clients"});
  mock.get("/v2/projects", {fixture: "projects"});
  mock.get("/v2/tasks", {fixture: "tasks_page1"});
  mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, fixture: "tasks_page2"});
  mock.get("/v2/users", {fixture: "users"});
  mock.get("/v2/task_assignments", {fixture: "task_assignments"});
  mock.get("/v2/user_assignments", {fixture: "user_assignments"});
  mock.get("/v2/expense_categories", {fixture: "expense_categories"});
  mock.get("/v2/invoice_item_categories", {fixture: "invoice_item_categories"});
  mock.get(ECB_RATES_URL, {fixture: "eurofxref-daily.xml",
                           headers: {"Content-Type": "application/xml"}});
}

function importDimensions() {
  importRun.prepare();
  app.importer.importDimensions(COMPANY, {since: null, importExpenses: true, importInvoices: true},
    app.importer.beginSelection());
}

// The paid invoice of the European client, of one consulting line item of its project.
function invoice(attributes) {
  var record = {id: 1241021, number: "1", purchase_order: "PO-1241021", amount: 683.2,
                due_amount: 0.0, tax_amount: 123.2, tax2_amount: 0.0, discount_amount: 0.0,
                subject: "", notes: "", state: "paid", issue_date: "2012-02-20",
                due_date: "2012-02-20", period_start: "2012-02-02", period_end: "2012-02-02",
                payment_term: "upon_receipt", sent_at: null, paid_date: null, closed_at: null,
                currency: "EUR", client: {id: 915262, name: "Small European company"},
                estimate: null, retainer: null,
                creator: {id: 312294, name: "Riley Smith"},
                line_items: [lineItem()]};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

function lineItem(attributes) {
  var record = {id: null, kind: "Service", description: "Consulting", quantity: 8.0,
                unit_price: 70.0, amount: 560.0, taxed: true, taxed2: false,
                project: {id: 1930115, name: "Consulting for Small European company",
                          code: "CONS-SMALLEU"}};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

var IMPORT_STARTED_AT = "2026-10-01T10:00:00Z";

function importInvoices(invoices) {
  mock.get("/v2/invoices", {json: {invoices: invoices}});
  app.importers.invoices.importAll({invoicesSince: null, importStartedAt: IMPORT_STARTED_AT});
}

function invoiceRows(columns) {
  return dwh.measures.invoices.rows({columns: ["_source_id", "_source_name"].concat(columns)});
}

function itemIdOfPosition(position) {
  return dwh.dimensions.invoice_items.rows({columns: ["id", "position"]}).
    filter((item) => item.position === position)[0].id;
}

function withRowLimits(limits, importFunction) {
  var rows = app.importers.rows;
  var realLimits = {BATCH_SIZE: rows.BATCH_SIZE, MAX_ROWS_PER_CALL: rows.MAX_ROWS_PER_CALL};
  Object.assign(rows, limits);
  try {
    importFunction();
  } finally {
    Object.assign(rows, realLimits);
  }
}

describe("app.importers.invoices", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  test("imports the invoice as the member the built-in application names it", () => {
    importInvoices([invoice()]);

    expect(dwh.dimensions.invoices.rows({
      columns: ["id", "name", "number", "status", "issued_date", "due_date", "period_start_date",
                "period_end_date", "currency", "client_name", "created_by", "purchase_order",
                "payment_term", "subject", "notes"]
    })).toEqual([
      {id: 1241021, name: "#1 Small European company", number: "1", status: "Paid",
       issued_date: "2012-02-20", due_date: "2012-02-20", period_start_date: "2012-02-02",
       period_end_date: "2012-02-02", currency: "EUR", client_name: "Small European company",
       created_by: "Riley Smith", purchase_order: "PO-1241021",
       payment_term: "upon_receipt", subject: null, notes: null}
    ]);
  });

  test("imports the line item of the invoice and one nameless item of the invoice itself", () => {
    importInvoices([invoice()]);

    expect(dwh.dimensions.invoice_items.rows({
      columns: ["invoice_id", "position", "description", "category", "project", "quantity",
                "unit_price", "taxed", "taxed2"],
      orderBy: "position"
    })).toEqual([
      {invoice_id: 1241021, position: -1, description: null, category: null, project: null,
       quantity: null, unit_price: null, taxed: null, taxed2: null},
      {invoice_id: 1241021, position: 1, description: "Consulting", category: "Service",
       project: "[CONS-SMALLEU] Consulting for Small European company", quantity: 8, unit_price: 70,
       taxed: true, taxed2: false}
    ]);
  });

  // Mondrian finds a member by its name in any case, so a description in another case is the same name.
  test("tells the items of an invoice of the same or of no description apart by their position", () => {
    importInvoices([invoice({line_items: [lineItem(), lineItem({description: "Travel"}), lineItem(),
                                          lineItem({description: null}),
                                          lineItem({description: "travel"})]})]);

    expect(dwh.dimensions.invoice_items.rows({columns: ["position", "description"], orderBy: "position"}).
      map((item) => item.description)).
      toEqual([null, "Consulting (1)", "Travel (2)", "Consulting (3)", "Item (4)", "travel (5)"]);
  });

  // A string column holds 255 characters, and a longer value would fail the whole invoice.
  test("fits a long description, subject and PO number to their columns", () => {
    var long = "x".repeat(300);
    importInvoices([invoice({subject: long, purchase_order: long,
                             line_items: [lineItem({description: long}), lineItem({description: long})]})]);

    expect(importRun.objectFailures()).toEqual([]);
    expect(dwh.dimensions.invoices.rows({columns: ["subject", "purchase_order"]})[0]).
      toEqual({subject: "x".repeat(255), purchase_order: "x".repeat(255)});
    expect(dwh.dimensions.invoice_items.rows({columns: ["position", "description"], orderBy: "position"}).
      map((item) => item.description)).toEqual([null, `${"x".repeat(251)} (1)`, `${"x".repeat(251)} (2)`]);
  });

  test("builds one row of the amounts of the invoice, one of its due amount and one per item", () => {
    importInvoices([invoice()]);

    expect(invoiceRows(["invoice_id", "invoice_item_id", "project_id", "invoice_item_category_id",
                        "invoice_amount", "tax_amount", "tax2_amount", "discount_amount",
                        "due_amount", "item_amount"])).toEqual([
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_id: 1241021,
       invoice_item_id: itemIdOfPosition(-1), project_id: -915262, invoice_item_category_id: null,
       invoice_amount: 683.2, tax_amount: 123.2, tax2_amount: 0, discount_amount: 0,
       due_amount: null, item_amount: null},
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_id: 1241021,
       invoice_item_id: itemIdOfPosition(-1), project_id: -915262, invoice_item_category_id: null,
       invoice_amount: null, tax_amount: null, tax2_amount: null, discount_amount: null,
       due_amount: 0, item_amount: null},
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_id: 1241021,
       invoice_item_id: itemIdOfPosition(1), project_id: 1930115, invoice_item_category_id: 308625,
       invoice_amount: null, tax_amount: null, tax2_amount: null, discount_amount: null,
       due_amount: null, item_amount: 560}
    ]);
  });

  test("imports an invoice which has no line items at all", () => {
    importInvoices([invoice({line_items: []})]);

    expect(invoiceRows(["invoice_amount", "due_amount"])).toEqual([
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_amount: 683.2,
       due_amount: null},
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_amount: null,
       due_amount: 0}
    ]);
  });

  test("leaves the category of a line item of a kind the account does not define empty", () => {
    importInvoices([invoice({line_items: [lineItem({kind: "Retainer", project: null})]})]);

    expect(invoiceRows(["item_amount", "invoice_item_category_id"]).
      filter((row) => row.item_amount !== null)).toEqual([
        {_source_id: "1241021", _source_name: "custom_harvest invoice", item_amount: 560,
         invoice_item_category_id: null}
      ]);
  });

  test("reports a line item which names no project by the client of the invoice", () => {
    importInvoices([invoice({line_items: [lineItem({project: null})]})]);

    expect(_.uniq(invoiceRows(["project_id"]).map((row) => row.project_id))).toEqual([-915262]);
  });

  test("replaces the rows of an invoice which was changed since the last import", () => {
    importInvoices([invoice()]);

    importDimensions();
    importInvoices([invoice({amount: 500, due_amount: 500, tax_amount: 0, line_items: [
      lineItem({kind: "Product", description: "Books", quantity: 1, unit_price: 500, amount: 500,
                taxed: false, project: null})
    ]})]);

    expect(invoiceRows(["invoice_amount", "due_amount", "item_amount",
                        "invoice_item_category_id"])).toEqual([
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_amount: 500,
       due_amount: null, item_amount: null, invoice_item_category_id: null},
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_amount: null,
       due_amount: 500, item_amount: null, invoice_item_category_id: null},
      {_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_amount: null,
       due_amount: null, item_amount: 500, invoice_item_category_id: 308626}
    ]);
  });

  test("removes the line items which were removed from an invoice since the last import", () => {
    importInvoices([invoice({line_items: [lineItem(), lineItem({description: "Travel"}),
                                          lineItem({description: "Hotel"})]})]);

    importDimensions();
    importInvoices([invoice()]);

    expect(dwh.dimensions.invoice_items.rows({columns: ["position", "description"],
      orderBy: "position"})).toEqual([
        {position: -1, description: null}, {position: 1, description: "Consulting"}
      ]);
    expect(invoiceRows(["invoice_item_id", "item_amount"]).filter((row) => row.item_amount !== null)).
      toEqual([{_source_id: "1241021", _source_name: "custom_harvest invoice",
                invoice_item_id: itemIdOfPosition(1), item_amount: 560}]);
  });

  test("keeps the removed line items of an invoice whose new rows could not be written", () => {
    importInvoices([invoice({line_items: [lineItem(), lineItem({description: "Travel"})]})]);

    importDimensions();
    mock.spyOn(app.importers.rows, "writeInvoiceBatch").mockImplementation(() => {
      throw new Error("The rows could not be written");
    });
    expect(() => importInvoices([invoice()])).toThrow("The rows could not be written");

    expect(dwh.dimensions.invoice_items.rows({columns: ["position"], orderBy: "position"}).
      map((item) => item.position)).toEqual([-1, 1, 2]);
  });

  // The next import answers the invoice with the client it is billed to now, of no selected project.
  test("removes the rows of an invoice moved to a client which is not imported", () => {
    mock.sourceSelection(["project/1930115"]);
    importDimensions();
    importInvoices([invoice()]);
    expect(invoiceRows(["invoice_amount"]).length).toBeGreaterThan(0);

    importDimensions();
    mock.get("/v2/invoices", {json: {invoices: [invoice({client: {id: 915259, name: "eazyBI"}})]}});
    var clearOld = mock.spyOn(source.warnings, "clearOld");
    app.importers.invoices.importAll({invoicesSince: "2026-01-01T00:00:00Z"});

    expect(clearOld).toHaveBeenCalledWith(`invoice/${invoice().id}`);
    expect(invoiceRows(["invoice_amount"])).toEqual([]);
    expect(dwh.dimensions.invoices.rows()).toEqual([]);
    expect(dwh.dimensions.invoice_items.rows()).toEqual([]);
    expect(importRun.objectFailures()).toEqual([]);
  });

  // The invoice was changed after the import began, so the project it names was created after the projects
  // list was read.
  test("reports the project of a line item which the projects list did not answer", () => {
    importInvoices([invoice({updated_at: "2026-10-01T10:05:00Z",
                             line_items: [lineItem({project: {id: 4242}})]})]);

    expect(dwh.measures.invoices.rows()).toEqual([]);
    expect(importRun.objectFailures()).toEqual(["project/4242"]);
  });

  // Harvest keeps the invoices of a project deleted from it, which still name the project. They are imported
  // under the client, and every later import would otherwise fail on them.
  test("imports the item of a deleted project of an unchanged invoice under the client", () => {
    importInvoices([invoice({updated_at: "2012-02-20T22:05:17Z",
                             line_items: [lineItem({project: {id: 4242}})]})]);

    expect(importRun.objectFailures()).toEqual([]);
    expect(invoiceRows(["project_id", "item_amount"]).filter((row) => row.item_amount !== null)).
      toEqual([{_source_id: "1241021", _source_name: "custom_harvest invoice", project_id: -915262,
                item_amount: 560}]);
  });

  test("reports the client of an invoice which the clients list did not answer", () => {
    importInvoices([invoice({client: {id: 424242, name: "Gone"}})]);

    expect(dwh.measures.invoices.rows()).toEqual([]);
    expect(importRun.objectFailures()).toEqual(["client/424242"]);
    expect(_.map(importRun.warnings(), (warning) => warning.message).join("\n")).
      toContain("Harvest client 424242 was not in the clients list");
  });

  test("writes the collected invoices before an invoice whose rows would not fit into one call", () => {
    var writeBatch = mock.spyOn(app.importers.rows, "writeInvoiceBatch");

    withRowLimits({BATCH_SIZE: 100, MAX_ROWS_PER_CALL: 5}, () =>
      importInvoices([invoice(), invoice({id: 1241022}), invoice({id: 1241023})]));

    expect(writeBatch.mock.calls.map((call) => call[0].length).filter((length) => length > 0)).
      toEqual([3, 3, 3]);
    expect(dwh.measures.invoices.rows()).toHaveLength(9);
  });

  test("reports an invoice of more rows than one call takes and keeps its stored rows", () => {
    importInvoices([invoice({line_items: [lineItem(), lineItem({description: "Travel"}),
                                          lineItem({description: "Hotel"})]})]);

    importDimensions();
    withRowLimits({MAX_ROWS_PER_CALL: 2}, () => importInvoices([invoice({amount: 500})]));

    expect(importRun.objectFailures()).toEqual(["invoice/1241021"]);
    expect(_.map(importRun.warnings(), (warning) => warning.message).join("\n")).
      toContain("Import of Harvest invoice 1241021 failed: its 3 rows are more than the 2 which");
    expect(invoiceRows(["invoice_amount"]).filter((row) => row.invoice_amount !== null)).
      toEqual([{_source_id: "1241021", _source_name: "custom_harvest invoice", invoice_amount: 683.2}]);
    expect(dwh.dimensions.invoice_items.rows({columns: ["position"], orderBy: "position"})).
      toEqual([{position: -1}, {position: 1}, {position: 2}, {position: 3}]);
  });
});
