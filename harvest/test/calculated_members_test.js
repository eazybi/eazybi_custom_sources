// The calculated members and the property measures of the two cubes, asserted against the one import of
// the fixtures: the sums they are computed from are the ones test/importer_test.js asserts — 80.2 rounded
// and 32.1 billable hours, a billable amount of EUR 567 and USD 2160, USD 1500 of expenses, invoices of
// EUR 2883.20 and USD 200, and the euro reference rate 1.3388 of the dollar.
var ACCOUNT_ID = "1234567";
var SITE_URL = "https://example.harvestapp.com";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";

function mockHarvestAccount(company) {
  // The fixture people were created in February 2012, and their capacity until the end of March 2012 keeps
  // the rows a test reads few.
  mock.spyOn(app.importers.capacity, "lastDayOf").mockReturnValue("2012-03-31");
  mock.sourceParams({api_token: "secret-token", site_url: SITE_URL});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: ACCOUNT_ID, name: "Acme", product: "harvest"}]}});
  mock.extraOptions({time_dimension_time_zone: "UTC"});
  mock.get("/v2/company", company ? {json: company} : {fixture: "company"});
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

// The converted amounts are divided and multiplied in floating point, so an asserted number is compared
// with a tolerance and only a string is compared exactly.
function expectResults(results, expected) {
  expect(results).toHaveLength(expected.length);
  expected.forEach((expectedRow, rowIndex) => {
    var row = results[rowIndex];
    expect(row[0]).toBe(expectedRow[0]);
    expectedRow.slice(1).forEach((value, index) => {
      if (typeof value === "number") expect(row[index + 1]).toBeCloseTo(value, 6);
      else expect(row[index + 1]).toEqual(value);
    });
  });
}

// A date property is answered as the date value itself, and the `mmm dd yyyy` format string of the
// measure is applied when a report displays it. A query run in the same process answers a Java date
// (`Wed Feb 01 00:00:00 UTC 2012`), a query proxied to an eazyBI Cloud child node answers its JSON
// value (`2012-02-01`), therefore both are compared as `2012-02-01`.
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateOf(value) {
  if (value === null) return null;
  var text = String(value);
  var javaDate = text.match(/^\w{3} (\w{3}) (\d\d) \d\d:\d\d:\d\d \S+ (\d{4})$/);
  if (!javaDate) return text.slice(0, 10);
  var month = String(MONTHS.indexOf(javaDate[1]) + 1).padStart(2, "0");
  return `${javaDate[3]}-${month}-${javaDate[2]}`;
}

