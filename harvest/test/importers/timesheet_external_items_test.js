// The references below have the shape Harvest answers: `service` is the host of the permalink.
//
// The file name sorts after test/importers/selection_test.js: a test run keeps the first 2000 log lines of
// the whole run, and that file reads a log line of its own.
var COMPANY = {name: "API Examples", base_uri: "https://example.harvestapp.com", expense_feature: true};
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";

function mockDimensions() {
  // The fixture people were created in February 2012, and their capacity until the end of March 2012 keeps
  // the rows a test reads few.
  mock.spyOn(app.importers.capacity, "lastDayOf").mockReturnValue("2012-03-31");
  mock.sourceParams({api_token: "secret-token", site_url: COMPANY.base_uri});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: "1234567", name: "Acme", product: "harvest"}]}});
  mock.extraOptions({time_dimension_time_zone: "UTC"});
  mock.get("/v2/clients", {fixture: "clients"});
  mock.get("/v2/projects", {fixture: "projects"});
  mock.get("/v2/tasks", {fixture: "tasks_page1"});
  mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, fixture: "tasks_page2"});
  mock.get("/v2/users", {fixture: "users"});
  mock.get("/v2/task_assignments", {fixture: "task_assignments"});
  mock.get("/v2/user_assignments", {fixture: "user_assignments"});
  mock.get("/v2/expense_categories", {fixture: "expense_categories"});
  mock.get(ECB_RATES_URL, {fixture: "eurofxref-daily.xml",
                           headers: {"Content-Type": "application/xml"}});
}

function importDimensions() {
  importRun.prepare();
  app.importer.importDimensions(COMPANY, {since: null, importExpenses: true},
    app.importer.beginSelection());
}

function timeEntry(attributes) {
  var entry = {id: 74615858, spent_date: "2012-02-01", hours_without_timer: 8, rounded_hours: 8,
               is_closed: false, is_billed: false, notes: "Develop Highrise integration",
               project: {id: 1930103}, task: {id: 1245127}, user: {id: 312294}};
  for (var key in attributes) entry[key] = attributes[key];
  return entry;
}

