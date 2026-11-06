// The full Jira import of a simulated Jira instance with the addon: the issue importer imports the issue properties
// together with the Jira issues, and app.importer.importAll imports the checklist item rows after them.
describe("the Jira import with the addon", () => {
  beforeAll(() => {
    mock.jira.project({key: "DEV", name: "Development"});
    mock.jira.user("Alex Morgan");
    mock.jira.issues([
      {
        key: "DEV-1", type: "Story", status: "Done", assignee: "Alex Morgan", created: "2026-01-05T10:00:00Z",
        fields: {checklist_text: "# Definition of done\n--- Code\n* [done] Code reviewed\n* [x] Tests written\n" +
          "* [open] Docs updated"},
        changelog: [
          {created: "2026-01-06T10:00:00Z", items: [{field: "checklist_text",
            from: "# Definition of done\n--- Code\n* [open] Code reviewed\n* [] Tests written\n* [open] Docs updated",
            to: "# Definition of done\n--- Code\n* [done] Code reviewed\n* [] Tests written\n* [open] Docs updated"}]},
          {created: "2026-01-07T10:00:00Z", items: [{field: "status", from: "To Do", to: "In Progress"}]},
          {created: "2026-01-08T10:00:00Z", items: [{field: "checklist_text",
            from: "# Definition of done\n--- Code\n* [done] Code reviewed\n* [] Tests written\n* [open] Docs updated",
            to: "# Definition of done\n--- Code\n* [done] Code reviewed\n* [x] Tests written\n* [open] Docs updated"}]},
          {created: "2026-01-09T10:00:00Z", items: [{field: "status", from: "In Progress", to: "Done"}]}
        ]
      },
      {
        key: "DEV-2", type: "Bug", status: "In Progress", created: "2026-01-07T10:00:00Z",
        fields: {checklist_text: "# Bug verification\n* [x] Reproduced\n* [] Fixed"},
        changelog: [
          {created: "2026-01-08T10:00:00Z", items: [{field: "checklist_text",
            from: "# Bug verification\n* [] Reproduced\n* [] Fixed",
            to: "# Bug verification\n* [x] Reproduced\n* [x] Fixed"}]},
          {created: "2026-01-12T10:00:00Z", items: [{field: "status", from: "To Do", to: "In Progress"},
            {field: "checklist_text", from: "# Bug verification\n* [x] Reproduced\n* [x] Fixed",
              to: "# Bug verification\n* [x] Reproduced\n* [] Fixed"}]}
        ]
      },
      {key: "DEV-3", type: "Task", status: "To Do", created: "2026-01-08T10:00:00Z"}
    ]);

    importRun.runJira();
  });

  function issueRows() {
    return _.sortBy(dwh.jira.issues.rows({
      columns: ["issue_key", "hcchk_items_total", "hcchk_items_completed", "hcchk_items_progress"]
    }).filter((row) => row.issue_key), "issue_key");
  }

  function itemRows() {
    var items = _.indexBy(dwh.dimensions.items.rows(), "id");
    return _.sortBy(dwh.measures.checklist_items.rows({
      columns: ["issue_id", "item_id", "time_id", "items_count", "items_completed", "items_reopened"]
    }).map((row) => _.extend(row, {item: items[row.item_id].name})), (row) => row.issue_id + "/" + row.item);
  }

  test("imports the checklist issue properties with the Jira issues", () => {
    var rows = issueRows();

    expect(rows.map((row) => [row.issue_key, row.hcchk_items_total, row.hcchk_items_completed])).toEqual([
      ["DEV-1", 3, 2], ["DEV-2", 2, 1], ["DEV-3", null, null]
    ]);
    expect(rows[0].hcchk_items_progress).toBeCloseTo(0.6667, 4);
    expect(rows[1].hcchk_items_progress).toBeCloseTo(0.5, 4);
    expect(importRun.warnings()).toEqual([]);
    expect(importRun.objectFailures()).toEqual([]);
  });

  test("imports the checklist item rows of the imported issues", () => {
    var rows = itemRows();
    var dev1 = mock.jira.issueId("DEV-1"), dev2 = mock.jira.issueId("DEV-2");
    var created = (row) => row.items_count === 1;

    expect(rows.filter(created).map((row) => [row.issue_id, row.item, row.time_id])).toEqual([
      [dev1, "Code reviewed", dwh.lookupDateId("2026-01-05")],
      [dev1, "Docs updated", dwh.lookupDateId("2026-01-05")],
      [dev1, "Tests written", dwh.lookupDateId("2026-01-05")],
      [dev2, "Fixed", dwh.lookupDateId("2026-01-07")],
      [dev2, "Reproduced", dwh.lookupDateId("2026-01-07")]
    ]);
  });

  test("dates the completed and the reopened items by the Checklist Text changes of the changelog", () => {
    var rows = itemRows();
    var dev1 = mock.jira.issueId("DEV-1"), dev2 = mock.jira.issueId("DEV-2");

    expect(rows.filter((row) => row.items_completed === 1).map((row) => [row.issue_id, row.item, row.time_id])).
      toEqual([
        [dev1, "Code reviewed", dwh.lookupDateId("2026-01-06")],
        [dev1, "Tests written", dwh.lookupDateId("2026-01-08")],
        [dev2, "Reproduced", dwh.lookupDateId("2026-01-08")]
      ]);
    expect(rows.filter((row) => row.items_reopened === 1).map((row) => [row.issue_id, row.item, row.time_id])).
      toEqual([[dev2, "Fixed", dwh.lookupDateId("2026-01-12")]]);
  });

  test("aggregates the checklist items by the Jira issue type in the Issues cube", () => {
    var results = olap.results(`
      SELECT NON EMPTY [Issue Type].[Issue Type].Members ON ROWS,
             {[Measures].[HC Checklist items], [Measures].[HC Checklist items completed],
              [Measures].[HC Checklist items not completed], [Measures].[HC Checklist items reopened],
              [Measures].[HC Checklists], [Measures].[HC Issues with checklists]} ON COLUMNS
      FROM [Issues]
    `);

    expect(_.sortBy(results, (row) => row[0])).toEqual([
      ["Bug", 2, 1, 1, 1, 1, 1],
      ["Story", 3, 2, 1, null, 1, 1]
    ]);
  });
});
