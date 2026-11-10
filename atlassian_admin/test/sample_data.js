// The sample data of the Atlassian Admin sample reports: the organization of an invented software company,
// Larkspur Software, with about 270 employees in nine departments, contractors, Confluence guests of its
// partners and the portal customers of its service desk, as well as former employees whose accounts are
// deactivated. The main site has Jira, Confluence, Jira Service Management, Assets and Jira Product
// Discovery, a second site on Free plans is used by a few engineers, a sandbox site by the admins, and
// the engineers work in a Bitbucket workspace. Most employees are active in their products every week,
// some licenses are used rarely or never. Every name, address and id is invented.
sample.seed(23);

var ORG_ID = "4b8e2f6a-1c3d-4e5f-9a7b-6c5d4e3f2a1b";
var DIRECTORY_ID = "d2f1e3c4-5b6a-4789-8c9d-0e1f2a3b4c5d";
var COMPANY = "Larkspur Software";
var DOMAIN = "larkspur.example";
var PAGE_LIMIT = 100;
var SEARCH_PATH = `/admin/v2/orgs/${ORG_ID}/directories/${DIRECTORY_ID}/users/search`;
var SEARCH_URL = `https://api.atlassian.com${SEARCH_PATH}`;

var SITES = {
  main: {cloudId: "7a1f3c5e-2b4d-4f6a-8c9e-1d3f5a7b9c2e", host: "larkspur.atlassian.net"},
  labs: {cloudId: "9c2e4a6b-3d5f-4a7c-9e1b-2f4a6c8e1b3d", host: "larkspur-labs.atlassian.net"},
  sandbox: {cloudId: "5e7a9c1b-4f6a-4b8d-a2c4-3e5a7c9e2d4f", host: "larkspur-sandbox.atlassian.net"}
};
var BITBUCKET_WORKSPACE_ID = "b3d5f7a9-6c8e-4a1b-b3d5-4f6a8c1e3b5d";

var ROLES = {
  user: "atlassian/user",
  admin: "atlassian/admin",
  userAccessAdmin: "atlassian/user-access-admin",
  contributor: "atlassian/contributor",
  basic: "atlassian/basic",
  stakeholder: "atlassian/stakeholder",
  customer: "atlassian/customer",
  guest: "atlassian/guest"
};

// The workspaces by code. accessKey is the product key of the product access of a user, which names the
// workspace of a site product by the cloud id of its site.
var WORKSPACES = {
  jira: {site: "main", typeKey: "jira-software", type: "Jira Software", plan: "standard", path: "",
    createdAt: "2019-03-11T09:20:00Z"},
  confluence: {site: "main", typeKey: "confluence", type: "Confluence", plan: "standard", path: "/wiki",
    createdAt: "2019-03-11T09:25:00Z"},
  jsm: {site: "main", typeKey: "jira-servicedesk", type: "Jira Service Management", plan: "premium",
    path: "", createdAt: "2020-06-02T08:00:00Z"},
  assets: {site: "main", typeKey: "cmdb", accessKey: "assets", type: "Assets", plan: "free",
    path: "/jira/assets", createdAt: "2022-04-19T10:00:00Z"},
  jpd: {site: "main", typeKey: "jira-product-discovery", type: "Jira Product Discovery", plan: "standard",
    path: "", createdAt: "2023-02-07T13:30:00Z"},
  labsJira: {site: "labs", typeKey: "jira-software", type: "Jira Software", plan: "free", path: "",
    createdAt: "2024-01-15T11:00:00Z"},
  labsConfluence: {site: "labs", typeKey: "confluence", type: "Confluence", plan: "free", path: "/wiki",
    createdAt: "2024-01-15T11:05:00Z"},
  sandboxJira: {site: "sandbox", typeKey: "jira-software", type: "Jira Software", plan: "standard", path: "",
    createdAt: "2025-05-20T07:45:00Z", sandbox: true},
  bitbucket: {typeKey: "bitbucket", type: "Bitbucket", plan: "standard", capacity: 150,
    createdAt: "2019-04-01T12:00:00Z"}
};
var PLAN_NAMES = {free: "Free", standard: "Standard", premium: "Premium"};

