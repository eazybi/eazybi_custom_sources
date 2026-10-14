// The Harvest projects — the middle level of the Project Task dimension and the object every timesheet
// row belongs to. A project is billed in the currency of its client and at the rate its `bill_by`
// setting names, which the timesheet rows below read from here.
//
// The managers a project has now are rows of the project, which the Project Manager dimension joins to
// the rows of both cubes by their project, so every row of a project is reported under all of its managers.
app.importers.projects = {
  // The member a project without a manager is reported under, and so are the rows of a client which
  // belong to no project, so that the hours and the amounts of everything are still there when the
  // Project Manager dimension is on the report rows.
  NO_MANAGER: "(no manager)",

  storedById: {},
  // The names of every project of the projects list by id, also of those which are not imported.
  listedNamesById: {},
  clientProjectIdByClientId: {},
  reportedUnknownIds: {},

  importAll(fetchedProjects) {
    logger.startImport("projects");
    this.storedById = {};
    this.listedNamesById = {};
    this.clientProjectIdByClientId = {};
    this.reportedUnknownIds = {};
    var imported = 0;
    fetchedProjects.forEach((project) => {
      this.listedNamesById[String(project.id)] = this.displayName(project);
      // A project an earlier import did not find in the list (reportUnknown) is found now.
      source.warnings.clearOld(`project/${project.id}`);
      if (!app.importers.selection.includesProject(project.id)) return;
      this.storeProject(project);
      imported++;
    });
    // A row of the client itself — in the Invoices cube, an invoice which names no project — hangs under
    // one nameless project member of the client.
    app.importers.clients.each((client) => this.storeClientProject(client));
    logger.finishImport("projects", imported);
  },

  storeProject(project) {
    var clientId = project.client && project.client.id;
    var managerNames = app.importers.userAssignments.managerNamesOf(project.id);
    var memberId = dwh.dimensions.projects.createAndLookupId({id: project.id}, {
      client_id: clientId,
      name: this.displayName(project),
      code: project.code,
      status: project.is_active ? "Active" : "Archived",
      billable: project.is_billable,
      budget_by: project.budget_by,
      bill_by: project.bill_by,
      hourly_rate: project.hourly_rate,
      created_at: dwh.dateValue(project, "created_at"),
      updated_at: dwh.dateValue(project, "updated_at"),
      starts_on: dwh.dateValue(project, "starts_on"),
      ends_on: dwh.dateValue(project, "ends_on"),
      cost_budget_include_expenses: project.cost_budget_include_expenses,
      project_manager: managerNames.length > 0 ? managerNames.join(", ") : null,
      notes: project.notes || null,
      generation: app.importers.sweep.generation
    });
    this.storeManagers(memberId, managerNames);

    this.storedById[String(project.id)] = {
      id: project.id,
      memberId: memberId,
      name: this.displayName(project),
      currency: app.importers.clients.currencyOf(clientId),
      budget_by: project.budget_by,
      bill_by: project.bill_by,
      hourly_rate: project.hourly_rate,
      budget: project.budget,
      cost_budget: project.cost_budget,
      // The project task member of the rows which name no task of the project: an expense, a budget of
      // the project as a whole, and the time of a task the project does not assign any more.
      noTaskId: dwh.dimensions.project_tasks.createAndLookupId({id: -project.id},
        {project_id: project.id, name: null, generation: app.importers.sweep.generation})
    };
    return memberId;
  },

  // Harvest prefixes the project name with its code wherever it shows both.
  displayName(project) {
    return project.code ? `[${project.code}] ${project.name}` : project.name;
  },

  storeClientProject(client) {
    var memberId = dwh.dimensions.projects.createAndLookupId({id: -client.id},
      {client_id: client.id, name: null, generation: app.importers.sweep.generation});
    this.storeManagers(memberId, []);
    this.clientProjectIdByClientId[String(client.id)] = memberId;
    return memberId;
  },

  // A check for deleted records writes the manager rows of every project again, so that they carry its
  // generation and the rows of a project Harvest no longer lists are the only ones it removes. Any other
  // import writes them only when the managers of the project changed.
  storeManagers(projectId, managerNames) {
    var names = managerNames.length > 0 ? managerNames : [this.NO_MANAGER];
    if (!app.importers.sweep.sweeping && this.storedManagersMatch(projectId, names)) return;

    var generation = app.importers.sweep.generation;
    dwh.dimensions.project_managers.deleteRows({project_id: projectId});
    dwh.dimensions.project_managers.insertRows(names.map((name) =>
      ({project_id: projectId, name: name, generation: generation})));
  },

  // The stored rows cannot be listed, so they are counted: one row of every manager and no other row.
  storedManagersMatch(projectId, names) {
    var projectManagers = dwh.dimensions.project_managers;
    return projectManagers.selectCount({project_id: projectId}) === names.length &&
      names.every((name) => projectManagers.selectCount({project_id: projectId, name: name}) === 1);
  },

  stored(projectId) {
    return this.storedById[String(projectId)] || null;
  },

  listed(projectId) {
    return this.listedNamesById.hasOwnProperty(String(projectId));
  },

  listedNameOf(projectId) {
    return this.listedNamesById[String(projectId)] || null;
  },

  // The project of a time entry or of an expense, or null when its rows are not imported: a project which
  // is not selected is skipped, one which is not in the projects list is reported.
  ofRow(projectId) {
    var project = this.stored(projectId);
    if (!project && !this.listed(projectId)) this.reportUnknown(projectId);
    return project;
  },

  ofClient(clientId) {
    var memberId = this.clientProjectIdByClientId[String(clientId)];
    return memberId === undefined ? null : memberId;
  },

  each(callback) {
    _.values(this.storedById).forEach(callback);
  },

  // A time entry, an expense or an invoice line item of a project the projects list did not answer — a
  // project created while this import was reading. The failure holds the incremental mark back, so that
  // the next import reads the project and imports its rows; it is reported once per project and not once
  // per row.
  reportUnknown(projectId) {
    var projectKey = String(projectId);
    if (this.reportedUnknownIds[projectKey]) return;

    this.reportedUnknownIds[projectKey] = true;
    source.warnings.addObjectFailure(`project/${projectId}`,
      `Harvest project ${projectId} was not in the projects list, so its time entries, expenses and ` +
      "invoices were not imported. The next import imports them.");
  }
};
