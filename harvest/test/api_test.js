var ACCOUNT_ID = "1234567";
// The web address of the company.json account.
var SITE_URL = "https://example.harvestapp.com";
var ACCOUNTS_URL = "https://id.getharvest.com/api/v2/accounts";
var ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
// The cursor that the `links.next` URL of tasks_page1.json carries, and that URL.
var TASKS_PAGE2_CURSOR = "eyJhZnRlciI6eyJpZCI6MTI0NTEyN319";
var TASKS_PAGE2_URL = `https://api.harvestapp.com/v2/tasks?cursor=${TASKS_PAGE2_CURSOR}&per_page=4`;

function mockAccounts(accounts) {
  mock.get(ACCOUNTS_URL, {json: {accounts: accounts}});
}

function mockAccount(accountId) {
  mockAccounts([{id: Number(accountId), name: "Acme", product: "harvest"}]);
}

function accountRequests() {
  return mock.requests().filter((request) => request.path !== "/api/v2/accounts");
}

describe("app.api", () => {
  beforeEach(() => {
    mock.sourceParams({api_token: "secret-token", site_url: SITE_URL});
    mockAccount(ACCOUNT_ID);
  });

  test("testConnection returns the Harvest account and the user of the token", () => {
    mock.get("/v2/users/me", {fixture: "users_me"});
    mock.get("/v2/company", {fixture: "company"});

    expect(app.api.testConnection()).toEqual({
      authentication: {account: "API Examples", user: "Bob Powell"}
    });
    expect(mock.requests().map((request) => request.params.account_id)).toEqual(
      [undefined, ACCOUNT_ID, ACCOUNT_ID]);
  });

  test("testConnection reports a rejected token on the form", () => {
    mock.get("/v2/users/me", {status: 401, json: {message: "Unauthorized"}});

    var result = app.api.testConnection();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("api_token");
    expect(result.errors[0].message).toMatch("Check the personal access token");
  });

  test("testConnection refuses a user who is not a Harvest administrator", () => {
    mock.get("/v2/users/me", {json: {id: 1782884, first_name: "Bob", last_name: "Powell",
                                     email: "bobpowell@example.com", access_roles: ["member"]}});

    var result = app.api.testConnection();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("api_token");
    expect(result.errors[0].message).toMatch("Bob Powell is not a Harvest administrator");
    expect(mock.requestedPaths()).not.toContain("/v2/company");
  });

  test("testConnection accepts the web address of the account as it is typed", () => {
    mock.sourceParams({api_token: "secret-token", site_url: " https://EXAMPLE.harvestapp.com/ "});
    mock.get("/v2/users/me", {fixture: "users_me"});
    mock.get("/v2/company", {fixture: "company"});

    expect(app.api.testConnection().errors).toBeUndefined();
  });

  test("testConnection reports a web address which is not a Harvest one on the form", () => {
    mock.sourceParams({api_token: "secret-token", site_url: "http://eazybi.example.com"});

    var result = app.api.testConnection();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("site_url");
    expect(mock.requests()).toHaveLength(0);
  });

  test("testConnection reports an empty web address on the form", () => {
    mock.sourceParams({api_token: "secret-token", site_url: ""});

    expect(app.api.testConnection().errors).toEqual([{field: "site_url",
      message: "Enter the web address of your Harvest account, for example " +
               "https://yourcompany.harvestapp.com."}]);
  });

  test("testConnection tells the web address of the one Harvest account of the token", () => {
    mock.sourceParams({api_token: "secret-token", site_url: "https://other.harvestapp.com"});
    mock.get("/v2/users/me", {fixture: "users_me"});
    mock.get("/v2/company", {fixture: "company"});

    expect(app.api.testConnection().errors).toEqual([{field: "site_url",
      message: "The Harvest account of this token is at https://example.harvestapp.com. " +
               "Enter this web address."}]);
  });

  describe("finding the account of the web address", () => {
    test("testConnection uses the one Harvest account of the token", () => {
      mockAccounts([
        {id: 7654321, name: "Forecast of Acme", product: "forecast"},
        {id: 2345678, name: "Acme", product: "harvest"}
      ]);
      mock.get("/v2/users/me", {fixture: "users_me"});
      mock.get("/v2/company", {fixture: "company"});

      expect(app.api.testConnection()).toEqual({
        authentication: {account: "API Examples", user: "Bob Powell"}
      });
      expect(mock.requests().map((request) => request.params.account_id)).toEqual(
        [undefined, "2345678", "2345678"]);
    });

    test("testConnection uses the account at the web address of the several the token reaches", () => {
      mockAccounts([
        {id: 352237, name: "Acme", product: "harvest"},
        {id: 2253641, name: "Acme test", product: "harvest"}
      ]);
      mock.get("/v2/company", {params: {account_id: "352237"},
                               json: {name: "Acme", base_uri: "https://acme.harvestapp.com"}});
      mock.get("/v2/company", {params: {account_id: "2253641"}, fixture: "company"});
      mock.get("/v2/users/me", {fixture: "users_me"});

      expect(app.api.testConnection()).toEqual({
        authentication: {account: "API Examples", user: "Bob Powell"}
      });
      expect(mock.requests().filter((request) => request.path === "/v2/users/me")[0].params.account_id).
        toBe("2253641");
    });

    test("testConnection lists the web addresses of the accounts when none is at the entered one", () => {
      mock.sourceParams({api_token: "secret-token", site_url: "https://other.harvestapp.com"});
      mockAccounts([
        {id: 352237, name: "Acme", product: "harvest"},
        {id: 2253641, name: "Acme test", product: "harvest"}
      ]);
      mock.get("/v2/company", {params: {account_id: "352237"},
                               json: {name: "Acme", base_uri: "https://acme.harvestapp.com"}});
      mock.get("/v2/company", {params: {account_id: "2253641"}, status: 403, json: {}});

      expect(app.api.testConnection().errors).toEqual([{field: "site_url",
        message: "This token reaches no Harvest account at https://other.harvestapp.com, only " +
                 "https://acme.harvestapp.com, Acme test (2253641). " +
                 "Enter the web address of the account to import."}]);
    });

    test("testConnection reports a token which reaches no Harvest account", () => {
      mockAccounts([{id: 7654321, name: "Forecast of Acme", product: "forecast"}]);

      expect(app.api.testConnection().errors).toEqual([{field: "api_token",
        message: "This token reaches no Harvest account."}]);
    });

    test("testConnection reports a rejected token", () => {
      mock.get(ACCOUNTS_URL, {status: 401, json: {error: "invalid_token"}});

      var result = app.api.testConnection();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("api_token");
      expect(result.errors[0].message).toMatch("Could not read the Harvest accounts of this token");
    });

    test("an import reads the accounts once for all its requests", () => {
      mock.get("/v2/company", {fixture: "company"});

      app.api.getCompany();
      app.api.getCompany();

      expect(mock.requests().map((request) => request.params.account_id)).toEqual(
        [undefined, ACCOUNT_ID, ACCOUNT_ID]);
    });
  });

  describe("getSourceSelections", () => {
    test("offers every project under its client, sorted by both names", () => {
      mock.get("/v2/projects", {fixture: "projects"});

      var selections = app.api.getSourceSelections();

      expect(selections).toMatchObject({label: "Select projects", multiple: true});
      expect(selections.hint).toContain("Select all imports the whole Harvest account");
      expect(selections.options).toEqual([
        {key: "project/1930109",
         name: "Big US company / [IMPL-BIGUS] eazyBI implementation for Big US company"},
        {key: "project/1930103", name: "eazyBI / [EAZYBI] eazyBI development"},
        {key: "project/11637625", name: "eazyBI / FIXED-PRICE"},
        {key: "project/1930099", name: "eazyBI / Internal"},
        {key: "project/1930115",
         name: "Small European company / [CONS-SMALLEU] Consulting for Small European company"}
      ]);
      expect(accountRequests().map((request) => request.path)).toEqual(["/v2/projects"]);
    });

    test("marks an archived project and sorts the names of the clients and the projects by letter", () => {
      mock.get("/v2/projects", {json: {projects: [
        {id: 3, name: "website", code: null, is_active: true, client: {id: 20, name: "beta"}},
        {id: 1, name: "Old website", code: "OLD", is_active: false, client: {id: 20, name: "beta"}},
        {id: 2, name: "Support", code: "", is_active: true, client: {id: 10, name: "Alpha"}}
      ]}});

      expect(app.api.getSourceSelections().options).toEqual([
        {key: "project/2", name: "Alpha / Support"},
        {key: "project/1", name: "beta / [OLD] Old website (archived)"},
        {key: "project/3", name: "beta / website"}
      ]);
    });

    test("requests every page of the projects once however often it is asked", () => {
      mock.get("/v2/projects", {json: {
        projects: [{id: 1, name: "Website", is_active: true, client: {id: 10, name: "Alpha"}}],
        links: {next: "https://api.harvestapp.com/v2/projects?cursor=page2&per_page=1"}}});
      mock.get("/v2/projects", {params: {cursor: "page2"}, json: {
        projects: [{id: 2, name: "Support", is_active: true, client: {id: 10, name: "Alpha"}}]}});

      app.api.getSourceSelections();
      var options = app.api.getSourceSelections().options;

      expect(options.map((option) => option.key)).toEqual(["project/2", "project/1"]);
      expect(accountRequests()).toHaveLength(2);
      expect(accountRequests()[1].params).toMatchObject({cursor: "page2", account_id: ACCOUNT_ID});
    });

    test("lists the selected, the active and then the archived projects when not all of them fit", () => {
      mock.sourceSelection(["project/4"]);
      mock.get("/v2/projects", {json: {projects: [
        {id: 1, name: "Audit", is_active: false, client: {id: 10, name: "Alpha"}},
        {id: 2, name: "Build", is_active: true, client: {id: 10, name: "Alpha"}},
        {id: 3, name: "Care", is_active: true, client: {id: 10, name: "Alpha"}},
        {id: 4, name: "Zoo", is_active: false, client: {id: 20, name: "Beta"}}
      ]}});
      var maxSelectionOptions = app.api.MAX_SELECTION_OPTIONS;
      app.api.MAX_SELECTION_OPTIONS = 3;
      try {
        var selections = app.api.getSourceSelections();

        expect(selections.options.map((option) => option.key)).
          toEqual(["project/2", "project/3", "project/4"]);
        expect(selections.hint).toContain("Only 3 of the 4 projects of the account are listed");

        app.api.MAX_SELECTION_OPTIONS = 4;
        selections = app.api.getSourceSelections();

        expect(selections.options).toHaveLength(4);
        expect(selections.hint).not.toContain("are listed");
      } finally {
        app.api.MAX_SELECTION_OPTIONS = maxSelectionOptions;
      }
    });
  });

  test("getTimeEntries and getExpenses narrow the list to one project", () => {
    mock.get("/v2/time_entries", {fixture: "time_entries"});
    mock.get("/v2/expenses", {fixture: "expenses"});

    app.api.getTimeEntries(null, () => {}, "1930103");
    app.api.getExpenses("2026-01-01T00:00:00Z", () => {}, "1930109");
    app.api.getTimeEntries(null, () => {});

    expect(accountRequests().map((request) => request.params)).toEqual([
      {account_id: ACCOUNT_ID, per_page: "2000", project_id: "1930103"},
      {account_id: ACCOUNT_ID, per_page: "2000", project_id: "1930109",
       updated_since: "2026-01-01T00:00:00Z"},
      {account_id: ACCOUNT_ID, per_page: "2000"}
    ]);
  });

  test("getTasks follows the next page URL of the cursor pagination", () => {
    mock.get("/v2/tasks", {fixture: "tasks_page1"});
    mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, fixture: "tasks_page2"});

    expect(app.api.getTasks().map((task) => task.id)).toEqual([
      1245122, 1245124, 1245133, 1245127, 1245123, 1245128, 1245125
    ]);

    expect(accountRequests()).toHaveLength(2);
    expect(accountRequests()[0].params).toMatchObject({per_page: "2000"});
    expect(accountRequests()[0].params.cursor).toBeUndefined();
    expect(accountRequests()[1].params).toMatchObject({cursor: TASKS_PAGE2_CURSOR, per_page: "4"});
  });

  test("eachPage stops paging when the callback returns stop", () => {
    mock.get("/v2/tasks", {fixture: "tasks_page1"});
    mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, fixture: "tasks_page2"});
    var pages = 0;

    app.api.eachPage("tasks", "tasks", {}, () => {
      pages++;
      return "stop";
    });

    expect(pages).toBe(1);
    expect(accountRequests()).toHaveLength(1);
  });

  test("eachPage fails when Harvest answers no document for a page", () => {
    mock.get("/v2/tasks", {fixture: "tasks_page1"});
    mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, json: null});

    expect(() => app.api.getTasks()).toThrow(`Harvest answered no document for ${TASKS_PAGE2_URL}`);
  });

  test("eachPage fails when Harvest answers the requested page URL as the next one", () => {
    mock.get("/v2/tasks", {fixture: "tasks_page1"});
    mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR},
                           json: {tasks: [{id: 1245125}], links: {next: TASKS_PAGE2_URL}}});

    expect(() => app.api.getTasks()).toThrow(`Harvest repeated the page URL ${TASKS_PAGE2_URL} of tasks`);
    expect(accountRequests()).toHaveLength(2);
  });

  test("eachPage fails when Harvest answers more pages than it reads", () => {
    mock.get("/v2/tasks", {fixture: "tasks_page1"});
    mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, json: {tasks: [{id: 1245125}],
      links: {next: "https://api.harvestapp.com/v2/tasks?cursor=page3&per_page=4"}}});
    var maxPages = app.api.MAX_PAGES;
    app.api.MAX_PAGES = 2;

    try {
      expect(() => app.api.getTasks()).toThrow("Harvest answered more than 2 pages of tasks");
    } finally {
      app.api.MAX_PAGES = maxPages;
    }
    expect(accountRequests()).toHaveLength(2);
  });

  test("sends the account ID with every request to Harvest", () => {
    mock.get("/v2/clients", {fixture: "clients"});
    mock.get("/v2/tasks", {fixture: "tasks_page1"});
    mock.get("/v2/tasks", {params: {cursor: TASKS_PAGE2_CURSOR}, fixture: "tasks_page2"});

    app.api.getClients();
    app.api.getTasks();

    expect(accountRequests()).toHaveLength(3);
    accountRequests().forEach((request) => {
      expect(request.params.account_id).toBe(ACCOUNT_ID);
    });
  });

  test("narrows a list with updated_since and is_active, and asks for everything without them", () => {
    mock.get("/v2/projects", {fixture: "projects"});
    mock.get("/v2/clients", {fixture: "clients"});

    app.api.getProjects("2026-01-01T00:00:00Z", true);
    app.api.getClients();

    expect(accountRequests()[0].params).toEqual({
      account_id: ACCOUNT_ID, per_page: "2000", updated_since: "2026-01-01T00:00:00Z",
      is_active: "true"
    });
    expect(accountRequests()[1].params).toEqual({account_id: ACCOUNT_ID, per_page: "2000"});
  });

  test("reads the euro reference rates from the public ECB document", () => {
    mock.get(ECB_RATES_URL, {fixture: "eurofxref-daily.xml",
                             headers: {"Content-Type": "application/xml"}});

    var rates = app.api.getEuroExchangeRates();

    expect(rates.EUR).toBe(1);
    expect(rates.USD).toBeCloseTo(1.3388);
    expect(rates.GBP).toBeCloseTo(0.845);
    expect(Object.keys(rates)).toHaveLength(34);
    expect(accountRequests()[0].params.account_id).toBeUndefined();
  });

  // Rates that cannot be read cost the import its currency conversion, not the import itself.
  test("returns the euro rate alone when the ECB document cannot be read", () => {
    mock.get(ECB_RATES_URL, {status: 404, body: "Not Found"});

    expect(app.api.getEuroExchangeRates()).toEqual({EUR: 1});
  });
});
