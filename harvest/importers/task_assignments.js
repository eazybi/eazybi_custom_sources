// The tasks a project assigns — the Task level of the Project Task dimension. An assignment carries the
// billable flag, the hourly rate and the budget the project gives that task, which is what a timesheet
// row of the project and the task is measured with.
//
// The assignments are read in full on every import, for the same reason the user assignments are.
app.importers.taskAssignments = {
  byProjectId: {},

  importAll() {
    logger.startImport("project tasks");
    this.byProjectId = {};
    var count = 0;
    app.api.getTaskAssignments(null, null, (batch) => {
      batch.forEach((assignment) => {
        if (this.storeAssignment(assignment)) count++;
      });
    });
    logger.finishImport("project tasks", count);
  },

  storeAssignment(assignment) {
    var projectId = assignment.project && assignment.project.id;
    var taskId = assignment.task && assignment.task.id;
    if (!app.importers.selection.includesProject(projectId)) return false;
    // An assignment of a project or a task the account no longer lists has no member to hang under.
    if (!app.importers.projects.stored(projectId) || !app.importers.tasks.stored(taskId)) {
      logger.debug(`Skipped task assignment ${assignment.id} of an unknown project or task`);
      return false;
    }

    var memberId = dwh.dimensions.project_tasks.createAndLookupId({id: assignment.id}, {
      project_id: projectId,
      task_id: taskId,
      name: app.importers.tasks.nameOf(taskId),
      deactivated: !assignment.is_active,
      billable: assignment.billable,
      hourly_rate: assignment.hourly_rate,
      generation: app.importers.sweep.generation
    });

    var projectKey = String(projectId);
    if (!this.byProjectId[projectKey]) this.byProjectId[projectKey] = {};
    this.byProjectId[projectKey][String(taskId)] = {
      id: assignment.id, memberId: memberId, task_id: taskId, billable: assignment.billable,
      hourly_rate: assignment.hourly_rate, budget: assignment.budget
    };
    return true;
  },

  ofProject(projectId, taskId) {
    var assignmentsOfProject = this.byProjectId[String(projectId)];
    return (assignmentsOfProject && assignmentsOfProject[String(taskId)]) || null;
  },

  allOfProject(projectId) {
    return _.values(this.byProjectId[String(projectId)] || {});
  }
};
