// Every test imports the dimension members first, because a timesheet row looks up the project, the project
// task, the person and the currency of its entry.
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

// A time entry of the fixture account: eight hours of development on the eazyBI project, which Harvest
// bills at the hourly rate of the project itself.
function timeEntry(attributes) {
  var entry = {id: 74615858, spent_date: "2012-02-01", hours_without_timer: 8, rounded_hours: 8,
               is_closed: false, is_billed: false, notes: "Develop Highrise integration",
               project: {id: 1930103}, task: {id: 1245127}, user: {id: 312294}};
  for (var key in attributes) entry[key] = attributes[key];
  return entry;
}

function importEntries(entries) {
  mock.get("/v2/time_entries", {json: {time_entries: entries}});
  app.importers.timeEntries.importAll({timeEntriesSince: null});
}

function entryRows(columns) {
  return dwh.measures.timesheets.rows({columns: ["_source_id", "_source_name"].concat(columns)}).
    filter((row) => row._source_name === "custom_harvest time entry");
}

function currencyIdOf(currency) {
  return _.detect(dwh.dimensions.currencies.rows({columns: ["id", "currency"]}),
    (row) => row.currency === currency).id;
}

describe("app.importers.timeEntries", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  test("builds one row of the project, the project task, the person and the day of an entry", () => {
    importEntries([timeEntry()]);

    expect(entryRows(["project_id", "project_task_id", "task_id", "person_id", "currency_id",
                      "approval_status_id", "hours", "rounded_hours", "notes"])).toEqual([
      {_source_id: "74615858", _source_name: "custom_harvest time entry", project_id: 1930103,
       // The task assignment of the Development task of this project.
       project_task_id: 19171475, task_id: 1245127, person_id: 312294,
       currency_id: currencyIdOf("USD"), approval_status_id: 0, hours: 8, rounded_hours: 8,
       notes: "Develop Highrise integration"}
    ]);
  });

  test("tracks the hours without the hours of a running timer", () => {
    importEntries([timeEntry({hours: 28069.05, hours_without_timer: 8.05, rounded_hours: 8.1})]);

    expect(entryRows(["hours", "rounded_hours"])[0]).toMatchObject({hours: 8.05, rounded_hours: 8.1});
  });

  // Harvest may round the hours of the running timer into the rounded hours, which every billable and
  // amount measure is built on.
  test("leaves the running timer out of the rounded hours as well", () => {
    importEntries([timeEntry({is_running: true, hours: 5.02, hours_without_timer: 2, rounded_hours: 5})]);

    expect(entryRows(["hours", "rounded_hours"])[0]).toMatchObject({hours: 2, rounded_hours: 2});
  });

  test("takes the rounded hours from Harvest and the tracked hours when it answers none", () => {
    importEntries([timeEntry({hours_without_timer: 8.05, rounded_hours: 8.25}),
                   timeEntry({id: 11, hours_without_timer: 3.3, rounded_hours: null})]);

    expect(_.sortBy(entryRows(["rounded_hours"]), (row) => row._source_id)).toEqual([
      {_source_id: "11", _source_name: "custom_harvest time entry", rounded_hours: 3.3},
      {_source_id: "74615858", _source_name: "custom_harvest time entry", rounded_hours: 8.25}
    ]);
  });

  test("imports no row of an entry of zero hours", () => {
    importEntries([timeEntry({id: 74616489, hours_without_timer: 0, rounded_hours: 0})]);

    expect(entryRows(["hours"])).toEqual([]);
  });

  test("removes the row of an entry whose hours were taken back", () => {
    importEntries([timeEntry()]);
    expect(entryRows(["hours"])).toHaveLength(1);

    importDimensions();
    importEntries([timeEntry({hours_without_timer: 0, rounded_hours: 0})]);

    expect(entryRows(["hours"])).toEqual([]);
  });

  // An entry which does not answer whether it is billable is billable by its task assignment.
  test("bills the hours of a billable task and the hours which are already invoiced", () => {
    // The Consulting task of the implementation project is billable, the Admin task is not.
    importEntries([timeEntry({id: 1, project: {id: 1930109}, task: {id: 1245133}}),
                   timeEntry({id: 2, project: {id: 1930109}, task: {id: 1245122}}),
                   timeEntry({id: 3, project: {id: 1930109}, task: {id: 1245122}, is_billed: true})]);

    expect(_.sortBy(entryRows(["billable_hours", "invoiced_hours", "billable_amount",
                               "invoiced_amount"]), (row) => row._source_id)).
      toMatchObject([
        {_source_id: "1", billable_hours: 8, invoiced_hours: null, billable_amount: 720,
         invoiced_amount: null},
        {_source_id: "2", billable_hours: null, invoiced_hours: null, billable_amount: null,
         invoiced_amount: null},
        {_source_id: "3", billable_hours: 8, invoiced_hours: 8, billable_amount: 720,
         invoiced_amount: 720}
      ]);
  });

  // A task assignment changed after the time was tracked, or an entry changed by itself, does not
  // change whether Harvest bills that time.
  test("bills the hours Harvest answers as billable with the entry", () => {
    importEntries([timeEntry({id: 1, project: {id: 1930109}, task: {id: 1245133}, billable: false}),
                   timeEntry({id: 2, project: {id: 1930109}, task: {id: 1245122}, billable: true,
                              billable_rate: 50}),
                   timeEntry({id: 3, project: {id: 1930109}, task: {id: 1245133}, billable: false,
                              is_billed: true})]);

    expect(_.sortBy(entryRows(["billable_hours", "invoiced_hours", "billable_amount"]),
      (row) => row._source_id)).toMatchObject([
      {_source_id: "1", billable_hours: null, invoiced_hours: null, billable_amount: null},
      {_source_id: "2", billable_hours: 8, invoiced_hours: null, billable_amount: 400},
      {_source_id: "3", billable_hours: 8, invoiced_hours: 8, billable_amount: 720}
    ]);
  });

  test("bills at the rate the bill_by setting of the project names", () => {
    var billedByProject = {bill_by: "Project", hourly_rate: 67.89};
    var projectTask = {hourly_rate: 45}, projectUser = {hourly_rate: 90};

    expect(app.importers.timeEntries.hourlyRateOf({}, billedByProject, projectTask, projectUser)).
      toBe(67.89);
    expect(app.importers.timeEntries.hourlyRateOf({}, {bill_by: "Tasks"}, projectTask, projectUser)).
      toBe(45);
    expect(app.importers.timeEntries.hourlyRateOf({}, {bill_by: "People"}, projectTask, projectUser)).
      toBe(90);
    // A project which is not billed at all has no rate and therefore no billable amount.
    expect(app.importers.timeEntries.hourlyRateOf({}, {bill_by: "none"}, projectTask, projectUser)).
      toBeNull();
  });

  // The Consulting task of the implementation project bills 90 now, and billed 100 when the time was
  // tracked, which Harvest kept for that time when the rate was lowered.
  test("bills at the rate Harvest answers with the entry", () => {
    importEntries([timeEntry({project: {id: 1930109}, task: {id: 1245133}, is_billed: true,
                              billable_rate: 100})]);

    expect(entryRows(["billable_amount", "invoiced_amount"])[0]).
      toMatchObject({billable_amount: 800, invoiced_amount: 800});
    expect(app.importers.timeEntries.hourlyRateOf({billable_rate: 120},
      {bill_by: "Project", hourly_rate: 67.89}, null, null)).toBe(120);
  });

  test("removes the row of an entry moved to a project which is not selected", () => {
    mock.sourceSelection(["project/1930103"]);
    importDimensions();
    importEntries([timeEntry()]);
    expect(entryRows(["hours"])).toHaveLength(1);

    importDimensions();
    mock.get("/v2/time_entries", {json: {time_entries: [timeEntry({project: {id: 1930109}})]}});
    var clearOld = mock.spyOn(source.warnings, "clearOld");
    app.importers.timeEntries.importAll({timeEntriesSince: "2026-01-01T00:00:00Z"});

    expect(entryRows(["hours"])).toEqual([]);
    expect(importRun.objectFailures()).toEqual([]);
    expect(clearOld).toHaveBeenCalledWith("time entry/74615858");
  });

  // Changed business hours make an import read the selected projects in full, which does not answer the
  // entry moved out of them.
  test("removes the row of an entry moved out of the selection when the entries are classified again", () => {
    mock.sourceSelection(["project/1930103"]);
    importDimensions();
    importEntries([timeEntry()]);

    importDimensions();
    mock.get("/v2/time_entries", {json: {time_entries: []}});
    mock.get("/v2/time_entries", {params: {updated_since: "2026-01-01T00:00:00Z"},
                                  json: {time_entries: [timeEntry({project: {id: 1930109}})]}});
    app.importers.timeEntries.importAll({timeEntriesSince: null,
                                         movedTimeEntriesSince: "2026-01-01T00:00:00Z"});

    expect(entryRows(["hours"])).toEqual([]);
    expect(importRun.objectFailures()).toEqual([]);
  });

  test("keeps the row of an entry moved to a project which the projects list did not answer", () => {
    importEntries([timeEntry()]);

    importDimensions();
    mock.get("/v2/time_entries", {json: {time_entries: [timeEntry({project: {id: 4242}})]}});
    app.importers.timeEntries.importAll({timeEntriesSince: "2026-01-01T00:00:00Z"});

    expect(entryRows(["hours"])).toHaveLength(1);
    expect(importRun.objectFailures()).toEqual(["project/4242"]);
  });

  // 1930099 is the Internal project, which bills nothing.
  test("imports no amount for a project which is not billed", () => {
    importEntries([timeEntry({project: {id: 1930099}, task: {id: 1245122}, is_billed: true})]);

    expect(entryRows(["invoiced_hours", "billable_amount", "invoiced_amount"])[0]).toEqual({
      _source_id: "74615858", _source_name: "custom_harvest time entry", invoiced_hours: 8,
      billable_amount: null, invoiced_amount: null
    });
  });

  test("reports time of a task the project does not assign under the project itself", () => {
    importEntries([timeEntry({task: {id: 1245125}})]);

    expect(entryRows(["project_id", "project_task_id", "task_id"])).toEqual([
      {_source_id: "74615858", _source_name: "custom_harvest time entry", project_id: 1930103,
       project_task_id: -1930103, task_id: 1245125}
    ]);
  });

  test("reports the entry in the approval state of its timesheet", () => {
    importEntries([timeEntry({id: 1, approval_status: "unsubmitted"}),
                   timeEntry({id: 2, approval_status: "submitted"}),
                   timeEntry({id: 3, approval_status: "approved", is_closed: true})]);

    expect(_.sortBy(entryRows(["approval_status_id"]), (row) => row._source_id).
      map((row) => row.approval_status_id)).toEqual([0, 2, 1]);
  });

  test("takes the approval from is_closed when the entry has no approval_status", () => {
    importEntries([timeEntry({id: 1, is_closed: true}), timeEntry({id: 2, is_closed: false}),
                   timeEntry({id: 3, is_closed: undefined})]);

    expect(_.sortBy(entryRows(["approval_status_id"]), (row) => row._source_id).
      map((row) => row.approval_status_id)).toEqual([1, 0, null]);
  });

  // The cost is of the rounded hours, the way the Harvest reports count it, and of billable and unbillable
  // time alike.
  test("costs the rounded hours at the cost rate of the entry", () => {
    importEntries([timeEntry({id: 1, hours_without_timer: 8.05, rounded_hours: 8.25, cost_rate: 40}),
                   timeEntry({id: 2, project: {id: 1930099}, task: {id: 1245122}, cost_rate: 25}),
                   timeEntry({id: 3, cost_rate: null})]);

    expect(_.sortBy(entryRows(["billable_amount", "cost_amount"]), (row) => row._source_id)).
      toMatchObject([
        {_source_id: "1", cost_amount: 330},
        {_source_id: "2", billable_amount: null, cost_amount: 200},
        {_source_id: "3", cost_amount: null}
      ]);
  });

  test("imports an amount of zero for a rate of zero", () => {
    importEntries([timeEntry({project: {id: 1930109}, task: {id: 1245133}, is_billed: true,
                              billable_rate: 0, cost_rate: 0})]);

    expect(entryRows(["billable_amount", "invoiced_amount", "cost_amount"])[0]).
      toMatchObject({billable_amount: 0, invoiced_amount: 0, cost_amount: 0});
  });

  // The rounding setting of the account may round a few minutes down to no hours.
  test("imports an amount of zero for hours rounded down to zero", () => {
    importEntries([timeEntry({project: {id: 1930109}, task: {id: 1245133}, is_billed: true,
                              hours_without_timer: 0.05, rounded_hours: 0, billable_rate: 100,
                              cost_rate: 30})]);

    expect(entryRows(["hours", "billable_amount", "invoiced_amount", "cost_amount"])[0]).
      toMatchObject({hours: 0.05, billable_amount: 0, invoiced_amount: 0, cost_amount: 0});
  });

  test("moves the flag of the account currency when the account changes it", () => {
    var flags = () => dwh.dimensions.currencies.rows({columns: ["currency", "account_currency"],
                                                     orderBy: "currency"});
    importRun.prepare();
    app.importer.importDimensions(_.extend({currency: "USD"}, COMPANY), {since: null},
      app.importer.beginSelection());
    expect(flags()).toEqual([{currency: "EUR", account_currency: false},
                             {currency: "USD", account_currency: true}]);

    importRun.prepare();
    app.importer.importDimensions(_.extend({currency: "EUR"}, COMPANY), {since: null},
      app.importer.beginSelection());
    expect(flags()).toEqual([{currency: "EUR", account_currency: true},
                             {currency: "USD", account_currency: false}]);
  });

  // Harvest does not document the currency of the account, so an account may answer none, like COMPANY.
  test("flags no currency when the company answers none", () => {
    expect(dwh.dimensions.currencies.rows({columns: ["currency", "account_currency"],
                                          orderBy: "currency"})).
      toEqual([{currency: "EUR", account_currency: false}, {currency: "USD", account_currency: false}]);
  });

  test("replaces the row of an entry which was changed since the last import", () => {
    importEntries([timeEntry()]);

    importDimensions();
    importEntries([timeEntry({hours_without_timer: 6, rounded_hours: 6, notes: "Less than planned"})]);

    expect(entryRows(["hours", "rounded_hours", "notes"])).toEqual([
      {_source_id: "74615858", _source_name: "custom_harvest time entry", hours: 6, rounded_hours: 6,
       notes: "Less than planned"}
    ]);
  });
});

