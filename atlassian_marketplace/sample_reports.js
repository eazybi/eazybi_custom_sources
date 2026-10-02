app.defineSampleReports((samples) => {
  var folderName = "Samples Atlassian Marketplace";

  // The months of the period the Time page filter selects. The page dimension carries the same
  // members as `current_page_members`, so changing the page selection moves the rows with it.
  var TIME_ROWS = {
    name: "Time",
    selected_set: ["[Time].[Last 12 months]"],
    selected_set_expression: "DescendantsSet({{selected_set}}, [Time].[Month])"
  };

  // A calculated Time member is shown as the current page selection only when the page dimension
  // lists it in `members` as well — without that the filter reads "(none)".
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

  // The Time page filter of a report that does not have Time on rows.
  var TIME_PAGE = {
    name: "Time",
    selected_set: ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current month]",
                   "[Time].[Previous month]", "[Time].[Current year]", "[Time].[Previous year]"],
    current_page_members: TIME_PAGE_CURRENT,
    members: TIME_PAGE_MEMBERS
  };

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

  // A dimension that is both on an axis and in pages: the axis expands the page selection into the
  // members of the level, so that the page filter — and the dashboard filter linked to it — moves
  // the axis with it. The page filter starts on the All member, so the axis shows the whole level.
  function levelMembers(dimensionName, allMemberName) {
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
  // pages — a report that has one of them on rows or columns uses the duplicate page pattern above,
  // because a dashboard filter reaches only the reports that carry the dimension in their pages.
  // The one exception is the partner type report: it has the Type hierarchy of Partner on columns,
  // and a page filter of the main hierarchy would return it empty.
  var DASHBOARD_DIMENSIONS = ["App", "Hosting", "Country", "Partner"];

  samples.report({
    name: "Sales by month and hosting",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Vendor amount]"]},
        levelMembers("Hosting", "All Hostings")
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE, duplicatePage("Hosting")].concat(
        allPages(["App", "Country", "Partner", "Sale Type", "Billing Period", "License Tier"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: true, series_options: {
          "Cloud": {color: samples.color("$blue-6")},
          "Data Center": {color: samples.color("$purple-6")},
          "Server": {color: samples.color("$neutral-6")}
        }}
      }
    }
  });

  samples.report({
    name: "Sales by month and sale type",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Vendor amount]"]},
        {name: "Sale Type", selected_set: ["[Sale Type].[Sale Type].Members"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["App", "Hosting", "Country", "Partner", "Product Edition"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: true, series_options: {
          "New": {color: samples.color("$blue-7")},
          "Renewal": {color: samples.color("$green-6")},
          "Upgrade": {color: samples.color("$teal-3")},
          "Downgrade": {color: samples.color("$orange-3")},
          "Refund": {color: samples.color("$red-6")}
        }}
      }
    }
  });

  // Which share of the revenue the partners bring, and which of them.
  samples.report({
    name: "Sales by month and partner type",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Vendor amount]"]},
        {name: "Partner", selected_set: ["[Partner.Type].[Type].Members"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["App", "Hosting", "Country", "License Tier"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: true}
      }
    }
  });

  // A vendor has a long tail of partners, so the report keeps the 50 that bring the most revenue.
  samples.report({
    name: "Top partners",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Vendor amount]",
          "[Measures].[Partner discount amount]",
          "[Measures].[Transactions]",
          "[Measures].[Customers]"
        ]}
      ]},
      rows: {
        dimensions: [levelMembers("Partner", "All Partners")],
        extreme_by: {expression: ["[Measures].[Vendor amount]"], extreme: "top_count", limit: "50"}
      },
      pages: {dimensions: [TIME_PAGE, duplicatePage("Partner")].concat(
        allPages(["App", "Hosting", "Country", "Sale Type", "License Tier"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Sales by country",
    folderName: folderName,
    resultView: "map_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Vendor amount]",
          "[Measures].[Transactions]",
          "[Measures].[Customers]"
        ]}
      ]},
      rows: {
        dimensions: [levelMembers("Country", "All Countries")],
        order_by: {expression: ["[Measures].[Vendor amount]"], order: "DESC"}
      },
      pages: {dimensions: [TIME_PAGE, duplicatePage("Country")].concat(
        allPages(["App", "Hosting", "Partner"]))},
      options: {nonempty: "rows"},
      view: {
        current: "map_chart",
        map_chart: {map_type: "static", map_name: "world-en", show_legend: false}
      }
    }
  });

  // Which customer sizes the revenue comes from.
  samples.report({
    name: "Sales by user tier",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Vendor amount]"]}
      ]},
      rows: {dimensions: [
        {name: "License Tier", selected_set: ["[License Tier].[Range].Members"]}
      ]},
      pages: {dimensions: [TIME_PAGE].concat(
        allPages(["App", "Hosting", "Country", "Partner", "Product Edition"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {vertical: false, data_labels: true, series_options: {
          "Vendor amount": {color: samples.color("$teal-7")}
        }}
      }
    }
  });

  // Monthly billing exists on cloud only, so this report reads the cloud share of the revenue by
  // itself. The hosting is left to the dashboard filter: a Cloud page selection of the report
  // would be replaced by the common Hosting page dimension of the dashboard anyway.
  samples.report({
    name: "Sales by month and billing period",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Vendor amount]"]},
        {name: "Billing Period", selected_set: ["[Billing Period].[Billing Period].Members"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["App", "Hosting", "Country", "Partner", "Product Edition"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: true, series_options: {
          "Monthly": {color: samples.color("$blue-3")},
          "Annual": {color: samples.color("$blue-7")}
        }}
      }
    }
  });

  // The licenses a vendor is paid for at the end of each month — the base the renewals come from.
  samples.report({
    name: "Active maintained licenses by month",
    folderName: folderName,
    resultView: "line_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Active maintained licenses]"]},
        levelMembers("Hosting", "All Hostings")
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE, duplicatePage("Hosting")].concat(
        allPages(["App", "Country", "Partner", "License Tier", "Billing Period"]))},
      options: {nonempty: true},
      view: {current: "line_chart"}
    }
  });

  samples.report({
    name: "New licenses by month and type",
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Licenses]"]},
        {name: "License Type", selected_set: ["[License Type].[License Type].Members"]}
      ]},
      rows: {dimensions: [TIME_ROWS]},
      pages: {dimensions: [TIME_PAGE_DUPLICATE].concat(
        allPages(["App", "Hosting", "Country", "Partner", "License Status"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: true}
      }
    }
  });

  samples.report({
    name: "Licenses by app and status",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Licenses]",
          "[Measures].[Evaluation licenses]",
          "[Measures].[Paid licenses]",
          "[Measures].[Free licenses]"
        ]}
      ]},
      rows: {dimensions: [
        levelMembers("App", "All Apps"),
        {name: "License Status", selected_set: ["[License Status].[License Status].Members"]}
      ]},
      pages: {dimensions: [{
        name: "Time",
        selected_set: TIME_PAGE_SET,
        current_page_members: ["[Time].[All Times]"]
      }, duplicatePage("App")].concat(allPages(["Hosting", "Country", "Partner", "License Tier"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  // The sales of the last 5 days, one row per transaction line — the report a vendor opens to see
  // what came in. The row filter on the transaction date, not the Time page selection, is what keeps
  // the table short: the Time filter of the dashboard replaces the page selection of the report.
  samples.report({
    name: "Last sales",
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [
        {name: "Measures", selected_set: [
          "[Measures].[Transaction date]",
          "[Measures].[Transaction customer]",
          "[Measures].[Transaction app]",
          "[Measures].[Transaction sale type]",
          "[Measures].[Transaction hosting]",
          "[Measures].[Transaction tier]",
          "[Measures].[Transaction partner]",
          "[Measures].[Purchase price]",
          "[Measures].[Vendor amount]"
        ]}
      ]},
      rows: {
        dimensions: [{name: "Transaction",
          selected_set: ["[Transaction].[Transaction].Members"]}],
        order_by: {expression: ["[Measures].[Transaction date]"], order: "DESC"},
        filter_by: {conditions: [{expression: ["[Measures].[Transaction date]"],
          operator: ">=", value: "5 days ago", value_type: "date"}]}
      },
      pages: {dimensions: [{
        name: "Time",
        selected_set: ["[Time].[Last 30 days]", "[Time].[Last 12 months]",
                       "[Time].[Current month]", "[Time].[Previous month]"],
        current_page_members: ["[Time].[Last 30 days]"],
        members: [{full_name: "[Time].[Last 30 days]", name: "Last 30 days"}]
      }].concat(allPages(["App", "Hosting", "Country", "Partner", "Sale Type",
                          "Payment Status"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.dashboard({
    name: "Atlassian Marketplace sales",
    // The first report of every row starts it, because a chart and a table of the row before it
    // differ in height and the next report would otherwise float beside the taller one.
    reports: [
      {folderName: folderName, name: "Sales by month and hosting", width: 50, clear: "left"},
      {folderName: folderName, name: "Sales by month and sale type", width: 50},
      {folderName: folderName, name: "Sales by month and partner type", width: 50, clear: "left"},
      {folderName: folderName, name: "Top partners", width: 50},
      {folderName: folderName, name: "Sales by country", width: 50, clear: "left"},
      {folderName: folderName, name: "Sales by user tier", width: 50},
      {folderName: folderName, name: "Sales by month and billing period", width: 50, clear: "left"},
      {folderName: folderName, name: "Active maintained licenses by month", width: 50},
      {folderName: folderName, name: "New licenses by month and type", width: 50, clear: "left"},
      {folderName: folderName, name: "Licenses by app and status", width: 50},
      {folderName: folderName, name: "Last sales", width: 100, clear: "left"}
    ],
    // The common page dimensions filter every dashboard report at once — each one reaches the
    // reports that carry the same dimension in their own pages. `hide_common: "all_member"` keeps
    // the filter of a report out of its header while the dashboard filter is on the All member, so
    // that the same filter is not shown twice, and brings it back once a member is selected.
    definition: {
      pages: [TIME_PAGE_DASHBOARD].concat(allPages(DASHBOARD_DIMENSIONS)),
      pages_options: {hide_common: "all_member"}
    }
  });
});
