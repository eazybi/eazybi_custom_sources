// A top level declaration is private to its own file, so everything another file uses is a member of
// this namespace.
app.importers.helpers = {
  // The member of the rows that have no value for a dimension — a report can select it instead of losing
  // the rows. One reserved id is enough because these dimensions store the source system id in their id
  // column.
  NONE_ID: -1,
  NONE_MEMBER_NAME: "(none)",
  NO_AUTHOR_NAME: "(no author)",
  NO_ASSIGNEE_NAME: "(no assignee)",
  NO_REVIEWER_NAME: "(no reviewer)",
  NO_REVIEW_STATE_NAME: "(no state)",

  // eazyBI prefixes the stored source name with the application type (custom_github comment) and scopes
  // every measures table write and condition by it — a delete without the source name matches nothing.
  MEASURES_SOURCE_NAMES: {
    pull_requests: "pull request",
    pr_comment: "comment",
    pr_commit: "commit",
    pr_transition: "transition"
  },

  // Raw UTC, while the time_id of the same row is in the Time dimension time zone — a date built from
  // this timestamp can differ a day from the Time member the row is counted in (see the README).
  timestamp(dateOrString) {
    if (!dateOrString) return null;

    var date = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
    return Math.floor(date.getTime() / 1000);
  },

  // The date of a value GitHub answers as a date without a time — a milestone due date arrives as midnight
  // UTC, and dwh.dateValue would convert it into the Time dimension time zone and give the previous day in
  // a time zone behind UTC. Stored as the date it is written as, like dwh.lookupDateId looks it up.
  dateOnly(dateString) {
    if (!dateString) return null;

    return String(dateString).substring(0, 10);
  },

  daysBetween(fromDate, toDate) {
    if (!fromDate || !toDate) return null;

    return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000 * 1000000) / 1000000;
  },

  capitalize(value) {
    if (!value) return null;

    return value.charAt(0).toUpperCase() + value.substring(1).toLowerCase();
  },

  titleize(value) {
    if (!value) return null;

    return value.split("_").map((word) => this.capitalize(word)).join(" ");
  }
};
