var COMPANY = {name: "API Examples", base_uri: "https://example.harvestapp.com", expense_feature: true};
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
  mock.get(ECB_RATES_URL, {fixture: "eurofxref-daily.xml",
                           headers: {"Content-Type": "application/xml"}});
}

function importDimensions() {
  importRun.prepare();
  app.importer.importDimensions(COMPANY, {since: null, importExpenses: true},
    app.importer.beginSelection());
}

// A hotel of the implementation project, which is billed to the US client in dollars.
function expense(attributes) {
  var record = {id: 1545415, spent_date: "2012-02-10", total_cost: 500, is_closed: false,
                notes: "hotel", project: {id: 1930109}, user: {id: 312294},
                expense_category: {id: 849339}, invoice: null};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

function importExpenses(expenses) {
  mock.get("/v2/expenses", {json: {expenses: expenses}});
  app.importers.expenses.importAll({expensesSince: null});
}

function expenseRows(columns) {
  return dwh.measures.timesheets.rows({columns: ["_source_id", "_source_name"].concat(columns)}).
    filter((row) => row._source_name === "custom_harvest expense");
}

describe("app.importers.expenses", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  test("builds one row of the project, the category, the person and the day of an expense", () => {
    importExpenses([expense()]);

    expect(expenseRows(["project_id", "project_task_id", "task_id", "person_id",
                        "expense_category_id", "approval_status_id", "expenses_amount",
                        "invoiced_expenses", "notes"])).toEqual([
      {_source_id: "1545415", _source_name: "custom_harvest expense", project_id: 1930109,
       // An expense belongs to no task of the project.
       project_task_id: -1930109, task_id: null, person_id: 312294, expense_category_id: 849339,
       approval_status_id: 0, expenses_amount: 500, invoiced_expenses: null, notes: "hotel"}
    ]);
  });

  test("counts an expense which is on an invoice as invoiced", () => {
    importExpenses([expense({invoice: {id: 13150403, number: "1001"}})]);

    expect(expenseRows(["expenses_amount", "invoiced_expenses"])).toEqual([
      {_source_id: "1545415", _source_name: "custom_harvest expense", expenses_amount: 500,
       invoiced_expenses: 500}
    ]);
  });

  test("counts an expense which is marked as invoiced as invoiced", () => {
    importExpenses([expense({is_billed: true})]);

    expect(expenseRows(["invoiced_expenses"])[0].invoiced_expenses).toBe(500);
  });

  test("counts the billable expenses and the invoiced ones as billable", () => {
    importExpenses([expense({id: 1, billable: true}), expense({id: 2, billable: false}),
                    expense({id: 3, billable: false, is_billed: true})]);

    expect(_.sortBy(expenseRows(["billable_expenses"]), (row) => row._source_id).
      map((row) => row.billable_expenses)).toEqual([500, null, 500]);
  });

  test("removes the row of an expense moved to a project which is not selected", () => {
    mock.sourceSelection(["project/1930109"]);
    importDimensions();
    importExpenses([expense()]);
    expect(expenseRows(["expenses_amount"])).toHaveLength(1);

    importDimensions();
    mock.get("/v2/expenses", {json: {expenses: [expense({project: {id: 1930103}})]}});
    var clearOld = mock.spyOn(source.warnings, "clearOld");
    app.importers.expenses.importAll({expensesSince: "2026-01-01T00:00:00Z"});

    expect(expenseRows(["expenses_amount"])).toEqual([]);
    expect(importRun.objectFailures()).toEqual([]);
    expect(clearOld).toHaveBeenCalledWith(`expense/${expense().id}`);
  });

  test("replaces the row of an expense which was changed since the last import", () => {
    importExpenses([expense()]);

    importDimensions();
    importExpenses([expense({total_cost: 450, notes: "hotel, one night less"})]);

    expect(expenseRows(["expenses_amount", "notes"])).toEqual([
      {_source_id: "1545415", _source_name: "custom_harvest expense", expenses_amount: 450,
       notes: "hotel, one night less"}
    ]);
  });

  test("reports the project of an expense which the projects list did not answer", () => {
    importExpenses([expense({project: {id: 4242}})]);

    expect(expenseRows(["expenses_amount"])).toEqual([]);
    expect(importRun.objectFailures()).toEqual(["project/4242"]);
  });
});