var BUSINESS_HOURS = 1;
var NON_BUSINESS_HOURS = 2;

function importDimensionsWith(extraOptions) {
  mock.extraOptions(_.extend({time_dimension_time_zone: "UTC"}, extraOptions));
  importDimensions();
}

// 2012-02-01 is a Wednesday.
function timedEntry(spentDate, startedTime, endedTime, hours, attributes) {
  return timeEntry(_.extend({spent_date: spentDate, started_time: startedTime, ended_time: endedTime,
                             hours_without_timer: hours, rounded_hours: hours}, attributes));
}

// The working time and the hours of the rows of every entry, by entry and then Business hours first.
function workingTimeRows(columns) {
  return _.sortBy(entryRows(["working_time_id", "hours"].concat(columns || [])),
    (row) => `${row._source_id}/${row.working_time_id}`).
    map((row) => _.omit(row, "_source_name"));
}

describe("app.importers.timeEntries by the working time", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  test("splits an entry of the 12 hour clock which ends after the business hours", () => {
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:30pm", 2.5)]);

    expect(workingTimeRows()).toEqual([
      {_source_id: "74615858", working_time_id: BUSINESS_HOURS, hours: 1},
      {_source_id: "74615858", working_time_id: NON_BUSINESS_HOURS, hours: 1.5}
    ]);
  });

  test("splits an entry of the 24 hour clock which starts before the business hours", () => {
    importEntries([timedEntry("2012-02-01", "07:30", "10:00", 2.5)]);

    expect(workingTimeRows()).toEqual([
      {_source_id: "74615858", working_time_id: BUSINESS_HOURS, hours: 1},
      {_source_id: "74615858", working_time_id: NON_BUSINESS_HOURS, hours: 1.5}
    ]);
  });

  test("reports an entry within the business hours and one outside them as one row each", () => {
    importEntries([timedEntry("2012-02-01", "9:00am", "12:00pm", 3, {id: 1}),
                   timedEntry("2012-02-01", "12:00am", "9:00am", 9, {id: 2}),
                   timedEntry("2012-02-01", "17:00", "19:00", 2, {id: 3})]);

    expect(workingTimeRows()).toEqual([
      {_source_id: "1", working_time_id: BUSINESS_HOURS, hours: 3},
      {_source_id: "2", working_time_id: NON_BUSINESS_HOURS, hours: 9},
      {_source_id: "3", working_time_id: NON_BUSINESS_HOURS, hours: 2}
    ]);
  });

  test("reports an entry without a start or an end time by its day", () => {
    importEntries([timeEntry({id: 1, spent_date: "2012-02-01"}),
                   timeEntry({id: 2, spent_date: "2012-02-04"}),
                   timedEntry("2012-02-01", "7:00am", null, 8, {id: 3, is_running: true}),
                   timedEntry("2012-02-04", "10:00am", null, 8, {id: 4, is_running: true})]);

    expect(workingTimeRows().map((row) => row.working_time_id)).
      toEqual([BUSINESS_HOURS, NON_BUSINESS_HOURS, BUSINESS_HOURS, NON_BUSINESS_HOURS]);
  });

  // 2012-02-04 is a Saturday.
  test("reports the time of a weekend within the business hours as Non-business hours", () => {
    importEntries([timedEntry("2012-02-04", "10:00am", "12:00pm", 2)]);

    expect(workingTimeRows()).toEqual([
      {_source_id: "74615858", working_time_id: NON_BUSINESS_HOURS, hours: 2}
    ]);
  });

  test("reports the time of an additional non-working day as Non-business hours", () => {
    importDimensionsWith({time_dimension_additional_non_working_days: "2012-01-31,2012-02-01"});
    importEntries([timedEntry("2012-02-01", "10:00am", "12:00pm", 2, {id: 1}),
                   timeEntry({id: 2, spent_date: "2012-01-31"}),
                   timeEntry({id: 3, spent_date: "2012-02-02"})]);

    expect(workingTimeRows().map((row) => row.working_time_id)).
      toEqual([NON_BUSINESS_HOURS, NON_BUSINESS_HOURS, BUSINESS_HOURS]);
  });

  // The Time dimension numbers the weekdays from 1 for Monday to 7 for Sunday: Friday and Sunday here.
  test("takes the non-working weekdays of the Time dimension", () => {
    importDimensionsWith({time_dimension_non_working_weekdays: "57"});
    importEntries([timeEntry({id: 1, spent_date: "2012-02-03"}),
                   timeEntry({id: 2, spent_date: "2012-02-04"}),
                   timeEntry({id: 3, spent_date: "2012-02-05"})]);

    expect(workingTimeRows().map((row) => row.working_time_id)).
      toEqual([NON_BUSINESS_HOURS, BUSINESS_HOURS, NON_BUSINESS_HOURS]);
  });

  test("reports every day as a working day when the Time dimension has no non-working weekday", () => {
    importDimensionsWith({time_dimension_non_working_weekdays: "none"});
    importEntries([timeEntry({id: 1, spent_date: "2012-02-04"}),
                   timedEntry("2012-02-05", "4:00pm", "6:00pm", 2, {id: 2})]);

    expect(workingTimeRows()).toEqual([
      {_source_id: "1", working_time_id: BUSINESS_HOURS, hours: 8},
      {_source_id: "2", working_time_id: BUSINESS_HOURS, hours: 1},
      {_source_id: "2", working_time_id: NON_BUSINESS_HOURS, hours: 1}
    ]);
  });

  // The entry stays on its day.
  test("reports the time of an entry after midnight by the next day", () => {
    importDimensionsWith({business_hours_start: "00:00", business_hours_end: "17:00"});
    // A Tuesday night into a Wednesday, and a Friday night into a Saturday.
    importEntries([timedEntry("2012-01-31", "10:00pm", "2:00am", 4, {id: 1}),
                   timedEntry("2012-02-03", "22:00", "02:00", 4, {id: 2})]);

    expect(workingTimeRows()).toEqual([
      {_source_id: "1", working_time_id: BUSINESS_HOURS, hours: 2},
      {_source_id: "1", working_time_id: NON_BUSINESS_HOURS, hours: 2},
      {_source_id: "2", working_time_id: NON_BUSINESS_HOURS, hours: 4}
    ]);
    expect(_.uniq(entryRows(["time_id"]).filter((row) => row._source_id === "1").
      map((row) => row.time_id))).toEqual([dwh.lookupDateId({spent_date: "2012-01-31"}, "spent_date")]);
  });

  test("reports the entries by their day and warns when the business hours end before they start", () => {
    importDimensionsWith({business_hours_start: "17:00", business_hours_end: "09:00"});
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:30pm", 2.5, {id: 1}),
                   timedEntry("2012-02-04", "4:00pm", "6:30pm", 2.5, {id: 2})]);

    expect(workingTimeRows().map((row) => row.working_time_id)).toEqual([BUSINESS_HOURS, NON_BUSINESS_HOURS]);
    expect(importRun.warnings().map((warning) => warning.message).join("\n")).
      toContain("The business hours end is not later than their start");
  });

  test("shares every sum of a split entry by the time and adds the shares up to the entry exactly", () => {
    // The eazyBI development project bills the Development task at 67.89 an hour. 8:10am to 5:00pm is 530
    // minutes, 480 of them within the business hours.
    importEntries([timedEntry("2012-02-01", "8:10am", "5:00pm", 8.05,
                              {rounded_hours: 8.1, is_billed: true, cost_rate: 33.33})]);
    var columns = ["rounded_hours", "billable_hours", "invoiced_hours", "billable_amount", "invoiced_amount",
                   "cost_amount"];
    var rows = workingTimeRows(columns);

    expect(rows[0]).toEqual({_source_id: "74615858", working_time_id: BUSINESS_HOURS, hours: 7.29,
      rounded_hours: 7.34, billable_hours: 7.34, invoiced_hours: 7.34, billable_amount: 498.03,
      invoiced_amount: 498.03, cost_amount: 244.5});
    expect(rows[1].working_time_id).toBe(NON_BUSINESS_HOURS);
    // The entry of one row stores each sum rounded to two decimal places.
    [["hours", 8.05], ["rounded_hours", 8.1], ["billable_hours", 8.1], ["invoiced_hours", 8.1],
     ["billable_amount", 549.91], ["invoiced_amount", 549.91], ["cost_amount", 269.97]].
      forEach((sum) => expect(rows[0][sum[0]] + rows[1][sum[0]]).toBeCloseTo(sum[1], 9));
  });

  // 2.5 hours at 67.89 is 169.725, which the row of an entry that is not split stores as 169.73. 3:20pm to
  // 5:50pm is 150 minutes, 100 of them within the business hours.
  test("shares the sum which the row of an entry stores when the sum has half a cent", () => {
    var writeTimesheetBatch = mock.spyOn(app.importers.rows, "writeTimesheetBatch");
    importEntries([timedEntry("2012-02-01", "3:20pm", "5:50pm", 2.5, {id: 1, is_billed: true}),
                   timedEntry("2012-02-01", "9:00am", "11:30am", 2.5, {id: 2, is_billed: true})]);
    var rows = workingTimeRows(["billable_amount"]);

    expect(rows.map((row) => [row._source_id, row.working_time_id, row.billable_amount])).toEqual([
      ["1", BUSINESS_HOURS, 113.15], ["1", NON_BUSINESS_HOURS, 56.58], ["2", BUSINESS_HOURS, 169.73]
    ]);
    expect(rows[0].billable_amount + rows[1].billable_amount).toBeCloseTo(rows[2].billable_amount, 9);
    // The parts are written with two decimal places and without a binary remainder of the subtraction.
    expect(writeTimesheetBatch.mock.calls[0][0].map((row) => row.billable_amount)).
      toEqual([113.15, 56.58, 169.725]);
  });

  // 0.03 hours at the cost rate 13.50 is 0.40499999999999997, which the row of an entry that is not split
  // stores as 0.40, while shifting it by two decimal places rounds it up in binary.
  test("shares the sum which the row of an entry stores when the sum is just below half a cent", () => {
    importEntries([timedEntry("2012-02-01", "4:59pm", "5:01pm", 0.03, {id: 1, cost_rate: 13.5}),
                   timedEntry("2012-02-01", "9:00am", "9:02am", 0.03, {id: 2, cost_rate: 13.5})]);

    expect(workingTimeRows(["cost_amount"]).map((row) => [row._source_id, row.working_time_id,
                                                          row.cost_amount])).toEqual([
      ["1", BUSINESS_HOURS, 0.2], ["1", NON_BUSINESS_HOURS, 0.2], ["2", BUSINESS_HOURS, 0.4]
    ]);
  });

  // 0.1 hours at the cost rate 33.33 is stored as 3.33. 4:59pm to 5:05pm is 6 minutes, one of them within the
  // business hours, whose share 0.555 is 0.5549999999999999 in binary.
  test("rounds the share of a part half away from zero also when it is not exact in binary", () => {
    importEntries([timedEntry("2012-02-01", "4:59pm", "5:05pm", 0.1, {cost_rate: 33.33})]);

    expect(workingTimeRows(["cost_amount"]).map((row) => [row.working_time_id, row.cost_amount])).toEqual([
      [BUSINESS_HOURS, 0.56], [NON_BUSINESS_HOURS, 2.77]
    ]);
  });

  test("rounds a sum as the database stores the decimal form which eazyBI writes", () => {
    expect([0.03 * 13.5, 1.005, 169.725, -169.725, 0.995, 9.995, 0.004].
      map((value) => app.importers.timeEntries.storedValueOf(value))).
      toEqual([0.4, 1.01, 169.73, -169.73, 1, 10, 0]);
    // The forms with an exponent.
    expect([1e-7, 5e-7, 1.5e21, -1.5e21].map((value) => app.importers.timeEntries.storedValueOf(value))).
      toEqual([0, 0, 1.5e21, -1.5e21]);
  });

  test("keeps the sums of an entry which is not billed empty on both rows", () => {
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:30pm", 2.5, {project: {id: 1930099},
                                                                      task: {id: 1245122}})]);

    expect(workingTimeRows(["billable_amount", "invoiced_hours", "cost_amount"]).map((row) =>
      [row.billable_amount, row.invoiced_hours, row.cost_amount])).toEqual([[null, null, null],
                                                                           [null, null, null]]);
  });

  test("replaces the rows of an entry when it is split or joined again", () => {
    importEntries([timedEntry("2012-02-01", "9:00am", "11:00am", 2)]);

    importDimensions();
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:00pm", 2)]);
    expect(workingTimeRows().map((row) => [row.working_time_id, row.hours])).
      toEqual([[BUSINESS_HOURS, 1], [NON_BUSINESS_HOURS, 1]]);

    importDimensions();
    importEntries([timedEntry("2012-02-01", "6:00pm", "7:30pm", 1.5)]);
    expect(workingTimeRows().map((row) => [row.working_time_id, row.hours])).
      toEqual([[NON_BUSINESS_HOURS, 1.5]]);
  });

  test("removes both rows of a split entry whose hours were taken back", () => {
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:00pm", 2)]);
    expect(entryRows(["hours"])).toHaveLength(2);

    importDimensions();
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:00pm", 0)]);

    expect(entryRows(["hours"])).toEqual([]);
  });

  test("counts the entries and not their rows", () => {
    importEntries([timedEntry("2012-02-01", "4:00pm", "6:00pm", 2, {id: 1}),
                   timedEntry("2012-02-01", "9:00am", "11:00am", 2, {id: 2})]);

    expect(importRun.statusMessages()).toContain("Importing Harvest time entries, 2 imported");
  });
});