Object.keys(WORKSPACES).forEach((code) => {
  var workspace = WORKSPACES[code];
  workspace.code = code;
  if (workspace.site) {
    let site = SITES[workspace.site];
    workspace.ari = `ari:cloud:${workspace.typeKey}::site/${site.cloudId}`;
    workspace.accessAri = `ari:cloud:${workspace.accessKey || workspace.typeKey}::site/${site.cloudId}`;
    workspace.name = site.host.split(".")[0];
    workspace.hostUrl = `https://${site.host}${workspace.path}`;
  } else {
    workspace.ari = `ari:cloud:bitbucket::workspace/${BITBUCKET_WORKSPACE_ID}`;
    workspace.accessAri = workspace.ari;
    workspace.name = "larkspur";
    workspace.hostUrl = "https://bitbucket.org/larkspur/";
  }
  workspace.accessKey = workspace.accessKey || workspace.typeKey;
});

// How often a user is active in a product: the weights of the last activity within the last 30, 90, 180 and
// 540 days, and of never.
var ACTIVITY_PROFILES = {
  daily: [88, 6, 2, 1, 3],
  regular: [66, 15, 7, 4, 8],
  occasional: [36, 24, 15, 12, 13],
  rare: [15, 20, 20, 25, 20]
};
var ACTIVITY_DAYS_AGO = [[29, 1], [89, 30], [179, 90], [540, 180]];

// What the employees of every department use: [workspace, role, share of the department, activity profile].
var DEPARTMENTS = [
  {name: "Engineering", group: "engineering", count: 118,
    titles: [["Software Engineer", 55], ["Senior Software Engineer", 25], ["QA Engineer", 10],
      ["DevOps Engineer", 6], ["Engineering Manager", 6]],
    products: [["jira", ROLES.user, 1, "daily"], ["confluence", ROLES.user, 0.96, "regular"],
      ["bitbucket", null, 0.92, "daily"], ["jpd", ROLES.stakeholder, 0.2, "occasional"],
      ["labsJira", ROLES.user, 0.06, "occasional"], ["labsConfluence", ROLES.user, 0.05, "occasional"]]},
  {name: "Product", group: "product", count: 22,
    titles: [["Product Manager", 70], ["Product Owner", 20], ["Head of Product", 10]],
    products: [["jira", ROLES.user, 1, "daily"], ["confluence", ROLES.user, 1, "daily"],
      ["jpd", ROLES.user, 1, "daily"], ["labsJira", ROLES.user, 0.1, "rare"],
      ["labsConfluence", ROLES.user, 0.15, "occasional"]]},
  {name: "Design", group: "design", count: 12,
    titles: [["Product Designer", 75], ["UX Researcher", 25]],
    products: [["jira", ROLES.user, 1, "regular"], ["confluence", ROLES.user, 1, "regular"],
      ["jpd", ROLES.contributor, 0.9, "regular"]]},
  {name: "Customer Support", group: "customer-support", count: 24,
    titles: [["Support Engineer", 75], ["Support Team Lead", 15], ["Technical Account Manager", 10]],
    products: [["jsm", ROLES.user, 1, "daily"], ["confluence", ROLES.user, 1, "daily"],
      ["jira", ROLES.user, 0.8, "regular"], ["assets", ROLES.user, 0.5, "occasional"]]},
  {name: "IT", group: "it", count: 8,
    titles: [["IT Administrator", 60], ["Systems Engineer", 40]],
    products: [["jsm", ROLES.user, 1, "daily"], ["assets", ROLES.user, 1, "regular"],
      ["jira", ROLES.user, 1, "regular"], ["confluence", ROLES.user, 1, "regular"],
      ["sandboxJira", ROLES.user, 0.5, "occasional"]]},
  {name: "Marketing", group: "marketing", count: 28,
    titles: [["Marketing Manager", 30], ["Content Writer", 30], ["Growth Analyst", 20], ["Event Manager", 20]],
    products: [["confluence", ROLES.user, 1, "regular"], ["jira", ROLES.user, 0.5, "occasional"],
      ["jpd", ROLES.stakeholder, 0.3, "occasional"]]},
  {name: "Sales", group: "sales", count: 34,
    titles: [["Account Executive", 55], ["Sales Development Representative", 30], ["Sales Manager", 15]],
    products: [["confluence", ROLES.user, 1, "occasional"], ["jira", ROLES.user, 0.25, "rare"]]},
  {name: "Finance", group: "finance", count: 11,
    titles: [["Accountant", 55], ["Financial Analyst", 30], ["Controller", 15]],
    products: [["confluence", ROLES.user, 1, "occasional"], ["jira", ROLES.user, 0.2, "rare"]]},
  {name: "People", group: "people", count: 9,
    titles: [["People Partner", 50], ["Recruiter", 35], ["Head of People", 15]],
    products: [["confluence", ROLES.user, 1, "regular"], ["jsm", ROLES.user, 0.3, "regular"]]}
];

