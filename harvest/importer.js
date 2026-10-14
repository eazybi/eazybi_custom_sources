// Only the time entries, the expenses and the invoices are narrowed by `updated_since`. The other lists
// are read in full on every import: they hold the fallback rate and billable flag of every timesheet row,
// the client and the project of every invoice, and the budget rows of a project are one import scope
// which an incremental list would leave incomplete.
app.importer = {
  // The max param of the Harvest features which were on at the last import, as comma separated names,
  // empty when neither was.
  FEATURES_PARAM: "features",

  importAll() {
    // Captured before anything is read, so that nothing changed while the import runs is missed by the
    // next one. Harvest takes `updated_since` with second precision, and a wider range is safe.
    var importStartedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    var company = app.api.getCompany() || {};
    this.checkSiteUrl(company);
    this.checkAdministrator();
    // Before the check is decided: other clients of the selected projects than those of the import before
    // make this import a check.
    var fetchedProjects = this.beginSelection();
    // Once Harvest has answered, so that an import which cannot reach it leaves the stored rows alone.
    app.importers.sweep.begin(importStartedAt);
    var since = app.importers.sweep.sweeping ? null : source.getMaxParam("updated_at");

    // Harvest answers the expenses and the invoices, and the categories of both, only to an account
    // which tracks expenses and which invoices at all.
    var shared = {importExpenses: company.expense_feature !== false,
                  importInvoices: company.invoice_feature !== false, importStartedAt: importStartedAt};
    shared.expensesSince = this.featureSince("expenses", since);
    shared.invoicesSince = this.featureSince("invoices", since);

    this.importDimensions(company, shared, fetchedProjects);
    // After the working times, which read the business hours and the non-working days.
    shared.timeEntriesSince = app.importers.workingTimes.timeEntriesSince(since);
    shared.movedTimeEntriesSince = app.importers.workingTimes.reclassifying ? since : null;
    this.importMeasures(shared);
    // After the time entries, which tell the days a person tracked time on.
    app.importers.capacity.importAll(importStartedAt);

    app.importers.currencies.finish();
    app.importers.sweep.finish(importStartedAt);
    // The incremental mark may advance only when everything of its range was imported — the next import
    // asks for the same range again and imports what failed. The features and the working time
    // classification are stored with it, so that a list read in full because of them is read in full
    // again after a failure.
    if (source.warnings.objectFailures().length === 0) {
      source.setMaxParam("updated_at", this.markOf(importStartedAt));
      this.storeFeatures(shared);
      app.importers.workingTimes.storeClassification();
      app.importers.selection.finish();
    }
  },

  // One second before the import started: Harvest stamps a change with the second it was made in, so a
  // record changed within the second the import started, after its page was read, is read again by the
  // next import. Reading a record again replaces its own rows.
  markOf(importStartedAt) {
    return new Date(Date.parse(importStartedAt) - 1000).toISOString().replace(/\.\d+Z$/, "Z");
  },

  // The `updated_since` of the expenses or of the invoices. Harvest keeps them while their feature is
  // turned off, but a check removes the stored ones, and an incremental import would not read those which
  // did not change again until the next check. So the first import after the feature is turned on again
  // reads the list in full. Without the param it is not known which features were on, and the mark stays.
  featureSince(feature, since) {
    var storedFeatures = source.getMaxParam(this.FEATURES_PARAM);
    if (storedFeatures === null || storedFeatures === undefined) return since;
    return String(storedFeatures).split(",").indexOf(feature) === -1 ? null : since;
  },

  storeFeatures(shared) {
    var features = [];
    if (shared.importExpenses) features.push("expenses");
    if (shared.importInvoices) features.push("invoices");
    var value = features.join(",");
    if (value !== source.getMaxParam(this.FEATURES_PARAM)) source.setMaxParam(this.FEATURES_PARAM, value);
  },

  beginSelection() {
    var fetchedProjects = app.api.getProjects();
    app.importers.selection.begin(fetchedProjects);
    return fetchedProjects;
  },

  importDimensions(company, shared, fetchedProjects) {
    source.setStatusMessage("Importing Harvest clients, projects and people");
    app.importers.approvalStatuses.importAll();
    app.importers.workingTimes.importAll();
    app.importers.externalItems.begin();
    app.importers.clients.importAll();
    app.importers.currencies.importAll(company, app.importers.clients.currencies());
    app.importers.users.importAll();
    app.importers.tasks.importAll();
    // Before the projects: a project member names the people who manage it.
    app.importers.userAssignments.fetchAll();
    app.importers.projects.importAll(fetchedProjects);
    app.importers.taskAssignments.importAll();
    // After both assignment lists: which of them a project is budgeted by is what `budget_by` says.
    app.importers.budgets.importAll();

    if (shared.importExpenses) app.importers.expenseCategories.importAll();
    else logger.info("Expense tracking is turned off in Harvest, expenses are not imported");

    if (shared.importInvoices) app.importers.invoiceItemCategories.importAll();
    else logger.info("Invoicing is turned off in Harvest, invoices are not imported");
  },

  importMeasures(shared) {
    source.setStatusMessage("Importing Harvest time entries");
    app.importers.timeEntries.importAll(shared);

    if (shared.importExpenses) {
      source.setStatusMessage("Importing Harvest expenses");
      app.importers.expenses.importAll(shared);
    }

    if (shared.importInvoices) {
      source.setStatusMessage("Importing Harvest invoices");
      app.importers.invoices.importAll(shared);
    }
  },

  // The web address names the Harvest account to import. A token which reaches one account imports it
  // without comparing the address (api.js findAccount), so the import stops before it writes anything when
  // that account is at another address: a token which lost access to the account of the address but
  // reaches another one would otherwise import the other account and remove the stored one with a check.
  checkSiteUrl(company) {
    var baseUri = app.api.normalizedUrl(company.base_uri);
    if (!baseUri || baseUri === app.api.normalizedUrl(source.getSourceParam("site_url"))) return;

    throw new Error(`The Harvest account of this token is at ${baseUri}, not at the entered Harvest web ` +
      "address. Enter the web address of this account, or a token of the account at the entered address.");
  },

  // Harvest answers a user who is not an administrator only the projects, the people and the time the user
  // manages, and a check for deleted records would remove all the others. The connection test checks the
  // role when the token is entered, and every import checks it again before it reads anything.
  checkAdministrator() {
    var user = app.api.getCurrentUser();
    if (user && app.api.administrator(user)) return;

    throw new Error(`${user ? app.api.userName(user) : "The user of this token"} is not a Harvest ` +
      "administrator any more. Enter a personal access token of a Harvest administrator.");
  }
};
