app.importer = {
  // Imports the checklist item rows after the Jira issues are imported. The issue properties are imported
  // per issue by issue_importer.js.
  importAll() {
    var fieldIds = app.api.getChecklistFieldIds();
    if (fieldIds.length === 0) {
      source.warnings.add("checklist_text_field", "The Jira custom field \"" + app.api.FIELD_NAME +
        "\" was not found. Enable \"Sync checklists to Custom Fields\" in the Checklists for Jira global settings.");
      return;
    }
    var since = source.isReimport() ? null : source.getMaxParam("updated_since");
    // Captured before the search, with a one day margin for the time zone of the JQL date.
    var nextSince = strftime("%Y-%m-%d %H:%M", new Date(new Date().getTime() - 86400000));
    var jql = app.api.buildJql(fieldIds, source.getSourceSelection(), since);
    var completedStatuses = app.importers.checklistParser.completedStatuses();
    var importedCount = 0;

    source.setStatusMessage("Importing HeroCoders checklists");
    logger.startImport("checklist items", since ? "issues updated since " + since : "all issues");
    app.api.searchIssues(jql, fieldIds, (issues) => {
      importedCount += app.importers.checklistItems.importIssues(issues, fieldIds, completedStatuses);
    }, {changelog: true});
    logger.finishImport("checklist items", importedCount);

    if (source.warnings.objectFailures().length === 0) {
      source.setMaxParam("updated_since", nextSince);
    }
  }
};
