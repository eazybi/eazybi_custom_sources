// The merged fixtures hold the same Harvest records as the spec of the built-in Harvest application, so
// the sums below are the ones that spec asserts — with the two deliberate differences of this app: the
// rounded hours come from the `rounded_hours` Harvest answers, and an invoiced expense is recognized by
// `invoice.id`, which v2 answers, and not by the `invoice_id` of v1.
var ACCOUNT_ID = "1234567";
var SITE_URL = "https://example.harvestapp.com";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
// The cursor that the `links.next` URL of tasks_page1.json carries.
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";
// The reference rates of the next day, which a second import of a test reads instead of the fixture.
var NEXT_DAY_ECB_RATES =
  "<?xml version='1.0' encoding='UTF-8'?>" +
  "<gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01' " +
  "xmlns='http://www.ecb.int/vocabulary/2002-08-01/eurofxref'>" +
  "<Cube><Cube time='2012-02-28'>" +
  "<Cube currency='USD' rate='1.4000'/><Cube currency='GBP' rate='0.9000'/>" +
  "</Cube></Cube></gesmes:Envelope>";
// The day of the test run: a check for deleted records of today makes the next import incremental.
var TODAY = new Date().toISOString().replace(/\.\d+Z$/, "Z");
// A check long ago, after which the next import checks again.
var LONG_AGO = "2026-01-01T00:00:00Z";
// The business hours from 09:00 to 17:00 and the non-working Saturday and Sunday of the default import
// options, which the time entries are classified by.
var DEFAULT_CLASSIFICATION = "540-1020;6,7;";

function mockHarvestAccount() {
  // The fixture people were created in February 2012, and their capacity until the end of March 2012 keeps
  // the rows a test reads few.
  mock.spyOn(app.importers.capacity, "lastDayOf").mockReturnValue("2012-03-31");
  mock.sourceParams({api_token: "secret-token", site_url: SITE_URL});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});
  mock.sourceSelection(["(all)"]);
  // Every stored timestamp is converted into the Time dimension time zone; UTC keeps the fixture dates.
  mock.extraOptions({time_dimension_time_zone: "UTC"});
  mock.get("/v2/company", {fixture: "company"});
  mock.get("/v2/users/me", {fixture: "users_me"});
  mock.get("/v2/clients", {fixture: "clients"});
  mock.get("/v2/projects", {fixture: "projects"});
  mock.get("/v2/tasks", {fixture: "tasks_page1"});
  mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, fixture: "tasks_page2"});
  mock.get("/v2/users", {fixture: "users"});
  mock.get("/v2/task_assignments", {fixture: "task_assignments"});
  mock.get("/v2/user_assignments", {fixture: "user_assignments"});
  mock.get("/v2/expense_categories", {fixture: "expense_categories"});
  mock.get("/v2/invoice_item_categories", {fixture: "invoice_item_categories"});
  mock.get("/v2/time_entries", {fixture: "time_entries"});
  mock.get("/v2/expenses", {fixture: "expenses"});
  mock.get("/v2/invoices", {fixture: "invoices"});
  mock.get(ECB_RATES_URL, {fixture: "eurofxref-daily.xml",
                           headers: {"Content-Type": "application/xml"}});
}

function sumOf(column) {
  return dwh.measures.timesheets.rows({columns: [column]}).
    reduce((total, row) => total + (row[column] || 0), 0);
}

function sumOfInvoices(column) {
  return dwh.measures.invoices.rows({columns: [column]}).
    reduce((total, row) => total + (row[column] || 0), 0);
}

function storedGenerations() {
  var tables = [dwh.measures.timesheets, dwh.measures.invoices].
    concat(app.importers.sweep.dimensionTables());
  return _.uniq(_.flatten(tables.map((table) =>
    table.rows({columns: ["generation"]}).map((row) => row.generation))));
}

function storedRowCounts() {
  var tables = [dwh.measures.timesheets, dwh.measures.invoices].
    concat(app.importers.sweep.dimensionTables());
  return tables.map((table) => table.rows().length);
}

// An invoice of the European client, issued in the given currency.
function invoiceIn(currency) {
  return {id: 1242635, number: "3", state: "draft", currency: currency, amount: 100, due_amount: 100,
          issue_date: "2012-03-01", due_date: "2012-03-31", client: {id: 915262}, line_items: []};
}

function currencyRates() {
  return dwh.dimensions.currencies.rows({columns: ["currency", "eur_rate"], orderBy: "currency"});
}

function accountCurrencies() {
  return dwh.dimensions.currencies.rows({columns: ["currency", "account_currency"], orderBy: "currency"}).
    filter((row) => row.account_currency).map((row) => row.currency);
}

function timeEntryIds() {
  return dwh.measures.timesheets.rows({columns: ["_source_id", "_source_name"]}).
    filter((row) => row._source_name === "custom_harvest time entry").map((row) => row._source_id);
}

function itemPositionsOf(invoiceId) {
  return dwh.dimensions.invoice_items.rows({columns: ["invoice_id", "position"], orderBy: "position"}).
    filter((item) => item.invoice_id === invoiceId).map((item) => item.position);
}

function updatedSinceOf(path) {
  var requests = mock.requests().filter((request) => request.path === path);
  return requests[requests.length - 1].params.updated_since;
}

function mockNothingChangedSinceMark() {
  var mark = importRun.maxParams().updated_at;
  mock.get("/v2/expenses", {params: {updated_since: mark}, json: {expenses: []}});
  mock.get("/v2/invoices", {params: {updated_since: mark}, json: {invoices: []}});
  return mark;
}

function classificationDigestOf(classification) {
  return app.importers.workingTimes.digestOf(classification);
}

// The digest of the business hours and the non-working days which the stored time entries were classified
// by, or null.
function storedClassification() {
  var member = _.findWhere(dwh.dimensions.working_times.rows({columns: ["id", "classification"]}), {id: 1});
  return member ? member.classification : null;
}

// The Business hours member of an import which classified the time entries by the default import options,
// so that an import with mocked marks reads only the changed time entries.
function mockClassifiedTimeEntries() {
  dwh.dimensions.working_times.insert({id: 1, name: "Business hours",
                                       classification: classificationDigestOf(DEFAULT_CLASSIFICATION)});
}

// The fixture time entries with the eight hours of a Monday tracked from 9:00am to 5:00pm, and more entries.
function mockTimedTimeEntries(moreEntries) {
  var entries = mock.fixture("time_entries");
  _.extend(_.findWhere(entries.time_entries, {id: 74615858}), {started_time: "9:00am", ended_time: "5:00pm"});
  entries.time_entries = entries.time_entries.concat(moreEntries || []);
  mock.get("/v2/time_entries", {json: entries});
}

function workingTimeHours() {
  return olap.results(`
    SELECT {[Measures].[Hours]} ON COLUMNS,
           NON EMPTY [Working Time].[Working Time].Members ON ROWS
    FROM [Harvest Timesheets]
  `);
}

function personRoles() {
  return dwh.dimensions.person_roles.rows({columns: ["person_id", "name"], orderBy: ["person_id", "name"]});
}

function mockRolesOf(userId, roles) {
  var users = mock.fixture("users");
  users.users.forEach((user) => {
    if (user.id === userId) user.roles = roles;
  });
  mock.get("/v2/users", {json: users});
}

function capacityPeople() {
  return _.uniq(dwh.measures.timesheets.rows({columns: ["_source_name", "person_id"]}).
    filter((row) => row._source_name === "custom_harvest capacity").map((row) => row.person_id)).sort();
}

function projectManagers() {
  return dwh.dimensions.project_managers.rows({columns: ["project_id", "name"],
                                               orderBy: ["project_id", "name"]});
}

// The fixture name is the name of the list in the response as well.
function mockListWithout(path, fixture, deleted) {
  var list = mock.fixture(fixture);
  list[fixture] = list[fixture].filter((record) => !deleted(record));
  mock.get(path, {json: list});
}

// Deletes the Internal project with its time entry and its assignments, a time entry of another project,
// an expense, the invoice of the US client and the last line item of another invoice.
var INTERNAL_PROJECT_ID = 1930099;
function deleteRecordsInHarvest() {
  var ofInternalProject = (record) => record.project.id === INTERNAL_PROJECT_ID;
  mockListWithout("/v2/projects", "projects", (project) => project.id === INTERNAL_PROJECT_ID);
  mockListWithout("/v2/task_assignments", "task_assignments", ofInternalProject);
  mockListWithout("/v2/user_assignments", "user_assignments", ofInternalProject);
  mockListWithout("/v2/time_entries", "time_entries",
    (entry) => ofInternalProject(entry) || entry.id === 74615858);
  mockListWithout("/v2/expenses", "expenses", (expense) => expense.id === 1545413);

  var invoices = mock.fixture("invoices");
  invoices.invoices = invoices.invoices.filter((invoice) => invoice.id !== 1242635);
  invoices.invoices.forEach((invoice) => {
    if (invoice.id === 10577835) invoice.line_items.pop();
  });
  mock.get("/v2/invoices", {json: invoices});
}

