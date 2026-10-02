describe("app.importers.transitions", () => {
  var IMPORT_OPTIONS = {importCommits: false, importChanges: true};
  var REPOSITORY = {id: 1, externalId: 101, ownerId: 2, slug: "acme/app", name: "app"};

  function pullRequestFixture(pullRequestNumber) {
    return mock.fixture("pull_requests").data.repository.pullRequests.nodes.
      find((node) => node.number === pullRequestNumber);
  }

  describe("rows", () => {
    beforeEach(() => {
      importRun.prepare();
    });

    test("leaves every state and enters the next one in the order they happened", () => {
      app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);

      var stateNames = {};
      dwh.dimensions.pr_states.rows({columns: ["id", "name"]}).
        forEach((row) => { stateNames[row.id] = row.name; });

      // Both rows of one transition carry its timestamp, the row leaving the previous state first.
      var transitions = _.sortBy(dwh.measures.pr_transition.rows(),
        (row) => row.transition_ts * 2 + (row.transition_from === 1 ? 0 : 1));

      expect(transitions.map((row) =>
        `${row.transition_to === 1 ? "to" : "from"} ${stateNames[row.pr_state_id]}`)).toEqual([
        "to Open", "from Open", "to Approved", "from Approved", "to Merged"
      ]);
    });

    test("stores the days spent in the state that was left", () => {
      app.importers.pullRequests.importOne(pullRequestFixture(12), REPOSITORY, IMPORT_OPTIONS);

      var daysInState = dwh.measures.pr_transition.rows().
        filter((row) => row.transition_from === 1).
        map((row) => row.days_in_transition_state).sort((first, second) => first - second);

      // Open from 2026-01-05 10:00 until the approval 23 hours later, approved for 25 hours until the merge.
      expect(daysInState[0]).toBeCloseTo(0.958333, 6);
      expect(daysInState[1]).toBeCloseTo(1.041667, 6);
    });

    test("leaves the state of a dismissed review at the dismissal", () => {
      var pullRequest = Object.assign({}, pullRequestFixture(13), {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {totalCount: 2, nodes: [
          {id: "PRR_1", state: "DISMISSED", submittedAt: "2026-01-06T10:00:00Z",
            author: {__typename: "User", databaseId: 4700, login: "sam"}},
          {id: "PRR_2", state: "APPROVED", submittedAt: "2026-01-08T10:00:00Z",
            author: {__typename: "User", databaseId: 4701, login: "lee"}}
        ]},
        timelineItems: {filteredCount: 1, nodes: [
          {__typename: "ReviewDismissedEvent", createdAt: "2026-01-07T10:00:00Z",
            previousReviewState: "CHANGES_REQUESTED", review: {id: "PRR_1"},
            actor: {__typename: "User", databaseId: 4701, login: "lee"}}
        ]}
      });
      app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

      var stateNames = {};
      dwh.dimensions.pr_states.rows({columns: ["id", "name"]}).
        forEach((row) => { stateNames[row.id] = row.name; });
      var transitions = _.sortBy(dwh.measures.pr_transition.rows(),
        (row) => row.transition_ts * 2 + (row.transition_from === 1 ? 0 : 1));

      expect(transitions.map((row) =>
        `${row.transition_to === 1 ? "to" : "from"} ${stateNames[row.pr_state_id]}`)).toEqual([
        "to Open", "from Open", "to Changes Requested", "from Changes Requested", "to Open",
        "from Open", "to Approved"
      ]);
      // One day in Changes Requested, from the review until the dismissal — not two, until the approval.
      expect(transitions[3].days_in_transition_state).toBeCloseTo(1, 6);
    });

    test("keeps a merged pull request merged when a review is submitted after the merge", () => {
      var pullRequest = Object.assign({}, pullRequestFixture(13), {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {totalCount: 1, nodes: [
          {id: "PRR_1", state: "APPROVED", submittedAt: "2026-01-08T10:00:00Z",
            author: {__typename: "User", databaseId: 4700, login: "sam"}}
        ]},
        timelineItems: {filteredCount: 1, nodes: [
          {__typename: "MergedEvent", createdAt: "2026-01-07T10:00:00Z",
            actor: {__typename: "User", databaseId: 4702, login: "kim"}}
        ]}
      });
      app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

      var stateNames = {};
      dwh.dimensions.pr_states.rows({columns: ["id", "name"]}).
        forEach((row) => { stateNames[row.id] = row.name; });
      var transitions = _.sortBy(dwh.measures.pr_transition.rows(),
        (row) => row.transition_ts * 2 + (row.transition_from === 1 ? 0 : 1));

      expect(transitions.map((row) =>
        `${row.transition_to === 1 ? "to" : "from"} ${stateNames[row.pr_state_id]}`)).toEqual([
        "to Open", "from Open", "to Merged"
      ]);
    });

    // The same for a closed pull request, whose close a reopen does end.
    test("keeps a closed pull request closed until a review after the close is followed by a reopen", () => {
      var pullRequest = Object.assign({}, pullRequestFixture(13), {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {totalCount: 1, nodes: [
          {id: "PRR_1", state: "CHANGES_REQUESTED", submittedAt: "2026-01-08T10:00:00Z",
            author: {__typename: "User", databaseId: 4700, login: "sam"}}
        ]},
        timelineItems: {filteredCount: 2, nodes: [
          {__typename: "ClosedEvent", createdAt: "2026-01-07T10:00:00Z",
            actor: {__typename: "User", databaseId: 4702, login: "kim"}},
          {__typename: "ReopenedEvent", createdAt: "2026-01-09T10:00:00Z",
            actor: {__typename: "User", databaseId: 4702, login: "kim"}}
        ]}
      });
      app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

      var stateNames = {};
      dwh.dimensions.pr_states.rows({columns: ["id", "name"]}).
        forEach((row) => { stateNames[row.id] = row.name; });
      var transitions = _.sortBy(dwh.measures.pr_transition.rows(),
        (row) => row.transition_ts * 2 + (row.transition_from === 1 ? 0 : 1));

      expect(transitions.map((row) =>
        `${row.transition_to === 1 ? "to" : "from"} ${stateNames[row.pr_state_id]}`)).toEqual([
        "to Open", "from Open", "to Closed", "from Closed", "to Open"
      ]);
    });

    test("imports the author transitions of a pull request assigned to its own author", () => {
      var pullRequest = pullRequestFixture(13);
      pullRequest.timelineItems = {nodes: [
        {
          __typename: "AssignedEvent", createdAt: "2026-01-08T09:00:00Z",
          actor: {__typename: "User", login: "sam"}, assignee: {login: "sam"}
        },
        {
          __typename: "UnassignedEvent", createdAt: "2026-01-08T11:00:00Z",
          actor: {__typename: "User", login: "kim"}, assignee: {login: "sam"}
        },
        // The assignment of another account is the Pull Request Assignee dimension, not a transition.
        {
          __typename: "AssignedEvent", createdAt: "2026-01-08T12:00:00Z",
          actor: {__typename: "User", login: "sam"}, assignee: {login: "kim"}
        }
      ], pageInfo: {hasNextPage: false, endCursor: null}};

      app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

      var rows = dwh.measures.pr_transition.rows();

      expect(rows.filter((row) => row.transition_to_author === 1)).toHaveLength(1);
      expect(rows.filter((row) => row.transition_from_author === 1)).toHaveLength(1);
    });

    test("ignores the assignment events that are older than the pull request", () => {
      var pullRequest = Object.assign({}, pullRequestFixture(13), {timelineItems: {nodes: [
        {
          __typename: "AssignedEvent", createdAt: "2026-01-01T09:00:00Z",
          actor: {__typename: "User", login: "sam"}, assignee: {login: "sam"}
        },
        {
          __typename: "UnassignedEvent", createdAt: "2026-01-09T11:00:00Z",
          actor: {__typename: "User", login: "kim"}, assignee: {login: "sam"}
        }
      ]}});

      app.importers.pullRequests.importOne(pullRequest, REPOSITORY, IMPORT_OPTIONS);

      var rows = dwh.measures.pr_transition.rows();

      // The pull request was created 2026-01-08 08:00, so only the unassignment happened in its lifetime.
      expect(rows.filter((row) => row.transition_to_author === 1)).toHaveLength(0);
      expect(rows.filter((row) => row.transition_from_author === 1)).toHaveLength(1);
    });
  });

  describe("stateEvents", () => {
    test("drops the close event that GitHub emits with the merge", () => {
      var context = {pullRequest: {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {nodes: []},
        timelineItems: {nodes: [
          {__typename: "MergedEvent", createdAt: "2026-01-07T10:00:00Z"},
          {__typename: "ClosedEvent", createdAt: "2026-01-07T10:00:01Z"}
        ]}
      }};

      expect(app.importers.transitions.stateEvents(context).map((event) => event.__typename)).
        toEqual(["MergedEvent"]);
    });

    test("ignores the events of a transferred pull request that are older than it", () => {
      var context = {pullRequest: {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {nodes: [
          {state: "APPROVED", submittedAt: "2025-12-01T10:00:00Z", author: {login: "sam"}}
        ]},
        timelineItems: {nodes: [
          {__typename: "ReopenedEvent", createdAt: "2026-01-06T10:00:00Z"}
        ]}
      }};

      expect(app.importers.transitions.stateEvents(context).map((event) => event.__typename)).
        toEqual(["ReopenedEvent"]);
    });

    test("orders the reviews and the timeline events by the time they happened", () => {
      var context = {pullRequest: {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {nodes: [
          {state: "CHANGES_REQUESTED", submittedAt: "2026-01-06T10:00:00Z", author: {login: "sam"}},
          {state: "APPROVED", submittedAt: "2026-01-08T10:00:00Z", author: {login: "sam"}},
          // A review that was never submitted is a pending draft and changes no state.
          {state: "PENDING", submittedAt: null, author: {login: "lee"}}
        ]},
        timelineItems: {nodes: [
          {__typename: "ClosedEvent", createdAt: "2026-01-07T10:00:00Z"}
        ]}
      }};

      expect(app.importers.transitions.stateEvents(context).map((event) => event.__typename)).
        toEqual(["CHANGES_REQUESTED", "ClosedEvent", "APPROVED"]);
    });

    test("enters the state of a review that was dismissed later", () => {
      var context = {pullRequest: {
        createdAt: "2026-01-05T10:00:00Z",
        reviews: {nodes: [
          {id: "PRR_1", state: "DISMISSED", submittedAt: "2026-01-06T10:00:00Z", author: {login: "sam"}},
          {id: "PRR_2", state: "APPROVED", submittedAt: "2026-01-08T10:00:00Z", author: {login: "lee"}}
        ]},
        timelineItems: {nodes: [
          {
            __typename: "ReviewDismissedEvent", createdAt: "2026-01-07T10:00:00Z",
            previousReviewState: "CHANGES_REQUESTED", review: {id: "PRR_1"},
            actor: {__typename: "User", login: "lee"}
          }
        ]}
      }};

      expect(app.importers.transitions.stateEvents(context).map((event) => event.__typename)).
        toEqual(["CHANGES_REQUESTED", "ReviewDismissedEvent", "APPROVED"]);
    });
  });
});