describe("the calculated members of the Harvest Timesheets cube", () => {
  beforeAll(() => {
    mockHarvestAccount();

    importRun.run();
  });

  // The values of the whole account, which the all member of the Currency dimension holds whatever it
  // is named: the measures of every currency are summed into it.
  function expectAccountTotals(measureNames, expected) {
    var results = olap.results(`
      SELECT {${measureNames.map((name) => `[Measures].[${name}]`).join(", ")}} ON COLUMNS,
             {[Currency].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `);

    expectResults(results, [[results[0][0]].concat(expected)]);
  }

  test("counts the hours which were not billed and the billable hours which were not invoiced", () => {
    expectAccountTotals(["Unbillable hours", "Billable hours %", "Uninvoiced hours"],
      [48.1, 0.400249376558603, 24]);
  });

  // Four time entries of the fixtures have no note. The expenses have notes and no hours, so they add
  // nothing.
  test("counts the hours of the entries with a note and of the entries without one", () => {
    expectAccountTotals(["Hours", "Hours with notes", "Hours without notes"], [80.1, 64.1, 16]);
  });

  test("counts the billable amount and the expenses which were not invoiced", () => {
    expectAccountTotals(["Uninvoiced amount", "Uninvoiced expenses", "Uninvoiced amount with expenses"],
      [2160, 1500, 3660]);
  });

  test("converts the amount of every currency with the euro reference rate of that currency", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Billable amount], [Measures].[Billable amount EUR],
              [Measures].[Billable amount USD]} ON COLUMNS,
             NON EMPTY [Currency].[Currency].Members ON ROWS
      FROM [Harvest Timesheets]
    `), [
      ["EUR", 567, 567, 759.0996],
      ["USD", 2160, 1613.385121003884, 2160]
    ]);
  });

  test("sums the converted amounts of both currencies into the amount of the account", () => {
    expectAccountTotals(
      ["Billable amount EUR", "Billable amount USD", "Invoiced amount EUR", "Invoiced amount USD",
       "Expenses amount EUR", "Expenses amount USD"],
      [2180.385121003884, 2919.0996, 567, 759.0996, 1120.406334030475, 1500]);
  });

  // A page filter of several currencies is an aggregate member of them, here of both currencies of the
  // account, whose converted amounts are those of the whole account.
  test("converts the amounts of several currencies selected together", () => {
    var results = olap.results(`
      WITH MEMBER [Currency].[Both] AS Aggregate({[Currency].[EUR], [Currency].[USD]})
      SELECT {[Measures].[Billable amount EUR], [Measures].[Billable amount USD],
              [Measures].[Margin EUR]} ON COLUMNS,
             {[Currency].DefaultMember, [Currency].[Both]} ON ROWS
      FROM [Harvest Timesheets]
    `);

    expect(results[1][1]).toBeGreaterThan(0);
    expectResults([results[1]], [["Both"].concat(results[0].slice(1))]);
  });

  // The fixture account is kept in euro, so the cost of the time on the dollar project is in euro as
  // well: 40 hours at 30 there and 8.1 hours at 30 on the euro project.
  test("converts the cost amount with the rate of the account currency, not of its row", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Cost amount], [Measures].[Cost amount EUR],
              [Measures].[Cost amount USD]} ON COLUMNS,
             NON EMPTY [Currency].[Currency].Members ON ROWS
      FROM [Harvest Timesheets]
    `), [
      ["EUR", 243, 243, 325.3284],
      ["USD", 1200, 1200, 1606.56]
    ]);
  });

  test("counts the margin of the time as its billable amount less its cost", () => {
    expectAccountTotals(["Cost amount EUR", "Cost amount USD", "Margin EUR", "Margin USD", "Margin %"],
      [1443, 1931.8884, 737.3851210038838, 987.2112, 0.33819031046422665]);
  });

  // No expense of the fixtures is on an invoice, so the invoiced expenses add nothing to the invoiced
  // amount and the whole 1500 of them is uninvoiced.
  test("converts the invoiced and the uninvoiced amount with the expenses", () => {
    expectAccountTotals(
      ["Invoiced expenses EUR", "Invoiced expenses USD", "Invoiced amount with expenses EUR",
       "Invoiced amount with expenses USD", "Uninvoiced amount with expenses EUR",
       "Uninvoiced amount with expenses USD"],
      [null, null, 567, 759.0996, 2733.791455034359, 3660]);
  });

  // A project of an hours budget spends it with the tracked hours, a project of a money budget with the
  // billable amount and the expenses; a project without a budget has no value at all.
  test("shows the share of the budget of a project which is spent", () => {
    var results = olap.results(`
      SELECT {[Measures].[Budget spent %]} ON COLUMNS,
             NON EMPTY [Project Task].[Project].Members ON ROWS
      FROM [Harvest Timesheets]
    `);

    expectResults(_.sortBy(results, (row) => row[0]), [
      ["FIXED-PRICE", 0],
      ["[CONS-SMALLEU] Consulting for Small European company", 0.050625],
      ["[EAZYBI] eazyBI development", 0],
      ["[IMPL-BIGUS] eazyBI implementation for Big US company", 0.08]
    ]);
  });

  test("shows the properties of the project a report row is on", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Project currency], [Measures].[Project status],
              [Measures].[Project manager], [Measures].[Project billable?],
              [Measures].[Project budget by], [Measures].[Project bill by],
              [Measures].[Project hourly rate]} ON COLUMNS,
             {[Project Task].[eazyBI].[Internal],
              [Project Task].[eazyBI].[FIXED-PRICE]} ON ROWS
      FROM [Harvest Timesheets]
    `), [
      ["Internal", "USD", "Active", "Riley Smith", "Yes", "None", "None", null],
      ["FIXED-PRICE", "USD", "Active", "Riley Smith", "Yes", "Task Fees", "Project", null]
    ]);
  });

  // Only the eazyBI development project has time of the Development task. Unfiltered, every project shows its
  // properties, also one without any row.
  test("shows the properties of the projects and clients with rows in a report filtered by a task", () => {
    function rowsOf(level, slicer) {
      return olap.results(`
        SELECT {[Measures].[Project manager], [Measures].[Project currency]} ON COLUMNS,
               NON EMPTY [Project Task].[${level}].Members ON ROWS
        FROM [Harvest Timesheets]
        ${slicer}
      `).map((row) => row[0]);
    }

    expect(rowsOf("Project", "WHERE [Task].[Development]")).toEqual(["[EAZYBI] eazyBI development"]);
    expect(rowsOf("Client", "WHERE [Task].[Development]")).toEqual(["eazyBI"]);
    expect(rowsOf("Project", "")).toHaveLength(5);
  });

  test("shows the properties of a project only in the weeks it has rows in", () => {
    var results = olap.results(`
      SELECT {[Measures].[Project manager], [Measures].[Hours], [Measures].[Expenses amount]} ON COLUMNS,
             NON EMPTY CrossJoin([Project Task].[Project].Members, [Time.Weekly].[Week].Members) ON ROWS
      FROM [Harvest Timesheets]
    `);

    expect(results.length).toBeGreaterThan(0);
    expect(results.filter((row) => row[2] === null && row[3] === null)).toEqual([]);
  });

  // Only the one project of the fixtures which is budgeted by its cost answers whether that budget
  // includes the expenses of the project.
  test("shows whether the cost budget of a project includes its expenses", () => {
    expect(olap.results(`
      SELECT {[Measures].[Project budget includes expenses?]} ON COLUMNS,
             NON EMPTY [Project Task].[Project].Members ON ROWS
      FROM [Harvest Timesheets]
    `)).toEqual([["[EAZYBI] eazyBI development", "No"]]);
  });

  test("shows the dates of the projects which have them", () => {
    var results = _.sortBy(olap.results(`
      SELECT {[Measures].[Project start date], [Measures].[Project end date]} ON COLUMNS,
             NON EMPTY [Project Task].[Project].Members ON ROWS
      FROM [Harvest Timesheets]
    `), (row) => row[0]);

    expect(results.map((row) => [row[0], dateOf(row[1]), dateOf(row[2])])).toEqual([
      ["[CONS-SMALLEU] Consulting for Small European company", "2012-02-01", null],
      ["[EAZYBI] eazyBI development", "2012-01-30", "2012-04-30"],
      ["[IMPL-BIGUS] eazyBI implementation for Big US company", null, "2012-04-30"]
    ]);
  });

  // The Internal project has no rate of its own, only its Admin task has one as the project assigns it.
  test("shows the properties of the task of the project a report row is on", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Project task billable?], [Measures].[Project task hourly rate],
              [Measures].[Project hourly rate]} ON COLUMNS,
             {[Project Task].[eazyBI].[Internal].[Admin]} ON ROWS
      FROM [Harvest Timesheets]
    `), [["Admin", "No", 123.45, null]]);
  });

  test("shows the properties of the person a report row is on", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Person type], [Measures].[Person weekly capacity],
              [Measures].[Person default hourly rate], [Measures].[Person cost rate]} ON COLUMNS,
             {[Person].[Employees].[Riley Smith]} ON ROWS
      FROM [Harvest Timesheets]
    `), [["Riley Smith", "Employees", 35, 100, 50]]);
  });

  test("shows the first and the last day the person tracked time on", () => {
    var results = olap.results(`
      SELECT {[Measures].[Person first tracked date], [Measures].[Person last tracked date]} ON COLUMNS,
             {[Person].[Employees].[Riley Smith], [Person].[Contractors].[Chuck Norris]} ON ROWS
      FROM [Harvest Timesheets]
    `);

    expect(results.map((row) => [row[0], dateOf(row[1]), dateOf(row[2])])).toEqual([
      ["Riley Smith", "2012-01-30", "2012-02-10"],
      ["Chuck Norris", null, null]
    ]);
  });

  // Riley Smith has 45 working days of capacity and all the 80.1 hours, of which 32.1 are
  // billable; Chuck Norris has 29 days and no time. Both are available 7 hours a day.
  test("divides the hours of the people by their capacity", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Capacity hours], [Measures].[Utilisation %],
              [Measures].[Billable utilisation %]} ON COLUMNS,
             {[Person].[Employees].[Riley Smith], [Person].[Contractors].[Chuck Norris],
              [Person].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `), [
      ["Riley Smith", 315, 80.1 / 315, 32.1 / 315],
      ["Chuck Norris", 203, 0, 0],
      ["All People", 518, 80.1 / 518, 32.1 / 518]
    ]);
  });

  test("divides the hours of a project by the capacity of the people", () => {
    var results = olap.results(`
      SELECT {[Measures].[Hours], [Measures].[Capacity hours], [Measures].[Utilisation %]} ON COLUMNS,
             NON EMPTY [Project Task].[Project].Members ON ROWS
      FROM [Harvest Timesheets]
    `);

    expect(results.length).toBeGreaterThan(1);
    results.forEach((row) => {
      expect(row[2]).toBe(null);
      expect(row[3]).toBeCloseTo(row[1] / 518, 6);
    });
  });

  test("leaves the utilisation of a person on a project without time empty", () => {
    var results = olap.results(`
      SELECT {[Measures].[Utilisation %], [Measures].[Billable utilisation %]} ON COLUMNS,
             CrossJoin({[Person].[Contractors].[Chuck Norris]}, [Project Task].[Project].Members) ON ROWS
      FROM [Harvest Timesheets]
    `);

    expect(results.length).toBeGreaterThan(1);
    results.forEach((row) => expect(row.slice(1)).toEqual([null, null]));
  });

  test("shows the day the person was added to Harvest", () => {
    var results = olap.results(`
      SELECT {[Measures].[Person created date]} ON COLUMNS,
             {[Person].[Employees].[Riley Smith], [Person].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `);

    expect(results.map((row) => dateOf(row[1]))).toEqual(["2012-02-20", null]);
  });

  test("shows the hourly rate of the task of the account a report row is on", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Task hourly rate]} ON COLUMNS,
             NON EMPTY [Task].[Task].Members ON ROWS
      FROM [Harvest Timesheets]
    `), [["Consulting", 100]]);
  });
});

describe("the calculated members of the Harvest Invoices cube", () => {
  beforeAll(() => {
    mockHarvestAccount();

    importRun.run();
  });

  function expectAccountTotals(measureNames, expected) {
    var results = olap.results(`
      SELECT {${measureNames.map((name) => `[Measures].[${name}]`).join(", ")}} ON COLUMNS,
             {[Currency].DefaultMember} ON ROWS
      FROM [Harvest Invoices]
    `);

    expectResults(results, [[results[0][0]].concat(expected)]);
  }

  test("converts the amount of every invoice with the euro reference rate of its own currency", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Invoice amount], [Measures].[Invoice amount EUR],
              [Measures].[Invoice amount USD]} ON COLUMNS,
             NON EMPTY [Currency].[Currency].Members ON ROWS
      FROM [Harvest Invoices]
    `), [
      ["EUR", 2883.2, 2883.2, 3860.02816],
      ["USD", 200, 149.387511204063, 200]
    ]);
  });

  test("sums the converted amounts of both currencies into the amount of the account", () => {
    expectAccountTotals(
      ["Invoice amount EUR", "Invoice amount USD", "Item amount EUR", "Item amount USD",
       "Due amount EUR", "Due amount USD"],
      [3032.587511204063, 4060.02816, 2909.387511204063, 3895.088, 2349.387511204063, 3145.36]);
  });

  // No invoice of the fixtures is discounted, so the discounted amount of the account is zero in both
  // currencies and not empty — every invoice answers a discount amount of 0.
  test("converts the discount of the invoices", () => {
    expectAccountTotals(["Discount amount", "Discount amount EUR", "Discount amount USD"], [0, 0, 0]);
  });

  // Only the euro invoice of the European client is taxed, and neither invoice has a second tax.
  test("converts the taxes of the invoices", () => {
    expectAccountTotals(["Tax amount", "Tax amount EUR", "Tax amount USD", "Second tax amount",
                         "Second tax amount EUR", "Second tax amount USD"],
      [123.2, 123.2, 164.94016, 0, 0, 0]);
  });

  // The Sample unpaid invoices report filtered to Open invoices, or to the euro, kept the row of the dollar
  // draft invoice of the Big US company.
  test("leaves the properties of an invoice the page filters leave out empty", () => {
    function statusesOf(slicer) {
      return _.uniq(olap.results(`
        SELECT {[Measures].[Invoice status], [Measures].[Invoice issued date], [Measures].[Invoice currency],
                [Measures].[Invoice item category]} ON COLUMNS,
               NON EMPTY [Invoice].Members ON ROWS
        FROM [Harvest Invoices]
        WHERE ${slicer}
      `).map((row) => row[1])).sort();
    }

    expect(statusesOf("[Invoice Status].[Open]")).toEqual(["Open"]);
    expect(statusesOf("[Currency].[EUR]")).toEqual(["Open", "Paid"]);
  });

  // Only the Consulting project of the European client is on the paid invoice. The eazyBI development
  // project has no invoice and shows its properties only in a report without filters.
  test("shows the properties of the projects with rows of the invoices the page filters select", () => {
    function projectsOf(slicer) {
      return olap.results(`
        SELECT {[Measures].[Project status], [Measures].[Project manager]} ON COLUMNS,
               NON EMPTY [Client Project].[Project].Members ON ROWS
        FROM [Harvest Invoices]
        ${slicer}
      `).map((row) => row[0]);
    }

    var paid = projectsOf("WHERE [Invoice Status].[Paid]");
    expect(paid).toContain("[CONS-SMALLEU] Consulting for Small European company");
    expect(paid).not.toContain("[EAZYBI] eazyBI development");
    expect(projectsOf("")).toContain("[EAZYBI] eazyBI development");
  });

  test("shows the properties of the invoice a report row is on", () => {
    expectResults(olap.results(`
      SELECT {[Measures].[Invoice status], [Measures].[Invoice client],
              [Measures].[Invoice currency], [Measures].[Invoice created by],
              [Measures].[Invoice PO number]} ON COLUMNS,
             NON EMPTY [Invoice].[Invoice].Members ON ROWS
      FROM [Harvest Invoices]
    `), [
      ["#1 Small European company (1241021)", "Paid", "Small European company", "EUR",
       "Riley Smith", "PO-1241021"],
      ["#2 Big US company", "Draft", "Big US company", "USD", null, "PO-1242635"],
      ["#1 Small European company (10577835)", "Open", "Small European company", "EUR",
       "Riley Smith", "PO-10577835"]
    ]);
  });

  test("shows the dates of the invoice a report row is on", () => {
    var results = olap.results(`
      SELECT {[Measures].[Invoice issued date], [Measures].[Invoice due date],
              [Measures].[Invoice period start date], [Measures].[Invoice period end date]}
                ON COLUMNS,
             NON EMPTY [Invoice].[Invoice].Members ON ROWS
      FROM [Harvest Invoices]
    `);

    expect(results.map((row) => [row[0]].concat(row.slice(1).map(dateOf)))).toEqual([
      ["#1 Small European company (1241021)", "2012-02-20", "2012-02-20",
       "2012-02-02", "2012-02-02"],
      ["#2 Big US company", "2012-02-21", "2012-03-07", null, null],
      ["#1 Small European company (10577835)", "2016-09-05", "2016-09-05", null, null]
    ]);
  });

  test("shows the category and the project of the line item a report row is on", () => {
    var results = olap.results(`
      SELECT {[Measures].[Invoice item category], [Measures].[Invoice item project],
              [Measures].[Item amount]} ON COLUMNS,
             NON EMPTY [Invoice].[Invoice Item].Members ON ROWS
      FROM [Harvest Invoices]
    `);

    expect(_.sortBy(results, (row) => row[0])).toEqual([
      ["1 1 ", "Service", null, 800],
      ["123 sdf 2", "Service", null, 600],
      ["123123", "Service", null, 100],
      ["123sdf", "Service", null, 500],
      ["Remote eazyBI monthly subscription", "Service", null, 200],
      ["[CONS-SMALLEU] Consulting for Small European company: Consulting (2012-02-02 - 2012-02-02)",
       "Service", "[CONS-SMALLEU] Consulting for Small European company", 560],
      ["asdasd", "Service", null, 200]
    ]);
  });

  // A property measure has a value for every project member, so the rows are the invoiced ones.
  test("shows the properties of the project a report row is on", () => {
    var results = olap.results(`
      SELECT {[Measures].[Project currency], [Measures].[Project status],
              [Measures].[Project manager], [Measures].[Item amount]} ON COLUMNS,
             NON EMPTY [Client Project].[Project].Members ON ROWS
      FROM [Harvest Invoices]
    `);

    expect(results.filter((row) => row[4] !== null)).toEqual([
      ["[CONS-SMALLEU] Consulting for Small European company", "EUR", "Active",
       "Riley Smith", 560]
    ]);
  });
});

