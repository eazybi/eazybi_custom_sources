// The projects the user selected on the source selection page. All projects imports the whole Harvest
// account. A selection of projects imports only those projects, the clients they belong to and the
// invoices of those clients, while the tasks, the people and the categories of the account are imported
// in full either way.
//
// eazyBI clears the max params when a project is added to the selection, so the next import reads the
// whole selection again and checks for deleted records. It keeps them when a project is taken out of it,
// so the selection an import read is stored, and the next import which finds one of its projects no
// longer selected checks for deleted records, which removes the rows and the members of that project.
//
// The clients of the selected projects are stored as well. The invoices of a client are imported while one
// of its projects is selected, so when a selected project is moved to another client in Harvest, only a
// check for deleted records imports the invoices of that client, which did not change, and removes those of
// the client the project belonged to.
app.importers.selection = {
  // The max param of the selection the stored rows were imported with.
  PARAM: "selection",
  // The max param of the clients of the selected projects the stored rows were imported with.
  CLIENTS_PARAM: "selection_clients",
  // The stored clients of a selection none of whose projects Harvest lists any more.
  NO_CLIENTS: "none",
  // The longest string a max param holds.
  MAX_PARAM_LENGTH: 1000,
  // Up to this many selected projects, a full read requests the time entries and the expenses project by
  // project, which reads only the rows it imports. Each selected project costs at least one request of its
  // own, so a larger selection reads the account wide lists, as an incremental import always does: its
  // lists hold only what changed.
  MAX_PROJECT_REQUESTS: 25,

  // Whether all projects are imported, and otherwise the ids of the selected projects of the projects
  // list and the ids of their clients, as sets of strings.
  all: true,
  projectIds: {},
  clientIds: {},
  // The sorted keys of the selection, which are stored with a successful import.
  keys: [],

  begin(fetchedProjects) {
    this.keys = this.currentKeys();
    this.all = this.keys[0] === app.api.ALL_PROJECTS_KEY;
    this.projectIds = {};
    this.clientIds = {};
    if (this.all) return;

    var projectsById = _.indexBy(fetchedProjects, (project) => String(project.id));
    var unknownKeys = [];
    this.keys.forEach((key) => {
      var project = projectsById[this.projectIdOf(key)];
      if (!project) {
        unknownKeys.push(key);
        return;
      }
      this.projectIds[String(project.id)] = true;
      if (project.client && project.client.id) this.clientIds[String(project.client.id)] = true;
    });
    if (unknownKeys.length > 0) {
      logger.info("Selected projects which Harvest no longer lists are not imported: " +
        `${unknownKeys.slice(0, 10).join(", ")}${unknownKeys.length > 10 ? ", …" : ""}`);
    }
  },

  // The selected keys, sorted, or the key of all projects alone when it is one of them. eazyBI starts no
  // import without a selection, but a test run starts with none, which imports all projects.
  currentKeys() {
    var allKey = app.api.ALL_PROJECTS_KEY;
    var keys = _.uniq((source.getSourceSelection() || []).map((key) => String(key))).sort();
    return (keys.length === 0 || keys.indexOf(allKey) >= 0) ? [allKey] : keys;
  },

  projectIdOf(key) {
    var prefix = app.api.PROJECT_KEY_PREFIX;
    return key.indexOf(prefix) === 0 ? key.substring(prefix.length) : null;
  },

  includesProject(projectId) {
    return this.all || this.projectIds[String(projectId)] === true;
  },

  includesClient(clientId) {
    return this.all || this.clientIds[String(clientId)] === true;
  },

  // The projects whose time entries or expenses are requested one by one for a list read since `since`,
  // or `[null]` for one account wide request.
  requestedProjectIds(since) {
    var projectIds = _.keys(this.projectIds);
    if (this.all || since || projectIds.length > this.MAX_PROJECT_REQUESTS) return [null];
    return _.sortBy(projectIds, (projectId) => Number(projectId));
  },

  // Whether a project of the stored selection is not selected any more, whose rows only a check for
  // deleted records removes. A project added to the selection is not: eazyBI has cleared the stored
  // selection with the other max params then.
  deselected() {
    var storedValue = source.getMaxParam(this.PARAM);
    if (storedValue === null || storedValue === undefined) return false;

    var keys = this.currentKeys();
    if (keys[0] === app.api.ALL_PROJECTS_KEY) return false;
    storedValue = String(storedValue);
    if (this.digested(storedValue)) return storedValue !== this.paramValue(keys);
    return storedValue.split(",").some((key) => keys.indexOf(key) === -1);
  },

  // Whether other clients have selected projects than the ones the stored rows were imported with, read
  // after begin. All projects import every client. Without the stored clients of a stored selection it is
  // not known, so it counts as changed; without both, eazyBI cleared the max params and the import reads
  // everything anyway.
  clientsChanged() {
    if (this.all) return false;

    var storedValue = source.getMaxParam(this.CLIENTS_PARAM);
    if (storedValue === null || storedValue === undefined) return this.stored();
    return String(storedValue) !== this.clientsParamValue();
  },

  stored() {
    var storedValue = source.getMaxParam(this.PARAM);
    return storedValue !== null && storedValue !== undefined;
  },

  finish() {
    this.storeParam(this.PARAM, this.paramValue(this.keys));
    this.storeParam(this.CLIENTS_PARAM, this.clientsParamValue());
  },

  storeParam(name, value) {
    if (value !== source.getMaxParam(name)) source.setMaxParam(name, value);
  },

  // The comma separated keys, or their count and digest when they do not fit into one max param — then
  // any other selection counts as one a project was taken out of. A key never holds a `#`.
  paramValue(keys) {
    return this.listValue(keys, "projects");
  },

  clientsParamValue() {
    if (this.all) return app.api.ALL_PROJECTS_KEY;

    var clientIds = _.sortBy(_.keys(this.clientIds), (clientId) => Number(clientId));
    return clientIds.length === 0 ? this.NO_CLIENTS : this.listValue(clientIds, "clients");
  },

  listValue(values, name) {
    var value = values.join(",");
    if (value.length <= this.MAX_PARAM_LENGTH) return value;
    return `${values.length} ${name} #${this.digestOf(value)}`;
  },

  digested(storedValue) {
    return storedValue.indexOf("#") >= 0;
  },

  digestOf(value) {
    var hash = 5381;
    for (var index = 0; index < value.length; index++) {
      hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
    }
    return (hash >>> 0).toString(16);
  }
};
