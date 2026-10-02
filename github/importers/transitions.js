// The state history of a pull request as transition rows: one row leaving the previous state with the time
// spent in it, and one row entering the new state. Imported only with the "Import pull request state
// transitions" import option, which is what the historical measures are calculated from.
var STATE_EVENT_TYPES = ["ClosedEvent", "MergedEvent", "ReopenedEvent"];
var ASSIGNEE_EVENT_TYPES = ["AssignedEvent", "UnassignedEvent"];
var STATE_CHANGING_REVIEW_STATES = ["CHANGES_REQUESTED", "APPROVED"];
// The state GitHub gives a review that was dismissed, in place of the state the review itself set.
var DISMISSED_REVIEW_STATE = "DISMISSED";
var DISMISSAL_EVENT_TYPE = "ReviewDismissedEvent";
var EVENT_STATES = {
  "ClosedEvent": "Closed",
  "MergedEvent": "Merged",
  "ReopenedEvent": "Open",
  "CHANGES_REQUESTED": "Changes Requested",
  "APPROVED": "Approved"
};
var OPEN_STATE = "Open";
var TERMINAL_STATES = ["Merged", "Closed"];

app.importers.transitions = {
  rows(context) {
    return this.stateRows(context).concat(this.authorAssigneeRows(context)).
      map((row) => Object.assign({}, context.commonAttributes, row));
  },

  stateRows(context) {
    if (!context.createdAt) return [];

    var helpers = app.importers.helpers;
    var rows = [this.initialOpenRow(context)];
    var fromState = OPEN_STATE;
    var fromTime = context.createdAt;

    this.stateEvents(context).forEach((event) => {
      var toState = this.eventState(event, fromState);
      if (!toState || toState === fromState) return;

      var eventTime = new Date(event.createdAt);
      var eventAttributes = {
        time_id: dwh.lookupTimeId(event, "createdAt"),
        pr_transition_author_id: app.importers.users.transitionAuthorId(event.actor),
        transition_ts: helpers.timestamp(eventTime)
      };

      rows.push(Object.assign({}, eventAttributes, {
        pr_state_id: app.importers.pullRequests.stateId(fromState),
        transition_from: 1,
        days_in_transition_state: helpers.daysBetween(fromTime, eventTime)
      }));
      rows.push(Object.assign({}, eventAttributes, {
        pr_state_id: app.importers.pullRequests.stateId(toState),
        transition_to: 1
      }));

      fromState = toState;
      fromTime = eventTime;
    });

    return rows;
  },

  // A dismissal withdraws the verdict of its review, so the pull request waits for a review again — but
  // only while it is still in the state that review set. A later review, a merge or a close is not undone.
  // A review verdict — which GitHub accepts on a merged or closed pull request too — moves it out of
  // neither state.
  eventState(event, fromState) {
    if (event.__typename === DISMISSAL_EVENT_TYPE) {
      return event.dismissedState === fromState ? OPEN_STATE : null;
    }
    if (STATE_CHANGING_REVIEW_STATES.indexOf(event.__typename) >= 0 &&
        TERMINAL_STATES.indexOf(fromState) >= 0) return null;

    return EVENT_STATES[event.__typename];
  },

  initialOpenRow(context) {
    return {
      time_id: dwh.lookupTimeId(context.pullRequest, "createdAt"),
      pr_state_id: app.importers.pullRequests.stateId(OPEN_STATE),
      pr_transition_author_id: app.importers.users.transitionAuthorId(context.pullRequest.author),
      transition_to: 1,
      transition_ts: app.importers.helpers.timestamp(context.createdAt)
    };
  },

  stateEvents(context) {
    var pullRequest = context.pullRequest;
    var timelineEvents = ((pullRequest.timelineItems && pullRequest.timelineItems.nodes) || []).
      filter((node) => STATE_EVENT_TYPES.indexOf(node.__typename) >= 0);
    // The dismissals after the reviews, so that a dismissal of the same timestamp as the review it
    // dismisses is sorted after it — _.sortBy below is stable.
    var events = this.eventsSinceCreated(pullRequest,
      this.reviewEvents(pullRequest).concat(this.dismissalEvents(pullRequest)).concat(timelineEvents));

    return _.sortBy(this.rejectClosedAfterMerged(events), (event) => event.createdAt);
  },

  // GitHub reports events of a transferred pull request that are older than the pull request itself —
  // they would be counted in a period the pull request did not exist in.
  eventsSinceCreated(pullRequest, events) {
    if (!pullRequest.createdAt) return events;

    return events.filter((event) => event.createdAt ? event.createdAt >= pullRequest.createdAt : false);
  },

  // A dismissed review keeps the state it set and the time it submitted it: the pull request was in that
  // state until the dismissal, and dropping it would count that time in the state before it — retroactively,
  // because the rows of a pull request are replaced on every import. The dismissal itself enters no review
  // state, it only ends this one (see eventState).
  reviewEvents(pullRequest) {
    var dismissedStates = this.dismissedReviewStates(pullRequest);

    return ((pullRequest.reviews && pullRequest.reviews.nodes) || []).
      map((review) => ({
        state: review.state === DISMISSED_REVIEW_STATE ? dismissedStates[review.id] : review.state,
        review: review
      })).
      filter((event) => STATE_CHANGING_REVIEW_STATES.indexOf(event.state) >= 0 && event.review.submittedAt).
      map((event) => ({
        __typename: event.state, createdAt: event.review.submittedAt, actor: event.review.author
      }));
  },

  // GitHub replaces the state of a dismissed review with DISMISSED, so the state the review set is left
  // only in the ReviewDismissedEvent the dismissal wrote to the timeline. A review whose event a
  // truncated timeline did not return keeps no state and changes none.
  dismissedReviewStates(pullRequest) {
    var states = {};

    this.reviewDismissedEvents(pullRequest).
      forEach((node) => { states[node.review.id] = node.previousReviewState; });

    return states;
  },

  // A dismissal of a review that set no state — a comment — ends nothing and is dropped here.
  dismissalEvents(pullRequest) {
    return this.reviewDismissedEvents(pullRequest).
      map((node) => ({
        __typename: DISMISSAL_EVENT_TYPE,
        createdAt: node.createdAt,
        actor: node.actor,
        dismissedState: EVENT_STATES[node.previousReviewState]
      })).
      filter((event) => event.dismissedState);
  },

  // Only the dismissals that name the review they dismissed: the state of that review is recovered from
  // them, so a dismissal without one can neither give a review its state back nor end it.
  reviewDismissedEvents(pullRequest) {
    return ((pullRequest.timelineItems && pullRequest.timelineItems.nodes) || []).
      filter((node) => node.__typename === DISMISSAL_EVENT_TYPE && node.review);
  },

  // A merge is terminal, so the ClosedEvent that GitHub emits at or after the MergedEvent is dropped —
  // that close is the merge itself and would otherwise move the pull request out of the merged state.
  rejectClosedAfterMerged(events) {
    var mergedTimes = events.filter((event) => event.__typename === "MergedEvent").
      map((event) => event.createdAt).sort();
    if (mergedTimes.length === 0) return events;

    return events.
      filter((event) => !(event.__typename === "ClosedEvent" && event.createdAt >= mergedTimes[0]));
  },

  // Assigning the pull request to its own author and unassigning them again are imported as the author
  // transition measures — the assignments of other accounts are the Pull Request Assignee dimension.
  authorAssigneeRows(context) {
    var authorLogin = context.pullRequest.author && context.pullRequest.author.login;
    if (!authorLogin) return [];

    var timelineItems = (context.pullRequest.timelineItems && context.pullRequest.timelineItems.nodes) || [];
    return this.eventsSinceCreated(context.pullRequest, timelineItems).
      filter((node) => ASSIGNEE_EVENT_TYPES.indexOf(node.__typename) >= 0).
      filter((node) => node.assignee ? node.assignee.login === authorLogin : false).
      map((node) => {
        var assigned = node.__typename === "AssignedEvent";
        return {
          time_id: dwh.lookupTimeId(node, "createdAt"),
          pr_transition_author_id: app.importers.users.transitionAuthorId(node.actor),
          transition_ts: app.importers.helpers.timestamp(node.createdAt),
          transition_to_author: assigned ? 1 : null,
          transition_from_author: assigned ? null : 1
        };
      });
  }
};
