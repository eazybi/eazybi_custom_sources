// Repositories come from the REST API; everything about a pull request from one GraphQL query with its
// nested connections.

// GitHub caps first: at 100 per connection and limits the total node count of one query, so a pull request
// page stays small — each of its pull requests carries several nested connections.
// https://docs.github.com/en/graphql/overview/resource-limitations
var PULL_REQUESTS_PAGE_SIZE = 25;
// A page of a repository whose pull requests carry long discussions is answered with HTTP 502 or with a
// cut response stream, so a failed page is read again with half the pull requests in it, down to one.
var MIN_PULL_REQUESTS_PAGE_SIZE = 1;
// Deliberately smaller than CONNECTION_PAGE_SIZE: requested once per pull request of the page, these
// connections are what makes a page too heavy to answer, and a connection that came back short is read
// again on its own anyway (see completeConnections).
var PAGE_CONNECTION_PAGE_SIZE = 20;
// One connection read on its own, therefore not part of the node count of a pull requests page.
var CONNECTION_PAGE_SIZE = 50;
// The connections that are never paged have no totalCount in the page query, so a truncation of them
// would not be recognized — they stay generous.
var WIDE_CONNECTION_PAGE_SIZE = 100;
// GitHub can answer a page with no pull requests while reporting more; ending the repository there would
// store its incremental mark as if it had been read to the end.
var MAX_EMPTY_PAGES = 3;
// Repositories whose pull request counts are asked for in one query.
var PULL_REQUEST_COUNTS_CHUNK_SIZE = 25;
var COUNTS_ALIAS_PREFIX = 'repository';

// A page is not asked for unless this many times the cost of the last one is left — the connection
// repairs of the page need budget too — and never below the floor.
var RATE_LIMIT_PAGE_COSTS = 3;
var RATE_LIMIT_MIN_REMAINING = 20;
// A rate limit resets within the hour, and the query asking for what is left costs nothing of it.
var RATE_LIMIT_POLL_INTERVAL_SECONDS = 30;
var RATE_LIMIT_MAX_POLL_INTERVAL_SECONDS = 300;
// Below the max_wait_seconds advanced setting (an hour by default) which bounds one source.waitFor call:
// a longer timeout is never reached and the host error names that setting instead of the GitHub limit.
var RATE_LIMIT_WAIT_TIMEOUT_SECONDS = 3540;
// The wait ends when the points are back, so a page still answered with a rate limit after this many
// waits is not something waiting longer fixes.
var MAX_RATE_LIMIT_WAITS = 3;
// The secondary rate limit refuses the rate limit query for a minute or two; a token that lost its
// access is refused for good. The wait gives up after this many refused polls instead of holding the
// repository for the whole timeout.
var MAX_REFUSED_RATE_LIMIT_POLLS = 5;
var RATE_LIMIT_QUERY = "query RateLimit { rateLimit { cost remaining resetAt } }";

// databaseId and not the global node id, whose format changes under the account (see importers/users.js).
// It is a field of each actor type and not of the Actor interface, which is why every type asks for it —
// EnterpriseUserAccount is the one actor type that has none. An organization is not asked for its name
// and email: no report reads them, and GitHub rejects a whole query over a field the token may not read
// (see testConnection).
var ACTOR_FIELDS = "__typename login ... on User { databaseId name email }" +
  " ... on Bot { databaseId } ... on Mannequin { databaseId name email }" +
  " ... on Organization { databaseId }";
var USER_FIELDS = "__typename databaseId login name email";
var TIMELINE_ITEM_TYPES = "CLOSED_EVENT, MERGED_EVENT, REOPENED_EVENT, ASSIGNED_EVENT," +
  " UNASSIGNED_EVENT, REVIEW_DISMISSED_EVENT";

