// The people assigned to the projects and the managers of each project among them, which the Project
// manager property and the Project Manager dimension report.
//
// The imports of the fixture account below are here and not in test/importer_test.js: a test run keeps the
// first 2000 log lines of the whole run, and test/importers/selection_test.js reads a log line of its own.
var ACCOUNT_ID = "1234567";
var SITE_URL = "https://example.harvestapp.com";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";
var LONG_AGO = "2026-01-01T00:00:00Z";

var INTERNAL_PROJECT_ID = 1930099;
var BIG_US_PROJECT_ID = 1930109;
var CONSULTING_PROJECT_ID = 1930115;

var TWO_PEOPLE = [
  {id: 312294, first_name: "Riley", last_name: "Smith", roles: []},
  {id: 312875, first_name: "Chuck", last_name: "Norris", roles: []}
];

// The people of the account and the assignments of the consulting project, with the users read first, as
// the import reads them, because a manager is named by the users list.
function fetchAssignments(assignments, users) {
  mock.sourceParams({api_token: "secret-token"});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});
  mock.get("/v2/users", {json: {users: users || TWO_PEOPLE}});
  mock.get("/v2/user_assignments", {json: {user_assignments: assignments}});
  importRun.prepare();
  app.importers.selection.begin([]);
  app.importers.users.importAll();
  app.importers.userAssignments.fetchAll();
}

