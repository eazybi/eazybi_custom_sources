describe("app.defineSchema", () => {
  test("defines the GitHub cube", () => {
    expect(schema.cubes()).toEqual(["GitHub"]);
  });

  test("defines the pull request dimensions", () => {
    var dimensions = schema.dimensions();

    expect(dimensions).toContain("Repository");
    expect(dimensions).toContain("Pull Request");
    expect(dimensions).toContain("Pull Request State");
    expect(dimensions).toContain("Merge State");
    expect(dimensions).toContain("Review State");
    expect(dimensions).toContain("Label");
    expect(dimensions).toContain("Milestone");
    expect(dimensions).toContain("Time");
  });

  test("defines an account dimension per role of a GitHub account", () => {
    var dimensions = schema.dimensions();

    expect(dimensions).toContain("Pull Request Author");
    expect(dimensions).toContain("Pull Request Assignee");
    expect(dimensions).toContain("Pull Request Reviewer");
    expect(dimensions).toContain("Comment Author");
    expect(dimensions).toContain("Commit Author");
    expect(dimensions).toContain("Transition Author");
  });

  test("groups the repositories of the Repository dimension by their owner", () => {
    expect(schema.dimension("Repository").levels()).toEqual(["Owner", "Repository"]);
  });

  test("gives the Pull Request dimension an owner hierarchy", () => {
    expect(schema.dimension("Pull Request").hierarchies()).toEqual(["Pull Request", "Owner"]);
    expect(schema.dimension("Pull Request").hierarchy("Owner").levels()).
      toEqual(["Owner", "Repository", "Pull Request"]);
    expect(schema.dimension("Pull Request").level("Pull Request").properties()).toContain("Created at");
    expect(schema.dimension("Pull Request").level("Pull Request").properties()).toContain("Merge state");
  });

  test("gives every Pull Request property a property measure", () => {
    var calculatedMembers = schema.calculatedMembers();
    // DISPLAY_KEY, PARENT_KEY and URL_ID are the member key, its parent and its link, and the two ids are
    // read only by other formulas — none of the five is a value to show as a measure.
    var TECHNICAL_PROPERTIES = ["DISPLAY_KEY", "PARENT_KEY", "URL_ID",
      "GitHub pull request ID", "Repository owner ID"];
    var properties = schema.dimension("Pull Request").level("Pull Request").properties().
      filter((name) => !TECHNICAL_PROPERTIES.includes(name));

    expect(properties).toContain("Created at");
    expect(properties).toContain("Merge state");
    // The measure names read as a sentence about the pull request and are therefore not the property
    // names — "Created at" is the "Pull request created date" measure.
    var PROPERTY_MEASURES = {
      "Created at": "Pull request created date",
      "Closed at": "Pull request closed date",
      "Branch Name": "Pull request branch",
      "State": "Pull request state",
      "Draft": "Pull request draft",
      "Milestone": "Pull request milestone",
      "Merge state": "Pull request merge state"
    };
    properties.forEach((name) => {
      expect(PROPERTY_MEASURES).toHaveProperty(name);
      expect(calculatedMembers).toContain(`[Measures].[${PROPERTY_MEASURES[name]}]`);
    });
  });

  test("gives every account dimension a hierarchy of the GitHub account types", () => {
    ["Pull Request Author", "Pull Request Assignee", "Pull Request Reviewer", "Comment Author"].
      forEach((dimensionName) => {
        expect(schema.dimension(dimensionName).hierarchies()).toEqual([dimensionName, "By type"]);
        expect(schema.dimension(dimensionName).hierarchy("By type").levels()).toEqual(["Type", "Account"]);
      });
  });

  test("defines the measures of the four measure groups", () => {
    var measures = schema.measures();

    expect(measures).toContain("Pull requests created");
    expect(measures).toContain("Pull requests closed");
    expect(measures).toContain("Comments submitted");
    expect(measures).toContain("Reviews submitted");
    expect(measures).toContain("Reviewed pull requests count");
    expect(measures).toContain("Commits submitted");
    expect(measures).toContain("Transitions to state");
  });

  test("defines the calculated members of the cube", () => {
    var calculatedMembers = schema.calculatedMembers();

    expect(calculatedMembers).toContain("[Measures].[Open pull requests]");
    expect(calculatedMembers).toContain("[Measures].[Merged pull requests]");
    expect(calculatedMembers).toContain("[Measures].[Average closing days]");
    expect(calculatedMembers).toContain("[Measures].[Merge rate]");
    expect(calculatedMembers).toContain("[Measures].[Open pull request age days]");
    expect(calculatedMembers).toContain("[Measures].[Comments per review]");
    expect(calculatedMembers).toContain("[Measures].[Pull requests history]");
  });

  describe("aggregating the imported rows", () => {
    beforeAll(() => {
      mock.sourceSelection(["101"]);
      mock.extraOptions({import_commits: true, import_changes: true});
      mock.get("/user/repos", {fixture: "repositories"});
      mock.graphql({query: "PullRequests", fixture: "pull_requests"});

      importRun.run();
    });

    test("loads the OLAP schema of the type", () => {
      expect(olap.cubes()).toEqual(["GitHub"]);
    });

    test("aggregates the pull request measures by repository", () => {
      expect(olap.results(`
        SELECT [Repository].[Repository].Members ON ROWS,
               {[Measures].[Pull requests created], [Measures].[Pull requests closed],
                [Measures].[Merged pull requests], [Measures].[Changes]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["app", 2, 1, 1, 172]]);
    });

    // Two named reviewers and not every member of the level: the test runner caches btIdFor results
    // across the tests of a run while clearing the stored rows before each test, so the bridge row of an
    // *empty* set is written only once per run and (no reviewer) becomes unreachable in a later
    // olap.results query. Real imports build a new runtime per import and are not affected.
    test("aggregates the pull requests of every reviewer through the bridge table", () => {
      expect(olap.results(`
        SELECT {[Pull Request Reviewer].[Sam Roe], [Pull Request Reviewer].[Platform]} ON ROWS,
               {[Measures].[Pull requests created]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["Sam Roe", 1], ["Platform", 1]]);
    });

    test("measures the share of the closed pull requests that were merged", () => {
      expect(olap.results(`
        SELECT [Repository].[Repository].Members ON ROWS,
               {[Measures].[Merge rate]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["app", 1]]);
    });

    // The age reads the Created at property of the pull request and is therefore measured only at the
    // Pull Request level, like the other Pull Request property members.
    test("measures the age in days of the open pull requests", () => {
      var ages = olap.results(`
        SELECT Filter([Pull Request].[Pull Request].Members,
                      [Measures].[Open pull request age days] > 0) ON ROWS,
               {[Measures].[Open pull request age days]} ON COLUMNS
        FROM [GitHub]
      `);

      expect(ages).toHaveLength(1);
      // The one open pull request of the fixtures was created 2026-01-08, so its age grows every day.
      expect(ages[0][1]).toBeGreaterThan(200);
    });

    // The reply of the fixture carries no verdict and is counted under (no state), next to the
    // conversation comment.
    test("counts every submitted review and the comments it carries", () => {
      expect(olap.results(`
        SELECT ORDER([Review State].[Review State].Members,
                     [Review State].CurrentMember.Name, BASC) ON ROWS,
               {[Measures].[Reviews submitted], [Measures].[Comments submitted]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["(no state)", null, 2], ["Approved", 2, 3]]);
    });

    // Comments per review divides the three comments the two fixture reviews carry, not the
    // conversation comment.
    test("counts the pull requests that were reviewed and the comments per review", () => {
      expect(olap.results(`
        SELECT [Repository].[Repository].Members ON ROWS,
               {[Measures].[Reviewed pull requests count], [Measures].[Comments per review]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["app", 1, 1.5]]);
    });

    // kim only replied to the review sam wrote on kim's own pull request.
    test("leaves the author of a reply out of the accounts that reviewed a pull request", () => {
      expect(olap.results(`
        SELECT ORDER([Comment Author].[Account].Members,
                     [Comment Author].CurrentMember.Name, BASC) ON ROWS,
               {[Measures].[Reviewed pull requests count]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["Kim Lee", null], ["Sam Roe", 1]]);
    });

    test("counts the pull requests that were open at the end of every month", () => {
      expect(olap.results(`
        SELECT {[Time].[2026].[Q1 2026].[Jan 2026], [Time].[2026].[Q1 2026].[Feb 2026]} ON ROWS,
               {[Measures].[Open pull requests]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["Jan 2026", 1], ["Feb 2026", 1]]);
    });

    // The formula picks its branch from the level of the current Pull Request member, and the dimension
    // has two hierarchies whose leaf level is named Pull Request, so both have to answer the same — the
    // closed pull request empty and not a zero row.
    test("counts the open pull requests the same in both Pull Request hierarchies", () => {
      var expected = [["#12 Add the import log", null], ["#13 Fix the pagination", 1]];

      expect(olap.results(`
        SELECT [Pull Request].[Pull Request].Members ON ROWS,
               {[Measures].[Open pull requests]} ON COLUMNS
        FROM [GitHub]
        WHERE [Time].[2026].[Q1 2026].[Jan 2026]
      `)).toEqual(expected);
      expect(olap.results(`
        SELECT [Pull Request.Owner].[Pull Request].Members ON ROWS,
               {[Measures].[Open pull requests]} ON COLUMNS
        FROM [GitHub]
        WHERE [Time].[2026].[Q1 2026].[Jan 2026]
      `)).toEqual(expected);
    });

    test("reads the pull request properties in both Pull Request hierarchies", () => {
      var columns = `{[Measures].[Pull request state],
                      [Measures].[Pull request draft], [Measures].[Pull request branch],
                      [Measures].[Pull request milestone], [Measures].[Pull request merge state]}`;
      var expected = [
        ["#12 Add the import log", "Merged", "No", "feature/import-log", "1.2", "Mergeable"],
        ["#13 Fix the pagination", "Open", "No", "bugfix/pagination", null, "Conflicting"]
      ];

      expect(olap.results(`
        SELECT [Pull Request].[Pull Request].Members ON ROWS, ${columns} ON COLUMNS
        FROM [GitHub]
      `)).toEqual(expected);
      expect(olap.results(`
        SELECT [Pull Request.Owner].[Pull Request].Members ON ROWS, ${columns} ON COLUMNS
        FROM [GitHub]
      `)).toEqual(expected);
    });

    test("aggregates the comments of every review state", () => {
      expect(olap.results(`
        SELECT ORDER([Review State].[Review State].Members,
                     [Review State].CurrentMember.Name, BASC) ON ROWS,
               {[Measures].[Comments submitted]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["(no state)", 2], ["Approved", 3]]);
    });
  });

  describe("with the same pull request number in two repositories", () => {
    var COLUMNS = `{[Measures].[Pull request state],
                    [Measures].[Pull request draft], [Measures].[Pull request branch]}`;
    var EXPECTED = [
      ["#12 Add the import log", "Merged", "No", "feature/import-log"],
      ["#13 Fix the pagination", "Open", "No", "bugfix/pagination"],
      ["#12 Retry the failed uploads", "Open", "Yes", "feature/retry-uploads"]
    ];

    beforeAll(() => {
      mock.sourceSelection(["101", "102"]);
      mock.extraOptions({import_commits: true, import_changes: true});
      mock.get("/user/repos", {fixture: "repositories"});
      mock.graphql({query: "PullRequests", variables: {name: "app"}, fixture: "pull_requests"});
      mock.graphql({query: "PullRequests", variables: {name: "tools"},
        fixture: "pull_requests_other_repository"});

      importRun.run();
    });

    test("reads the properties of its own pull request in the default hierarchy", () => {
      expect(olap.results(`
        SELECT [Pull Request].[Pull Request].Members ON ROWS, ${COLUMNS} ON COLUMNS
        FROM [GitHub]
      `)).toEqual(EXPECTED);
    });

    test("reads the properties of its own pull request in the Owner hierarchy", () => {
      expect(olap.results(`
        SELECT [Pull Request.Owner].[Pull Request].Members ON ROWS, ${COLUMNS} ON COLUMNS
        FROM [GitHub]
      `)).toEqual(EXPECTED);
    });
  });

  describe("with one login held by two accounts", () => {
    beforeAll(() => {
      var document = JSON.parse(JSON.stringify(mock.fixture("pull_requests")));
      // The account that wrote #13 released the login, and the account that wrote #12 registered it next.
      document.data.repository.pullRequests.nodes.find((node) => node.number === 13).author =
        {__typename: "User", login: "kim", databaseId: 4700, name: "Sam Roe", email: "sam@example.com"};

      mock.sourceSelection(["101"]);
      mock.get("/user/repos", {fixture: "repositories"});
      mock.graphql({query: "PullRequests", json: document});

      importRun.run();
    });

    test("counts the pull requests of each of them as their own", () => {
      expect(olap.results(`
        SELECT ORDER([Pull Request Author].[Account].Members,
                     [Pull Request Author].CurrentMember.Name, BASC) ON ROWS,
               {[Measures].[Pull requests created]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["Kim Lee", 1], ["Sam Roe", 1]]);
    });

    test("counts them apart in the By type hierarchy as well", () => {
      expect(olap.results(`
        SELECT ORDER([Pull Request Author.By type].[Account].Members,
                     [Pull Request Author.By type].CurrentMember.Name, BASC) ON ROWS,
               {[Measures].[Pull requests created]} ON COLUMNS
        FROM [GitHub]
      `)).toEqual([["Kim Lee", 1], ["Sam Roe", 1]]);
    });
  });
});
