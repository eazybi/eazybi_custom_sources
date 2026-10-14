// sample_reports.js is a declarative file: a test run evaluates api.js, importer.js and the importers,
// never it, so the thirteen sample reports and the dashboard are mirrored below by everything they name —
// the cube of each report, the level of each of its axes, the measures it shows, filters and orders by,
// and the dimensions of its page filters. The assertions resolve all of it against the schema and
// against an import of the fixtures, which is what tells whether a sample report opens with its data or
// with an MDX error. Keep this list in step with sample_reports.js.
var TIMESHEETS = "Harvest Timesheets";
var INVOICES = "Harvest Invoices";

var REPORTS = [
  {name: "Sample hours by client",
   cube: TIMESHEETS,
   rows: {dimension: "Project Task", level: "Client"},
   columns: {measures: ["Rounded hours", "Billable hours", "Billable hours %", "Project currency",
                        "Billable amount"]},
   filterMeasures: ["Rounded hours"],
   pageDimensions: ["Time", "Project Status", "Task", "Person"]},

  {name: "Sample hours by role",
   cube: TIMESHEETS,
   rows: {dimension: "Role", level: "Role"},
   nestedRows: {dimension: "Person", level: "Person"},
   columns: {measures: ["Rounded hours", "Billable hours", "Unbillable hours", "Billable hours %"]},
   pageDimensions: ["Time", "Project Status", "Project Task", "Task"]},

  {name: "Sample hours without notes",
   cube: TIMESHEETS,
   rows: {dimension: "Person", level: "Person"},
   columns: {measures: ["Hours", "Hours with notes", "Hours without notes"]},
   filterMeasures: ["Hours without notes"],
   pageDimensions: ["Time", "Project Status", "Project Task", "Task"]},

  {name: "Sample business and non-business hours by person",
   cube: TIMESHEETS,
   rows: {dimension: "Person", level: "Person"},
   columns: {dimension: "Working Time", level: "Working Time"},
   pageMeasures: ["Hours", "Rounded hours", "Billable hours"],
   filterMeasures: ["Hours"],
   pageDimensions: ["Time", "Project Status", "Project Task", "Task"]},

  {name: "Sample hours by external item",
   cube: TIMESHEETS,
   rows: {dimension: "External Item", level: "Service"},
   columns: {measures: ["Hours", "Billable hours", "Unbillable hours"]},
   filterMeasures: ["Hours"],
   pageDimensions: ["Time", "Project Status", "Project Task", "Person"]},

  {name: "Sample linked hours by person",
   cube: TIMESHEETS,
   rows: {dimension: "Person", level: "Person"},
   columns: {measures: ["Hours", "Linked hours", "Unlinked hours", "Linked hours %"]},
   filterMeasures: ["Linked hours %"],
   pageDimensions: ["Time", "Project Status", "Project Task", "Task"]},

  {name: "Sample utilisation by person",
   cube: TIMESHEETS,
   rows: {dimension: "Person", level: "Person"},
   columns: {measures: ["Capacity hours", "Hours", "Utilisation %", "Billable hours",
                        "Billable utilisation %"]},
   filterMeasures: ["Utilisation %"],
   pageDimensions: ["Time", "Role"],
   pageMembers: ["[Time].[Previous month]"]},

  {name: "Sample uninvoiced hours and expenses",
   cube: TIMESHEETS,
   rows: {dimension: "Project Task", level: "Client"},
   columns: {measures: ["Uninvoiced hours", "Project currency", "Uninvoiced amount",
                        "Uninvoiced expenses"]},
   filterMeasures: ["Uninvoiced amount with expenses"],
   pageDimensions: ["Time", "Project Status", "Task", "Person"]},

  {name: "Sample active projects status",
   cube: TIMESHEETS,
   rows: {dimension: "Project Task", level: "Project"},
   columns: {measures: ["Project manager", "Rounded hours", "Billable hours", "Billable hours %",
                        "Project budget by", "Budgeted hours", "Budgeted cost", "Expenses amount",
                        "Budget spent %", "Project currency"]},
   pageDimensions: ["Project Status", "Task", "Person"],
   pageMembers: ["[Project Status].[Active]"]},

  {name: "Sample billable vs unbillable hours by project",
   cube: TIMESHEETS,
   rows: {dimension: "Project Task", level: "Project"},
   columns: {measures: ["Billable hours", "Unbillable hours"]},
   filterMeasures: ["Rounded hours"],
   pageDimensions: ["Time", "Project Status", "Task", "Person"]},

  {name: "Sample hours by task and month",
   cube: TIMESHEETS,
   rows: {dimension: "Task", level: "Task"},
   columns: {dimension: "Time", level: "Month"},
   pageMeasures: ["Rounded hours", "Billable hours", "Unbillable hours", "Billable amount EUR",
                  "Billable amount USD"],
   pageDimensions: ["Project Status", "Project Task", "Person"]},

  {name: "Sample unpaid invoices",
   cube: INVOICES,
   rows: {dimension: "Invoice", level: "Invoice"},
   columns: {measures: ["Invoice status", "Invoice issued date", "Invoice due date", "Invoice currency",
                        "Invoice amount", "Item amount", "Due amount"]},
   pageDimensions: ["Invoice Status", "Client Project", "Currency"]},

  {name: "Sample invoice amounts by month",
   cube: INVOICES,
   rows: {dimension: "Time", level: "Month"},
   columns: {dimension: "Invoice Status", level: "Invoice Status"},
   pageMeasures: ["Invoice amount EUR", "Invoice amount USD", "Item amount EUR", "Item amount USD"],
   pageDimensions: ["Time", "Client Project"]}
];

