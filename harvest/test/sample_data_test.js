// The generated sample data of test/sample_data.js imports without an unmocked request and fills every
// dimension the sample reports group by, in the periods the reports open on.

var TIMESHEETS = "[Harvest Timesheets]";
var INVOICES = "[Harvest Invoices]";
var LAST_12_MONTHS = "[Time].[Last 12 months]";
// The total of a cube is read on the All member of a dimension other than Time, which the WHERE clause may
// name.
var TOTAL_MEMBERS = {[TIMESHEETS]: "[Person].DefaultMember", [INVOICES]: "[Invoice Status].DefaultMember"};
// The last day of the capacity as the import answers it, before any test pins it.
var LAST_DAY_OF = app.importers.capacity.lastDayOf;

// The names of the members of the set which have a value of the measure.
function membersWith(cube, set, measure, where) {
  return olap.results(`
    SELECT Filter(${set}, NOT IsEmpty([Measures].[${measure}])) ON ROWS,
           {[Measures].[${measure}]} ON COLUMNS
    FROM ${cube}${where ? ` WHERE ${where}` : ""}`).map((row) => row[0]);
}

function totalOf(cube, measure, where) {
  return olap.results(`
    SELECT {[Measures].[${measure}]} ON COLUMNS, {${TOTAL_MEMBERS[cube]}} ON ROWS
    FROM ${cube}${where ? ` WHERE ${where}` : ""}`)[0][1];
}

describe("sample data", () => {
  beforeAll(() => {
    // The tests which import the fixture account pin the last day of the capacity, and a spy stays for the
    // test files after them.
    mock.spyOn(app.importers.capacity, "lastDayOf").mockImplementation(LAST_DAY_OF);
    mock.sampleData();
    importRun.run();
  });

  test("imports the time entries, the expenses and the invoices without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    expect(totalOf(TIMESHEETS, "Hours")).toBeGreaterThan(15000);
    expect(totalOf(TIMESHEETS, "Expenses amount")).toBeGreaterThan(10000);
    expect(totalOf(INVOICES, "Invoice amount")).toBeGreaterThan(100000);
  });

  // The history ends yesterday, so the current month has no time yet on its first day.
  test("has billable and unbillable time in the months of the last 12 months", () => {
    var months = `DescendantsSet(${LAST_12_MONTHS}, [Time].[Month])`;
    expect(membersWith(TIMESHEETS, months, "Billable hours").length).toBeGreaterThan(10);
    expect(membersWith(TIMESHEETS, months, "Unbillable hours").length).toBeGreaterThan(10);
  });

  test("has several clients, people, roles and tasks in the last 12 months", () => {
    expect(membersWith(TIMESHEETS, "[Project Task].[Client].Members", "Rounded hours", LAST_12_MONTHS).length)
      .toBeGreaterThan(6);
    expect(membersWith(TIMESHEETS, "[Person].[Person].Members", "Hours", LAST_12_MONTHS).length)
      .toBeGreaterThan(9);
    expect(membersWith(TIMESHEETS, "[Role].[Role].Members", "Hours", LAST_12_MONTHS).sort())
      .toEqual(["Designer", "Developer", "Project Manager", "QA"]);
    expect(membersWith(TIMESHEETS, "[Task].[Task].Members", "Billable hours", LAST_12_MONTHS).length)
      .toBeGreaterThan(5);
    expect(membersWith(TIMESHEETS, "[Task].[Task].Members", "Unbillable hours", LAST_12_MONTHS).length)
      .toBeGreaterThan(2);
  });

  test("tracks business and non-business hours, and hours without notes of several people", () => {
    expect(membersWith(TIMESHEETS, "[Working Time].[Working Time].Members", "Hours", LAST_12_MONTHS))
      .toEqual(["Business hours", "Non-business hours"]);
    expect(membersWith(TIMESHEETS, "[Person].[Person].Members", "Hours without notes", LAST_12_MONTHS).length)
      .toBeGreaterThan(5);
  });

  test("links the time to the items of every integration", () => {
    var services = membersWith(TIMESHEETS, "[External Item].[Service].Members", "Hours", LAST_12_MONTHS);
    expect(services.filter((name) => name !== "(none)").sort()).toEqual(["Asana", "GitHub", "Jira", "Trello"]);
    expect(membersWith(TIMESHEETS, "[Person].[Person].Members", "Linked hours", LAST_12_MONTHS).length)
      .toBeGreaterThan(9);
  });

  // Utilisation % is 0, not empty, for a person with capacity and without time, so the time is checked as Hours.
  test("has the capacity and the time of the people in the previous month", () => {
    var previousMonth = "[Time].[Previous month]";
    expect(membersWith(TIMESHEETS, "[Person].[Person].Members", "Capacity hours", previousMonth).length)
      .toBeGreaterThan(8);
    expect(membersWith(TIMESHEETS, "[Person].[Person].Members", "Hours", previousMonth).length)
      .toBeGreaterThan(8);
  });

  // On a Monday early in a month the previous month is already invoiced, and only two clients may have
  // uninvoiced time.
  test("budgets the active projects and leaves the time of several clients uninvoiced", () => {
    expect(membersWith(TIMESHEETS, "[Project Task].[Project].Members", "Budget spent %",
                       "[Project Status].[Active]").length).toBeGreaterThan(7);
    expect(membersWith(TIMESHEETS, "[Project Task].[Project].Members", "Hours", "[Project Status].[Archived]")
      .length).toBe(2);
    expect(membersWith(TIMESHEETS, "[Project Task].[Client].Members", "Uninvoiced amount with expenses").length)
      .toBeGreaterThan(1);
  });

  test("converts the billable and the invoice amounts to EUR and USD", () => {
    expect(totalOf(TIMESHEETS, "Billable amount EUR", LAST_12_MONTHS)).toBeGreaterThan(0);
    expect(totalOf(INVOICES, "Invoice amount USD")).toBeGreaterThan(0);
  });

  // On some days only two invoices of the client who pays late are open.
  test("has invoices of every status and several unpaid ones", () => {
    expect(membersWith(INVOICES, "[Invoice Status].[Invoice Status].Members", "Invoice amount").sort())
      .toEqual(["Closed", "Draft", "Open", "Paid"]);
    expect(membersWith(INVOICES, "[Invoice].[Invoice].Members", "Invoice amount", "[Invoice Status].[Open]").length)
      .toBeGreaterThan(1);
    expect(membersWith(INVOICES, `DescendantsSet(${LAST_12_MONTHS}, [Time].[Month])`, "Invoice amount").length)
      .toBeGreaterThan(10);
  });
});

