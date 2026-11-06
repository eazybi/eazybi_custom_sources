// Parses the Checklist Text custom field of Checklists for Jira by HeroCoders. Shared by the issue importer
// (issue properties) and the checklist items importer (measures).
app.importers.checklistParser = {
  MAX_NAME_LENGTH: 200,
  DEFAULT_CHECKLIST_NAME: "Checklist",
  DEFAULT_COMPLETED_STATUSES: ["done", "skipped"],
  COMPLETED: "Completed",
  NOT_COMPLETED: "Not completed",

  // The lowercase status names which count as completed, from the "Statuses counted as completed" option.
  // A value saved by version 1.0.0 is a comma separated text, which eazyBI reads as an array of that one text.
  completedStatuses() {
    var option = source.getExtraOption("completed_statuses");
    if (option === null || option === undefined) return this.DEFAULT_COMPLETED_STATUSES.slice();
    var statuses = _.flatten((Array.isArray(option) ? option : [option]).map((value) => String(value).split(",")));
    return statuses.map((status) => status.trim().toLowerCase()).filter((status) => status);
  },

  // Jira Cloud may return the field as an ADF document, Jira Data Center and the REST API v2 as a string.
  textOf(node, listPrefix) {
    if (node === null || node === undefined) return "";
    if (typeof node === "string") return node;
    if (node.type === "text") return node.text || "";
    if (node.type === "hardBreak") return "\n";
    var children = node.content || [];
    if (node.type === "bulletList" || node.type === "orderedList") {
      var prefix = node.type === "orderedList" ? "# " : "* ";
      return children.map((child) => this.textOf(child, prefix)).join("");
    }
    var text = children.map((child) => this.textOf(child)).join("");
    if (node.type === "listItem") return (listPrefix || "* ") + text.replace(/\s+$/, "") + "\n";
    if (node.type === "heading") return "# " + text.replace(/\s+$/, "") + "\n";
    if (node.type === "paragraph") return /\n$/.test(text) ? text : text + "\n";
    return text;
  },

  // "# Name" starts a checklist, "--- text" is a header of the next items of the checklist ("---" without a text
  // ends the header), "* [status] text", "- [status] text" or "[status] text" is an item ("[x]" checked, "[]"
  // open, "[]?" optional), "* text" an open item without a status, and ">> text" a description of the previous
  // item (skipped). "[text](url)" is a link, and not a status.
  // Returns [{name, items: [{text, status, completed, header}]}] without the checklists that have no items.
  parse(value, completedStatuses) {
    completedStatuses = completedStatuses || this.DEFAULT_COMPLETED_STATUSES;
    var checklists = [], current = null, header = null;
    var addItem = (text, statusText) => {
      if (!current) {
        current = {name: this.DEFAULT_CHECKLIST_NAME, items: []};
        checklists.push(current);
      }
      current.items.push(_.extend(this.buildItem(text, statusText, completedStatuses), {header: header}));
    };

    this.textOf(value).split(/\r?\n/).forEach((line) => {
      if (/^\s*>>/.test(line)) return;
      var headerLine = line.match(/^\s*---+\s*(.*?)\s*$/);
      if (headerLine) {
        header = headerLine[1] || null;
        return;
      }
      var title = line.match(/^\s*#\s+(.*?)\s*$/);
      if (title) {
        current = {name: title[1] || this.DEFAULT_CHECKLIST_NAME, items: []};
        checklists.push(current);
        header = null;
        return;
      }
      var item = line.match(/^\s*(?:[*\-]\s*)?\[([^\]]*)\](?!\()\??\s*(.*?)\s*$/);
      if (item) return addItem(item[2], item[1]);
      var bullet = line.match(/^\s*[*\-]\s+(.*?)\s*$/);
      if (bullet && bullet[1]) addItem(bullet[1], "");
    });
    return checklists.filter((checklist) => checklist.items.length > 0);
  },

  buildItem(text, statusText, completedStatuses) {
    var status = statusText.trim().toLowerCase();
    if (status === "") status = "open";
    var completed = status === "x" || completedStatuses.indexOf(status) >= 0;
    if (status === "x") status = "done";
    return {text: text, status: status.charAt(0).toUpperCase() + status.substring(1), completed: completed};
  },

  LINK: /\[([^\]]+)\]\(([^)\s]+)\)/g,

  // The text of an item without the Markdown links, "[eazyBI](eazybi.com)" is "eazyBI".
  plainText(text) {
    return String(text || "").replace(this.LINK, "$1");
  },

  // The text of an item with the links to a URL without a scheme ("eazybi.com") opening as https:// links.
  markdownText(text) {
    return String(text || "").replace(this.LINK, (link, label, url) =>
      "[" + label + "](" + (/^([a-z][a-z0-9+.\-]*:|[\/#])/i.test(url) ? url : "https://" + url) + ")");
  },

  truncate(text) {
    text = String(text || "").trim();
    return text.length > this.MAX_NAME_LENGTH ? text.substring(0, this.MAX_NAME_LENGTH - 1) + "…" : text;
  },

  // Totals of the items of all checklists of an issue.
  summary(checklists) {
    var total = 0, completed = 0;
    checklists.forEach((checklist) => checklist.items.forEach((item) => {
      total += 1;
      if (item.completed) completed += 1;
    }));
    return {total: total, completed: completed, progress: total > 0 ? completed / total : null};
  },

  // Every checklist as a bold title with its progress, followed by the list of its items, and the headers as
  // italic lines between the items.
  toMarkdown(checklists) {
    return checklists.map((checklist) => {
      var completed = checklist.items.filter((item) => item.completed).length;
      var lines = [], header = null;
      checklist.items.forEach((item) => {
        if (item.header !== header) {
          header = item.header;
          lines.push("");
          if (header) lines.push("*" + header + "*");
        }
        var status = item.completed ? "✅ " : "⬜ ";
        var label = item.status === "Open" || item.status === "Done" ? "" : " *(" + item.status + ")*";
        lines.push("- " + status + this.markdownText(item.text) + label);
      });
      return "**" + checklist.name + "** (" + completed + "/" + checklist.items.length + ")\n" + lines.join("\n");
    }).join("\n\n");
  }
};
