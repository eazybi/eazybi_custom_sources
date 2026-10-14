// Every import reads the whole export, which is a snapshot of all the activities of the account: there
// is nothing to request incrementally. The rows are written by the month of the activities — the unit
// that is replaced as a whole — so that an activity deleted in Strava disappears with the next export,
// and a month that no longer has activities is emptied. The months written by the previous import are
// kept in the `months` max param for that, as a mask of the months of each year —
// {"2025": 4095, "2026": 511} — because a max param value is limited to 1000 characters and a list
// of the months of a long history is longer than that.
app.importer = {
  // The rows of the months are batched up to this many rows per importRows call, the limit of a call. A
  // month is never divided between two calls, because the second call would delete the rows of the
  // month written by the first one — a month of one person has far fewer rows than this.
  MAX_BATCH_ROWS: 10000,
  SOURCE_NAMES: {activities: "activity", splits: "split", heart_rate_zones: "heart rate zone"},

  importAll() {
    source.setStatusMessage("Downloading the Strava export");
    var exportFile = app.api.downloadExport();
    try {
      this.importExport(exportFile);
    } finally {
      source.deleteFile(exportFile.file);
    }
  },

  importExport(exportFile) {
    source.setStatusMessage("Reading the activities");
    var allActivities = app.importers.activities.readAll(exportFile);
    var preferences = app.api.readPreferences(exportFile);

    this.analyzeTracks(exportFile, allActivities);

    // The zones are percentages of one maximum for all the activities, so it is known only after all
    // the tracks were read. The highest heart rate of the export is also of an activity which is skipped:
    // an implausible speed is a mistake of the GPS, not of the heart rate monitor.
    var observedMaximum = _.max(allActivities.map((activity) => activity.maxHeartRate || 0));
    var zonesMaximum = app.importers.heartRates.zonesMaximum(preferences, observedMaximum > 0 ? observedMaximum : null);
    var activities = app.importers.activities.plausible(allActivities);

    source.setStatusMessage("Importing the activities");
    app.importers.dimensions.seed();
    var rowsByTable = {activities: {}, splits: {}, heart_rate_zones: {}};
    logger.startImport("activity rows");
    activities.forEach((activity) => this.buildRows(activity, zonesMaximum, rowsByTable));
    logger.finishImport("activity rows", activities.length);
    app.importers.dimensions.updateDuplicateActivityNames();

    this.writeRows(rowsByTable);

    // The warnings of the earlier imports which this one did not add again are of the activities which
    // were corrected or deleted since.
    source.warnings.clearOld(app.importers.activities.WARNING_KEY);
  },

  // Reads the track of the activity file of every activity into it, and its heart rate.
  analyzeTracks(exportFile, activities) {
    logger.startImport("tracks");
    var tracksRead = 0;
    activities.forEach((activity, index) => {
      if (index % 20 === 0) {
        source.setStatusMessage("Reading the activity files", {percentage: index * 100 / activities.length});
      }
      activity.track = this.analyzeTrack(exportFile, activity);
      if (activity.track) tracksRead++;
      activity.heartRateIntervals = activity.track ? activity.track.heartRateIntervals : [];
      if (activity.maxHeartRate === null) {
        activity.maxHeartRate = app.importers.heartRates.maximum(activity.heartRateIntervals);
      }
    });
    logger.finishImport("tracks", tracksRead);
  },

  // The splits of the GPX, TCX or FIT track of the activity, or null when it has none or it could not be read.
  // A track which can not be read does not fail its activity: the activity is imported without splits.
  // An activity without a track point with a position — a workout recorded indoors — has no splits.
  analyzeTrack(exportFile, activity) {
    if (!activity.fileName) return null;
    var warningKey = app.importers.activities.WARNING_KEY;
    var name = app.importers.activities.memberName(activity);
    try {
      var track = this.readTrack(exportFile, activity.fileName);
      if (!track) {
        source.warnings.add(warningKey,
          `The file ${activity.fileName} of the activity ${name} is not in the export, ` +
          "so the activity has no kilometer splits and no time in the heart rate zones.");
        return null;
      }
      return track.segments.length === 0 ? null : app.importers.tracks.analyze(track);
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `The file ${activity.fileName} of the activity ${name} could not be read: ${error.message}`);
      return null;
    }
  },

  // The track of the activity file, or null when the export has no file of that name.
  readTrack(exportFile, fileName) {
    var tracks = app.importers.tracks;
    if (tracks.isFit(fileName)) {
      var bytes = app.api.readActivityFileBytes(exportFile, fileName);
      return bytes ? tracks.parseFit(bytes) : null;
    } else {
      var lines = app.api.readActivityFileLines(exportFile, fileName);
      return lines ? tracks.parse(lines, fileName) : null;
    }
  },

  // Adds the fact rows of one activity to rowsByTable[table][month].
  buildRows(activity, zonesMaximum, rowsByTable) {
    var dimensions = app.importers.dimensions;
    var month = activity.start.month;
    var common = {
      activity_id: dimensions.activityId(activity),
      activity_type_id: dimensions.activityTypeId(activity.type),
      gear_id: dimensions.gearId(activity.gear),
      hour_id: dimensions.hourId(activity.start.hour),
      distance_range_id: dimensions.distanceRangeId(activity.distanceKm),
      time_id: dwh.lookupTimeId(activity.startUtc, "Activity Date")
    };
    var add = (table, row) => {
      var rows = rowsByTable[table][month] = rowsByTable[table][month] || [];
      rows.push(_.extend({}, common, row));
    };

    add("activities", this.activityMeasures(activity));

    var splits = activity.track ? activity.track.splits : [];
    splits.forEach((split) => add("splits", {
      kilometer_id: dimensions.kilometerId(split.number),
      split_distance_m: split.distanceM,
      split_seconds: split.seconds,
      split_elevation_gain_m: split.elevationGainM,
      split_heart_beats: split.heartRateSeconds > 0 ? split.heartBeats : null,
      split_heart_rate_seconds: split.heartRateSeconds > 0 ? split.heartRateSeconds : null
    }));

    app.importers.heartRates.zoneSeconds(activity.heartRateIntervals, zonesMaximum).forEach((zoneTime) =>
      add("heart_rate_zones", {heart_rate_zone_id: dimensions.zoneId(zoneTime.zone), zone_seconds: zoneTime.seconds}));
  },

  activityMeasures(activity) {
    var round = app.importers.rows.round;
    var seconds = app.importers.activities.durationSeconds(activity);
    var withHeartRate = activity.averageHeartRate !== null && seconds > 0;
    var withPower = activity.averageWatts !== null && seconds > 0;
    return {
      activities_count: 1,
      distance_km: activity.distanceKm,
      longest_distance_km: activity.distanceKm,
      moving_seconds: activity.movingSeconds,
      elapsed_seconds: activity.elapsedSeconds,
      elevation_gain_m: activity.elevationGainM,
      calories: activity.calories,
      steps: activity.steps,
      relative_effort: activity.relativeEffort,
      max_speed_kmh: activity.maxSpeedKmh,
      max_heart_rate: activity.maxHeartRate,
      fastest_km_seconds: activity.track ? activity.track.fastestKmSeconds : null,
      // The average heart rate and power of the activity weighted by its moving time, so that a long ride
      // counts more than a short one in the averages of a month.
      heart_beats: withHeartRate ? round(activity.averageHeartRate * seconds / 60, 1) : null,
      heart_rate_seconds: withHeartRate ? seconds : null,
      energy_joules: withPower ? round(activity.averageWatts * seconds, 1) : null,
      power_seconds: withPower ? seconds : null
    };
  },

  // Writes the rows of every month, and empties the months of the previous import which have no rows
  // now. The rows of several months are written by one call, each month as a scope of its own.
  writeRows(rowsByTable) {
    var currentMonths = _.keys(rowsByTable.activities).sort();
    var months = _.union(currentMonths, this.previousMonths()).sort();
    _.keys(this.SOURCE_NAMES).forEach((table) => {
      var sourceName = this.SOURCE_NAMES[table];
      var measures = dwh.measures[table];
      var batch = [];
      months.forEach((month) => {
        var rows = rowsByTable[table][month] || [];
        if (rows.length === 0) {
          measures.importRows([], {sourceId: month, sourceName: sourceName});
          return;
        }
        if (batch.length > 0 && batch.length + rows.length > this.MAX_BATCH_ROWS) {
          measures.importRows(batch);
          batch = [];
        }
        rows.forEach((row) => {
          row._source_id = month;
          row._source_name = sourceName;
          batch.push(row);
        });
      });
      if (batch.length > 0) measures.importRows(batch);
    });
    source.setMaxParam("months", JSON.stringify(this.encodeMonths(currentMonths)));
  },

  // The months of the rows written by the previous import.
  previousMonths() {
    var stored = source.getMaxParam("months");
    if (!stored) return [];
    try {
      return this.decodeMonths(JSON.parse(stored));
    } catch (error) {
      return [];
    }
  },

  // ["2026-01", "2026-03"] as {"2026": 5} — bit 0 is January.
  encodeMonths(months) {
    var masks = {};
    months.forEach((month) => {
      var year = month.substring(0, 4);
      masks[year] = (masks[year] || 0) | (1 << (parseInt(month.substring(5, 7), 10) - 1));
    });
    return masks;
  },

  decodeMonths(masks) {
    var months = [];
    if (!masks || typeof masks !== "object") return months;
    _.keys(masks).forEach((year) => {
      if (!/^\d{4}$/.test(year)) return;
      for (let month = 1; month <= 12; month++) {
        if (masks[year] & (1 << (month - 1))) months.push(`${year}-${month < 10 ? "0" : ""}${month}`);
      }
    });
    return months;
  }
};
