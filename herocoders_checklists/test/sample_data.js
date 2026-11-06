// The sample data of the addon: a simulated Jira instance whose issues have the checklists of Checklists for Jira in
// the Checklist Text field, and the Checklist Text changes in their changelog, which complete and reopen the items.
// The addon requests only the Jira REST API, which the simulated Jira answers.
sample.seed(11);

mock.extraOptions({completed_statuses: ["done", "skipped"]});

// The checklist templates of the issue types: the items of a checklist by their header (null for no header).
var TEMPLATES = {
  acceptanceCriteria: {name: "Acceptance Criteria", sections: [[null, [
    "User can save the form as a draft",
    "Validation messages are shown for the required fields",
    "Layout works on mobile screen sizes",
    "Search results load within 2 seconds",
    "Empty state is shown when there are no results",
    "Changes are recorded in the audit log",
    "Keyboard navigation works for all controls",
    "Error message is shown when the API is unavailable"
  ]]]},
  definitionOfDone: {name: "Definition of Done", sections: [
    ["Code", ["Code reviewed", "Unit tests added", "Static analysis passed"]],
    ["Release", ["Documentation updated", "Release notes prepared", "Deployed to staging", "Product owner sign-off"]]
  ]},
  bugVerification: {name: "Bug Verification", sections: [
    ["Verification phase 1", ["Reproduce the issue on staging", "Identify the root cause", "Add a regression test"]],
    ["Verification phase 2", ["Verify the fix on staging", "Confirm the fix with the reporter",
      "Check the related areas for side effects"]]
  ]},
  defaultChecklist: {name: "Default checklist", sections: [[null, [
    "Prepare the [runbook](wiki.example.test/runbook)",
    "Update the configuration",
    "Notify the team",
    "Check the monitoring dashboard",
    "Clean up the temporary resources"
  ]]]},
  releaseReadiness: {name: "Release readiness", sections: [[null, [
    "Scope agreed with the stakeholders",
    "All stories estimated",
    "Announcement drafted",
    "Support team trained",
    "Feature flag removed"
  ]]]}
};

var DESCRIPTIONS = ["See the design in the specification", "Agreed in the refinement meeting",
  "Check with the support team"];

// The share of the issues of a type with checklists and the templates of their checklists.
function checklistTemplatesOf(type) {
  if (type === "Story") {
    if (!sample.chance(0.75)) return [];
    return sample.chance(0.5) ? [TEMPLATES.acceptanceCriteria, TEMPLATES.definitionOfDone] :
      [TEMPLATES.acceptanceCriteria];
  }
  if (type === "Bug") return sample.chance(0.7) ? [TEMPLATES.bugVerification] : [];
  if (type === "Task") {
    if (!sample.chance(0.45)) return [];
    return [sample.chance(0.6) ? TEMPLATES.defaultChecklist : TEMPLATES.definitionOfDone];
  }
  return sample.chance(0.6) ? [TEMPLATES.releaseReadiness] : [];
}

// Some of the items of a template in their order, at least two of every section.
function checklistOf(template) {
  return {
    name: template.name,
    items: _.flatten(template.sections.map((section) => {
      var texts = section[1].filter(() => sample.chance(0.7));
      if (texts.length < 2) texts = section[1].slice(0, 2);
      return texts.map((text) => ({
        text: text, header: section[0], status: "open",
        description: sample.chance(0.1) ? sample.pick(DESCRIPTIONS) : null
      }));
    }))
  };
}

// The Checklist Text of the checklists in the Checklists for Jira syntax.
function checklistText(checklists) {
  return checklists.map((checklist) => {
    var lines = ["# " + checklist.name], header = null;
    checklist.items.forEach((item) => {
      if (item.header !== header) {
        header = item.header;
        lines.push("--- " + (header || ""));
      }
      lines.push("* [" + item.status + "] " + item.text);
      if (item.description) lines.push(">> " + item.description);
    });
    return lines.join("\n");
  }).join("\n\n");
}

// The share of the completed items by the status of the issue.
var COMPLETED_SHARE = {"To Do": 0.1, "In Progress": 0.45, "In Review": 0.75, "Done": 0.92};

// The item statuses of an item after the initial open status, the last one is its current status. A completed item
// may be reopened and completed again, and a not completed item may have been completed and reopened.
function statusChangesOf(completed) {
  var changes = sample.chance(0.35) ? ["in progress"] : [];
  if (completed) {
    if (sample.chance(0.1)) changes.push("done", "open");
    changes.push(sample.pickWeighted([["done", 88], ["skipped", 12]]));
  } else {
    if (sample.chance(0.15)) changes.push("done", sample.pickWeighted([["open", 60], ["in progress", 40]]));
    if (sample.chance(0.08)) changes.push("blocked");
  }
  return changes;
}

var HOUR = 3600000;

// The last status change of the issue, or its created time.
function lastChangeOf(issue) {
  var statusChanges = issue.changelog.filter((history) => history.items[0].field === "status");
  return statusChanges.length ? statusChanges[statusChanges.length - 1].created : issue.created;
}

// The checklist changes lie after the created time of the issue, before its Done transition, and before today.
function changePeriodOf(issue) {
  var start = Date.parse(issue.created) + HOUR;
  var end = issue.status === "Done" ? Date.parse(lastChangeOf(issue)) :
    Date.parse(lastChangeOf(issue)) + 10 * 24 * HOUR;
  end = Math.min(end, Date.parse(sample.today() + "T00:00:00Z") - HOUR);
  return {start: start, end: Math.max(end, start)};
}

function addChecklists(issue) {
  var checklists = checklistTemplatesOf(issue.type).map(checklistOf);
  if (checklists.length === 0) return;

  // The status changes of every item at increasing times of the change period.
  var events = [];
  var completedShare = COMPLETED_SHARE[issue.status] || 0.5;
  checklists.forEach((checklist) => checklist.items.forEach((item) => {
    var statuses = statusChangesOf(sample.chance(completedShare));
    var fractions = _.sortBy(statuses.map(() => sample.random()));
    events = events.concat(statuses.map((status, index) => ({item: item, status: status, fraction: fractions[index]})));
  }));

  var text = checklistText(checklists);
  var period = changePeriodOf(issue);
  var span = Math.max(period.end - period.start - events.length * 60000, 0);
  var previousTime = 0;
  _.sortBy(events, "fraction").forEach((event) => {
    var time = Math.max(period.start + Math.round(event.fraction * span / 60000) * 60000, previousTime + 60000);
    previousTime = time;
    event.item.status = event.status;
    var nextText = checklistText(checklists);
    issue.changelog.push({
      created: new Date(time).toISOString().substring(0, 19) + "Z", author: issue.assignee || issue.reporter,
      items: [{field: "checklist_text", from: text, to: nextText}]
    });
    text = nextText;
  });
  issue.fields.checklist_text = text;
}

sample.jira.instance({
  projects: [
    {key: "WEB", name: "Web Platform", components: ["Frontend", "Backend", "API"]},
    {key: "MOB", name: "Mobile App", components: ["iOS", "Android"]}
  ],
  issuesPerProject: 250,
  daysAgo: 450,
  issueTypes: [["Story", 42], ["Task", 23], ["Bug", 25], ["Epic", 10]],
  workflow: [["To Do", 15], ["In Progress", 15], ["In Review", 10], ["Done", 60]],
  issue(issue) {
    addChecklists(issue);
  }
});
