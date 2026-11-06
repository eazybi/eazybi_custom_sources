describe("app.api", () => {
  describe("buildJql", () => {
    test("reads only the issues with a checklist in a full import", () => {
      expect(app.api.buildJql(["customfield_10100"], ["A", "B"], null)).
        toBe('project in ("A", "B") AND cf[10100] is not EMPTY ORDER BY id ASC');
    });

    test("reads the issues with any of several Checklist Text fields", () => {
      expect(app.api.buildJql(["customfield_10100", "customfield_10200"], [], null)).
        toBe("(cf[10100] is not EMPTY OR cf[10200] is not EMPTY) ORDER BY id ASC");
    });

    test("reads the updated issues in an incremental import", () => {
      expect(app.api.buildJql(["customfield_10100"], [], "2026-01-01 10:00")).
        toBe('updated >= "2026-01-01 10:00" ORDER BY id ASC');
    });
  });

  describe("getCompletedStatusOptions", () => {
    test("lists the default statuses and the statuses used in the recently updated checklists", () => {
      mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Cloud"}});
      mock.get("/rest/api/2/field", {fixture: "fields"});
      mock.post("/rest/api/2/search/jql", {json: {isLast: true, issues: [
        {id: "1", key: "DEV-1", fields: {customfield_10100: "# A\n* [Verified] One\n* [x] Two\n* [] Three\n- [Blocked] Four"}},
        {id: "2", key: "DEV-2", fields: {customfield_10100: "* [verified] Five\n* [done] Six\n>> [Note] text"}},
        {id: "3", key: "DEV-3", fields: {customfield_10100: null}}
      ]}});

      var result = app.api.getCompletedStatusOptions(["DEV", "(all)"]);

      expect(result.options).toEqual([
        {value: "open", label: "Open"}, {value: "in progress", label: "In progress"},
        {value: "done", label: "Done"}, {value: "skipped", label: "Skipped"},
        {value: "verified", label: "Verified"}, {value: "blocked", label: "Blocked"}
      ]);
      expect(result.default).toEqual(["done", "skipped"]);
      var search = JSON.parse(_.find(mock.requests(), (request) => request.method === "post").body);
      expect(search.jql).toBe('project in ("DEV") AND cf[10100] is not EMPTY ORDER BY updated DESC');
    });

    test("reads at most five search pages", () => {
      mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Cloud"}});
      mock.get("/rest/api/2/field", {fixture: "fields"});
      mock.post("/rest/api/2/search/jql", {json: {isLast: false, nextPageToken: "next", issues: []}});

      app.api.getCompletedStatusOptions([]);

      expect(mock.requests().filter((request) => request.method === "post").length).toBe(5);
    });

    test("lists the default statuses without the Checklist Text field", () => {
      mock.get("/rest/api/2/field", {json: []});

      expect(app.api.getCompletedStatusOptions([]).options.map((option) => option.value)).
        toEqual(["open", "in progress", "done", "skipped"]);
    });
  });

  test("getChecklistFieldIds finds the Checklist Text fields by name", () => {
    mock.get("/rest/api/2/field", {fixture: "fields"});

    expect(app.api.getChecklistFieldIds()).toEqual(["customfield_10100"]);
  });

  test("searchIssues follows the next page token in Jira Cloud", () => {
    mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Cloud"}});
    mock.post("/rest/api/2/search/jql", {responses: [
      {json: {issues: [{id: "1", key: "A-1"}], isLast: false, nextPageToken: "page2"}},
      {json: {issues: [{id: "2", key: "A-2"}], isLast: true}}
    ]});
    var keys = [];

    app.api.searchIssues("project = A", ["customfield_10100"], (issues) => {
      keys = keys.concat(issues.map((issue) => issue.key));
    });

    expect(keys).toEqual(["A-1", "A-2"]);
    var bodies = mock.requests().filter((request) => request.method === "post").
      map((request) => JSON.parse(request.body));
    expect(bodies[0]).toEqual({jql: "project = A", fields: ["created", "customfield_10100"], maxResults: 100});
    expect(bodies[1].nextPageToken).toBe("page2");
  });

  describe("getChangelogHistories", () => {
    test("returns the histories of a complete changelog of the search", () => {
      var issue = {id: "1", changelog: {startAt: 0, total: 1, histories: [{id: "5"}]}};

      expect(app.api.getChangelogHistories(issue)).toEqual([{id: "5"}]);
      expect(app.api.getChangelogHistories({id: "2"})).toEqual([]);
      expect(mock.requests()).toEqual([]);
    });

    test("reads all pages of a long changelog in Jira Cloud", () => {
      mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Cloud"}});
      mock.get("/rest/api/2/issue/1/changelog", {json: {startAt: 0, total: 3, isLast: false, values: [{id: "5"}, {id: "6"}]},
        params: {startAt: 0}});
      mock.get("/rest/api/2/issue/1/changelog", {json: {startAt: 2, total: 3, isLast: true, values: [{id: "7"}]},
        params: {startAt: 2}});
      var issue = {id: "1", changelog: {startAt: 0, maxResults: 1, total: 3, histories: [{id: "7"}]}};

      expect(app.api.getChangelogHistories(issue).map((h) => h.id)).toEqual(["5", "6", "7"]);
      expect(_.last(mock.requests()).params).toEqual({startAt: "2", maxResults: "100"});
    });

    test("reads the issue with its changelog in Jira Data Center", () => {
      mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Server"}});
      mock.get("/rest/api/2/issue/1", {json: {id: "1", changelog: {total: 2, histories: [{id: "5"}, {id: "6"}]}}});
      var issue = {id: "1", changelog: {total: 2, histories: [{id: "6"}]}};

      expect(app.api.getChangelogHistories(issue).map((h) => h.id)).toEqual(["5", "6"]);
      expect(_.last(mock.requests()).params).toEqual({expand: "changelog", fields: "created"});
    });
  });

  test("searchIssues requests the changelog", () => {
    mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Server"}});
    mock.post("/rest/api/2/search", {json: {issues: [], startAt: 0, total: 0}});

    app.api.searchIssues("project = A", [], () => {}, {changelog: true});

    expect(JSON.parse(_.last(mock.requests()).body).expand).toEqual(["changelog"]);
  });

  test("searchIssues pages by startAt in Jira Data Center", () => {
    mock.get("/rest/api/2/serverInfo", {json: {deploymentType: "Server"}});
    mock.post("/rest/api/2/search", {responses: [
      {json: {issues: [{id: "1", key: "A-1"}], startAt: 0, total: 2}},
      {json: {issues: [{id: "2", key: "A-2"}], startAt: 1, total: 2}}
    ]});
    var keys = [];

    app.api.searchIssues("project = A", ["customfield_10100"], (issues) => {
      keys = keys.concat(issues.map((issue) => issue.key));
    });

    expect(keys).toEqual(["A-1", "A-2"]);
    var bodies = mock.requests().filter((request) => request.method === "post").
      map((request) => JSON.parse(request.body));
    expect(bodies.map((body) => body.startAt)).toEqual([0, 1]);
  });
});