function reference(permalink, id, attributes) {
  var host = /^https:\/\/([^/?#]+)/.exec(permalink)[1];
  var result = {id: id, group_id: "0", account_id: null, permalink: permalink, service: host,
                service_icon_url: null};
  for (var key in attributes) result[key] = attributes[key];
  return result;
}

function jiraReference(permalink, id, groupId) {
  return reference(permalink, id, {group_id: groupId || "10000"});
}

function importEntries(entries) {
  mock.get("/v2/time_entries", {json: {time_entries: entries}});
  app.importers.timeEntries.importAll({timeEntriesSince: null});
}

function storedItems() {
  var servicesById = {};
  dwh.dimensions.external_services.rows({columns: ["id", "name"]}).
    forEach((row) => servicesById[row.id] = row.name);
  return dwh.dimensions.external_items.rows({columns: ["id", "key", "service_id", "name", "item_id",
                                                       "group_id", "issue_key", "permalink"]}).
    map((row) => _.extend(_.omit(row, "service_id"), {service: servicesById[row.service_id]}));
}

function itemNamed(name) {
  return _.detect(storedItems(), (item) => item.name === name);
}

function entryItemIds() {
  var itemIdsBySourceId = {};
  dwh.measures.timesheets.rows({columns: ["_source_id", "_source_name", "external_item_id"]}).
    filter((row) => row._source_name === "custom_harvest time entry").
    forEach((row) => itemIdsBySourceId[row._source_id] = row.external_item_id);
  return itemIdsBySourceId;
}

describe("app.importers.externalItems", () => {
  beforeEach(() => {
    mockDimensions();
    importDimensions();
  });

  test("names a Jira issue by the key and the summary the Harvest app for Jira writes into the notes", () => {
    importEntries([timeEntry({notes: "HAR-31: Checkout page redesign",
      external_reference: jiraReference("https://eazybi.atlassian.net/browse/HAR-31", "10131")})]);

    expect(storedItems().map((item) => _.omit(item, "id"))).toEqual([
      {key: "Jira|eazybi.atlassian.net|10131", name: "HAR-31: Checkout page redesign",
       item_id: "10131", group_id: "10000", issue_key: "HAR-31",
       permalink: "https://eazybi.atlassian.net/browse/HAR-31", service: "Jira"}
    ]);
  });

  // A timer started on a board stores the board, which names the issue in its query.
  test("takes the issue key from the permalink when the notes do not start with it", () => {
    importEntries([timeEntry({notes: "Highrise integration", external_reference: jiraReference(
      "https://eazybi.atlassian.net/jira/software/projects/EAZY/boards/1?selectedIssue=EAZY-12", "10012")})]);

    expect(itemNamed("EAZY-12 Highrise integration")).toMatchObject({issue_key: "EAZY-12"});
  });

  test("names a Jira issue by its id when neither the notes nor the permalink name its key", () => {
    importEntries([timeEntry({notes: null, external_reference: jiraReference(
      "https://eazybi.atlassian.net/jira/software/projects/EAZY/boards/1", "10012")})]);

    expect(storedItems()).toMatchObject([{name: "Jira 10012", issue_key: null, service: "Jira"}]);
  });

  test("names a Jira issue of no known key by the notes, a Linear issue by its identifier and notes", () => {
    importEntries([
      timeEntry({id: 1, notes: "Highrise integration", external_reference: jiraReference(
        "https://eazybi.atlassian.net/jira/software/projects/EAZY/boards/1", "10012")}),
      timeEntry({id: 2, notes: "Fix the login page", external_reference: reference(
        "https://linear.app/eazybi/issue/ENG-123", "ENG-123", {group_id: "eazybi"})})
    ]);

    expect(_.pluck(storedItems(), "name").sort()).
      toEqual(["ENG-123 Fix the login page", "Highrise integration"]);
  });

  test("names the items of the other tools by their identifier and the notes", () => {
    importEntries([
      timeEntry({id: 1, notes: "Import expenses by category",
        external_reference: reference("https://github.com/eazybi/harvest-demo/issues/42", "42",
          {group_id: "harvest-demo", account_id: "eazybi"})}),
      timeEntry({id: 2, notes: "ENG-123", external_reference: reference(
        "https://linear.app/eazybi/issue/ENG-123", "ENG-123", {group_id: "eazybi"})}),
      timeEntry({id: 3, notes: "Write onboarding emails", external_reference: reference(
        "https://trello.com/c/Ab3dE9xZ", "Ab3dE9xZ", {group_id: "5f1c2b3a4d5e6f7a8b9c0d1e"})}),
      timeEntry({id: 4, notes: "", external_reference: reference(
        "https://app.asana.com/0/0/1205123456789012", "1205123456789012")}),
      timeEntry({id: 5, notes: "Client kickoff\nagenda and notes", external_reference: reference(
        "https://eazybidev.monday.com/boards/1234567890/pulses/9876543210", "9876543210",
        {group_id: "1234567890"})})
    ]);

    expect(_.sortBy(storedItems().map((item) => [item.service, item.name]), (pair) => pair[0])).toEqual([
      ["Asana", "Asana 1205123456789012"],
      ["GitHub", "eazybi/harvest-demo#42 Import expenses by category"],
      ["Linear", "ENG-123"],
      ["Trello", "Write onboarding emails"],
      ["monday.com", "Client kickoff"]
    ]);
  });

  test("reports an item of a service it does not know under the host of the service", () => {
    importEntries([timeEntry({notes: "Plan the sprint", external_reference: reference(
      "https://app.clickup.com/t/86b1abc", "86b1abc")})]);

    expect(storedItems()).toMatchObject([{service: "app.clickup.com", name: "Plan the sprint"}]);
  });

  test("keeps apart the items of two long hosts which differ only after the service name", () => {
    var prefix = `${new Array(61).join("a")}.${new Array(61).join("b")}.${new Array(61).join("c")}`;
    importEntries([
      timeEntry({id: 1, notes: "Plan the sprint", external_reference: reference(
        `https://${prefix}.one.example/t/42`, "42", {account_id: "1"})}),
      timeEntry({id: 2, notes: "Plan the release", external_reference: reference(
        `https://${prefix}.two.example/t/42`, "42", {account_id: "1"})})
    ]);

    var items = storedItems();
    expect(_.pluck(items, "name").sort()).toEqual(["Plan the release", "Plan the sprint"]);
    expect(_.uniq(_.pluck(items, "service"))).toEqual([prefix.substring(0, 100)]);
    items.forEach((item) => expect(item.key.length).toBeLessThan(256));
  });

  test("keeps one item of the entries linked to it, also of an issue moved to another project", () => {
    importEntries([
      timeEntry({id: 1, notes: "HAR-31: Checkout page redesign",
        external_reference: jiraReference("https://eazybi.atlassian.net/browse/HAR-31", "10131")}),
      timeEntry({id: 2, notes: "SHOP-4: Checkout page redesign",
        external_reference: jiraReference("https://eazybi.atlassian.net/browse/SHOP-4", "10131", "10002")})
    ]);

    var items = storedItems();
    expect(items).toHaveLength(1);
    expect(entryItemIds()).toEqual({"1": items[0].id, "2": items[0].id});
  });

  test("keeps one GitHub issue whether the reference names its repository or not", () => {
    importEntries([
      timeEntry({id: 1, notes: "Fix the login", external_reference: reference(
        "https://github.com/eazybi/repo/issues/42", "42", {group_id: "repo", account_id: "eazybi"})}),
      timeEntry({id: 2, notes: "Fix the login", external_reference: reference(
        "https://github.com/eazybi/repo/issues/42", "42", {group_id: "", account_id: null})}),
      timeEntry({id: 3, notes: "Fix the login", external_reference: reference(
        "https://github.com/eazybi/repo", "42", {group_id: "repo", account_id: "eazybi"})})
    ]);

    expect(_.pluck(storedItems(), "key")).toEqual(["GitHub|eazybi/repo|42"]);
  });

  test("keeps apart the GitHub issues of two owners and the Linear issues of two workspaces", () => {
    importEntries([
      timeEntry({id: 1, notes: "Fix the login", external_reference: reference(
        "https://github.com/alice/repo/issues/42", "42", {group_id: "repo"})}),
      timeEntry({id: 2, notes: "Fix the login", external_reference: reference(
        "https://github.com/bob/repo/issues/42", "42", {group_id: "repo"})}),
      timeEntry({id: 3, notes: "ENG-123", external_reference: reference(
        "https://linear.app/workspace-a/issue/ENG-123/title", "ENG-123", {group_id: ""})}),
      timeEntry({id: 4, notes: "ENG-123", external_reference: reference(
        "https://linear.app/workspace-b/issue/ENG-123/title", "ENG-123", {group_id: ""})})
    ]);

    expect(_.pluck(storedItems(), "key").sort()).toEqual(["GitHub|alice/repo|42", "GitHub|bob/repo|42",
                                                          "Linear|workspace-a|ENG-123",
                                                          "Linear|workspace-b|ENG-123"]);
  });

  test("cuts a key longer than its column and tells two such keys apart by a hash", () => {
    var host = `${new Array(64).join("a")}.${new Array(64).join("b")}.${new Array(64).join("c")}.example.com`;
    var longId = new Array(80).join("7");
    importEntries([
      timeEntry({id: 1, notes: "Plan the sprint", external_reference: reference(
        `https://${host}/t/1`, `${longId}1`)}),
      timeEntry({id: 2, notes: "Plan the release", external_reference: reference(
        `https://${host}/t/2`, `${longId}2`)})
    ]);

    var keys = _.pluck(storedItems(), "key");
    expect(keys).toHaveLength(2);
    keys.forEach((key) => expect(key).toMatch(/^.{246}#[0-9a-f]{8}$/));
    expect(keys[0]).not.toEqual(keys[1]);
  });

  test("links an entry whose reference values are longer than their columns", () => {
    var longText = new Array(301).join("x");
    importEntries([timeEntry({notes: "Plan the sprint", external_reference: reference(
      "https://tools.example.com/t/1", longText, {group_id: longText, account_id: longText})})]);

    var items = storedItems();
    expect(items).toMatchObject([{item_id: longText.substring(0, 255),
                                  group_id: longText.substring(0, 255)}]);
    expect(entryItemIds()).toEqual({"74615858": items[0].id});
  });

  // The notes are the user's, so what looks like an issue key at their start can be of any length.
  test("links a Jira entry whose notes start with a key longer than its column", () => {
    var longKey = `${new Array(301).join("A")}-1`;
    importEntries([timeEntry({notes: `${longKey}: Checkout page redesign`,
      external_reference: jiraReference("https://eazybi.atlassian.net/browse/HAR-31", "10131")})]);

    expect(storedItems()).toMatchObject([{issue_key: longKey.substring(0, 255)}]);
    expect(entryItemIds()).toEqual({"74615858": storedItems()[0].id});
  });

  test("tells apart two items whose notes are the same by their member id", () => {
    importEntries([
      timeEntry({id: 1, notes: "Code review", external_reference: reference(
        "https://trello.com/c/Ab3dE9xZ", "Ab3dE9xZ")}),
      timeEntry({id: 2, notes: "Code review", external_reference: reference(
        "https://trello.com/c/Zx9Ed3bA", "Zx9Ed3bA")})
    ]);

    var items = _.sortBy(storedItems(), "id");
    expect(_.pluck(items, "name")).toEqual(items.map((item) => `Code review (${item.id})`));
  });

  test("keeps the issues of two Jira sites apart", () => {
    importEntries([
      timeEntry({id: 1, notes: "HAR-31: Checkout page redesign",
        external_reference: jiraReference("https://eazybi.atlassian.net/browse/HAR-31", "10131")}),
      timeEntry({id: 2, notes: "OPS-7: Rotate keys",
        external_reference: jiraReference("https://customer.atlassian.net/browse/OPS-7", "10131")})
    ]);

    expect(_.pluck(storedItems(), "key").sort()).toEqual(["Jira|customer.atlassian.net|10131",
                                                          "Jira|eazybi.atlassian.net|10131"]);
  });

  test("links an entry without a reference to no item", () => {
    importEntries([timeEntry({external_reference: null})]);

    expect(storedItems()).toEqual([]);
    expect(entryItemIds()).toEqual({"74615858": null});
  });
});

// The linked hours of the fixture account: four of its time entries are linked to a Jira issue, a GitHub
// issue, a Trello card and an Asana task, 16 of its 80.1 hours.
describe("the linked hours of an imported Harvest account", () => {
  beforeAll(() => {
    mockDimensions();
    mock.get("/v2/company", {fixture: "company"});
    mock.get("/v2/users/me", {fixture: "users_me"});
    mock.get("/v2/invoice_item_categories", {fixture: "invoice_item_categories"});
    mock.get("/v2/time_entries", {fixture: "time_entries"});
    mock.get("/v2/expenses", {fixture: "expenses"});
    mock.get("/v2/invoices", {fixture: "invoices"});

    importRun.run();
  });

  test("sums the hours of every service and the linked hours", () => {
    expect(olap.results(`
      SELECT {[Measures].[Hours]} ON COLUMNS,
             NON EMPTY [External Item].[Service].Members ON ROWS
      FROM [Harvest Timesheets]
    `)).toEqual([["Asana", 2], ["GitHub", 4], ["Jira", 4], ["Trello", 6]]);

    // The one person of the fixture account tracked all of its time.
    var totals = olap.results(`
      SELECT {[Measures].[Hours], [Measures].[Linked hours], [Measures].[Unlinked hours],
              [Measures].[Linked hours %]} ON COLUMNS,
             NON EMPTY [Person].[Person].Members ON ROWS
      FROM [Harvest Timesheets]
    `);
    expect(totals.map((row) => row.slice(0, 3))).toEqual([["Riley Smith", 80.1, 16]]);
    expect(totals[0][3]).toBeCloseTo(64.1, 6);
    expect(totals[0][4]).toBeCloseTo(16 / 80.1, 6);
  });
});

describe("the items of an account whose time entry was unlinked in Harvest", () => {
  var TRELLO_ENTRY_ID = 74615910;

  beforeEach(() => {
    mockDimensions();
    mock.get("/v2/company", {fixture: "company"});
    mock.get("/v2/users/me", {fixture: "users_me"});
    mock.get("/v2/invoice_item_categories", {fixture: "invoice_item_categories"});
    mock.get("/v2/time_entries", {fixture: "time_entries"});
    mock.get("/v2/expenses", {fixture: "expenses"});
    mock.get("/v2/invoices", {fixture: "invoices"});
  });

  test("removes the item and its service with the next check", () => {
    importRun.run();
    expect(_.pluck(storedItems(), "service").sort()).toEqual(["Asana", "GitHub", "Jira", "Trello"]);

    var timeEntries = mock.fixture("time_entries");
    _.detect(timeEntries.time_entries, (entry) => entry.id === TRELLO_ENTRY_ID).external_reference = null;
    mock.get("/v2/time_entries", {json: timeEntries});
    importRun.run({reimport: true});

    expect(_.pluck(storedItems(), "service").sort()).toEqual(["Asana", "GitHub", "Jira"]);
    expect(dwh.dimensions.external_services.rows({columns: ["name"]}).map((row) => row.name).sort()).
      toEqual(["Asana", "GitHub", "Jira"]);
    expect(entryItemIds()[String(TRELLO_ENTRY_ID)]).toBeNull();
  });
});
