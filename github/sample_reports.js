// The reports of the "Samples Pull requests" folder use only the measures that every import fills, so
// that they show data also when the commits and the state transitions import options are off. The history
// folder needs the options, but sample reports cannot read them — sample_reports.js is evaluated without
// the source namespace — so the folder is created for everyone and every report of it names the option it
// needs in its description.
//
// The samples.color tokens mean the same thing throughout: $blue-6 the measure a report is about and
// $blue-3 the second one of its kind, $teal-7 a measure of another unit or axis, $purple-6 a summary
// line, $neutral-3 a part shown without being weighed, and $green-6 and $red-6 only where they carry
// their meaning. The darkest and the lightest tokens disappear into one of the two report themes and are
// not used for a series.
app.defineSampleReports((samples) => {
  // Named after the part of GitHub they analyze, so that the action and the issue reports of later
  // versions get folders of their own next to these.
  var FOLDER = "Samples Pull requests";
  var HISTORY_FOLDER = "Samples Pull request history";
  var AI_FOLDER = "Samples AI and automation";
  // DefaultMember resolves the All member of the dimension on its own and needs no members entry.
  var ALL_REPOSITORIES_PAGE = {
    name: "Repository",
    selected_set: ["[Repository].DefaultMember"]
  };
  var TIME_MONTHS_ROWS = {
    name: "Time",
    selected_set: ["[Time].[Last 12 months]"],
    selected_set_expression: "DescendantsSet({{selected_set}}, [Time].[Month])"
  };

  var TIME_PAGE_PERIODS = ["[Time].[All Times]", "[Time].[Last 12 months]", "[Time].[Current month]",
    "[Time].[Previous month]", "[Time].[Current year]", "[Time].[Previous year]"];
  // A report whose rows follow the page selection expands the selected period into months, so a period
  // of one month leaves it with a single row — one point of a chart that is about a course over time.
  var SINGLE_MONTH_PERIODS = ["[Time].[Current month]", "[Time].[Previous month]"];

  // duplicate is required when the same report has Time on its rows — the rows then follow the page
  // selection.
  function timePage(currentMember, duplicate) {
    var page = {
      name: "Time",
      selected_set: duplicate
        ? TIME_PAGE_PERIODS.filter((period) => SINGLE_MONTH_PERIODS.indexOf(period) < 0)
        : TIME_PAGE_PERIODS,
      current_page_members: [`[Time].[${currentMember}]`],
      members: [{full_name: `[Time].[${currentMember}]`, name: currentMember}]
    };
    if (duplicate) page.duplicate = true;

    return page;
  }

  // Eight tiles fill two rows of four — a sparkline tile for every measure would wrap into a third row
  // of two. Only the counting measures carry a sparkline; one of a rate reads heavily next to them.
  var OVERVIEW_MEASURES = [
    {name: "Pull requests created", sparkline: true},
    {name: "Merged pull requests", sparkline: true},
    {name: "Merge rate"},
    {name: "Average merge days"},
    {name: "Open pull requests", sparkline: true}
  ];
  var overviewSelectedSet = [];
  var overviewSparklines = [];
  OVERVIEW_MEASURES.forEach((measure) => {
    overviewSelectedSet.push(`[Measures].[${measure.name}]`);
    if (!measure.sparkline) return;

    var sparklineName = `${measure.name} last 12 periods`;
    overviewSelectedSet.push(`[Measures].[${sparklineName}]`);
    overviewSparklines.push({
      name: sparklineName,
      full_name: `[Measures].[${sparklineName}]`,
      calculation_of: `[Measures].[${measure.name}]`,
      calculation: "sparkline_time_last_12_periods",
      format_string: "SparkLineFormatter",
      drillable: false,
      depth: 0
    });
  });

  samples.report({
    name: "Pull requests overview",
    folderName: FOLDER,
    resultView: "gauge",
    definition: {
      description: "The pull requests of the period the Time page selects, each count next to its trend" +
        " over twelve periods. The page opens on the previous month, the last complete one, and a" +
        " dashboard selects the period with its common Time filter.",
      columns: {dimensions: [{
        name: "Measures",
        selected_set: overviewSelectedSet,
        members: overviewSparklines
      }]},
      rows: {dimensions: [{name: "Pull Request", selected_set: ["[Pull Request].[All Pull Requests]"]}]},
      // The previous month is a complete period — the current one would show a partial month next to a
      // sparkline of full months.
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("Previous month")]},
      view: {current: "gauge", gauge: {only_values: true, show_full_caption: ["Measures"]}}
    }
  });

  samples.report({
    name: "Pull requests created and closed over time",
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "How many pull requests were created and closed in each month, how many of the closed" +
        " ones were merged, and how many were still open at the end of it.",
      columns: {dimensions: [
        {
          name: "Measures",
          selected_set: [
            "[Measures].[Pull requests created]",
            "[Measures].[Pull requests closed]",
            "[Measures].[Open pull requests]",
            "[Measures].[Average merge days]"
          ],
          // Only the closed count is split by the state a pull request ends in. The other three stay one
          // series each: the state of a pull request that is created or open in the period says nothing
          // about that period, and the average would be split into a merged part with no closed one.
          members: [{
            name: "Pull requests closed",
            full_name: "[Measures].[Pull requests closed]",
            drilled_into_dimension: "Pull Request State",
            depth: 0
          }]
        },
        {name: "Pull Request State",
          selected_set: ["[Pull Request State].[Pull Request State].Members"]}
      ]},
      rows: {dimensions: [TIME_MONTHS_ROWS]},
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("Last 12 months", true)]},
      options: {nonempty: true},
      // A stack is built per measure, so the two closing states add up while the created count stays a
      // bar of its own.
      view: {current: "bar_chart", bar_chart: {vertical: true, stacked: true, series_options: {
        "Pull requests created": {color: samples.color("$blue-6")},
        // Merged keeps the blue of the other samples; closed without merging is the neutral remainder.
        "Pull requests closed;Merged": {color: samples.color("$blue-3")},
        "Pull requests closed;Closed": {color: samples.color("$neutral-3")},
        "Open pull requests": {type: "line", color: samples.color("$teal-7")},
        // Days on a second axis, because they do not share the scale of the pull request counts.
        "Average merge days": {type: "spline", symbol: false, separateAxis: 1,
          color: samples.color("$purple-6")}
      }}}
    }
  });

  samples.report({
    name: "Pull requests by repository",
    folderName: FOLDER,
    resultView: "table",
    definition: {
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Pull requests created]",
        "[Measures].[Pull requests closed]",
        "[Measures].[Merged pull requests]",
        "[Measures].[Merge rate]",
        "[Measures].[Open pull requests]",
        "[Measures].[Average merge days]",
        "[Measures].[Changes]",
        "[Measures].[Reviews submitted]"
      ]}]},
      rows: {
        dimensions: [{name: "Repository", selected_set: ["[Repository].[Repository].Members"]}],
        order_by: {expression: ["[Measures].[Pull requests created]"], order: "DESC"}
      },
      // Label and Milestone are in the pages of this one report so that a user discovers the two
      // dimensions no other sample uses.
      pages: {dimensions: [
        timePage("All Times"),
        {name: "Label", selected_set: ["[Label].DefaultMember"]},
        {name: "Milestone", selected_set: ["[Milestone].DefaultMember"]}
      ]},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Pull requests by author",
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "The ten authors with the most pull requests. The commits on their pull requests are" +
        " counted only when the pull request commits import option is on.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Pull requests created]",
        "[Measures].[Merged pull requests]",
        // Commits need the commits import option — the series is empty without it.
        "[Measures].[Commits submitted]"
      ]}]},
      rows: {
        dimensions: [
          {name: "Pull Request Author", selected_set: ["[Pull Request Author].[Account].Members"]}
        ],
        extreme_by: {expression: ["[Measures].[Pull requests created]"], extreme: "top_count", limit: 10},
        order_by: {expression: ["[Measures].[Pull requests created]"], order: "DESC"}
      },
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("Last 12 months")]},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {series_options: {
        "Pull requests created": {color: samples.color("$blue-6")},
        "Merged pull requests": {color: samples.color("$blue-3")},
        // Commits are counted per commit and pull requests per pull request — a shared axis would flatten
        // the pull request bars.
        "Commits submitted": {separateAxis: 1, color: samples.color("$teal-7")}
      }}}
    }
  });

  // "Comments submitted" is not used here: a comment row carries the reviewer set of its pull request,
  // so per reviewer it counts every comment on the pull requests that person reviews, not the comments
  // that person wrote.
  samples.report({
    name: "Review load by reviewer",
    folderName: FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "How many pull requests every reviewer is asked to review and how many of them are still" +
        " open. The reviewer type filter starts on the user accounts; change it to see the other" +
        " account types.",
      // Renamed for this report: under a reviewer, "Pull requests created" counts the pull requests
      // that person is a reviewer of, which the measure name reads as the reviewer having written them.
      columns: {dimensions: [{
        name: "Measures",
        selected_set: [
          "[Measures].[Pull requests to review]",
          "[Measures].[Open pull requests]"
        ],
        members: [{
          name: "Pull requests to review",
          full_name: "[Measures].[Pull requests to review]",
          format_string: "#,##0",
          report_specific: true,
          calculated: true,
          drillable: false,
          depth: 0
        }]
      }]},
      rows: {
        // The accounts of the type the page filter below selects.
        dimensions: [
          {name: "Pull Request Reviewer",
            selected_set: ["[Pull Request Reviewer.By type].[User]"],
            selected_set_expression:
              "DescendantsSet({{selected_set}}, [Pull Request Reviewer.By type].[Account])"}
        ],
        extreme_by: {expression: ["[Measures].[Pull requests to review]"], extreme: "top_count", limit: 10},
        order_by: {expression: ["[Measures].[Pull requests to review]"], order: "DESC"}
      },
      // The reviewer type filters the reviewers on rows, therefore duplicate. It starts on the user
      // accounts: the review bots of a repository review everything and would fill the whole chart.
      pages: {dimensions: [
        ALL_REPOSITORIES_PAGE,
        timePage("Last 12 months"),
        {
          name: "Pull Request Reviewer",
          duplicate: true,
          selected_set: [
            "[Pull Request Reviewer.By type].[All Reviewers by type]",
            "[Pull Request Reviewer.By type].[Type].Members"
          ],
          current_page_members: ["[Pull Request Reviewer.By type].[User]"],
          members: [{full_name: "[Pull Request Reviewer.By type].[User]", name: "User"}]
        }
      ]},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {series_options: {
        "Pull requests to review": {color: samples.color("$blue-6")},
        "Open pull requests": {color: samples.color("$teal-7")}
      }}},
      calculated_members: [{
        dimension: "Measures",
        name: "Pull requests to review",
        formula: "[Measures].[Pull requests created]",
        format_string: "#,##0"
      }]
    }
  });

  samples.report({
    name: "Open pull requests by age",
    folderName: FOLDER,
    resultView: "table",
    definition: {
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Open pull request age days]",
        // Every row of a report of the open pull requests has the GitHub state Open; the merge state is
        // what tells them apart.
        "[Measures].[Pull request merge state]",
        "[Measures].[Pull request created date]",
        "[Measures].[Changed files count]",
        "[Measures].[Changes]"
      ]}]},
      rows: {
        // The author comes from its own dimension and not from a property of the pull request: an
        // account is renamed, and a name copied onto the pull request would not follow.
        dimensions: [
          {name: "Pull Request", selected_set: ["[Pull Request].[Pull Request].Members"]},
          {name: "Pull Request Author", selected_set: ["[Pull Request Author].[Account].Members"]}
        ],
        filter_by: {conditions: [
          {expression: ["[Measures].[Open pull requests]"], operator: ">", value: "0"},
          // A draft is not waiting for anybody, so its age says nothing about a review that is overdue.
          {expression: ["[Measures].[Pull request draft]"], operator: "<>", value: "Yes",
            value_type: "string"}
        ]},
        order_by: {expression: ["[Measures].[Open pull request age days]"], order: "DESC"}
      },
      // The age is measured against today, therefore the report shows the pull requests which are open
      // now — the All Times default of the Open pull requests measure.
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("All Times")]},
      view: {current: "table"}
    }
  });

  // The GitHub account types are a fixed set, so a series of every type can be colored by its name — a
  // measure split by the account type is keyed "<measure>;<type>" in the series options. Two tones per
  // type: the hue tells the account types apart, and the tone tells a filled count from the line of its
  // rate.
  var ACCOUNT_TYPE_COLORS = {
    "User": {fill: "$blue-3", stroke: "$blue-7"},
    "Bot": {fill: "$orange-3", stroke: "$orange-7"},
    "Organization": {fill: "$teal-3", stroke: "$teal-7"},
    "Mannequin": {fill: "$green-3", stroke: "$green-7"},
    "(none)": {fill: "$neutral-3", stroke: "$neutral-6"}
  };

  // typeOptions holds every measure that is split by the account type, as {tone, options}, and
  // unsplitOptions the series options of the measures that are not split.
  function accountTypeSeriesOptions(typeOptions, unsplitOptions) {
    var seriesOptions = Object.assign({}, unsplitOptions || {});
    Object.keys(typeOptions).forEach((measureName) => {
      var measure = typeOptions[measureName];
      Object.keys(ACCOUNT_TYPE_COLORS).forEach((accountType) => {
        seriesOptions[`${measureName};${accountType}`] = Object.assign(
          {color: samples.color(ACCOUNT_TYPE_COLORS[accountType][measure.tone])},
          measure.options || {});
      });
    });

    return seriesOptions;
  }

  // The By type hierarchy separates what the user accounts do from what the bot accounts do without any
  // calculated member.
  var COMMENT_AUTHOR_TYPES = {
    name: "Comment Author",
    selected_set: ["[Comment Author.By type].[Type].Members"]
  };

  samples.report({
    name: "Review activity by account type",
    folderName: AI_FOLDER,
    resultView: "timeline_chart",
    definition: {
      description: "How many reviews the user accounts and the bot accounts of a repository submit" +
        " each month, and how many comments a review of theirs carries.",
      columns: {dimensions: [
        {
          name: "Measures",
          selected_set: [
            "[Measures].[Reviews submitted]",
            "[Measures].[Comments per review]"
          ]
        },
        COMMENT_AUTHOR_TYPES
      ]},
      rows: {dimensions: [TIME_MONTHS_ROWS]},
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("Last 12 months", true)]},
      options: {nonempty: true},
      view: {current: "timeline_chart", timeline_chart: {
        series_type: "column",
        series_options: accountTypeSeriesOptions({
          "Reviews submitted": {tone: "fill"},
          // A rate does not belong on the scale of the counts and is never stacked.
          "Comments per review": {tone: "stroke", options: {type: "line", separateAxis: 1}}
        }),
        show_full_caption: ["Measures"]
      }}
    }
  });

  samples.report({
    name: "Pull request outcomes by author type",
    folderName: AI_FOLDER,
    resultView: "table",
    definition: {
      description: "What becomes of the pull requests each account type opens: how many are merged," +
        " how long that takes, how large they are and how many reviews they receive.",
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Pull requests created]",
        "[Measures].[Merge rate]",
        "[Measures].[Average merge days]",
        "[Measures].[Changes]",
        "[Measures].[Reviews submitted]"
      ]}]},
      rows: {
        dimensions: [{name: "Pull Request Author",
          selected_set: ["[Pull Request Author.By type].[Type].Members"]}],
        order_by: {expression: ["[Measures].[Pull requests created]"], order: "DESC"}
      },
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("All Times")]},
      options: {nonempty: true},
      view: {current: "table"}
    }
  });

  samples.report({
    name: "Reviewed pull requests by account type",
    folderName: AI_FOLDER,
    resultView: "timeline_chart",
    definition: {
      description: "How many pull requests were reviewed each month split by account type, next to the" +
        " pull requests created that month.",
      columns: {dimensions: [
        {
          name: "Measures",
          selected_set: [
            "[Measures].[Reviewed pull requests count]",
            "[Measures].[Pull requests created count]"
          ],
          // Only the reviewed count is split by the account type. Pull requests created count stays one
          // series because it is a measure of the pull requests table, which the Comment Author
          // dimension cannot slice at all — unsplit it counts the whole month.
          members: [{
            name: "Reviewed pull requests count",
            full_name: "[Measures].[Reviewed pull requests count]",
            drilled_into_dimension: "Comment Author",
            depth: 0
          }]
        },
        COMMENT_AUTHOR_TYPES
      ]},
      rows: {dimensions: [TIME_MONTHS_ROWS]},
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("Last 12 months", true)]},
      options: {nonempty: true},
      // Deliberately not stacked: a pull request reviewed by a user account and by a bot account is
      // counted in both series, so a stack would add the two up and report more coverage than there is.
      view: {current: "timeline_chart", timeline_chart: {
        series_type: "column",
        series_options: accountTypeSeriesOptions(
          {"Reviewed pull requests count": {tone: "fill"}},
          {"Pull requests created count": {type: "line", color: samples.color("$purple-6")}}
        ),
        show_full_caption: ["Measures"]
      }}
    }
  });

  var TRANSITIONS_IMPORT = ' Needs the "Import pull request state transitions" import option.';

  samples.report({
    name: "Pull requests cumulative flow",
    folderName: HISTORY_FOLDER,
    resultView: "timeline_chart",
    definition: {
      description: "How many pull requests stand in each state at the end of each month. Merged and" +
        " closed start the period at zero, so that the ones finished earlier do not flatten the states" +
        " still in flight." + TRANSITIONS_IMPORT,
      columns: {dimensions: [
        {
          name: "Measures",
          selected_set: ["[Measures].[Pull requests cumulative flow]"],
          members: [{
            name: "Pull requests cumulative flow",
            full_name: "[Measures].[Pull requests cumulative flow]",
            format_string: "#,##0",
            report_specific: true,
            calculated: true,
            drillable: false,
            depth: 0
          }]
        },
        {name: "Pull Request State",
          selected_set: ["[Pull Request State].[Pull Request State].Members"]}
      ]},
      rows: {dimensions: [TIME_MONTHS_ROWS]},
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("Last 12 months", true)]},
      // The states still in flight share the blue ramp of the other samples; the two a pull request
      // ends in keep the merged and closed colors they have everywhere else.
      view: {current: "timeline_chart", timeline_chart: {
        series_type: "area", stacked: true,
        series_options: {
          "Open": {color: samples.color("$neutral-3")},
          "Changes Requested": {color: samples.color("$blue-3")},
          "Approved": {color: samples.color("$blue-6")},
          "Merged": {color: samples.color("$green-6")},
          "Closed": {color: samples.color("$red-6")}
        }
      }},
      // Merged and Closed are terminal — a pull request that enters them never leaves — so their history
      // is the total of every pull request that ever reached them and would stack into a band that dwarfs
      // the states still in flight. They are counted from the first month shown instead. The formula
      // cannot name that period: a duplicate Time page is copied into the selected set of the rows and
      // then left out of the query, so VisibleRowsSet() is what answers it.
      calculated_members: [{
        dimension: "Measures",
        name: "Pull requests cumulative flow",
        format_string: "#,##0",
        formula: `CASE WHEN [Pull Request State].CurrentHierarchyMember.Name MATCHES "Merged|Closed" THEN
  IIF(
    [Measures].[Pull requests history] -
    (Tail(PreviousPeriods(VisibleRowsSet().Item(0).Item(0))).Item(0),
      [Measures].[Pull requests history]) < 0,
    0,
    [Measures].[Pull requests history] -
    (Tail(PreviousPeriods(VisibleRowsSet().Item(0).Item(0))).Item(0),
      [Measures].[Pull requests history])
  )
ELSE
  [Measures].[Pull requests history]
END`
      }]
    }
  });

  samples.report({
    name: "Time in active pull request states",
    folderName: HISTORY_FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "How long a pull request waits in each state it is active in before it moves on." +
        TRANSITIONS_IMPORT,
      columns: {dimensions: [{name: "Measures",
        selected_set: ["[Measures].[Average days in transition state]"]}]},
      rows: {
        // Only the states a pull request passes through. The days are counted when it leaves a state,
        // so Merged has none at all, and Closed would show only the pull requests that were reopened —
        // a rare event that reads like the average time a pull request stays closed.
        dimensions: [{name: "Pull Request State", selected_set: [
          "[Pull Request State].[Open]",
          "[Pull Request State].[Changes Requested]",
          "[Pull Request State].[Approved]"
        ]}],
        order_by: {expression: ["[Measures].[Average days in transition state]"], order: "DESC"}
      },
      pages: {dimensions: [ALL_REPOSITORIES_PAGE, timePage("All Times")]},
      options: {nonempty: true},
      view: {current: "bar_chart", bar_chart: {
        vertical: false,
        series_options: {"Average days in transition state": {color: samples.color("$blue-6")}},
        show_full_caption: ["Measures"]
      }}
    }
  });

  // Commit rows carry the authored date of every commit, so this shows when the work happened. The pull
  // request level Additions and Deletions are written on one date — the day the pull request closed —
  // and would only show the months in which large pull requests were merged.
  samples.report({
    name: "Code changes over time",
    folderName: HISTORY_FOLDER,
    resultView: "bar_chart",
    definition: {
      description: "Lines added and removed by the commits of the pull requests, counted on the date" +
        " each commit was authored." +
        ' Needs the "Import pull request commits" import option.',
      columns: {dimensions: [{name: "Measures", selected_set: [
        "[Measures].[Lines added]",
        "[Measures].[Lines removed]",
        "[Measures].[Net lines]",
        "[Measures].[Commits submitted]"
      ]}]},
      rows: {dimensions: [TIME_MONTHS_ROWS]},
      pages: {dimensions: [
        ALL_REPOSITORIES_PAGE,
        timePage("Last 12 months", true),
        {name: "Pull Request Author",
          selected_set: ["[Pull Request Author].[All Pull Request Authors]"],
          current_page_members: ["[Pull Request Author].[All Pull Request Authors]"],
          members: [{full_name: "[Pull Request Author].[All Pull Request Authors]",
            name: "All Pull Request Authors", type: "all", depth: 0, drillable: true}]}
      ]},
      options: {nonempty: true},
      // A bar chart is horizontal by default, which would run the months down the side.
      view: {current: "bar_chart", bar_chart: {
        stacked: true,
        vertical: true,
        series_options: {
          "Lines added": {type: "column", symbol: false, color: samples.color("$green-6"),
            dataLabelType: "middle horizontal"},
          "Lines removed": {type: "column", color: samples.color("$red-6"),
            dataLabelType: "middle horizontal"},
          // The net line runs through the stack, where a label of its own would collide with the two
          // column labels.
          "Net lines": {type: "spline", symbol: false, color: samples.color("$purple-6"),
            dataLabelType: false},
          "Commits submitted": {type: "line", separateAxis: 1, color: samples.color("$teal-7")}
        }
      }}
    }
  });

  // Named after the folder of its reports, like the sample dashboards of the standard source
  // applications. "Pull requests by repository" is left out: it has Repository on its rows, and the
  // common Repository filter below would narrow it to a single line. "Code changes over time" is the one
  // history report here — the only pull request volume the others do not already show.
  samples.dashboard({
    name: "Samples Pull requests",
    // The first report of every row starts it with clear left, because the reports of a row differ in
    // height and the automatic flow would otherwise fit the next one beside the taller of them.
    reports: [
      {folderName: FOLDER, name: "Pull requests overview", width: 100},
      // The two charts over time take the full width: twelve months of stacked columns with the line
      // series on top of them are cramped at half of it.
      {folderName: FOLDER, name: "Pull requests created and closed over time", width: 100, clear: "left"},
      {folderName: HISTORY_FOLDER, name: "Code changes over time", width: 100, clear: "left"},
      // A horizontal bar chart sizes itself from its number of bars, so the shorter of these two leaves a
      // gap beside the other — a dashboard report cannot ship a fixed height.
      {folderName: FOLDER, name: "Pull requests by author", width: 50, clear: "left"},
      {folderName: FOLDER, name: "Review load by reviewer", width: 50},
      {folderName: FOLDER, name: "Open pull requests by age", width: 100, clear: "left"}
    ],
    // The dashboard filter bar shows the common Time and Repository pages, so they are hidden inside the
    // individual reports.
    definition: {
      pages: [timePage("Last 12 months"), ALL_REPOSITORIES_PAGE],
      pages_options: {hide_common: true}
    }
  });

  samples.dashboard({
    name: "Samples AI and automation",
    reports: [
      {folderName: AI_FOLDER, name: "Review activity by account type", width: 100},
      {folderName: AI_FOLDER, name: "Reviewed pull requests by account type", width: 50, clear: "left"},
      {folderName: AI_FOLDER, name: "Pull request outcomes by author type", width: 50}
    ],
    definition: {
      pages: [timePage("Last 12 months"), ALL_REPOSITORIES_PAGE],
      pages_options: {hide_common: true}
    }
  });
});
