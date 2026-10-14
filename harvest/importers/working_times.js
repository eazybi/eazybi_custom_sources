// Whether time was tracked within the business hours of a working day — the two members of the Working
// Time dimension, which the import writes itself, and the classification of a time entry by them.
//
// The working days are the days the Time dimension counts as workdays: all but its non-working weekdays and
// its additional non-working dates, which source.getTimeDimensionNonWorkingDays answers. The business hours
// are the two import options. The Business hours member stores a digest of what the stored time entries were
// classified by. An import which classifies by other business hours or other non-working days reads every
// time entry again and classifies it anew, because eazyBI clears no marks when the business hours change.
// The digest is stored in the DWH and not in a max param, because eazyBI keeps the rows an import wrote
// before it failed with an error, but not the max params that import set.
//
// An entry with a start and an end time is classified by the minutes it spent in the business hours of a
// working day. Harvest answers both times as the wall clock of the person who tracked it and without a
// time zone, so they are never converted into the time zone of the Time dimension. An entry which ends
// before it starts ends on the next day, and its minutes after midnight are in the business hours of that
// day. An entry without both times — of an account which tracks durations, or a running timer — is
// classified by its day alone.
app.importers.workingTimes = {
  BUSINESS: {id: 1, name: "Business hours"},
  NON_BUSINESS: {id: 2, name: "Non-business hours"},
  START_OPTION_KEY: "business_hours_start",
  END_OPTION_KEY: "business_hours_end",
  DAY_MINUTES: 24 * 60,
  WARNING_KEY: "business_hours",

  // The business hours as minutes of the day, {start, end}, or null when the options do not make a range.
  businessHours: null,
  nonWorkingWeekdays: {},
  nonWorkingDates: {},
  // Whether the stored time entries may be classified otherwise, so that this import reads them all.
  reclassifying: false,

  importAll() {
    logger.startImport("working times");
    var generation = app.importers.sweep.generation;
    [this.BUSINESS, this.NON_BUSINESS].forEach((member) =>
      dwh.dimensions.working_times.createAndLookupId({id: member.id},
        {name: member.name, generation: generation}));
    this.readBusinessHours();
    this.readNonWorkingDays();
    logger.finishImport("working times", 2);
  },

  // The options are selects, so only a range which ends before it starts is wrong. Its entries are then
  // classified by their day alone, which keeps the hours of every working day under Business hours instead
  // of moving all of them to Non-business hours.
  readBusinessHours() {
    var start = this.minutesOf(source.getExtraOption(this.START_OPTION_KEY));
    var end = this.minutesOf(source.getExtraOption(this.END_OPTION_KEY));
    if (start !== null && end !== null && start < end) {
      this.businessHours = {start: start, end: end};
      source.warnings.clearOld(this.WARNING_KEY);
      return;
    }

    this.businessHours = null;
    source.warnings.add(this.WARNING_KEY, "The business hours end is not later than their start, so the " +
      "time entries of a working day are all Business hours. Choose a later end in the import options.");
  },

  readNonWorkingDays() {
    var nonWorkingDays = source.getTimeDimensionNonWorkingDays();
    this.nonWorkingWeekdays = _.object(nonWorkingDays.weekdays.map((weekday) => [weekday, true]));
    this.nonWorkingDates = _.object(nonWorkingDays.dates.map((date) => [date, true]));
  },

  // The business hours in minutes of the day, or "none", the non-working weekdays and the non-working dates
  // which the time entries of this import are classified by, for example "540-1020;6,7;2026-12-25".
  classification() {
    var businessHours = this.businessHours ? `${this.businessHours.start}-${this.businessHours.end}` : "none";
    return [businessHours, this.nonWorkingDaysKey()].join(";");
  },

  // The non-working weekdays and the non-working dates, for example "6,7;2026-12-25".
  nonWorkingDaysKey() {
    return [_.keys(this.nonWorkingWeekdays).sort().join(","), _.keys(this.nonWorkingDates).sort().join(",")].
      join(";");
  },

  // The `updated_since` of the time entries, or null when the stored ones may be classified otherwise. The
  // stored digest is removed before any time entry is written. So an import which stops with a failed time
  // entry or with an error makes the next import read every time entry again, also after the options are
  // changed back to the ones of the digest.
  timeEntriesSince(since) {
    var digest = this.digestOf(this.classification());
    this.reclassifying = dwh.dimensions.working_times.selectCount({id: this.BUSINESS.id, classification: digest}) === 0;
    if (!this.reclassifying) return since;

    this.storeDigest(null);
    if (since) {
      logger.info(`Every time entry is read and classified by ${this.classification()} again, because the ` +
        "stored ones may be classified by other business hours or non-working days");
    }
    return null;
  },

  // Called when every time entry of the import was imported.
  storeClassification() {
    if (this.reclassifying) this.storeDigest(this.digestOf(this.classification()));
  },

  storeDigest(digest) {
    dwh.dimensions.working_times.update({classification: digest}, {id: this.BUSINESS.id});
  },

  // The 53 bit cyrb53 hash as hexadecimal digits, a fixed length digest of any number of non-working dates.
  digestOf(value) {
    var high = 0xdeadbeef, low = 0x41c6ce57;
    for (var index = 0; index < value.length; index++) {
      var code = value.charCodeAt(index);
      high = Math.imul(high ^ code, 2654435761);
      low = Math.imul(low ^ code, 1597334677);
    }
    high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
    low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
    return (4294967296 * (2097151 & low) + (high >>> 0)).toString(16);
  },

  // The parts of a time entry, in the order its rows are written: one part of its whole time, or a
  // Business hours and a Non-business hours part with the minutes of the entry each of them has.
  partsOf(entry) {
    var interval = this.intervalOf(entry);
    if (!interval || !this.businessHours) {
      var member = this.isWorkingDay(entry.spent_date, 0) ? this.BUSINESS : this.NON_BUSINESS;
      return [{id: member.id}];
    }

    var minutes = interval.end - interval.start;
    var businessMinutes = this.businessMinutesOf(entry.spent_date, interval);
    if (businessMinutes === 0) return [{id: this.NON_BUSINESS.id}];
    if (businessMinutes === minutes) return [{id: this.BUSINESS.id}];
    return [{id: this.BUSINESS.id, minutes: businessMinutes},
            {id: this.NON_BUSINESS.id, minutes: minutes - businessMinutes}];
  },

  // The minutes of the day of the entry it started and ended at, or null without both times. A running
  // timer has no end yet, and an entry of the same start and end time has no minutes to share.
  intervalOf(entry) {
    if (entry.is_running) return null;
    var start = this.minutesOf(entry.started_time), end = this.minutesOf(entry.ended_time);
    if (start === null || end === null || start === end) return null;
    return {start: start, end: end > start ? end : end + this.DAY_MINUTES};
  },

  // An interval ends on the next day at the latest, so the business hours of two days are enough.
  businessMinutesOf(spentDate, interval) {
    var minutes = 0;
    [0, 1].forEach((dayOffset) => {
      if (!this.isWorkingDay(spentDate, dayOffset)) return;
      var dayStart = dayOffset * this.DAY_MINUTES;
      var overlapStart = Math.max(interval.start, dayStart + this.businessHours.start);
      var overlapEnd = Math.min(interval.end, dayStart + this.businessHours.end);
      if (overlapEnd > overlapStart) minutes += overlapEnd - overlapStart;
    });
    return minutes;
  },

  // The Time dimension numbers the weekdays the ISO way, from 1 for Monday to 7 for Sunday.
  isWorkingDay(spentDate, dayOffset) {
    var day = new Date(`${spentDate}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    var weekday = day.getUTCDay() || 7;
    return !this.nonWorkingWeekdays[weekday] && !this.nonWorkingDates[day.toISOString().substring(0, 10)];
  },

  // A time of the 12 hour clock ("9:00am", "12:30pm") or of the 24 hour clock ("13:00"), as Harvest answers
  // it by the clock setting of the account, and "24:00" of the business hours end, in minutes after
  // midnight. Null for no time or one which is not a time of day.
  minutesOf(time) {
    var match = /^(\d{1,2}):(\d\d)\s*([ap]m)?$/i.exec(String(time || "").trim());
    if (!match) return null;

    var hour = Number(match[1]), minute = Number(match[2]);
    if (minute > 59) return null;
    if (match[3]) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
    } else if (hour > 24 || (hour === 24 && minute > 0)) {
      return null;
    }
    return hour * 60 + minute;
  }
};
