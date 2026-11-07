// The sample data of the Harvest sample reports: Lumen & Pine, an invented design and software agency of
// eleven people, and 14 months of its time entries, expenses and invoices. It works for eight clients in
// three currencies, on projects billed by project, task and person rates with every kind of Harvest
// budget, and on its own projects, which are not billable. The team grows over the year: four people
// joined, the latest less than three months ago, and a developer left four months ago. The hours dip in
// the summer holidays and at the turn of the year, and the clients are invoiced monthly or quarterly, one
// of them paying late. The time entries carry their start and end times and link to Jira issues, GitHub
// issues, Trello cards and Asana tasks. Every name, company and item is invented.
sample.seed(23);

var SITE_URL = "https://example.harvestapp.com";
var ACCOUNT_ID = 1048576;
var API_URL = "https://api.harvestapp.com/v2";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var PER_PAGE = 2000;
var DAY_MS = 24 * 60 * 60 * 1000;
// The time is tracked until yesterday, so that no time entry lies in the future. An invoice may be
// issued today.
var HISTORY_DAYS = 430;
var TODAY = sample.today();
var YESTERDAY = sample.daysAgo(1);
var FIRST_DAY = sample.daysAgo(HISTORY_DAYS);
var THIS_MONDAY = mondayOf(TODAY);
var LAST_MONDAY = addDays(THIS_MONDAY, -7);

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().substring(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// 0 for Sunday to 6 for Saturday.
function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function mondayOf(date) {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

function monthStartOf(date) {
  return `${date.substring(0, 7)}-01`;
}

function nextMonthStartOf(date, months) {
  var next = new Date(Date.parse(`${monthStartOf(date)}T00:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + (months || 1));
  return next.toISOString().substring(0, 10);
}

// A moment of a day, never later than the start of today.
function timestampOf(date, minutes) {
  var moment = Date.parse(`${date}T00:00:00Z`) + (date === TODAY ? 0 : minutes) * 60 * 1000;
  return new Date(moment).toISOString().replace(/\.\d+Z$/, "Z");
}

// "9:05am", the 12 hour clock of the account.
function clockOf(minutes) {
  var hour = Math.floor(minutes / 60) % 24, minute = minutes % 60;
  return `${hour % 12 || 12}:${minute < 10 ? "0" : ""}${minute}${hour < 12 ? "am" : "pm"}`;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// The office is closed from Christmas Eve to New Year's Day.
function isHoliday(date) {
  var monthDay = date.substring(5);
  return monthDay >= "12-24" || monthDay === "01-01";
}

// ---------------------------------------------------------------------------------------------------------
// People, tasks, clients and projects

// `since` and `left` in days ago; `start` is when the working day usually starts, in minutes after
// midnight; `late` and `weekend` the share of the days with an evening session and of the weekend days with
// some work; `noNotes` the share of the unlinked entries without notes; `linking` how often the person
// starts the timer from the linked item; `chunk` the shortest and the longest stretch on one thing.
var PEOPLE = [
  {id: 3001, first: "Maya", last: "Lindgren", roles: ["Project Manager"], capacity: 40, rate: 140, cost: 72,
   since: 445, start: 510, noNotes: 0.03, utilisation: 0.84, linking: 0.8, chunk: [30, 120], admin: true},
  {id: 3002, first: "Tomas", last: "Reyes", roles: ["Developer"], capacity: 40, rate: 125, cost: 64,
   since: 440, start: 540, noNotes: 0.06, utilisation: 0.9},
  {id: 3003, first: "Priya", last: "Natarajan", roles: ["Developer"], capacity: 40, rate: 125, cost: 66,
   since: 440, start: 480, noNotes: 0.02, utilisation: 0.88},
  {id: 3004, first: "Jonas", last: "Weber", roles: ["Developer"], capacity: 32, rate: 135, cost: 95,
   contractor: true, since: 360, start: 600, late: 0.35, weekend: 0.12, noNotes: 0.3, utilisation: 0.97,
   linking: 0.55},
  {id: 3005, first: "Elena", last: "Marchetti", roles: ["Designer"], capacity: 40, rate: 115, cost: 58,
   since: 440, start: 540, noNotes: 0.08, utilisation: 0.8},
  {id: 3006, first: "Samuel", last: "Okoro", roles: ["Designer"], capacity: 40, rate: 110, cost: 54,
   since: 440, start: 570, late: 0.15, noNotes: 0.2, utilisation: 0.76, linking: 0.6},
  {id: 3007, first: "Hanna", last: "Kowalski", roles: ["QA"], capacity: 40, rate: 95, cost: 48,
   since: 440, start: 480, noNotes: 0.04, utilisation: 0.86},
  {id: 3008, first: "Oliver", last: "Grant", roles: ["Project Manager"], capacity: 40, rate: 140, cost: 70,
   since: 300, start: 510, noNotes: 0.12, utilisation: 0.72, linking: 0.4, chunk: [30, 120]},
  {id: 3009, first: "Lucia", last: "Fernandez", roles: ["Developer", "QA"], capacity: 24, rate: 115, cost: 56,
   since: 220, start: 450, noNotes: 0.05, utilisation: 0.92},
  {id: 3010, first: "Arjun", last: "Mehta", roles: ["Developer"], capacity: 40, rate: 120, cost: 60,
   since: 440, left: 130, start: 540, late: 0.2, noNotes: 0.14, utilisation: 0.85},
  {id: 3011, first: "Nora", last: "Lindqvist", roles: ["Developer"], capacity: 40, rate: 105, cost: 52,
   since: 80, start: 540, noNotes: 0.05, utilisation: 0.68}
];
var PEOPLE_BY_FIRST_NAME = _.indexBy(PEOPLE, "first");

// Who may track time on a task: null for everybody.
var TASKS = [
  {id: 4001, name: "Development", billable: true, roles: ["Developer"]},
  {id: 4002, name: "Design", billable: true, roles: ["Designer"]},
  {id: 4003, name: "Quality assurance", billable: true, roles: ["QA"]},
  {id: 4004, name: "Project management", billable: true, roles: ["Project Manager"]},
  {id: 4005, name: "Support", billable: true, roles: ["Developer", "QA"]},
  {id: 4006, name: "Research", billable: true, roles: ["Developer", "Designer"]},
  {id: 4007, name: "Meetings", billable: false, roles: null},
  {id: 4008, name: "Internal admin", billable: false, roles: null},
  {id: 4009, name: "Training", billable: false, roles: null},
  {id: 4010, name: "Sales and proposals", billable: false, roles: ["Project Manager", "Designer"]}
];
var TASKS_BY_NAME = _.indexBy(TASKS, "name");

// `payDays` how many days after the issue date the client pays, `issueAfter` how many days after the end of
// the period the invoice is issued.
var CLIENTS = [
  {id: 5001, name: "Bluefin Software", currency: "USD", payDays: [10, 25], issueAfter: [1, 4]},
  {id: 5002, name: "Wrenmoor Health", currency: "USD", payDays: [25, 45], issueAfter: [1, 4]},
  {id: 5003, name: "Copperleaf Retail", currency: "EUR", payDays: [20, 40], issueAfter: [1, 4]},
  {id: 5004, name: "Tarnbrook Freight", currency: "USD", payDays: [60, 100], issueAfter: [1, 4]},
  {id: 5005, name: "Maple & Stone Foods", currency: "GBP", payDays: [12, 28], issueAfter: [1, 4], tax: 20},
  // Its invoices are issued at once and wait as drafts for the purchase order of the university.
  {id: 5006, name: "Northfield University", currency: "USD", payDays: [30, 50], issueAfter: [0, 1],
   discount: 5, purchaseOrders: true},
  {id: 5007, name: "Kestrelhaus Media", currency: "EUR", payDays: [20, 40], issueAfter: [2, 5], quarterly: true},
  {id: 5008, name: "Hollowmere Bakery", currency: "USD", payDays: [20, 40], issueAfter: [1, 4], archived: true},
  {id: 5009, name: "Lumen & Pine", currency: "USD", payDays: [0, 0], issueAfter: [0, 0], internal: true}
];
var CLIENTS_BY_NAME = _.indexBy(CLIENTS, "name");

// `from` and `to` in days ago, a running project without `to`; the tasks and the team with their weights;
// `tracker` where the developers and the testers track their work, `designTracker` the designers; every
// client project plans its management tasks in Asana. `travel` is the chance of a trip to the client in a
// week, `local` a client the team drives to.
var PROJECTS = [
  {id: 6001, client: "Bluefin Software", name: "Customer portal", code: "BLU-PORT", from: 400, endsIn: 150,
   manager: "Maya", billBy: "Tasks",
   taskRates: {Development: 150, Design: 135, "Quality assurance": 110, "Project management": 160},
   budgetBy: "task",
   taskBudgets: {Development: 2400, Design: 450, "Quality assurance": 650, "Project management": 380},
   tasks: {Development: 6, Design: 2, "Quality assurance": 2, "Project management": 1, Meetings: 0.4},
   team: {Tomas: 5, Priya: 2, Elena: 3, Hanna: 3, Maya: 3, Lucia: 2, Arjun: 3, Nora: 3},
   tracker: {type: "jira", key: "PORT", projectId: 10010}, designTracker: {type: "trello", board: "bluefin"},
   travel: 0.08},
  {id: 6002, client: "Bluefin Software", name: "Support retainer", code: "BLU-SUP", from: 430, manager: "Maya",
   billBy: "Project", rate: 140, budgetBy: "project", budget: 900,
   tasks: {Support: 6, "Project management": 0.5},
   team: {Tomas: 1, Priya: 1, Hanna: 1, Arjun: 1, Lucia: 1, Maya: 0.3},
   tracker: {type: "jira", key: "SUP", projectId: 10011}},
  {id: 6003, client: "Wrenmoor Health", name: "Patient app", code: "WH-APP", from: 350, endsIn: 200,
   manager: "Oliver", billBy: "People", rateFactor: 1.1, budgetBy: "person",
   tasks: {Development: 6, Design: 2, "Quality assurance": 2, "Project management": 1, Meetings: 0.5},
   team: {Priya: 4, Jonas: 5, Samuel: 3, Hanna: 2, Oliver: 3, Lucia: 2},
   tracker: {type: "jira", key: "WHA", projectId: 10020}, designTracker: {type: "trello", board: "wrenmoor"},
   travel: 0.1},
  {id: 6004, client: "Wrenmoor Health", name: "Accessibility audit", code: "WH-A11Y", from: 160, to: 70,
   manager: "Oliver", billBy: "Project", rate: 130, budgetBy: "project_cost", costBudget: 26000,
   tasks: {Design: 2, "Quality assurance": 3, Research: 1, "Project management": 0.5},
   team: {Samuel: 2, Hanna: 3, Elena: 1, Oliver: 1}},
  {id: 6005, client: "Copperleaf Retail", name: "Web shop redesign", code: "CL-SHOP", from: 300, to: 40,
   manager: "Maya", billBy: "Tasks",
   taskRates: {Development: 120, Design: 110, "Quality assurance": 90, "Project management": 130},
   budgetBy: "task_fees",
   taskBudgets: {Development: 110000, Design: 42000, "Quality assurance": 16000, "Project management": 14000},
   tasks: {Development: 5, Design: 3, "Quality assurance": 2, "Project management": 1},
   team: {Elena: 4, Samuel: 3, Tomas: 2, Arjun: 3, Hanna: 2, Maya: 2},
   tracker: {type: "jira", key: "SHOP", projectId: 10030}, designTracker: {type: "trello", board: "copperleaf"},
   travel: 0.12},
  {id: 6006, client: "Copperleaf Retail", name: "Loyalty app", code: "CL-LOY", from: 120, endsIn: 240,
   manager: "Oliver", billBy: "Project", rate: 115, budgetBy: "project", budget: 1100,
   tasks: {Development: 6, Design: 2, "Quality assurance": 2, "Project management": 1},
   team: {Nora: 4, Lucia: 2, Samuel: 2, Jonas: 2, Oliver: 2, Hanna: 1},
   tracker: {type: "github", repo: "loyalty-app"}, travel: 0.06},
  {id: 6007, client: "Tarnbrook Freight", name: "Fleet dashboard", code: "TF-FLEET", from: 420, manager: "Oliver",
   billBy: "People", budgetBy: "project_cost", costBudget: 190000, costIncludesExpenses: true,
   tasks: {Development: 6, Design: 1, "Quality assurance": 1, "Project management": 1, Support: 1},
   team: {Jonas: 4, Tomas: 2, Priya: 2, Elena: 1, Oliver: 3, Hanna: 1},
   tracker: {type: "jira", key: "FLEET", projectId: 10040}, travel: 0.1, local: true},
  {id: 6008, client: "Tarnbrook Freight", name: "Data migration", code: "TF-MIG", from: 430, to: 200,
   archived: true, manager: "Maya", billBy: "Project", rate: 145, budgetBy: "project", budget: 600,
   tasks: {Development: 6, "Quality assurance": 1, "Project management": 1},
   team: {Arjun: 4, Priya: 2, Hanna: 1, Maya: 1},
   tracker: {type: "jira", key: "MIG", projectId: 10041}, local: true, travel: 0.06},
  {id: 6009, client: "Maple & Stone Foods", name: "Brand refresh", code: "MS-BRAND", from: 260, to: 60,
   manager: "Maya", billBy: "Tasks", taskRates: {Design: 95, Research: 95, "Project management": 110},
   budgetBy: "task", taskBudgets: {Design: 520, Research: 110, "Project management": 90},
   tasks: {Design: 6, Research: 1, "Project management": 1},
   team: {Elena: 4, Samuel: 4, Maya: 2}, designTracker: {type: "trello", board: "maplestone"}, travel: 0.1},
  {id: 6010, client: "Maple & Stone Foods", name: "Online ordering", code: "MS-ORDER", from: 180, manager: "Oliver",
   billBy: "Project", rate: 105, budgetBy: "none",
   tasks: {Development: 5, Design: 1, "Quality assurance": 2, "Project management": 1},
   team: {Tomas: 3, Lucia: 2, Nora: 2, Samuel: 1, Hanna: 2, Oliver: 2},
   tracker: {type: "github", repo: "online-ordering"}, travel: 0.05},
  {id: 6011, client: "Northfield University", name: "Course catalog", code: "NU-CAT", from: 380, endsIn: 60,
   manager: "Maya", billBy: "Project", rate: 120, budgetBy: "project", budget: 1500,
   tasks: {Development: 5, Design: 1, "Quality assurance": 2, "Project management": 1, Meetings: 0.4},
   team: {Priya: 3, Arjun: 3, Jonas: 2, Hanna: 2, Maya: 2, Elena: 1, Nora: 1},
   tracker: {type: "github", repo: "course-catalog"}, local: true, travel: 0.08},
  {id: 6012, client: "Kestrelhaus Media", name: "Video platform", code: "KM-VID", from: 330, manager: "Oliver",
   billBy: "Tasks",
   taskRates: {Development: 125, Design: 115, "Quality assurance": 95, "Project management": 135, Support: 125},
   budgetBy: "project_cost", costBudget: 210000,
   tasks: {Development: 5, Design: 1, "Quality assurance": 2, "Project management": 1, Support: 1},
   team: {Tomas: 2, Jonas: 3, Nora: 2, Samuel: 2, Hanna: 2, Oliver: 3},
   tracker: {type: "jira", key: "VID", projectId: 10050}, designTracker: {type: "trello", board: "kestrelhaus"},
   travel: 0.07},
  {id: 6013, client: "Hollowmere Bakery", name: "Website", code: "HB-WEB", from: 430, to: 280, archived: true,
   manager: "Maya", billBy: "Project", rate: 95, budgetBy: "project", budget: 240,
   tasks: {Design: 3, Development: 2, "Project management": 1},
   team: {Elena: 3, Samuel: 2, Arjun: 2, Maya: 1}, designTracker: {type: "trello", board: "hollowmere"}, local: true,
   travel: 0.1},
  {id: 6014, client: "Wrenmoor Health", name: "Analytics pilot", code: "WH-PILOT", from: 45, endsIn: 45,
   manager: "Oliver", billBy: "People", rateFactor: 1.15, budgetBy: "person",
   tasks: {Development: 4, Research: 2, "Project management": 1},
   team: {Priya: 2, Nora: 2, Oliver: 1}, tracker: {type: "jira", key: "WHP", projectId: 10021}},
  {id: 6015, client: "Lumen & Pine", name: "Internal", code: "INT", from: 430, billBy: "none", budgetBy: "none",
   notBillable: true, tasks: {Meetings: 4, "Internal admin": 3, Training: 2},
   team: {Maya: 1.5, Tomas: 0.5, Priya: 0.5, Jonas: 0.2, Elena: 0.6, Samuel: 0.6, Hanna: 0.5, Oliver: 1,
          Lucia: 0.4, Arjun: 0.5, Nora: 0.9}},
  {id: 6016, client: "Lumen & Pine", name: "New business", code: "INT-SALES", from: 430, billBy: "none",
   budgetBy: "none", notBillable: true, tasks: {"Sales and proposals": 5, Research: 1},
   team: {Maya: 1.5, Oliver: 1.2, Elena: 0.4}}
];
var INTERNAL = _.findWhere(PROJECTS, {code: "INT"});

PEOPLE.forEach((person) => {
  person.name = `${person.first} ${person.last}`;
  person.sinceDate = sample.daysAgo(person.since);
  person.leftDate = person.left ? sample.daysAgo(person.left) : null;
  person.vacation = vacationOf();
  person.approvals = {};
});

PROJECTS.forEach((project) => {
  project.clientRecord = CLIENTS_BY_NAME[project.client];
  project.startDate = sample.daysAgo(project.from);
  project.endDate = project.to ? sample.daysAgo(project.to) : YESTERDAY;
  project.billable = !project.notBillable;
  project.taskAssignments = taskAssignmentsOf(project);
  project.userAssignments = userAssignmentsOf(project);
});

// Two weeks in the summer of every year of the history.
function vacationOf() {
  var days = {};
  for (var year = Number(FIRST_DAY.substring(0, 4)); year <= Number(YESTERDAY.substring(0, 4)); year++) {
    var start = addDays(`${year}-06-20`, sample.integer(0, 55));
    for (var day = 0; day < 14; day++) days[addDays(start, day)] = true;
  }
  return days;
}

function taskAssignmentsOf(project) {
  var assignments = {};
  Object.keys(project.tasks).forEach((taskName, index) => {
    var task = TASKS_BY_NAME[taskName];
    assignments[taskName] = {
      id: project.id * 100 + index + 1,
      project: projectRef(project),
      task: {id: task.id, name: task.name},
      is_active: true,
      billable: project.billable && task.billable,
      hourly_rate: project.billBy === "Tasks" ? (project.taskRates[taskName] || null) : null,
      budget: ["task", "task_fees"].indexOf(project.budgetBy) >= 0 ? (project.taskBudgets[taskName] || null) : null,
      created_at: timestampOf(project.startDate, 540),
      updated_at: timestampOf(project.startDate, 540)
    };
  });
  return assignments;
}

function userAssignmentsOf(project) {
  var assignments = {};
  Object.keys(project.team).forEach((firstName, index) => {
    var person = PEOPLE_BY_FIRST_NAME[firstName];
    assignments[firstName] = {
      id: project.id * 100 + 50 + index,
      project: projectRef(project),
      user: {id: person.id, name: person.name},
      is_project_manager: project.manager === firstName,
      is_active: !person.leftDate,
      hourly_rate: project.billBy === "People" ? personRateOf(project, person) : null,
      budget: project.budgetBy === "person" ? Math.round(project.team[firstName] * 70) : null,
      created_at: timestampOf(project.startDate, 540),
      updated_at: timestampOf(project.startDate, 540)
    };
  });
  return assignments;
}

function personRateOf(project, person) {
  return Math.round(person.rate * (project.rateFactor || 1) / 5) * 5;
}

function projectRef(project) {
  return {id: project.id, name: project.name, code: project.code};
}

function clientRef(client) {
  return {id: client.id, name: client.name};
}

// ---------------------------------------------------------------------------------------------------------
// The items the time is tracked on

var ISSUE_VERBS = ["Add", "Fix", "Update", "Improve", "Refactor", "Test", "Speed up", "Clean up", "Redesign"];
var ISSUE_SUBJECTS = ["login page", "search filters", "checkout flow", "user profile", "email notifications",
  "report export", "dashboard layout", "API pagination", "file upload", "permission checks", "date picker",
  "PDF invoices", "onboarding wizard", "mobile menu", "error messages", "audit log", "payment webhook",
  "image resizing", "CSV import", "session timeout", "accessibility labels", "caching layer",
  "push notifications", "map view"];
var DESIGN_CARDS = ["Homepage hero", "Checkout wireframes", "Icon set", "Style guide", "Mobile navigation",
  "Product page layout", "Onboarding screens", "Email templates", "Logo variations", "Packaging mockups",
  "Menu illustrations", "Colour palette", "Landing page", "Dashboard widgets"];
var PLANNING_TASKS = ["Sprint planning", "Weekly status report", "Client steering meeting", "Release plan",
  "Budget review", "Backlog refinement", "Risk review", "Scope change request"];
var NOTES = {
  "Development": ["Feature work", "Code review", "Fix failing tests", "Refactor the data layer",
                  "Pair programming", "Performance tuning", "Bug fixes", "Deploy to staging"],
  "Design": ["Wireframes", "UI mockups", "Design review with the client", "Prototype", "Style guide updates"],
  "Quality assurance": ["Regression testing", "Test plan", "Exploratory testing", "Verify bug fixes",
                        "Automated test suite"],
  "Project management": ["Client call", "Status report", "Planning", "Budget review", "Release planning"],
  "Support": ["Customer ticket", "Hotfix", "Monitoring alerts", "Maintenance updates"],
  "Research": ["Technology spike", "Competitor analysis", "User interviews", "Usability study"],
  "Meetings": ["Weekly team meeting", "Retrospective", "All hands", "One-on-one"],
  "Internal admin": ["Timesheets and admin", "Hiring interviews", "Internal tooling", "Office errands"],
  "Training": ["Online course", "Conference talk preparation", "Knowledge sharing session"],
  "Sales and proposals": ["Proposal draft", "Estimate for a new project", "Pitch preparation", "Discovery call"]
};
var JIRA_HOST = "lumenpine.atlassian.net";
var SHORT_LINK_CHARACTERS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

// The issue title of an issue number, the same for every entry of the issue.
function issueTitleOf(number) {
  return `${ISSUE_VERBS[(number * 7) % ISSUE_VERBS.length]} ${ISSUE_SUBJECTS[(number * 5) % ISSUE_SUBJECTS.length]}`;
}

function listTitleOf(titles, index) {
  var round = Math.floor(index / titles.length);
  return `${titles[index % titles.length]}${round > 0 ? `, round ${round + 1}` : ""}`;
}

// The Trello short link of a card: eight letters and digits derived from the board and the card.
function shortLinkOf(board, index) {
  var hash = 2166136261, text = `${board}/${index}`, link = "";
  for (var position = 0; position < 8; position++) {
    for (var char = 0; char < text.length; char++) {
      hash = Math.imul(hash ^ text.charCodeAt(char), 16777619) >>> 0;
    }
    link += SHORT_LINK_CHARACTERS[hash % SHORT_LINK_CHARACTERS.length];
  }
  return link;
}

// The tracker a task of the project is tracked in, and how often a stretch of it is linked to an item.
function trackerOf(project, task) {
  if (["Development", "Support"].indexOf(task.name) >= 0 && project.tracker) return [project.tracker, 0.85];
  if (task.name === "Quality assurance" && project.tracker) return [project.tracker, 0.7];
  if (task.name === "Design" && project.designTracker) return [project.designTracker, 0.75];
  if (task.name === "Project management" && project.billable) return [{type: "asana", gid: project.id}, 0.45];
  return null;
}

// The external reference and the notes of the item a stretch of work is linked to, or null. Later days
// work on later items.
function linkedItemOf(person, project, task, date) {
  var tracking = trackerOf(project, task);
  if (!tracking || !sample.chance(tracking[1] * (person.linking || 1))) return null;

  var tracker = tracking[0];
  var day = daysBetween(project.startDate, date);
  switch (tracker.type) {
    case "jira": {
      let number = Math.max(1, Math.floor(day * 0.7) - sample.integer(0, 8) + 1);
      return {notes: `${tracker.key}-${number}: ${issueTitleOf(number)}`,
              reference: {id: String(tracker.projectId * 1000 + number), group_id: String(tracker.projectId),
                          account_id: null, permalink: `https://${JIRA_HOST}/browse/${tracker.key}-${number}`,
                          service: JIRA_HOST}};
    }
    case "github": {
      let number = Math.max(1, Math.floor(day * 0.5) - sample.integer(0, 6) + 1);
      return {notes: issueTitleOf(number),
              reference: {id: String(number), group_id: tracker.repo, account_id: "lumenpine",
                          permalink: `https://github.com/lumenpine/${tracker.repo}/issues/${number}`,
                          service: "github.com"}};
    }
    case "trello": {
      let card = Math.max(0, Math.floor(day / 5) - sample.integer(0, 2));
      let shortLink = shortLinkOf(tracker.board, card);
      return {notes: listTitleOf(DESIGN_CARDS, card),
              reference: {id: shortLink, group_id: tracker.board, account_id: null,
                          permalink: `https://trello.com/c/${shortLink}`, service: "trello.com"}};
    }
    default: {
      let index = Math.max(0, Math.floor(day / 7) - sample.integer(0, 1));
      let taskGid = String(1205000000000000 + tracker.gid * 1000 + index);
      return {notes: listTitleOf(PLANNING_TASKS, index),
              reference: {id: taskGid, group_id: String(1204000000000000 + tracker.gid), account_id: null,
                          permalink: `https://app.asana.com/0/${1204000000000000 + tracker.gid}/${taskGid}`,
                          service: "app.asana.com"}};
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Time entries

var timeEntries = [];
var nextTimeEntryId = 2400000001;

// The approval of the timesheet of a person's week: approved before last week, last week submitted by most
// people, this week not submitted yet.
function approvalOf(person, date) {
  var monday = mondayOf(date);
  if (!(monday in person.approvals)) {
    person.approvals[monday] = monday >= THIS_MONDAY ? "unsubmitted"
      : monday >= LAST_MONDAY ? sample.pickWeighted([["submitted", 70], ["approved", 20], ["unsubmitted", 10]])
      : "approved";
  }
  return person.approvals[monday];
}

function employed(person, date) {
  return date >= person.sinceDate && (!person.leftDate || date <= person.leftDate);
}

function tasksOf(project, person) {
  return Object.keys(project.tasks).filter((taskName) => {
    var roles = TASKS_BY_NAME[taskName].roles;
    return !roles || _.intersection(roles, person.roles).length > 0;
  }).map((taskName) => [taskName, project.tasks[taskName]]);
}

function projectsOf(person, date) {
  return PROJECTS.filter((project) => project.team[person.first] && date >= project.startDate &&
    date <= project.endDate && tasksOf(project, person).length > 0).
    map((project) => [project, project.team[person.first]]);
}

function trackDay(person, date) {
  if (!employed(person, date)) return;
  var weekday = weekdayOf(date);
  var weekend = weekday === 0 || weekday === 6;
  if (weekend ? !sample.chance(person.weekend || 0.01)
              : isHoliday(date) || person.vacation[date] || sample.chance(0.02)) return;

  var stretches = [];
  if (weekday === 1) {
    stretches.push({project: INTERNAL, taskName: "Meetings", minutes: sample.integer(45, 70),
                    notes: "Weekly team meeting"});
  }
  var projects = projectsOf(person, date);
  var chunk = person.chunk || [75, 270];
  var minutesLeft = weekend ? sample.integer(2, 5) * 60
    : Math.round(person.capacity / 5 * 60 * person.utilisation * sample.decimal(0.85, 1.12)) -
      sum(stretches.map((stretch) => stretch.minutes));
  while (minutesLeft >= 20 && projects.length > 0) {
    let project = sample.pickWeighted(projects);
    let minutes = Math.min(minutesLeft, sample.integer(chunk[0], chunk[1]));
    if (minutesLeft - minutes < 20) minutes = minutesLeft;
    stretches.push({project: project, taskName: sample.pickWeighted(tasksOf(project, person)), minutes: minutes});
    minutesLeft -= minutes;
  }

  var clock = weekend ? sample.integer(600, 840) : person.start + sample.integer(-20, 25);
  var evening = !weekend && stretches.length > 1 && sample.chance(person.late || 0.04);
  var lunch = false;
  stretches.forEach((stretch, index) => {
    if (evening && index === stretches.length - 1) {
      clock = Math.max(clock, sample.integer(1140, 1230));
      stretch.minutes = Math.min(stretch.minutes, 150);
    } else if (!lunch && clock >= 720) {
      clock += sample.integer(30, 60);
      lunch = true;
    }
    stretch.minutes = Math.min(stretch.minutes, 1410 - clock);
    if (stretch.minutes >= 10) addTimeEntry(person, date, stretch, clock);
    clock += stretch.minutes + sample.integer(0, 15);
  });
}

function addTimeEntry(person, date, stretch, startMinutes) {
  var project = stretch.project, task = TASKS_BY_NAME[stretch.taskName], client = project.clientRecord;
  var taskAssignment = project.taskAssignments[task.name];
  var minutes = stretch.minutes, hours = round2(minutes / 60);
  var linked = stretch.notes ? null : linkedItemOf(person, project, task, date);
  var notes = stretch.notes || (linked ? linked.notes
    : (sample.chance(person.noNotes) ? null : sample.pick(NOTES[task.name])));
  var billable = taskAssignment.billable;
  var approval = approvalOf(person, date);
  var endMinutes = startMinutes + minutes;
  timeEntries.push({
    id: nextTimeEntryId++,
    spent_date: date,
    user: {id: person.id, name: person.name},
    client: {id: client.id, name: client.name, currency: client.currency},
    project: projectRef(project),
    task: {id: task.id, name: task.name},
    user_assignment: {id: project.userAssignments[person.first].id},
    task_assignment: {id: taskAssignment.id},
    hours: hours,
    hours_without_timer: hours,
    // The account rounds the tracked time up to a quarter of an hour.
    rounded_hours: Math.ceil(minutes / 15) / 4,
    notes: notes,
    created_at: timestampOf(date, endMinutes),
    updated_at: timestampOf(date, endMinutes),
    is_locked: approval === "approved",
    locked_reason: approval === "approved" ? "Item Approved and Locked for this Time Period" : null,
    is_closed: approval === "approved",
    approval_status: approval,
    is_billed: false,
    timer_started_at: null,
    started_time: clockOf(startMinutes),
    ended_time: clockOf(endMinutes),
    is_running: false,
    invoice: null,
    external_reference: linked ? linked.reference : null,
    billable: billable,
    budgeted: project.budgetBy !== "none",
    billable_rate: billable ? billableRateOf(project, task, person) : null,
    cost_rate: person.cost
  });
}

function billableRateOf(project, task, person) {
  switch (project.billBy) {
    case "Project": return project.rate;
    case "Tasks": return project.taskRates[task.name] || null;
    case "People": return personRateOf(project, person);
    default: return null;
  }
}

PEOPLE.forEach((person) => {
  for (var daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) trackDay(person, sample.daysAgo(daysAgo));
});
timeEntries = _.sortBy(timeEntries, (entry) => `${entry.spent_date} ${entry.created_at} ${entry.id}`).reverse();

// ---------------------------------------------------------------------------------------------------------
// Expenses

var EXPENSE_CATEGORIES = [
  {id: 7001, name: "Travel", unit_name: null, unit_price: null},
  {id: 7002, name: "Hotel", unit_name: null, unit_price: null},
  {id: 7003, name: "Meals", unit_name: null, unit_price: null},
  {id: 7004, name: "Software", unit_name: null, unit_price: null},
  {id: 7005, name: "Mileage", unit_name: "km", unit_price: 0.45}
];
var EXPENSE_CATEGORIES_BY_NAME = _.indexBy(EXPENSE_CATEGORIES, "name");
var expenses = [];
var nextExpenseId = 31000001;

function addExpense(person, project, date, categoryName, totalCost, notes, options) {
  var category = EXPENSE_CATEGORIES_BY_NAME[categoryName], client = project.clientRecord;
  var units = (options && options.units) || 1;
  var approval = approvalOf(person, date);
  expenses.push({
    id: nextExpenseId++,
    notes: notes,
    total_cost: round2(totalCost),
    units: units,
    is_closed: approval === "approved",
    is_locked: approval === "approved",
    is_billed: false,
    locked_reason: null,
    spent_date: date,
    created_at: timestampOf(date, 1080),
    updated_at: timestampOf(date, 1080),
    billable: project.billable && !(options && options.notBillable),
    receipt: null,
    approval_status: approval,
    user: {id: person.id, name: person.name},
    user_assignment: project.userAssignments[person.first] ? {id: project.userAssignments[person.first].id} : null,
    project: projectRef(project),
    expense_category: {id: category.id, name: category.name, unit_name: category.unit_name,
                       unit_price: category.unit_price},
    client: {id: client.id, name: client.name, currency: client.currency},
    invoice: null
  });
}

// The trips of the team to the clients: a drive to a local client, or a flight, the hotel and the meals.
PROJECTS.filter((project) => project.travel).forEach((project) => {
  for (var monday = mondayOf(project.startDate); monday <= project.endDate; monday = addDays(monday, 7)) {
    if (!sample.chance(project.travel)) continue;
    let date = addDays(monday, sample.integer(0, 4));
    let travellers = Object.keys(project.team).map((firstName) => PEOPLE_BY_FIRST_NAME[firstName]).
      filter((person) => employed(person, date) && !person.vacation[date]);
    if (date < project.startDate || date > project.endDate || date > YESTERDAY || travellers.length === 0) {
      continue;
    }
    let person = sample.pick(travellers);
    if (project.local) {
      let kilometers = sample.integer(25, 140) * 2;
      addExpense(person, project, date, "Mileage", kilometers * 0.45, `Drive to ${project.client}`,
                 {units: kilometers});
      if (sample.chance(0.3)) {
        addExpense(person, project, date, "Meals", sample.decimal(24, 95), "Lunch with the client team");
      }
    } else {
      let nights = sample.integer(1, 3);
      addExpense(person, project, date, "Travel", sample.decimal(180, 720),
                 sample.pick(["Flight to the client workshop", "Train to the client office",
                              "Flight to the project kickoff"]));
      addExpense(person, project, date, "Hotel", nights * sample.decimal(115, 245),
                 `Hotel, ${nights} night${nights > 1 ? "s" : ""}`);
      addExpense(person, project, date, "Meals", nights * sample.decimal(35, 80), "Meals during the client visit",
                 {notBillable: sample.chance(0.2)});
    }
  }
});

// The monthly subscriptions: the design tools of the team, and the services two projects bill on.
var SUBSCRIPTIONS = [
  {project: "INT", person: "Maya", amount: [540, 560], notes: "Design tool licenses"},
  {project: "INT", person: "Maya", amount: [180, 220], notes: "Project management tools"},
  {project: "KM-VID", person: "Oliver", amount: [290, 360], notes: "Streaming test environment"},
  {project: "TF-FLEET", person: "Jonas", amount: [90, 185], notes: "Map tiles API usage"}
];
SUBSCRIPTIONS.forEach((subscription) => {
  var project = _.findWhere(PROJECTS, {code: subscription.project});
  var person = PEOPLE_BY_FIRST_NAME[subscription.person];
  for (var month = nextMonthStartOf(FIRST_DAY); month <= YESTERDAY; month = nextMonthStartOf(month)) {
    let date = addDays(month, 2);
    if (date < project.startDate || date > YESTERDAY || !employed(person, date)) continue;
    addExpense(person, project, date, "Software", sample.decimal(subscription.amount[0], subscription.amount[1]),
               subscription.notes);
  }
});
expenses = _.sortBy(expenses, (expense) => `${expense.spent_date} ${expense.id}`).reverse();

// ---------------------------------------------------------------------------------------------------------
// Invoices

var INVOICE_ITEM_CATEGORIES = [
  {id: 7101, name: "Service", use_as_service: true, use_as_expense: false},
  {id: 7102, name: "Product", use_as_service: false, use_as_expense: true}
];
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
var invoices = [];
var nextInvoiceId = 42000001;
var nextLineItemId = 43000001;

function periodNameOf(start, quarterly) {
  var month = Number(start.substring(5, 7));
  return quarterly ? `Q${Math.ceil(month / 3)} ${start.substring(0, 4)}`
                   : `${MONTH_NAMES[month - 1]} ${start.substring(0, 4)}`;
}

function lineItem(kind, description, quantity, amount, project, taxed) {
  return {id: nextLineItemId++, kind: kind, description: description, quantity: round2(quantity),
          unit_price: quantity ? round2(amount / quantity) : round2(amount), amount: round2(amount),
          taxed: taxed, taxed2: false, project: project ? projectRef(project) : null};
}

// The time of a project billed by task or by person rates is summarized by task or by person, so that every
// line of an invoice has one rate.
function invoiceLineOf(project, entry) {
  switch (project.billBy) {
    case "Tasks": return entry.task.name;
    case "People": return entry.user.name;
    default: return "services";
  }
}

// The invoice of the billable time and expenses of a client's period, which are marked as billed by it.
function invoiceClientPeriod(client, start, end) {
  var issueDate = addDays(end, sample.integer(client.issueAfter[0], client.issueAfter[1]) + 1);
  if (issueDate > TODAY) return;

  var inPeriod = (record) => record.client.id === client.id && record.billable && !record.is_billed &&
    record.spent_date >= start && record.spent_date <= end;
  var periodEntries = timeEntries.filter(inPeriod), periodExpenses = expenses.filter(inPeriod);
  if (periodEntries.length === 0 && periodExpenses.length === 0) return;

  var taxed = !!client.tax;
  var periodName = periodNameOf(start, client.quarterly);
  var items = _.flatten(PROJECTS.filter((project) => project.clientRecord === client).map((project) => {
    var lines = _.groupBy(periodEntries.filter((entry) => entry.project.id === project.id),
                          (entry) => invoiceLineOf(project, entry));
    return _.keys(lines).sort().map((line) => lineItem("Service", `${project.name}: ${line}, ${periodName}`,
      sum(lines[line].map((entry) => entry.rounded_hours)),
      sum(lines[line].map((entry) => entry.rounded_hours * entry.billable_rate)), project, taxed));
  }), true);
  if (periodExpenses.length > 0) {
    items.push(lineItem("Product", `Expenses, ${periodName}`, 1,
      sum(periodExpenses.map((expense) => expense.total_cost)), null, taxed));
  }

  var itemsAmount = round2(sum(items.map((item) => item.amount)));
  var discountAmount = client.discount ? round2(itemsAmount * client.discount / 100) : 0;
  var taxAmount = taxed ? round2((itemsAmount - discountAmount) * client.tax / 100) : 0;
  var amount = round2(itemsAmount - discountAmount + taxAmount);
  var invoice = {
    id: nextInvoiceId++,
    client_key: sample.uuid().replace(/-/g, ""),
    number: null,
    purchase_order: client.purchaseOrders ? `PO-NU-${4700 + invoices.length}` : null,
    amount: amount,
    due_amount: amount,
    tax: client.tax || null,
    tax_amount: taxAmount,
    tax2: null,
    tax2_amount: 0,
    discount: client.discount || null,
    discount_amount: discountAmount,
    subject: `Services for ${periodName}`,
    notes: "Thank you for your business.",
    state: "draft",
    period_start: start,
    period_end: end,
    issue_date: issueDate,
    due_date: addDays(issueDate, 30),
    payment_term: "net 30",
    sent_at: null,
    paid_at: null,
    paid_date: null,
    closed_at: null,
    recurring_invoice_id: null,
    created_at: timestampOf(issueDate, 540),
    updated_at: timestampOf(issueDate, 540),
    currency: client.currency,
    payment_options: ["ach", "credit_card"],
    client: clientRef(client),
    estimate: null,
    retainer: null,
    creator: {id: PEOPLE_BY_FIRST_NAME.Maya.id, name: PEOPLE_BY_FIRST_NAME.Maya.name},
    line_items: items
  };
  invoices.push(invoice);
  periodEntries.concat(periodExpenses).forEach((record) => {
    record.is_billed = true;
    // The number is given once all invoices are known, in the order they were issued.
    record.invoice = {id: invoice.id};
    record.invoiceRecord = invoice;
    record.is_locked = true;
    record.locked_reason = "Item Invoiced and Locked for this Time Period";
    record.updated_at = invoice.created_at;
  });
}

CLIENTS.filter((client) => !client.internal).forEach((client) => {
  var months = client.quarterly ? 3 : 1;
  var start = monthStartOf(FIRST_DAY);
  // A quarter starts in January, April, July or October.
  while (client.quarterly && (Number(start.substring(5, 7)) - 1) % 3 !== 0) start = nextMonthStartOf(start, -1);
  for (; start <= YESTERDAY; start = nextMonthStartOf(start, months)) {
    let end = addDays(nextMonthStartOf(start, months), -1);
    if (end <= YESTERDAY) invoiceClientPeriod(client, start, end);
  }
});

// The states by the age of an invoice: sent when issued, paid once the client paid it. Northfield
// University's latest invoice waits as a draft for the purchase order, Tarnbrook Freight pays late and paid
// half of its oldest open invoice, and the final invoice of the archived Hollowmere Bakery was written off.
invoices = _.sortBy(invoices, (invoice) => `${invoice.issue_date} ${invoice.id}`);
invoices.forEach((invoice, index) => {
  var client = CLIENTS_BY_NAME[invoice.client.name];
  invoice.number = String(1001 + index);
  var latestOfClient = _.last(invoices.filter((other) => other.client.id === client.id)) === invoice;
  if (client.purchaseOrders && latestOfClient) {
    invoice.purchase_order = null;
    return;
  }

  invoice.state = "open";
  invoice.sent_at = timestampOf(invoice.issue_date, 600);
  invoice.updated_at = invoice.sent_at;
  var paidDate = addDays(invoice.issue_date, sample.integer(client.payDays[0], client.payDays[1]));
  if (client.archived && latestOfClient) {
    invoice.state = "closed";
    invoice.closed_at = timestampOf(addDays(invoice.due_date, 45), 600);
    invoice.updated_at = invoice.closed_at;
  } else if (paidDate <= YESTERDAY) {
    invoice.state = "paid";
    invoice.due_amount = 0;
    invoice.paid_date = paidDate;
    invoice.paid_at = timestampOf(paidDate, 900);
    invoice.updated_at = invoice.paid_at;
  }
});
var firstLatePayment = _.find(invoices, (invoice) => invoice.client.name === "Tarnbrook Freight" &&
  invoice.state === "open");
if (firstLatePayment) firstLatePayment.due_amount = round2(firstLatePayment.amount / 2);
timeEntries.concat(expenses).forEach((record) => {
  if (record.invoiceRecord) record.invoice.number = record.invoiceRecord.number;
  delete record.invoiceRecord;
});
invoices.reverse();

// ---------------------------------------------------------------------------------------------------------
// The responses of the Harvest API

function userOf(person) {
  return {
    id: person.id, first_name: person.first, last_name: person.last,
    email: `${person.first.toLowerCase()}@lumenpine.example`, telephone: "",
    timezone: "Eastern Time (US & Canada)", has_access_to_all_future_projects: false,
    is_contractor: !!person.contractor, is_admin: !!person.admin, is_active: !person.leftDate,
    created_at: timestampOf(person.sinceDate, 540),
    updated_at: timestampOf(person.leftDate || person.sinceDate, 540),
    weekly_capacity: person.capacity * 3600, default_hourly_rate: person.rate, cost_rate: person.cost,
    roles: person.roles,
    access_roles: person.admin ? ["administrator"]
      : person.roles.indexOf("Project Manager") >= 0 ? ["manager", "project_creator"] : ["member"],
    avatar_url: null
  };
}

function projectOf(project) {
  var client = project.clientRecord;
  return {
    id: project.id, name: project.name, code: project.code, is_active: !project.archived,
    is_billable: project.billable, is_fixed_fee: false, bill_by: project.billBy,
    hourly_rate: project.billBy === "Project" ? project.rate : null,
    budget: ["project", "person", "task"].indexOf(project.budgetBy) >= 0 ? (project.budget || null) : null,
    budget_by: project.budgetBy, budget_is_monthly: !!project.monthly, notify_when_over_budget: true,
    over_budget_notification_percentage: 80, show_budget_to_all: false,
    cost_budget: project.costBudget || null, cost_budget_include_expenses: !!project.costIncludesExpenses,
    fee: null, notes: "", starts_on: project.startDate,
    ends_on: project.to ? project.endDate : (project.endsIn ? addDays(TODAY, project.endsIn) : null),
    created_at: timestampOf(project.startDate, 540), updated_at: timestampOf(project.startDate, 540),
    client: {id: client.id, name: client.name, currency: client.currency}
  };
}

function mockList(name, records) {
  var pages = [];
  for (var index = 0; index < records.length || pages.length === 0; index += PER_PAGE) {
    pages.push(records.slice(index, index + PER_PAGE));
  }
  pages.forEach((page, pageIndex) => {
    var response = {per_page: PER_PAGE, total_pages: pages.length, total_entries: records.length,
                    page: pageIndex + 1,
                    links: {next: pageIndex + 1 < pages.length
                      ? `${API_URL}/${name}?cursor=page${pageIndex + 2}&per_page=${PER_PAGE}` : null}};
    response[name] = page;
    mock.get(`/v2/${name}`, pageIndex === 0 ? {json: response}
                                            : {params: {cursor: `page${pageIndex + 1}`}, json: response});
  });
}

var ECB_RATES = [["USD", "1.0842"], ["JPY", "162.15"], ["GBP", "0.85710"], ["CHF", "0.9421"],
  ["SEK", "11.2140"], ["NOK", "11.6820"], ["DKK", "7.4605"], ["PLN", "4.3120"], ["CAD", "1.5021"],
  ["AUD", "1.6512"]];

mock.sourceParams({api_token: "sample", site_url: SITE_URL});
mock.sourceSelection(["(all)"]);
mock.extraOptions({deleted_records_check: "daily", business_hours_start: "09:00", business_hours_end: "17:00"});

mock.get("https://id.getharvest.com/api/v2/accounts",
  {json: {accounts: [{id: ACCOUNT_ID, name: "Lumen & Pine", product: "harvest"}]}});
mock.get("/v2/company", {json: {
  base_uri: SITE_URL, full_domain: "example.harvestapp.com", name: "Lumen & Pine", is_active: true,
  week_start_day: "Monday", wants_timestamp_timers: true, time_format: "hours_minutes", date_format: "%m/%d/%Y",
  plan_type: "business", expense_feature: true, invoice_feature: true, estimate_feature: true,
  approval_feature: true, clock: "12h", currency_code_display: "iso_code_none",
  currency_symbol_display: "symbol_before", decimal_symbol: ".", thousands_separator: ",",
  color_scheme: "orange", weekly_capacity: 144000, currency: "USD"
}});
mock.get("/v2/users/me", {json: userOf(PEOPLE_BY_FIRST_NAME.Maya)});

mockList("clients", CLIENTS.map((client) => ({
  id: client.id, name: client.name, is_active: !client.archived, address: null,
  statement_key: null, currency: client.currency, created_at: timestampOf(FIRST_DAY, 540),
  updated_at: timestampOf(FIRST_DAY, 540)
})));
mockList("projects", PROJECTS.map(projectOf));
mockList("tasks", TASKS.map((task) => ({
  id: task.id, name: task.name, billable_by_default: task.billable, default_hourly_rate: null,
  is_default: task.billable, is_active: true, created_at: timestampOf(FIRST_DAY, 540),
  updated_at: timestampOf(FIRST_DAY, 540)
})));
mockList("users", PEOPLE.map(userOf));
mockList("task_assignments", _.flatten(PROJECTS.map((project) => _.values(project.taskAssignments))));
mockList("user_assignments", _.flatten(PROJECTS.map((project) => _.values(project.userAssignments))));
mockList("expense_categories", EXPENSE_CATEGORIES.map((category) => Object.assign({is_active: true,
  created_at: timestampOf(FIRST_DAY, 540), updated_at: timestampOf(FIRST_DAY, 540)}, category)));
mockList("invoice_item_categories", INVOICE_ITEM_CATEGORIES.map((category) => Object.assign({
  created_at: timestampOf(FIRST_DAY, 540), updated_at: timestampOf(FIRST_DAY, 540)}, category)));
mockList("time_entries", timeEntries);
mockList("expenses", expenses);
mockList("invoices", invoices);

mock.get(ECB_RATES_URL, {headers: {"Content-Type": "application/xml"}, body:
  "<?xml version='1.0' encoding='UTF-8'?>" +
  "<gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01' " +
  "xmlns='http://www.ecb.int/vocabulary/2002-08-01/eurofxref'>" +
  `<Cube><Cube time='${YESTERDAY}'>` +
  ECB_RATES.map((rate) => `<Cube currency='${rate[0]}' rate='${rate[1]}'/>`).join("") +
  "</Cube></Cube></gesmes:Envelope>"});