var DASHBOARD = {
  name: "Harvest overview",
  reportNames: ["Sample billable vs unbillable hours by project", "Sample invoice amounts by month",
                "Sample active projects status", "Sample uninvoiced hours and expenses"],
  pages: [{cube: TIMESHEETS, dimension: "Time"}, {cube: TIMESHEETS, dimension: "Task"},
          {cube: TIMESHEETS, dimension: "Person"}, {cube: INVOICES, dimension: "Client Project"}],
  // The predefined Time members the dashboard filter offers, which both cubes have to know.
  timeMembers: ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current year]",
                "[Time].[Previous year]"]
};

var ACCOUNT_ID = "1234567";
var SITE_URL = "https://example.harvestapp.com";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";

function mockHarvestAccount() {
  // The fixture people were created in February 2012, and their capacity until the end of March 2012 keeps
  // the rows a test reads few.
  mock.spyOn(app.importers.capacity, "lastDayOf").mockReturnValue("2012-03-31");
  mock.sourceParams({api_token: "secret-token", site_url: SITE_URL});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});
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

function measureFullName(name) {
  return `[Measures].[${name}]`;
}

function measuresOf(report) {
  return (report.columns.measures || []).
    concat(report.pageMeasures || []).
    concat(report.filterMeasures || []);
}

function setOf(axis) {
  return axis.measures ? `{${axis.measures.map(measureFullName).join(", ")}}` :
    `[${axis.dimension}].[${axis.level}].Members`;
}

function rowsSetOf(report) {
  return report.nestedRows ? `CrossJoin(${setOf(report.rows)}, ${setOf(report.nestedRows)})` :
    setOf(report.rows);
}

// The query of a report: its two axes, and the measure its page filter starts on as the slicer when the
// measures of the report are a page filter and not its columns.
function queryOf(report) {
  var slicer = report.pageMeasures ? ` WHERE ${measureFullName(report.pageMeasures[0])}` : "";
  return `
    SELECT NON EMPTY ${setOf(report.columns)} ON COLUMNS,
           NON EMPTY ${rowsSetOf(report)} ON ROWS
    FROM [${report.cube}]${slicer}`;
}

function reportNamed(name) {
  return _.detect(REPORTS, (report) => report.name === name);
}

describe("app.defineSampleReports", () => {
  test("filters every report by dimensions of its own cube", () => {
    REPORTS.forEach((report) => {
      report.pageDimensions.forEach((dimensionName) =>
        expect(schema.cube(report.cube).dimensions()).toContain(dimensionName));
    });
  });

  test("shows sample reports of this app on the dashboard", () => {
    DASHBOARD.reportNames.forEach((name) => expect(reportNamed(name)).toBeDefined());
  });

  test("filters the dashboard by dimensions its reports carry in their pages", () => {
    DASHBOARD.pages.forEach((page) => {
      expect(schema.cube(page.cube).dimensions()).toContain(page.dimension);

      var filtered = DASHBOARD.reportNames.map(reportNamed).filter((report) =>
        report.cube === page.cube && report.pageDimensions.indexOf(page.dimension) >= 0);
      expect(filtered.length).toBeGreaterThan(0);
    });
  });
});

