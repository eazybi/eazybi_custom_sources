// One row per commit of a pull request with its author and its line changes, imported only with the
// "Import pull request commits" import option.
app.importers.commits = {
  rows(context) {
    var rows = [];

    ((context.pullRequest.commits && context.pullRequest.commits.nodes) || []).forEach((commitNode) => {
      var commit = commitNode.commit;
      if (!commit || !commit.authoredDate) return;

      rows.push(Object.assign({}, context.commonAttributes, {
        time_id: dwh.lookupTimeId(commit, "authoredDate"),
        // A commit is linked to a GitHub account only when its git author email belongs to one.
        pr_commit_author_id: app.importers.users.commitAuthorId(commit.author && commit.author.user),
        commits_submitted: 1,
        commit_additions: commit.additions,
        commit_deletions: commit.deletions
      }));
    });

    return rows;
  }
};