function managerAssignment(userId, attributes) {
  var record = {id: userId + 1, project: {id: CONSULTING_PROJECT_ID}, user: {id: userId},
                is_project_manager: true, is_active: true, budget: null, hourly_rate: null};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

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

// The user assignments of the fixture account with a second manager of two projects. Chuck Norris manages
// the consulting project, where he is assigned already, and the Big US company project. He is also a
// manager of the eazyBI development project whose assignment is inactive, and a person whom the users list
// does not answer manages the Internal project, so neither of the two adds a manager.
function mockSeveralManagers() {
  var assignments = mock.fixture("user_assignments");
  assignments.user_assignments.forEach((assignment) => {
    if (assignment.id === 15236610) assignment.is_project_manager = true;
  });
  assignments.user_assignments.push(
    managerAssignment(312875, {id: 15236700, project: {id: BIG_US_PROJECT_ID}}),
    managerAssignment(312875, {id: 15236701, project: {id: 1930103}, is_active: false}),
    managerAssignment(999999, {id: 15236702, project: {id: INTERNAL_PROJECT_ID}}));
  mock.get("/v2/user_assignments", {json: assignments});
}

function mockNothingChangedSinceMark() {
  var mark = importRun.maxParams().updated_at;
  ["time_entries", "expenses", "invoices"].forEach((list) => {
    var response = {};
    response[list] = [];
    mock.get(`/v2/${list}`, {params: {updated_since: mark}, json: response});
  });
  return mark;
}

function projectManagers() {
  return dwh.dimensions.project_managers.rows({columns: ["project_id", "name"],
                                               orderBy: ["project_id", "name"]});
}

function projectManagerProperties() {
  return dwh.dimensions.projects.rows({columns: ["id", "project_manager"], orderBy: "id"}).
    filter((project) => project.id > 0);
}

// The rows of a project under each of its managers, as [[project, manager], rounded hours] rows.
function hoursOfProjectManagers() {
  return _.sortBy(olap.results(`
    SELECT {[Measures].[Rounded hours]} ON COLUMNS,
           NON EMPTY CrossJoin([Project Task].[Project].Members,
             [Project Manager].[Project Manager].Members) ON ROWS
    FROM [Harvest Timesheets]
  `), (row) => row[0].join(" / "));
}

var HOURS_OF_SEVERAL_MANAGERS = [
  [["Internal", "Riley Smith"], 8.1],
  [["[CONS-SMALLEU] Consulting for Small European company", "Chuck Norris"], 8.1],
  [["[CONS-SMALLEU] Consulting for Small European company", "Riley Smith"], 8.1],
  [["[EAZYBI] eazyBI development", "Riley Smith"], 24],
  [["[IMPL-BIGUS] eazyBI implementation for Big US company", "Chuck Norris"], 40],
  [["[IMPL-BIGUS] eazyBI implementation for Big US company", "Riley Smith"], 40]
];

describe("app.importers.userAssignments", () => {
  test("names all managers of a project, sorted by name", () => {
    fetchAssignments([managerAssignment(312294), managerAssignment(312875)]);

    expect(app.importers.userAssignments.managerNamesOf(CONSULTING_PROJECT_ID)).
      toEqual(["Chuck Norris", "Riley Smith"]);
  });

  test("names no manager of a project whose people do not manage it", () => {
    fetchAssignments([managerAssignment(312294, {is_project_manager: false})]);

    expect(app.importers.userAssignments.managerNamesOf(CONSULTING_PROJECT_ID)).toEqual([]);
    expect(app.importers.userAssignments.managerNamesOf(4242)).toEqual([]);
  });

  test("leaves out a manager whose assignment is inactive", () => {
    fetchAssignments([managerAssignment(312294), managerAssignment(312875, {is_active: false})]);

    expect(app.importers.userAssignments.managerNamesOf(CONSULTING_PROJECT_ID)).
      toEqual(["Riley Smith"]);
  });

  test("leaves out a manager who is not in the users list", () => {
    fetchAssignments([managerAssignment(312294), managerAssignment(999999)]);

    expect(app.importers.userAssignments.managerNamesOf(CONSULTING_PROJECT_ID)).
      toEqual(["Riley Smith"]);
    expect(app.importers.userAssignments.ofProject(CONSULTING_PROJECT_ID, 999999)).not.toBeNull();
  });

  test("appends the Harvest id to a manager name which several people have", () => {
    var users = TWO_PEOPLE.concat([
      {id: 312900, first_name: "chuck", last_name: "norris", roles: []},
      {id: 312901, first_name: "Anna", last_name: "Ozola", roles: []}
    ]);
    fetchAssignments([managerAssignment(312875), managerAssignment(312900), managerAssignment(312901),
                      managerAssignment(312294)], users);

    var managerNames = app.importers.userAssignments.managerNamesOf(CONSULTING_PROJECT_ID);
    expect(managerNames).
      toEqual(["Anna Ozola", "Chuck Norris (312875)", "Riley Smith", "chuck norris (312900)"]);
    var personNames = dwh.dimensions.people.rows({columns: ["name"]}).map((person) => person.name);
    expect(personNames.sort()).toEqual(managerNames);
  });

  test("names a manager whom Harvest assigns twice once", () => {
    fetchAssignments([managerAssignment(312294), managerAssignment(312294, {id: 7})]);

    expect(app.importers.userAssignments.managerNamesOf(CONSULTING_PROJECT_ID)).
      toEqual(["Riley Smith"]);
  });
});

describe("app.importer.importAll of the managers of a project", () => {
  describe("of several managers of a project", () => {
    beforeAll(() => {
      mockHarvestAccount();
      mockSeveralManagers();

      importRun.run();
    });

    test("names all managers of a project in the Project manager property, sorted by name", () => {
      expect(projectManagerProperties()).toEqual([
        {id: INTERNAL_PROJECT_ID, project_manager: "Riley Smith"},
        {id: 1930103, project_manager: "Riley Smith"},
        {id: BIG_US_PROJECT_ID, project_manager: "Chuck Norris, Riley Smith"},
        {id: CONSULTING_PROJECT_ID, project_manager: "Chuck Norris, Riley Smith"},
        {id: 11637625, project_manager: "Riley Smith"}
      ]);
      expect(olap.results(`
        SELECT {[Measures].[Project manager]} ON COLUMNS,
               {[Project Task].[Small European company].
                 [[CONS-SMALLEU]] Consulting for Small European company]} ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["[CONS-SMALLEU] Consulting for Small European company",
                    "Chuck Norris, Riley Smith"]]);
    });

    test("writes one manager row per manager of a project", () => {
      expect(projectManagers().filter((row) => row.project_id > 0)).toEqual([
        {project_id: INTERNAL_PROJECT_ID, name: "Riley Smith"},
        {project_id: 1930103, name: "Riley Smith"},
        {project_id: BIG_US_PROJECT_ID, name: "Chuck Norris"},
        {project_id: BIG_US_PROJECT_ID, name: "Riley Smith"},
        {project_id: CONSULTING_PROJECT_ID, name: "Chuck Norris"},
        {project_id: CONSULTING_PROJECT_ID, name: "Riley Smith"},
        {project_id: 11637625, name: "Riley Smith"}
      ]);
    });

    // The hours of a project are reported under each of its managers in full, so the members do not add up
    // to the total. All Project Managers counts every row once, while an aggregate of several managers
    // counts the rows of a project they share once for each of them.
    test("reports the hours of a project under each of its managers and counts them once in the total",
      () => {
        expect(hoursOfProjectManagers()).toEqual(HOURS_OF_SEVERAL_MANAGERS);

        var results = olap.results(`
          WITH MEMBER [Project Manager].[Both managers] AS
            Aggregate({[Project Manager].[Chuck Norris], [Project Manager].[Riley Smith]})
          SELECT {[Measures].[Rounded hours]} ON COLUMNS,
                 {[Project Manager].[Project Manager].Members, [Project Manager].DefaultMember,
                  [Project Manager].[Both managers]} ON ROWS
          FROM [Harvest Timesheets]
        `);
        expect(results.map((row) => row[0])).toEqual(["(no manager)", "Chuck Norris",
          "Riley Smith", "All Project Managers", "Both managers"]);
        expect(results[0][1]).toBeNull();
        [48.1, 80.2, 80.2, 128.3].forEach((hours, index) =>
          expect(results[index + 1][1]).toBeCloseTo(hours));
      });

    // The line item of the consulting project is reported under both of its managers, the amounts of the
    // invoices themselves under the `(no manager)` member of the nameless projects of their clients.
    test("reports the invoice items of a project under each of its managers", () => {
      expect(olap.results(`
        SELECT {[Measures].[Item amount]} ON COLUMNS,
               {[Project Manager].[Project Manager].Members, [Project Manager].DefaultMember} ON ROWS
        FROM [Harvest Invoices]
      `)).toEqual([["(no manager)", 2400], ["Chuck Norris", 560], ["Riley Smith", 560],
                   ["All Project Managers", 2960]]);
    });
  });

  // Every test of this describe imports itself, because it changes the managers.
  describe("of the changes of the managers", () => {
    beforeEach(mockHarvestAccount);

    test("reports a project without a known manager under the (no manager) member", () => {
      var assignments = mock.fixture("user_assignments");
      assignments.user_assignments.forEach((assignment) => {
        if (assignment.project.id === INTERNAL_PROJECT_ID) assignment.user.id = 999999;
      });
      mock.get("/v2/user_assignments", {json: assignments});

      importRun.run();

      expect(projectManagerProperties()[0]).toEqual({id: INTERNAL_PROJECT_ID, project_manager: null});
      expect(projectManagers().filter((row) => row.project_id === INTERNAL_PROJECT_ID)).
        toEqual([{project_id: INTERNAL_PROJECT_ID, name: "(no manager)"}]);
      expect(olap.results(`
        SELECT {[Measures].[Rounded hours]} ON COLUMNS,
               NON EMPTY [Project Manager].[Project Manager].Members ON ROWS
        FROM [Harvest Timesheets]
      `)).toEqual([["(no manager)", 8.1], ["Riley Smith", 72.1]]);
    });

    // The managers are rows of the project and not of the timesheet row, so a manager change in Harvest
    // applies to every stored row of the project, also to the entries which did not change.
    test("reports every row of a project under the managers it has now", () => {
      importRun.run();
      mockSeveralManagers();
      var mark = mockNothingChangedSinceMark();

      importRun.run();

      var requests = mock.requests().filter((request) => request.path === "/v2/time_entries");
      expect(requests[requests.length - 1].params.updated_since).toBe(mark);
      expect(projectManagerProperties()[3]).
        toEqual({id: CONSULTING_PROJECT_ID, project_manager: "Chuck Norris, Riley Smith"});
      expect(hoursOfProjectManagers()).toEqual(HOURS_OF_SEVERAL_MANAGERS);
    });

    test("writes the manager rows of a project again only when its managers changed or with a check", () => {
      importRun.run();
      var insertRows = mock.spyOn(dwh.dimensions.project_managers, "insertRows");

      importRun.run();
      expect(insertRows).not.toHaveBeenCalled();

      mockSeveralManagers();
      importRun.run();
      expect(insertRows).toHaveBeenCalledTimes(2);
      expect(insertRows).toHaveBeenCalledWith([
        {project_id: CONSULTING_PROJECT_ID, name: "Chuck Norris", generation: 1},
        {project_id: CONSULTING_PROJECT_ID, name: "Riley Smith", generation: 1}
      ]);

      insertRows.mockClear();
      mock.maxParams({updated_at: LONG_AGO, generation: 1, sweep_at: LONG_AGO});
      importRun.run();
      // The five projects and the nameless projects of the three clients.
      expect(insertRows).toHaveBeenCalledTimes(8);
      expect(_.uniq(dwh.dimensions.project_managers.rows({columns: ["generation"]}).
        map((row) => row.generation))).toEqual([2]);
      expect(projectManagers()).toHaveLength(10);
    });
  });
});
