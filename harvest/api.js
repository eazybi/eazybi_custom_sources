// Every request carries two credentials: the personal access token, which the manifest sends as the
// Authorization header, and the numeric account ID, which Harvest accepts either as the
// Harvest-Account-Id header or as the `account_id` query parameter. A manifest declares one header only
// and a secret is never readable from JavaScript, so the account ID travels in the query string — the
// pairing Harvest documents for a personal access token — and every request here is built with
// requestParams, which adds it.
//
// The account ID is not entered: it is the Harvest account of the entered web address. Harvest lists the
// accounts of a token at id.getharvest.com, which the manifest allows with the credentials, and the
// company of each account answers its web address. A token which reaches one Harvest account uses it, the
// connection test checks that it is at the entered address; of several, the one at the address is
// imported, and none of them is ever guessed.
//
// The lists are paged by an opaque cursor: a page answers its records under the name of the endpoint and
// the URL of the next page in `links.next`, already carrying the cursor, the page size and the filters of
// the request. That URL is requested as it is, with the account ID added, because it is the one parameter
// Harvest does not put into it.
//
// Harvest answers HTTP 429 with a Retry-After header when the 100 requests per 15 seconds are exceeded,
// which eazyBI already waits out and retries — this file adds no throttling of its own.
app.api = {
  // The largest, and the default, page size of the v2 API.
  PER_PAGE: 2000,
  MAX_PAGES: 10000,
  ADMINISTRATOR_ROLE: "administrator",
  // The daily euro reference rates, the same public document the built-in Harvest application reads.
  ECB_RATES_URL: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
  // The accounts a token reaches, of Harvest and of Harvest Forecast, which has accounts of its own.
  ACCOUNTS_URL: "https://id.getharvest.com/api/v2/accounts",
  HARVEST_PRODUCT: "harvest",
  // The web address a Harvest account is reached at, which is the only address the member links may
  // point to. Harvest hosts every account on its own harvestapp.com subdomain.
  SITE_URL_REGEX: /^https:\/\/[a-z0-9][a-z0-9-]*\.harvestapp\.com\/?$/i,
  // The keys of the source selection options, here and not with the importers: api.js alone builds the
  // source selection page. eazyBI adds the option of all projects itself (the manifest declares
  // `sourceSelection.all`), which Select all ticks as in the built-in applications.
  ALL_PROJECTS_KEY: "(all)",
  PROJECT_KEY_PREFIX: "project/",
  // eazyBI keeps the first 5000 options of a source selection.
  MAX_SELECTION_OPTIONS: 5000,

  // Harvest answers the account wide lists of this app only to an administrator, so a valid token of a
  // regular user is reported as its own problem — the import would otherwise fail later with nothing but an
  // authorization error.
  testConnection() {
    var siteUrlError = this.siteUrlError();
    if (siteUrlError) return {errors: [siteUrlError]};

    // Read anew and not from the per-import cache: the form is tested again after the token was changed.
    var account = this.findAccount(false);
    if (account.error) return {errors: [account.error]};

    var user = source.getDocument("users/me", this.requestParams({}, account.id),
      {ignoreErrors: [401, 403, 404]});
    if (!user || !user.id) {
      return {errors: [{field: "api_token",
        message: "Could not read the Harvest user of this token. Check the personal access token " +
                 "and the Harvest web address."}]};
    }
    if (!this.administrator(user)) {
      return {errors: [{field: "api_token",
        message: `${this.userName(user)} is not a Harvest administrator. ` +
                 "You must have Administrator permissions to import Harvest data."}]};
    }

    var company = this.getCompany(account.id);
    var baseUri = this.normalizedUrl(company && company.base_uri);
    if (baseUri && baseUri !== this.normalizedUrl(source.getSourceParam("site_url"))) {
      return {errors: [{field: "site_url",
        message: `The Harvest account of this token is at ${baseUri}. Enter this web address.`}]};
    }
    return {authentication: {account: (company && company.name) || null, user: this.userName(user)}};
  },

  // The account ID of the requests as {id}, or as {error} for the form.
  findAccount(cached) {
    var read = (url, params, options) =>
      (cached ? source.getCachedDocument(url, params, options) : source.getDocument(url, params, options));

    var document = read(this.ACCOUNTS_URL, {}, {ignoreErrors: [401, 403]});
    if (!document || !document.accounts) {
      return {error: {field: "api_token",
        message: "Could not read the Harvest accounts of this token. Check the personal access token."}};
    }

    var accounts = document.accounts.filter((account) => account.product === this.HARVEST_PRODUCT);
    if (accounts.length === 1) return {id: String(accounts[0].id)};
    if (accounts.length === 0) {
      return {error: {field: "api_token", message: "This token reaches no Harvest account."}};
    }

    var siteUrl = this.normalizedUrl(source.getSourceParam("site_url"));
    var addresses = [];
    for (let account of accounts) {
      let company = read("company", {account_id: String(account.id)}, {ignoreErrors: [401, 403, 404]});
      let baseUri = this.normalizedUrl(company && company.base_uri);
      if (baseUri && baseUri === siteUrl) return {id: String(account.id)};
      addresses.push(baseUri || `${account.name} (${account.id})`);
    }
    return {error: {field: "site_url",
      message: `This token reaches no Harvest account at ${siteUrl}, only ${addresses.join(", ")}. ` +
               "Enter the web address of the account to import."}};
  },

  normalizedUrl(url) {
    return url ? String(url).trim().replace(/\/+$/, "").toLowerCase() : null;
  },

  // The account ID of an import, whose requests cannot report to the form.
  accountId() {
    var account = this.findAccount(true);
    if (account.error) throw new Error(account.error.message);
    return account.id;
  },

  administrator(user) {
    return (user.access_roles || []).indexOf(this.ADMINISTRATOR_ROLE) >= 0;
  },

  // Nothing is requested from the site URL — it selects the account and builds the Harvest links of the
  // clients, the projects and the people, so another address would link every member to a page that does
  // not exist. Only the form of the address is checked here; the connection test compares it with the one
  // Harvest answers, and so does the import.
  siteUrlError() {
    if (this.SITE_URL_REGEX.test(String(source.getSourceParam("site_url") || "").trim())) return null;

    return {field: "site_url",
      message: "Enter the web address of your Harvest account, for example " +
               "https://yourcompany.harvestapp.com."};
  },

  userName(user) {
    var name = [user.first_name, user.last_name].filter((part) => part).join(" ");
    return name || user.email;
  },

  // eazyBI ticks nothing on the page of a new source application and starts no import without a selection,
  // so the hint tells to select all projects.
  //
  // The projects list is read with getCachedDocument, whose documents last for one request: an eazyBI which
  // does not keep the options for the request asks for them once per selected project when the selection
  // is saved, and Harvest is then asked for the list only once. A project answers the name of its client,
  // so the clients list is not read.
  getSourceSelections() {
    var projects = this.getAllPages("projects", "projects", {}, {cached: true});
    var sortedProjects = _.sortBy(projects, (project) => [
      this.sortName(project.client && project.client.name), this.sortName(project.name), String(project.id)
    ].join("\u0000"));
    var listedProjects = this.listedProjects(sortedProjects);
    var hint = "Select all imports the whole Harvest account, also the projects created later. Tick single " +
      "projects instead to import only those projects, their clients and the invoices of their clients.";
    if (listedProjects.length < sortedProjects.length) {
      hint += ` Only ${listedProjects.length} of the ${sortedProjects.length} projects of the account ` +
        "are listed: the selected ones, then the active ones, then the archived ones.";
    }

    return {
      label: "Select projects",
      hint: hint,
      multiple: true,
      options: listedProjects.map((project) =>
        ({key: this.projectKeyOf(project.id), name: this.selectionName(project)}))
    };
  },

  // The projects which fit into the options, in the order they are given in. eazyBI drops the options above
  // its limit, and a selected project which is dropped would be taken out of the selection with the next
  // save of it. So the selected projects are listed first of all, the active ones after them, and the
  // archived ones as far as there is room.
  listedProjects(sortedProjects) {
    var limit = this.MAX_SELECTION_OPTIONS;
    if (sortedProjects.length <= limit) return sortedProjects;

    var selectedKeys = {};
    source.getSourceSelection().forEach((key) => {
      selectedKeys[String(key)] = true;
    });
    var listedIds = {};
    // A stable sort, so that the projects of one rank are kept in the order of the list.
    _.sortBy(sortedProjects, (project) => {
      if (selectedKeys[this.projectKeyOf(project.id)]) return 0;
      return project.is_active === false ? 2 : 1;
    }).slice(0, limit).forEach((project) => {
      listedIds[String(project.id)] = true;
    });
    return sortedProjects.filter((project) => listedIds[String(project.id)]);
  },

  projectKeyOf(projectId) {
    return `${this.PROJECT_KEY_PREFIX}${projectId}`;
  },

  // "Client / [CODE] Name", the way Harvest lists a project under its client.
  selectionName(project) {
    var clientName = (project.client && project.client.name) || "(no client)";
    var projectName = project.code ? `[${project.code}] ${project.name}` : project.name;
    return `${clientName} / ${projectName}${project.is_active === false ? " (archived)" : ""}`;
  },

  sortName(name) {
    return String(name || "").toLowerCase();
  },

  // The Harvest account itself: the web address of it, its name, and the `expense_feature` and
  // `invoice_feature` flags that tell whether expenses and invoices are tracked at all. It is read once
  // per import and once per connection test, so it is requested and not memoized.
  getCompany(accountId) {
    return source.getDocument("company", this.requestParams({}, accountId));
  },

  getCurrentUser() {
    return source.getDocument("users/me", this.requestParams({}));
  },

  getClients(updatedSince, isActive) {
    return this.getAllPages("clients", "clients", this.listParams(updatedSince, isActive));
  },

  getProjects(updatedSince, isActive) {
    return this.getAllPages("projects", "projects", this.listParams(updatedSince, isActive));
  },

  getTasks(updatedSince, isActive) {
    return this.getAllPages("tasks", "tasks", this.listParams(updatedSince, isActive));
  },

  getUsers(updatedSince, isActive) {
    return this.getAllPages("users", "users", this.listParams(updatedSince, isActive));
  },

  getExpenseCategories(updatedSince, isActive) {
    return this.getAllPages("expense_categories", "expense_categories",
      this.listParams(updatedSince, isActive));
  },

  getInvoiceItemCategories(updatedSince) {
    return this.getAllPages("invoice_item_categories", "invoice_item_categories",
      this.listParams(updatedSince));
  },

  // The task and the user assignments of every project at once. An account has one assignment per project
  // and task and per project and person, which is an order of magnitude more records than there are
  // projects or tasks, so they are streamed page by page instead of being collected into one array.
  getTaskAssignments(updatedSince, isActive, batchCallback) {
    this.eachPage("task_assignments", "task_assignments", this.listParams(updatedSince, isActive),
      batchCallback);
  },

  getUserAssignments(updatedSince, isActive, batchCallback) {
    this.eachPage("user_assignments", "user_assignments", this.listParams(updatedSince, isActive),
      batchCallback);
  },

  // This is the longest list of an import by far, therefore it is streamed and never collected.
  getTimeEntries(updatedSince, batchCallback, projectId) {
    this.eachPage("time_entries", "time_entries", this.projectListParams(updatedSince, projectId),
      batchCallback);
  },

  getExpenses(updatedSince, batchCallback, projectId) {
    this.eachPage("expenses", "expenses", this.projectListParams(updatedSince, projectId), batchCallback);
  },

  getInvoices(updatedSince, batchCallback) {
    this.eachPage("invoices", "invoices", this.listParams(updatedSince), batchCallback);
  },

  // The euro rate of every currency the European Central Bank publishes today, as {USD: 1.3388, ...} with
  // EUR itself included.
  getEuroExchangeRates() {
    var rates = {EUR: 1};
    var cubes = source.getDocument(this.ECB_RATES_URL, {},
      {sendAuth: false, format: "xml", xpath: "//Cube[@currency]", ignoreErrors: true}) || [];
    cubes.forEach((cube) => {
      var rate = parseFloat(cube.rate);
      if (cube.currency && rate > 0) rates[cube.currency] = rate;
    });
    return rates;
  },

  // `is_active` selects the active or the archived records and is left out — which returns both — unless
  // the caller asks for one of them.
  listParams(updatedSince, isActive) {
    var params = {};
    if (updatedSince) params.updated_since = updatedSince;
    if (isActive === true || isActive === false) params.is_active = isActive;
    return params;
  },

  projectListParams(updatedSince, projectId) {
    var params = this.listParams(updatedSince);
    if (projectId) params.project_id = projectId;
    return params;
  },

  // The connection test passes the ID it found.
  requestParams(params, accountId) {
    var requestParams = Object.assign({}, params);
    requestParams.account_id = accountId || this.accountId();
    return requestParams;
  },

  // Return "stop" from the callback to stop fetching.
  //
  // A list which cannot be read to its end fails the import instead of ending early: the incremental mark
  // would advance past the records of the pages never read, and a check for deleted records would delete
  // every one of them.
  //
  // The `cached` option reads every page with getCachedDocument, whose documents live as long as the
  // source application object eazyBI requests them for — one import, or one request of the source
  // selection page.
  eachPage(path, arrayKey, requestParams, batchCallback, options) {
    var cached = !!(options && options.cached);
    var params = this.requestParams(requestParams);
    params.per_page = this.PER_PAGE;
    var url = path;

    for (let page = 0; page < this.MAX_PAGES; page++) {
      let document = cached ? source.getCachedDocument(url, params) : source.getDocument(url, params);
      if (!document) throw new Error(`Harvest answered no document for ${url}`);

      let batch = document[arrayKey] || [];
      if (batch.length > 0 && batchCallback(batch) === "stop") return;

      let nextUrl = document.links && document.links.next;
      if (!nextUrl) return;
      if (nextUrl === url) throw new Error(`Harvest repeated the page URL ${url} of ${path}`);

      url = nextUrl;
      params = this.requestParams();
    }
    throw new Error(`Harvest answered more than ${this.MAX_PAGES} pages of ${path}`);
  },

  getAllPages(path, arrayKey, requestParams, options) {
    var records = [];
    this.eachPage(path, arrayKey, requestParams, (batch) => {
      batch.forEach((record) => records.push(record));
    }, options);
    return records;
  }
};
