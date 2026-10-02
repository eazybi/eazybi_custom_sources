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
  NO_FRIENDS: "(none)",

  // Seeds the members which sort by their key, so that they are listed in their order from the first
  // import on.
  seed() {
    for (var hour = 0; hour < 24; hour++) this.hourId(hour);
    this.DISTANCE_RANGES.forEach((range) => this.storeDistanceRange(range));
    app.importers.heartRates.ZONES.forEach((zone) => this.zoneId(zone));
  },

  activityId(activity) {
    var track = activity.track;
    return dwh.dimensions.activities.createAndLookupId({activity_key: activity.id}, {
      name: app.importers.activities.memberName(activity),
      start_time: `${activity.start.date} ${activity.start.time}`,
      route_name: activity.routeName,
      notes: activity.notes,
      friends: activity.friends.length > 0 ? activity.friends.join(", ") : null,
      gpx_file: activity.gpxFile,
      utc_offset: track ? app.importers.rows.utcOffsetName(track.utcOffsetMinutes) : null
    });
  },

  // A member name keeps only the start minute and the distance rounded to 10 m, so two activities of the
  // same type can have the same name: the Runkeeper id of the activity tells such members apart in a report.
  updateDuplicateActivityNames() {
    dwh.dimensions.activities.updateDuplicateNames({nameColumn: "name", addColumn: "activity_key"});
  },

  activityTypeId(type) {
    return dwh.dimensions.activity_types.createAndLookupId({name: type}, {});
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

  // The bridge id of the tagged friends, or of the "(none)" member of an activity without them.
  friendBtId(friends) {
    var names = friends.length > 0 ? friends : [this.NO_FRIENDS];
    return dwh.dimensions.friends_bt.btIdFor(
      names.map((name) => dwh.dimensions.friends.createAndLookupId({name: name}, {})));
  },

  kilometerId(number) {
    return dwh.dimensions.kilometers.createAndLookupId({number: number}, {name: `Km ${number}`});
  },

  zoneId(zone) {
    return dwh.dimensions.heart_rate_zones.createAndLookupId({zone: zone.key}, {name: zone.name});
  }
};
