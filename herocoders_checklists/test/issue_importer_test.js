describe("app.issueImporter.importIssues", () => {
  test("returns the item totals, the progress and the Markdown of the checklists", () => {
    var results = app.issueImporter.importIssues([
      {id: "10001", key: "DEV-1", fields: {checklist_text: "# Done\n* [x] One\n* [in progress] Two\n* [skipped] Three\n* [] Four"}}
    ]);

    expect(results).toEqual([{
      issueId: "10001",
      properties: {
        items_total: 4,
        items_completed: 2,
        items_progress: 0.5,
        items_markdown: "**Done** (2/4)\n- ✅ One\n- ⬜ Two *(In progress)*\n- ✅ Three *(Skipped)*\n- ⬜ Four"
      },
      measures: []
    }]);
  });

  test("clears the properties of an issue without a checklist", () => {
    var results = app.issueImporter.importIssues([
      {id: "10002", key: "DEV-2", fields: {checklist_text: null}},
      {id: "10003", key: "DEV-3", fields: {checklist_text: "# Default checklist\n"}}
    ]);

    expect(results.map((result) => result.properties)).toEqual([{}, {}]);
  });

  test("uses the statuses counted as completed of the import option", () => {
    mock.extraOptions({completed_statuses: ["done", "verified"]});

    var results = app.issueImporter.importIssues([
      {id: "10001", key: "DEV-1", fields: {checklist_text: "* [verified] One\n* [skipped] Two"}}
    ]);

    expect(results[0].properties.items_completed).toBe(1);
  });
});
