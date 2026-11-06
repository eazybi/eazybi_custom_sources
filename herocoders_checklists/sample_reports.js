// The sample reports of the addon in the Issues cube of the Jira source application, created in the
// "Samples Checklists by HeroCoders" folder.
app.defineSampleReports((samples) => {
  var LAST_12_MONTHS = {
    name: "Time",
    selected_set: ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current year]", "[Time].[Previous year]"],
    current_page_members: ["[Time].[Last 12 months]"],
    members: [{full_name: "[Time].[Last 12 months]", name: "Last 12 months"}]
  };
  var PROJECT = {name: "Project", selected_set: ["[Project].DefaultMember"]};
  var ISSUE_TYPE = {name: "Issue Type", selected_set: ["[Issue Type].DefaultMember"]};
  var ISSUE_TYPES = {
    name: "Issue Type", selected_set: ["[Issue Type].[All Issue Types]"],
    selected_set_expression: "DescendantsSet({{selected_set}}, [Issue Type].[Issue Type])"
  };

  function measures(names) {
    return {name: "Measures", selected_set: names.map((name) => "[Measures].[" + name + "]")};
  }

  samples.report({
    name: "Checklist item completion by issue type",
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [measures(["HC Checklist items completed", "HC Checklist items not completed"])]},
      rows: {dimensions: [ISSUE_TYPES]},
      pages: {dimensions: [PROJECT, LAST_12_MONTHS]},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {
          stacked: true, vertical: false, data_labels: true, show_full_caption: ["Measures"],
          series_options: {
            "HC Checklist items completed": {color: samples.color("$blue-7")},
            "HC Checklist items not completed": {color: samples.color("$red-6")}
          }
        }
      }
    }
  });

  samples.report({
    name: "Checklist items by issue type",
    resultView: "pie_chart",
    definition: {
      columns: {dimensions: [measures(["HC Checklist items"])]},
      rows: {dimensions: [ISSUE_TYPES]},
      pages: {dimensions: [PROJECT, LAST_12_MONTHS]},
      options: {nonempty: true},
      view: {current: "pie_chart", pie_chart: {donut: true, show_labels: true, data_labels: "values", show_legend: true}}
    }
  });

  samples.report({
    name: "Checklists over time",
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [measures(["HC Issues with checklists", "HC Checklists", "HC Checklist items"])]},
      rows: {dimensions: [{
        name: "Time", selected_set: ["[Time].[Last 12 months]"],
        selected_set_expression: "DescendantsSet({{selected_set}}, [Time].[Month])"
      }]},
      pages: {dimensions: [PROJECT, ISSUE_TYPE]},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {
          vertical: true, data_labels: true,
          series_options: {
            "HC Issues with checklists": {color: samples.color("$blue-7"), dataLabelType: "top vertical"},
            "HC Checklists": {color: samples.color("$red-6"), dataLabelType: "top vertical"},
            "HC Checklist items": {color: samples.color("$green-6"), dataLabelType: "top vertical"}
          }
        }
      }
    }
  });

  // The checklists of the 3 issues in progress with the most open checklist items: the issues with both completed and
  // not completed items, with all items of the issue regardless of when they were completed.
  samples.report({
    name: "Work items with checklists",
    resultView: "table",
    definition: {
      columns: {dimensions: [measures(["HC Issue checklist content", "HC Checklists", "HC Checklist items",
        "HC Checklist items completed", "HC Checklist items not completed", "HC Checklist progress %"])]},
      rows: {
        dimensions: [{
          name: "Issue", selected_set: ["[Issue].[All Issues]"],
          selected_set_expression: "DescendantsSet({{selected_set}}, [Issue].[Issue])"
        }],
        filter_by: {conditions: [
          {expression: ["[Measures].[HC Checklist items completed]"], operator: ">", value: "0"},
          {expression: ["[Measures].[HC Checklist items not completed]"], operator: ">", value: "0"}
        ]},
        extreme_by: {expression: ["[Measures].[HC Checklist items not completed]"], extreme: "top_count", limit: "3"}
      },
      pages: {dimensions: [PROJECT, ISSUE_TYPE]},
      options: {nonempty: true},
      view: {current: "table", table: {show_key: ["Issue"], freeze_header: true}}
    }
  });
});
