// The budget of a project, as timesheet rows which belong to no day.
//
// Harvest budgets a project by its own hours or cost, by the hours or the fees of each of its tasks, or
// by the hours of each of its people, and the `budget_by` setting of the project names which of them the
// Budgeted hours and Budgeted cost measures are read from. All budget rows of one project are therefore
// one import scope, and a project which stopped being budgeted loses its rows with an empty scope.
//
// A budget is written as Harvest answers it, also one of 0 or of none: a task or a person the project
// budgets nothing for is still one it is budgeted by, and the built-in Harvest source application
// writes a row of it as well.
app.importers.budgets = {
  SOURCE_NAME: "budget",

  importAll() {
    logger.startImport("budgets");
    var rows = [], projectIdsWithoutBudget = [], imported = 0;
    app.importers.projects.each((project) => {
      var projectRows = this.buildRows(project);
      var warningKey = `budget/${project.id}`;
      if (projectRows.length === 0) {
        projectIdsWithoutBudget.push(project.id);
        source.warnings.clearOld(warningKey);
        return;
      }

      var oversizeReason = app.importers.rows.oversizeReasonOf(projectRows);
      if (oversizeReason) {
        source.warnings.addObjectFailure(warningKey,
          `Import of the budget of Harvest project ${project.id} failed: ${oversizeReason}`);
        return;
      }
      rows = app.importers.rows.addTimesheetScope(rows, projectRows);
      imported += projectRows.length;
      source.warnings.clearOld(warningKey);
    });
    app.importers.rows.writeTimesheetBatch(rows);
    projectIdsWithoutBudget.forEach((projectId) =>
      app.importers.rows.deleteTimesheetRowsOf(projectId, this.SOURCE_NAME));
    logger.finishImport("budgets", imported);
  },

  buildRows(project) {
    switch (project.budget_by) {
      case "project":
        return this.hoursRows([{project_task_id: project.noTaskId, budget: project.budget}], project);
      case "project_cost":
        return this.costRows([{project_task_id: project.noTaskId, budget: project.cost_budget}], project);
      case "task":
        return this.hoursRows(this.taskBudgets(project), project);
      case "task_fees":
        return this.costRows(this.taskBudgets(project), project);
      case "person":
        return this.hoursRows(this.personBudgets(project), project);
      default:
        return [];
    }
  },

  taskBudgets(project) {
    return app.importers.taskAssignments.allOfProject(project.id).map((assignment) => ({
      project_task_id: assignment.memberId,
      task_id: app.importers.tasks.taskIdOf(assignment.task_id),
      budget: assignment.budget
    }));
  },

  personBudgets(project) {
    return app.importers.userAssignments.allOfProject(project.id).map((assignment) => ({
      project_task_id: project.noTaskId,
      person_id: app.importers.users.personIdOf(assignment.user_id),
      budget: assignment.budget
    }));
  },

  hoursRows(budgets, project) {
    return budgets.map((budget) => this.row(project, budget, {budgeted_hours: budget.budget}));
  },

  costRows(budgets, project) {
    var currencyId = app.importers.currencies.lookupId(project.currency);
    return budgets.map((budget) =>
      this.row(project, budget, {budgeted_cost: budget.budget, currency_id: currencyId}));
  },

  row(project, budget, measures) {
    var row = {
      _source_id: String(project.id),
      _source_name: this.SOURCE_NAME,
      project_id: project.memberId,
      project_task_id: budget.project_task_id,
      task_id: budget.task_id || null,
      person_id: budget.person_id || null,
      time_id: null
    };
    for (var column in measures) row[column] = measures[column];
    return row;
  }
};
