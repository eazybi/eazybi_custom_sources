// All requests to the Atlassian Marketplace REST API v3.
//
// The reporting endpoints answer a large data set only through an asynchronous export: the export
// is requested, prepared in the background and then downloaded as one CSV file. The hrefs of the
// responses are relative to the `/rest/3` base URL of the manifest, which is why every path here is
// written the same way — the export paths are built from the export id, so that a request never
// depends on the shape of an answered href.
app.api = {
  // The two exports this type imports, and everything that differs between them.
  EXPORTS: {
    licenses: {path: "licenses", label: "licenses"},
    transactions: {path: "sales/transactions", label: "transactions"}
  },

  // The Marketplace answers at most 50 listings per page, and a vendor never has thousands of
  // apps — the guard is only there so that a broken `next` link cannot loop forever.
  LISTINGS_PAGE_SIZE: 50,
  MAX_LISTINGS_PAGES: 100,

  // The developer space of the import. The user may enter the developer space UUID or the numeric
  // vendor ID of the partner portal, which the Marketplace resolves into the UUID.
  resolveDeveloperId() {
    var entered = String(source.getSourceParam("developer_id") || "").trim();
    if (!entered) return null;
    if (!/^\d+$/.test(entered)) return entered;
    var resolved = source.getCachedDocument(`/developer-space/vendor/${entered}`, {},
      {ignoreErrors: [401, 403, 404]});
    return (resolved && resolved.developerId) || null;
  },

  // Reads the developer space and its reporting resources: the credentials may be valid and still
  // have no access to the reports, which is a different problem with a different fix.
  testConnection() {
    var developerId = this.resolveDeveloperId();
    if (!developerId) {
      return {errors: [{field: "developer_id",
        message: "Could not find this developer space. Enter the developer space ID or the " +
                 "numeric vendor ID of your Marketplace vendor account."}]};
    }

    var space = source.getDocument(`/developer-space/${developerId}`, {},
      {ignoreErrors: [401, 403, 404]});
    if (!space || !space.id) {
      return {errors: [{field: "api_token",
        message: "Could not read the developer space with these credentials. Check the Atlassian " +
                 "account email, the API token and the developer space ID."}]};
    }

    var reporting = source.getDocument(`/reporting/developer-space/${developerId}`, {},
      {ignoreErrors: [401, 403, 404]});
    if (!reporting || !reporting._links) {
      return {errors: [{field: "username",
        message: `The account may read the developer space ${space.name} but not its reports. ` +
                 "Ask a vendor administrator for a role which may read the licenses and the " +
                 "sales reports."}]};
    }

    return {authentication: {developer_space: space.name, developer_id: developerId}};
  },

  // The apps of the developer space, newest listing API, paged by an opaque cursor.
  getApps(developerId) {
    var apps = [];
    var cursor = null;
    for (let page = 0; page < this.MAX_LISTINGS_PAGES; page++) {
      let requestParams = {limit: this.LISTINGS_PAGE_SIZE, includePrivate: true};
      if (cursor) requestParams.cursor = cursor;
      let listing = source.getDocument(`/product-listing/developer-space/${developerId}`,
        requestParams);
      let items = (listing && listing.items) || [];
      items.forEach((item) => {
        // A deleted listing has no data to import and would only clutter the selection list.
        if (item.appKey && item.state !== "DELETED") apps.push(item);
      });
      cursor = this.nextCursorOf(listing);
      if (!cursor) break;
    }
    return apps;
  },

  // The cursor of the next page, read from the `next` link of the listing response.
  nextCursorOf(listing) {
    var next = listing && listing.links && listing.links.next;
    if (!next) return null;
    var match = String(next).match(/[?&]cursor=([^&]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1]);
  },

  // The apps the user selects from before importing. The key is the app key, because that is what
  // the export endpoints filter by.
  getSourceSelections() {
    var developerId = this.resolveDeveloperId();
    var apps = developerId ? this.getApps(developerId) : [];
    return {
      label: "Select apps",
      hint: "Only the licenses and the transactions of the selected apps are imported",
      multiple: true,
      options: apps.map((app) => ({key: app.appKey, name: this.appName(app)}))
    };
  },

  appName(app) {
    var name = app.appName || app.appKey;
    if (app.state && app.state !== "PUBLIC") return `${name} (${app.state.toLowerCase()})`;
    return name;
  },

  // Starts an export and returns the answered document with its `export.id`. An app filter is an
  // array, which is sent as the `addon` parameter repeated once per selected app.
  startExport(developerId, kind, params) {
    var path = `/reporting/developer-space/${developerId}/` +
      `${this.EXPORTS[kind].path}/async/export`;
    return source.postDocument(path, null, this.presentParams(params));
  },

  // The params without their null, undefined and empty values — an empty app filter included,
  // which imports every app — so that the callers can pass their optional filters unconditionally.
  presentParams(params) {
    var present = {};
    for (let key in params) {
      let value = params[key];
      let empty = value === null || value === undefined || value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (!empty) present[key] = value;
    }
    return present;
  },

  // The download path of a prepared export; with `/status` it is the status path.
  exportPath(developerId, kind, exportId, suffix) {
    return `/reporting/developer-space/${developerId}/${this.EXPORTS[kind].path}` +
      `/async/export/${exportId}${suffix || ""}`;
  },

  // Waits until the export is prepared. A failed export raises, which fails the import with a
  // message naming the export instead of leaving the user with an empty result.
  waitForExport(developerId, kind, exportId) {
    var statusPath = this.exportPath(developerId, kind, exportId, "/status");
    var label = this.EXPORTS[kind].label;
    return source.waitFor(() => {
      var document = source.getDocument(statusPath);
      var status = document && document.export && document.export.status;
      if (status === "FAILED")
        throw new Error(`The Atlassian Marketplace ${label} export failed`);
      return status === "COMPLETED" ? document : null;
    }, {message: `Waiting for the ${label} export`});
  },

  // Downloads the prepared export and yields its rows in batches. The file is read row by row and
  // deleted afterwards, so an export of any size can be imported.
  downloadExport(developerId, kind, exportId, batchCallback) {
    source.downloadDocuments(this.exportPath(developerId, kind, exportId),
      {format: "csv", countRows: true, batchSize: 1000}, batchCallback);
  }
};
