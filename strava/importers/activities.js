// The activities of activities.csv, one row per activity. Its header repeats five column names:
//
//   Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,
//   Max Heart Rate,Relative Effort,Commute,...,Filename,...,Elapsed Time,Moving Time,Distance,...
//
// The first Distance is in the display unit of the athlete (km or mi) and rounded, the later one is in
// meters, so every column is read by its position and a repeated one by the occurrence named in COLUMNS:
// the later Elapsed Time and Distance are exact seconds and meters, the first Max Heart Rate is filled for
// more activities than the later one. The later columns are in meters, seconds and meters per second
// whatever units the athlete chose. Activity Date is the UTC time when the activity started.
app.importers.activities = {
  // The key of every warning of an activity or of a row of activities.csv. Every import reads the
  // whole export, and an activity deleted in Strava is in no later export, so a warning keyed by its
  // activity would never be cleared: the importer clears the warnings of this key which an import did not
  // add again once at its end.
  WARNING_KEY: "activities",
  STRAVA_ACTIVITY_URL: "https://www.strava.com/activities/",

  // The columns which are read, and which occurrence of a repeated column name.
  COLUMNS: [
    {field: "id", header: "Activity ID", required: true},
    {field: "date", header: "Activity Date", required: true},
    {field: "title", header: "Activity Name"},
    {field: "type", header: "Activity Type", required: true},
    {field: "description", header: "Activity Description"},
    {field: "elapsedDisplay", header: "Elapsed Time", occurrence: "first"},
    {field: "maxHeartRate", header: "Max Heart Rate", occurrence: "first"},
    {field: "relativeEffort", header: "Relative Effort", occurrence: "first"},
    {field: "gear", header: "Activity Gear"},
    {field: "fileName", header: "Filename"},
    {field: "elapsed", header: "Elapsed Time", occurrence: "last"},
    {field: "moving", header: "Moving Time"},
    {field: "distance", header: "Distance", occurrence: "last", required: true},
    {field: "maxSpeed", header: "Max Speed"},
    {field: "elevationGain", header: "Elevation Gain"},
    {field: "averageHeartRate", header: "Average Heart Rate"},
    {field: "averageWatts", header: "Average Watts"},
    {field: "calories", header: "Calories"},
    {field: "steps", header: "Total Steps"}
  ],

  // The average speeds in km/h an activity of the type can have. An activity outside the range is a
  // mistake of the recording — a jump of the GPS position, or a walk recorded in a car — and would
  // distort every average of its month. The types without a meaningful speed (Workout, Yoga, …) and the
  // virtual ones, whose distance comes from a trainer, are not checked.
  PLAUSIBLE_SPEEDS: {
    "Run": {min: 1, max: 30},
    "Trail Run": {min: 1, max: 30},
    "Walk": {min: 1, max: 15},
    "Hike": {min: 0.5, max: 15},
    "Ride": {min: 1, max: 80},
    "Mountain Bike Ride": {min: 1, max: 60},
    "Gravel Ride": {min: 1, max: 70},
    "E-Bike Ride": {min: 1, max: 60},
    "E-Mountain Bike Ride": {min: 1, max: 50}
  },

  // The activity records of all the rows, and a warning for each row which is not an activity.
  readAll(exportFile) {
    var activities = [];
    var columns = null;
    var rowNumber = 0;
    logger.startImport("activities");
    app.api.readActivityRows(exportFile, (rows) => {
      rows.forEach((cells) => {
        if (!columns) {
          columns = this.resolveColumns(cells);
          return;
        }
        rowNumber++;
        if (this.isEmptyRow(cells)) return;
        var activity = this.build(cells, columns);
        if (activity) activities.push(activity);
        else {
          source.warnings.add(this.WARNING_KEY,
            `The row ${rowNumber} of ${app.api.ACTIVITIES_ENTRY} was skipped: it has no Activity ID or ` +
            "no valid Activity Date.");
        }
      });
    });
    // An empty file is a broken export, not an account without activities, whose file has the header row:
    // importing it would empty every month of the previous import.
    if (!columns) throw new Error(`The ${app.api.ACTIVITIES_ENTRY} file of the export is empty.`);
    logger.finishImport("activities", activities.length);
    return activities;
  },

  ENGLISH_EXPORT_HINT: "An export in another language than English has other column names: set the language " +
    "to English in the Strava settings under Display Preferences, request a new export and replace the file.",

  // {field: column index} of the header row. Throws an error naming the missing columns of a file which
  // is not the activities.csv of a Strava export. Strava writes the column names and the dates in the
  // language of the account, so an export requested in another language than English has no such columns.
  resolveColumns(header) {
    var positions = {};
    header.forEach((name, index) => {
      var key = app.importers.rows.text(name);
      if (key) (positions[key] = positions[key] || []).push(index);
    });
    var columns = {};
    this.COLUMNS.forEach((column) => {
      var indexes = positions[column.header] || [];
      // A header with one Distance has no column in meters: its only Distance is in the display unit.
      if (column.occurrence === "last") {
        if (indexes.length > 1) columns[column.field] = indexes[indexes.length - 1];
      } else if (indexes.length > 0) columns[column.field] = indexes[0];
    });
    var missing = this.COLUMNS.filter((column) => column.required && columns[column.field] === undefined).
      map((column) => column.occurrence === "last" ? `second ${column.header}` : column.header);
    if (missing.length > 0) {
      throw new Error(`The ${app.api.ACTIVITIES_ENTRY} file of the export is not from a Strava account ` +
        `export: it has no ${missing.join(", ")} column. ${this.ENGLISH_EXPORT_HINT}`);
    }
    return columns;
  },

  isEmptyRow(cells) {
    return cells.every((cell) => app.importers.rows.text(cell) === null);
  },

  // The activity record of one row, or null when the row has no id or start time.
  build(cells, columns) {
    var rows = app.importers.rows;
    var value = (field) => columns[field] === undefined ? null : cells[columns[field]];
    var id = rows.text(value("id"));
    var startUtc = rows.utcTimestamp(value("date"));
    if (!id || !startUtc) return null;

    var distanceM = rows.number(value("distance"));
    var maxSpeed = rows.number(value("maxSpeed"));
    var averageWatts = rows.number(value("averageWatts"));
    var steps = rows.number(value("steps"));
    var fileName = rows.text(value("fileName"));
    var title = rows.text(value("title"));
    // The first Elapsed Time is a display text, sometimes "28:21", for a row without the exact seconds.
    var elapsedSeconds = rows.durationSeconds(value("elapsed"));
    if (elapsedSeconds === null) elapsedSeconds = rows.durationSeconds(value("elapsedDisplay"));

    return {
      id: id,
      startUtc: startUtc,
      start: this.localStart(startUtc),
      type: rows.text(value("type")) || "Other",
      title: title === null ? null : this.truncate(title, this.MAX_TITLE_LENGTH),
      description: rows.text(value("description")),
      gear: rows.text(value("gear")),
      fileName: fileName ? fileName.split("/").pop() : null,
      distanceKm: distanceM === null ? null : rows.round(distanceM / 1000, 3),
      movingSeconds: rows.durationSeconds(value("moving")),
      elapsedSeconds: elapsedSeconds,
      elevationGainM: rows.round(rows.number(value("elevationGain")), 1),
      maxSpeedKmh: maxSpeed === null ? null : rows.round(maxSpeed * 3.6, 2),
      averageHeartRate: this.heartRate(value("averageHeartRate")),
      maxHeartRate: this.heartRate(value("maxHeartRate")),
      relativeEffort: rows.number(value("relativeEffort")),
      calories: rows.number(value("calories")),
      steps: steps > 0 ? steps : null,
      averageWatts: averageWatts > 0 ? averageWatts : null
    };
  },

  // The start of the activity in the Time dimension time zone: {datetime: "2026-10-02 19:32:47",
  // date: "2026-10-02", time: "19:32", hour: 19, month: "2026-10"}.
  localStart(startUtc) {
    var datetime = dwh.datetimeValue(startUtc, "Activity Date");
    return {
      datetime: datetime,
      date: datetime.substring(0, 10),
      time: datetime.substring(11, 16),
      hour: parseInt(datetime.substring(11, 13), 10),
      month: datetime.substring(0, 7)
    };
  },

  // A heart rate of the row, or null for a value outside the heart rates app.importers.heartRates accepts,
  // which is a monitor error.
  heartRate(value) {
    var heartRate = app.importers.rows.number(value);
    return app.importers.heartRates.isHeartRate(heartRate) ? heartRate : null;
  },

  // The moving time of the activity, or the elapsed time when Strava counted no moving time.
  durationSeconds(activity) {
    return activity.movingSeconds || activity.elapsedSeconds;
  },

  // Why the activity is not plausible — its average speed is outside the PLAUSIBLE_SPEEDS of its type —
  // or null when it is.
  implausibility(activity) {
    var speeds = this.PLAUSIBLE_SPEEDS[activity.type];
    var seconds = this.durationSeconds(activity);
    // A distance of 0 with a duration is a speed of 0, but no distance or no duration is no speed at all.
    if (!speeds || activity.distanceKm === null || !seconds) return null;
    var speed = activity.distanceKm * 3600 / seconds;
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
        `The activity ${this.memberName(activity)} was skipped: ${reason}. Correct or delete it in ` +
        "Strava, or deselect the Skip implausible activities import option to import it.");
      return false;
    });
  },

  // The name of the activity member: "2026-10-02 19:32 Morning Walk", or "2026-10-02 19:32 Walk 5.64 km"
  // for an activity without a title. It is not unique — see
  // app.importers.dimensions.updateDuplicateActivityNames.
  memberName(activity) {
    var start = `${activity.start.date} ${activity.start.time}`;
    if (activity.title) return `${start} ${this.truncate(activity.title, this.MAX_NAME_TITLE_LENGTH)}`;
    var distance = activity.distanceKm === null ? "" : ` ${activity.distanceKm.toFixed(2)} km`;
    return `${start} ${activity.type}${distance}`;
  },

  // A string column holds 255 characters. The member name keeps room for the start time and for the
  // activity id which updateDuplicateActivityNames appends.
  MAX_TITLE_LENGTH: 255,
  MAX_NAME_TITLE_LENGTH: 200,

  truncate(text, length) {
    return text.length > length ? `${text.substring(0, length - 1)}…` : text;
  },

  stravaUrl(activity) {
    return `${this.STRAVA_ACTIVITY_URL}${encodeURIComponent(activity.id)}`;
  }
};
