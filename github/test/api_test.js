describe("app.api", () => {
  // The manifest auth block builds the header from the secret source param, which the JavaScript can
  // never read itself — the request headers are the only place where it is visible.
  test("sends the API token source param as a bearer token", () => {
    mock.sourceParams({api_token: "secret-token"});
    mock.get("/user", {json: {id: 11, login: "kim"}});
    mock.graphql({query: "ViewerFields", json: {data: {viewer: {login: "kim"}}}});

    app.api.testConnection();

    expect(mock.requests()[0].headers["Authorization"]).toBe("Bearer secret-token");
  });

  describe("testConnection", () => {
    // The returned connection attributes are what the Source Data tab displays as the importing account.
    test("returns the account of a token that reads the account fields", () => {
      mock.get("/user", {json: {id: 11, login: "kim", name: "Kim Lee"}});
      mock.graphql({query: "ViewerFields", json: {data: {viewer: {login: "kim"}}}});

      expect(app.api.testConnection()).toEqual({authentication: {user: "Kim Lee (kim)"}});
    });

    test("returns an account without a display name by its login", () => {
      mock.get("/user", {json: {id: 11, login: "kim"}});
      mock.graphql({query: "ViewerFields", json: {data: {viewer: {login: "kim"}}}});

      expect(app.api.testConnection()).toEqual({authentication: {user: "kim"}});
    });

    test("reports a rejected token on the token field", () => {
      mock.get("/user", {status: 401, json: {message: "Bad credentials"}});

      expect(app.api.testConnection()).toEqual({
        errors: [{field: "api_token", message: "GitHub did not accept the API token"}]
      });
    });

    // The token scope that the account email needs is missing more often than the token itself is wrong,
    // and GitHub answers that with HTTP 200 and an errors array.
    test("reports a GraphQL error of a token without the account scopes", () => {
      mock.get("/user", {json: {id: 11, login: "kim"}});
      mock.graphql({query: "ViewerFields", json: {errors: [{message: "Resource not accessible"}]}});

      expect(app.api.testConnection()).toEqual({
        errors: [{field: "api_token", message: "GitHub rejected a GraphQL request: Resource not accessible"}]
      });
    });

    // A fine-grained token, or one that an organization did not authorize for SSO, passes the REST request
    // and is still refused by the GraphQL endpoint — which ignoreErrors answers with null, not with errors.
    test("reports a token that the GraphQL endpoint refuses with an HTTP error", () => {
      mock.get("/user", {json: {id: 11, login: "kim"}});
      mock.graphql({query: "ViewerFields", status: 401, json: {message: "Bad credentials"}});

      var result = app.api.testConnection();

      expect(result.authentication).toBeUndefined();
      expect(result.errors[0].field).toBe("api_token");
      expect(result.errors[0].message).toContain("GraphQL");
    });
  });

  describe("getSourceSelections", () => {
    test("offers all repositories, every owner and every repository", () => {
      mock.get("/user/repos", {fixture: "repositories"});

      var selections = app.api.getSourceSelections();

      expect(selections.multiple).toBe(true);
      expect(selections.options).toEqual([
        {key: "all", name: "(all repositories)"},
        {key: "owner/11", name: "acme (all repositories)"},
        {key: "owner/21", name: "dana (all repositories)"},
        {key: "101", name: "acme/app"},
        {key: "102", name: "acme/tools"},
        {key: "201", name: "dana/notes"}
      ]);
    });
  });

  describe("getPullRequests", () => {
    function mockPullRequestPages() {
      mock.graphql({query: "PullRequests", variables: {first: 25}, fixture: "pull_requests_page1"});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, fixture: "pull_requests_page2"});
    }

    test("yields the pull requests of the repository page by page", () => {
      mockPullRequestPages();
      var pageNumbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pageNumbers.push(pullRequests.map((pullRequest) => pullRequest.number));
        return null;
      });

      expect(pageNumbers).toEqual([[13], [12]]);
    });

    test("stops paging when the callback returns stop", () => {
      mockPullRequestPages();
      var pageNumbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pageNumbers.push(pullRequests.map((pullRequest) => pullRequest.number));
        return "stop";
      });

      expect(pageNumbers).toEqual([[13]]);
    });

    test("reads a nested connection that the page truncated again on its own", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests_truncated"});
      mock.graphql({query: "PullRequestConnection", fixture: "pull_request_reviews"});
      var reviewStates = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => {
          pullRequest.reviews.nodes.forEach((review) => reviewStates.push(review.state));
        });
        return null;
      });

      expect(reviewStates).toEqual(["COMMENTED", "CHANGES_REQUESTED", "APPROVED"]);
    });

    // The timeline is verified with filteredCount, so the truncation of an open pull request is
    // detected too.
    test("reads the truncated timeline of an open pull request again on its own", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests_truncated"});
      mock.graphql({query: ["PullRequestConnection", "reviews"], fixture: "pull_request_reviews"});
      mock.graphql({query: ["PullRequestConnection", "timelineItems"],
        fixture: "pull_request_timeline_items"});
      var eventTypes = [];

      app.api.getPullRequests("acme/app", {importChanges: true}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => {
          pullRequest.timelineItems.nodes.forEach((node) => eventTypes.push(node.__typename));
        });
        return null;
      });

      expect(eventTypes).toEqual(["AssignedEvent", "UnassignedEvent", "ReopenedEvent"]);
    });

    test("warns about a connection that stays short after it was read again", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests_truncated"});
      mock.graphql({query: ["PullRequestConnection", "reviews"], json: {data: {repository: {pullRequest: {
        reviews: {nodes: [{id: "R1", state: "APPROVED"}], pageInfo: {hasNextPage: false, endCursor: null}}
      }}}}});

      app.api.getPullRequests("acme/app", {}, () => null);

      expect(importRun.warnings()[0].key).toBe("pull request/5003");
      expect(importRun.warnings()[0].message).toContain("1 of the 3 reviews");
      expect(importRun.warnings()[0].message).toContain("acme/app#20");
    });

    // GitHub answers a union member with the fields its own inline fragment asks for and nothing else, so
    // a requested reviewer of a type the fragment does not name arrives with no login and is dropped —
    // a review bot that has not submitted its review yet would be invisible.
    test("asks for the fields of every kind of requested reviewer", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests"});

      app.api.getPullRequests("acme/app", {}, () => null);

      var body = mock.requests()[0].body;

      // With the account id the account dimensions are keyed by, so that a reviewer who has only been
      // requested is the same member as the one who submits a review.
      expect(body).toContain("... on Bot { databaseId login }");
      expect(body).toContain("... on Mannequin { databaseId login name email }");
      // A team has no account of its own and is keyed by its team URL path — see namedReviewer.
      expect(body).toContain("... on EnterpriseTeam { name combinedSlug }");
    });

    test("clears the warning of a pull request whose page connections are complete", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests"});
      var clearOld = mock.spyOn(source.warnings, "clearOld");

      app.api.getPullRequests("acme/app", {}, () => null);

      expect(clearOld.mock.calls).toEqual([["pull request/5002"], ["pull request/5001"]]);
    });

    // A mannequin is the placeholder account of an author who has not claimed a migrated repository, and
    // it carries a name and an email like a user does — an actor not asked for them would write the same
    // dimension member with its login and no email.
    test("asks for the name and the email of a mannequin actor", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests"});

      app.api.getPullRequests("acme/app", {}, () => null);

      expect(mock.requests()[0].body).toContain("... on Mannequin { databaseId name email }");
    });

    test("requests the timeline items only with the state transitions option", () => {
      mock.graphql({query: "PullRequests", fixture: "pull_requests"});

      app.api.getPullRequests("acme/app", {importChanges: false}, () => null);

      expect(mock.requests()[0].body).not.toContain("timelineItems");
    });

    test("reads a page that GitHub failed again with a smaller page size", () => {
      // The reduced page size of a repository lives as long as the import that reduced it.
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", variables: {first: 25}, status: 502, body: "502 Bad Gateway"});
      mock.graphql({query: "PullRequests", variables: {first: 12}, fixture: "pull_requests_page1"});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, fixture: "pull_requests_page2"});
      var pageNumbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pageNumbers.push(pullRequests.map((pullRequest) => pullRequest.number));
        return null;
      });

      expect(pageNumbers).toEqual([[13], [12]]);
    });

    test("waits for the rate limit to reset instead of asking for a smaller page", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", responses: [
        {json: {errors: [{type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1."}]}},
        {fixture: "pull_requests"}
      ]});
      mock.graphql({query: "RateLimit",
        json: {data: {rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"}}}});
      var numbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => numbers.push(pullRequest.number));
        return null;
      });

      expect(numbers).toEqual([13, 12]);
      expect(app.api.pullRequestsPageSizes["acme/app"]).toBeUndefined();
      expect(importRun.log().join("\n")).toContain("rate limit");
    });

    test("waits for a rate limit that GitHub answered with HTTP 403", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", responses: [
        {status: 403, json: {message: "You have exceeded a secondary rate limit."}},
        {fixture: "pull_requests"}
      ]});
      mock.graphql({query: "RateLimit",
        json: {data: {rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"}}}});
      var numbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => numbers.push(pullRequest.number));
        return null;
      });

      expect(numbers).toEqual([13, 12]);
      expect(app.api.pullRequestsPageSizes["acme/app"]).toBeUndefined();
    });

    test("polls again when GitHub refuses the rate limit query of the wait", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", responses: [
        {status: 403, json: {message: "You have exceeded a secondary rate limit."}},
        {fixture: "pull_requests"}
      ]});
      mock.graphql({query: "RateLimit", responses: [
        {status: 403, json: {message: "You have exceeded a secondary rate limit."}},
        {json: {data: {rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"}}}}
      ]});
      var numbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => numbers.push(pullRequest.number));
        return null;
      });

      expect(numbers).toEqual([13, 12]);
      // The refused poll and the one that finds the points back.
      expect(mock.requests().filter((request) => request.body.indexOf("RateLimit") >= 0)).toHaveLength(2);
    });

    test("gives up on a rate limit query that stays refused", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", status: 403,
        json: {message: "You have exceeded a secondary rate limit."}});
      mock.graphql({query: "RateLimit", status: 403, json: {message: "Bad credentials"}});

      expect(() => app.api.getPullRequests("acme/app", {}, () => null)).toThrow("refused");
      expect(mock.requests().filter((request) => request.body.indexOf("RateLimit") >= 0)).toHaveLength(5);
    });

    test("gives up on a page still answered with a rate limit after the waits", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", status: 403,
        json: {message: "You have exceeded a secondary rate limit."}});
      mock.graphql({query: "RateLimit",
        json: {data: {rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"}}}});

      expect(() => app.api.getPullRequests("acme/app", {}, () => null)).toThrow("rate limit");
      expect(app.api.pullRequestsPageSizes["acme/app"]).toBeUndefined();
      // The first page and the page read again after each of the three waits.
      expect(mock.requests().filter((request) => request.body.indexOf("PullRequests") >= 0)).toHaveLength(4);
    });

    test("waits for the reset before a page it has no rate limit budget for", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", variables: {first: 25}, json: {data: {
        rateLimit: {cost: 10, remaining: 5, resetAt: "2026-02-01T10:00:00Z"},
        repository: {pullRequests: {
          nodes: [{fullDatabaseId: 5002, number: 13}],
          pageInfo: {hasNextPage: true, endCursor: "cursor1"}
        }}
      }}});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, json: {data: {
        rateLimit: {cost: 10, remaining: 4000, resetAt: "2026-02-01T10:00:00Z"},
        repository: {pullRequests: {
          nodes: [{fullDatabaseId: 5001, number: 12}],
          pageInfo: {hasNextPage: false, endCursor: null}
        }}
      }}});
      mock.graphql({query: "RateLimit",
        json: {data: {rateLimit: {cost: 1, remaining: 5000, resetAt: "2026-02-01T10:00:00Z"}}}});
      var numbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => numbers.push(pullRequest.number));
        return null;
      });

      expect(numbers).toEqual([13, 12]);
      // Two polls of the rate limit: the first one starts the wait, the second one finds the points back.
      expect(mock.requests().filter((request) => request.body.indexOf("RateLimit") >= 0)).toHaveLength(2);
    });

    // An HTTP 200 with an empty body arrives as a null document and not as an error.
    test("reads a page GitHub answered with an empty body again with a smaller page size", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", variables: {first: 25}, body: ""});
      mock.graphql({query: "PullRequests", variables: {first: 12}, fixture: "pull_requests_page1"});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, fixture: "pull_requests_page2"});
      var pageNumbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pageNumbers.push(pullRequests.map((pullRequest) => pullRequest.number));
        return null;
      });

      expect(pageNumbers).toEqual([[13], [12]]);
      expect(importRun.log().join("\n")).toContain("GitHub answered with an empty response body");
    });

    test("asks for the next page when an empty one reports more pages", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", variables: {first: 25}, json: {data: {repository: {pullRequests: {
        nodes: [{fullDatabaseId: 5002, number: 13}],
        pageInfo: {hasNextPage: true, endCursor: "cursor1"}
      }}}}});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, json: {data: {repository: {
        pullRequests: {nodes: [], pageInfo: {hasNextPage: true, endCursor: "cursor2"}}
      }}}});
      mock.graphql({query: "PullRequests", variables: {after: "cursor2"}, json: {data: {repository: {
        pullRequests: {
          nodes: [{fullDatabaseId: 5001, number: 12}],
          pageInfo: {hasNextPage: false, endCursor: null}
        }
      }}}});
      var numbers = [];

      app.api.getPullRequests("acme/app", {}, (pullRequests) => {
        pullRequests.forEach((pullRequest) => numbers.push(pullRequest.number));
        return null;
      });

      expect(numbers).toEqual([13, 12]);
    });

    // Asking again answers one empty page, not a repository that only answers empty ones.
    test("gives up on a repository whose pages keep coming back empty", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", responses: [1, 2, 3, 4].map((page) => ({
        json: {data: {repository: {pullRequests: {
          nodes: [], pageInfo: {hasNextPage: true, endCursor: `cursor${page}`}
        }}}}
      }))});

      expect(() => app.api.getPullRequests("acme/app", {}, () => null)).toThrow("no pull requests");
    });

    test("fails a repository whose page reports more pages with the cursor just used", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", variables: {first: 25}, json: {data: {repository: {pullRequests: {
        nodes: [{fullDatabaseId: 5002, number: 13}],
        pageInfo: {hasNextPage: true, endCursor: "cursor1"}
      }}}}});
      mock.graphql({query: "PullRequests", variables: {after: "cursor1"}, json: {data: {repository: {pullRequests: {
        nodes: [{fullDatabaseId: 5001, number: 12}],
        pageInfo: {hasNextPage: true, endCursor: "cursor1"}
      }}}}});

      expect(() => app.api.getPullRequests("acme/app", {}, () => null)).toThrow("end cursor");
    });

    // The same inconsistent answer with no cursor at all, on the first page.
    test("fails a repository whose page reports more pages without an end cursor", () => {
      app.api.resetPullRequestsPageSizes();
      mock.graphql({query: "PullRequests", json: {data: {repository: {pullRequests: {
        nodes: [{fullDatabaseId: 5002, number: 13}],
        pageInfo: {hasNextPage: true, endCursor: null}
      }}}}});

      expect(() => app.api.getPullRequests("acme/app", {}, () => null)).toThrow("end cursor");
    });
  });
});
