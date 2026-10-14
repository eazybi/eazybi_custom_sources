// The notes of the time entries and the expenses, and the hours with and without a note which the Sample
// hours without notes report lists by person.
//
// The imports below are here and not in test/importer_test.js or test/sample_reports_test.js: a test run
// keeps the first 2000 log lines of the whole run, and test/importers/selection_test.js reads a log line of
// its own.
var COMPANY = {name: "API Examples", base_uri: "https://example.harvestapp.com", expense_feature: true};
var ACCOUNT_ID = "1234567";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";

function mockDimensions() {
  // The fixture people were created in February 2012, and their capacity until the end of March 2012 keeps
  // the rows a test reads few.
  mock.spyOn(app.importers.capacity, "lastDayOf").mockReturnValue("2012-03-31");
  mock.sourceParams({api_token: "secret-token", site_url: COMPANY.base_uri});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});
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

function mockHarvestAccount() {
  mockDimensions();
  mock.get("/v2/company", {fixture: "company"});
  mock.get("/v2/users/me", {fixture: "users_me"});
  mock.get("/v2/invoice_item_categories", {fixture: "invoice_item_categories"});
  mock.get("/v2/expenses", {fixture: "expenses"});
  mock.get("/v2/invoices", {fixture: "invoices"});
}

function importDimensions() {
  importRun.prepare();
  app.importer.importDimensions(COMPANY, {since: null, importExpenses: true},
    app.importer.beginSelection());
}

// Eight hours of development on the eazyBI project, and a hotel of the implementation project.
function timeEntry(attributes) {
  var entry = {id: 74615858, spent_date: "2012-02-01", hours_without_timer: 8, rounded_hours: 8,
               is_closed: false, is_billed: false, notes: "Develop Highrise integration",
               project: {id: 1930103}, task: {id: 1245127}, user: {id: 312294}};
  for (var key in attributes) entry[key] = attributes[key];
  return entry;
}

function expense(attributes) {
  var record = {id: 1545415, spent_date: "2012-02-10", total_cost: 500, is_closed: false,
                notes: "hotel", project: {id: 1930109}, user: {id: 312294},
                expense_category: {id: 849339}, invoice: null};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

function importEntries(entries) {
  mock.get("/v2/time_entries", {json: {time_entries: entries}});
  app.importers.timeEntries.importAll({timeEntriesSince: null});
}

function importExpenses(expenses) {
  mock.get("/v2/expenses", {json: {expenses: expenses}});
  app.importers.expenses.importAll({expensesSince: null});
}

function mockTimeEntriesWithNotes(noteOf) {
  var entries = mock.fixture("time_entries");
  entries.time_entries.forEach((entry) => {
    entry.notes = noteOf(entry);
  });
  mock.get("/v2/time_entries", {json: entries});
}

// The rows and the columns of the Sample hours without notes report.
function hoursOfPeople(measureNames) {
  return olap.results(`
    SELECT {${measureNames.map((name) => `[Measures].[${name}]`).join(", ")}} ON COLUMNS,
           NON EMPTY [Person].[Person].Members ON ROWS
    FROM [Harvest Timesheets]
  `);
}

var REPORT_MEASURES = ["Hours", "Hours with notes", "Hours without notes"];

describe("the notes of the timesheet rows", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  // A note with text is kept as Harvest answers it, with its spaces.
  test("stores no note of an entry or an expense which holds only spaces or line breaks", () => {
    importEntries([timeEntry({id: 1, notes: "  \n\t "}), timeEntry({id: 2, notes: ""}),
                   timeEntry({id: 3, notes: " Call with the client "})]);
    importExpenses([expense({notes: " \r\n"})]);

    var rows = dwh.measures.timesheets.rows({columns: ["_source_id", "_source_name", "notes"]}).
      filter((row) => row._source_name !== "custom_harvest budget");
    expect(_.sortBy(rows, (row) => row._source_id)).toEqual([
      {_source_id: "1", _source_name: "custom_harvest time entry", notes: null},
      {_source_id: "1545415", _source_name: "custom_harvest expense", notes: null},
      {_source_id: "2", _source_name: "custom_harvest time entry", notes: null},
      {_source_id: "3", _source_name: "custom_harvest time entry", notes: " Call with the client "}
    ]);
  });

  test("counts the hours of the entries with a note and of the entries without one", () => {
    importEntries([timeEntry({id: 1}), timeEntry({id: 2, hours_without_timer: 2.5, notes: null}),
                   timeEntry({id: 3, hours_without_timer: 1.5, notes: " "})]);
    importExpenses([expense()]);

    expect(hoursOfPeople(REPORT_MEASURES.concat(["Expenses amount"]))).
      toEqual([["Riley Smith", 12, 8, 4, 500]]);
  });

  // An expense has a note and no hours, so the hours measures of a person with expenses only are empty
  // and not 0.
  test("adds nothing of an expense to the hours with and without notes", () => {
    importExpenses([expense()]);

    expect(hoursOfPeople(REPORT_MEASURES.concat(["Expenses amount"]))).
      toEqual([["Riley Smith", null, null, null, 500]]);
  });
});

// Every test of this describe imports itself, because it changes the notes of the time entries. The report
// has no row filter, so it lists a person whatever share of the hours has a note.
describe("the Sample hours without notes report of an imported Harvest account", () => {
  beforeEach(mockHarvestAccount);

  test("lists a person whose every entry has a note, with Hours without notes 0", () => {
    mockTimeEntriesWithNotes(() => "Work");

    importRun.run();

    expect(hoursOfPeople(REPORT_MEASURES)).toEqual([["Riley Smith", 80.1, 80.1, 0]]);
  });

  test("lists a person whose entries have no note, with all hours as Hours without notes", () => {
    mockTimeEntriesWithNotes(() => null);

    importRun.run();

    expect(hoursOfPeople(REPORT_MEASURES)).toEqual([["Riley Smith", 80.1, null, 80.1]]);
  });
});
