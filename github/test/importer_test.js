describe("app.importer.importAll", () => {
  // The mocked GitHub of an import of the selected acme/app repository.
  function mockSelectedRepository() {
    mock.sourceParams({api_token: "secret-token"});
    mock.sourceSelection(["101"]);
    mock.get("/user/repos", {fixture: "repositories"});
    mock.graphql({query: "PullRequests", fixture: "pull_requests"});
    // Every import asks for the pull request counts of the repositories it reads whole, to weigh its
    // progress by them (see the progress suite below).
    mock.graphql({query: "GithubPullRequestCounts",
      json: {data: {repository0: {pullRequests: {totalCount: 2}}}}});
  }

  function memberNames(tableName) {
    return dwh.dimensions[tableName].rows({columns: ["name"]}).map((row) => row.name).sort();
  }

  // One import for all the tests of this suite, each of them asserting a part of its result.
  describe("with both import options enabled", () => {
    beforeAll(() => {
      mockSelectedRepository();
      mock.extraOptions({import_commits: true, import_changes: true});

      importRun.run();
    });

    test("imports the selected repository with its owner", () => {
      expect(dwh.dimensions.repositories.rows({columns: ["external_id", "repository_slug", "repository_name"]})).
        toEqual([{external_id: 101, repository_slug: "acme/app", repository_name: "app"}]);
      expect(dwh.dimensions.owners.rows({columns: ["external_id", "login", "owner_type"]})).
        toEqual([{external_id: "11", login: "acme", owner_type: "Organization"}]);
      expect(importRun.statusMessages()).toContain("Importing GitHub repositories");
    });

    test("imports the pull requests as dimension members", () => {
      expect(dwh.dimensions.pull_requests.rows({
        columns: ["github_pull_request_id", "pull_request_key", "title", "repository_slug", "state",
          "merge_state", "branch_name", "milestone_name", "merge_commit"],
        orderBy: "github_pull_request_id"
      })).toEqual([
        {
          github_pull_request_id: 5001, pull_request_key: "#12", title: "#12 Add the import log",
          repository_slug: "acme/app", state: "Merged", merge_state: "Mergeable",
          branch_name: "feature/import-log", milestone_name: "1.2", merge_commit: "abc123"
        },
        {
          github_pull_request_id: 5002, pull_request_key: "#13", title: "#13 Fix the pagination",
          repository_slug: "acme/app", state: "Open", merge_state: "Conflicting",
          branch_name: "bugfix/pagination", milestone_name: null, merge_commit: null
        }
      ]);
    });

    test("stores the pull request timestamps as datetime properties", () => {
      var rows = dwh.dimensions.pull_requests.rows({
        columns: ["created_at", "closed_at"], orderBy: "github_pull_request_id"
      });

      expect(rows[0].created_at.substring(0, 19)).toBe("2026-01-05T10:00:00");
      expect(rows[0].closed_at.substring(0, 19)).toBe("2026-01-07T10:00:00");
      expect(rows[1].closed_at).toBeNull();
    });

    test("imports a created row and a closed row of a closed pull request", () => {
      var rows = dwh.measures.pull_requests.rows();
      var closedRows = rows.filter((row) => row.pull_request_closed === 1);

      expect(rows).toHaveLength(5);
      expect(rows.filter((row) => row.pull_request_created === 1)).toHaveLength(2);
      expect(rows.filter((row) => row.pull_request_due === 1)).toHaveLength(1);
      expect(closedRows).toHaveLength(1);
      expect(closedRows[0]).toMatchObject({
        commits_closed: 2, changed_files_count: 3, additions: 120, deletions: 40
      });
      expect(closedRows[0].total_closing_days).toBeCloseTo(2, 6);
    });

    test("imports a row of the milestone due date", () => {
      expect(dwh.measures.pull_requests.rows().
        filter((row) => row.pull_request_with_milestone_due_date === 1)).toHaveLength(1);
      expect(_.sortBy(dwh.dimensions.milestone.
        rows({columns: ["external_id", "milestone_number", "name"]}), "name")).toEqual([
        {external_id: null, milestone_number: null, name: "(none)"},
        {external_id: "101-4", milestone_number: 4, name: "1.2"}
      ]);
    });

    test("imports the conversation comments and every submitted review", () => {
      var rows = dwh.measures.pr_comment.rows({columns: ["comments_submitted", "reviews_submitted"]});

      // One row per conversation comment and one per review: the conversation comment, the review with
      // a body and two inline comments, the bare approval which carries no comment at all, and the reply
      // the pull request author wrote in a review thread, which GitHub answers as a review of its own.
      expect(rows.map((row) => [row.comments_submitted, row.reviews_submitted]).
        sort((a, b) => ((a[0] || 0) - (b[0] || 0)) || ((a[1] || 0) - (b[1] || 0)))).
        toEqual([[null, 1], [1, null], [1, null], [3, 1]]);
      expect(memberNames("pr_comment_authors")).toEqual(["kim", "sam"]);
      expect(memberNames("pr_review_states")).toEqual(["(no state)", "Approved"]);
    });

    test("imports the commits of every pull request", () => {
      var rows = dwh.measures.pr_commit.rows({columns: ["commits_submitted", "commit_additions"]});

      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.commit_additions).sort((a, b) => a - b)).toEqual([10, 20, 100]);
      // The second commit of the merged pull request has no linked GitHub account.
      expect(memberNames("pr_commit_authors")).toEqual(["(no author)", "kim", "sam"]);
    });

    test("imports the state transitions of every pull request", () => {
      var rows = dwh.measures.pr_transition.rows();

      expect(rows.filter((row) => row.transition_to === 1)).toHaveLength(4);
      expect(rows.filter((row) => row.transition_from === 1)).toHaveLength(2);
      expect(memberNames("pr_states")).toEqual(["Approved", "Merged", "Open"]);
    });

    test("imports the accounts of every role", () => {
      expect(memberNames("pr_author")).toEqual(["kim", "sam"]);
      expect(memberNames("pr_assignees")).toEqual(["(no assignee)", "kim"]);
      expect(memberNames("pr_reviewers")).toEqual(["(no reviewer)", "orgs/acme/teams/platform", "sam"]);
      expect(dwh.dimensions.pr_author.rows({columns: ["name", "display_name", "email", "external_type"],
        orderBy: "name"})).toEqual([
        {name: "kim", display_name: "Kim Lee", email: "kim@example.com", external_type: "User"},
        {name: "sam", display_name: "Sam Roe", email: "sam@example.com", external_type: "User"}
      ]);
    });

    test("imports the labels of a pull request through the bridge table", () => {
      expect(memberNames("labels")).toEqual(["(none)", "backend", "feature"]);
      // One bridge row per label of the two-label pull request, and one for the pull request without labels.
      expect(dwh.dimensions.labels_bt.rows()).toHaveLength(3);
    });

    test("stores the incremental mark and the imported repositories", () => {
      var maxParams = importRun.maxParams();

      expect(maxParams["updated_at.101"]).toBeDefined();
      expect(maxParams["imported_repositories.0"]).toBe("101");
    });

    // GitHub answers updatedAt at whole seconds, so a mark with milliseconds rounds a same-second
    // update below itself and the next incremental import would skip that update forever.
    test("stores the incremental mark at whole-second precision", () => {
      expect(importRun.maxParams()["updated_at.101"]).toMatch(/T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  describe("with the import options disabled", () => {
    beforeEach(() => {
      mockSelectedRepository();
      mock.extraOptions({import_commits: false, import_changes: false});
    });

    test("imports no commit and no transition rows", () => {
      importRun.run();

      expect(dwh.measures.pr_commit.rows()).toEqual([]);
      expect(dwh.measures.pr_transition.rows()).toEqual([]);
      // The commit count of a closed pull request is imported without the commits option.
      expect(dwh.measures.pull_requests.rows().filter((row) => row.commits_closed === 2)).toHaveLength(1);
    });

    test("deletes the rows that an earlier import wrote with the option enabled", () => {
      mock.extraOptions({import_commits: true, import_changes: true});
      importRun.run();
      expect(dwh.measures.pr_commit.rows()).toHaveLength(3);

      mock.extraOptions({import_commits: false, import_changes: false});
      // Both options declare clearsMax, so changing one clears the stored marks and the next import
      // reads every pull request again — which is what rewrites the rows of the disabled option.
      mock.maxParams({});
      importRun.run();

      expect(dwh.measures.pr_commit.rows()).toEqual([]);
      expect(dwh.measures.pr_transition.rows()).toEqual([]);
    });
  });

  describe("of a repository owner", () => {
    test("imports every repository of the selected owner", () => {
      mockSelectedRepository();
      mock.sourceSelection(["owner/21"]);
      mock.graphql({query: "PullRequests", json: {data: {repository: {pullRequests:
        {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}}}});

      importRun.run();

      expect(dwh.dimensions.repositories.rows({columns: ["repository_slug"]})).
        toEqual([{repository_slug: "dana/notes"}]);
    });
  });

  describe("of an incremental import", () => {
    test("stops at the first pull request that was not updated since the previous import", () => {
      mockSelectedRepository();
      mock.maxParams({"updated_at.101": "2026-01-08T00:00:00Z"});
      mock.graphql({query: "PullRequests", variables: {first: 25}, fixture: "pull_requests_page1"});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, fixture: "pull_requests_page2"});

      importRun.run();

      expect(source.isIncrementalImport()).toBe(true);
      expect(dwh.dimensions.pull_requests.rows({columns: ["github_pull_request_id"]})).
        toEqual([{github_pull_request_id: 5002}]);
    });

    test("imports every pull request again on a reimport", () => {
      mockSelectedRepository();
      mock.maxParams({"updated_at.101": "2026-01-08T00:00:00Z"});

      importRun.run({reimport: true});

      expect(dwh.dimensions.pull_requests.rows()).toHaveLength(2);
    });
  });

  describe("of a renamed repository", () => {
    test("replaces the fact rows of the pull requests it reads again", () => {
      mockSelectedRepository();
      importRun.run();
      var importedRowCount = dwh.measures.pull_requests.rows().length;

      mock.get("/user/repos", [{id: 101, name: "application", full_name: "acme/application",
        owner: {id: 11, login: "acme", type: "Organization"}}]);
      importRun.run({reimport: true});

      expect(dwh.measures.pull_requests.rows()).toHaveLength(importedRowCount);
      expect(dwh.dimensions.pull_requests.rows({columns: ["repository_slug"]})).
        toEqual([{repository_slug: "acme/application"}, {repository_slug: "acme/application"}]);
    });

    // The Milestone members store the repository slug too, and an incremental import which re-reads no
    // pull request of the repository never writes them again.
    test("renames the milestones of the pull requests it does not read again", () => {
      mockSelectedRepository();
      importRun.run();

      mock.get("/user/repos", [{id: 101, name: "application", full_name: "acme/application",
        owner: {id: 11, login: "acme", type: "Organization"}}]);
      // Nothing was updated since the incremental mark, so no pull request and no milestone is read.
      mock.graphql({query: "PullRequests", json: {data: {
        rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"},
        repository: {pullRequests: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}
      }}});
      importRun.run();

      expect(dwh.dimensions.milestone.rows({columns: ["name", "repository_slug"]})).
        toContainEqual({name: "1.2", repository_slug: "acme/application"});
    });

    // A transfer to another account renames the owner half of the slug, and the Pull Request members
    // store the owner of the repository denormalized as well.
    test("moves the pull requests of a transferred repository to its new owner", () => {
      mockSelectedRepository();
      importRun.run();

      mock.get("/user/repos", [{id: 101, name: "app", full_name: "globex/app",
        owner: {id: 31, login: "globex", type: "Organization"}}]);
      // Nothing was updated since the incremental mark, so no pull request is read again.
      mock.graphql({query: "PullRequests", json: {data: {
        rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"},
        repository: {pullRequests: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}
      }}});
      importRun.run();

      var globexId = dwh.dimensions.owners.lookupId({external_id: "31"});
      expect(dwh.dimensions.pull_requests.rows({columns: ["owner_id"]})).
        toEqual([{owner_id: globexId}, {owner_id: globexId}]);
    });
  });

  // A scope is replaced only when it is written again, so the rows an earlier version of the type wrote
  // under a different source id stay next to the new ones and double every measure of the repository.
  describe("after a change of the import scope keys", () => {
    test("deletes the rows the current scopes no longer replace", () => {
      mockSelectedRepository();
      importRun.run();
      var importedRowCount = dwh.measures.pull_requests.rows().length;

      // What an earlier version left behind: a row of a scope this version never writes again.
      dwh.measures.pull_requests.insert({
        _source_id: "acme/app-5001", _source_name: "pull request", pull_request_created: 1,
        repository_id: dwh.dimensions.repositories.lookupId({external_id: 101})
      });

      importRun.run({reimport: true});

      expect(dwh.measures.pull_requests.rows()).toHaveLength(importedRowCount);
    });
  });

  describe("progress", () => {
    function countsRequests() {
      return mock.requests().filter((request) => String(request.body).includes("GithubPullRequestCounts"));
    }

    test("counts the read pull requests against the count of the repository", () => {
      mockSelectedRepository();

      importRun.run();

      expect(importRun.statusMessages()).
        toContain("Importing the pull requests of acme/app (2 of 2) (100%)");
    });

    test("counts the read pull requests without a count of a repository that keeps its mark", () => {
      mockSelectedRepository();
      mock.maxParams({"updated_at.101": "2020-01-01T00:00:00Z"});

      importRun.run();

      // Its nominal weight is credited whole when it finishes, so the import still ends at 100% —
      // reported on the repository that finished, without naming a total it never read.
      expect(importRun.statusMessages()).
        toContain("Importing the pull requests of acme/app (2 read) (100%)");
      expect(countsRequests()).toHaveLength(0);
    });

    test("reaches 100% when every repository read whole is empty", () => {
      mockSelectedRepository();
      mock.graphql({query: "PullRequests", json: {data: {repository: {pullRequests:
        {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}}}});
      mock.graphql({query: "GithubPullRequestCounts",
        json: {data: {repository0: {pullRequests: {totalCount: 0}}}}});

      importRun.run();

      expect(importRun.statusMessages()).toContain("Importing the pull requests of acme/app (100%)");
    });
  });

  describe("of a deselected repository", () => {
    test("deletes the data of a repository that is no longer selected", () => {
      mockSelectedRepository();
      importRun.run();
      expect(dwh.dimensions.pull_requests.rows()).toHaveLength(2);

      mock.sourceSelection(["102"]);
      importRun.run();

      expect(dwh.dimensions.repositories.rows({columns: ["external_id"]})).toEqual([{external_id: 102}]);
      expect(dwh.measures.pull_requests.rows()).toHaveLength(5);
    });

    test("imports its pull requests again when it is selected again", () => {
      mockSelectedRepository();
      importRun.run();

      // dana/notes has no pull requests, so deselecting acme/app leaves the account without any.
      mock.sourceSelection(["owner/21"]);
      mock.graphql({query: "PullRequests", json: {data: {repository: {pullRequests:
        {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}}}});
      importRun.run();
      expect(dwh.dimensions.pull_requests.rows()).toEqual([]);

      mock.sourceSelection(["101"]);
      mock.graphql({query: "PullRequests", fixture: "pull_requests"});
      importRun.run();

      expect(dwh.dimensions.pull_requests.rows()).toHaveLength(2);
    });
  });

  describe("of a repository that is not selected any more", () => {
    test("deletes its data although the max params were cleared with the selection", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      importRun.run();
      expect(dwh.dimensions.repositories.rows()).toHaveLength(2);

      // What saving a selection with a new source in it leaves behind: the new selection and no max
      // params, so neither the imported repositories nor the previous selection can be read back.
      mock.sourceSelection(["102"]);
      mock.maxParams({});
      importRun.run();

      expect(dwh.dimensions.repositories.rows({columns: ["external_id"]})).toEqual([{external_id: 102}]);
      expect(dwh.dimensions.pull_requests.rows({columns: ["repository_slug"]}).
        filter((row) => row.repository_slug === "acme/app")).toEqual([]);
      expect(dwh.measures.pull_requests.rows({columns: ["repository_id"]}).
        filter((row) => row.repository_id === 1)).toEqual([]);
    });
  });

  describe("of a repository missing from the API response", () => {
    test("keeps the data of a still selected repository that GitHub did not return", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      importRun.run();
      expect(dwh.dimensions.repositories.rows()).toHaveLength(2);

      // GitHub answers without acme/app this time — a permission change or an outage, not a deselection.
      mock.get("/user/repos", [{id: 102, name: "tools", full_name: "acme/tools",
        owner: {id: 11, login: "acme", type: "Organization"}}]);
      mock.get("/repositories/101", {json: {id: 101, name: "app", full_name: "acme/app",
        owner: {id: 11, login: "acme", type: "Organization"}}});
      importRun.run();

      expect(dwh.dimensions.repositories.rows({columns: ["external_id"]}).
        map((row) => row.external_id).sort()).toEqual([101, 102]);
    });

    test("keeps a still selected repository that GitHub omitted while the selection changed", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      importRun.run();
      expect(dwh.dimensions.repositories.rows()).toHaveLength(2);

      // acme/tools was deselected, and GitHub answers without the still selected acme/app this time.
      mock.sourceSelection(["101", "201"]);
      mock.get("/user/repos", [
        {id: 102, name: "tools", full_name: "acme/tools", owner: {id: 11, login: "acme", type: "Organization"}},
        {id: 201, name: "notes", full_name: "dana/notes", owner: {id: 21, login: "dana", type: "User"}}
      ]);
      mock.get("/repositories/101", {json: {id: 101, name: "app", full_name: "acme/app",
        owner: {id: 11, login: "acme", type: "Organization"}}});
      importRun.run();

      expect(dwh.dimensions.repositories.rows({columns: ["external_id"]}).
        map((row) => row.external_id).sort()).toEqual([101, 201]);
    });

    test("keeps a repository and imports the rest when its own read fails", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      importRun.run();
      expect(dwh.dimensions.repositories.rows()).toHaveLength(2);

      mock.get("/user/repos", [{id: 102, name: "tools", full_name: "acme/tools",
        owner: {id: 11, login: "acme", type: "Organization"}}]);
      mock.get("/repositories/101", {status: 502, json: {message: "Server Error"}});
      importRun.run();

      expect(dwh.dimensions.repositories.rows({columns: ["external_id"]}).
        map((row) => row.external_id).sort()).toEqual([101, 102]);
    });

  });

  describe("of a failing repository", () => {
    test("reports the failure of one repository and keeps its incremental mark", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      mock.spyOn(app.api, "getPullRequests").mockImplementation((repositorySlug) => {
        if (repositorySlug === "acme/tools") throw new Error("GitHub returned 502");
        return null;
      });

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["repository/102"]);
      expect(importRun.warnings()[0].message).
        toContain("Import of the repository acme/tools failed: GitHub returned 502");
      expect(importRun.maxParams()["updated_at.101"]).toBeDefined();
      expect(importRun.maxParams()["updated_at.102"]).toBeUndefined();
    });

    test("reads a repository that failed again at the end of the import", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      var attempts = 0;
      mock.spyOn(app.api, "getPullRequests").mockImplementation((repositorySlug) => {
        if (repositorySlug !== "acme/tools") return null;

        attempts++;
        if (attempts === 1) throw new Error("GitHub returned 502");
        return null;
      });

      importRun.run();

      // The repository answered on the second attempt, so it is missing nothing and leaves no warning.
      expect(attempts).toBe(2);
      expect(importRun.objectFailures()).toEqual([]);
      expect(importRun.warnings()).toEqual([]);
      expect(importRun.maxParams()["updated_at.102"]).toBeDefined();
    });

    test("names the repositories that are still missing in the import log", () => {
      mockSelectedRepository();
      mock.sourceSelection(["101", "102"]);
      mock.spyOn(app.api, "getPullRequests").mockImplementation((repositorySlug) => {
        if (repositorySlug === "acme/tools") throw new Error("GitHub returned 502");
        return null;
      });

      importRun.run();

      expect(importRun.log().join("\n")).
        toContain("ERROR: JavaScript: importAll 1 of 2 selected repositories were not imported: acme/tools");
      expect(importRun.warnings()[0].message).
        toContain("start a new import to read this repository again from its newest pull request");
    });

    test("reads the repository whole again after a reimport failed with its rows deleted", () => {
      mockSelectedRepository();
      importRun.run();
      var importedRowCount = dwh.measures.pull_requests.rows().length;

      // The reimport deletes the stored rows of acme/app before it reads the pull requests that replace
      // them, and GitHub fails in between — the mark of that repository now covers rows that are gone.
      mock.graphql({query: "PullRequests", json: {errors: [{message: "Something went wrong"}]}});
      importRun.run({reimport: true});
      expect(dwh.measures.pull_requests.rows()).toEqual([]);

      mock.graphql({query: "PullRequests", fixture: "pull_requests"});
      importRun.run();

      expect(dwh.measures.pull_requests.rows()).toHaveLength(importedRowCount);
    });
  });

  describe("of a source without repositories", () => {
    test("fails with an error naming the missing permissions", () => {
      mock.sourceParams({api_token: "secret-token"});
      mock.sourceSelection(["999"]);
      mock.get("/user/repos", {fixture: "repositories"});

      expect(() => importRun.run()).toThrow("No GitHub repositories selected for import");
    });
  });

  describe("with a Time dimension time zone", () => {
    test("stores the timestamps in the Time dimension time zone", () => {
      mockSelectedRepository();
      mock.extraOptions({time_dimension_time_zone: "Europe/Riga"});

      importRun.run();

      var rows = dwh.dimensions.pull_requests.rows({
        columns: ["created_at"], orderBy: "github_pull_request_id"
      });
      // 2026-01-05T10:00:00Z is 12:00 in Europe/Riga.
      expect(rows[0].created_at.substring(0, 19)).toBe("2026-01-05T12:00:00");
    });
  });
});