app.api = {
  testConnection() {
    var user = source.getDocument("/user", {ignoreErrors: [401, 403]});
    if (!user || !user.login) {
      return {errors: [{field: "api_token", message: "GitHub did not accept the API token"}]};
    }

    // GitHub rejects a whole GraphQL query when the token may not read one of its fields. Probed with the
    // same account fields the import requests, so that a missing token scope is reported on the connection
    // form instead of failing the first import.
    var response = source.graphql(`query ViewerFields { viewer { ${USER_FIELDS} } }`, {ignoreErrors: true});
    // A missing permission arrives as the errors array of an HTTP 200 response, a refused request as null.
    var error = response && response.errors && response.errors[0];
    if (error || !response || !response.data) {
      var reason = error ? error.message : "the token may not read the GraphQL API";
      return {errors: [{field: "api_token", message: `GitHub rejected a GraphQL request: ${reason}`}]};
    }

    // Shown in the source selection column of the Source Data tab — every import reads exactly what this
    // account can read.
    return {authentication: {user: user.name ? `${user.name} (${user.login})` : user.login}};
  },

  getSourceSelections() {
    var repositories = this.getRepositories();
    var options = [{key: "all", name: "(all repositories)"}];

    this.repositoryOwners(repositories).forEach((owner) => {
      options.push({key: `owner/${owner.id}`, name: `${owner.login} (all repositories)`});
    });
    repositories.forEach((repository) => {
      options.push({key: String(repository.id), name: repository.full_name});
    });

    return {
      label: "Select repositories",
      hint: "The repositories the API token user owns or collaborates on. Selecting an owner imports all" +
        " repositories of that owner, including the ones added later.",
      multiple: true,
      options: options
    };
  },

  getRepositories() {
    var repositories = [];
    source.getAllPaginatedDocuments("/user/repos", {
      pagination: "nextUrl",
      limit: WIDE_CONNECTION_PAGE_SIZE,
      limitKey: "per_page",
      requestParams: {affiliation: "owner,collaborator,organization_member", sort: "full_name"}
    }, (batch) => {
      batch.forEach((repository) => repositories.push(repository));
    });
    return repositories;
  },

  // A repository the token may not read any more answers 403 and a deleted one 404 — neither is worth
  // failing an import for. By id and not by slug, because a renamed repository no longer carries the slug
  // the account imported it under.
  getRepository(externalId) {
    return source.getDocument(`/repositories/${externalId}`, {ignoreErrors: [403, 404]});
  },

  repositoryOwners(repositories) {
    var ownersById = {};
    repositories.forEach((repository) => {
      var owner = repository.owner;
      if (owner && !ownersById[owner.id]) ownersById[owner.id] = owner;
    });
    return _.sortBy(_.values(ownersById), (owner) => String(owner.login).toLowerCase());
  },

  // The counts weigh the progress of the import and nothing else, so no count is worth failing an
  // import — a single repository the token may not read would otherwise take the counts of every
  // repository of its query with it.
  getPullRequestCounts(repositorySlugs) {
    var counts = {};

    for (let index = 0; index < repositorySlugs.length; index += PULL_REQUEST_COUNTS_CHUNK_SIZE) {
      let chunk = repositorySlugs.slice(index, index + PULL_REQUEST_COUNTS_CHUNK_SIZE);
      try {
        this.addPullRequestCounts(counts, chunk);
      } catch (error) {
        // A canceled import raises the same way a failed request does and still has to stop.
        source.checkCanceling();
        logger.warn(`getPullRequestCounts GitHub did not answer the pull request counts of` +
          ` ${chunk.length} repositories, their progress is counted per repository: ${error.message}`);
      }
    }

    return counts;
  },

  addPullRequestCounts(counts, repositorySlugs) {
    var document = source.graphql(this.pullRequestCountsQuery(repositorySlugs), {ignoreErrors: true});
    var data = document ? document.data : null;
    var errors = document ? document.errors : null;
    if (errors && errors.length > 0) {
      logger.warn("addPullRequestCounts GitHub did not answer every pull request count, the progress of" +
        ` the repositories without one is counted per repository. First of ${errors.length}` +
        ` errors: ${errors[0].message}`);
    }

    repositorySlugs.forEach((repositorySlug, index) => {
      var repository = data ? data[`${COUNTS_ALIAS_PREFIX}${index}`] : null;
      var count = repository && repository.pullRequests ? repository.pullRequests.totalCount : null;
      if (typeof count === 'number') counts[repositorySlug] = count;
    });
  },

  // One aliased repository field per repository, so a chunk of counts costs one request.
  pullRequestCountsQuery(repositorySlugs) {
    var repositoryFields = repositorySlugs.map((repositorySlug, index) => {
      var ownerAndName = this.ownerAndName(repositorySlug);
      // The owner and the name as JSON string literals, so that a name with a quote in it cannot end
      // the literal and change the query.
      return `${COUNTS_ALIAS_PREFIX}${index}: repository(owner: ${JSON.stringify(ownerAndName.owner)},` +
        ` name: ${JSON.stringify(ownerAndName.name)}) { pullRequests { totalCount } }`;
    });

    return `query GithubPullRequestCounts { ${repositoryFields.join(' ')} }`;
  },

  // The page size a repository was last read with, kept for the whole import: a repository whose pages
  // GitHub stopped answering does not answer the original size when it is read again at the end of the
  // import either (see importer.retryFailedRepositories). Reset by importAll.
  pullRequestsPageSizes: {},

  resetPullRequestsPageSizes() {
    this.pullRequestsPageSizes = {};
  },

  // The pull requests of one repository, newest updated first, yielded page by page; the callback returns
  // "stop" to end the pagination. Every nested connection of a yielded pull request is complete — see
  // completeConnections. Paged here and not with source.getAllGraphqlPages, which cannot resume a failed
  // page and would lose the pages already read.
  getPullRequests(repositorySlug, options, pageCallback) {
    var reader = {
      slug: repositorySlug,
      query: this.pullRequestsQuery(options),
      ownerAndName: this.ownerAndName(repositorySlug),
      pageSize: this.pullRequestsPageSizes[repositorySlug] || PULL_REQUESTS_PAGE_SIZE,
      readCount: 0,
      rateLimitWaits: 0,
      emptyPages: 0
    };
    var cursor = null;

    for (;;) {
      let connection = this.readPullRequestsPage(reader, cursor);
      let pullRequests = connection.nodes || [];
      let pageInfo = connection.pageInfo || {};
      // The end cursor of the page just read would request the same page again, forever.
      let nextCursor = pageInfo.hasNextPage === true && pageInfo.endCursor !== cursor
        ? pageInfo.endCursor : null;

      if (pullRequests.length > 0) {
        reader.emptyPages = 0;
        pullRequests.forEach((pullRequest) => this.completeConnections(repositorySlug, pullRequest, options));
        reader.readCount += pullRequests.length;
        if (pageCallback(pullRequests) === "stop") return;
      } else if (nextCursor) {
        reader.emptyPages++;
        if (reader.emptyPages >= MAX_EMPTY_PAGES) {
          throw new Error(`GitHub answered ${reader.emptyPages} pages of ${reader.slug} with no pull` +
            ` requests after ${reader.readCount} of them were read, and reports more pages`);
        }
      }

      if (!nextCursor) {
        // Ending the repository on an unusable cursor would advance its incremental mark past the
        // pull requests of the reported pages.
        if (pageInfo.hasNextPage === true) {
          throw new Error(`GitHub reports more pages of ${reader.slug} after ${reader.readCount} pull` +
            " requests were read, but answered without a usable end cursor to request them with");
        }
        return;
      }

      cursor = nextCursor;
      this.waitForRateLimitBudget(reader);
    }
  },

  // Waiting for the reset keeps the import going; asking without the points to spend fails this
  // repository and every one after it until the hour is over.
  waitForRateLimitBudget(reader) {
    var rateLimit = reader.rateLimit;
    if (!rateLimit || typeof rateLimit.remaining !== "number") return;

    var needed = Math.max((rateLimit.cost || 1) * RATE_LIMIT_PAGE_COSTS, RATE_LIMIT_MIN_REMAINING);
    if (rateLimit.remaining >= needed) return;

    logger.warn(`getPullRequests the GitHub rate limit has ${rateLimit.remaining} points left and resets` +
      ` at ${rateLimit.resetAt} — waiting for the reset before the next page of ${reader.slug}`);
    this.waitForRateLimitReset(reader.slug);
  },

  // The first poll only starts the wait: GitHub also limits the rate of the requests and refuses that one
  // while the points are untouched, so a page is never read again before an interval has passed.
  waitForRateLimitReset(repositorySlug) {
    var polls = 0;
    var refusedPolls = 0;

    source.waitFor(() => {
      var rateLimit = this.readRateLimit();
      polls++;

      if (!rateLimit) {
        refusedPolls++;
        if (refusedPolls >= MAX_REFUSED_RATE_LIMIT_POLLS) {
          throw new Error(`GitHub refused the rate limit query of ${repositorySlug} ${refusedPolls}` +
            " times in a row, the API token may have lost its access to the GraphQL API");
        }

        return null;
      }

      refusedPolls = 0;

      return polls > 1 && rateLimit.remaining >= RATE_LIMIT_MIN_REMAINING ? rateLimit : null;
    }, {
      intervalSeconds: RATE_LIMIT_POLL_INTERVAL_SECONDS,
      maxIntervalSeconds: RATE_LIMIT_MAX_POLL_INTERVAL_SECONDS,
      timeoutSeconds: RATE_LIMIT_WAIT_TIMEOUT_SECONDS,
      message: `Waiting for the GitHub rate limit to reset before reading ${repositorySlug}`
    });
  },

  // The limit being waited for refuses this poll as well, and a refused poll must not end the wait.
  readRateLimit() {
    var document = source.graphql(RATE_LIMIT_QUERY, {ignoreErrors: true});

    return document && document.data ? document.data.rateLimit : null;
  },

  // A failed page says nothing about which pull request GitHub could not read, so it is read again with
  // half the pull requests in it, down to one.
  readPullRequestsPage(reader, cursor) {
    for (;;) {
      try {
        var connection = this.pullRequestsConnection(reader, cursor);
        // The cap counts the waits of one page: a page GitHub answered spent none of them.
        reader.rateLimitWaits = 0;
        return connection;
      } catch (error) {
        // A canceled import raises the same way a failed request does.
        source.checkCanceling();

        // A rate limit is no page too heavy: the points are gone for the whole token, so every smaller
        // page is answered with the same error.
        if (this.rateLimitError(error)) {
          if (reader.rateLimitWaits >= MAX_RATE_LIMIT_WAITS) {
            throw new Error(`GitHub answered a page of ${reader.slug} with a rate limit after` +
              ` ${reader.readCount} pull requests were read and ${MAX_RATE_LIMIT_WAITS} waits for it to` +
              ` reset: ${error.message}`);
          }

          reader.rateLimitWaits++;
          logger.warn(`getPullRequests GitHub answered a page of ${reader.slug} after` +
            ` ${reader.readCount} pull requests were read with a rate limit, waiting for it to reset:` +
            ` ${error.message}`);
          this.waitForRateLimitReset(reader.slug);
          continue;
        }

        if (reader.pageSize <= MIN_PULL_REQUESTS_PAGE_SIZE) {
          throw new Error(`GitHub did not answer one pull request of ${reader.slug} after` +
            ` ${reader.readCount} of them were read: ${error.message}`);
        }
        reader.pageSize = Math.max(MIN_PULL_REQUESTS_PAGE_SIZE, Math.floor(reader.pageSize / 2));
        this.pullRequestsPageSizes[reader.slug] = reader.pageSize;
        logger.warn(`getPullRequests GitHub did not answer a page of ${reader.slug} after` +
          ` ${reader.readCount} pull requests were read, reading it again with ${reader.pageSize}` +
          ` pull requests per page: ${error.message}`);
      }
    }
  },

  // A raised request reaches the JavaScript as an Error with a message and nothing else, so the message
  // is all a rate limit can be recognized by. GitHub reports the limit on the points a query costs as a
  // GraphQL error and the limit on the rate of the requests as HTTP 403 or 429, whose body eazyBI drops —
  // a 403 the token earned itself is therefore waited on too.
  rateLimitError(error) {
    var message = (error && error.message) || "";

    return /rate limit/i.test(message) || /Received HTTP (403|429) error/.test(message);
  },

  // GitHub also answers a page it could not read with an empty HTTP 200 body or with a 200 that carries
  // neither the connection nor a GraphQL error; both look like an answer and are raised as the failed
  // page they are.
  pullRequestsConnection(reader, cursor) {
    var variables = {owner: reader.ownerAndName.owner, name: reader.ownerAndName.name, first: reader.pageSize};
    if (cursor) variables.after = cursor;

    var document = source.graphql(reader.query, {variables: variables});
    if (!document) throw new Error("GitHub answered with an empty response body");

    var data = document.data;
    reader.rateLimit = data && data.rateLimit;
    var connection = data && data.repository ? data.repository.pullRequests : null;
    if (!connection) throw new Error("the response carries no repository.pullRequests connection");

    return connection;
  },

  // GitHub truncates the nested connections of a pull request page and still answers with
  // hasNextPage: false and without a GraphQL error — the response looks complete while its nodes are
  // missing. Every connection is therefore verified and an incomplete one is read again on its own, where
  // the query of a single pull request is small enough not to be truncated.
  completeConnections(repositorySlug, pullRequest, options) {
    var connectionNames = ["reviews", "comments"];
    if (options.importCommits) connectionNames.push("commits");
    if (options.importChanges) connectionNames.push("timelineItems");
    // Keyed by the pull request id, which a repository rename does not change — a warning left under the
    // old slug would never be cleared again.
    var warningKey = `pull request/${pullRequest.fullDatabaseId}`;
    var stayedIncomplete = false;

    connectionNames.forEach((connectionName) => {
      let connection = pullRequest[connectionName];
      if (!connection) return;

      // A connection without a count cannot be verified and is read again to be sure.
      let nodeCount = this.connectionNodeCount(connectionName, connection);
      if (nodeCount !== null && (connection.nodes || []).length >= nodeCount) return;

      connection.nodes = this.getPullRequestConnection(repositorySlug, pullRequest.number, connectionName);
      if (nodeCount === null || connection.nodes.length >= nodeCount) return;

      // The pull request is imported with what came back and the repository advances its incremental
      // mark, so the account is told about the measures it may not trust.
      stayedIncomplete = true;
      source.warnings.add(warningKey, `GitHub answered ${connection.nodes.length} of the ${nodeCount}` +
        ` ${connectionName} of the pull request ${repositorySlug}#${pullRequest.number}. Its measures of` +
        " them stay incomplete until the pull request is updated or the account is reimported.");
    });

    // Clears the warning an earlier import left once the connections were read in full; clearing a key
    // that carries no warning is an in memory no-op.
    if (!stayedIncomplete) source.warnings.clearOld(warningKey);
  },

  // totalCount of the reviews, comments and commits counts exactly the nodes they return, while
  // timelineItems counts its whole unfiltered timeline there and answers the count of the item types it
  // was asked for as filteredCount.
  connectionNodeCount(connectionName, connection) {
    var nodeCount = connectionName === "timelineItems" ? connection.filteredCount : connection.totalCount;

    return typeof nodeCount === "number" ? nodeCount : null;
  },

  getPullRequestConnection(repositorySlug, pullRequestNumber, connectionName) {
    var ownerAndName = this.ownerAndName(repositorySlug);
    var nodes = [];

    source.getAllGraphqlPages(this.pullRequestConnectionQuery(connectionName), {
      connectionPath: `repository.pullRequest.${connectionName}`,
      variables: {owner: ownerAndName.owner, name: ownerAndName.name, number: pullRequestNumber},
      limit: CONNECTION_PAGE_SIZE
    }, (batch) => {
      batch.forEach((node) => nodes.push(node));
    });
    return nodes;
  },

  // A repository slug is owner/name, and a name may not contain a slash.
  ownerAndName(repositorySlug) {
    var parts = String(repositorySlug).split("/");
    return {owner: parts[0], name: parts.slice(1).join("/")};
  },

  pullRequestsQuery(options) {
    return `query PullRequests($owner: String!, $name: String!, $first: Int!, $after: String) {
      rateLimit { cost remaining resetAt }
      repository(owner: $owner, name: $name) {
        pullRequests(first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { ${this.pullRequestFields(options)} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`;
  },

  pullRequestConnectionQuery(connectionName) {
    var connectionArguments = connectionName === "timelineItems"
      ? `itemTypes: [${TIMELINE_ITEM_TYPES}], first: $first, after: $after`
      : "first: $first, after: $after";

    return `query PullRequestConnection($owner: String!, $name: String!, $number: Int!,
        $first: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          ${connectionName}(${connectionArguments}) {
            nodes { ${this.connectionNodeFields(connectionName)} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }`;
  },

  pullRequestFields(options) {
    // Without the commits import only the commit count of a closed pull request is imported.
    var commits = options.importCommits
      ? this.pagedConnectionField("commits")
      : "commits(first: 1) { totalCount }";
    var timelineItems = options.importChanges
      ? `timelineItems(itemTypes: [${TIMELINE_ITEM_TYPES}], first: ${PAGE_CONNECTION_PAGE_SIZE}) {
           filteredCount
           nodes { ${this.connectionNodeFields("timelineItems")} }
         }`
      : "";

    return `
      fullDatabaseId number createdAt closedAt updatedAt state isDraft title headRefName
      mergeable changedFiles additions deletions
      mergeCommit { oid }
      author { ${ACTOR_FIELDS} }
      milestone { number title dueOn }
      labels(first: ${WIDE_CONNECTION_PAGE_SIZE}) { nodes { id name } }
      assignees(first: ${WIDE_CONNECTION_PAGE_SIZE}) { nodes { ${USER_FIELDS} } }
      reviewRequests(first: ${WIDE_CONNECTION_PAGE_SIZE}) {
        nodes { requestedReviewer {
          __typename
          ... on User { databaseId login name email }
          ... on Mannequin { databaseId login name email }
          ... on Bot { databaseId login }
          ... on Team { name combinedSlug }
          ... on EnterpriseTeam { name combinedSlug }
        } }
      }
      ${this.pagedConnectionField("reviews")}
      ${this.pagedConnectionField("comments")}
      ${commits}
      ${timelineItems}
    `;
  },

  pagedConnectionField(connectionName) {
    return `${connectionName}(first: ${PAGE_CONNECTION_PAGE_SIZE}) {
      totalCount
      nodes { ${this.connectionNodeFields(connectionName)} }
    }`;
  },

  connectionNodeFields(connectionName) {
    switch (connectionName) {
    case "reviews":
      // The id identifies the review a ReviewDismissedEvent of the timeline dismissed. The first comment
      // tells a submitted review from the reply in a review thread GitHub answers as one, see isReview of
      // the comments importer.
      return `id state submittedAt body author { ${ACTOR_FIELDS} }
              comments(first: 1) { totalCount nodes { replyTo { id } } }`;
    case "comments":
      return `id createdAt author { ${ACTOR_FIELDS} }`;
    case "commits":
      return `id commit { oid additions deletions authoredDate author { user { ${USER_FIELDS} } } }`;
    case "timelineItems":
      return this.timelineItemFields();
    default:
      throw new Error(`Unknown GitHub pull request connection ${connectionName}`);
    }
  },

  timelineItemFields() {
    var stateEventFields = `createdAt actor { ${ACTOR_FIELDS} }`;
    var assigneeEventFields = `${stateEventFields} assignee { ... on User { login } }`;
    return `
      __typename
      ... on ClosedEvent { ${stateEventFields} }
      ... on MergedEvent { ${stateEventFields} }
      ... on ReopenedEvent { ${stateEventFields} }
      ... on AssignedEvent { ${assigneeEventFields} }
      ... on UnassignedEvent { ${assigneeEventFields} }
      ... on ReviewDismissedEvent { ${stateEventFields} previousReviewState review { id } }
    `;
  }
};
