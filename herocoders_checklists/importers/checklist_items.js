app.importers.checklistItems = {
  SOURCE_NAME: "checklist item",
  MAX_ROWS_PER_CALL: 10000,
  NO_HEADER: "(none)",

  // Imports the checklist item rows of one search page of issues, returns the number of imported rows.
  importIssues(issues, fieldIds, completedStatuses) {
    var batch = [], importedCount = 0;
    var flush = () => {
      if (batch.length > 0) dwh.measures.checklist_items.importRows(batch);
      importedCount += batch.length;
      batch = [];
    };

    issues.forEach((issue) => {
      var rows = this.buildIssueRows(issue, fieldIds, completedStatuses);
      if (rows === null) return;
      if (rows.length === 0) {
        // The checklist was removed, or the issue is not imported: delete its stored rows.
        dwh.measures.checklist_items.importRows([], {sourceId: String(issue.id), sourceName: this.SOURCE_NAME});
        return;
      }
      if (batch.length + rows.length > this.MAX_ROWS_PER_CALL) flush();
      batch = batch.concat(rows);
    });
    flush();
    return importedCount;
  },

  // The rows of one issue, or null when they could not be built (reported as an object failure).
  buildIssueRows(issue, fieldIds, completedStatuses) {
    try {
      var issueId = dwh.jira.lookupIssueId(issue.key);
      if (!issueId) return [];
      var fieldId = this.fieldId(issue, fieldIds);
      var checklists = app.importers.checklistParser.parse(fieldId ? issue.fields[fieldId] : null, completedStatuses);
      if (checklists.length === 0) return [];
      var history = app.importers.checklistHistory;
      // Replay only the changes of the parsed field, not of the other Checklist Text fields.
      var changes = history.fieldChanges(app.api.getChangelogHistories(issue), [fieldId]);
      var state = history.replay(issue, checklists, changes, completedStatuses);
      var rows = this.buildRows(issue, issueId, checklists,
        history.lastChanges(state, "completedBy"), history.lastChanges(state, "reopenedBy"));
      // The rows of an issue are imported in one call, which can not split its source scope.
      if (rows.length > this.MAX_ROWS_PER_CALL) {
        throw new Error(rows.length + " checklist item rows are more than " + this.MAX_ROWS_PER_CALL);
      }
      return rows;
    } catch (e) {
      source.warnings.addObjectFailure(issue.key, "Import of the checklists of " + issue.key + " failed: " + e);
      return null;
    }
  },

  // The id of the first non-empty Checklist Text field of the issue, or undefined.
  fieldId(issue, fieldIds) {
    return _.find(fieldIds, (id) => issue.fields[id] !== null && issue.fields[id] !== undefined);
  },

  // The item text without the link URLs.
  itemName(item) {
    var parser = app.importers.checklistParser;
    return parser.truncate(parser.plainText(item.text)) || "(empty)";
  },

  // An item row dated by the created date of the issue with the item counts, for a completed item a completion
  // row dated by its last completion, and for a reopened item a reopening row dated by its last reopening, by the
  // completions and the reopenings of checklistHistory.
  buildRows(issue, issueId, checklists, completions, reopenings) {
    var parser = app.importers.checklistParser;
    var createdTimeId = dwh.lookupTimeId(issue.fields, "created");
    var rows = [];
    checklists.forEach((checklist, checklistIndex) => {
      var checklistId = dwh.dimensions.checklists.createAndLookupId({name: parser.truncate(checklist.name)});
      checklist.items.forEach((item, itemIndex) => {
        var row = {
          _source_id: String(issue.id),
          _source_name: this.SOURCE_NAME,
          issue_id: issueId,
          time_id: createdTimeId,
          checklist_id: checklistId,
          item_id: dwh.dimensions.items.createAndLookupId({name: this.itemName(item)}),
          header_id: dwh.dimensions.headers.createAndLookupId({name: parser.truncate(item.header) || this.NO_HEADER}),
          // A status is looked up with its completion: "[x]" is a completed Done item also when the Done
          // status does not count as completed.
          item_status_id: dwh.dimensions.item_statuses.createAndLookupId(
            {completion: item.completed ? parser.COMPLETED : parser.NOT_COMPLETED, name: item.status}),
          issue_ref: Number(issue.id),
          checklist_ref: Number(issue.id) * 1000 + checklistIndex + 1,
          items_count: 1
        };
        // Empty, not 0, for a completed item, as HC Checklist items completed is empty for a not completed one.
        if (!item.completed) row.items_not_completed = 1;
        rows.push(row);
        if (item.completed) {
          var completion = completions[checklistIndex + "/" + itemIndex] || issue.fields;
          rows.push(_.extend(_.omit(row, "items_count", "items_not_completed"), {
            time_id: dwh.lookupTimeId(completion, "created"),
            items_completed: 1
          }));
        }
        var reopening = (reopenings || {})[checklistIndex + "/" + itemIndex];
        if (reopening) {
          rows.push(_.extend(_.omit(row, "items_count", "items_not_completed"), {
            time_id: dwh.lookupTimeId(reopening, "created"),
            items_reopened: 1
          }));
        }
      });
    });
    return rows;
  }
};
