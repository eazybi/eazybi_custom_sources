// The tracked expenses — one fact row per Harvest expense, on the day it was spent. An expense belongs
// to a project and to an expense category, and to no task of the project.
app.importers.expenses = {
  SOURCE_NAME: "expense",

  importAll(shared) {
    logger.startImport("expenses");
    var collected = {rows: [], movedIds: [], imported: 0, incremental: !!shared.expensesSince};

    app.importers.selection.requestedProjectIds(shared.expensesSince).forEach((projectId) =>
      app.api.getExpenses(shared.expensesSince, (batch) => {
        batch.forEach((expense) => {
          source.checkCanceling();
          this.importOne(expense, collected);
          if (collected.rows.length >= app.importers.rows.BATCH_SIZE) this.writeCollected(collected);
        });
        source.setStatusMessage(
          `Importing Harvest expenses, ${collected.imported + collected.rows.length} imported`);
      }, projectId));

    this.writeCollected(collected);
    collected.movedIds.forEach((expenseId) =>
      app.importers.rows.deleteTimesheetRowsOf(expenseId, this.SOURCE_NAME));
    logger.finishImport("expenses", collected.imported);
  },

  writeCollected(collected) {
    collected.imported += collected.rows.length;
    collected.rows = app.importers.rows.writeTimesheetBatch(collected.rows);
  },

  importOne(expense, collected) {
    var projectId = expense.project && expense.project.id;
    var project = app.importers.projects.ofRow(projectId);
    if (!project) {
      // A changed expense of a project which is not selected may have been moved there from a selected one.
      if (app.importers.projects.listed(projectId)) {
        source.warnings.clearOld(`expense/${expense.id}`);
        if (collected.incremental) collected.movedIds.push(expense.id);
      }
      return;
    }

    var warningKey = `expense/${expense.id}`;
    try {
      collected.rows.push(this.buildRow(expense, project));
      source.warnings.clearOld(warningKey);
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `Import of Harvest expense ${expense.id} failed: ${error.message}`);
    }
  },

  buildRow(expense, project) {
    var userId = expense.user && expense.user.id;
    // An expense invoiced outside Harvest is marked as invoiced without an invoice.
    var invoiced = !!(expense.is_billed || (expense.invoice && expense.invoice.id));

    return {
      _source_id: String(expense.id),
      _source_name: this.SOURCE_NAME,
      project_id: project.memberId,
      project_task_id: project.noTaskId,
      task_id: null,
      person_id: app.importers.users.personIdOf(userId),
      expense_category_id: app.importers.expenseCategories.categoryIdOf(
        expense.expense_category && expense.expense_category.id),
      currency_id: app.importers.currencies.lookupId(project.currency),
      approval_status_id: app.importers.approvalStatuses.lookupId(expense),
      time_id: dwh.lookupDateId(expense, "spent_date"),
      expenses_amount: expense.total_cost,
      // An expense which is not billable is not uninvoiced work, unless it was invoiced all the same.
      billable_expenses: (expense.billable || invoiced) ? expense.total_cost : null,
      // v2 answers the invoice of an expense as an object. The built-in Harvest application still reads
      // the `invoice_id` of v1, which v2 never answers, so its Invoiced expenses measure stays empty.
      invoiced_expenses: invoiced ? expense.total_cost : null,
      notes: app.importers.rows.notesOf(expense)
    };
  }
};
