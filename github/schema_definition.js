// For the source_url annotations — the manifest base URL points at api.github.com, which has no pages
// to link to.
var SOURCE_URL_PREFIX = "https://github.com";

app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension,
      cube = schema.cube, expr = schema.expr;
  var importCommits = source.getExtraOption("import_commits") === true;
  var importChanges = source.getExtraOption("import_changes") === true;

  // An account dimension per role of a GitHub account. The bridge table of a multi value role (assignee,
  // reviewer) is joined by eazyBI to every hierarchy of the dimension.
  function accountDimension(dimensionName, tableName, allMemberName, bridge) {
    dimension(dimensionName, (d) => {
      d.table(tableName);
      d.level("Account", (l) => {
        l.integer("id", {id: true, primaryKey: true});
        l.string("name", {property: "DISPLAY_KEY", allMemberName: allMemberName});
        // Long enough for the display name, the login and the " (" and ")" of the duplicate name suffix.
        l.string("display_name", {name: true, ordinal: true, limit: 550});
        l.string("email", {property: "Email"});
        // "<account type>-<databaseId>" — two accounts of one import can carry the same login, and only
        // the id tells them apart (see importers/users.js). The synthetic member of a missing account has
        // no id and is keyed by its name.
        l.string("external_id", {key: true, index: true,
          keyExpression: expr.coalesce("external_id", "name")});
        l.string("external_type", {property: "Account type"});
        l.datetime("updated_at", {property: "Updated at"});
        // The link is built from the profile path and not from the login, which is not the path of every
        // account type — see profilePath. {{id}} substitutes the URL_ID property of the level.
        l.string("profile_path", {property: "URL_ID"});
        l.annotations({source_url: `${SOURCE_URL_PREFIX}/{{id}}`});
      });

      if (bridge) {
        d.bridgeTable(bridge.table, (b) => {
          b.string("_bt_id", {primaryKey: true, limit: 150, bridgeDimensionForeignKeyColumn: bridge.foreignKeyColumn});
          b.integer(bridge.parentKey, {parentKey: true});
        });
      }

      d.hierarchy("By type", () => {
        d.level("Type", (l) => {
          l.string("external_type", {
            key: true,
            allMemberName: `${allMemberName} by type`,
            keyExpression: expr.coalesce("external_type", "(none)")
          });
        });
        d.level("Account", (l) => {
          // Declared as id and not as the primary key like the default level: a primary key here makes this
          // leaf and the Type level resolve to separate joined tables and emits an invalid self join.
          l.integer("id", {id: true});
          l.string("name", {property: "DISPLAY_KEY"});
          l.string("display_name", {name: true, ordinal: true, limit: 550});
          // caption_from and properties_from below look the donor member up by its key, so this level is
          // keyed like the Account level of the default hierarchy.
          l.string("external_id", {key: true, keyExpression: expr.coalesce("external_id", "name")});
          l.string("profile_path", {property: "URL_ID"});
          l.annotations({
            source_url: `${SOURCE_URL_PREFIX}/{{id}}`,
            caption_from: `[${dimensionName}].[Account]`,
            properties_from: `[${dimensionName}].[Account]`
          });
        });
      });

      d.dimensionAnnotations({group: "Pull Requests"});
    });
  }

  dimension("Repository", (d) => {
    d.table("repositories");
    d.level("Owner", (l) => {
      l.table("owners");
      l.integer("id", {id: true, key: true});
      l.string("login", {name: true, ordinal: true});
      l.string("external_id", {index: true});
      l.string("owner_type", {property: "Type"});
    });
    d.level("Repository", (l) => {
      l.table("repositories");
      l.integer("owner_id", {parentKey: true});
      l.integer("external_id", {limit: 8, index: true});
      l.string("repository_slug", {key: true, property: "DISPLAY_KEY"});
      l.string("repository_name", {name: true, ordinal: true});
      l.annotations({source_url: `${SOURCE_URL_PREFIX}/{{key}}`});
    });
    d.dimensionAnnotations({can_delete_unused_members: false});
  });

  dimension("Pull Request", (d) => {
    d.table("pull_requests");
    d.level("Repository", (l) => {
      l.string("repository_slug", {key: true, property: "DISPLAY_KEY"});
      l.string("repository_name", {name: true, ordinal: true});
      l.annotations({source_url: `${SOURCE_URL_PREFIX}/{{key}}`});
    });
    // Keyed by the dimension id and not by pull_request_key: the key has to be unique in the level,
    // and "#<number>" repeats in every repository. properties_from and caption_from look the member up
    // in the donor level by its key, so the Owner hierarchy level below is keyed by the same column.
    d.level("Pull Request", (l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("pull_request_key", {property: "DISPLAY_KEY"});
      l.string("repository_slug", {property: "PARENT_KEY"});
      l.integer("pull_request_number", {ordinal: true, property: "URL_ID", limit: 8});
      l.integer("github_pull_request_id", {property: "GitHub pull request ID", limit: 8});
      l.integer("repository_id");
      l.integer("owner_id", {property: "Repository owner ID"});
      l.string("title", {name: true, limit: 2000});
      l.datetime("created_at", {property: "Created at"});
      l.datetime("closed_at", {property: "Closed at"});
      l.string("branch_name", {property: "Branch Name", index: true});
      l.string("state", {property: "State"});
      l.string("draft", {property: "Draft"});
      l.string("milestone_name", {property: "Milestone"});
      l.string("merge_state", {property: "Merge state"});
      l.string("merge_commit");
      l.annotations({source_url: `${SOURCE_URL_PREFIX}/{{parent_key}}/pull/{{id}}`});
    });

    d.hierarchy("Owner", () => {
      d.level("Owner", (l) => {
        l.table("owners");
        l.integer("id", {id: true, key: true});
        l.string("login", {name: true, ordinal: true});
      });
      d.level("Repository", (l) => {
        l.table("repositories");
        l.integer("owner_id", {parentKey: true});
        l.string("repository_slug", {key: true, property: "DISPLAY_KEY"});
        l.string("repository_name", {name: true, ordinal: true});
        l.annotations({source_url: `${SOURCE_URL_PREFIX}/{{key}}`});
      });
      d.level("Pull Request", (l) => {
        l.table("pull_requests");
        l.integer("repository_id", {parentKey: true});
        // Keyed by the dimension id like the level of the default hierarchy: properties_from looks the
        // donor member up by its key, so the two have to agree.
        l.integer("id", {id: true, key: true, limit: 8});
        l.string("pull_request_key", {property: "DISPLAY_KEY"});
        l.integer("pull_request_number", {ordinal: true, property: "URL_ID", limit: 8});
        l.string("title", {name: true, limit: 2000});
        l.annotations({
          source_url: `${SOURCE_URL_PREFIX}/{{parent_key}}/pull/{{id}}`,
          caption_from: "[Pull Request].[Pull Request]",
          properties_from: "[Pull Request].[Pull Request]"
        });
      });
    });

    d.dimensionAnnotations({default_nonempty_crossjoin: true, group: "Pull Requests"});
  });

  dimension("Pull Request State", (d) => {
    d.table("pr_states");
    d.level((l) => {
      l.integer("id", {id: true, key: true, foreignKeyIndex: false});
      l.string("name", {name: true});
      l.integer("ordinal", {ordinal: true});
    });
    d.dimensionAnnotations({group: "Pull Requests"});
  });

  dimension("Merge State", (d) => {
    d.table("pr_merge_states");
    d.level((l) => {
      l.integer("id", {id: true, key: true, foreignKeyIndex: false});
      l.string("name", {name: true, ordinal: true});
    });
    d.dimensionAnnotations({group: "Pull Requests"});
  });

  dimension("Review State", (d) => {
    d.table("pr_review_states");
    d.level((l) => {
      l.integer("id", {id: true, key: true, foreignKeyIndex: false});
      l.string("name", {name: true, ordinal: true});
    });
    d.dimensionAnnotations({group: "Pull Requests"});
  });

  accountDimension("Pull Request Author", "pr_author", "All Pull Request Authors");
  accountDimension("Pull Request Assignee", "pr_assignees", "All Assignees",
    {table: "pr_assignees_bt", parentKey: "pr_assignee_id", foreignKeyColumn: "pr_assignee_bt_id"});
  accountDimension("Pull Request Reviewer", "pr_reviewers", "All Reviewers",
    {table: "pr_reviewers_bt", parentKey: "pr_reviewer_id", foreignKeyColumn: "pr_reviewer_bt_id"});
  accountDimension("Comment Author", "pr_comment_authors", "All Comment Authors");
  // These two are filled only by the importers of their import option and stay empty while it is off.
  // They are still defined then, because a dimension that the definition leaves out drops its table with
  // the members and the fact table foreign key of every import that ran with the option on.
  accountDimension("Commit Author", "pr_commit_authors", "All Commit Authors");
  accountDimension("Transition Author", "pr_transition_authors", "All Transition Authors");

  dimension("Label", (d) => {
    d.table("labels");
    d.level((l) => {
      l.integer("id", {id: true, primaryKey: true});
      l.string("external_id", {index: true});
      l.string("name", {key: true, name: true});
      l.datetime("updated_at", {property: "Updated at"});
    });
    d.bridgeTable("labels_bt", (b) => {
      b.string("_bt_id", {primaryKey: true, limit: 150, bridgeDimensionForeignKeyColumn: "label_bt_id"});
      b.integer("label_id", {parentKey: true});
    });
  });

  dimension("Milestone", (d) => {
    d.table("milestone");
    d.level((l) => {
      l.integer("id", {id: true, key: true, foreignKeyIndex: false});
      l.string("external_id", {index: true});
      // The repository a rename has to find its milestones by — its slug changes, its id does not.
      l.integer("repository_id");
      l.integer("milestone_number", {property: "Number"});
      l.string("name", {name: true, ordinal: true});
      l.string("repository_slug", {property: "Repository"});
      l.date("due_date", {property: "Due date"});
      l.datetime("updated_at", {property: "Updated at"});
    });
  });

  timeDimension("Time");

  cube((c) => {
    c.table("pull_requests");
    c.annotations({
      default_measures: ["Pull requests created"],
      hide_measure_groups: true,
      can_delete_unused_members: true,
      drill_through_dimension_levels: ["[Pull Request].[Pull Request]"]
    });

    c.measures((m) => {
      m.integer("pull_request_created", {name: "Pull requests created"});
      m.integer("pull_request_due", {name: "Pull requests due", visible: false});
      m.integer("pull_request_closed", {name: "Pull requests closed"});
      m.integer("commits_closed", {name: "Closed pull request commit count"});
      m.integer("changed_files_count", {name: "Changed files count", annotations: {group: "Pull request changes"}});
      m.integer("additions", {name: "Additions", annotations: {group: "Pull request changes"}});
      m.integer("deletions", {name: "Deletions", annotations: {group: "Pull request changes"}});
      m.decimal("total_closing_days", {name: "Total closing days", scale: 6, visible: false, formatString: "#,##0.00"});
      m.integer("pull_request_with_milestone_due_date", {name: "Pull requests with milestone due date"});
      m.integerExpression(expr.caseNotNull("pull_request_created", "pull_request_id"), {
        name: "Pull requests created count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}
      });
      m.integerExpression(expr.caseNotNull("pull_request_closed", "pull_request_id"), {
        name: "Pull requests closed count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}
      });
    });

    c.measures("Comments", (m) => {
      m.table("pr_comment");
      m.integer("comments_submitted", {name: "Comments submitted"});
      m.integer("reviews_submitted", {name: "Reviews submitted"});
      // Only the comments a review carries — what Comments per review divides by the reviews.
      m.integer("review_comments_submitted", {name: "Review comments submitted", visible: false});
      // How many pull requests were reviewed, which the Comment Author dimension can slice — the pull
      // requests table carries no comment author key, so Pull requests created cannot answer it.
      m.integerExpression(expr.caseNotNull("reviews_submitted", "pull_request_id"), {
        name: "Reviewed pull requests count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}
      });
    });

    c.measures("Commits", (m) => {
      m.table("pr_commit");
      m.integer("commits_submitted", {name: "Commits submitted", visible: importCommits});
      m.integer("commit_additions", {name: "Commit additions", visible: false});
      m.integer("commit_deletions", {name: "Commit deletions", visible: false});
    });

    c.measures("Transitions", (m) => {
      m.table("pr_transition");
      m.integer("transition_to", {name: "Transitions to state", visible: importChanges});
      m.integer("transition_from", {name: "Transitions from state", visible: importChanges});
      m.decimal("days_in_transition_state", {name: "Days in transition state", scale: 6,
        formatString: "#,##0.00", visible: importChanges});
      m.integer("transition_ts", {name: "Transition timestamp", limit: 8, visible: false});

      m.integerExpression(expr.caseNotNull("transition_to", "transition_ts"),
        {name: "Transition to state first timestamp", aggregator: "min", visible: false});
      m.integerExpression(expr.caseNotNull("transition_to", "transition_ts"),
        {name: "Transition to state last timestamp", aggregator: "max", visible: false});
      m.integerExpression(expr.caseNotNull("transition_from", "transition_ts"),
        {name: "Transition from state first timestamp", aggregator: "min", visible: false});
      m.integerExpression(expr.caseNotNull("transition_from", "transition_ts"),
        {name: "Transition from state last timestamp", aggregator: "max", visible: false});

      m.integerExpression(expr.caseNotNull("transition_to", "pull_request_id"), {
        name: "Transitions to state pull requests count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}, visible: importChanges
      });
      m.integerExpression(expr.caseNotNull("transition_from", "pull_request_id"), {
        name: "Transitions from state pull requests count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}, visible: importChanges
      });

      // The same sums as the two visible transition measures, hidden and without their non empty behavior,
      // so that the Pull requests history formula can add and subtract them over the previous periods.
      // caseNotNull of the column itself, because expr has no helper for a bare column expression.
      m.integerExpression(expr.caseNotNull("transition_to", "transition_to"),
        {name: "Transitions to", aggregator: "sum", visible: false});
      m.integerExpression(expr.caseNotNull("transition_from", "transition_from"),
        {name: "Transitions from", aggregator: "sum", visible: false});

      m.integer("transition_to_author", {name: "Transitions to author", visible: importChanges});
      m.integer("transition_from_author", {name: "Transitions from author", visible: importChanges});

      m.integerExpression(expr.caseNotNull("transition_to_author", "pull_request_id"), {
        name: "Transitions to author pull requests count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}, visible: importChanges
      });
      m.integerExpression(expr.caseNotNull("transition_from_author", "pull_request_id"), {
        name: "Transitions from author pull requests count", aggregator: "distinct-count",
        annotations: {group: "Distinct pull requests count"}, visible: importChanges
      });
    });

    c.timeDimensionCalculatedMembers();

    c.calculatedMember("Open pull requests", {
      formatString: "#,##0",
      formula: `
        CASE WHEN [Pull Request].CurrentHierarchyMember.Level.Name <> 'Pull Request' THEN
          Cache(
            NonZero(Sum(PreviousPeriods([Time].CurrentHierarchyMember),
              [Measures].[Pull requests created]
              - [Measures].[Pull requests closed]
            ))
            + [Measures].[Pull requests created]
            - [Measures].[Pull requests closed]
          )
        WHEN [Time].CurrentHierarchyMember IS [Time].CurrentHierarchy.DefaultMember
        THEN NonZero([Measures].[Pull requests due])
        ELSE
          -- optimized formula for drill through Pull Request
          NonZero(IIF(
              DateBeforePeriodEnd(
                [Pull Request].CurrentHierarchyMember.get('Created at'),
                [Time].CurrentHierarchyMember) AND
              NOT DateBeforePeriodEnd(
                [Pull Request].CurrentHierarchyMember.get('Closed at'),
                [Time].CurrentHierarchyMember),
            ([Time].CurrentHierarchy.DefaultMember,
              [Measures].[Pull requests created]),
            0
          ))
        END`
    });

    c.calculatedMember("Merged pull requests", {
      formatString: "#,##0",
      formula: "([Measures].[Pull requests closed], [Pull Request State].[Merged])"
    });

    c.calculatedMember("Average closing days", {
      formatString: "#,##0.00",
      formula: `
        CASE WHEN [Measures].[Pull requests closed] > 0 THEN
          [Measures].[Total closing days] / [Measures].[Pull requests closed]
        END`
    });

    c.calculatedMember("Average merge days", {
      formatString: "#,##0.00",
      formula: `
        CASE WHEN [Measures].[Merged pull requests] > 0 THEN
          ([Measures].[Total closing days], [Pull Request State].[Merged]) /
          [Measures].[Merged pull requests]
        END`
    });

    c.calculatedMember("Merge rate", {
      formatString: "#0%",
      formula: `
        CASE WHEN [Measures].[Pull requests closed] > 0 THEN
          [Measures].[Merged pull requests] /
          [Measures].[Pull requests closed]
        END`
    });

    c.calculatedMember("Comments per review", {
      formatString: "#,##0.0",
      formula: `
        CASE WHEN [Measures].[Reviews submitted] > 0 THEN
          [Measures].[Review comments submitted] /
          [Measures].[Reviews submitted]
        END`
    });

    c.calculatedMember("Changes", {
      formatString: "#,##0",
      annotations: {group: "Pull request changes"},
      formula: "[Measures].[Additions] + [Measures].[Deletions]"
    });

    c.calculatedMember("Pull request created date", {
      formatString: "mmm dd yyyy", annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('Created at')"
    });
    c.calculatedMember("Pull request closed date", {
      formatString: "mmm dd yyyy", annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('Closed at')"
    });
    // Measured against today and therefore meaningful only for the pull requests which are still open.
    c.calculatedMember("Open pull request age days", {
      formatString: "#,##0", annotations: {group: "Pull Request properties"},
      formula: `
        CASE WHEN [Measures].[Open pull requests] > 0 THEN
          DateDiffDays(
            [Pull Request].CurrentHierarchyMember.get('Created at'),
            DateParse('today')
          )
        END`
    });
    c.calculatedMember("Pull request state", {
      annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('State')"
    });
    c.calculatedMember("Pull request draft", {
      annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('Draft')"
    });
    c.calculatedMember("Pull request branch", {
      annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('Branch Name')"
    });
    c.calculatedMember("Pull request milestone", {
      annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('Milestone')"
    });
    c.calculatedMember("Pull request merge state", {
      annotations: {group: "Pull Request properties"},
      formula: "[Pull Request].CurrentHierarchyMember.get('Merge state')"
    });

    c.calculatedMember("Lines added", {
      formatString: "#,##0", annotations: {group: "Commit changes"}, visible: importCommits,
      formula: "[Measures].[Commit additions]"
    });
    c.calculatedMember("Lines removed", {
      formatString: "#,##0", annotations: {group: "Commit changes"}, visible: importCommits,
      formula: "-[Measures].[Commit deletions]"
    });
    c.calculatedMember("Net lines", {
      formatString: "#,##0", annotations: {group: "Commit changes"}, visible: importCommits,
      formula: "[Measures].[Commit additions] - [Measures].[Commit deletions]"
    });

    c.calculatedMember("Pull requests history", {
      formatString: "#,##0", visible: importChanges,
      formula: `
        Cache(
          NonZero(Sum(PreviousPeriods([Time].CurrentHierarchyMember),
            [Measures].[Transitions to]
            - [Measures].[Transitions from]
          ))
          + [Measures].[Transitions to]
          - [Measures].[Transitions from]
        )`
    });

    c.calculatedMember("Average days in transition state", {
      formatString: "#,##0.00", visible: importChanges,
      formula: `
        CASE WHEN [Measures].[Transitions from state] > 0 THEN
          [Measures].[Days in transition state] /
          [Measures].[Transitions from state]
        END`
    });

    c.calculatedMember("Transition to state first date", {
      formatString: "yyyy-mm-dd hh:nn:ss", visible: importChanges,
      formula: "TimestampToDate([Measures].[Transition to state first timestamp])"
    });
    c.calculatedMember("Transition to state last date", {
      formatString: "yyyy-mm-dd hh:nn:ss", visible: importChanges,
      formula: "TimestampToDate([Measures].[Transition to state last timestamp])"
    });
    c.calculatedMember("Transition from state first date", {
      formatString: "yyyy-mm-dd hh:nn:ss", visible: importChanges,
      formula: "TimestampToDate([Measures].[Transition from state first timestamp])"
    });
    c.calculatedMember("Transition from state last date", {
      formatString: "yyyy-mm-dd hh:nn:ss", visible: importChanges,
      formula: "TimestampToDate([Measures].[Transition from state last timestamp])"
    });
  });
});