// The Internal project and the only project of the Big US company client are archived. The report of the
// active projects is the Sample active projects status report, whose property columns kept the row of
// every archived project.
describe("the properties of a project of another status than the report is filtered by", () => {
  beforeAll(() => {
    mockHarvestAccount();
    var projects = mock.fixture("projects");
    projects.projects.forEach((project) => {
      if (project.id === 1930099 || project.id === 1930109) project.is_active = false;
    });
    mock.get("/v2/projects", {json: projects});

    importRun.run();
  });

  function projectRows(slicer) {
    return olap.results(`
      SELECT {[Measures].[Project manager], [Measures].[Project currency],
              [Measures].[Project budget by]} ON COLUMNS,
             NON EMPTY [Project Task].[Project].Members ON ROWS
      FROM [Harvest Timesheets]
      ${slicer ? `WHERE ${slicer}` : ""}
    `).map((row) => row[0]).sort();
  }

  test("leaves the properties of the archived projects out of a report of the active ones", () => {
    expect(projectRows("[Project Status].[Active]")).not.toContain("Internal");
    expect(projectRows("[Project Status].[Archived]")).
      toEqual(["Internal", "[IMPL-BIGUS] eazyBI implementation for Big US company"]);
    expect(projectRows()).toContain("Internal");
  });

  test("leaves the task properties of an archived project and the currency of its client out", () => {
    ["[Project Task].[eazyBI].[Internal]", "[Project Task].[Big US company]"].forEach((archived) => {
      expect(olap.results(`
        SELECT {[Measures].[Project task billable?], [Measures].[Project task hourly rate]} ON COLUMNS,
               NON EMPTY Descendants(${archived}, [Project Task].[Task]) ON ROWS
        FROM [Harvest Timesheets]
        WHERE [Project Status].[Active]
      `)).toEqual([]);
    });

    var clients = olap.results(`
      SELECT {[Measures].[Project currency]} ON COLUMNS,
             NON EMPTY [Project Task].[Client].Members ON ROWS
      FROM [Harvest Timesheets]
      WHERE [Project Status].[Active]
    `).map((row) => row[0]);
    expect(clients).toContain("eazyBI");
    expect(clients).not.toContain("Big US company");
  });

  test("shows the properties of a project in its own status", () => {
    expect(olap.results(`
      SELECT {[Measures].[Project manager], [Measures].[Project currency]} ON COLUMNS,
             {[Project Task].[eazyBI].[Internal]} ON ROWS
      FROM [Harvest Timesheets]
      WHERE [Project Status].[Archived]
    `)).toEqual([["Internal", "Riley Smith", "USD"]]);
  });
});

