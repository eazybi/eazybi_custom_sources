// The members of the set which have a value of the measure. Mondrian has no NonEmpty function.
function membersWith(set, measure, where) {
  return olap.results(`
    SELECT Filter(${set}, NOT IsEmpty([Measures].[${measure}])) ON ROWS,
           {[Measures].[${measure}]} ON COLUMNS
    FROM [Issues]${where ? " WHERE " + where : ""}`).map((row) => row[0]);
}

describe("sample data", () => {
  beforeAll(() => {
    mock.sampleData();
    importRun.runJira();
  });

  test("imports the checklists of the generated issues without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    expect(importRun.objectFailures()).toEqual([]);
    var issues = dwh.jira.issues.rows({columns: ["issue_key", "hcchk_items_total"], limit: 1000}).
      filter((row) => row.issue_key);
    expect(issues.length).toBe(500);
    expect(issues.filter((row) => row.hcchk_items_total > 0).length).toBeGreaterThan(250);
  });

  test("has the checklists and the item statuses of every template", () => {
    expect(dwh.dimensions.checklists.rows().map((row) => row.name).sort()).toEqual([
      "Acceptance Criteria", "Bug Verification", "Default checklist", "Definition of Done", "Release readiness"
    ]);
    expect(dwh.dimensions.headers.rows().map((row) => row.name).sort()).toEqual([
      "(none)", "Code", "Release", "Verification phase 1", "Verification phase 2"
    ]);
    expect(dwh.dimensions.item_statuses.rows().map((row) => row.completion + " / " + row.name).sort()).toEqual([
      "Completed / Done", "Completed / Skipped", "Not completed / Blocked", "Not completed / In progress",
      "Not completed / Open"
    ]);
  });

  test("has the items of several issue types and projects in the last 12 months", () => {
    var lastYear = "[Time].[Last 12 months]";
    expect(membersWith("[Issue Type].[Issue Type].Members", "HC Checklist items", lastYear).sort()).
      toEqual(["Bug", "Epic", "Story", "Task"]);
    expect(membersWith("[Issue Type].[Issue Type].Members", "HC Checklist items completed", lastYear).sort()).
      toEqual(["Bug", "Epic", "Story", "Task"]);
    expect(membersWith("[Issue Type].[Issue Type].Members", "HC Checklist items not completed", lastYear).sort()).
      toEqual(["Bug", "Epic", "Story", "Task"]);
    expect(membersWith("[Project].[Project].Members", "HC Checklist items", lastYear).sort()).
      toEqual(["Mobile App", "Web Platform"]);
  });

  test("has the checklists of every month of the last 12 months", () => {
    var months = membersWith("LastPeriods(12, [Time].[Month].CurrentDateMember)", "HC Issues with checklists");
    expect(months.length).toBe(12);
  });

  test("has completed and reopened items dated by their changes", () => {
    var totals = olap.results(`
      SELECT {[Measures].[HC Checklist items], [Measures].[HC Checklist items completed],
              [Measures].[HC Checklist items reopened]} ON COLUMNS,
             {[Time].[Last 12 months]} ON ROWS
      FROM [Issues]`)[0];
    expect(totals[1]).toBeGreaterThan(1000);
    expect(totals[2]).toBeGreaterThan(totals[1] * 0.4);
    expect(totals[3]).toBeGreaterThan(50);
  });
});
