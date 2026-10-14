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

function budgetRowsOf(projectId, columns) {
  var rows = dwh.measures.timesheets.rows({
    columns: ["_source_id", "_source_name", "project_id"].concat(columns || [])});
  return _.sortBy(rows.filter((row) =>
    row._source_name === "custom_harvest budget" && row.project_id === projectId), "project_task_id");
}

function currencyIdOf(currency) {
  return _.detect(dwh.dimensions.currencies.rows({columns: ["id", "currency"]}),
    (row) => row.currency === currency).id;
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

describe("app.importers.budgets", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  test("budgets the hours of a project on the project itself", () => {
    expect(budgetRowsOf(1930109, ["project_task_id", "task_id", "person_id", "budgeted_hours",
                                  "budgeted_cost", "currency_id", "time_id"])).toEqual([
      {_source_id: "1930109", _source_name: "custom_harvest budget", project_id: 1930109,
       // The nameless project task of the project, because the budget names no task of it.
       project_task_id: -1930109, task_id: null, person_id: null, budgeted_hours: 500,
       budgeted_cost: null, currency_id: null, time_id: null}
    ]);
  });

  test("budgets the cost of a project in the currency of its client", () => {
    expect(budgetRowsOf(1930103, ["project_task_id", "budgeted_hours", "budgeted_cost",
                                  "currency_id"])).toEqual([
      {_source_id: "1930103", _source_name: "custom_harvest budget", project_id: 1930103,
       project_task_id: -1930103, budgeted_hours: null, budgeted_cost: 10000,
       currency_id: currencyIdOf("USD")}
    ]);
  });

  test("budgets the fees of a fixed price project on each of its tasks", () => {
    expect(budgetRowsOf(11637625, ["project_task_id", "task_id", "budgeted_cost", "currency_id"])).
      toEqual([
        {_source_id: "11637625", _source_name: "custom_harvest budget", project_id: 11637625,
         project_task_id: 191715661, task_id: 1245122, budgeted_cost: 1000,
         currency_id: currencyIdOf("USD")},
        {_source_id: "11637625", _source_name: "custom_harvest budget", project_id: 11637625,
         project_task_id: 191715681, task_id: 1245133, budgeted_cost: 20122,
         currency_id: currencyIdOf("USD")}
      ]);
  });

  test("budgets the hours of a project on each of the people assigned to it", () => {
    expect(_.sortBy(budgetRowsOf(1930115, ["project_task_id", "task_id", "person_id", "budgeted_hours"]),
      "person_id")).toEqual([
        {_source_id: "1930115", _source_name: "custom_harvest budget", project_id: 1930115,
         project_task_id: -1930115, task_id: null, person_id: 312294, budgeted_hours: 160},
        {_source_id: "1930115", _source_name: "custom_harvest budget", project_id: 1930115,
         project_task_id: -1930115, task_id: null, person_id: 312875, budgeted_hours: 0}
      ]);
  });

  test("reports a budget of 0 hours as 0 and not as an empty cell", () => {
    expect(_.sortBy(olap.results(`
      SELECT {[Measures].[Budgeted hours]} ON COLUMNS,
             [Person].[Person].Members ON ROWS
      FROM [Harvest Timesheets]
    `), (row) => row[0])).toEqual([["Chuck Norris", 0], ["Riley Smith", 160]]);
  });

  // Harvest answers no budget for a person the project was never given hours for.
  test("writes the budget row of a person the project budgets no hours for", () => {
    var fetchedAssignments = mock.fixture("user_assignments");
    _.detect(fetchedAssignments.user_assignments, (assignment) => assignment.id === 15236610).budget = null;
    mock.get("/v2/user_assignments", {json: fetchedAssignments});
    importDimensions();

    expect(_.sortBy(budgetRowsOf(1930115, ["person_id", "budgeted_hours"]), "person_id")).toEqual([
      {_source_id: "1930115", _source_name: "custom_harvest budget", project_id: 1930115,
       person_id: 312294, budgeted_hours: 160},
      {_source_id: "1930115", _source_name: "custom_harvest budget", project_id: 1930115,
       person_id: 312875, budgeted_hours: null}
    ]);
  });

  test("budgets the hours of a project on each of its tasks, also on a task of no budget", () => {
    var fetchedProjects = mock.fixture("projects");
    _.detect(fetchedProjects.projects, (project) => project.id === 1930109).budget_by = "task";
    mock.get("/v2/projects", {json: fetchedProjects});
    var fetchedAssignments = mock.fixture("task_assignments");
    _.detect(fetchedAssignments.task_assignments, (assignment) => assignment.id === 19171529).budget = 40;
    mock.get("/v2/task_assignments", {json: fetchedAssignments});
    importDimensions();

    expect(budgetRowsOf(1930109, ["project_task_id", "task_id", "person_id", "budgeted_hours"])).
      toEqual([
        {_source_id: "1930109", _source_name: "custom_harvest budget", project_id: 1930109,
         project_task_id: 19171529, task_id: 1245122, person_id: null, budgeted_hours: 40},
        {_source_id: "1930109", _source_name: "custom_harvest budget", project_id: 1930109,
         project_task_id: 19171535, task_id: 1245133, person_id: null, budgeted_hours: null},
        {_source_id: "1930109", _source_name: "custom_harvest budget", project_id: 1930109,
         project_task_id: 19171622, task_id: 1245123, person_id: null, budgeted_hours: null}
      ]);
  });

  test("removes the budget rows of a project which is not budgeted any more", () => {
    expect(budgetRowsOf(1930109)).toHaveLength(1);

    var fetchedProjects = mock.fixture("projects");
    _.detect(fetchedProjects.projects, (project) => project.id === 1930109).budget_by = "none";
    mock.get("/v2/projects", {json: fetchedProjects});
    var clearOld = mock.spyOn(source.warnings, "clearOld");
    importDimensions();

    expect(budgetRowsOf(1930109)).toEqual([]);
    expect(budgetRowsOf(11637625)).toHaveLength(2);
    expect(clearOld).toHaveBeenCalledWith("budget/1930109");
  });

  test("writes the collected budgets before a project whose rows would not fit into one call", () => {
    var writeBatch = mock.spyOn(app.importers.rows, "writeTimesheetBatch");

    withRowLimits({BATCH_SIZE: 100, MAX_ROWS_PER_CALL: 3}, importDimensions);

    var batches = writeBatch.mock.calls.map((call) => call[0]).filter((rows) => rows.length > 0);
    expect(batches.length).toBeGreaterThan(1);
    batches.forEach((rows) => expect(rows.length).toBeLessThanOrEqual(3));
    // A project whose rows were split between two calls would be named by both.
    expect(_.flatten(batches.map((rows) => _.uniq(_.pluck(rows, "_source_id")))).sort()).
      toEqual(["11637625", "1930103", "1930109", "1930115"]);
  });

  test("reports a project of more budget rows than one call takes and keeps its stored rows", () => {
    var fetchedProjects = mock.fixture("projects");
    _.detect(fetchedProjects.projects, (project) => project.id === 1930109).budget = 400;
    mock.get("/v2/projects", {json: fetchedProjects});
    var fetchedAssignments = mock.fixture("user_assignments");
    _.detect(fetchedAssignments.user_assignments, (assignment) => assignment.id === 15236610).budget = 40;
    mock.get("/v2/user_assignments", {json: fetchedAssignments});

    withRowLimits({MAX_ROWS_PER_CALL: 1}, importDimensions);

    expect(importRun.objectFailures().sort()).toEqual(["budget/11637625", "budget/1930115"]);
    expect(_.map(importRun.warnings(), (warning) => warning.message).join("\n")).toContain(
      "Import of the budget of Harvest project 1930115 failed: its 2 rows are more than the 1 which");
    // The project of one budget row is written.
    expect(budgetRowsOf(1930109, ["budgeted_hours"])[0].budgeted_hours).toBe(400);
    expect(_.sortBy(budgetRowsOf(1930115, ["person_id", "budgeted_hours"]), "person_id").
      map((row) => row.budgeted_hours)).toEqual([160, 0]);
  });
});
