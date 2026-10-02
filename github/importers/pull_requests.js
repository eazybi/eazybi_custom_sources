// The Pull Request dimension member and the pull request measure rows, and the dimension ids that all
// measure groups of one pull request share.

// Lists the states in the order a pull request passes through them.
var STATE_ORDINAL = {"Open": 1, "Changes Requested": 2, "Approved": 3, "Merged": 4, "Closed": 5};
var UNKNOWN_STATE_ORDINAL = 99;

// The URL path of a requested reviewer team, which has no login and is keyed by that path. An
// organization team lives under /orgs and an enterprise team under /enterprises, and the combinedSlug of
// both names the owner and the team.
var TEAM_OWNER_PATHS = {Team: "orgs", EnterpriseTeam: "enterprises"};

// mergeable is a non-null enum, so the pull requests GitHub reports no mergeable state for arrive with
// this value and never with null — the ones it is still computing one for, and the ones it no longer
// computes one for, which is most of the merged ones.
var UNKNOWN_MERGEABLE_STATE = "UNKNOWN";

app.importers.pullRequests = {
  // Every measures table is written with this pull request as the import scope. A table of a disabled
  // import option is written with no rows, which deletes what an earlier import wrote.
  importOne(pullRequest, repository, importOptions) {
    var context = this.buildContext(pullRequest, repository);
    var sourceNames = app.importers.helpers.MEASURES_SOURCE_NAMES;
    var rowsByTable = {
      pull_requests: this.measureRows(context),
      pr_comment: app.importers.comments.rows(context),
      pr_commit: importOptions.importCommits ? app.importers.commits.rows(context) : [],
      pr_transition: importOptions.importChanges ? app.importers.transitions.rows(context) : []
    };

    Object.keys(rowsByTable).forEach((tableName) => {
      dwh.measures[tableName].importRows(rowsByTable[tableName],
        {sourceId: context.sourceId, sourceName: sourceNames[tableName]});
    });
  },

  buildContext(pullRequest, repository) {
    var context = {
      pullRequest: pullRequest,
      repository: repository,
      githubId: Number(pullRequest.fullDatabaseId),
      createdAt: pullRequest.createdAt ? new Date(pullRequest.createdAt) : null,
      state: app.importers.helpers.capitalize(pullRequest.state),
      mergeState: pullRequest.mergeable === UNKNOWN_MERGEABLE_STATE
        ? null : app.importers.helpers.titleize(pullRequest.mergeable)
    };
    // Keyed by the GitHub repository id and not by its slug, so that renaming a repository does not move
    // its pull requests into new import scopes and leave the rows of the old ones behind.
    context.sourceId = `${repository.externalId}-${context.githubId}`;
    context.pullRequestId = this.importMember(context);
    context.commonAttributes = this.commonAttributes(context);
    return context;
  },

  importMember(context) {
    var pullRequest = context.pullRequest;
    var repository = context.repository;

    return dwh.dimensions.pull_requests.createAndLookupId({github_pull_request_id: context.githubId}, {
      pull_request_number: pullRequest.number,
      pull_request_key: `#${pullRequest.number}`,
      title: `#${pullRequest.number} ${pullRequest.title || ""}`,
      repository_slug: repository.slug,
      repository_name: repository.name,
      repository_id: repository.id,
      owner_id: repository.ownerId,
      merge_commit: pullRequest.mergeCommit && pullRequest.mergeCommit.oid,
      created_at: dwh.datetimeValue(pullRequest, "createdAt"),
      closed_at: dwh.datetimeValue(pullRequest, "closedAt"),
      branch_name: pullRequest.headRefName,
      state: context.state,
      // GitHub answers a draft pull request with the plain OPEN state, so this flag is the only thing that
      // tells one from a pull request that is ready for review.
      draft: pullRequest.isDraft ? "Yes" : "No",
      milestone_name: pullRequest.milestone && pullRequest.milestone.title,
      merge_state: context.mergeState
    });
  },

  commonAttributes(context) {
    var pullRequest = context.pullRequest;

    return {
      pull_request_id: context.pullRequestId,
      repository_id: context.repository.id,
      pr_state_id: this.stateId(context.state),
      pr_merge_state_id: this.mergeStateId(context.mergeState),
      pr_author_id: app.importers.users.pullRequestAuthorId(pullRequest.author),
      milestone_id: this.milestoneId(context),
      label_bt_id: this.labelBtId(pullRequest),
      pr_assignee_bt_id: this.assigneeBtId(pullRequest),
      pr_reviewer_bt_id: this.reviewerBtId(pullRequest)
    };
  },

  stateId(stateName) {
    return dwh.dimensions.pr_states.lookupOrCreateId({name: stateName},
      {ordinal: STATE_ORDINAL[stateName] || UNKNOWN_STATE_ORDINAL});
  },

  // The pull requests GitHub reports no mergeable state for are a member of their own (see
  // UNKNOWN_MERGEABLE_STATE).
  mergeStateId(mergeStateName) {
    return dwh.dimensions.pr_merge_states.
      lookupOrCreateId({name: mergeStateName || app.importers.helpers.NONE_MEMBER_NAME});
  },

  // Keyed by the repository GitHub id — which a rename and a transfer both keep — and the milestone
  // number, which is unique only within its repository: keyed by the number alone, two repositories would
  // share one member. The node id is not stored, because GitHub is migrating its format and a stored one
  // splits the member in two; Milestone has no databaseId.
  milestoneId(context) {
    var helpers = app.importers.helpers;
    var milestone = context.pullRequest.milestone;
    if (!milestone) {
      return dwh.dimensions.milestone.
        createAndLookupId({id: helpers.NONE_ID}, {name: helpers.NONE_MEMBER_NAME});
    }

    var externalId = `${context.repository.externalId}-${milestone.number}`;

    return dwh.dimensions.milestone.createAndLookupId({external_id: externalId}, {
      milestone_number: milestone.number,
      name: milestone.title,
      repository_id: context.repository.id,
      repository_slug: context.repository.slug,
      due_date: helpers.dateOnly(milestone.dueOn),
      updated_at: dwh.datetimeValue(new Date())
    });
  },

  // Member names must be unique within a level, and repositories use the same milestone titles. GitHub
  // allows a title only once per repository, so the repository slug tells the duplicates apart.
  updateDuplicateMilestoneNames() {
    dwh.dimensions.milestone.updateDuplicateNames({nameColumn: "name", addColumn: "repository_slug"});
  },

  // Keyed by the label name, which is the member key of the dimension: a GitHub label id belongs to one
  // repository, so keying by the id would give every repository its own "bug" member with the same key.
  labelBtId(pullRequest) {
    var helpers = app.importers.helpers;
    var labels = (pullRequest.labels && pullRequest.labels.nodes) || [];
    var labelIds = labels.map((label) => dwh.dimensions.labels.createAndLookupId({name: label.name},
      {external_id: label.id, updated_at: dwh.datetimeValue(new Date())}));
    if (labelIds.length === 0) {
      // Looked up by the name and not by NONE_ID like the other missing value members, because a label
      // may be named "(none)" as well: two rows of one name are two members of one key, which a report
      // then shows as one member counting the pull requests of both.
      labelIds = [dwh.dimensions.labels.createAndLookupId({name: helpers.NONE_MEMBER_NAME}, {})];
    }

    return dwh.dimensions.labels_bt.btIdFor(labelIds);
  },

  assigneeBtId(pullRequest) {
    var assignees = (pullRequest.assignees && pullRequest.assignees.nodes) || [];
    var assigneeIds = assignees.map((assignee) => app.importers.users.assigneeId(assignee));
    if (assigneeIds.length === 0) assigneeIds = [app.importers.users.assigneeId(null)];

    return dwh.dimensions.pr_assignees_bt.btIdFor(assigneeIds);
  },

  // Both the requested reviewers and the authors of the submitted reviews are reviewers of the pull
  // request. Its own author is not, also when GitHub reports a review of their own pull request, and
  // neither is somebody who only replied in one of its review threads, see isReview of the comments
  // importer.
  reviewerBtId(pullRequest) {
    var requestedReviewers = ((pullRequest.reviewRequests && pullRequest.reviewRequests.nodes) || []).
      map((reviewRequest) => reviewRequest.requestedReviewer);
    var reviewAuthors = ((pullRequest.reviews && pullRequest.reviews.nodes) || []).
      filter((review) => review.submittedAt && app.importers.comments.isReview(review)).
      map((review) => review.author);
    var authorLogin = pullRequest.author && pullRequest.author.login;
    var reviewerLogins = [];
    var reviewerIds = [];

    requestedReviewers.concat(reviewAuthors).forEach((reviewer) => {
      var namedReviewer = reviewer && this.namedReviewer(reviewer);
      if (!namedReviewer || namedReviewer.login === authorLogin) return;
      if (reviewerLogins.indexOf(namedReviewer.login) >= 0) return;

      reviewerLogins.push(namedReviewer.login);
      reviewerIds.push(app.importers.users.reviewerId(namedReviewer));
    });

    if (reviewerIds.length === 0) reviewerIds = [app.importers.users.reviewerId(null)];

    return dwh.dimensions.pr_reviewers_bt.btIdFor(reviewerIds);
  },

  // A requested reviewer can be a team, which has no login. It is keyed by its team URL path, so that it
  // becomes a member of its own with a working source link. A team type this does not know is dropped
  // rather than keyed by a path GitHub does not answer.
  namedReviewer(reviewer) {
    if (reviewer.login) return reviewer;

    var ownerPath = TEAM_OWNER_PATHS[reviewer.__typename];
    if (!ownerPath || !reviewer.combinedSlug) return null;

    var parts = String(reviewer.combinedSlug).split("/");
    return {
      __typename: reviewer.__typename,
      name: reviewer.name,
      login: `${ownerPath}/${parts[0]}/teams/${parts.slice(1).join("/")}`
    };
  },

  measureRows(context) {
    var pullRequest = context.pullRequest;
    var rows = [];
    // The pull request diff stats are the deduplicated base to head totals of the pull request overview,
    // so they belong on the closed row — its final state — and on the created row of an open one.
    var diffStats = {
      changed_files_count: pullRequest.changedFiles,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions
    };

    if (pullRequest.closedAt) {
      rows.push(this.createdRow(context));
      rows.push(Object.assign(this.closedRow(context), diffStats));
    } else {
      rows.push(Object.assign(this.createdRow(context), diffStats));
      rows.push({pull_request_due: 1});
    }

    var milestoneDueOn = pullRequest.milestone && pullRequest.milestone.dueOn;
    if (milestoneDueOn) {
      rows.push({
        time_id: dwh.lookupDateId(milestoneDueOn, "milestone due date"),
        pull_request_with_milestone_due_date: 1
      });
    }

    return rows.map((row) => Object.assign({}, context.commonAttributes, row));
  },

  createdRow(context) {
    return {
      time_id: dwh.lookupTimeId(context.pullRequest, "createdAt"),
      pull_request_created: 1
    };
  },

  closedRow(context) {
    var pullRequest = context.pullRequest;

    return {
      time_id: dwh.lookupTimeId(pullRequest, "closedAt"),
      pull_request_closed: 1,
      commits_closed: pullRequest.commits && pullRequest.commits.totalCount,
      total_closing_days: app.importers.helpers.daysBetween(context.createdAt, new Date(pullRequest.closedAt))
    };
  }
};
