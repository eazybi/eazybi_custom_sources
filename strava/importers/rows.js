// Parsing helpers shared by the importers. The export writes every value as text: an empty cell is
// read as null when it is not quoted and as "" when it is, so both mean "no value".
app.importers.rows = {
  MONTHS: {Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12},

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

  // The seconds of a "4736", "4736.0", "28:21" or "1:13:28" duration, or null for an empty or unparsable
  // one — also for minutes or seconds after the first part which are 60 or more, such as "28:99".
  durationSeconds(value) {
    var text = this.text(value);
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
    if (!/^\d+(:\d{1,2}){1,2}$/.test(text)) return null;
    var parts = text.split(":").map((part) => parseInt(part, 10));
    if (parts.slice(1).some((part) => part >= 60)) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
  },

  // The ISO 8601 UTC timestamp of an "Oct 2, 2026, 4:32:47 PM" start time, which is how activities.csv
  // writes the UTC time an activity started, or null when it is not one — also for a date or a time which
  // does not exist, such as "Feb 31, 2026, 13:99:00 PM". An ISO 8601 timestamp is read as well.
  utcTimestamp(value) {
    var text = this.text(value);
    if (!text) return null;
    var match = text.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/);
    if (match) {
      var month = this.MONTHS[match[1]], hour12 = parseInt(match[4], 10);
      if (!month || hour12 < 1 || hour12 > 12) return null;
      var hour = hour12 % 12 + (match[7] === "PM" ? 12 : 0);
      return this.isoTimestamp(parseInt(match[3], 10), month, parseInt(match[2], 10), hour,
        parseInt(match[5], 10), parseInt(match[6], 10));
    }
    var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/);
    if (!iso) return null;
    var parts = iso.slice(1, 7).map((part) => parseInt(part, 10));
    return this.isoTimestamp(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
  },

  // "2026-10-02T16:32:47Z", or null for a date or a time which does not exist: Date.UTC carries an out of
  // range part over into the next one, so such a date comes back with other parts.
  isoTimestamp(year, month, day, hour, minute, second) {
    var date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
        date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
      return null;
    }
    return date.toISOString().replace(/\.000Z$/, "Z");
  },

  // A number rounded to the given decimals.
  round(value, decimals) {
    if (value === null || value === undefined) return null;
    var factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
};