function expectDeletedRecordsRemoved() {
  var entryIds = timeEntryIds();
  expect(entryIds).toHaveLength(12);
  expect(entryIds).not.toContain("74615831");
  expect(entryIds).not.toContain("74615858");
  expect(sumOf("rounded_hours")).toBeCloseTo(64.1);
  expect(sumOf("expenses_amount")).toBeCloseTo(600.0);

  // The project, its nameless project member and the four tasks it assigned.
  expect(dwh.dimensions.projects.rows({columns: ["id"]}).map((project) => project.id)).
    not.toContain(INTERNAL_PROJECT_ID);
  expect(dwh.dimensions.projects.rows()).toHaveLength(7);
  expect(projectManagers().map((row) => row.project_id)).not.toContain(INTERNAL_PROJECT_ID);
  expect(projectManagers()).toHaveLength(7);
  expect(dwh.dimensions.project_tasks.rows({columns: ["project_id"]}).
    filter((projectTask) => projectTask.project_id === INTERNAL_PROJECT_ID)).toEqual([]);
  expect(dwh.dimensions.project_tasks.rows()).toHaveLength(15);

  expect(dwh.dimensions.invoices.rows({columns: ["id"], orderBy: "id"})).
    toEqual([{id: 1241021}, {id: 10577835}]);
  expect(itemPositionsOf(1242635)).toEqual([]);
  expect(itemPositionsOf(10577835)).toEqual([-1, 1, 2, 3, 4]);
  // The two rows of each of the two invoices and their five line items.
  expect(dwh.measures.invoices.rows()).toHaveLength(9);
  expect(sumOfInvoices("invoice_amount")).toBeCloseTo(2883.2);
  expect(sumOfInvoices("item_amount")).toBeCloseTo(2160.0);
}

// Two selected projects: the eazyBI development project of the eazyBI client, whose Internal and
// FIXED-PRICE projects are not selected, and the consulting project of the European client. No project of
// the Big US company client is selected, which has the four expenses and one invoice of the fixtures.
var SELECTED_PROJECT_IDS = [1930103, 1930115];
var SELECTION = ["project/1930103", "project/1930115"];

function mockListsOfProjects(projectIds) {
  ["time_entries", "expenses"].forEach((list) => projectIds.forEach((projectId) => {
    var records = mock.fixture(list);
    records[list] = records[list].filter((record) => record.project.id === projectId);
    mock.get(`/v2/${list}`, {params: {project_id: String(projectId)}, json: records});
  }));
}

// An invoice of the eazyBI client, of an item of its selected project and an item of its Internal project.
var INVOICE_OF_EAZYBI_ID = 1242700;
function mockInvoiceOfEazybi(changeFixtureInvoices) {
  var invoices = mock.fixture("invoices");
  if (changeFixtureInvoices) changeFixtureInvoices(invoices.invoices);
  invoices.invoices.push({id: INVOICE_OF_EAZYBI_ID, number: "4", state: "open", currency: "USD",
    amount: 300, due_amount: 300, issue_date: "2012-03-01", due_date: "2012-03-31",
    client: {id: 915259}, line_items: [
      {kind: "Service", description: "Development", amount: 100, project: {id: 1930103}},
      {kind: "Service", description: "Admin", amount: 200, project: {id: INTERNAL_PROJECT_ID}}
    ]});
  mock.get("/v2/invoices", {json: invoices});
}

function mockCurrencyOfClient(clientId, currency) {
  var clients = mock.fixture("clients");
  clients.clients.forEach((client) => {
    if (client.id === clientId) client.currency = currency;
  });
  mock.get("/v2/clients", {json: clients});
}

function mockClientOfProject(projectId, client) {
  var projects = mock.fixture("projects");
  projects.projects.forEach((project) => {
    if (project.id === projectId) project.client = client;
  });
  mock.get("/v2/projects", {json: projects});
}

function mockSelectedProjects(selection) {
  mockHarvestAccount();
  mock.sourceSelection(selection || SELECTION);
  mockListsOfProjects(SELECTED_PROJECT_IDS);
  mockInvoiceOfEazybi();
}

function idsOf(table) {
  return table.rows({columns: ["id"], orderBy: "id"}).map((row) => row.id);
}

// The params of the requests of a list, in request order — of the requests after the first `skipped` ones
// of the test, which are the requests of the imports before.
function requestParamsOf(path, skipped) {
  return mock.requests().slice(skipped || 0).filter((request) => request.path === path).
    map((request) => request.params);
}

function expectSelectedProjectsImported() {
  expect(idsOf(dwh.dimensions.clients)).toEqual([915259, 915262]);
  expect(idsOf(dwh.dimensions.projects)).toEqual([-915262, -915259, 1930103, 1930115]);
  expect(projectManagers().map((row) => row.project_id)).toEqual([-915262, -915259, 1930103, 1930115]);
  expect(_.uniq(dwh.dimensions.project_tasks.rows({columns: ["project_id"]}).
    map((projectTask) => projectTask.project_id)).sort()).toEqual([1930103, 1930115]);
  // Five entries of nonzero hours of the eazyBI development project and one of the consulting project.
  expect(timeEntryIds()).toHaveLength(6);
  expect(sumOf("rounded_hours")).toBeCloseTo(32.1);
  expect(sumOf("expenses_amount")).toBeCloseTo(0);
  // The cost budget of the eazyBI development project and the 160 hours of a person of the consulting one.
  expect(sumOf("budgeted_cost")).toBeCloseTo(10000);
  expect(sumOf("budgeted_hours")).toBeCloseTo(160);
  expect(idsOf(dwh.dimensions.invoices)).toEqual([1241021, INVOICE_OF_EAZYBI_ID, 10577835]);
}

