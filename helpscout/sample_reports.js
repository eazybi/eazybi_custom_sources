app.defineSampleReports((samples) => {
  var folderName = "Samples Help Scout";

  // The months of the period the Time page filter selects. The page dimension carries the same
  // members as `current_page_members`, so changing the page selection moves the rows with it.
  var TIME_ROWS = {
    name: "Time",
    selected_set: ["[Time].[Last 12 months]"],
    selected_set_expression: "DescendantsSet({{selected_set}}, [Time].[Month])"
  };

  // The period every Time page filter starts on. A calculated Time member is shown as the current
  // page selection only when the page dimension lists it in `members` as well — without that the
  // filter reads "(none)".
  var TIME_PAGE_CURRENT = ["[Time].[Last 12 months]"];
  var TIME_PAGE_MEMBERS = [{full_name: "[Time].[Last 12 months]", name: "Last 12 months"}];

  // The shorter Time page selection of the dashboard and of the reports that also have Time on
  // rows.
  var TIME_PAGE_SET = ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current year]",
                       "[Time].[Previous year]"];

  // The Time page filter of a report that also has Time on rows.
  var TIME_PAGE_DUPLICATE = {
    name: "Time",
    duplicate: true,
    selected_set: TIME_PAGE_SET,
    current_page_members: TIME_PAGE_CURRENT,
    members: TIME_PAGE_MEMBERS
  };

  // The Time page filter of a report that does not have Time on rows.
  var TIME_PAGE = {
    name: "Time",
    selected_set: ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current month]",
                   "[Time].[Previous month]", "[Time].[Current year]", "[Time].[Previous year]"],
    current_page_members: TIME_PAGE_CURRENT,
    members: TIME_PAGE_MEMBERS
  };

  // The Time page filter of the dashboard, filtering every report that has Time in its own pages.
  var TIME_PAGE_DASHBOARD = {
    name: "Time",
    selected_set: TIME_PAGE_SET,
    current_page_members: TIME_PAGE_CURRENT,
    members: TIME_PAGE_MEMBERS
  };

  // A page filter on the All member of a dimension, so that users discover what they can filter a
  // sample report by. `DefaultMember` is the All member, without repeating its name here.
  function allPages(dimensionNames) {
    return dimensionNames.map((dimensionName) => {
      return {name: dimensionName, selected_set: [`[${dimensionName}].DefaultMember`]};
    });
  }

  // A dimension that is both on rows and in pages: the rows expand the page selection into the
  // members of the level, so that the page filter — and the dashboard filter linked to it — moves
  // the rows with it. The page filter starts on the All member, so the rows show the whole level.
  function levelRows(dimensionName, allMemberName) {
    return {
      name: dimensionName,
      selected_set: [`[${dimensionName}].[${allMemberName}]`],
      selected_set_expression: `DescendantsSet({{selected_set}}, [${dimensionName}].[${dimensionName}])`
    };
  }

  function duplicatePage(dimensionName) {
    return {name: dimensionName, duplicate: true, selected_set: [`[${dimensionName}].DefaultMember`]};
  }

  // The dimensions the dashboard filters all its reports by. Every report repeats them in its own
  // pages — a report that has one of them on rows uses the duplicate page pattern above, because a
  // dashboard filter reaches only the reports that carry the dimension in their pages.
  var DASHBOARD_DIMENSIONS = ["Inbox", "Channel", "Tag", "Assignee", "Closed By"];

  samples.report({
    name: "Conversations over time",
    folderName: folderName,
    resultView: "line_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Conversations created]",
          "[Measures].[Conversations closed]"
        ]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["Inbox", "Status", "Channel", "Source", "Tag", "Assignee", "Closed By", "Customer",
                  "Organization"]))},
      options: {nonempty: true},
      view: {
        current: "line_chart",
        line_chart: {series_options: {
          "Conversations created": {type: "column", color: samples.color("$blue-6")},
          "Conversations closed": {type: "column", color: samples.color("$green-6")}
        }}
      }
    }
  });

  // The headline numbers of each inbox — a row of value tiles at the top of the dashboard.
  samples.report({
    name: "Conversations by inbox",
    folderName: folderName,
    resultView: "gauge",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Conversations created]",
          "[Measures].[Conversations closed]",
          "[Measures].[Average first reply hours]",
          "[Measures].[Average closing hours]"
        ]}
      ]},
      rows: {dimensions: [levelRows("Inbox", "All Inboxes")]},
      pages: {dimensions: [TIME_PAGE, duplicatePage("Inbox")].concat(
        allPages(["Status", "Channel", "Source", "Tag", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {current: "gauge", gauge: {only_values: true}}
    }
  });

  samples.report({
    name: "Response and resolution times",
    folderName: folderName,
    resultView: "line_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Average first reply hours]",
          "[Measures].[Average response hours]",
          "[Measures].[Average closing hours]"
        ]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["Inbox", "Channel", "Tag", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {
        current: "line_chart",
        line_chart: {series_options: {
          "Average first reply hours": {color: samples.color("$orange-6")},
          "Average response hours": {color: samples.color("$orange-3")},
          "Average closing hours": {color: samples.color("$purple-6")}
        }}
      }
    }
  });

  // The two interval dimensions bucket the conversation durations, so the distribution behind the
  // average response time is one report away.
  samples.report({
    name: "First reply time distribution",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Conversations with first reply]"]}
      ]},
      rows: {dimensions: [
        {name: "First reply interval",
         selected_set: ["[First reply interval].[First reply interval].Members"]}
      ]},
      pages: {dimensions: [TIME_PAGE].concat(
        allPages(["Inbox", "Channel", "Tag", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {data_labels: true, series_options: {
          "Conversations with first reply": {color: samples.color("$orange-7")}
        }}
      }
    }
  });

  samples.report({
    name: "Conversations by tag",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Conversations created]"]}
      ]},
      rows: {
        dimensions: [levelRows("Tag", "All Tags")],
        order_by: {expression: ["[Measures].[Conversations created]"], order: "DESC"}
      },
      pages: {dimensions: [TIME_PAGE, duplicatePage("Tag")].concat(
        allPages(["Inbox", "Status", "Channel", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {vertical: false, data_labels: true, series_options: {
          "Conversations created": {color: samples.color("$teal-7")}
        }}
      }
    }
  });

  samples.report({
    name: "Replies by agent",
    oldName: "Messages by author",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Agent replies created]",
          "[Measures].[Notes created]",
          "[Measures].[Customers helped]",
          "[Measures].[Average response hours]",
          "[Measures].[Happiness score]"
        ]}
      ]},
      rows: {
        dimensions: [{name: "Agent", selected_set: ["[Agent].[Agent].Members"]}],
        order_by: {expression: ["[Measures].[Agent replies created]"], order: "DESC"}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Inbox", "Channel", "Tag", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Happiness over time",
    folderName: folderName,
    resultView: "line_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Ratings]",
          "[Measures].[Happiness score]"
        ]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["Inbox", "Channel", "Tag", "Agent", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {
        current: "line_chart",
        line_chart: {series_options: {
          "Ratings": {type: "column", color: samples.color("$neutral-3")},
          // A percentage on a second axis, because it does not share the scale of the rating counts.
          "Happiness score": {type: "line", separateAxis: 1, color: samples.color("$green-7")}
        }}
      }
    }
  });

  // The customers behind the conversation volume — a busy period of few customers writing often is
  // not the same as one of many customers writing once.
  samples.report({
    name: "Customers helped over time",
    folderName: folderName,
    resultView: "line_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Customers]",
          "[Measures].[Customers helped]"
        ]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["Inbox", "Channel", "Source", "Tag", "Assignee", "Closed By", "Organization"]))},
      options: {nonempty: true},
      view: {
        current: "line_chart",
        line_chart: {series_options: {
          "Customers": {type: "column", color: samples.color("$neutral-3")},
          "Customers helped": {type: "line", color: samples.color("$teal-7")}
        }}
      }
    }
  });

  // How many messages it took to close a conversation — the conversations answered once and the
  // ones that turned into a long exchange.
  samples.report({
    name: "Closed conversations by message count",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Conversations closed]"]}
      ]},
      rows: {dimensions: [
        {name: "Message count interval",
         selected_set: ["[Message count interval].[Message count interval].Members"]}
      ]},
      pages: {dimensions: [TIME_PAGE].concat(
        allPages(["Inbox", "Channel", "Tag", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {data_labels: true, series_options: {
          "Conversations closed": {color: samples.color("$blue-7")}
        }}
      }
    }
  });

  // When the customers write in, so that the team can be there when they do.
  samples.report({
    name: "Busiest time of day",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Conversations created]"]}
      ]},
      rows: {dimensions: [
        {name: "Hour", selected_set: ["[Hour].[Hour].Members"]}
      ]},
      pages: {dimensions: [TIME_PAGE].concat(
        allPages(["Inbox", "Status", "Channel", "Source", "Tag", "Assignee", "Closed By"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {series_options: {
          "Conversations created": {color: samples.color("$teal-3")}
        }}
      }
    }
  });

  samples.dashboard({
    name: "Help Scout overview",
    // The inbox value tiles first, the charts in pairs, and the agent table last. The first report
    // of every row starts it explicitly, because the reports of a row differ in height and the
    // automatic flow would otherwise fit the next report beside the taller one of the previous row.
    reports: [
      {folderName: folderName, name: "Conversations by inbox", width: 100},
      {folderName: folderName, name: "Conversations over time", width: 50, clear: "left"},
      {folderName: folderName, name: "Response and resolution times", width: 50},
      {folderName: folderName, name: "First reply time distribution", width: 50, clear: "left"},
      {folderName: folderName, name: "Conversations by tag", width: 50},
      {folderName: folderName, name: "Closed conversations by message count", width: 50, clear: "left"},
      {folderName: folderName, name: "Customers helped over time", width: 50},
      {folderName: folderName, name: "Busiest time of day", width: 50, clear: "left"},
      {folderName: folderName, name: "Happiness over time", width: 50},
      {folderName: folderName, name: "Replies by agent", width: 100, clear: "left"}
    ],
    // The common page dimensions filter every dashboard report at once — each one reaches the
    // reports that carry the same dimension in their own pages. The dashboard filter bar shows
    // them, so they are hidden inside the individual reports.
    definition: {
      pages: [TIME_PAGE_DASHBOARD].concat(allPages(DASHBOARD_DIMENSIONS)),
      pages_options: {hide_common: true}
    }
  });
});
