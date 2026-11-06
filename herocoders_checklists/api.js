app.api = {
  PAGE_SIZE: 100,
  FIELD_NAME: "Checklist Text",
  DEFAULT_STATUSES: ["open", "in progress", "done", "skipped"],
  DEFAULT_COMPLETED_STATUSES: ["done", "skipped"],
  STATUS_SCAN_PAGES: 5,

  // The options of "Statuses counted as completed": the default statuses of Checklists for Jira and the
  // statuses used in the Checklist Text of the recently updated issues. The custom statuses of the app are
  // not available in the Jira REST API, therefore they are found in the checklists which use them.
  getCompletedStatusOptions(sourceSelection) {
    var statuses = this.DEFAULT_STATUSES.slice();
    var fieldIds = this.getChecklistFieldIds();
    if (fieldIds.length > 0) {
      var projectKeys = (sourceSelection || []).filter((key) => key !== "(all)");
      var jql = this.buildJql(fieldIds, projectKeys, null, "updated DESC");
      this.searchIssues(jql, fieldIds, (issues) => issues.forEach((issue) => fieldIds.forEach((fieldId) => {
        statuses = statuses.concat(this.itemStatusesOf(issue.fields[fieldId]));
      })), {maxPages: this.STATUS_SCAN_PAGES});
    }
    return {
      options: _.uniq(statuses).map((status) => ({value: status, label: status.charAt(0).toUpperCase() + status.substring(1)})),
      default: this.DEFAULT_COMPLETED_STATUSES
    };
  },

  // The lowercase item statuses of a Checklist Text, without the [x] and [] checkboxes.
  itemStatusesOf(text) {
    if (typeof text !== "string") return [];
    var statuses = [];
    text.split(/\r?\n/).forEach((line) => {
      var item = line.match(/^\s*(?:[*\-]\s*)?\[([^\]]*)\](?!\()/);
      var status = item ? item[1].trim().toLowerCase() : "";
      if (status && status !== "x") statuses.push(status);
    });
    return statuses;
  },

  isJiraCloud() {
    var serverInfo = source.jira.getCachedDocument("/rest/api/2/serverInfo") || {};
    return serverInfo.deploymentType === "Cloud";
  },

  // The custom field id differs in every Jira site, therefore the Checklist Text fields are found by their name.
  // A site may have several of them, from the different editions of the app.
  getChecklistFieldIds() {
    var fields = source.jira.getCachedDocument("/rest/api/2/field") || [];
    return fields.filter((field) => field.custom && field.name === this.FIELD_NAME).map((field) => field.id);
  },

  buildJql(fieldIds, projectKeys, since, orderBy) {
    var conditions = [];
    if (projectKeys && projectKeys.length > 0) {
      conditions.push("project in (" + projectKeys.map((key) => '"' + key + '"').join(", ") + ")");
    }
    // A full import reads the issues with a checklist, an incremental one also the issues whose checklist
    // was removed since the last import.
    if (since) {
      conditions.push('updated >= "' + since + '"');
    } else {
      var notEmpty = fieldIds.map((fieldId) => "cf[" + fieldId.replace("customfield_", "") + "] is not EMPTY");
      conditions.push(notEmpty.length > 1 ? "(" + notEmpty.join(" OR ") + ")" : notEmpty[0]);
    }
    return conditions.join(" AND ") + " ORDER BY " + (orderBy || "id ASC");
  },

  // Calls pageCallback with the issues {id, key, fields: {created, <field ids>}} of each search page, of all
  // pages or of the first options.maxPages. With options.changelog the issues have the changelog too. The REST
  // API v2 returns the Checklist Text as a string; Jira Data Center has no search/jql and pages by startAt.
  searchIssues(jql, fieldIds, pageCallback, options) {
    options = options || {};
    var fields = ["created"].concat(fieldIds);
    var pageCount = 0;
    var hasMorePages = () => !options.maxPages || pageCount < options.maxPages;
    if (this.isJiraCloud()) {
      var nextPageToken = null;
      do {
        var page = source.jira.postDocument("/rest/api/2/search/jql", {
          jql: jql, fields: fields, maxResults: this.PAGE_SIZE, nextPageToken: nextPageToken || undefined,
          expand: options.changelog ? "changelog" : undefined
        });
        pageCount += 1;
        pageCallback(page.issues || []);
        nextPageToken = page.isLast === false ? page.nextPageToken : null;
      } while (nextPageToken && hasMorePages());
    } else {
      var startAt = 0, total = 0;
      do {
        var dcPage = source.jira.postDocument("/rest/api/2/search", {
          jql: jql, fields: fields, maxResults: this.PAGE_SIZE, startAt: startAt,
          expand: options.changelog ? ["changelog"] : undefined
        });
        var issues = dcPage.issues || [];
        pageCount += 1;
        pageCallback(issues);
        total = dcPage.total || 0;
        startAt += issues.length;
      } while (issues.length > 0 && startAt < total && hasMorePages());
    }
  },

  // The changelog histories of an issue of a search with the changelog. The search may return only a part of a
  // long changelog, then all histories are read with the issue changelog request.
  getChangelogHistories(issue) {
    var changelog = issue.changelog || {};
    var histories = changelog.histories || [];
    if (!changelog.total || histories.length >= changelog.total) return histories;
    if (!this.isJiraCloud()) {
      var fullIssue = source.jira.getDocument("/rest/api/2/issue/" + issue.id, {expand: "changelog", fields: "created"});
      return (fullIssue && fullIssue.changelog && fullIssue.changelog.histories) || histories;
    }
    var allHistories = [], startAt = 0, page, values;
    do {
      page = source.jira.getDocument("/rest/api/2/issue/" + issue.id + "/changelog",
        {startAt: startAt, maxResults: this.PAGE_SIZE}) || {};
      values = page.values || [];
      allHistories = allHistories.concat(values);
      startAt += values.length;
    } while (values.length > 0 && page.isLast !== true && (page.total === undefined || startAt < page.total));
    return allHistories;
  }
};