var LOCATIONS = [["Riga", "Europe/Riga", 35], ["Berlin", "Europe/Berlin", 20], ["Austin", "America/Chicago", 25],
  ["Toronto", "America/Toronto", 12], ["Remote", null, 8]];

var FIRST_NAMES = ["Ada", "Aiko", "Alma", "Amara", "Anders", "Anika", "Arjun", "Astrid", "Bastian", "Bea",
  "Camila", "Caspian", "Cleo", "Dalia", "Darius", "Edda", "Elio", "Elsa", "Emeka", "Enzo", "Esme", "Ezra",
  "Farah", "Felix", "Freya", "Gideon", "Greta", "Hana", "Hugo", "Ilse", "Imani", "Ines", "Ivo", "Jana",
  "Jasper", "Juno", "Kai", "Kalani", "Keanu", "Kira", "Lars", "Leila", "Linnea", "Lorenzo", "Luca", "Mara",
  "Marek", "Mateo", "Mila", "Nadia", "Nico", "Nika", "Noor", "Oskar", "Otto", "Paloma", "Pia", "Quinn",
  "Rafael", "Ravi", "Rhea", "Rina", "Ronan", "Rosa", "Sana", "Selma", "Silas", "Soren", "Tala", "Teo",
  "Thea", "Tomas", "Uma", "Vera", "Viggo", "Wren", "Yara", "Yusuf", "Zara", "Zeno"];
var LAST_NAMES = ["Abara", "Albrecht", "Andersen", "Arslan", "Balode", "Bergstrom", "Brennan", "Calder",
  "Castellano", "Dalton", "Delacroix", "Draper", "Eklund", "Falk", "Farrow", "Fontaine", "Galloway",
  "Grunwald", "Halvorsen", "Hartley", "Hayashi", "Holm", "Ibarra", "Iverson", "Jansons", "Kalnina",
  "Kaplan", "Kessler", "Kowalczyk", "Lindgren", "Lorenz", "Maddox", "Mancini", "Marlow", "Moreau",
  "Nakamura", "Navarro", "Nilsen", "Novak", "Okafor", "Olsen", "Ortega", "Pajari", "Petrov", "Quintero",
  "Rahman", "Ramsey", "Rasmussen", "Reyes", "Rinaldi", "Rosen", "Salonen", "Sandoval", "Sato", "Schreiber",
  "Sorensen", "Strand", "Takahashi", "Thorne", "Torres", "Ulrich", "Valdez", "Varga", "Vasquez", "Vogel",
  "Wallin", "Weber", "Whitlock", "Winter", "Yilmaz", "Zeller", "Zielinski", "Ozols", "Liepa", "Berzina",
  "Kruze", "Aalto", "Bianchi", "Duarte", "Engel"];
var CONTRACTOR_DOMAINS = ["northpine-consulting.example", "quillstack.example"];
var PARTNER_DOMAINS = ["blueharbor-partners.example", "meridian-agency.example", "fernway.example"];
var CUSTOMER_DOMAINS = ["orchard-health.example", "tidewater-logistics.example", "brightmeadow.example",
  "copperline.example", "silverbirch-bank.example", "redwood-retail.example", "aurora-labs.example"];

var people = [];
var usedNames = {};

