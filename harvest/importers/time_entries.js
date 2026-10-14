// The tracked time — one fact row per Harvest time entry, on the day it was spent, or two rows of an entry
// which is tracked partly within the business hours of a working day and partly outside them.
//
// Every entry is its own import scope, so an incremental import replaces exactly the entries Harvest
// reports as changed and leaves the rest of the account untouched.
app.importers.timeEntries = {
  SOURCE_NAME: "time entry",
  // The sums of a row, which the two rows of a split entry share by the share of the time each row has.
  // The members and the notes are the same on both rows.
  SPLIT_COLUMNS: ["hours", "rounded_hours", "billable_hours", "invoiced_hours", "billable_amount",
                  "invoiced_amount", "cost_amount"],
  // The decimal columns of the timesheet rows store two decimal places.
  DECIMAL_PLACES: 2,

  importAll(shared) {
    logger.startImport("time entries");
    var collected = {rows: [], rowlessIds: [], imported: 0, incremental: !!shared.timeEntriesSince};

    app.importers.selection.requestedProjectIds(shared.timeEntriesSince).forEach((projectId) =>
      app.api.getTimeEntries(shared.timeEntriesSince, (batch) => {
        batch.forEach((entry) => {
          source.checkCanceling();
          this.importOne(entry, collected);
          if (collected.rows.length >= app.importers.rows.BATCH_SIZE) this.writeCollected(collected);
        });
        // Once per page rather than once per entry: this is what the user sees moving.
        source.setStatusMessage(`Importing Harvest time entries, ${collected.imported} imported`);
      }, projectId));
    if (shared.movedTimeEntriesSince) this.collectMoved(shared.movedTimeEntriesSince, collected);

    this.writeCollected(collected);
    app.importers.externalItems.updateDuplicateNames();
    // Harvest sometimes answers an entry of zero hours, and an entry can be emptied after it was
    // imported or moved to a project which is not imported. These leave the entry without a row.
    collected.rowlessIds.forEach((entryId) =>
      app.importers.rows.deleteTimesheetRowsOf(entryId, this.SOURCE_NAME));
    logger.finishImport("time entries", collected.imported);
  },

  // A full read of the selected projects does not answer an entry moved from one of them to a project which
  // is not selected since the previous import, so the entries of the whole account changed since then are
  // read for it.
  collectMoved(since, collected) {
    if (app.importers.selection.all) return;

    app.api.getTimeEntries(since, (batch) => batch.forEach((entry) => {
      var projectId = entry.project && entry.project.id;
      if (!app.importers.projects.ofRow(projectId) && app.importers.projects.listed(projectId)) {
        source.warnings.clearOld(`time entry/${entry.id}`);
        collected.rowlessIds.push(entry.id);
      }
    }));
  },

  writeCollected(collected) {
    collected.rows = app.importers.rows.writeTimesheetBatch(collected.rows);
  },

  // Counts the entries and not their rows, which are two of a split entry.
  importOne(entry, collected) {
    var projectId = entry.project && entry.project.id;
    var project = app.importers.projects.ofRow(projectId);
    if (!project) {
      // A changed entry of a project which is not selected may have been moved there from a selected one.
      // A full read writes no row of it and stores nothing to remove. An entry of a project the list did
      // not answer is reported instead, and keeps its rows until the next import reads it again.
      if (app.importers.projects.listed(projectId)) {
        source.warnings.clearOld(`time entry/${entry.id}`);
        if (collected.incremental) collected.rowlessIds.push(entry.id);
      }
      return;
    }

    var warningKey = `time entry/${entry.id}`;
    try {
      var rows = this.buildRows(entry, project);
      if (rows.length > 0) {
        rows.forEach((row) => collected.rows.push(row));
        collected.imported += 1;
        app.importers.users.noteTracked(entry.user && entry.user.id, entry.spent_date);
      } else {
        collected.rowlessIds.push(entry.id);
      }
      source.warnings.clearOld(warningKey);
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `Import of Harvest time entry ${entry.id} failed: ${error.message}`);
    }
  },

  buildRows(entry, project) {
    var row = this.buildRow(entry, project);
    if (!row) return [];

    return this.splitRow(row, app.importers.workingTimes.partsOf(entry));
  },

  // Every part but the last gets its share of each sum by its minutes, rounded half away from zero to the
  // decimal places the columns store, and the last part gets the rest, so that the rows of a split entry add
  // up to the sum which the row of the entry would store. The shares are counted in whole hundredths, because
  // a binary fraction rounds 3.33 * 1 / 6 to 0.5549999999999999 instead of 0.555. The one row of an entry
  // which is not split keeps its sums as they are.
  splitRow(row, parts) {
    var partRows = parts.map((part) => _.extend({}, row, {working_time_id: part.id}));
    if (partRows.length === 1) return partRows;

    var factor = Math.pow(10, this.DECIMAL_PLACES);
    var minutes = parts.reduce((sum, part) => sum + part.minutes, 0);
    this.SPLIT_COLUMNS.forEach((column) => {
      if (row[column] === null) return;
      var total = Math.round(this.storedValueOf(row[column]) * factor), allocated = 0;
      partRows.forEach((partRow, index) => {
        var part = index === partRows.length - 1 ? total - allocated :
          this.roundedQuotientOf(total * parts[index].minutes, minutes);
        allocated += part;
        partRow[column] = part / factor;
      });
    });
    return partRows;
  },

  // The quotient of two whole numbers, the divisor positive, rounded half away from zero.
  roundedQuotientOf(dividend, divisor) {
    var quotient = Math.floor((2 * Math.abs(dividend) + divisor) / (2 * divisor));
    return dividend < 0 ? -quotient : quotient;
  },

  // A number as the decimal column stores it. eazyBI writes the shortest decimal form of the number, which
  // is also what String answers, and the database rounds that form half away from zero, so 1.005 is stored
  // as 1.01 and 0.40499999999999997 as 0.40. The digits of the form are rounded as digits, because any
  // arithmetic on the number rounds in binary: 1.005 * 100 is 100.49999999999999, and 40.499999999999997
  // is 40.5.
  storedValueOf(value) {
    var form = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(Math.abs(value)));
    var digits = form[1] + (form[2] || "");
    var keptCount = form[1].length + Number(form[3] || 0) + this.DECIMAL_PLACES;
    var kept = keptCount > 0 ? (digits + "0".repeat(keptCount)).substring(0, keptCount) : "0";
    if (keptCount >= 0 && Number(digits.charAt(keptCount) || 0) >= 5) kept = this.incrementedDigits(kept);
    var stored = Number(`${kept}e-${this.DECIMAL_PLACES}`);
    return value < 0 ? -stored : stored;
  },

  // The decimal digits of a whole number plus one, "0129" is "0130" and "99" is "100".
  incrementedDigits(digits) {
    var parts = /^(\d*?)([0-8]?)(9*)$/.exec(digits);
    return parts[1] + (parts[2] === "" ? "1" : String(Number(parts[2]) + 1)) + parts[3].replace(/9/g, "0");
  },

  buildRow(entry, project) {
    // The hours without the hours of a running timer: a timer somebody forgot to stop otherwise adds
    // its hours to every report until it is stopped.
    var hours = entry.hours_without_timer;
    if (!hours) return null;

    var projectTask = app.importers.taskAssignments.ofProject(project.id, entry.task && entry.task.id);
    var userId = entry.user && entry.user.id;
    var projectUser = app.importers.userAssignments.ofProject(project.id, userId);
    // Harvest rounds the hours with the rounding rule of the account and answers the result itself.
    var roundedHours = this.roundedHoursOf(entry);
    var hourlyRate = this.hourlyRateOf(entry, project, projectTask, projectUser);
    // Harvest answers whether the entry is billable, which the task assignment only sets when the time is
    // tracked; time which is already on an invoice is billable as well.
    var billable = entry.is_billed ||
      (typeof entry.billable === "boolean" ? entry.billable : !!(projectTask && projectTask.billable));

    return {
      _source_id: String(entry.id),
      _source_name: this.SOURCE_NAME,
      project_id: project.memberId,
      // Time of a task the project does not assign any more is reported under the project itself.
      project_task_id: projectTask ? projectTask.memberId : project.noTaskId,
      task_id: app.importers.tasks.taskIdOf(entry.task && entry.task.id),
      person_id: app.importers.users.personIdOf(userId),
      currency_id: app.importers.currencies.lookupId(project.currency),
      approval_status_id: app.importers.approvalStatuses.lookupId(entry),
      external_item_id: app.importers.externalItems.lookupId(entry),
      // A spent date is a calendar date of the person who tracked it and is never shifted by a time zone.
      time_id: dwh.lookupDateId(entry, "spent_date"),
      hours: hours,
      rounded_hours: roundedHours,
      billable_hours: billable ? roundedHours : null,
      invoiced_hours: entry.is_billed ? roundedHours : null,
      billable_amount: this.amountOf(billable, roundedHours, hourlyRate),
      invoiced_amount: this.amountOf(entry.is_billed, roundedHours, hourlyRate),
      // The cost rate of the person when the time was tracked, which Harvest answers with the entry and
      // keeps in the currency of the account, whatever currency the project is billed in.
      cost_amount: this.amountOf(true, roundedHours, entry.cost_rate),
      notes: app.importers.rows.notesOf(entry)
    };
  },

  // The rounded hours of an entry whose timer runs may round the hours of the timer as well, so they are
  // its hours without the timer until the timer is stopped, which changes the entry again.
  roundedHoursOf(entry) {
    if (entry.is_running) return entry.hours_without_timer;

    var roundedHours = entry.rounded_hours;
    return (roundedHours === null || roundedHours === undefined) ? entry.hours_without_timer : roundedHours;
  },

  // The billable rate which Harvest answers with the entry, the rate when the time was tracked: a rate
  // changed later applies to the earlier time only when it is changed for it in Harvest. An entry without
  // one is billed at the rate of the project, of the task assignment or of the person, which the `bill_by`
  // setting of the project chooses.
  hourlyRateOf(entry, project, projectTask, projectUser) {
    if (typeof entry.billable_rate === "number") return entry.billable_rate;

    switch (project.bill_by) {
      case "Project": return project.hourly_rate;
      case "Tasks": return projectTask && projectTask.hourly_rate;
      case "People": return projectUser && projectUser.hourly_rate;
      default: return null;
    }
  },

  // Hours rounded down to zero or a rate of zero are known and make an amount of zero; only a missing rate
  // leaves the amount empty.
  amountOf(applies, roundedHours, hourlyRate) {
    if (!applies || this.missing(roundedHours) || this.missing(hourlyRate)) return null;
    return roundedHours * hourlyRate;
  },

  missing(value) {
    return value === null || value === undefined;
  }
};