describe("the sample reports of an imported Harvest account", () => {
  beforeAll(() => {
    mockHarvestAccount();

    importRun.run();
  });

  test("queries the two axes of every report without an error", () => {
    REPORTS.forEach((report) => {
      expect(olap.results(queryOf(report)).length).toBeGreaterThan(0);
    });
  });

  // Every measure of a report on one row, so that Mondrian evaluates the formula of each of them — a
  // formula which names a member that does not exist compiles and fails only when it is evaluated.
  test("evaluates every measure the reports show, filter and order by", () => {
    REPORTS.forEach((report) => {
      var measures = measuresOf(report).map(measureFullName).join(", ");
      expect(olap.results(`
        SELECT {${measures}} ON COLUMNS,
               {[${report.rows.dimension}].DefaultMember} ON ROWS
        FROM [${report.cube}]
      `)).toHaveLength(1);
    });
  });

  test("shows the rounded hours which the billable and the unbillable hours add up to", () => {
    var results = olap.results(`
      SELECT {[Measures].[Rounded hours], [Measures].[Billable hours],
              [Measures].[Unbillable hours]} ON COLUMNS,
             NON EMPTY ${rowsSetOf(reportNamed("Sample hours by client"))} ON ROWS
      FROM [${TIMESHEETS}]
    `);

    expect(results.length).toBeGreaterThan(0);
    results.forEach((row) => expect((row[2] || 0) + (row[3] || 0)).toBeCloseTo(row[1], 6));
  });

  test("resolves the members the page filters of the reports start on", () => {
    var reports = REPORTS.filter((report) => report.pageMembers);
    expect(reports.map((report) => report.name)).
      toEqual(["Sample utilisation by person", "Sample active projects status"]);
    reports.forEach((report) => {
      expect(olap.results(`
        SELECT {[Measures].[Hours]} ON COLUMNS,
               {${report.pageMembers.join(", ")}} ON ROWS
        FROM [${report.cube}]
      `)).toHaveLength(report.pageMembers.length);
    });
  });

  test("resolves the Time members of the dashboard filter in both cubes", () => {
    [{cube: TIMESHEETS, measure: "Hours"}, {cube: INVOICES, measure: "Invoice amount"}].
      forEach((cube) => {
        expect(olap.results(`
          SELECT {${measureFullName(cube.measure)}} ON COLUMNS,
                 {${DASHBOARD.timeMembers.join(", ")}} ON ROWS
          FROM [${cube.cube}]
        `)).toHaveLength(DASHBOARD.timeMembers.length);
      });
  });
});

describe("the sample report of the hours by client", () => {
  var CLIENT_WITHOUT_HOURS = {id: 915299, name: "Client without hours", is_active: true, currency: "EUR"};

  beforeAll(() => {
    mockHarvestAccount();
    var clients = mock.fixture("clients");
    clients.clients.push(CLIENT_WITHOUT_HOURS);
    mock.get("/v2/clients", {json: clients});
    var projects = mock.fixture("projects");
    projects.projects.push(Object.assign({}, projects.projects[0], {
      id: 1930199, name: "Project without hours", code: "NOHOURS", budget: null, budget_by: "none",
      client: {id: CLIENT_WITHOUT_HOURS.id, name: CLIENT_WITHOUT_HOURS.name, currency: "EUR"}
    }));
    mock.get("/v2/projects", {json: projects});

    importRun.run();
  });

  test("leaves out the client without hours which shows its project currency", () => {
    var report = reportNamed("Sample hours by client");
    var clientsWithCurrency = olap.results(`
      SELECT {[Measures].[Project currency]} ON COLUMNS,
             NON EMPTY ${setOf(report.rows)} ON ROWS
      FROM [${TIMESHEETS}]
    `).map((row) => row[0]);
    var listedClients = olap.results(`
      SELECT {[Measures].[Rounded hours]} ON COLUMNS,
             Filter(${setOf(report.rows)}, [Measures].[Rounded hours] > 0) ON ROWS
      FROM [${TIMESHEETS}]
    `).map((row) => row[0]);

    expect(clientsWithCurrency).toContain(CLIENT_WITHOUT_HOURS.name);
    expect(listedClients.length).toBeGreaterThan(0);
    expect(listedClients).not.toContain(CLIENT_WITHOUT_HOURS.name);
  });
});
