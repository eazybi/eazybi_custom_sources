describe("app.importers.pullRequests", () => {
  var IMPORT_OPTIONS = {importCommits: true, importChanges: true};
  var REPOSITORY = {id: 1, externalId: 101, ownerId: 2, slug: "acme/app", name: "app"};

  function pullRequestFixture(pullRequestNumber) {
    return mock.fixture("pull_requests").data.repository.pullRequests.nodes.
      find((node) => node.number === pullRequestNumber);
  }

  beforeEach(() => {
    importRun.prepare();
  });

  test("imports the pull request member with the repository denormalized into it", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pull_requests.rows({
      columns: ["github_pull_request_id", "pull_request_number", "pull_request_key", "repository_slug",
        "repository_name", "repository_id", "owner_id"]
    })).toEqual([{
      github_pull_request_id: 5001, pull_request_number: 12, pull_request_key: "#12",
      repository_slug: "acme/app", repository_name: "app", repository_id: 1, owner_id: 2
    }]);
  });

  test("keeps one account member when its login was changed", () => {
    var author = {__typename: "User", databaseId: 4700, login: "sam", name: "Sam Roe",
      email: "sam@example.com"};
    app.importers.pullRequests.importOne(Object.assign({}, pullRequestFixture(12), {author: author}),
      REPOSITORY, IMPORT_OPTIONS);

    // The login reaches the member with the next import: createAndLookupId writes the attributes of a
    // member once per import.
    importRun.prepare();
    var renamedAuthor = Object.assign({}, author, {login: "sam-roe"});
    app.importers.pullRequests.importOne(Object.assign({}, pullRequestFixture(12), {author: renamedAuthor}),
      REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pr_author.rows({columns: ["name", "external_id"]})).
      toEqual([{name: "sam-roe", external_id: "User-4700"}]);
  });

  test("links a bot to its app page and a user to its profile", () => {
    var bot = {__typename: "Bot", databaseId: 41898282, login: "github-actions"};
    app.importers.pullRequests.importOne(Object.assign({}, pullRequestFixture(12), {author: bot}),
      REPOSITORY, IMPORT_OPTIONS);
    app.importers.pullRequests.importOne(pullRequestFixture(13), REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pr_author.rows({columns: ["name", "profile_path"], orderBy: "name"})).
      toEqual([
        {name: "github-actions", profile_path: "apps/github-actions"},
        {name: "sam", profile_path: "sam"}
      ]);
  });

  test("keeps one label member when a label is named like the no label member", () => {
    var labeled = Object.assign({}, pullRequestFixture(12),
      {labels: {nodes: [{id: "LA_none", name: "(none)"}]}});
    var unlabeled = Object.assign({}, pullRequestFixture(13), {labels: {nodes: []}});

    app.importers.pullRequests.importOne(labeled, REPOSITORY, IMPORT_OPTIONS);
    app.importers.pullRequests.importOne(unlabeled, REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.labels.rows({columns: ["name"]})).toEqual([{name: "(none)"}]);
  });

  test("stores whether a pull request is a draft", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);
    app.importers.pullRequests.importOne(Object.assign({}, pullRequestFixture(13), {isDraft: true}),
      REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pull_requests.
      rows({columns: ["pull_request_key", "draft"], orderBy: "pull_request_key"})).
      toEqual([{pull_request_key: "#12", draft: "No"}, {pull_request_key: "#13", draft: "Yes"}]);
  });

  test("stores an unknown mergeable state as the member of a missing value", () => {
    app.importers.pullRequests.importOne(Object.assign({}, pullRequestFixture(12), {mergeable: "UNKNOWN"}),
      REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pr_merge_states.rows({columns: ["name"]})).toEqual([{name: "(none)"}]);
    expect(dwh.dimensions.pull_requests.rows({columns: ["merge_state"]})).toEqual([{merge_state: null}]);
  });

  test("stores the diff stats of a closed pull request on its closed row", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);

    var rows = dwh.measures.pull_requests.rows();
    var createdRow = rows.find((row) => row.pull_request_created === 1);
    var closedRow = rows.find((row) => row.pull_request_closed === 1);

    expect(createdRow.additions).toBeNull();
    expect(closedRow).toMatchObject({additions: 120, deletions: 40, changed_files_count: 3, commits_closed: 2});
  });

  test("stores the diff stats of an open pull request on its created row", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(13), REPOSITORY, IMPORT_OPTIONS);

    var rows = dwh.measures.pull_requests.rows();

    expect(rows.find((row) => row.pull_request_created === 1)).
      toMatchObject({additions: 10, deletions: 2, changed_files_count: 1});
    expect(rows.find((row) => row.pull_request_due === 1)).toBeDefined();
  });

  test("writes the rows of one pull request under its own import scope", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.measures.pull_requests.rows({columns: ["_source_id", "_source_name"]})[0]).toEqual({
      _source_id: "101-5001", _source_name: "custom_github pull request"
    });
    expect(dwh.measures.pr_comment.rows({columns: ["_source_name"]})[0]).
      toEqual({_source_name: "custom_github comment"});
  });

  test("counts the requested reviewers and the review authors as the reviewers", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);

    // sam is both a requested reviewer and the author of the review, kim is the author of the pull
    // request and is never its reviewer, and the requested team is keyed by its team URL path.
    expect(dwh.dimensions.pr_reviewers.rows({columns: ["name", "display_name"], orderBy: "name"})).toEqual([
      {name: "orgs/acme/teams/platform", display_name: "Platform"},
      {name: "sam", display_name: "Sam Roe"}
    ]);
    expect(dwh.dimensions.pr_reviewers_bt.rows()).toHaveLength(2);
  });

  test("keys an enterprise team reviewer by its enterprise team path", () => {
    var pullRequest = Object.assign({}, pullRequestFixture(12), {
      reviewRequests: {nodes: [{requestedReviewer:
        {__typename: "EnterpriseTeam", name: "Security", combinedSlug: "globex/security"}}]}
    });

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

    // sam is the author of the review of this pull request and is a reviewer that way.
    expect(dwh.dimensions.pr_reviewers.rows({columns: ["name", "display_name"], orderBy: "name"})).toEqual([
      {name: "enterprises/globex/teams/security", display_name: "Security"},
      {name: "sam", display_name: "Sam Roe"}
    ]);
  });

  test("leaves the author of a reply out of the reviewers of a pull request", () => {
    var lee = {__typename: "User", databaseId: 4701, login: "lee", name: "Lee Ray", email: "lee@example.com"};
    var pullRequest = Object.assign({}, pullRequestFixture(12), {
      reviewRequests: {nodes: []},
      reviews: {totalCount: 1, nodes: [{
        id: "PRR_1", state: "COMMENTED", submittedAt: "2026-01-06T16:00:00Z", body: "", author: lee,
        comments: {totalCount: 1, nodes: [{replyTo: {id: "PRRC_1"}}]}
      }]}
    });

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pr_reviewers.rows({columns: ["name"]})).toEqual([{name: "(no reviewer)"}]);
  });

  test("leaves the drafter of a pending review out of the reviewers", () => {
    var lee = {__typename: "User", databaseId: 4701, login: "lee", name: "Lee Ray", email: "lee@example.com"};
    var pullRequest = Object.assign({}, pullRequestFixture(12), {
      reviewRequests: {nodes: []},
      reviews: {totalCount: 1, nodes: [{
        id: "PRR_1", state: "PENDING", submittedAt: null, body: "Draft notes", author: lee,
        comments: {totalCount: 1, nodes: [{replyTo: null}]}
      }]}
    });

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.pr_reviewers.rows({columns: ["name"]})).toEqual([{name: "(no reviewer)"}]);
  });

  test("keeps the milestones of two repositories with the same milestone number apart", () => {
    var otherRepository = {id: 2, externalId: 102, ownerId: 2, slug: "acme/tools", name: "tools"};
    var pullRequest = Object.assign({}, pullRequestFixture(12),
      {milestone: {id: "MI_app_1", number: 1, title: "1.2", dueOn: "2026-02-01T00:00:00Z"}});
    var otherPullRequest = Object.assign({}, pullRequestFixture(13),
      {milestone: {id: "MI_tools_1", number: 1, title: "Sprint 9", dueOn: "2026-03-01T00:00:00Z"}});

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);
    app.importers.pullRequests.importOne(otherPullRequest, otherRepository, IMPORT_OPTIONS);

    expect(dwh.dimensions.milestone.rows({
      columns: ["external_id", "milestone_number", "name", "due_date"], orderBy: "name"
    })).toEqual([
      {external_id: "101-1", milestone_number: 1, name: "1.2", due_date: "2026-02-01"},
      {external_id: "102-1", milestone_number: 1, name: "Sprint 9", due_date: "2026-03-01"}
    ]);
  });

  test("keeps one milestone member when its node id changes", () => {
    var pullRequest = Object.assign({}, pullRequestFixture(12),
      {milestone: {id: "MDk6TWlsZXN0b25lMQ==", number: 1, title: "1.2", dueOn: "2026-02-01T00:00:00Z"}});
    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

    importRun.prepare();
    var renumbered = Object.assign({}, pullRequestFixture(12),
      {milestone: {id: "MI_kwDOABCD1234", number: 1, title: "1.2", dueOn: "2026-02-01T00:00:00Z"}});
    app.importers.pullRequests.importOne(renumbered, REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.dimensions.milestone.rows({columns: ["external_id", "milestone_number", "name"]})).
      toEqual([{external_id: "101-1", milestone_number: 1, name: "1.2"}]);
  });

  test("appends the repository to the milestone titles that two repositories share", () => {
    var otherRepository = {id: 2, externalId: 102, ownerId: 2, slug: "acme/tools", name: "tools"};
    var pullRequest = Object.assign({}, pullRequestFixture(12),
      {milestone: {id: "MI_app_1", number: 1, title: "1.2", dueOn: "2026-02-01T00:00:00Z"}});
    var otherPullRequest = Object.assign({}, pullRequestFixture(13),
      {milestone: {id: "MI_tools_1", number: 1, title: "1.2", dueOn: "2026-03-01T00:00:00Z"}});

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);
    app.importers.pullRequests.importOne(otherPullRequest, otherRepository, IMPORT_OPTIONS);
    app.importers.pullRequests.updateDuplicateMilestoneNames();

    expect(dwh.dimensions.milestone.rows({columns: ["name"], orderBy: "name"})).
      toEqual([{name: "1.2 (acme/app)"}, {name: "1.2 (acme/tools)"}]);
  });

  // GitHub answers a milestone due date as midnight UTC, which is the previous day in a time zone behind
  // UTC — the due date is the date it is written as, in every Time dimension time zone.
  test("counts the milestone due date on the date it is written as", () => {
    mock.extraOptions({time_dimension_time_zone: "America/New_York"});
    importRun.prepare();
    var pullRequest = Object.assign({}, pullRequestFixture(13),
      {milestone: {id: "MI_app_4", number: 4, title: "1.2", dueOn: "2026-02-01T00:00:00Z"}});

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

    var dueRow = dwh.measures.pull_requests.rows().
      find((row) => row.pull_request_with_milestone_due_date === 1);

    expect(dueRow.time_id).toBe(dwh.lookupTimeId("2026-02-01T12:00:00Z"));
    expect(dwh.dimensions.milestone.rows({columns: ["due_date"]})).toEqual([{due_date: "2026-02-01"}]);
  });

  test("imports a reply written in a review thread as a comment and not as a review", () => {
    var kim = {__typename: "User", databaseId: 4702, login: "kim", name: "Kim Lee", email: "kim@example.com"};
    function review(reviewId, body, totalCount, replyTo) {
      return {
        id: reviewId, state: "COMMENTED", submittedAt: "2026-01-06T16:00:00Z", body: body, author: kim,
        comments: {totalCount: totalCount, nodes: replyTo === undefined ? [] : [{replyTo: replyTo}]}
      };
    }
    var pullRequest = Object.assign({}, pullRequestFixture(12), {
      comments: {totalCount: 0, nodes: []},
      reviews: {totalCount: 4, nodes: [
        // The reply, and the three that are reviews: a comment that starts a thread, a body, and more
        // than the one comment.
        review("PRR_1", "", 1, {id: "PRRC_1"}),
        review("PRR_2", "", 1, null),
        review("PRR_3", "One question", 1, {id: "PRRC_2"}),
        review("PRR_4", "", 2, {id: "PRRC_3"})
      ]}
    });

    app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

    var stateNames = {};
    dwh.dimensions.pr_review_states.rows({columns: ["id", "name"]}).
      forEach((row) => { stateNames[row.id] = row.name; });
    var rows = dwh.measures.pr_comment.rows({
      columns: ["comments_submitted", "reviews_submitted", "review_comments_submitted", "pr_review_state_id"]
    });

    expect(rows.map((row) => [stateNames[row.pr_review_state_id], row.comments_submitted,
      row.reviews_submitted, row.review_comments_submitted])).toEqual([
      ["(no state)", 1, null, null],
      ["Commented", 1, 1, 1],
      ["Commented", 2, 1, 2],
      ["Commented", 2, 1, 2]
    ]);
  });

  test("replaces the rows of a pull request that changed", () => {
    app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);
    // The conversation comment, one row per review, and the reply which GitHub answers among the reviews.
    expect(dwh.measures.pr_comment.rows()).toHaveLength(4);

    var changedPullRequest = pullRequestFixture(12);
    changedPullRequest.comments = {totalCount: 0, nodes: []};
    importRun.prepare();
    app.importers.pullRequests.importOne(changedPullRequest, REPOSITORY, IMPORT_OPTIONS);

    expect(dwh.measures.pr_comment.rows()).toHaveLength(3);
  });
});
