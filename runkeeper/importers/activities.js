// The activities of cardioActivities.csv, one row per activity:
//
//   Activity Id,Date,Type,Route Name,Distance (km),Duration,Average Pace,Average Speed (km/h),
//   Calories Burned,Climb (m),Average Heart Rate (bpm),Friend's Tagged,Notes,GPX File
//
// Date is the wall clock time where the activity started, without a time zone — the offset differs
// from one activity to another when the runner travels. Duration is the moving time, without the
// pauses. The distance and climb units are those of the account settings and are named in the column
// headers: km or mi, m or ft.
app.importers.activities = {
  // The key of every warning of an activity or of a row of cardioActivities.csv. Every import reads the
  // whole export, and an activity deleted in Runkeeper is in no later export, so a warning keyed by its
  // activity would never be cleared: the importer clears the warnings of this key which an import did not
  // add again once at its end.
  WARNING_KEY: "activities",
  KM_PER_MILE: 1.609344,
  M_PER_FOOT: 0.3048,
  // The average speeds in km/h an activity of the type can have. An activity outside the range is a
  // mistake of the recording — the tracking left running for hours after a run, or a run recorded on
  // a bus — and would distort every average of its month. The types without a meaningful speed
  // (Elliptical, Other, …) are not checked.
  PLAUSIBLE_SPEEDS: {
    "Running": {min: 1, max: 30},
    "Walking": {min: 1, max: 15},
    "Hiking": {min: 0.5, max: 15},
    "Cycling": {min: 1, max: 80},
    "Mountain Biking": {min: 1, max: 60}
  },

  // The activity records of all the rows, and a warning for each row which is not an activity.
  readAll(exportFile) {
    var activities = [];
    var rowNumber = 0;
    logger.startImport("activities");
    app.api.readActivities(exportFile, (rows) => {
      rows.forEach((row) => {
        rowNumber++;
        var activity = this.build(row);
        if (activity) activities.push(activity);
        else {
          source.warnings.add(this.WARNING_KEY,
            `The row ${rowNumber} of ${app.api.ACTIVITIES_ENTRY} was skipped: it has no Activity Id or ` +
            "no valid Date.");
        }
      });
    });
    logger.finishImport("activities", activities.length);
    return activities;
  },

  // The activity record of one CSV row, or null when the row has no id or start time.
  build(row) {
    var rows = app.importers.rows;
    var id = rows.text(row["Activity Id"]);
    var start = rows.localDateTime(row["Date"]);
    if (!id || !start) return null;

    var distance = this.column(row, "Distance");
    var climb = this.column(row, "Climb");
    var distanceKm = distance.unit === "mi" ? this.times(distance.value, this.KM_PER_MILE) : distance.value;
    var climbM = climb.unit === "ft" ? this.times(climb.value, this.M_PER_FOOT) : climb.value;

    return {
      id: id,
      start: start,
      type: rows.text(row["Type"]) || "Other",
      routeName: rows.text(row["Route Name"]),
      distanceKm: rows.round(distanceKm, 3),
      durationSeconds: rows.durationSeconds(row["Duration"]),
      calories: rows.number(row["Calories Burned"]),
      climbM: rows.round(climbM, 1),
      averageHeartRate: this.averageHeartRate(row),
      friends: this.friends(row["Friend's Tagged"]),
      notes: rows.text(row["Notes"]),
      gpxFile: rows.text(row["GPX File"])
    };
  },

  // The value and the unit of a "Distance (km)" style column, whatever unit its header names.
  column(row, name) {
    var prefix = `${name} (`;
    for (var key in row) {
      if (key.indexOf(prefix) === 0) {
        return {value: app.importers.rows.number(row[key]), unit: key.substring(prefix.length).replace(/\).*$/, "")};
      }
    }
    return {value: null, unit: null};
  },

  times(value, factor) {
    return value === null ? null : value * factor;
  },

  // The average heart rate of the activity, or null for a value outside the heart rates
  // app.importers.heartRates accepts, which is a monitor error.
  averageHeartRate(row) {
    var heartRate = app.importers.rows.number(row["Average Heart Rate (bpm)"]);
    return app.importers.heartRates.isHeartRate(heartRate) ? heartRate : null;
  },

  // "Jana,Martins," — the names of the tagged friends, each followed by a comma.
  friends(value) {
    var text = app.importers.rows.text(value);
    if (!text) return [];
    return _.uniq(text.split(",").map((name) => name.trim()).filter((name) => name));
  },

  // Why the activity is not plausible — its average speed is outside the PLAUSIBLE_SPEEDS of its type —
  // or null when it is.
  implausibility(activity) {
    var speeds = this.PLAUSIBLE_SPEEDS[activity.type];
    // A distance of 0 with a duration is a speed of 0, but no distance or no duration is no speed at all.
    if (!speeds || activity.distanceKm === null || !activity.durationSeconds) return null;
    var speed = activity.distanceKm * 3600 / activity.durationSeconds;
    if (speed >= speeds.min && speed <= speeds.max) return null;
    return `its average speed ${speed.toFixed(2)} km/h is ${speed < speeds.min ? "below" : "above"} ` +
      `the ${speed < speeds.min ? speeds.min : speeds.max} km/h of an activity of the type ${activity.type}`;
  },

  // The activities to import. The implausible activities are skipped with a warning, unless the Skip
  // implausible activities import option is deselected.
  plausible(activities) {
    if (source.getExtraOption("skip_implausible_activities") === false) return activities;
    return activities.filter((activity) => {
      var reason = this.implausibility(activity);
      if (!reason) return true;
      source.warnings.add(this.WARNING_KEY,
        `The activity ${this.memberName(activity)} was skipped: ${reason}. Delete or correct it in ` +
        "Runkeeper, or deselect the Skip implausible activities import option to import it.");
      return false;
    });
  },

  // The name of the activity member: "2026-09-24 07:03 Running 4.67 km". It is not unique — see
  // app.importers.dimensions.updateDuplicateActivityNames.
  memberName(activity) {
    var distance = activity.distanceKm === null ? "" : ` ${activity.distanceKm.toFixed(2)} km`;
    return `${activity.start.date} ${activity.start.time} ${activity.type}${distance}`;
  }
};