function uniqueName() {
  for (;;) {
    let first = sample.pick(FIRST_NAMES);
    let last = sample.pick(LAST_NAMES);
    let name = `${first} ${last}`;
    if (!usedNames[name]) {
      usedNames[name] = true;
      return {first: first, last: last, name: name};
    }
  }
}

function addPerson(attributes) {
  var name = uniqueName();
  var domain = attributes.domain || DOMAIN;
  var location = attributes.department ? sample.pickWeighted(LOCATIONS.map((entry) => [entry, entry[2]])) : null;
  var person = _.extend({
    accountId: attributes.accountType === "customer"
      ? `qm:${sample.uuid()}:${sample.uuid()}` : `712020:${sample.uuid()}`,
    accountType: "atlassian",
    status: "active",
    name: name.name,
    email: `${name.first}.${name.last}@${domain}`.toLowerCase(),
    location: location ? location[0] : null,
    timeZone: location ? location[1] : null,
    groups: [],
    platformRoles: [],
    roles: {},
    activity: {}
  }, attributes);
  people.push(person);
  return person;
}

function lastActivity(profile) {
  var bucket = sample.pickWeighted(ACTIVITY_PROFILES[profile].map((weight, index) => [index, weight]));
  if (bucket >= ACTIVITY_DAYS_AGO.length) return null;

  return sample.dateTime({daysAgo: ACTIVITY_DAYS_AGO[bucket], hours: [7, 19]});
}

// A role on a workspace, with the last activity of the user in it; Bitbucket has no roles, its users are the
// users who were active in it.
function grant(person, code, roleId, profile) {
  if (roleId) {
    let roles = person.roles[code] || (person.roles[code] = []);
    if (roles.indexOf(roleId) < 0) roles.push(roleId);
  }
  if (!person.activity.hasOwnProperty(code)) person.activity[code] = lastActivity(profile);
}

function addGroup(person, group) {
  if (person.groups.indexOf(group) < 0) person.groups.push(group);
}

function addEmployee(department, attributes) {
  var person = addPerson(_.extend({
    department: department.name,
    jobTitle: sample.pickWeighted(department.titles),
    groups: [department.group]
  }, attributes));
  department.products.forEach((entry) => {
    if (sample.chance(entry[2])) grant(person, entry[0], entry[1], entry[3]);
  });
  return person;
}

DEPARTMENTS.forEach((department) => {
  department.people = sample.times(department.count, () => addEmployee(department));
});

function departmentPeople(name) {
  return _.find(DEPARTMENTS, (department) => department.name === name).people;
}

// Picks people of the list not picked before.
var picked = {};
function pickPeople(list, count) {
  var candidates = _.sortBy(list.filter((person) => !picked[person.accountId]), () => sample.random());
  return candidates.slice(0, count).map((person) => {
    picked[person.accountId] = true;
    return person;
  });
}

var itStaff = departmentPeople("IT");
var engineering = departmentPeople("Engineering");
var product = departmentPeople("Product");

// The org admins are admins of the main products as well; the site admins manage the users of the sites.
pickPeople(itStaff, 2).concat(pickPeople(engineering, 1)).forEach((person) => {
  person.platformRoles.push("atlassian/org-admin");
  addGroup(person, "org-admins");
  ["jira", "confluence", "jsm"].forEach((code) => grant(person, code, ROLES.admin, "daily"));
});
pickPeople(itStaff, 3).concat(pickPeople(engineering, 2)).forEach((person) => {
  person.platformRoles.push("atlassian/site-admin");
  addGroup(person, "site-admins");
});

[
  ["jira", engineering, 4], ["jira", product, 1], ["confluence", departmentPeople("People"), 1],
  ["confluence", departmentPeople("Marketing"), 1], ["jsm", departmentPeople("Customer Support"), 2],
  ["jpd", product, 2], ["labsJira", engineering, 1], ["labsConfluence", product, 1], ["assets", itStaff, 1],
  ["sandboxJira", itStaff, 2]
].forEach((entry) => {
  pickPeople(entry[1], entry[2]).forEach((person) => grant(person, entry[0], ROLES.admin, "regular"));
});
// Two of the IT admins also manage the users of Jira and of the service desk.
_.sortBy(itStaff, () => sample.random()).slice(0, 2).forEach((person) => {
  grant(person, "jira", ROLES.userAccessAdmin, "regular");
  grant(person, "jsm", ROLES.userAccessAdmin, "regular");
});

