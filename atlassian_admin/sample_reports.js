// The reports of the product roles exist only while the "Import product roles" import option is enabled, so
// that no report shows no data.
//
// The reports and the dashboard have no Time page: the data is the current state of the organization, and its
// Time members are the last activity dates, which a period selection would turn into a filter of who was
// last active in it, leaving out everything never used.
app.defineSampleReports((samples) => {
  var FOLDER = "Samples Atlassian Admin";
  var USERS_OVERVIEW_REPORT = "Users overview";
  var USERS_BY_ADMIN_ROLE_REPORT = "Users by admin role";
  var USERS_BY_GROUP_REPORT = "Users by group";
  var PRODUCT_USERS_BY_SITE_REPORT = "Product users by site";
  var USER_PRODUCT_ACTIVITY_REPORT = "User product activity";
  var LICENSED_USERS_REPORT = "Licensed users by last activity";
  var PRODUCT_ROLES_REPORT = "Product users by product role";
  var PRODUCT_ADMINS_REPORT = "Admins by product";
  var importProductRoles = source.getExtraOption("import_product_roles") === true;
  // DefaultMember resolves the All member of the dimension on its own and needs no members entry.
  var ALL_SITES_PAGE = {name: "Site", selected_set: ["[Site].DefaultMember"]};
  var ALL_GROUPS_PAGE = {name: "Group", selected_set: ["[Group].DefaultMember"]};
  var ALL_PLANS_PAGE = {name: "Plan", selected_set: ["[Plan].DefaultMember"]};
  var ALL_STATUSES_PAGE = {name: "User Status", selected_set: ["[User Status].DefaultMember"]};
  // The headline numbers of the users — a row of value tiles at the top of the dashboard. An active user has
  // the Active account status, a user active in the last 30 days has used a product in them.
  samples.report({
    name: USERS_OVERVIEW_REPORT,
    folderName: FOLDER,
    resultView: "gauge",
    definition: {
      description: "The users of the organization, how many of them have an active account status, and how" +
        " many of them used any of the selected products in the last 30 days.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Users]",
        "[Measures].[Active users]",
        "[Measures].[Active users %]",
        "[Measures].[Users active in last 30 days]"
      ]}]},
      rows: {dimensions: [{name: "User", selected_set: ["[User].[All Users]"]}]},
      pages: {dimensions: [ALL_GROUPS_PAGE]},
      view: {current: "gauge", gauge: {only_values: true, show_full_caption: ["Measures"]}}
    }
  });

  // The users without an admin role are left out: they outnumber the admins by far and would dwarf their bars.
  // The product admins are known only with the product roles.
  var adminRoles = ["[Admin Role].[Org admin]", "[Admin Role].[Site admin]"];
  if (importProductRoles) adminRoles.push("[Admin Role].[Product admin]");
  samples.report({
    name: USERS_BY_ADMIN_ROLE_REPORT,
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "How many users hold each admin role in the organization, and how many of them have an" +
        " active account status. The users without an admin role are not shown.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Users]",
        "[Measures].[Active users]",
        "[Measures].[Inactive users]"
      ]}]},
      rows: {dimensions: [{name: "Admin Role", selected_set: adminRoles}]},
      pages: {dimensions: [ALL_GROUPS_PAGE, ALL_STATUSES_PAGE]},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {vertical: true, series_options: {
        "Users": {color: samples.color("$blue-6")},
        "Active users": {color: samples.color("$green-6")},
        "Inactive users": {color: samples.color("$neutral-3")}
      }}}
    }
  });

  samples.report({
    name: USERS_BY_GROUP_REPORT,
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "The active and inactive users of every org group by account status. A user in several" +
        " groups counts in each of them. Drill through a bar to list the users of the group.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Active users]",
        "[Measures].[Inactive users]"
      ]}]},
      rows: {
        dimensions: [{name: "Group", selected_set: ["[Group].[Group].Members"]}],
        order_by: {expression: ["[Measures].[Active users]"], order: "DESC"}
      },
      view: {current: "bar_chart", bar_chart: {stacked: true, show_full_caption: ["Group"], series_options: {
        "Active users": {color: samples.color("$green-6")},
        "Inactive users": {color: samples.color("$neutral-3")}
      }}}
    }
  });

  samples.report({
    name: PRODUCT_USERS_BY_SITE_REPORT,
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "The users with access to the products of every site, the licensed users among them, and" +
        " the unused licenses of the licensed users who never used the product.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Product users]",
        "[Measures].[Licensed users]",
        "[Measures].[Unused licenses]"
      ]}]},
      rows: {
        dimensions: [{name: "Site", selected_set: ["[Site].[Site].Members"]}],
        order_by: {expression: ["[Measures].[Product users]"], order: "DESC"}
      },
      pages: {dimensions: [{name: "Product", selected_set: ["[Product].DefaultMember"]}, ALL_PLANS_PAGE]},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {vertical: true, series_options: {
        "Product users": {color: samples.color("$blue-6")},
        "Licensed users": {color: samples.color("$green-6")},
        "Unused licenses": {color: samples.color("$neutral-3")}
      }}}
    }
  });

  // Product users drilled into the Inactivity interval, in one stack with its (none) member of the products
  // never used. The series colors are keyed by the bucket names eazyBI gives the default intervals, which an
  // account that changes the intervals loses, without the measure name: the chart moves a member shared by
  // every series into its title.
  // Only the tracked product access is shown, so that (none) is the access never used, and a product nobody
  // used, which is not tracked, has no bar.
  samples.report({
    name: USER_PRODUCT_ACTIVITY_REPORT,
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "The users of every product by how many days ago they were last active in it; (none) are" +
        " the users who never used it. The product access whose activity Atlassian does not track is left" +
        " out with the Tracked member of the Activity Tracking page.",
      columns: {dimensions: [
        {name: "Measures", selected_set: ["[Measures].[Product users]"],
          members: [{name: "Product users", full_name: "[Measures].[Product users]",
            drilled_into_dimension: "Inactivity interval"}]},
        {name: "Inactivity interval", selected_set: ["[Inactivity interval].[Inactivity interval].Members"]}
      ]},
      rows: {
        dimensions: [{name: "Product", selected_set: ["[Product].[Product].Members"]}],
        order_by: {expression: ["[Measures].[Product users]"], order: "DESC"}
      },
      pages: {dimensions: [
        // Started on the Tracked member as eazyBI saves it: listed in `members` under the expanded All member
        // with its parent_full_name.
        {name: "Activity Tracking", selected_set: ["[Activity Tracking].[All Activity Trackings]"],
          current_page_members: ["[Activity Tracking].[Tracked]"],
          members: [
            {full_name: "[Activity Tracking].[All Activity Trackings]", name: "All Activity Trackings",
              depth: 0, type: "all", drillable: true, expanded: true},
            {full_name: "[Activity Tracking].[Tracked]", name: "Tracked", depth: 1,
              parent_full_name: "[Activity Tracking].[All Activity Trackings]"}
          ]},
        ALL_SITES_PAGE, ALL_GROUPS_PAGE, ALL_PLANS_PAGE
      ]},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {stacked: true, series_options: {
        "... - 029": {color: samples.color("$green-6")},
        // The $orange-4 of the chart color picker, which the sample color tokens do not resolve.
        "030 - 089": {color: "#FF983D"},
        "090 - 179": {color: samples.color("$orange-6")},
        "180 - ...": {color: samples.color("$red-6")},
        "(none)": {color: samples.color("$neutral-3")}
      }}}
    }
  });

  // A row per licensed user, product and site, the licenses never used and then the longest unused ones first:
  // without the site, the license of a product on one site would show the activity on another. The licensed
  // users of Jira Service Management are its agents, which Atlassian bills, while the portal customers hold
  // the free Customer role, so its Product page member lists the agents. A dimension on rows is a page too
  // only as a duplicate page.
  samples.report({
    name: LICENSED_USERS_REPORT,
    folderName: FOLDER,
    resultView: "table",
    definition: {
      description: "The licensed users of every product and site with their last activity in it next to their" +
        " last activity in any selected product, the ones who never used the product first. Select a product" +
        " to list its licensed users, such as the agents of Jira Service Management, and a group to list a team.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Product last active date]",
        "[Measures].[Product inactive days]",
        "[Measures].[User last active date]",
        "[Measures].[User status]"
      ]}]},
      rows: {
        dimensions: [
          {name: "User", selected_set: ["[User].[User].Members"]},
          {name: "Product", selected_set: ["[Product].[Product].Members"]},
          {name: "Site", selected_set: ["[Site].[Site].Members"]}
        ],
        filter_by: {conditions: [{expression: ["[Measures].[Licensed users]"], operator: ">", value: "0"}]},
        order_by: {expression: ["[Measures].[Product last active date]"], order: "ASC"},
        nonempty_crossjoin: true
      },
      pages: {dimensions: [{name: "Product", duplicate: true, selected_set: ["[Product].DefaultMember"]},
        {name: "Site", duplicate: true, selected_set: ["[Site].DefaultMember"]},
        ALL_PLANS_PAGE, ALL_GROUPS_PAGE, ALL_STATUSES_PAGE]},
      view: {current: "table", table: {freeze_header: true}}
    }
  });

  if (importProductRoles) {
    // The All member column counts every user of the product once, the role columns count a user under each
    // role. The heatmap colors a role cell by its share of the product users instead of by its count, so that
    // a product with many users, such as the portal customers of Jira Service Management, does not take the
    // whole color scale; the All member column has no share and stays uncolored.
    samples.report({
      name: PRODUCT_ROLES_REPORT,
      folderName: FOLDER,
      resultView: "table",
      definition: {
        description: "The users of every product and how many of them hold each role on it: the users and" +
          " admins, who hold a license, and the roles without one. A user with several roles on a product" +
          " counts under each of them. The color of a role shows its share of the users of the product.",
        columns: {dimensions: [
          {name: "Measures", selected_set: ["[Measures].[Product users]"]},
          {name: "Product Role", selected_set: ["[Product Role].[All Product Roles]"],
            members: [{name: "All Product Roles", full_name: "[Product Role].[All Product Roles]", type: "all",
              depth: 0, drillable: true, expanded: true}]}
        ]},
        rows: {dimensions: [{name: "Product", selected_set: ["[Product].[Product].Members"]}]},
        pages: {dimensions: [ALL_SITES_PAGE, ALL_PLANS_PAGE]},
        view: {current: "table", table: {cell_formatting: {"[Measures].[Product users]": {
          type: "heatmap",
          mdx: `
            CASE WHEN NOT [Product Role].CurrentMember IS [Product Role].DefaultMember
              AND ([Measures].[Product users], [Product Role].DefaultMember) > 0 THEN
              [Measures].[Product users] / ([Measures].[Product users], [Product Role].DefaultMember)
            END`,
          rules: [{name: "min", value: 0}, {name: "max", value: 1, background_color: samples.color("$blue-3")}]
        }}}}
      }
    });

    // A stacked bar of every product with the sites as its segments. Site is on columns and a duplicate page
    // too: the page selection replaces the column selection, which the expression then expands to its sites.
    samples.report({
      name: PRODUCT_ADMINS_REPORT,
      folderName: FOLDER,
      resultView: "bar_chart",
      definition: {
        description: "How many users hold the product admin role of each product in each site, directly or" +
          " through a group. A user who is an admin of a product in several sites counts in each of them." +
          " Drill into a bar segment by User to list its admins.",
        columns: {dimensions: [
          {name: "Measures", selected_set: ["[Measures].[Product admins]"]},
          {name: "Site", selected_set: ["[Site].[All Sites]"],
            selected_set_expression: "DescendantsSet({{selected_set}}, [Site].[Site])"}
        ]},
        rows: {
          dimensions: [{name: "Product", selected_set: ["[Product].[Product].Members"]}],
          order_by: {expression: ["[Measures].[Product admins]"], order: "DESC"}
        },
        pages: {dimensions: [{name: "Site", duplicate: true, selected_set: ["[Site].DefaultMember"]}]},
        options: {nonempty: true},
        view: {current: "bar_chart", bar_chart: {stacked: true}}
      }
    });
  } else {
    samples.report({name: PRODUCT_ROLES_REPORT, folderName: FOLDER, remove: true});
    samples.report({name: PRODUCT_ADMINS_REPORT, folderName: FOLDER, remove: true});
  }

  // The two reports of the product roles share a row, and the groups, which can be many, get the last row.
  var dashboardReports = [
    {folderName: FOLDER, name: USERS_OVERVIEW_REPORT, width: 100},
    {folderName: FOLDER, name: USER_PRODUCT_ACTIVITY_REPORT, width: 100, clear: "left"},
    {folderName: FOLDER, name: USERS_BY_ADMIN_ROLE_REPORT, width: 50, clear: "left"},
    {folderName: FOLDER, name: PRODUCT_USERS_BY_SITE_REPORT, width: 50}
  ];
  if (importProductRoles) {
    dashboardReports.push({folderName: FOLDER, name: PRODUCT_ADMINS_REPORT, width: 50, clear: "left"});
    dashboardReports.push({folderName: FOLDER, name: PRODUCT_ROLES_REPORT, width: 50});
  }
  dashboardReports.push({folderName: FOLDER, name: USERS_BY_GROUP_REPORT, width: 100, clear: "left"});

  samples.dashboard({
    name: "Atlassian Admin overview",
    reports: dashboardReports,
    definition: {pages: [ALL_SITES_PAGE, ALL_GROUPS_PAGE]}
  });
});
