// The capacity of the people — one timesheet row per person and working day with the hours the person is
// available that day, which the Utilisation measures divide the tracked hours by.
//
// Harvest answers only the weekly capacity a person has now, so every day of a person gets the same share
// of it: the weekly capacity spread over the working weekdays of the Time dimension. The non-working dates
// of the Time dimension get no row, like the non-working weekdays. The rows run from the day the person
// was created in Harvest, or from the first day the person tracked time when that is earlier, to the end
// of the current year, so that the current and the coming months show the whole capacity of the people. A
// person who is no longer active has capacity until the last day the person tracked time on, and none
// without tracked time. A row belongs to no project, task or approval status: capacity is the time of the
// person, not of what the person worked on.
//
// The days a person tracked time on are known only when every time entry is read, which is what a check
// for deleted records does, so the capacity is written by the checks and left as it is by the imports
// between them. A check which failed to import a record writes no capacity, because the days of the
// record it failed are missing, and the next import checks again (importers/sweep.js).
//
// The rows of a person are one import scope per year, so that no scope is ever too large to write in one
// call. A check writes them only when what they are built from changed, which a digest in the person
// member tells, and otherwise gives the stored rows its generation.
app.importers.capacity = {
  SOURCE_NAME: "capacity",
  SECONDS_PER_HOUR: 3600,
  DAY_MS: 24 * 60 * 60 * 1000,
  // The max param of the year the stored capacity runs to the end of, which makes the first import of a
  // new year a check.
  YEAR_PARAM: "capacity_year",

  timeIds: {},

  // Whether the capacity of a year other than the one of the stored rows is due, which needs a check.
  yearDue(importStartedAt) {
    var storedYear = source.getMaxParam(this.YEAR_PARAM);
    if (storedYear === null || storedYear === undefined) return false;
    return String(storedYear) !== this.yearOf(importStartedAt);
  },

  importAll(importStartedAt) {
    if (!app.importers.sweep.sweeping) return;
    if (source.warnings.objectFailures().length > 0) {
      logger.warn("The capacity of the people is not written by this import, because not every Harvest " +
        "record was imported. The next import writes it.");
      return;
    }

    source.setStatusMessage("Importing Harvest capacity");
    logger.startImport("capacity");
    this.timeIds = {};
    var lastDay = this.lastDayOf(importStartedAt);
    var workingWeekdays = this.workingWeekdayCount();
    var rows = [], digests = [], written = 0;

    app.importers.users.each((person) => {
      app.importers.users.storeTrackedDays(person);
      var range = this.dateRangeOf(person, lastDay);
      var dates = this.workingDatesOf(range, person, workingWeekdays);
      var digest = app.importers.workingTimes.digestOf(
        [person.weeklyCapacity, range ? `${range.from}..${range.to}` : "none", workingWeekdays,
         app.importers.workingTimes.nonWorkingDaysKey()].join(";"));
      if (this.storedRowsMatch(person, digest, dates.length)) {
        this.yearsOf(dates).forEach((year) => dwh.measures.timesheets.update(
          {_source_id: this.sourceIdOf(person, year), _source_name: this.SOURCE_NAME,
           generation: app.importers.sweep.generation}));
        return;
      }

      // Before any row is written: an interrupted import could otherwise leave rows of other hours under the
      // digest of the stored ones, which a later check with the stored inputs would take for its own. The
      // stored rows go as well, because the rows of a year the person has no capacity in any more may be of
      // the generation of this check, written by an interrupted one, which would keep them.
      dwh.dimensions.people.update({capacity_digest: null}, {id: person.memberId});
      dwh.measures.timesheets.deleteRows({_source_name: this.SOURCE_NAME, person_id: person.memberId});
      var rowsByYear = _.groupBy(this.buildRows(person, dates, workingWeekdays), "_source_id");
      _.values(rowsByYear).forEach((yearRows) => {
        rows = app.importers.rows.addTimesheetScope(rows, yearRows);
      });
      if (dates.length > 0) written += 1;
      digests.push({memberId: person.memberId, digest: digest});
    });
    app.importers.rows.writeTimesheetBatch(rows);
    // Only once the rows are written: a digest of rows which an interrupted import did not write would
    // keep the next check from writing them.
    digests.forEach((stored) =>
      dwh.dimensions.people.update({capacity_digest: stored.digest}, {id: stored.memberId}));
    source.setMaxParam(this.YEAR_PARAM, this.yearOf(importStartedAt));
    logger.finishImport("capacity", written);
  },

  // Whether the stored rows of the person are the ones this check would write: of the same digest, and
  // all of them still there — a reimport into emptied cubes keeps no row but may keep the digest.
  storedRowsMatch(person, digest, rowCount) {
    if (source.isReimport()) return false;
    return dwh.dimensions.people.selectCount({id: person.memberId, capacity_digest: digest}) === 1 &&
      dwh.measures.timesheets.selectCount({_source_name: this.SOURCE_NAME, person_id: person.memberId}) ===
        rowCount;
  },

  workingDatesOf(range, person, workingWeekdays) {
    if (!range || !(person.weeklyCapacity > 0) || workingWeekdays === 0) return [];

    var dates = [];
    for (var time = Date.parse(`${range.from}T00:00:00Z`), end = Date.parse(`${range.to}T00:00:00Z`);
         time <= end; time += this.DAY_MS) {
      var date = new Date(time).toISOString().substring(0, 10);
      if (app.importers.workingTimes.isWorkingDay(date, 0)) dates.push(date);
    }
    return dates;
  },

  buildRows(person, dates, workingWeekdays) {
    var dailyHours = person.weeklyCapacity / this.SECONDS_PER_HOUR / workingWeekdays;
    return dates.map((date) => ({
      _source_id: this.sourceIdOf(person, date.substring(0, 4)),
      _source_name: this.SOURCE_NAME,
      person_id: person.memberId,
      time_id: this.timeIdOf(date),
      capacity_hours: dailyHours
    }));
  },

  sourceIdOf(person, year) {
    return `${person.id}/${year}`;
  },

  yearsOf(dates) {
    return _.uniq(dates.map((date) => date.substring(0, 4)));
  },

  // The first day with tracked time can be earlier than the day the person was created: the time of an
  // account which imported its timesheets into Harvest predates its people.
  dateRangeOf(person, lastDay) {
    var from = [person.createdDate, app.importers.users.firstTrackedDateOf(person.id)].
      filter((date) => date).sort()[0];
    var to = person.isActive ? lastDay : app.importers.users.lastTrackedDateOf(person.id);
    if (!from || !to || from > to) return null;
    return {from: from, to: to};
  },

  yearOf(importStartedAt) {
    return importStartedAt.substring(0, 4);
  },

  lastDayOf(importStartedAt) {
    return `${this.yearOf(importStartedAt)}-12-31`;
  },

  workingWeekdayCount() {
    var count = 0;
    for (var weekday = 1; weekday <= 7; weekday++) {
      if (!app.importers.workingTimes.nonWorkingWeekdays[weekday]) count += 1;
    }
    return count;
  },

  timeIdOf(date) {
    if (!(date in this.timeIds)) this.timeIds[date] = dwh.lookupDateId(date);
    return this.timeIds[date];
  }
};
