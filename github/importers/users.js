// A GitHub account is imported into one dimension per role it can have on a pull request, all of them with
// the same account columns.
var ACCOUNT_TABLES = ["pr_author", "pr_assignees", "pr_reviewers", "pr_comment_authors"];

app.importers.users = {
  pullRequestAuthorId(user) {
    return this.accountId(user, "pr_author", app.importers.helpers.NO_AUTHOR_NAME);
  },

  assigneeId(user) {
    return this.accountId(user, "pr_assignees", app.importers.helpers.NO_ASSIGNEE_NAME);
  },

  reviewerId(user) {
    return this.accountId(user, "pr_reviewers", app.importers.helpers.NO_REVIEWER_NAME);
  },

  commentAuthorId(user) {
    return this.accountId(user, "pr_comment_authors", app.importers.helpers.NO_AUTHOR_NAME);
  },

  commitAuthorId(user) {
    return this.accountId(user, "pr_commit_authors", app.importers.helpers.NO_AUTHOR_NAME);
  },

  transitionAuthorId(user) {
    return this.accountId(user, "pr_transition_authors", app.importers.helpers.NO_AUTHOR_NAME);
  },

  // Keyed by the GitHub account id and not by the login: a changed login would split one account into two
  // members, and a released login can later belong to somebody else. A deleted account, and a commit whose
  // git author email belongs to no GitHub account, have neither an id nor a login and are imported as the
  // single member naming what is missing.
  accountId(user, tableName, missingAccountName) {
    var dimensionTable = dwh.dimensions[tableName];
    if (!user || !user.login) {
      return dimensionTable.createAndLookupId({id: app.importers.helpers.NONE_ID},
        {name: missingAccountName, display_name: missingAccountName});
    }

    return dimensionTable.createAndLookupId({external_id: this.accountExternalId(user)}, {
      name: user.login,
      display_name: user.name || user.login,
      external_type: user.__typename,
      email: user.email || null,
      profile_path: this.profilePath(user),
      updated_at: dwh.datetimeValue(new Date())
    });
  },

  // A bot has its page under apps, and github.com/<login> of a bot can belong to an account of another
  // kind (github.com/dependabot is an organization of that name). A requested reviewer team has no login
  // and namedReviewer gives it its team path as one.
  profilePath(user) {
    if (user.__typename === "Bot") return `apps/${user.login}`;

    return user.login;
  },

  // The account type belongs in the key because databaseId counts per account type — a user and a bot can
  // both be number 4736. The login is the fallback for an actor GitHub answers no databaseId for: an
  // EnterpriseUserAccount, and a requested reviewer team whose login namedReviewer builds from its path.
  accountExternalId(user) {
    if (!user.databaseId) return user.login;

    return `${user.__typename}-${user.databaseId}`;
  },

  // GitHub display names are not unique, so the login is appended to the duplicates.
  updateDuplicateDisplayNames(importOptions) {
    var tableNames = ACCOUNT_TABLES.slice();
    if (importOptions.importCommits) tableNames.push("pr_commit_authors");
    if (importOptions.importChanges) tableNames.push("pr_transition_authors");

    tableNames.forEach((tableName) => {
      dwh.dimensions[tableName].updateDuplicateNames({nameColumn: "display_name", addColumn: "name"});
    });
  }
};
