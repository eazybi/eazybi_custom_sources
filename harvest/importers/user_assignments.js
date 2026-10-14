// The people assigned to a project: who manages it, what their hour is billed at, and how many hours are
// budgeted for them.
//
// The assignments are always read in full: they hold the rate of every timesheet row of a project billed by
// person, and the budget rows of one project are one import scope which an incremental list would leave
// incomplete.
app.importers.userAssignments = {
  byProjectId: {},
  managerNamesByProjectId: {},

  fetchAll() {
    logger.startImport("user assignments");
    this.byProjectId = {};
    this.managerNamesByProjectId = {};
    var count = 0;
    app.api.getUserAssignments(null, null, (batch) => {
      batch.forEach((assignment) => {
        if (this.collect(assignment)) count++;
      });
    });
    logger.finishImport("user assignments", count);
  },

  collect(assignment) {
    var projectId = assignment.project && assignment.project.id;
    var userId = assignment.user && assignment.user.id;
    if (!projectId || !userId || !app.importers.selection.includesProject(projectId)) return false;

    var projectKey = String(projectId);
    if (!this.byProjectId[projectKey]) this.byProjectId[projectKey] = {};
    this.byProjectId[projectKey][String(userId)] = {
      id: assignment.id, user_id: userId, budget: assignment.budget, hourly_rate: assignment.hourly_rate
    };
    if (this.managesProject(assignment)) this.collectManager(projectKey, userId);
    return true;
  },

  // Harvest keeps the assignment of a person who was taken off the project, or whose Harvest user was
  // archived, as an inactive one. That person does not manage the project any more.
  managesProject(assignment) {
    return !!assignment.is_project_manager && assignment.is_active !== false;
  },

  // A manager the users list did not answer has no name to report, so the project is reported under its
  // other managers.
  collectManager(projectKey, userId) {
    var name = app.importers.users.uniqueNameOf(userId);
    if (!name) return;

    if (!this.managerNamesByProjectId[projectKey]) this.managerNamesByProjectId[projectKey] = [];
    this.managerNamesByProjectId[projectKey].push(name);
  },

  ofProject(projectId, userId) {
    var assignmentsOfProject = this.byProjectId[String(projectId)];
    return (assignmentsOfProject && assignmentsOfProject[String(userId)]) || null;
  },

  allOfProject(projectId) {
    return _.values(this.byProjectId[String(projectId)] || {});
  },

  // The names of all managers of the project, sorted and each of them once. Harvest names none of them the
  // main manager of the project.
  managerNamesOf(projectId) {
    return _.uniq(this.managerNamesByProjectId[String(projectId)] || []).sort();
  }
};
