// The heart rate of the activities: the samples of heartRate.csv, which an export of all the data holds
// for every activity recorded with a heart rate monitor, or else the heart rate of the GPX track points.
//
//   Activity Id, Timestamp, Heart Rate
//   ca4e70f3-f64a-4de9-9e75-6e7c31df4703,745.198,160
//
// Timestamp is the seconds since the start of the activity. The samples come every few seconds, with
// gaps where the monitor lost the contact, so the time between two samples counts at most
// MAX_SAMPLE_SECONDS — a gap is not time spent at the heart rate before it.
//
// The zones are the usual five zones of the percentage of the maximum heart rate, which is the Maximum
// heart rate import option, or the highest heart rate of the export when the option is empty.
app.importers.heartRates = {
  ZONES: [
    {key: 0, name: "Below zone 1", fromPercent: 0},
    {key: 1, name: "Zone 1 (50-60%)", fromPercent: 50},
    {key: 2, name: "Zone 2 (60-70%)", fromPercent: 60},
    {key: 3, name: "Zone 3 (70-80%)", fromPercent: 70},
    {key: 4, name: "Zone 4 (80-90%)", fromPercent: 80},
    {key: 5, name: "Zone 5 (90-100%)", fromPercent: 90}
  ],
  // Values outside this range are a monitor error, not a heart rate.
  MIN_HEART_RATE: 30,
  MAX_HEART_RATE: 250,

  // {activityId: [{heartRate, seconds}]} of heartRate.csv, empty when the export has no such file.
  readAll(exportFile) {
    var samplesByActivity = {};
    logger.startImport("heart rates");
    var count = 0;
    app.api.readHeartRates(exportFile, (rows) => {
      rows.forEach((row) => {
        var sample = this.sample(row);
        if (!sample) return;
        (samplesByActivity[sample.activityId] = samplesByActivity[sample.activityId] || []).push(sample);
        count++;
      });
    });
    logger.finishImport("heart rates", count);
    var intervalsByActivity = {};
    for (var activityId in samplesByActivity) {
      intervalsByActivity[activityId] = this.intervals(samplesByActivity[activityId]);
    }
    return intervalsByActivity;
  },

  // The columns of heartRate.csv are named with a leading space (" Timestamp"), so they are read by
  // their trimmed names.
  sample(row) {
    var values = {};
    for (var key in row) values[key.trim()] = row[key];
    var rows = app.importers.rows;
    var activityId = rows.text(values["Activity Id"]);
    var seconds = rows.number(values["Timestamp"]);
    var heartRate = rows.number(values["Heart Rate"]);
    if (!activityId || seconds === null || !this.isHeartRate(heartRate)) return null;
    return {activityId: activityId, seconds: seconds, heartRate: heartRate};
  },

  isHeartRate(heartRate) {
    return heartRate !== null && heartRate >= this.MIN_HEART_RATE && heartRate <= this.MAX_HEART_RATE;
  },

  // [{heartRate, seconds}] between the consecutive samples of one activity, and the last sample with no
  // seconds.
  intervals(samples) {
    var sorted = _.sortBy(samples, "seconds");
    var intervals = [];
    for (let index = 1; index < sorted.length; index++) {
      let seconds = Math.min(app.importers.tracks.MAX_SAMPLE_SECONDS, sorted[index].seconds - sorted[index - 1].seconds);
      if (seconds > 0) intervals.push({heartRate: sorted[index - 1].heartRate, seconds: seconds});
    }
    // The last sample ends no interval, but it may be the highest heart rate of the activity.
    if (sorted.length > 0) intervals.push({heartRate: sorted[sorted.length - 1].heartRate, seconds: 0});
    return intervals;
  },

  // The heart rate intervals of the activity: of heartRate.csv when it has them, else of its track.
  intervalsOf(activity, intervalsByActivity, trackIntervals) {
    var intervals = intervalsByActivity[activity.id];
    if (intervals && intervals.length > 0) return intervals;
    return (trackIntervals || []).filter((interval) => this.isHeartRate(interval.heartRate));
  },

  maximum(intervals) {
    if (!intervals || intervals.length === 0) return null;
    return _.max(intervals.map((interval) => interval.heartRate));
  },

  // The maximum heart rate the zones are the percentages of.
  zonesMaximum(observedMaximum) {
    var option = app.importers.rows.number(source.getExtraOption("max_heart_rate"));
    if (option && this.isHeartRate(option)) return option;
    return observedMaximum;
  },

  // The zone of a heart rate.
  zone(heartRate, maximum) {
    var percent = heartRate * 100 / maximum;
    var zone = this.ZONES[0];
    this.ZONES.forEach((candidate) => { if (percent >= candidate.fromPercent) zone = candidate; });
    return zone;
  },

  // [{zone, seconds}] of the intervals, only the zones with some time.
  zoneSeconds(intervals, maximum) {
    if (!maximum || !intervals || intervals.length === 0) return [];
    var secondsByZone = {};
    intervals.forEach((interval) => {
      var zone = this.zone(interval.heartRate, maximum);
      secondsByZone[zone.key] = (secondsByZone[zone.key] || 0) + interval.seconds;
    });
    return this.ZONES.
      filter((zone) => secondsByZone[zone.key] > 0).
      map((zone) => ({zone: zone, seconds: Math.round(secondsByZone[zone.key])}));
  }
};
