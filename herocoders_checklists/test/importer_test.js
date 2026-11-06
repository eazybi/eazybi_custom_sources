describe("app.importer.importAll", () => {
  var ISSUE_IDS = {"DEV-1": 501, "DEV-2": 502};

  function mockJira() {
    mock.sourceSelection(["DEV", "OTHER"]);
    mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Cloud"}});
    mock.get("/rest/api/2/field", {fixture: "fields"});
    mock.post("/rest/api/2/search/jql", {fixture: "search_issues"});
    // OTHER-1 is not imported by the Jira import.
    mock.spyOn(dwh.jira, "lookupIssueId").mockImplementation((key) => ISSUE_IDS[key] || null);
  }

  function itemRows() {
    return _.sortBy(dwh.measures.checklist_items.rows({
      columns: ["_source_id", "issue_id", "time_id", "checklist_ref", "items_count", "items_completed",
        "items_not_completed", "items_reopened", "checklist_id", "item_id", "item_status_id", "header_id"],
      orderBy: ["_source_id", "checklist_ref"]
    }), (row) => row._source_id + "/" + row.checklist_ref + "/" + row.item_id);
  }

  // The time_id of the Time dimension member of a date, as the importer looks it up.
  function timeIds(dates) {
    return dates.map((date) => dwh.lookupDateId(date));
  }

  function memberNames(tableName, column) {
    return dwh.dimensions[tableName].rows().map((row) => row[column || "name"]).sort();
  }

  describe("a full import", () => {
    beforeAll(() => {
      mockJira();
      importRun.run();
    });

    test("searches the issues with a checklist of the selected projects with their changelog", () => {
      var search = JSON.parse(_.find(mock.requests(), (request) => request.method === "post").body);

      expect(search.jql).toBe('project in ("DEV", "OTHER") AND cf[10100] is not EMPTY ORDER BY id ASC');
      expect(search.expand).toBe("changelog");
    });

    test("imports a row per checklist item of the imported issues, dated by the issue created date", () => {
      var rows = itemRows().filter((row) => row.items_count === 1);

      expect(rows.length).toBe(6);
      expect(rows.map((row) => row.issue_id)).toEqual([501, 501, 501, 502, 502, 502]);
      expect(rows.map((row) => row.time_id)).toEqual(timeIds(["2026-01-05", "2026-01-05", "2026-01-05",
        "2026-01-06", "2026-01-06", "2026-01-06"]));
      expect(_.uniq(rows.map((row) => row.checklist_ref))).toEqual([10001001, 10001002, 10002001]);
      // A completed item has no value, not 0, like the not completed items in HC Checklist items completed.
      expect(_.countBy(rows, (row) => String(row.items_not_completed))).toEqual({1: 3, null: 3});
      expect(rows.map((row) => row.items_completed || 0)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    test("imports a completion row per completed item, dated by its last completion", () => {
      var items = _.indexBy(dwh.dimensions.items.rows(), "id");
      var rows = itemRows().filter((row) => row.items_completed === 1);

      expect(rows.map((row) => [row._source_id, items[row.item_id].name, row.time_id])).toEqual([
        ["10001", "Code reviewed", dwh.lookupDateId("2026-01-12")],
        ["10001", "Release notes", dwh.lookupDateId("2026-01-05")],
        ["10002", "Docs updated", dwh.lookupDateId("2026-01-06")]
      ]);
      expect(rows.map((row) => (row.items_count || 0) + (row.items_not_completed || 0))).toEqual([0, 0, 0]);
    });

    test("imports a reopening row per reopened item, dated by its last reopening", () => {
      var items = _.indexBy(dwh.dimensions.items.rows(), "id");
      var rows = itemRows().filter((row) => row.items_reopened === 1);

      expect(rows.map((row) => [row._source_id, items[row.item_id].name, row.time_id])).toEqual([
        ["10001", "Code reviewed", dwh.lookupDateId("2026-01-09")]
      ]);
      expect((rows[0].items_count || 0) + (rows[0].items_completed || 0) + (rows[0].items_not_completed || 0)).toBe(0);
    });

    test("imports the checklists and the items by their names", () => {
      expect(memberNames("checklists")).toEqual(["Definition of done", "Release"]);
      expect(memberNames("items")).toEqual(["Code reviewed", "Docs updated", "Release notes", "Tests written"]);
    });

    test("imports the headers of the items", () => {
      var headers = _.indexBy(dwh.dimensions.headers.rows(), "id");
      var items = _.indexBy(dwh.dimensions.items.rows(), "id");
      var rows = itemRows().filter((row) => row.items_count === 1);

      expect(memberNames("headers")).toEqual(["(none)", "Code", "Review"]);
      expect(rows.map((row) => row._source_id + " " + items[row.item_id].name + ": " + headers[row.header_id].name).sort()).
        toEqual([
          "10001 Code reviewed: Code", "10001 Release notes: (none)", "10001 Tests written: Code",
          "10002 Code reviewed: Review", "10002 Docs updated: Review", "10002 Tests written: Review"
        ]);
    });

    test("imports the item statuses under their completion", () => {
      var statuses = dwh.dimensions.item_statuses.rows().map((row) => row.completion + " / " + row.name).sort();

      expect(statuses).toEqual(["Completed / Done", "Completed / Skipped", "Not completed / In progress",
        "Not completed / Open"]);
    });

    test("stores the date of the next incremental import", () => {
      expect(importRun.maxParams().updated_since).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(importRun.objectFailures()).toEqual([]);
    });
  });

  describe("an incremental import", () => {
    test("reads the updated issues and deletes the rows of a removed checklist", () => {
      mockJira();
      importRun.run();
      mock.maxParams({updated_since: "2026-01-10 08:00"});
      mock.post("/rest/api/2/search/jql", {json: {isLast: true, issues: [
        {id: "10001", key: "DEV-1", fields: {created: "2026-01-05T10:00:00.000+0000", customfield_10100: null}}
      ]}});

      importRun.run();

      var searches = mock.requests().filter((request) => request.method === "post");
      expect(JSON.parse(searches[searches.length - 1].body).jql).
        toBe('project in ("DEV", "OTHER") AND updated >= "2026-01-10 08:00" ORDER BY id ASC');
      expect(_.uniq(itemRows().map((row) => row._source_id))).toEqual(["10002"]);
    });
  });

  describe("with several Checklist Text fields", () => {
    test("dates the items by the changes of the imported field only", () => {
      mockJira();
      mock.get("/rest/api/2/field", {json: [
        {id: "customfield_10100", name: "Checklist Text", custom: true},
        {id: "customfield_10200", name: "Checklist Text", custom: true}
      ]});
      mock.post("/rest/api/2/search/jql", {json: {isLast: true, issues: [{
        id: "10001", key: "DEV-1",
        fields: {created: "2026-01-05T10:00:00.000+0000", customfield_10100: "* [done] One", customfield_10200: "* [open] One"},
        changelog: {startAt: 0, total: 2, histories: [
          {id: "1", created: "2026-01-08T12:00:00.000+0000",
            items: [{fieldId: "customfield_10100", fromString: "* [open] One", toString: "* [done] One"}]},
          {id: "2", created: "2026-01-09T12:00:00.000+0000",
            items: [{fieldId: "customfield_10200", fromString: "* [done] One", toString: "* [open] One"}]}
        ]}
      }]}});

      importRun.run();

      var rows = itemRows();
      expect(rows.filter((row) => row.items_completed === 1).map((row) => row.time_id)).toEqual(timeIds(["2026-01-08"]));
      expect(rows.filter((row) => row.items_reopened === 1)).toEqual([]);
    });
  });

  describe("with Done not counted as completed", () => {
    test("imports a checked item and a Done item as two statuses of their completion", () => {
      mockJira();
      mock.extraOptions({completed_statuses: ["skipped"]});
      mock.post("/rest/api/2/search/jql", {json: {isLast: true, issues: [{
        id: "10001", key: "DEV-1",
        fields: {created: "2026-01-05T10:00:00.000+0000", customfield_10100: "* [x] One\n* [done] Two"}
      }]}});

      importRun.run();

      var statuses = _.indexBy(dwh.dimensions.item_statuses.rows(), "id");
      var items = _.indexBy(dwh.dimensions.items.rows(), "id");
      expect(itemRows().filter((row) => row.items_count === 1).map((row) =>
        items[row.item_id].name + ": " + statuses[row.item_status_id].completion + " / " +
          statuses[row.item_status_id].name)).
        toEqual(["One: Completed / Done", "Two: Not completed / Done"]);
    });
  });

  describe("without the Checklist Text field", () => {
    test("warns and imports nothing", () => {
      mock.get("/rest/api/2/field", {json: []});

      importRun.run();

      expect(importRun.warnings()[0].message).toContain("Checklist Text");
      expect(dwh.measures.checklist_items.rows()).toEqual([]);
    });
  });

  describe("a failed issue", () => {
    test("is reported and keeps the incremental mark back", () => {
      mockJira();
      mock.spyOn(app.importers.checklistItems, "buildRows").mockImplementation((issue) => {
        if (issue.key === "DEV-2") throw new Error("broken");
        return [];
      });

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["DEV-2"]);
      expect(importRun.maxParams().updated_since).toBeUndefined();
    });

    test("is reported when it has more rows than one import call takes", () => {
      mockJira();
      var rowsOf = (issue) => _.range(issue.key === "DEV-1" ? 10001 : 2).map((index) => ({
        _source_id: String(issue.id), _source_name: "checklist item", issue_id: 501, items_count: 1,
        checklist_ref: index
      }));
      mock.spyOn(app.importers.checklistItems, "buildRows").mockImplementation(rowsOf);

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["DEV-1"]);
      expect(_.uniq(dwh.measures.checklist_items.rows().map((row) => row._source_id))).toEqual(["10002"]);
    });
  });
});