// The members of the product groups of the main site.
people.forEach((person) => {
  if (person.roles.jira) addGroup(person, "jira-software-users-larkspur");
  if (person.roles.confluence) addGroup(person, "confluence-users-larkspur");
  if (person.roles.jsm) addGroup(person, "jira-servicemanagement-users-larkspur");
});

// The contractors of two consultancies work in Jira and read Confluence.
sample.times(14, () => {
  var person = addPerson({domain: sample.pick(CONTRACTOR_DOMAINS), jobTitle: "Contractor",
    groups: ["contractors"]});
  grant(person, "jira", ROLES.user, "regular");
  if (sample.chance(0.5)) grant(person, "confluence", ROLES.user, "occasional");
});

// The partners read the shared Confluence spaces as guests.
sample.times(10, () => {
  var person = addPerson({domain: sample.pick(PARTNER_DOMAINS)});
  grant(person, "confluence", ROLES.guest, "occasional");
});

// The portal customers of the service desk, whose activity Atlassian does not track.
sample.times(48, () => {
  var person = addPerson({accountType: "customer", domain: sample.pick(CUSTOMER_DOMAINS)});
  person.roles.jsm = [ROLES.customer];
});

// The former employees: deactivated, without product access, with their last activity of long ago. One of
// them was a site admin.
sample.times(22, (index) => {
  var department = sample.pickWeighted(DEPARTMENTS.map((entry) => [entry, entry.count]));
  var person = addEmployee(department, {status: "deactivated"});
  Object.keys(person.activity).forEach((code) => {
    person.activity[code] = sample.chance(0.85) ? sample.dateTime({daysAgo: [720, 150], hours: [7, 19]}) : null;
  });
  person.roles = {};
  if (index === 0) {
    person.platformRoles.push("atlassian/site-admin");
    addGroup(person, "site-admins");
  }
});

// The suspended users keep their product access, which they have not used for months.
sample.times(4, () => {
  var department = sample.pickWeighted(DEPARTMENTS.map((entry) => [entry, entry.count]));
  var person = addEmployee(department, {status: "suspended"});
  Object.keys(person.activity).forEach((code) => {
    person.activity[code] = sample.dateTime({daysAgo: [300, 45], hours: [7, 19]});
  });
});

// The new hires who have not accepted their invitation yet.
sample.times(3, () => {
  var department = sample.pickWeighted(DEPARTMENTS.map((entry) => [entry, entry.count]));
  var person = addEmployee(department, {status: "not_invited"});
  person.roles = {};
  person.activity = {};
});

var groupIds = {};
function groupOf(name) {
  var id = groupIds[name] || (groupIds[name] = sample.uuid());
  return {id: `ari:cloud:identity::group/${id}`, name: name};
}

function directoryUser(person) {
  var employee = !!person.department;
  var accountStatus = {active: "active", suspended: "active", deactivated: "inactive", not_invited: "active"};
  var productAccess = Object.keys(person.activity).filter((code) => person.activity[code]).map((code) => ({
    key: WORKSPACES[code].accessKey,
    id: WORKSPACES[code].accessAri,
    lastActiveTimestamp: person.activity[code]
  }));

  return {
    accountId: person.accountId,
    accountType: person.accountType,
    accountStatus: accountStatus[person.status],
    status: person.status,
    name: person.name,
    email: person.email,
    department: person.department || null,
    jobTitle: person.jobTitle || null,
    organization: employee ? COMPANY : null,
    location: person.location,
    timeZone: person.timeZone,
    mfaEnabled: employee ? sample.chance(0.9) : sample.chance(0.4),
    emailVerified: true,
    claimStatus: employee ? "claimed" : "unclaimed",
    managementSource: employee ? sample.pickWeighted([["synced", 85], ["invited", 15]]) : "invited",
    addedToOrg: sample.dateTime({daysAgo: [6 * 365, 200], weekdays: true, hours: [8, 17]}),
    platformRoles: person.platformRoles,
    groups: person.groups.map(groupOf),
    productAccess: productAccess
  };
}

