// Row building helpers shared by the importers.
app.importers.rows = {
  // Copies the dimension foreign keys onto a new fact row. Object spread is not available in this
  // engine, and every fact row of one conversation carries the same foreign key set.
  copy(values) {
    return this.merge({}, values);
  },

  merge(target, values) {
    for (var key in values) target[key] = values[key];
    return target;
  },

  // The whole hours between two ISO 8601 timestamps, rounded to two decimals.
  // Returns null when either timestamp is missing, unparsable or out of order.
  hoursBetween(fromTimestamp, toTimestamp) {
    if (!fromTimestamp || !toTimestamp) return null;
    var fromMs = Date.parse(fromTimestamp), toMs = Date.parse(toTimestamp);
    if (isNaN(fromMs) || isNaN(toMs) || toMs < fromMs) return null;
    return Math.round((toMs - fromMs) / 36000) / 100;
  },

  // The whole minutes between two ISO 8601 timestamps — the unit the interval dimensions bucket,
  // stored as an integer the way the standard application types store their durations.
  // Returns null when either timestamp is missing, unparsable or out of order.
  minutesBetween(fromTimestamp, toTimestamp) {
    if (!fromTimestamp || !toTimestamp) return null;
    var fromMs = Date.parse(fromTimestamp), toMs = Date.parse(toTimestamp);
    if (isNaN(fromMs) || isNaN(toMs) || toMs < fromMs) return null;
    return Math.round((toMs - fromMs) / 60000);
  },

  // "not_good" -> "Not good", "email-forward" -> "Email forward".
  humanize(value) {
    if (!value) return null;
    var words = String(value).replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.substring(1);
  }
};
