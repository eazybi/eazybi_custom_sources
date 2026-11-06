app.defineApplication({
  addonFor: "jira",
  addonKey: "herocoders_checklists",
  tableAlias: "hcchk",
  name: "Checklists by HeroCoders",
  namePrefix: "HC",
  description: "Imports the checklists and checklist items of Checklists for Jira by HeroCoders " +
    "from the Checklist Text custom field",
  version: "1.4.1",
  author: "eazyBI",
  license: "MIT",
  issueImport: {
    fields: [{key: "checklist_text", name: "Checklist Text"}]
  },
  extraOptions: [
    {
      key: "completed_statuses", type: "select", multiple: true, label: "Statuses counted as completed",
      optionsFrom: "getCompletedStatusOptions", default: ["done", "skipped"], clearsMax: true,
      hint: "The checklist item statuses which count as completed. Items checked as [x] are always completed. " +
        "Custom statuses are listed when the checklists of recently updated issues use them."
    }
  ]
});
