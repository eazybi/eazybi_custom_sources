// Every import reads the whole export, which is a snapshot of all the activities of the account: there
// is nothing to request incrementally. The rows are written by the month of the activities — the unit
// that is replaced as a whole — so that an activity deleted in Runkeeper disappears with the next
// export, and a month that no longer has activities is emptied. The months written by the previous
// import are kept in the `months` max param for that, as a mask of the months of each year —
// {"2025": 4095, "2026": 511} — because a max param value is limited to 1000 characters and a list
// of the months of a long history is longer than that.
app.importer = {
  // The rows of the months are batched up to this many rows per importRows call, the limit of a call. A
  // month is never divided between two calls, because the second call would delete the rows of the
  // month written by the first one — a month of one person has far fewer rows than this.
  MAX_BATCH_ROWS: 10000,
  SOURCE_NAMES: {activities: "activity", splits: "split", heart_rate_zones: "heart rate zone"},

  importAll() {
    source.setStatusMessage("Downloading the Runkeeper export");
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

    source.setStatusMessage("Reading the heart rates");
    var heartRateIntervals = app.importers.heartRates.readAll(exportFile);

    this.analyzeTracks(exportFile, allActivities, heartRateIntervals);

    // The zones are percentages of one maximum for all the activities, so it is known only after all
    // the heart rates were read. It is the highest heart rate of the export, also of an activity which is
    // skipped: an implausible speed is a mistake of the tracking, not of the heart rate monitor.
    var observedMaximum = _.max(allActivities.map((activity) => activity.maxHeartRate || 0));
    var zonesMaximum = app.importers.heartRates.zonesMaximum(observedMaximum > 0 ? observedMaximum : null);
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

  // Reads the GPX track and the heart rate of every activity into it.
  analyzeTracks(exportFile, activities, heartRateIntervals) {
    var heartRates = app.importers.heartRates;
    logger.startImport("tracks");
    var tracksRead = 0;
    activities.forEach((activity, index) => {
      if (index % 20 === 0) {
        source.setStatusMessage("Reading the GPX tracks", {percentage: index * 100 / activities.length});
      }
      activity.track = this.analyzeTrack(exportFile, activity);
      if (activity.track) tracksRead++;
      var intervals = heartRates.intervalsOf(activity, heartRateIntervals,
        activity.track && activity.track.heartRateIntervals);
      activity.heartRateIntervals = intervals;
      activity.maxHeartRate = heartRates.maximum(intervals);
    });
    logger.finishImport("tracks", tracksRead);
  },

  // The splits of the GPX track of the activity, or null when it has none or it could not be read. A
  // track which can not be read does not fail its activity: the activity is imported without splits.
  analyzeTrack(exportFile, activity) {
    if (!activity.gpxFile) return null;
    var warningKey = app.importers.activities.WARNING_KEY;
    var name = app.importers.activities.memberName(activity);
    try {
      var lines = app.api.readTrackLines(exportFile, activity.gpxFile);
      if (!lines) {
        source.warnings.add(warningKey,
          `The GPX file ${activity.gpxFile} of the activity ${name} is not in the export, ` +
          "so the activity has no kilometer splits.");
        return null;
      }
      var tracks = app.importers.tracks;
      var track = tracks.parse(lines);
      if (track.segments.length === 0) {
        source.warnings.add(warningKey,
          `The GPX file ${activity.gpxFile} of the activity ${name} has no track points with a time, ` +
          "so the activity has no kilometer splits.");
        return null;
      }
      return tracks.analyze(track, activity);
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `The GPX file ${activity.gpxFile} of the activity ${name} could not be read: ${error.message}`);
      return null;
    }
  },

  // Adds the fact rows of one activity to rowsByTable[table][month].
  buildRows(activity, zonesMaximum, rowsByTable) {
    var dimensions = app.importers.dimensions;
    var month = activity.start.date.substring(0, 7);
    var common = {
      activity_id: dimensions.activityId(activity),
      activity_type_id: dimensions.activityTypeId(activity.type),
      hour_id: dimensions.hourId(activity.start.hour),
      distance_range_id: dimensions.distanceRangeId(activity.distanceKm),
      friend_bt_id: dimensions.friendBtId(activity.friends),
      time_id: dwh.lookupDateId(activity.start.date)
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
    var withHeartRate = activity.averageHeartRate !== null && activity.durationSeconds > 0;
    return {
      activities_count: 1,
      distance_km: activity.distanceKm,
      longest_distance_km: activity.distanceKm,
      duration_seconds: activity.durationSeconds,
      calories: activity.calories,
      climb_m: activity.climbM,
      max_heart_rate: activity.maxHeartRate,
      fastest_km_seconds: activity.track ? activity.track.fastestKmSeconds : null,
      // The average heart rate of the activity weighted by its duration, so that a long run counts more
      // than a short one in the Average heart rate of a month.
      heart_beats: withHeartRate ?
        app.importers.rows.round(activity.averageHeartRate * activity.durationSeconds / 60, 1) : null,
      heart_rate_seconds: withHeartRate ? activity.durationSeconds : null
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
