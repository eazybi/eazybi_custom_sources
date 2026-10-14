// The heart rate zones of the activities, from the heart rate of the track points of their activity files.
//
// The zones are the usual five zones of the percentage of the maximum heart rate: the Maximum heart rate
// import option, else the Maximum Heartrate of the Strava settings of the athlete in
// general_preferences.csv, else the highest heart rate of the export.
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
  PREFERENCES_COLUMN: "Maximum Heartrate",

  isHeartRate(heartRate) {
    return heartRate !== null && heartRate >= this.MIN_HEART_RATE && heartRate <= this.MAX_HEART_RATE;
  },

  maximum(intervals) {
    if (!intervals || intervals.length === 0) return null;
    return _.max(intervals.map((interval) => interval.heartRate));
  },

  // The maximum heart rate the zones are the percentages of, or null when there is none.
  zonesMaximum(preferences, observedMaximum) {
    var rows = app.importers.rows;
    var option = rows.number(source.getExtraOption("max_heart_rate"));
    if (this.isHeartRate(option)) return option;
    var preference = rows.number(preferences && preferences[this.PREFERENCES_COLUMN]);
    if (this.isHeartRate(preference)) return preference;
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
