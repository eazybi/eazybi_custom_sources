app.defineSampleReports((samples) => {
  var folderName = "Samples Runkeeper";

  // The months of the period the Time page filter selects. The page dimension carries the same
  // members as `current_page_members`, so changing the page selection moves the rows with it.
  var TIME_ROWS = {
    name: "Time",
    selected_set: ["[Time].[Last 12 months]"],
    selected_set_expression: "DescendantsSet({{selected_set}}, [Time].[Month])"
  };

  // A calculated Time member is shown as the current page selection only when the page dimension lists
  // it in `members` as well — without that the filter reads "(none)".
  var TIME_PAGE_CURRENT = ["[Time].[Last 12 months]"];
  var TIME_PAGE_MEMBERS = [{full_name: "[Time].[Last 12 months]", name: "Last 12 months"}];
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

  // The Time page filter of a report that does not have Time on rows, and of the dashboard.
  var TIME_PAGE = {
    name: "Time",
    selected_set: ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Last 30 days]",
                   "[Time].[Current year]", "[Time].[Previous year]"],
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

  // The dimensions the dashboard filters all its reports by, repeated in the pages of each report.
  var DASHBOARD_DIMENSIONS = ["Activity type", "Distance range", "Friend"];

  samples.report({
    name: "Distance by month",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Distance km]", "[Measures].[Activities]"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(allPages(DASHBOARD_DIMENSIONS))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {series_options: {
          "Distance km": {color: samples.color("$blue-6")},
          "Activities": {type: "line", color: samples.color("$orange-6"), separateAxis: 1}
        }}
      }
    }
  });

  samples.report({
    name: "Pace and heart rate by month",
    folderName: folderName,
    resultView: "line_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Average pace]", "[Measures].[Average heart rate]"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(allPages(DASHBOARD_DIMENSIONS))},
      options: {nonempty: true},
      view: {
        current: "line_chart",
        line_chart: {series_options: {
          "Average pace": {type: "spline", color: samples.color("$blue-6")},
          "Average heart rate": {type: "spline", color: samples.color("$red-6"), separateAxis: 1}
        }}
      }
    }
  });

  // Every year of the history, whatever period the dashboard shows: the report has no Time page.
  samples.report({
    name: "Yearly summary",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Activities]", "[Measures].[Distance km]", "[Measures].[Duration]",
          "[Measures].[Average distance km]", "[Measures].[Average pace]", "[Measures].[Longest distance km]",
          "[Measures].[Fastest km]", "[Measures].[Climb m]", "[Measures].[Average heart rate]",
          "[Measures].[Max heart rate]"
        ]}
      ]},
      rows: {dimensions: [{name: "Time", selected_set: ["[Time].[Year].Members"]}]},
      pages: {dimensions: allPages(DASHBOARD_DIMENSIONS)},
      options: {nonempty: true, total: "rows"},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Activities by hour and week day",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Activities]"]},
        {name: "Week Day", selected_set: ["[Week Day].[Week Day].Members"]}
      ]},
      rows: {dimensions: [{name: "Hour", selected_set: ["[Hour].[Hour].Members"]}]},
      pages: {dimensions: [TIME_PAGE].concat(allPages(DASHBOARD_DIMENSIONS))},
      options: {nonempty: true, total: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Time in heart rate zones by month",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Time in zone]"]},
        {name: "Heart rate zone", selected_set: ["[Heart rate zone].[Heart rate zone].Members"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(allPages(DASHBOARD_DIMENSIONS))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {
          stacked: "percentage",
          series_options: {
            "Below zone 1": {color: samples.color("$neutral-3")},
            "Zone 1 (50-60%)": {color: samples.color("$blue-3")},
            "Zone 2 (60-70%)": {color: samples.color("$green-6")},
            "Zone 3 (70-80%)": {color: samples.color("$orange-3")},
            "Zone 4 (80-90%)": {color: samples.color("$orange-6")},
            "Zone 5 (90-100%)": {color: samples.color("$red-6")}
          }
        }
      }
    }
  });

  // The pace of each kilometer of the activities, the latest first.
  samples.report({
    name: "Kilometer splits",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Split pace]"]},
        {name: "Kilometer", selected_set: ["[Kilometer].[Kilometer].Members"]}
      ]},
      rows: {
        dimensions: [{name: "Activity", selected_set: ["[Activity].[Activity].Members"]}],
        order_by: {expression: ["[Measures].[Activity start time]"], order: "DESC"},
        nonempty_crossjoin: true
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(DASHBOARD_DIMENSIONS))},
      options: {nonempty: true},
      view: {current: "table", table: {freeze_header: true}}
    }
  });

  samples.report({
    name: "Activities",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Distance km]", "[Measures].[Duration]", "[Measures].[Average pace]",
          "[Measures].[Fastest km]", "[Measures].[Climb m]", "[Measures].[Average heart rate]",
          "[Measures].[Max heart rate]", "[Measures].[Calories]", "[Measures].[Activity route name]",
          "[Measures].[Activity friends]", "[Measures].[Activity notes]"
        ]}
      ]},
      rows: {
        dimensions: [{name: "Activity", selected_set: ["[Activity].[Activity].Members"]}],
        order_by: {expression: ["[Measures].[Activity start time]"], order: "DESC"},
        nonempty_crossjoin: true
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(DASHBOARD_DIMENSIONS.concat(["Hour", "Week Day"])))},
      options: {nonempty: true},
      view: {current: "table", table: {freeze_header: true}}
    }
  });

  samples.dashboard({
    name: "Runkeeper overview",
    reports: [
      {folderName: folderName, name: "Distance by month", width: 50},
      {folderName: folderName, name: "Pace and heart rate by month", width: 50},
      {folderName: folderName, name: "Time in heart rate zones by month", width: 50, clear: "left"},
      {folderName: folderName, name: "Activities by hour and week day", width: 50},
      {folderName: folderName, name: "Yearly summary", width: 100, clear: "left"}
    ],
    // The common page dimensions filter every dashboard report at once — each one reaches the reports
    // that carry the same dimension in their own pages. The Yearly summary has no Time page, so it shows
    // every year whatever period the dashboard is filtered by.
    definition: {
      pages: [{
        name: "Time",
        selected_set: TIME_PAGE_SET,
        current_page_members: TIME_PAGE_CURRENT,
        members: TIME_PAGE_MEMBERS
      }].concat(allPages(DASHBOARD_DIMENSIONS)),
      pages_options: {hide_common: true}
    }
  });
});