describe("app.importer.importAll", () => {
  describe("of the whole Harvest account", () => {
    beforeAll(() => {
      mockHarvestAccount();

      importRun.run();
    });

    test("imports the clients with the currency they are billed in", () => {
      expect(dwh.dimensions.clients.rows({columns: ["id", "name", "currency"], orderBy: "id"})).
        toEqual([
          {id: 915259, name: "eazyBI", currency: "USD"},
          {id: 915261, name: "Big US company", currency: "USD"},
          {id: 915262, name: "Small European company", currency: "EUR"}
        ]);
    });

    test("imports the projects with the code in the name, the status and the manager", () => {
      expect(dwh.dimensions.projects.rows({
        columns: ["id", "client_id", "name", "code", "status", "project_manager", "budget_by",
                  "bill_by", "hourly_rate", "starts_on", "ends_on", "created_at"],
        orderBy: "id"
      }).filter((project) => project.id > 0)).toEqual([
        {id: 1930099, client_id: 915259, name: "Internal", code: null, status: "Active",
         project_manager: "Riley Smith", budget_by: "none", bill_by: "none",
         hourly_rate: null, starts_on: null, ends_on: null, created_at: "2012-02-20"},
        {id: 1930103, client_id: 915259, name: "[EAZYBI] eazyBI development", code: "EAZYBI",
         status: "Active", project_manager: "Riley Smith", budget_by: "project_cost",
         bill_by: "Project", hourly_rate: 67.89, starts_on: "2012-01-30", ends_on: "2012-04-30",
         created_at: "2012-02-20"},
        {id: 1930109, client_id: 915261,
         name: "[IMPL-BIGUS] eazyBI implementation for Big US company", code: "IMPL-BIGUS",
         status: "Active", project_manager: "Riley Smith", budget_by: "project",
         bill_by: "People", hourly_rate: null, starts_on: null, ends_on: "2012-04-30",
         created_at: "2012-02-20"},
        {id: 1930115, client_id: 915262,
         name: "[CONS-SMALLEU] Consulting for Small European company", code: "CONS-SMALLEU",
         status: "Active", project_manager: "Riley Smith", budget_by: "person",
         bill_by: "People", hourly_rate: null, starts_on: "2012-02-01", ends_on: null,
         created_at: "2012-02-20"},
        {id: 11637625, client_id: 915259, name: "FIXED-PRICE", code: null, status: "Active",
         project_manager: "Riley Smith", budget_by: "task_fees", bill_by: "Project",
         hourly_rate: null, starts_on: null, ends_on: null, created_at: "2012-02-20"}
      ]);
    });

    test("imports one nameless project of every client", () => {
      expect(dwh.dimensions.projects.rows({columns: ["id", "client_id", "name"], orderBy: "id"}).
        filter((project) => project.id < 0)).toEqual([
          {id: -915262, client_id: 915262, name: null},
          {id: -915261, client_id: 915261, name: null},
          {id: -915259, client_id: 915259, name: null}
        ]);
    });

    test("imports the tasks of the account from both cursor pages", () => {
      expect(dwh.dimensions.tasks.rows({columns: ["id", "name", "billable_by_default", "hourly_rate"],
        orderBy: "name"})).toEqual([
          {id: 1245122, name: "Admin", billable_by_default: false, hourly_rate: null},
          {id: 1245124, name: "Business Development", billable_by_default: false, hourly_rate: null},
          {id: 1245133, name: "Consulting", billable_by_default: true, hourly_rate: 100},
          {id: 1245127, name: "Development", billable_by_default: true, hourly_rate: null},
          {id: 1245123, name: "Project Management", billable_by_default: false, hourly_rate: null},
          {id: 1245128, name: "Support", billable_by_default: true, hourly_rate: null},
          {id: 1245125, name: "Vacation", billable_by_default: false, hourly_rate: null}
        ]);
    });

    test("imports the task assignments of every project as its project tasks", () => {
      var projectTasks = dwh.dimensions.project_tasks.rows({
        columns: ["id", "project_id", "task_id", "name", "billable", "hourly_rate"], orderBy: "id"});

      expect(projectTasks.filter((projectTask) => projectTask.id > 0)).toHaveLength(15);
      expect(projectTasks).toContainEqual({id: 19171458, project_id: 1930099, task_id: 1245122,
        name: "Admin", billable: false, hourly_rate: 123.45});
      expect(projectTasks).toContainEqual({id: 19171535, project_id: 1930109, task_id: 1245133,
        name: "Consulting", billable: true, hourly_rate: null});
      expect(projectTasks.filter((projectTask) => projectTask.id < 0).map((row) => row.project_id).
        sort()).toEqual([1930099, 1930103, 1930109, 1930115, 11637625].sort());
    });

    test("imports the people as employees and contractors", () => {
      expect(dwh.dimensions.people.rows({
        columns: ["id", "name", "person_type", "is_contractor", "is_active", "weekly_capacity_hours",
                  "default_hourly_rate", "cost_rate", "created_at", "first_tracked_date", "last_tracked_date",
                  "email"],
        orderBy: "id"
      })).toEqual([
        {id: 312294, name: "Riley Smith", person_type: "Employees", is_contractor: false,
         is_active: true, weekly_capacity_hours: 35, default_hourly_rate: 100, cost_rate: 50,
         created_at: "2012-02-20", first_tracked_date: "2012-01-30", last_tracked_date: "2012-02-10",
         email: "riley@example.com"},
        {id: 312875, name: "Chuck Norris", person_type: "Contractors", is_contractor: true,
         is_active: true, weekly_capacity_hours: 35, default_hourly_rate: 100, cost_rate: 75,
         created_at: "2012-02-21", first_tracked_date: null, last_tracked_date: null,
         email: "chuck@example.com"}
      ]);
    });

    test("imports the managers of every project and a manager row for the nameless projects", () => {
      expect(projectManagers()).toEqual([
        {project_id: -915262, name: "(no manager)"}, {project_id: -915261, name: "(no manager)"},
        {project_id: -915259, name: "(no manager)"},
        {project_id: 1930099, name: "Riley Smith"},
        {project_id: 1930103, name: "Riley Smith"},
        {project_id: 1930109, name: "Riley Smith"},
        {project_id: 1930115, name: "Riley Smith"},
        {project_id: 11637625, name: "Riley Smith"}
      ]);
    });

    test("imports the expense categories of the account", () => {
      expect(dwh.dimensions.expense_categories.rows({columns: ["name"], orderBy: "name"}).
        map((row) => row.name)).toEqual([
          "Entertainment", "Lodging", "Meals", "Mileage", "Other", "Transportation"
        ]);
    });

    test("imports the invoice item categories of the account", () => {
      expect(dwh.dimensions.invoice_item_categories.rows({columns: ["id", "name"], orderBy: "name"})).
        toEqual([{id: 308626, name: "Product"}, {id: 308625, name: "Service"}]);
    });

    test("imports the currencies of the clients with their euro reference rate and the account flag", () => {
      expect(dwh.dimensions.currencies.rows({columns: ["currency", "eur_rate", "account_currency"],
                                              orderBy: "currency"})).
        toEqual([{currency: "EUR", eur_rate: 1, account_currency: true},
                 {currency: "USD", eur_rate: 1.3388, account_currency: false}]);
    });

    test("imports the notes of the time entries and the expenses without truncating them", () => {
      var notes = dwh.measures.timesheets.rows({columns: ["notes"]}).
        map((row) => row.notes).filter((note) => note);

      expect(_.uniq(notes)).toHaveLength(14);
      expect(notes).toContain("Forgotten timer");
      expect(_.max(notes, (note) => note.length).length).toBeGreaterThan(300);
    });

    // No fixture entry has a start and an end time, and all of them are of a weekday. An expense and a
    // budget belong to no time of day.
    test("reports the time entries by their working time and the expenses and the budgets by none", () => {
      var rows = dwh.measures.timesheets.rows({columns: ["_source_name", "working_time_id"]});
      var isTimeEntry = (row) => row._source_name === "custom_harvest time entry";

      expect(_.uniq(rows.filter(isTimeEntry).map((row) => row.working_time_id))).toEqual([1]);
      expect(_.uniq(rows.filter((row) => !isTimeEntry(row)).map((row) => row.working_time_id))).
        toEqual([null]);
      expect(olap.results(`
        SELECT {[Measures].[Hours], [Measures].[Expenses amount]} ON COLUMNS,
               NON EMPTY [Working Time].[Working Time].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["Business hours", 80.1, null]]);
    });

    test("writes one import scope per time entry, expense, budgeted project and person with capacity", () => {
      var sourceNames = _.uniq(dwh.measures.timesheets.rows({columns: ["_source_name"]}).
        map((row) => row._source_name)).sort();

      expect(sourceNames).toEqual([
        "custom_harvest budget", "custom_harvest capacity", "custom_harvest expense",
        "custom_harvest time entry"
      ]);
    });

    test("reads every list of the account once and never per project", () => {
      expect(mock.requestedPaths().filter((path) => path.indexOf("/v2/projects/") === 0)).toEqual([]);
      expect(mock.requestedPaths().filter((path) => path === "/v2/time_entries")).toHaveLength(1);
      expect(mock.requestedPaths().filter((path) => path === "/v2/expenses")).toHaveLength(1);
    });

    test("stores the incremental mark and the selection of the import and reports no failure", () => {
      expect(importRun.objectFailures()).toEqual([]);
      expect(importRun.maxParams().updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(importRun.maxParams().selection).toBe("(all)");
    });

    // Harvest stamps a change with its second, so the next import reads the second the import started in.
    test("stores the incremental mark one second before the import started", () => {
      expect(app.importer.markOf("2026-01-01T00:00:00Z")).toBe("2025-12-31T23:59:59Z");
      expect(importRun.maxParams().updated_at).toBe(app.importer.markOf(importRun.maxParams().sweep_at));
    });

    test("writes generation 1 to every row and member and marks the check for deleted records", () => {
      expect(storedGenerations()).toEqual([1]);
      expect(importRun.maxParams().generation).toBe(1);
      expect(importRun.maxParams().updated_at).toBe(app.importer.markOf(importRun.maxParams().sweep_at));
    });

    test("aggregates the hours of every project through the schema", () => {
      var results = olap.results(`
        SELECT {[Measures].[Hours], [Measures].[Rounded hours], [Measures].[Billable hours],
                [Measures].[Invoiced hours], [Measures].[Billable amount], [Measures].[Expenses amount],
                [Measures].[Budgeted hours], [Measures].[Budgeted cost]} ON COLUMNS,
               NON EMPTY [Project Task].[Project].Members ON ROWS
        FROM [Harvest Timesheets]
      `);

      expect(_.sortBy(results, (row) => row[0])).toEqual([
        ["FIXED-PRICE", null, null, null, null, null, null, null, 21122],
        ["Internal", 8.05, 8.1, null, null, null, null, null, null],
        ["[CONS-SMALLEU] Consulting for Small European company", 8.05, 8.1, 8.1, 8.1, 567, null, 160,
         null],
        ["[EAZYBI] eazyBI development", 24, 24, null, null, null, null, null, 10000],
        ["[IMPL-BIGUS] eazyBI implementation for Big US company", 40, 40, 24, null, 2160, 1500, 500,
         null]
      ]);
    });

    test("aggregates the hours of the people and of their roles", () => {
      expect(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Person].[Person].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["Riley Smith", 80.2]]);

      expect(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Role].[Role].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["(no role)", 80.2]]);
    });

    test("aggregates the hours and the invoices of the managers of the projects", () => {
      expect(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Project Manager].[Project Manager].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["Riley Smith", 80.2]]);

      // Only one line item is billed for a project, the one of the consulting project.
      expect(olap.results(`
        SELECT {[Measures].[Invoice amount], [Measures].[Item amount]} ON COLUMNS,
               NON EMPTY [Project Manager].[Project Manager].Members ON ROWS
        FROM [Harvest Invoices]
      `)).toEqual([["(no manager)", 3083.2, 2400], ["Riley Smith", null, 560]]);
    });

    test("aggregates the amounts of every currency", () => {
      expect(olap.results(`
        SELECT {[Measures].[Billable amount], [Measures].[Invoiced amount],
                [Measures].[Expenses amount]} ON COLUMNS,
               NON EMPTY [Currency].[Currency].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["EUR", 567, 567, null], ["USD", 2160, null, 1500]]);
    });

    test("aggregates the hours of the days the time was spent on", () => {
      expect(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Time].[Month].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["Jan 2012", 16.1], ["Feb 2012", 64.1]]);
    });

    test("imports the invoices with their client, status, dates and PO number", () => {
      expect(dwh.dimensions.invoices.rows({
        columns: ["id", "name", "number", "issued_date", "due_date", "period_start_date",
                  "period_end_date", "currency", "client_name", "status", "created_by",
                  "purchase_order"],
        orderBy: "id"
      })).toEqual([
        {id: 1241021, name: "#1 Small European company (1241021)", number: "1",
         issued_date: "2012-02-20",
         due_date: "2012-02-20", period_start_date: "2012-02-02", period_end_date: "2012-02-02",
         currency: "EUR", client_name: "Small European company", status: "Paid",
         created_by: "Riley Smith", purchase_order: "PO-1241021"},
        {id: 1242635, name: "#2 Big US company", number: "2", issued_date: "2012-02-21",
         due_date: "2012-03-07", period_start_date: null, period_end_date: null, currency: "USD",
         client_name: "Big US company", status: "Draft", created_by: null,
         purchase_order: "PO-1242635"},
        {id: 10577835, name: "#1 Small European company (10577835)", number: "1",
         issued_date: "2016-09-05",
         due_date: "2016-09-05", period_start_date: null, period_end_date: null, currency: "EUR",
         client_name: "Small European company", status: "Open", created_by: "Riley Smith",
         purchase_order: "PO-10577835"}
      ]);
    });

    test("imports the line items of every invoice, keyed by their position on it", () => {
      var items = dwh.dimensions.invoice_items.rows({
        columns: ["invoice_id", "position", "description", "category", "project", "quantity",
                  "unit_price"],
        orderBy: ["invoice_id", "position"]
      });

      expect(items.filter((item) => item.position > 0)).toHaveLength(7);
      expect(items).toContainEqual({invoice_id: 1241021, position: 1,
        description: "[CONS-SMALLEU] Consulting for Small European company: Consulting " +
                     "(2012-02-02 - 2012-02-02)",
        category: "Service", project: "[CONS-SMALLEU] Consulting for Small European company",
        quantity: 8, unit_price: 70});
      expect(items).toContainEqual({invoice_id: 10577835, position: 4, description: "123sdf",
        category: "Service", project: null, quantity: 5, unit_price: 100});
    });

    // 13 rows: the amounts and the due amount of each of the three invoices, and their seven items.
    test("writes one import scope per invoice, of the invoice rows and of its item rows", () => {
      var rows = dwh.measures.invoices.rows({columns: ["_source_id", "_source_name"]});

      expect(rows).toHaveLength(13);
      expect(_.uniq(rows.map((row) => row._source_name))).toEqual(["custom_harvest invoice"]);
      expect(_.uniq(rows.map((row) => row._source_id)).sort()).
        toEqual(["1241021", "1242635", "10577835"].sort());
    });

    test("aggregates the invoices of every client through the schema", () => {
      expect(olap.results(`
        SELECT {[Measures].[Invoice amount], [Measures].[Item amount], [Measures].[Due amount]}
                 ON COLUMNS,
               NON EMPTY [Client Project].[Client].Members ON ROWS
        FROM [Harvest Invoices]
      `)).toEqual([
        ["Big US company", 200, 200, 200],
        // The amount of the paid invoice of this client is not due any more.
        ["Small European company", 2883.2, 2760, 2200]
      ]);
    });

    test("aggregates the invoices of every currency and of every status", () => {
      expect(olap.results(`
        SELECT {[Measures].[Invoice amount], [Measures].[Item amount], [Measures].[Due amount]}
                 ON COLUMNS,
               NON EMPTY [Currency].[Currency].Members ON ROWS
        FROM [Harvest Invoices]
      `)).toEqual([["EUR", 2883.2, 2760, 2200], ["USD", 200, 200, 200]]);

      expect(olap.results(`
        SELECT {[Measures].[Invoice amount]} ON COLUMNS,
               NON EMPTY [Invoice Status].[Invoice Status].Members ON ROWS
        FROM [Harvest Invoices]
      `)).toEqual([["Draft", 200], ["Open", 2200], ["Paid", 683.2]]);
    });

    // The invoice issued on February 21 is due the next month.
    test("aggregates the invoices of the days they were issued and are due on", () => {
      expect(olap.results(`
        SELECT {[Measures].[Invoice amount], [Measures].[Item amount], [Measures].[Due amount]}
                 ON COLUMNS,
               NON EMPTY [Time].[Month].Members ON ROWS
        FROM [Harvest Invoices]
      `)).toEqual([
        ["Feb 2012", 883.2, 760, 0],
        ["Mar 2012", null, null, 200],
        ["Sep 2016", 2200, 2200, 2200]
      ]);
    });
  });

  // Every test of this describe imports itself, because it changes what the import imports.
  describe("of the changes of an account", () => {
    beforeEach(mockHarvestAccount);

    test("asks Harvest for the time entries, expenses and invoices changed since the last import", () => {
      mock.maxParams({updated_at: "2026-01-01T00:00:00Z", generation: 1, sweep_at: TODAY});
      mockClassifiedTimeEntries();

      importRun.run();

      var requestsByPath = _.indexBy(mock.requests(), (request) => request.path);
      expect(requestsByPath["/v2/time_entries"].params.updated_since).toBe("2026-01-01T00:00:00Z");
      expect(requestsByPath["/v2/expenses"].params.updated_since).toBe("2026-01-01T00:00:00Z");
      expect(requestsByPath["/v2/invoices"].params.updated_since).toBe("2026-01-01T00:00:00Z");
      expect(requestsByPath["/v2/projects"].params.updated_since).toBeUndefined();
      expect(requestsByPath["/v2/users"].params.updated_since).toBeUndefined();
    });

    test("asks for everything again when the user starts a reimport", () => {
      mock.maxParams({updated_at: "2026-01-01T00:00:00Z"});

      importRun.run({reimport: true});

      var requestsByPath = _.indexBy(mock.requests(), (request) => request.path);
      expect(requestsByPath["/v2/time_entries"].params.updated_since).toBeUndefined();
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
    });

    // The expenses and the invoices do not depend on the business hours and stay incremental.
    test("classifies every time entry again with the import after the business hours changed", () => {
      mockTimedTimeEntries();
      importRun.run();
      expect(workingTimeHours()).toEqual([["Business hours", 80.1]]);
      var mark = mockNothingChangedSinceMark();

      mock.extraOptions({time_dimension_time_zone: "UTC", business_hours_end: "13:00"});
      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBeUndefined();
      expect(updatedSinceOf("/v2/expenses")).toBe(mark);
      expect(workingTimeHours()).toEqual([["Business hours", 76.1], ["Non-business hours", 4]]);
      expect(storedClassification()).toBe(classificationDigestOf("540-780;6,7;"));
    });

    // "57" is Friday and Sunday here.
    test("classifies every time entry again with the import after the non-working days changed", () => {
      importRun.run();
      expect(workingTimeHours()).toEqual([["Business hours", 80.1]]);
      mockNothingChangedSinceMark();

      mock.extraOptions({time_dimension_time_zone: "UTC", time_dimension_non_working_weekdays: "57"});
      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBeUndefined();
      expect(workingTimeHours()).toEqual([["Business hours", 64.1], ["Non-business hours", 16]]);
      expect(storedClassification()).toBe(classificationDigestOf("540-1020;5,7;"));
    });

    test("asks for the changed time entries while the business hours and the non-working days stay", () => {
      importRun.run();
      expect(storedClassification()).toBe(classificationDigestOf(DEFAULT_CLASSIFICATION));
      var mark = mockNothingChangedSinceMark();
      mock.get("/v2/time_entries", {params: {updated_since: mark}, json: {time_entries: []}});

      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
      expect(workingTimeHours()).toEqual([["Business hours", 80.1]]);
    });

    // The rows of an import of the app before it stored what it classified the time entries by.
    test("reads every time entry when it is not stored what the time entries were classified by", () => {
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: TODAY});

      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBeUndefined();
      expect(updatedSinceOf("/v2/expenses")).toBe(LONG_AGO);
      expect(storedClassification()).toBe(classificationDigestOf(DEFAULT_CLASSIFICATION));
    });

    // The import with the 13:00 end classified the entries it wrote before a time entry failed by it, so the
    // import after the end is changed back to 17:00, the one of the digest before, reads every entry again.
    test("reads every time entry again after a time entry failed to import while they were classified", () => {
      mockTimedTimeEntries();
      importRun.run();
      mock.extraOptions({time_dimension_time_zone: "UTC", business_hours_end: "13:00"});
      mockTimedTimeEntries([{id: 99, spent_date: "2012-02-01", hours_without_timer: 3, rounded_hours: 3,
        is_closed: false, is_billed: false, project: {id: 4242}, task: {id: 1245122}, user: {id: 312294}}]);

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["project/4242"]);
      expect(workingTimeHours()).toEqual([["Business hours", 76.1], ["Non-business hours", 4]]);
      expect(storedClassification()).toBeNull();

      mockHarvestAccount();
      mockTimedTimeEntries();
      mockNothingChangedSinceMark();
      importRun.run();

      expect(importRun.objectFailures()).toEqual([]);
      expect(updatedSinceOf("/v2/time_entries")).toBeUndefined();
      expect(workingTimeHours()).toEqual([["Business hours", 80.1]]);
      expect(storedClassification()).toBe(classificationDigestOf(DEFAULT_CLASSIFICATION));
    });

    test("reads every time entry again after an import failed with an error while they were classified", () => {
      mockTimedTimeEntries();
      importRun.run();
      var maxParams = importRun.maxParams();
      mock.extraOptions({time_dimension_time_zone: "UTC", business_hours_end: "13:00"});
      mock.get("/v2/invoices", {status: 404, json: {message: "Not Found"}});

      expect(() => importRun.run()).toThrow();

      expect(workingTimeHours()).toEqual([["Business hours", 76.1], ["Non-business hours", 4]]);
      expect(storedClassification()).toBeNull();

      mockHarvestAccount();
      mockTimedTimeEntries();
      mock.maxParams(maxParams);
      mockNothingChangedSinceMark();
      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBeUndefined();
      expect(workingTimeHours()).toEqual([["Business hours", 80.1]]);
      expect(storedClassification()).toBe(classificationDigestOf(DEFAULT_CLASSIFICATION));
    });

    // A max param value holds 1000 characters at most, while a digest has the same length for any dates.
    test("stores what the time entries were classified by also with many additional non-working days", () => {
      var dates = _.range(120).map((day) => new Date(Date.UTC(2026, 0, 1 + day)).toISOString().substring(0, 10));
      mock.extraOptions({time_dimension_time_zone: "UTC",
                         time_dimension_additional_non_working_days: dates.join(",")});
      importRun.run();

      expect(importRun.objectFailures()).toEqual([]);
      expect(storedClassification()).
        toBe(classificationDigestOf(`${DEFAULT_CLASSIFICATION}${dates.join(",")}`));
      expect(storedClassification().length).toBeLessThanOrEqual(14);

      var mark = mockNothingChangedSinceMark();
      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
    });

    test("imports the same account twice without doubling anything", () => {
      importRun.run();
      var firstImportRows = dwh.measures.timesheets.rows().length;

      mockHarvestAccount();
      importRun.run();

      expect(dwh.measures.timesheets.rows().length).toBe(firstImportRows);
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
      expect(sumOf("expenses_amount")).toBeCloseTo(1500.0);
      expect(dwh.dimensions.projects.rows().length).toBe(8);
      expect(dwh.measures.invoices.rows().length).toBe(13);
      expect(sumOfInvoices("invoice_amount")).toBeCloseTo(3083.2);
      expect(dwh.dimensions.invoice_items.rows().length).toBe(10);
    });

    test("reports every row of a person under the roles the person has now", () => {
      importRun.run();
      mockRolesOf(312294, ["Consultant", "VIP"]);
      var mark = mockNothingChangedSinceMark();
      mock.get("/v2/time_entries", {params: {updated_since: mark}, json: {time_entries: []}});

      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
      expect(personRoles()).toEqual([
        {person_id: 312294, name: "Consultant"}, {person_id: 312294, name: "VIP"},
        {person_id: 312875, name: "VIP"}
      ]);
      expect(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Role].[Role].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["Consultant", 80.2], ["VIP", 80.2]]);
    });

    test("writes the role rows of a person again only when the roles changed or with a check", () => {
      importRun.run();
      var insertRows = mock.spyOn(dwh.dimensions.person_roles, "insertRows");

      importRun.run();
      expect(insertRows).not.toHaveBeenCalled();

      mockRolesOf(312294, ["Consultant"]);
      importRun.run();
      expect(insertRows).toHaveBeenCalledTimes(1);
      expect(insertRows).toHaveBeenLastCalledWith([{person_id: 312294, name: "Consultant", generation: 1}]);

      insertRows.mockClear();
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      importRun.run();
      expect(insertRows).toHaveBeenCalledTimes(2);
      expect(_.uniq(dwh.dimensions.person_roles.rows({columns: ["generation"]}).
        map((row) => row.generation))).toEqual([2]);
      expect(personRoles()).toEqual([
        {person_id: 312294, name: "Consultant"}, {person_id: 312875, name: "VIP"}
      ]);
    });

    test("imports no expenses when the account does not track them", () => {
      mock.get("/v2/company", {json: {base_uri: SITE_URL, name: "API Examples",
                                      expense_feature: false, invoice_feature: true}});

      importRun.run();

      expect(mock.requestedPaths()).not.toContain("/v2/expenses");
      expect(mock.requestedPaths()).not.toContain("/v2/expense_categories");
      expect(sumOf("expenses_amount")).toBeCloseTo(0);
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
    });

    test("imports no invoices when the account does not invoice", () => {
      mock.get("/v2/company", {json: {base_uri: SITE_URL, name: "API Examples",
                                      expense_feature: true, invoice_feature: false}});

      importRun.run();

      expect(mock.requestedPaths()).not.toContain("/v2/invoices");
      expect(mock.requestedPaths()).not.toContain("/v2/invoice_item_categories");
      expect(dwh.measures.invoices.rows()).toEqual([]);
      expect(dwh.dimensions.invoices.rows()).toEqual([]);
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
    });

    test("stops before it writes anything when the account is at another web address", () => {
      mock.sourceParams({api_token: "secret-token", site_url: "https://other.harvestapp.com"});
      mock.get("https://id.getharvest.com/api/v2/accounts",
        {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});

      expect(() => importRun.run()).toThrow(`The Harvest account of this token is at ${SITE_URL}`);
      expect(dwh.dimensions.projects.rows()).toEqual([]);
      expect(dwh.measures.timesheets.rows()).toEqual([]);
    });

    test("stops before it writes anything when the user of the token is no administrator any more", () => {
      importRun.run();
      var timesheetRows = dwh.measures.timesheets.rows().length;
      var me = mock.fixture("users_me");
      me.access_roles = ["manager"];
      mock.get("/v2/users/me", {json: me});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});

      expect(() => importRun.run()).toThrow("is not a Harvest administrator any more");
      expect(dwh.measures.timesheets.rows()).toHaveLength(timesheetRows);
    });

    test("imports the account at the entered web address written in another case", () => {
      mock.sourceParams({api_token: "secret-token", site_url: `${SITE_URL.toUpperCase()}/`});
      mock.get("https://id.getharvest.com/api/v2/accounts",
        {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});

      importRun.run();

      expect(importRun.objectFailures()).toEqual([]);
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
    });
  });

  describe("of the records deleted in Harvest", () => {
    beforeEach(mockHarvestAccount);

    test("writes the generation of the last check with an import which does not check", () => {
      mock.maxParams({updated_at: LONG_AGO, generation: 2, sweep_at: TODAY});
      mockClassifiedTimeEntries();

      importRun.run();

      expect(storedGenerations()).toEqual([2]);
      var requestsByPath = _.indexBy(mock.requests(), (request) => request.path);
      expect(requestsByPath["/v2/time_entries"].params.updated_since).toBe(LONG_AGO);
      expect(importRun.maxParams()).toMatchObject({generation: 2, sweep_at: TODAY});
    });

    // The rows of an import of the app before it checked for deleted records carry no generation.
    test("removes with the first check what Harvest no longer lists", () => {
      mock.maxParams({updated_at: LONG_AGO, sweep_at: TODAY});
      importRun.run();
      expect(storedGenerations()).toEqual([null]);

      deleteRecordsInHarvest();
      mock.maxParams({updated_at: LONG_AGO});
      importRun.run();

      expectDeletedRecordsRemoved();
      expect(storedGenerations()).toEqual([1]);
      expect(importRun.maxParams().generation).toBe(1);
      var requestsByPath = _.indexBy(mock.requests(), (request) => request.path);
      expect(requestsByPath["/v2/time_entries"].params.updated_since).toBeUndefined();
    });

    // An import between two checks removes only the line items of an invoice Harvest reports as changed.
    test("removes what Harvest no longer lists with the next check and not before", () => {
      importRun.run();
      deleteRecordsInHarvest();

      importRun.run();
      expect(timeEntryIds()).toHaveLength(14);
      expect(itemPositionsOf(1242635)).toEqual([-1, 1]);
      expect(itemPositionsOf(10577835)).toEqual([-1, 1, 2, 3, 4]);

      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      importRun.run();

      expectDeletedRecordsRemoved();
      expect(storedGenerations()).toEqual([2]);
      expect(importRun.maxParams().generation).toBe(2);
      expect(importRun.maxParams().updated_at).toBe(app.importer.markOf(importRun.maxParams().sweep_at));
      expect(importRun.log().join("\n")).toMatch(/Removed \d+ fact rows and \d+ dimension members/);
    });

    test("removes the role rows and the capacity of a person Harvest no longer lists with the next check", () => {
      importRun.run();
      mockListWithout("/v2/users", "users", (user) => user.id === 312875);

      importRun.run();
      expect(personRoles()).toContainEqual({person_id: 312875, name: "VIP"});
      expect(capacityPeople()).toEqual([312294, 312875]);

      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      importRun.run();

      expect(personRoles()).toEqual([{person_id: 312294, name: "(no role)"}]);
      expect(dwh.dimensions.people.rows({columns: ["id"]})).toEqual([{id: 312294}]);
      expect(capacityPeople()).toEqual([312294]);
    });

    test("removes nothing and keeps the marks when a record failed to import", () => {
      importRun.run();
      deleteRecordsInHarvest();
      mock.get("/v2/time_entries", {json: {time_entries: [
        {id: 99, spent_date: "2012-02-01", hours_without_timer: 3, rounded_hours: 3, is_closed: false,
         is_billed: false, project: {id: 4242}, task: {id: 1245122}, user: {id: 312294}}
      ]}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["project/4242"]);
      expect(timeEntryIds()).toHaveLength(14);
      expect(dwh.dimensions.projects.rows()).toHaveLength(8);
      expect(dwh.dimensions.invoices.rows()).toHaveLength(3);
      expect(itemPositionsOf(1242635)).toEqual([-1, 1]);
      expect(importRun.maxParams()).toEqual({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO,
                                             currencies: "EUR,USD", sweep_pending: 2});
      expect(importRun.log().join("\n")).
        toContain("Records deleted in Harvest are not removed by this import");
    });

    // The check which removed nothing wrote the generation of the check after it, which cannot tell what
    // that check wrote from what it writes itself. So the import after it checks once more, also on the
    // day of the last check and with checks only with a full reimport.
    test("removes a record deleted after a check which removed nothing with the second import after it",
      () => {
        mock.extraOptions({time_dimension_time_zone: "UTC", deleted_records_check: "reimport"});
        importRun.run();
        var entries = mock.fixture("time_entries");
        ["1930103", "4242"].forEach((projectId, index) => entries.time_entries.push({id: 98 + index,
          spent_date: "2012-02-01", hours_without_timer: 3, rounded_hours: 3, is_closed: false,
          is_billed: false, project: {id: Number(projectId)}, task: {id: 1245127}, user: {id: 312294}}));
        mock.get("/v2/time_entries", {json: entries});
        mock.maxParams({updated_at: LONG_AGO, generation: 1});

        importRun.run();

        expect(importRun.objectFailures()).toEqual(["project/4242"]);
        expect(timeEntryIds()).toContain("98");
        expect(importRun.maxParams()).toMatchObject({generation: 1, sweep_pending: 2});

        // Harvest lists neither of the two entries any more.
        mockHarvestAccount();
        mock.extraOptions({time_dimension_time_zone: "UTC", deleted_records_check: "reimport"});
        mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: TODAY, sweep_pending: 2});
        importRun.run();

        expect(importRun.objectFailures()).toEqual([]);
        expect(timeEntryIds()).toContain("98");
        expect(importRun.maxParams()).toMatchObject({generation: 2, sweep_pending: 1});

        importRun.run();

        expect(timeEntryIds()).not.toContain("98");
        expect(timeEntryIds()).toHaveLength(14);
        expect(storedGenerations()).toEqual([1]);
        expect(importRun.maxParams()).toMatchObject({generation: 1, sweep_pending: 0});

        var mark = importRun.maxParams().updated_at;
        importRun.run();

        expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
        expect(importRun.maxParams().generation).toBe(1);
      });

    test("removes nothing and stores no mark when Harvest repeats a page URL during a check", () => {
      importRun.run();
      var storedCounts = storedRowCounts();
      var entries = mock.fixture("time_entries").time_entries;
      var secondPageUrl = "https://api.harvestapp.com/v2/time_entries?cursor=page2&per_page=2000";
      var links = {next: secondPageUrl};
      mock.get("/v2/time_entries", {json: {time_entries: entries.slice(0, 5), links: links}});
      mock.get("/v2/time_entries", {params: {cursor: "page2"},
                                    json: {time_entries: entries.slice(5, 10), links: links}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});

      expect(() => importRun.run()).
        toThrow(`Harvest repeated the page URL ${secondPageUrl} of time_entries`);

      expect(timeEntryIds()).toHaveLength(14);
      expect(storedRowCounts()).toEqual(storedCounts);
      expect(importRun.maxParams()).toEqual({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
    });

    test("removes a record deleted after an interrupted check with the check after the next one", () => {
      importRun.run();
      var entries = mock.fixture("time_entries");
      entries.time_entries.push({id: 99, spent_date: "2012-02-01", hours_without_timer: 3,
        rounded_hours: 3, is_closed: false, is_billed: false, project: {id: 1930103},
        task: {id: 1245127}, user: {id: 312294}});
      mock.get("/v2/time_entries", {json: entries});
      mock.get("/v2/invoices", {status: 404, json: {message: "Not Found"}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      expect(() => importRun.run()).toThrow();
      expect(timeEntryIds()).toContain("99");

      mockHarvestAccount();
      importRun.run();

      expect(timeEntryIds()).toContain("99");
      expect(timeEntryIds()).toHaveLength(15);
      expect(importRun.maxParams().generation).toBe(2);

      mock.maxParams({updated_at: LONG_AGO, generation: 2, sweep_at: LONG_AGO});
      importRun.run();

      expect(timeEntryIds()).not.toContain("99");
      expect(timeEntryIds()).toHaveLength(14);
      expect(storedGenerations()).toEqual([1]);
    });

    // A full reimport clears the stored generation with the other marks, and the stored rows of the two
    // checks before it carry generation 2.
    test("removes what Harvest no longer lists with a full reimport", () => {
      importRun.run();
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      importRun.run();
      expect(storedGenerations()).toEqual([2]);

      deleteRecordsInHarvest();
      mock.maxParams({});
      importRun.run({reimport: true});

      expectDeletedRecordsRemoved();
      expect(storedGenerations()).toEqual([1]);
    });

    test("removes the invoices with the next check once the account stopped invoicing", () => {
      importRun.run();
      mock.get("/v2/company", {json: {base_uri: SITE_URL, name: "API Examples",
                                      expense_feature: true, invoice_feature: false}});

      importRun.run();
      expect(dwh.measures.invoices.rows()).toHaveLength(13);

      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      importRun.run();

      expect(dwh.measures.invoices.rows()).toEqual([]);
      expect(dwh.dimensions.invoices.rows()).toEqual([]);
      expect(dwh.dimensions.invoice_items.rows()).toEqual([]);
      expect(dwh.dimensions.invoice_item_categories.rows()).toEqual([]);
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
    });

    test("removes the expenses with the next check once the account stopped tracking them", () => {
      importRun.run();
      mock.get("/v2/company", {json: {base_uri: SITE_URL, name: "API Examples",
                                      expense_feature: false, invoice_feature: true}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});

      importRun.run();

      expect(sumOf("expenses_amount")).toBeCloseTo(0);
      expect(dwh.dimensions.expense_categories.rows()).toEqual([]);
      expect(sumOf("rounded_hours")).toBeCloseTo(80.2);
    });

    test("reads the invoices in full once the account invoices again", () => {
      importRun.run();
      mock.get("/v2/company", {json: {base_uri: SITE_URL, name: "API Examples",
                                      expense_feature: true, invoice_feature: false}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO,
                      features: "expenses,invoices"});
      importRun.run();
      expect(dwh.measures.invoices.rows()).toEqual([]);
      expect(importRun.maxParams().features).toBe("expenses");

      mockHarvestAccount();
      var mark = mockNothingChangedSinceMark();
      importRun.run();

      expect(updatedSinceOf("/v2/invoices")).toBeUndefined();
      expect(updatedSinceOf("/v2/expenses")).toBe(mark);
      expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
      expect(dwh.measures.invoices.rows()).toHaveLength(13);
      expect(sumOfInvoices("invoice_amount")).toBeCloseTo(3083.2);
      expect(importRun.maxParams().features).toBe("expenses,invoices");

      mark = mockNothingChangedSinceMark();
      importRun.run();

      expect(updatedSinceOf("/v2/invoices")).toBe(mark);
      expect(dwh.measures.invoices.rows()).toHaveLength(13);
    });

    test("reads the expenses in full once the account tracks them again", () => {
      importRun.run();
      mock.get("/v2/company", {json: {base_uri: SITE_URL, name: "API Examples",
                                      expense_feature: false, invoice_feature: true}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO,
                      features: "expenses,invoices"});
      importRun.run();
      expect(sumOf("expenses_amount")).toBeCloseTo(0);
      expect(importRun.maxParams().features).toBe("invoices");

      mockHarvestAccount();
      var mark = mockNothingChangedSinceMark();
      importRun.run();

      expect(updatedSinceOf("/v2/expenses")).toBeUndefined();
      expect(updatedSinceOf("/v2/invoices")).toBe(mark);
      expect(sumOf("expenses_amount")).toBeCloseTo(1500.0);
      expect(importRun.maxParams().features).toBe("expenses,invoices");

      mark = mockNothingChangedSinceMark();
      importRun.run();

      expect(updatedSinceOf("/v2/expenses")).toBe(mark);
      expect(sumOf("expenses_amount")).toBeCloseTo(1500.0);
    });
  });

  describe("with data Harvest does not answer", () => {
    beforeEach(mockHarvestAccount);

    // A 404 and not a 5xx: a server error is retried four times with growing waits.
    test("fails the import when a list of the account cannot be read", () => {
      mock.get("/v2/projects", {status: 404, json: {message: "Not Found"}});

      expect(() => importRun.run()).
        toThrow("Received HTTP 404 error when requesting https://api.harvestapp.com/v2/projects");
    });

    test("imports the currencies without a rate when the ECB document cannot be read", () => {
      mock.get(ECB_RATES_URL, {status: 404, body: "Not Found"});

      importRun.run();

      expect(dwh.dimensions.currencies.rows({columns: ["currency", "eur_rate"], orderBy: "currency"})).
        toEqual([{currency: "EUR", eur_rate: 1}, {currency: "USD", eur_rate: null}]);
      expect(sumOf("billable_amount")).toBeCloseTo(2727.0);
      expect(importRun.warnings().map((warning) => warning.message)).toEqual([
        "No euro reference rate of USD was read from the European Central Bank. The EUR and USD measures " +
        "convert the amounts in USD with the rate of an earlier import, or leave them out when there is none."
      ]);
    });

    test("warns of a currency the European Central Bank publishes no rate of until it has one", () => {
      mock.get("/v2/invoices", {json: {invoices: [invoiceIn("AED")]}});

      importRun.run();

      expect(importRun.warnings().map((warning) => warning.key)).toEqual(["currency_rates"]);
      expect(importRun.warnings()[0].message).toContain("No euro reference rate of AED was read");

      mock.get("/v2/invoices", {json: {invoices: [invoiceIn("EUR")]}});
      var clearOld = mock.spyOn(source.warnings, "clearOld");
      importRun.run({reimport: true});

      expect(clearOld).toHaveBeenCalledWith("currency_rates");
    });

    test("warns of no currency when the European Central Bank publishes the rates of all", () => {
      var clearOld = mock.spyOn(source.warnings, "clearOld");

      importRun.run();

      expect(importRun.warnings()).toEqual([]);
      expect(clearOld).toHaveBeenCalledWith("currency_rates");
    });

    test("keeps the stored rates when the ECB document cannot be read", () => {
      importRun.run();
      mock.get(ECB_RATES_URL, {status: 404, body: "Not Found"});

      importRun.run();

      expect(dwh.dimensions.currencies.rows({columns: ["currency", "eur_rate"], orderBy: "currency"})).
        toEqual([{currency: "EUR", eur_rate: 1}, {currency: "USD", eur_rate: 1.3388}]);
    });

    test("reads the rates of every import", () => {
      importRun.run();
      mock.get(ECB_RATES_URL, {body: NEXT_DAY_ECB_RATES, headers: {"Content-Type": "application/xml"}});

      importRun.run();

      expect(dwh.dimensions.currencies.rows({columns: ["currency", "eur_rate"], orderBy: "currency"})).
        toEqual([{currency: "EUR", eur_rate: 1}, {currency: "USD", eur_rate: 1.4}]);
    });

    test("reads the rate of a currency only an invoice is issued in of every import", () => {
      mock.get("/v2/invoices", {json: {invoices: [invoiceIn("GBP")]}});
      importRun.run();
      var mark = importRun.maxParams().updated_at;
      expect(importRun.maxParams().currencies).toBe("EUR,GBP,USD");
      mock.get(ECB_RATES_URL, {body: NEXT_DAY_ECB_RATES, headers: {"Content-Type": "application/xml"}});
      mock.get("/v2/invoices", {json: {invoices: []}});

      importRun.run();

      var requestsByPath = _.indexBy(mock.requests(), (request) => request.path);
      expect(requestsByPath["/v2/invoices"].params.updated_since).toBe(mark);
      expect(currencyRates()).toEqual([{currency: "EUR", eur_rate: 1}, {currency: "GBP", eur_rate: 0.9},
                                       {currency: "USD", eur_rate: 1.4}]);
      expect(importRun.maxParams().currencies).toBe("EUR,GBP,USD");
    });

    test("takes the flag from the former account currency nothing is billed in", () => {
      var company = mock.fixture("company");
      company.currency = "GBP";
      mock.get("/v2/company", {json: company});
      mock.get("/v2/invoices", {status: 404, json: {message: "Not Found"}});
      expect(() => importRun.run()).toThrow();
      expect(accountCurrencies()).toEqual(["GBP"]);
      company.currency = "USD";
      mock.get("/v2/company", {json: company});
      mock.get("/v2/invoices", {fixture: "invoices"});
      // The marks of an import before the failed one, so that this import is not a check.
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: TODAY});

      importRun.run();

      expect(accountCurrencies()).toEqual(["USD"]);
    });

    test("reads the rate of the former currency of a client of every import", () => {
      var clients = mock.fixture("clients");
      clients.clients.forEach((client) => {
        if (client.id === 915262) client.currency = "GBP";
      });
      mock.get("/v2/clients", {json: clients});
      mock.get("/v2/invoices", {json: {invoices: [invoiceIn("GBP")]}});
      importRun.run();
      var mark = importRun.maxParams().updated_at;
      expect(importRun.maxParams().currencies).toBe("GBP,USD");
      mock.get("/v2/clients", {fixture: "clients"});
      mock.get(ECB_RATES_URL, {body: NEXT_DAY_ECB_RATES, headers: {"Content-Type": "application/xml"}});
      mock.get("/v2/invoices", {json: {invoices: []}});

      importRun.run();

      expect(updatedSinceOf("/v2/invoices")).toBe(mark);
      expect(currencyRates()).toEqual([{currency: "EUR", eur_rate: 1}, {currency: "GBP", eur_rate: 0.9},
                                       {currency: "USD", eur_rate: 1.4}]);
      expect(importRun.maxParams().currencies).toBe("EUR,GBP,USD");
    });

    test("collects the currencies only an invoice is issued in anew with a check", () => {
      mock.get("/v2/invoices", {json: {invoices: [invoiceIn("GBP")]}});
      importRun.run();
      expect(importRun.maxParams().currencies).toBe("EUR,GBP,USD");
      mock.get("/v2/invoices", {json: {invoices: [invoiceIn("JPY")]}});
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO,
                      currencies: "EUR,GBP,USD"});

      importRun.run();

      expect(importRun.maxParams().currencies).toBe("EUR,JPY,USD");
      expect(currencyRates()).toEqual([{currency: "EUR", eur_rate: 1}, {currency: "JPY", eur_rate: 107.81},
                                       {currency: "USD", eur_rate: 1.3388}]);
    });

    test("reports the project of a time entry which the projects list did not answer", () => {
      mock.get("/v2/time_entries", {json: {time_entries: [
        {id: 99, spent_date: "2012-02-01", hours_without_timer: 3, rounded_hours: 3, is_closed: false,
         is_billed: false, project: {id: 4242}, task: {id: 1245122}, user: {id: 312294}}
      ]}});

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["project/4242"]);
      expect(_.map(importRun.warnings(), (warning) => warning.message).join("\n")).
        toContain("Harvest project 4242 was not in the projects list");
      expect(importRun.maxParams().updated_at).toBeUndefined();
    });

    test("clears the warnings of a project and a client which the lists answer again", () => {
      var clearOld = mock.spyOn(source.warnings, "clearOld");

      importRun.run();

      expect(clearOld).toHaveBeenCalledWith("project/1930103");
      expect(clearOld).toHaveBeenCalledWith("client/915259");
    });
  });

  describe("of a selection of projects", () => {
    beforeAll(() => {
      mockSelectedProjects();
      // The client none of whose projects is selected is the only one billed in pounds, and its invoice
      // is the only one issued in francs.
      mockCurrencyOfClient(915261, "GBP");
      mockInvoiceOfEazybi((invoices) => {
        _.findWhere(invoices, {id: 1242635}).currency = "CHF";
      });

      importRun.run();
    });

    test("imports the clients, the projects, the rows and the budgets of the selected projects", () => {
      expectSelectedProjectsImported();
    });

    test("imports the project tasks and the task and person budgets of the selected projects", () => {
      // Four task assignments of the eazyBI development project, two of the consulting project and the
      // nameless project task of each.
      expect(dwh.dimensions.project_tasks.rows()).toHaveLength(8);
      expect(dwh.measures.timesheets.rows({columns: ["_source_name", "_source_id"]}).
        filter((row) => row._source_name === "custom_harvest budget").map((row) => row._source_id).
        sort()).toEqual(["1930103", "1930115", "1930115"]);
    });

    test("imports every task, person and currency of the account", () => {
      expect(dwh.dimensions.tasks.rows()).toHaveLength(7);
      expect(idsOf(dwh.dimensions.people)).toEqual([312294, 312875]);
      expect(idsOf(dwh.dimensions.clients)).not.toContain(915261);
      expect(idsOf(dwh.dimensions.invoices)).not.toContain(1242635);
      expect(currencyRates()).toEqual([{currency: "CHF", eur_rate: 1.2052},
                                       {currency: "EUR", eur_rate: 1},
                                       {currency: "GBP", eur_rate: 0.845},
                                       {currency: "USD", eur_rate: 1.3388}]);
    });

    test("imports the invoices of the clients of the selected projects with all their items", () => {
      var itemRows = dwh.measures.invoices.rows({columns: ["invoice_id", "project_id", "item_amount"]}).
        filter((row) => row.invoice_id === INVOICE_OF_EAZYBI_ID && row.item_amount !== null);

      expect(_.sortBy(itemRows, "item_amount")).toEqual([
        {invoice_id: INVOICE_OF_EAZYBI_ID, project_id: 1930103, item_amount: 100},
        {invoice_id: INVOICE_OF_EAZYBI_ID, project_id: -915259, item_amount: 200}
      ]);
      expect(dwh.dimensions.invoice_items.rows({columns: ["invoice_id", "position", "project"],
        orderBy: "position"}).filter((item) => item.invoice_id === INVOICE_OF_EAZYBI_ID)).toEqual([
          {invoice_id: INVOICE_OF_EAZYBI_ID, position: -1, project: null},
          {invoice_id: INVOICE_OF_EAZYBI_ID, position: 1, project: "[EAZYBI] eazyBI development"},
          {invoice_id: INVOICE_OF_EAZYBI_ID, position: 2, project: "Internal"}
        ]);
      expect(sumOfInvoices("invoice_amount")).toBeCloseTo(683.2 + 2200 + 300);
    });

    // The invoices are few and always read for the whole account.
    test("reads the time entries and the expenses of each selected project by itself", () => {
      ["/v2/time_entries", "/v2/expenses"].forEach((path) => {
        var params = requestParamsOf(path);
        expect(params.map((param) => param.project_id)).toEqual(["1930103", "1930115"]);
        params.forEach((param) => expect(param.updated_since).toBeUndefined());
      });
      expect(requestParamsOf("/v2/invoices")).toHaveLength(1);
      expect(requestParamsOf("/v2/invoices")[0].client_id).toBeUndefined();
    });

    test("stores the selection and its clients with the marks of the import", () => {
      expect(importRun.objectFailures()).toEqual([]);
      expect(importRun.maxParams()).toMatchObject({selection: "project/1930103,project/1930115",
                                                   selection_clients: "915259,915262", generation: 1});
    });

    test("aggregates the hours of the selected projects through the schema", () => {
      expect(_.sortBy(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Project Task].[Project].Members ON ROWS
        FROM [Harvest Timesheets]
      `), (row) => row[0])).toEqual([
        ["[CONS-SMALLEU] Consulting for Small European company", 8.1],
        ["[EAZYBI] eazyBI development", 24]
      ]);
    });
  });

  // Every test of this describe imports itself, because it changes the selection.
  describe("of a changed selection of projects", () => {
    beforeEach(() => mockSelectedProjects());

    test("skips the rows of the projects which are not selected and reports an unknown project", () => {
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: TODAY, features: "expenses,invoices",
                      selection: SELECTION.join(","), selection_clients: "915259,915262"});
      mockClassifiedTimeEntries();
      mock.get("/v2/time_entries", {json: {time_entries: [
        {id: 1, spent_date: "2012-02-01", hours_without_timer: 3, rounded_hours: 3, is_closed: false,
         is_billed: false, project: {id: INTERNAL_PROJECT_ID}, task: {id: 1245122}, user: {id: 312294}},
        {id: 2, spent_date: "2012-02-01", hours_without_timer: 2, rounded_hours: 2, is_closed: false,
         is_billed: false, project: {id: 1930103}, task: {id: 1245127}, user: {id: 312294}},
        {id: 3, spent_date: "2012-02-01", hours_without_timer: 1, rounded_hours: 1, is_closed: false,
         is_billed: false, project: {id: 4242}, task: {id: 1245122}, user: {id: 312294}}
      ]}});

      importRun.run();

      expect(timeEntryIds()).toEqual(["2"]);
      expect(sumOf("expenses_amount")).toBeCloseTo(0);
      expect(idsOf(dwh.dimensions.invoices)).toEqual([1241021, INVOICE_OF_EAZYBI_ID, 10577835]);
      expect(importRun.objectFailures()).toEqual(["project/4242"]);
      expect(importRun.warnings().map((warning) => warning.key)).toEqual(["project/4242"]);
      ["/v2/time_entries", "/v2/expenses", "/v2/invoices"].forEach((path) => {
        expect(requestParamsOf(path)).toHaveLength(1);
        expect(requestParamsOf(path)[0]).toMatchObject({updated_since: LONG_AGO});
        expect(requestParamsOf(path)[0].project_id).toBeUndefined();
      });
    });

    test("reads the time entries and the expenses of more projects than the limit for the whole account",
      () => {
        var maxProjectRequests = app.importers.selection.MAX_PROJECT_REQUESTS;
        app.importers.selection.MAX_PROJECT_REQUESTS = 1;
        try {
          importRun.run();
        } finally {
          app.importers.selection.MAX_PROJECT_REQUESTS = maxProjectRequests;
        }

        expectSelectedProjectsImported();
        expect(importRun.objectFailures()).toEqual([]);
        ["/v2/time_entries", "/v2/expenses"].forEach((path) => {
          expect(requestParamsOf(path)).toHaveLength(1);
          expect(requestParamsOf(path)[0].project_id).toBeUndefined();
          expect(requestParamsOf(path)[0].updated_since).toBeUndefined();
        });
      });

    test("removes a project taken out of the selection with the next import", () => {
      importRun.run();
      expect(importRun.maxParams().sweep_at).toBeDefined();
      mock.sourceSelection(["project/1930103"]);
      var firstImportRequests = mock.requests().length;

      importRun.run();

      expect(idsOf(dwh.dimensions.clients)).toEqual([915259]);
      expect(idsOf(dwh.dimensions.projects)).toEqual([-915259, 1930103]);
      expect(timeEntryIds()).toHaveLength(5);
      expect(sumOf("budgeted_hours")).toBeCloseTo(0);
      expect(idsOf(dwh.dimensions.invoices)).toEqual([INVOICE_OF_EAZYBI_ID]);
      expect(storedGenerations()).toEqual([2]);
      expect(importRun.maxParams().selection).toBe("project/1930103");
      expect(importRun.log().join("\n")).toContain("Projects were taken out of the selection");
      expect(requestParamsOf("/v2/time_entries", firstImportRequests).map((params) => params.project_id)).
        toEqual(["1930103"]);

      // The stored selection is the one of the check now, so the next import does not check again.
      var mark = importRun.maxParams().updated_at;
      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
      expect(importRun.maxParams().generation).toBe(2);
      expect(timeEntryIds()).toHaveLength(5);
    });

    test("imports the invoices of the client a selected project was moved to with the next import", () => {
      mock.sourceSelection(["project/1930103"]);
      importRun.run();
      expect(idsOf(dwh.dimensions.clients)).toEqual([915259]);
      expect(idsOf(dwh.dimensions.invoices)).toEqual([INVOICE_OF_EAZYBI_ID]);
      expect(importRun.maxParams()).toMatchObject({selection_clients: "915259", generation: 1});
      mockClientOfProject(1930103, {id: 915262, name: "Small European company", currency: "EUR"});

      importRun.run();

      expect(importRun.objectFailures()).toEqual([]);
      expect(importRun.log().join("\n")).toContain("The selected projects belong to other clients");
      expect(idsOf(dwh.dimensions.clients)).toEqual([915262]);
      expect(idsOf(dwh.dimensions.projects)).toEqual([-915262, 1930103]);
      expect(idsOf(dwh.dimensions.invoices)).toEqual([1241021, 10577835]);
      expect(timeEntryIds()).toHaveLength(5);
      expect(storedGenerations()).toEqual([2]);
      expect(importRun.maxParams()).toMatchObject({selection: "project/1930103",
                                                   selection_clients: "915262", generation: 2});

      // The stored clients are the ones of the check now, so the next import does not check again.
      var mark = importRun.maxParams().updated_at;
      importRun.run();

      expect(updatedSinceOf("/v2/time_entries")).toBe(mark);
      expect(importRun.maxParams().generation).toBe(2);
    });

    test("removes the projects which are not selected when a selection replaces all projects", () => {
      mockHarvestAccount();
      importRun.run();
      expect(importRun.maxParams().selection).toBe("(all)");
      mockSelectedProjects();

      importRun.run();

      expectSelectedProjectsImported();
      expect(storedGenerations()).toEqual([2]);
      expect(importRun.maxParams().selection).toBe(SELECTION.join(","));
    });

    test("reads the whole selection when a project is added to it", () => {
      mock.sourceSelection(["project/1930103"]);
      importRun.run();
      mock.sourceSelection(SELECTION);
      mock.maxParams({});
      var firstImportRequests = mock.requests().length;

      importRun.run();

      expectSelectedProjectsImported();
      expect(requestParamsOf("/v2/time_entries", firstImportRequests).map((params) => params.project_id)).
        toEqual(["1930103", "1930115"]);
      expect(importRun.maxParams().selection).toBe(SELECTION.join(","));
    });

    // Harvest deletes the time entries and the expenses of a deleted project with it, so nothing of the
    // project is requested.
    test("ignores a selected project which Harvest no longer lists", () => {
      mock.sourceSelection(["project/1930103", "project/4242"]);

      importRun.run();

      expect(importRun.objectFailures()).toEqual([]);
      expect(importRun.log().join("\n")).
        toContain("Selected projects which Harvest no longer lists are not imported: project/4242");
      expect(requestParamsOf("/v2/time_entries").map((params) => params.project_id)).toEqual(["1930103"]);
      expect(timeEntryIds()).toHaveLength(5);
      expect(importRun.maxParams().selection).toBe("project/1930103,project/4242");
    });

    test("imports all projects without a selection", () => {
      mock.sourceSelection([]);

      importRun.run();

      expect(timeEntryIds()).toHaveLength(14);
      expect(importRun.maxParams().selection).toBe("(all)");
    });
  });
});