// An account kept in euros, whose time is billed in euros and in dollars, on its first import while the
// document of the European Central Bank can not be read: the euro is the euro, the dollar has no rate.
describe("the margin of an account billing a currency without a rate", () => {
  beforeAll(() => {
    mockHarvestAccount({name: "API Examples", base_uri: SITE_URL, expense_feature: true,
                        invoice_feature: true, currency: "EUR"});
    mock.get(ECB_RATES_URL, {status: 404});

    importRun.run();
  });

  test("leaves the margins empty and converts the cost", () => {
    expect(olap.results(`
      SELECT {[Measures].[Cost amount EUR], [Measures].[Margin EUR], [Measures].[Margin USD],
              [Measures].[Margin %]} ON COLUMNS,
             {[Currency].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `)[0].slice(1)).toEqual([1443, null, null, null]);
  });
});

// Time billed in dollars at a rate of zero needs no dollar rate: its billable amount is zero in every
// currency, and only its cost, which is in euros, counts.
describe("the margin of an account billing a currency without a rate only at a rate of zero", () => {
  beforeAll(() => {
    mockHarvestAccount({name: "API Examples", base_uri: SITE_URL, expense_feature: true,
                        invoice_feature: true, currency: "EUR"});
    mock.get(ECB_RATES_URL, {status: 404});
    var entry = {spent_date: "2012-02-01", is_closed: false, is_billed: false, billable: true,
                 cost_rate: 30, task: {id: 1245133}, user: {id: 312294},
                 updated_at: "2012-02-01T10:00:00Z"};
    mock.get("/v2/time_entries", {json: {time_entries: [
      _.extend({id: 1, project: {id: 1930115}, hours_without_timer: 10, rounded_hours: 10,
                billable_rate: 100}, entry),
      _.extend({id: 2, project: {id: 1930109}, hours_without_timer: 8, rounded_hours: 8,
                billable_rate: 0}, entry)
    ]}});

    importRun.run();
  });

  test("counts the margin of the euros and the cost of the dollar time", () => {
    var results = olap.results(`
      SELECT {[Measures].[Cost amount EUR], [Measures].[Margin EUR], [Measures].[Margin %]} ON COLUMNS,
             {[Currency].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `);
    expectResults(results, [[results[0][0], 540, 460, 0.46]]);
  });
});

