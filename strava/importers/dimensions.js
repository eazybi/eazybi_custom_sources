// The dimension members of the activities. The members with a fixed order — hours, distance ranges,
// kilometers and heart rate zones — are keyed by their position, so that they sort in that order.
app.importers.dimensions = {
  DISTANCE_RANGES: [
    {key: 1, name: "Under 5 km", fromKm: 0},
    {key: 2, name: "5-10 km", fromKm: 5},
    {key: 3, name: "10-21 km", fromKm: 10},
    {key: 4, name: "21-42 km", fromKm: 21},
    {key: 5, name: "42 km and more", fromKm: 42}
  ],
  NO_GEAR: "(none)",

  // Seeds the members which sort by their key, so that they are listed in their order from the first
  // import on.
  seed() {
    for (var hour = 0; hour < 24; hour++) this.hourId(hour);
    this.DISTANCE_RANGES.forEach((range) => this.storeDistanceRange(range));
    app.importers.heartRates.ZONES.forEach((zone) => this.zoneId(zone));
  },

  activityId(activity) {
    var activities = app.importers.activities;
    return dwh.dimensions.activities.createAndLookupId({activity_key: activity.id}, {
      name: activities.memberName(activity),
      start_time: `${activity.start.date} ${activity.start.time}`,
      title: activity.title,
      description: activity.description,
      activity_file: activity.fileName,
      strava_url: activities.stravaUrl(activity)
    });
  },

  // A member name keeps only the start minute and the title, so two activities can have the same name: the
  // Strava id of the activity tells such members apart in a report.
  updateDuplicateActivityNames() {
    dwh.dimensions.activities.updateDuplicateNames({nameColumn: "name", addColumn: "activity_key"});
  },

  activityTypeId(type) {
    return dwh.dimensions.activity_types.createAndLookupId({name: type}, {});
  },

  // The shoes or the bike of the activity, or the "(none)" member of an activity without gear.
  gearId(gear) {
    return dwh.dimensions.gears.createAndLookupId({name: gear || this.NO_GEAR}, {});
  },

  // "07", so that the members read as hours and sort as hours also where the ordinal is not used.
  hourId(hour) {
    return dwh.dimensions.hours.createAndLookupId({hour: hour}, {name: hour < 10 ? `0${hour}` : String(hour)});
  },

  distanceRangeId(distanceKm) {
    if (distanceKm === null) return null;
    var range = this.DISTANCE_RANGES[0];
    this.DISTANCE_RANGES.forEach((candidate) => { if (distanceKm >= candidate.fromKm) range = candidate; });
    return this.storeDistanceRange(range);
  },

  storeDistanceRange(range) {
    return dwh.dimensions.distance_ranges.createAndLookupId({range_key: range.key}, {name: range.name});
  },

  kilometerId(number) {
    return dwh.dimensions.kilometers.createAndLookupId({number: number}, {name: `Km ${number}`});
  },

  zoneId(zone) {
    return dwh.dimensions.heart_rate_zones.createAndLookupId({zone: zone.key}, {name: zone.name});
  }
};
