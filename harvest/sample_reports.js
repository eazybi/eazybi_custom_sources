// The seven sample reports of the built-in Harvest source application, new reports of the two cubes of
// this app, and a dashboard of the reports which answer what a Harvest account is opened for.
app.defineSampleReports((samples) => {
  var folderName = "Samples Harvest";
  // The cube names of schema_definition.js, which the host reports as "Harvest Timesheets" and
  // "Harvest Invoices".
  var TIMESHEETS = "Timesheets";
  var INVOICES = "Invoices";

  // Every report of the built-in Harvest application opens on the whole history of the account, because
  // a timesheet report is read as a total as often as it is read as a trend. The predefined Time members
  // are offered next to it, so that a user narrows a report to a period without building a member first.
  var TIME_PAGE = {
    name: "Time",
    selected_set: ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current month]",
                   "[Time].[Previous month]", "[Time].[Current year]", "[Time].[Previous year]"],
    current_page_members: ["[Time].[All Times]"]
  };

  // The shorter Time selection of the dashboard and of the report which has Time on rows as well.
  var TIME_PAGE_SET = ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current year]",
                       "[Time].[Previous year]"];

  var TIME_PAGE_DUPLICATE = {
    name: "Time",
    duplicate: true,
    selected_set: TIME_PAGE_SET,
    current_page_members: ["[Time].[All Times]"]
  };

  var TIME_PAGE_DASHBOARD = {
    name: "Time",
    selected_set: TIME_PAGE_SET,
    current_page_members: ["[Time].[All Times]"]
  };

  function measureFullName(name) {
    return `[Measures].[${name}]`;
  }

  function measureColumns(names) {
    return {name: "Measures", selected_set: names.map(measureFullName)};
  }

  function measurePage(names) {
    return {name: "Measures", selected_set: names.map(measureFullName),
            current_page_members: [measureFullName(names[0])]};
  }

  // A page filter on the All member of a dimension, so that users discover what they can filter a sample
  // report by.
  function allPages(dimensionNames) {
    return dimensionNames.map((dimensionName) => {
      return {name: dimensionName, selected_set: [`[${dimensionName}].DefaultMember`]};
    });
  }

  // The page dimensions of a dashboard of several cubes name the cube they are resolved in themselves.
  function cubePages(cubeName, pages) {
    return pages.map((page) => Object.assign({cube_name: cubeName}, page));
  }

  function dashboardReport(cubeName, name, options) {
    return Object.assign({cubeName: cubeName, folderName: folderName, name: name}, options);
  }

  samples.report({
    name: "Sample hours by client",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Rounded hours", "Billable hours", "Billable hours %",
                                             "Project currency", "Billable amount"])]},
      // The project currency is a property, which every client has, so a client without hours in the
      // period is left out by its hours.
      rows: {
        dimensions: [{name: "Project Task", selected_set: ["[Project Task].[Client].Members"]}],
        filter_by: {conditions: [{expression: ["[Measures].[Rounded hours]"], operator: ">", value: "0"}]}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Task", "Person"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  // The hours of every Harvest role and of the people who have it. A person with several roles is listed
  // under each of them with all their hours, so the roles do not add up to the total.
  samples.report({
    name: "Sample hours by role",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Rounded hours", "Billable hours", "Unbillable hours",
                                             "Billable hours %"])]},
      rows: {dimensions: [{name: "Role", selected_set: ["[Role].[Role].Members"]},
                          {name: "Person", selected_set: ["[Person].[Person].Members"]}]},
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Project Task", "Task"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  // A person who writes a note on every entry is still listed, with Hours without notes 0.
  samples.report({
    name: "Sample hours without notes",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Hours", "Hours with notes", "Hours without notes"])]},
      rows: {
        dimensions: [{name: "Person", selected_set: ["[Person].[Person].Members"]}],
        order_by: {expression: ["[Measures].[Hours without notes]"], order: "DESC"}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Project Task", "Task"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Sample business and non-business hours by person",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [{name: "Working Time", selected_set: ["[Working Time].[Working Time].Members"]}]},
      rows: {
        dimensions: [{name: "Person", selected_set: ["[Person].[Person].Members"]}],
        order_by: {expression: ["[Measures].[Hours]"], order: "DESC"}
      },
      pages: {dimensions: [
        TIME_PAGE,
        measurePage(["Hours", "Rounded hours", "Billable hours"])
      ].concat(allPages(["Project Status", "Project Task", "Task"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: false, series_options: {
          "Business hours": {color: samples.color("$blue-6")},
          "Non-business hours": {color: samples.color("$orange-6")}
        }}
      }
    }
  });

  samples.report({
    name: "Sample hours by external item",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Hours", "Billable hours", "Unbillable hours"])]},
      rows: {
        dimensions: [{name: "External Item", selected_set: ["[External Item].[Service].Members"]}],
        order_by: {expression: ["[Measures].[Hours]"], order: "DESC"}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Project Task", "Person"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  // Shows where the Harvest integrations are not used.
  samples.report({
    name: "Sample linked hours by person",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Hours", "Linked hours", "Unlinked hours", "Linked hours %"])]},
      rows: {
        dimensions: [{name: "Person", selected_set: ["[Person].[Person].Members"]}],
        order_by: {expression: ["[Measures].[Linked hours %]"], order: "ASC"}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Project Task", "Task"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  // How much of the capacity of every person is tracked, and billable, the least used first. It opens on
  // the previous month: the capacity runs to the end of the current year, so a period of days still to
  // come has capacity and no time yet.
  samples.report({
    name: "Sample utilisation by person",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Capacity hours", "Hours", "Utilisation %", "Billable hours",
                                             "Billable utilisation %"])]},
      rows: {
        dimensions: [{name: "Person", selected_set: ["[Person].[Person].Members"]}],
        order_by: {expression: ["[Measures].[Utilisation %]"], order: "ASC"}
      },
      // A page filter of calculated members lists the one it starts on in `members`, or shows "(none)".
      pages: {dimensions: [Object.assign({}, TIME_PAGE, {
        current_page_members: ["[Time].[Previous month]"],
        members: [{full_name: "[Time].[Previous month]", name: "Previous month"}]
      })].concat(allPages(["Role"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Sample uninvoiced hours and expenses",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Uninvoiced hours", "Project currency", "Uninvoiced amount",
                                             "Uninvoiced expenses"])]},
      rows: {
        dimensions: [{name: "Project Task", selected_set: ["[Project Task].[Client].Members"]}],
        filter_by: {conditions: [
          {expression: ["[Measures].[Uninvoiced amount with expenses]"], operator: ">", value: "0"}
        ]}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Task", "Person"]))},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Sample active projects status",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Project manager", "Rounded hours", "Billable hours",
                                             "Billable hours %", "Project budget by", "Budgeted hours",
                                             "Budgeted cost", "Expenses amount", "Budget spent %",
                                             "Project currency"])]},
      rows: {dimensions: [{name: "Project Task", selected_set: ["[Project Task].[Project].Members"]}]},
      // The report is about the projects which are running, so its status filter starts on Active and
      // offers the archived projects next to it. It has no Time filter: a budget is spent or it is not,
      // whatever period the hours of it were tracked in.
      pages: {dimensions: [
        {name: "Project Status",
         selected_set: ["[Project Status].DefaultMember", "[Project Status].[Project Status].Members"],
         current_page_members: ["[Project Status].[Active]"]}
      ].concat(allPages(["Task", "Person"]))},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Sample billable vs unbillable hours by project",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [measureColumns(["Billable hours", "Unbillable hours"])]},
      rows: {
        dimensions: [{name: "Project Task", selected_set: ["[Project Task].[Project].Members"]}],
        order_by: {expression: ["[Measures].[Rounded hours]"], order: "DESC"}
      },
      pages: {dimensions: [TIME_PAGE].concat(allPages(["Project Status", "Task", "Person"]))},
      options: {nonempty: true},
      view: {
        current: "bar_chart",
        bar_chart: {stacked: true, vertical: false, series_options: {
          "Billable hours": {color: samples.color("$green-6")},
          "Unbillable hours": {color: samples.color("$neutral-3")}
        }}
      }
    }
  });

  samples.report({
    name: "Sample hours by task and month",
    cubeName: TIMESHEETS,
    folderName: folderName,
    resultView: "pie_chart",
    definition: {
      columns: {dimensions: [{name: "Time", selected_set: ["[Time].[Month].Members"]}]},
      rows: {dimensions: [{name: "Task", selected_set: ["[Task].[Task].Members"]}]},
      // The measure is a page filter here: the same breakdown of the billable hours or of the billable
      // amount is one selection away. The amount is a converted one, because the projects of an account
      // are billed in the currency of each client.
      pages: {dimensions: [
        measurePage(["Rounded hours", "Billable hours", "Unbillable hours", "Billable amount EUR",
                     "Billable amount USD"])
      ].concat(allPages(["Project Status", "Project Task", "Person"]))},
      options: {nonempty: true},
      view: {current: "pie_chart", pie_chart: {show_legend: true, relative_size: true}}
    }
  });

  samples.report({
    name: "Sample unpaid invoices",
    cubeName: INVOICES,
    folderName: folderName,
    resultView: "table",
    definition: {
      columns: {dimensions: [measureColumns(["Invoice status", "Invoice issued date", "Invoice due date",
                                             "Invoice currency", "Invoice amount", "Item amount",
                                             "Due amount"])]},
      rows: {
        dimensions: [{name: "Invoice", selected_set: ["[Invoice].[Invoice].Members"]}],
        order_by: {expression: ["[Measures].[Invoice issued date]"], order: "ASC"},
        filter_by: {conditions: [
          {expression: ["[Measures].[Invoice status]"], operator: "<>", value: "Paid"}
        ]}
      },
      // No Time filter: an invoice is unpaid now, whatever period it was issued in, and a period without
      // its amounts would list it empty.
      pages: {dimensions: allPages(["Invoice Status", "Client Project", "Currency"])},
      // So that the page filters leave out the invoices they do not select.
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  // The amounts are the converted ones, because the invoices of an account are issued in the currency of
  // each client.
  samples.report({
    name: "Sample invoice amounts by month",
    cubeName: INVOICES,
    folderName: folderName,
    resultView: "bar_chart",
    definition: {
      columns: {dimensions: [{name: "Invoice Status",
                              selected_set: ["[Invoice Status].[Invoice Status].Members"]}]},
      // The months of the period the Time page filter selects, so that the filter — and the dashboard
      // filter linked to it — moves the rows of the report with it.
      rows: {dimensions: [{name: "Time", selected_set: ["[Time].[All Times]"],
                           selected_set_expression: "DescendantsSet({{selected_set}}, [Time].[Month])"}]},
      pages: {dimensions: [
        TIME_PAGE_DUPLICATE,
        measurePage(["Invoice amount EUR", "Invoice amount USD", "Item amount EUR", "Item amount USD"])
      ].concat(allPages(["Client Project"]))},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {stacked: true, vertical: true}}
    }
  });

  samples.dashboard({
    name: "Harvest overview",
    // The two charts side by side, the two tables under them. The first report of every row starts it
    // explicitly, because the reports of a row differ in height and the automatic flow would otherwise
    // fit the next report beside the taller one of the previous row.
    reports: [
      dashboardReport(TIMESHEETS, "Sample billable vs unbillable hours by project",
        {width: 50, clear: "left"}),
      dashboardReport(INVOICES, "Sample invoice amounts by month", {width: 50}),
      dashboardReport(TIMESHEETS, "Sample active projects status", {width: 100, clear: "left"}),
      dashboardReport(TIMESHEETS, "Sample uninvoiced hours and expenses", {width: 100, clear: "left"})
    ],
    // A common page dimension filters every dashboard report which carries the same dimension in its own
    // pages, and the dashboard filter bar shows them instead of the reports. The project status is not
    // one of them: it would override the Active projects the third report is about.
    definition: {
      pages: cubePages(TIMESHEETS, [TIME_PAGE_DASHBOARD].concat(allPages(["Task", "Person"]))).
        concat(cubePages(INVOICES, allPages(["Client Project"]))),
      pages_options: {hide_common: true}
    }
  });
});
