app.defineSchema((schema) => {
  var expr = schema.expr;

  // Columns of the jira_issues table, written by the issue importer.
  schema.issueProperties((p) => {
    p.integer("items_total", {property: "HC Checklist total items"});
    p.integer("items_completed", {property: "HC Checklist completed items"});
    p.decimal("items_progress", {property: "HC Checklist progress", precision: 9, scale: 4});
    p.text("items_markdown", {property: "HC Checklist content"});
  });

  // A checklist by its name, the same name on several issues is one member.
  schema.dimension("HC Checklist", (d) => {
    d.table("checklists");
    d.level((l) => l.string("name", {key: true, name: true}));
  });

  // A checklist item by its text, the same item on several issues is one member.
  schema.dimension("HC Checklist Item", (d) => {
    d.table("items");
    d.level((l) => l.string("name", {key: true, name: true}));
  });

  // The header of the items in a checklist ("--- Header"), "(none)" for the items without a header.
  schema.dimension("HC Checklist Header", (d) => {
    d.table("headers");
    d.level((l) => l.string("name", {key: true, name: true}));
  });

  schema.dimension("HC Checklist Item Status", (d) => {
    d.table("item_statuses");
    d.level("Completion", (l) => l.string("completion", {key: true, name: true}));
    d.level("Status", (l) => l.string("name", {key: true, name: true}));
  });

  // One row per checklist item, dated by the created date of its issue, with the item counts, and one row per
  // completed item, dated by its last completion, with HC Checklist items completed, and one row per reopened
  // item, dated by its last reopening, with HC Checklist items reopened.
  schema.measures("HC Checklists", (m) => {
    m.table("checklist_items");
    m.integer("items_count", {name: "HC Checklist items", formatString: "#,##0"});
    m.integer("items_completed", {name: "HC Checklist items completed", formatString: "#,##0"});
    m.integer("items_not_completed", {name: "HC Checklist items not completed", formatString: "#,##0"});
    m.integer("items_reopened", {name: "HC Checklist items reopened", formatString: "#,##0"});
    // Helper columns of the distinct counts: the Jira issue id, and the issue id * 1000 + checklist number.
    m.integer("issue_ref", {limit: 8});
    m.integer("checklist_ref", {limit: 8});
    m.integerExpression(expr.caseNotNull("items_count", "checklist_ref"),
      {name: "HC Checklists", aggregator: "distinct-count", formatString: "#,##0"});
    m.integerExpression(expr.caseNotNull("items_count", "issue_ref"),
      {name: "HC Issues with checklists", aggregator: "distinct-count", formatString: "#,##0"});
  });

  schema.calculatedMember("HC Checklist progress %", {
    formula: `
      CASE WHEN [Measures].[HC Checklist items] > 0 THEN
        [Measures].[HC Checklist items completed] / [Measures].[HC Checklist items]
      END`,
    formatString: "#0.0%"
  });

  // The checklists of the issue on the report rows, rendered as Markdown.
  schema.calculatedMember("HC Issue checklist content", {
    formula: "[Issue].CurrentHierarchyMember.get('HC Checklist content')",
    formatString: "MarkdownFormatter",
    annotations: {group: "Issue properties"}
  });
});
