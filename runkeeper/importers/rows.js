// Parsing helpers shared by the importers. The export writes every value as text: an empty cell is
// read as null when it is not quoted and as "" when it is, so both mean "no value".
app.importers.rows = {
  // A number from a CSV cell, or null for an empty or unparsable one.
  number(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    if (text === "") return null;
    var number = Number(text);
    return isNaN(number) ? null : number;
  },

  // A trimmed text from a CSV cell, or null for an empty one.
  text(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    return text === "" ? null : text;
  },

  // The seconds of a "28:21" or "1:13:28" duration, or null for an empty or unparsable one — also for
  // minutes or seconds after the first part which are 60 or more, such as "28:99".
  durationSeconds(value) {
    var text = this.text(value);
    if (!text || !/^\d+(:\d{1,2}){1,2}$/.test(text)) return null;
    var parts = text.split(":").map((part) => parseInt(part, 10));
    if (parts.slice(1).some((part) => part >= 60)) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
  },

  // The parts of a "2026-09-24 07:03:32" local date and time, or null when it is not one — also for a
  // date or a time which does not exist, such as "2026-02-31 25:99".
  localDateTime(value) {
    var text = this.text(value);
    var match = text && text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    var parts = match.slice(1, 7).map((part) => parseInt(part || "0", 10));
    // The wall clock read as if it were UTC, to subtract the UTC time of the same moment from it.
    var wallClockMs = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    // Date.UTC carries an out of range part over into the next one, so a date or a time which does not
    // exist comes back with other parts.
    var wallClock = new Date(wallClockMs);
    if (wallClock.getUTCFullYear() !== parts[0] || wallClock.getUTCMonth() !== parts[1] - 1 ||
        wallClock.getUTCDate() !== parts[2] || wallClock.getUTCHours() !== parts[3] ||
        wallClock.getUTCMinutes() !== parts[4] || wallClock.getUTCSeconds() !== parts[5]) {
      return null;
    }
    return {
      date: `${match[1]}-${match[2]}-${match[3]}`,
      time: `${match[4]}:${match[5]}`,
      year: parts[0],
      hour: parts[3],
      wallClockMs: wallClockMs
    };
  },

  // A number rounded to the given decimals.
  round(value, decimals) {
    if (value === null || value === undefined) return null;
    var factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },

  // "+02:00" or "-05:00" for an offset in minutes.
  utcOffsetName(minutes) {
    if (minutes === null || minutes === undefined) return null;
    var sign = minutes < 0 ? "-" : "+";
    var absolute = Math.abs(minutes);
    var hours = Math.floor(absolute / 60), rest = absolute % 60;
    return `${sign}${hours < 10 ? "0" : ""}${hours}:${rest < 10 ? "0" : ""}${rest}`;
  }
};
