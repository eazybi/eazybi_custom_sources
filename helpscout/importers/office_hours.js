// The office hours of the team from the Office hours import option: one row for each week day from
// Monday to Sunday, with the start and end time of an open day in the Time dimension time zone.
app.importers.officeHours = {
  // The JavaScript Date week day of each row of the option, Monday to Sunday.
  ROW_WEEK_DAYS: [1, 2, 3, 4, 5, 6, 0],
  DAY_NAMES: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  MINUTES_PER_DAY: 24 * 60,
  MS_PER_MINUTE: 60000,

  // The office hours of the import when the Use office hours option is selected, otherwise null.
  // Read once per import, so that an invalid office day fails the import before anything is imported.
  selected() {
    if (!source.getExtraOption("use_office_hours")) return null;
    return {schedule: this.schedule()};
  },

  // The open minutes of the day by JavaScript Date week day, {startMinute, endMinute} or null for a closed
  // day. Returns null when no day is open, which means no office hours limit, as in Help Scout.
  // Throws when an open day has no start or end time, or ends before it starts.
  schedule() {
    var rows = source.getExtraOption("office_hours") || [];
    var schedule = [null, null, null, null, null, null, null];
    var hasOpenDay = false;
    rows.forEach((row, index) => {
      var weekDay = this.ROW_WEEK_DAYS[index];
      if (!row.open || weekDay === undefined) return;

      var startMinute = this.minuteOfDay(row.start_time), endMinute = this.minuteOfDay(row.end_time);
      if (startMinute === null || endMinute === null) {
        throw new Error(`The office hours of ${this.DAY_NAMES[weekDay]} need a start and an end time`);
      }
      if (startMinute >= endMinute) {
        throw new Error(`The office hours of ${this.DAY_NAMES[weekDay]} must end after they start`);
      }
      schedule[weekDay] = {startMinute: startMinute, endMinute: endMinute};
      hasOpenDay = true;
    });
    return hasOpenDay ? schedule : null;
  },

  // "09:30" -> 570, or null for a value which is not a time of the day from "00:00" to "24:00".
  minuteOfDay(time) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(time || "");
    if (!match) return null;

    var minute = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    return minute <= this.MINUTES_PER_DAY ? minute : null;
  },

  // The whole minutes of office hours between two ISO 8601 timestamps, like rows.minutesBetween.
  minutesBetween(fromTimestamp, toTimestamp, schedule) {
    if (!schedule) return app.importers.rows.minutesBetween(fromTimestamp, toTimestamp);

    var officeMs = this.officeMsBetween(fromTimestamp, toTimestamp, schedule);
    return officeMs === null ? null : Math.round(officeMs / this.MS_PER_MINUTE);
  },

  // The hours of office hours between two ISO 8601 timestamps, rounded to two decimals like
  // rows.hoursBetween.
  hoursBetween(fromTimestamp, toTimestamp, schedule) {
    if (!schedule) return app.importers.rows.hoursBetween(fromTimestamp, toTimestamp);

    var officeMs = this.officeMsBetween(fromTimestamp, toTimestamp, schedule);
    return officeMs === null ? null : Math.round(officeMs / 36000) / 100;
  },

  // The milliseconds of office hours between two ISO 8601 timestamps, counted on the local times of the
  // Time dimension time zone. A daylight saving time change is not subtracted from the minutes of its day.
  // Returns null when either timestamp is missing, unparsable or out of order.
  officeMsBetween(fromTimestamp, toTimestamp, schedule) {
    var fromMs = this.localMs(fromTimestamp), toMs = this.localMs(toTimestamp);
    if (fromMs === null || toMs === null || toMs < fromMs) return null;

    var msPerDay = this.MINUTES_PER_DAY * this.MS_PER_MINUTE;
    var officeMs = 0;
    for (var dayMs = fromMs - fromMs % msPerDay; dayMs < toMs; dayMs += msPerDay) {
      var openRange = schedule[new Date(dayMs).getUTCDay()];
      if (!openRange) continue;

      var openFromMs = Math.max(fromMs, dayMs + openRange.startMinute * this.MS_PER_MINUTE);
      var openToMs = Math.min(toMs, dayMs + openRange.endMinute * this.MS_PER_MINUTE);
      if (openToMs > openFromMs) officeMs += openToMs - openFromMs;
    }
    return officeMs;
  },

  // The local time of a timestamp in the Time dimension time zone as milliseconds of a UTC date, so that the
  // day and the minute of the day are read with the UTC functions of Date.
  localMs(timestamp) {
    if (!timestamp) return null;

    var localTime = dwh.datetimeValue(timestamp);
    if (!localTime) return null;

    var localMs = Date.parse(`${String(localTime).replace(" ", "T")}Z`);
    return isNaN(localMs) ? null : localMs;
  }
};
