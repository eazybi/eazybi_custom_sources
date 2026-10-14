// Removing what was deleted in Harvest. Harvest reports no deletions: a deleted time entry, expense,
// invoice, client, project, task or person simply stops being listed. Every fact row and every dimension
// member the import writes therefore carries a generation, 1 or 2, in a hidden `generation` column.
//
// A check for deleted records is an import which reads every Harvest list in full. It writes everything
// it reads with the other generation than the one of the previous check, and then deletes the rows and
// the members which still carry the previous generation, or none: those are the ones Harvest no longer
// lists. The imports between two checks read only what changed and write the generation of the last
// check. How often a check runs is set by the Check for deleted records import option, and a project taken
// out of the selection or a selected project moved to another client makes the next import a check
// (importers/selection.js).
//
// A check which is interrupted leaves rows and members of the generation the next check writes. The
// next check does not delete them first, which would empty the reports while it runs: what Harvest still
// lists is written again anyway, and the rows of a record deleted after the interrupted check wrote them
// survive the next check and are removed by the check after it.
//
// A check which removes nothing because a record failed to import leaves them as well. eazyBI stores the
// max params of such an import, so it is remembered, and the two imports after it check whatever the
// import option and the selection say: the first removes what the failed check would have, the second what
// the failed check wrote and the first did not read.
app.importers.sweep = {
  OPTION_KEY: "deleted_records_check",
  // The max param of the number of imports which still check because a check removed nothing.
  PENDING_PARAM: "sweep_pending",
  CHECKS_AFTER_FAILURE: 2,
  // The whole UTC days between two checks, by the value of the import option; `null` checks only with a
  // full reimport. A reimport and the first import always check.
  INTERVAL_DAYS: {daily: 1, weekly: 7, reimport: null},
  DAY_MS: 24 * 60 * 60 * 1000,

  // Whether this import checks for deleted records, and the generation of what it writes.
  sweeping: false,
  generation: null,

  // Decides before anything is written.
  begin(importStartedAt) {
    var storedGeneration = source.getMaxParam("generation");
    this.sweeping = this.sweepDue(importStartedAt);
    if (!this.sweeping) {
      this.generation = storedGeneration;
      return;
    }

    var previousGeneration = (storedGeneration === 1 || storedGeneration === 2) ? storedGeneration :
      this.generationOfStoredRows();
    this.generation = this.otherGeneration(previousGeneration);
    logger.info(`Checking for records deleted in Harvest, writing generation ${this.generation}`);
  },

  // Deletes what the check did not write and marks the check done. Nothing is deleted when a record
  // failed to import: its stored rows would be taken for the rows of a deleted one.
  finish(importStartedAt) {
    if (!this.sweeping) return;

    var failureCount = source.warnings.objectFailures().length;
    if (failureCount > 0) {
      logger.warn("Records deleted in Harvest are not removed by this import, because not every Harvest " +
        `record was imported (${failureCount} failed). The next import checks again.`);
      source.setMaxParam(this.PENDING_PARAM, this.CHECKS_AFTER_FAILURE);
      return;
    }

    var removed = this.deleteGenerations([this.otherGeneration(this.generation), null]);
    logger.info(`Removed ${removed.rows} fact rows and ${removed.members} dimension members which ` +
      "Harvest no longer lists");
    source.setMaxParam("generation", this.generation);
    source.setMaxParam("sweep_at", importStartedAt);
    var pendingChecks = this.pendingChecks();
    if (pendingChecks > 0) source.setMaxParam(this.PENDING_PARAM, pendingChecks - 1);
  },

  pendingChecks() {
    return Number(source.getMaxParam(this.PENDING_PARAM)) || 0;
  },

  sweepDue(importStartedAt) {
    if (source.isReimport()) return true;

    var sweptAt = source.getMaxParam("sweep_at");
    if (!sweptAt) return true;
    // Before the selection: what made the failed check a check may not hold any more.
    if (this.pendingChecks() > 0) {
      logger.info("A check for deleted records removed nothing because a record failed to import, so " +
        "this import checks for deleted records");
      return true;
    }
    // Before the interval: with checks only with a full reimport, the rows of a project taken out of the
    // selection and the invoices of a client no selected project belongs to any more would otherwise stay
    // until the next reimport.
    if (app.importers.selection.deselected()) {
      logger.info("Projects were taken out of the selection, so this import checks for deleted records");
      return true;
    }
    if (app.importers.selection.clientsChanged()) {
      logger.info("The selected projects belong to other clients than before, so this import checks for " +
        "deleted records");
      return true;
    }
    // Also with checks only with a full reimport: the capacity of the people runs to the end of the year,
    // and only a check writes it (importers/capacity.js).
    if (app.importers.capacity.yearDue(importStartedAt)) {
      logger.info("A new year began, so this import checks for deleted records and writes the capacity of " +
        "the people for it");
      return true;
    }

    var intervalDays = this.intervalDays();
    if (intervalDays === null) return false;
    // Whole UTC days and not hours, so that an import scheduled every day which starts a little earlier
    // than the day before still checks.
    return this.dayOf(importStartedAt) - this.dayOf(sweptAt) >= intervalDays;
  },

  intervalDays() {
    var intervalDays = this.INTERVAL_DAYS[source.getExtraOption(this.OPTION_KEY)];
    return intervalDays === undefined ? this.INTERVAL_DAYS.daily : intervalDays;
  },

  dayOf(timestamp) {
    return Math.floor(Date.parse(timestamp) / this.DAY_MS);
  },

  otherGeneration(generation) {
    return generation === 1 ? 2 : 1;
  },

  // A full reimport clears the stored generation together with the incremental mark, while the stored
  // rows still carry it. The two approval status members are written by every import, so they tell it.
  generationOfStoredRows() {
    var approvalStatuses = dwh.dimensions.approval_statuses;
    if (approvalStatuses.selectCount({generation: 1}) > 0) return 1;
    if (approvalStatuses.selectCount({generation: 2}) > 0) return 2;
    return null;
  },

  // Deletes the fact rows first and the dimension members after them, so that no member is deleted
  // while rows of it are still stored. The tables of the expenses and of the invoices are included also
  // when Harvest has the feature turned off and nothing was imported into them.
  deleteGenerations(generations) {
    var removed = {rows: 0, members: 0};
    this.factScopes().forEach((scope) => generations.forEach((generation) => {
      removed.rows += scope.table.deleteRows({_source_name: scope.sourceName, generation: generation});
    }));
    this.dimensionTables().forEach((table) => generations.forEach((generation) => {
      removed.members += table.deleteRows({generation: generation});
    }));
    return removed;
  },

  // The rows of a measures table are deleted per source name, which the host prefixes with the
  // application type.
  factScopes() {
    return [
      {table: dwh.measures.timesheets, sourceName: app.importers.timeEntries.SOURCE_NAME},
      {table: dwh.measures.timesheets, sourceName: app.importers.expenses.SOURCE_NAME},
      {table: dwh.measures.timesheets, sourceName: app.importers.budgets.SOURCE_NAME},
      {table: dwh.measures.timesheets, sourceName: app.importers.capacity.SOURCE_NAME},
      {table: dwh.measures.invoices, sourceName: app.importers.invoices.SOURCE_NAME}
    ];
  },

  // Every dimension table the import writes members of. The role rows of a person and the manager rows of
  // a project which Harvest no longer lists keep the previous generation, so a check removes them together
  // with the person or the project.
  dimensionTables() {
    var dimensions = dwh.dimensions;
    return [dimensions.clients, dimensions.projects, dimensions.project_managers, dimensions.project_tasks,
            dimensions.tasks, dimensions.people, dimensions.person_roles, dimensions.approval_statuses,
            dimensions.working_times, dimensions.external_services, dimensions.external_items,
            dimensions.currencies, dimensions.expense_categories, dimensions.invoices, dimensions.invoice_items,
            dimensions.invoice_item_categories];
  }
};