function searchResult(person) {
  return {accountId: person.accountId, accountType: person.accountType,
    accountStatus: person.status === "deactivated" ? "inactive" : "active"};
}

// The pages of one search of the directory users, with the cursor of the next page as a token.
function mockSearch(filter, results, cursorPrefix) {
  var pages = results.length > 0 ? sample.pages(results, PAGE_LIMIT) : [[]];
  pages.forEach((page, index) => {
    var body = _.extend({}, filter, {limit: PAGE_LIMIT});
    if (index > 0) body.cursor = `${cursorPrefix}-${index + 1}`;
    var links = {self: SEARCH_URL};
    if (index + 1 < pages.length) links.next = `${cursorPrefix}-${index + 2}`;
    mock.post(SEARCH_PATH, {requestBody: JSON.stringify(body), json: {data: page, links: links}});
  });
}

mock.sourceParams({org_id: ORG_ID, api_key: "sample"});
mock.sourceSelection([
  {key: `site/${SITES.main.cloudId}`, name: `${SITES.main.host} (all products)`},
  {key: `site/${SITES.labs.cloudId}`, name: `${SITES.labs.host} (all products)`},
  {key: `site/${SITES.sandbox.cloudId}`, name: `${SITES.sandbox.host} (all products)`},
  {key: `bitbucket/workspace/${BITBUCKET_WORKSPACE_ID}`, name: "Bitbucket — bitbucket.org/larkspur"}
]);
mock.extraOptions({import_product_roles: true});

mock.post(`/admin/v2/orgs/${ORG_ID}/workspaces`, {requestBody: JSON.stringify({limit: 250}), json: {
  data: Object.keys(WORKSPACES).map((code) => {
    var workspace = WORKSPACES[code];
    var attributes = {name: workspace.name, typeKey: workspace.typeKey, type: workspace.type, status: "online",
      hostUrl: workspace.hostUrl, createdAt: workspace.createdAt, realm: "eu"};
    if (workspace.capacity) attributes.capacity = workspace.capacity;
    if (workspace.sandbox) attributes.sandbox = {type: "CHILD"};
    return {
      id: workspace.ari,
      type: "workspaces",
      attributes: attributes,
      relationships: {entitlement: [{id: `entitlement-${code}`, type: "entitlements", attributes: {
        key: `${workspace.typeKey}.ondemand`, planKey: workspace.plan, plan: PLAN_NAMES[workspace.plan]
      }}]}
    };
  }),
  links: {self: `https://api.atlassian.com/admin/v2/orgs/${ORG_ID}/workspaces`}
}});

mock.get(`/admin/v2/orgs/${ORG_ID}/directories`, {json: {
  data: [{directoryId: DIRECTORY_ID, name: COMPANY}],
  links: {self: `https://api.atlassian.com/admin/v2/orgs/${ORG_ID}/directories`}
}});

mockSearch({expand: ["platformRoles", "groups", "productAccess"]}, people.map(directoryUser), "users");

// The users of every workspace with any role, and the holders of every role. Atlassian answers nobody for the
// searches of a Bitbucket workspace.
Object.keys(WORKSPACES).forEach((code) => {
  var aris = [WORKSPACES[code].ari];
  var holders = people.filter((person) => person.roles[code]);
  mockSearch({resourceIds: aris}, holders.map(searchResult), `${code}-users`);
  Object.keys(ROLES).forEach((role) => {
    var roleId = ROLES[role];
    mockSearch({roleIds: [roleId], resourceIds: aris},
      holders.filter((person) => person.roles[code].indexOf(roleId) >= 0).map(searchResult), `${code}-${role}`);
  });
});

// The managed accounts of the v1 endpoint, which the directory search answers in full.
mock.get(`/admin/v1/orgs/${ORG_ID}/users`, {json: {
  data: [],
  links: {self: `https://api.atlassian.com/admin/v1/orgs/${ORG_ID}/users`}
}});
