// The generated sample data of test/sample_data.js imports without an unmocked request and fills every
// dimension the sample reports group by in their default Last 12 months.
describe("sample data", () => {
  var LAST_12_MONTHS = "[Time].[Last 12 months]";

  // The members of the set which have a value of the measure. Mondrian has no NonEmpty function.
  function membersWith(set, measure, where) {
    return olap.results(`
      SELECT Filter(${set}, NOT IsEmpty([Measures].[${measure}])) ON ROWS,
             {[Measures].[${measure}]} ON COLUMNS
      FROM [GitHub] WHERE ${where || LAST_12_MONTHS}`).map((row) => row[0]);
  }

  function value(measure, member) {
    return olap.results(`
      SELECT {[Measures].[${measure}]} ON COLUMNS, {${member}} ON ROWS
      FROM [GitHub]`)[0][1];
  }

  beforeAll(() => {
    mock.sampleData();
    importRun.run();
  });

  test("imports the pull requests of every repository without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    expect(membersWith("[Repository].[Repository].Members", "Pull requests created")).toEqual([
      "api-server", "data-pipeline", "design-system", "infrastructure", "mobile-app", "web-app"
    ]);
    expect(value("Pull requests created", "[Time].[All Times]")).toBeGreaterThan(1000);
  });

  test("has pull requests that are open at the start of the last 12 months", () => {
    expect(value("Open pull requests", "[Time].[Last 12 months]")).toBeGreaterThan(10);
    var firstMonth = olap.results(`
      SELECT {[Measures].[Open pull requests]} ON COLUMNS,
             {Head(DescendantsSet(${LAST_12_MONTHS}, [Time].[Month]))} ON ROWS
      FROM [GitHub]`)[0][1];
    expect(firstMonth).toBeGreaterThan(10);
  });

  test("has merged and closed pull requests in the last 12 months", () => {
    expect(membersWith("[Pull Request State].[Pull Request State].Members", "Pull requests closed")).
      toEqual(["Merged", "Closed"]);
  });

  test("has several authors of both account types", () => {
    expect(membersWith("[Pull Request Author].[Account].Members", "Pull requests created").length).
      toBeGreaterThan(10);
    expect(membersWith("[Pull Request Author.By type].[Type].Members", "Pull requests created")).
      toEqual(["Bot", "User"]);
  });

  test("has user reviewers and the reviews of the user and the bot accounts", () => {
    expect(membersWith("[Pull Request Reviewer.By type].[User].Children", "Pull requests created").length).
      toBeGreaterThan(10);
    expect(membersWith("[Comment Author.By type].[Type].Members", "Reviews submitted")).toEqual(["Bot", "User"]);
    expect(membersWith("[Comment Author.By type].[Type].Members", "Comments per review")).toEqual(["Bot", "User"]);
  });

  test("has commits and the state history of the pull requests", () => {
    expect(value("Commits submitted", LAST_12_MONTHS)).toBeGreaterThan(1000);
    expect(membersWith("[Pull Request State].[Pull Request State].Members", "Transitions to state")).
      toEqual(["Open", "Changes Requested", "Approved", "Merged", "Closed"]);
  });

  test("has labels and milestones", () => {
    expect(membersWith("[Label].[Label].Members", "Pull requests created", "[Time].[All Times]").length).
      toBeGreaterThan(5);
    expect(membersWith("[Milestone].[Milestone].Members", "Pull requests created").length).
      toBeGreaterThan(20);
  });

  test("has open pull requests which are ready for review", () => {
    var openReady = dwh.dimensions.pull_requests.rows({columns: ["state", "draft"], limit: 5000}).
      filter((row) => row.state === "Open" && row.draft === "No");
    expect(openReady.length).toBeGreaterThan(10);
  });
});