// The rate of the account currency is unknown until the European Central Bank answers one: on the first
// import of an account kept in pounds while its document can not be read.
describe("the cost of an account whose currency has no rate", () => {
  beforeAll(() => {
    mockHarvestAccount({name: "API Examples", base_uri: SITE_URL, expense_feature: true,
                        invoice_feature: true, currency: "GBP"});
    mock.get(ECB_RATES_URL, {status: 404});

    importRun.run();
  });

  test("leaves the conversions of the cost amount and the margins empty", () => {
    expect(olap.results(`
      SELECT {[Measures].[Cost amount], [Measures].[Cost amount EUR], [Measures].[Cost amount USD],
              [Measures].[Margin EUR], [Measures].[Margin USD], [Measures].[Margin %]} ON COLUMNS,
             {[Currency].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `)[0].slice(1)).toEqual([1443, null, null, null, null, null]);
  });

  // The euro is the euro, and the dollar has no rate: the euro sum leaves out the USD 2160 of the dollar
  // rows, and the dollar sum is empty.
  test("leaves the amounts of a currency without a rate out of the converted sums", () => {
    expect(olap.results(`
      SELECT {[Measures].[Billable amount], [Measures].[Billable amount EUR],
              [Measures].[Billable amount USD]} ON COLUMNS,
             {[Currency].DefaultMember} ON ROWS
      FROM [Harvest Timesheets]
    `)[0].slice(1)).toEqual([2727, 567, null]);
  });
});
