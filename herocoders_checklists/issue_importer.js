app.issueImporter = {
  // The item totals, the progress and the Markdown list of the checklists of every issue.
  importIssues(issues) {
    var parser = app.importers.checklistParser;
    var completedStatuses = parser.completedStatuses();
    return issues.map((issue) => {
      var checklists = parser.parse(issue.fields.checklist_text, completedStatuses);
      var summary = parser.summary(checklists);
      return {
        issueId: issue.id,
        properties: checklists.length === 0 ? {} : {
          items_total: summary.total,
          items_completed: summary.completed,
          items_progress: summary.progress,
          items_markdown: parser.toMarkdown(checklists)
        },
        measures: []
      };
    });
  }
};
