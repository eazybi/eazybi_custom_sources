app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension,
      weekDayDimension = schema.weekDayDimension, cube = schema.cube;

  // One member per activity, the level that every measure drills through to. The start time is the
  // local wall clock of the activity as Runkeeper recorded it, which is why it is a text and not a
  // timestamp: the export gives it without a time zone, and an activity abroad started at another
  // offset than one at home.
  dimension("Activity", (d) => {
    d.table("activities");
    d.level((l) => {
      l.string("activity_key", {key: true});
      l.string("name", {name: true, ordinal: true});
      l.string("start_time", {property: "Start time", limit: 16});
      l.string("route_name", {property: "Route name"});
      l.text("notes", {property: "Notes"});
      l.string("friends", {property: "Friends"});
      l.string("gpx_file", {property: "GPX file"});
      l.string("utc_offset", {property: "UTC offset", limit: 6});
    });
  });

  dimension("Activity type", (d) => {
    d.table("activity_types");
    d.level((l) => {
      l.string("name", {key: true, name: true});
    });
  });

  dimension("Distance range", (d) => {
    d.table("distance_ranges");
    d.level((l) => {
      l.integer("range_key", {key: true, ordinal: true});
      l.string("name", {name: true});
    });
  });

  // The friends tagged in an activity — an activity with several friends counts once for each of them,
  // and once in total.
  dimension("Friend", (d) => {
    d.table("friends");
    d.level((l) => {
      l.string("name", {key: true, name: true});
    });
    d.bridgeTable("friends_bt", (b) => {
      b.string("_bt_id", {primaryKey: true, limit: 150, bridgeDimensionForeignKeyColumn: "friend_bt_id"});
      b.integer("friend_id", {parentKey: true});
    });
  });

  // The local hour when the activity started.
  dimension("Hour", (d) => {
    d.table("hours");
    d.level((l) => {
      l.integer("hour", {key: true, ordinal: true});
      l.string("name", {name: true, limit: 5});
    });
  });

  // The number of the kilometer of a split: Km 1 is the first kilometer of each activity.
  dimension("Kilometer", (d) => {
    d.table("kilometers");
    d.level((l) => {
      l.integer("number", {key: true, ordinal: true});
      l.string("name", {name: true});
    });
  });

  dimension("Heart rate zone", (d) => {
    d.table("heart_rate_zones");
    d.level((l) => {
      l.integer("zone", {key: true, ordinal: true});
      l.string("name", {name: true});
    });
  });

  // The local date of the activity.
  timeDimension("Time");
  weekDayDimension("Week Day");

  cube((c) => {
    c.table("activities");
    c.annotations({
      default_measures: ["Activities", "Distance km"],
      drill_through_dimension_levels: ["[Activity].[Activity]"]
    });

    c.measures((m) => {
      m.integer("activities_count", {name: "Activities"});
      m.decimal("distance_km", {name: "Distance km", precision: 15, scale: 3, formatString: "#,##0.00"});
      m.decimal("longest_distance_km", {name: "Longest distance km", precision: 15, scale: 3,
        aggregator: "max", formatString: "#,##0.00"});
      m.integer("duration_seconds", {name: "Duration", formatString: "SecondsFormatter"});
      m.decimal("calories", {name: "Calories", precision: 15, scale: 1, formatString: "#,##0"});
      m.decimal("climb_m", {name: "Climb m", precision: 15, scale: 1, formatString: "#,##0"});
      m.integer("max_heart_rate", {name: "Max heart rate", aggregator: "max", formatString: "#,##0"});
      m.integer("fastest_km_seconds", {name: "Fastest km", aggregator: "min", formatString: "SecondsFormatter"});
      // The duration weighted average heart rate: the heart beats and the seconds of the activities
      // with an average heart rate.
      m.decimal("heart_beats", {name: "Heart beats", precision: 15, scale: 1, visible: false});
      m.integer("heart_rate_seconds", {name: "Heart rate seconds", visible: false});
    });

    c.measures("Splits", (m) => {
      m.table("splits");
      m.decimal("split_distance_m", {name: "Split distance m", precision: 15, scale: 1, formatString: "#,##0"});
      m.decimal("split_seconds", {name: "Split duration", precision: 15, scale: 1,
        formatString: "SecondsFormatter"});
      m.decimal("split_elevation_gain_m", {name: "Split elevation gain m", precision: 15, scale: 1,
        formatString: "#,##0.0"});
      m.decimal("split_heart_beats", {name: "Split heart beats", precision: 15, scale: 1, visible: false});
      m.decimal("split_heart_rate_seconds", {name: "Split heart rate seconds", precision: 15, scale: 1,
        visible: false});
    });

    c.measures("Heart rate zones", (m) => {
      m.table("heart_rate_zones");
      m.integer("zone_seconds", {name: "Time in zone", formatString: "SecondsFormatter"});
    });

    c.timeDimensionCalculatedMembers();

    c.calculatedMember("Average pace", {
      formula: `
        CASE WHEN [Measures].[Distance km] > 0 THEN
          [Measures].[Duration] / [Measures].[Distance km]
        END`,
      formatString: "SecondsFormatter"
    });
    c.calculatedMember("Average speed km/h", {
      formula: `
        CASE WHEN [Measures].[Duration] > 0 THEN
          [Measures].[Distance km] * 3600 / [Measures].[Duration]
        END`,
      formatString: "#,##0.00"
    });
    c.calculatedMember("Average distance km", {
      formula: `
        CASE WHEN [Measures].[Activities] > 0 THEN
          [Measures].[Distance km] / [Measures].[Activities]
        END`,
      formatString: "#,##0.00"
    });
    c.calculatedMember("Average heart rate", {
      formula: `
        CASE WHEN [Measures].[Heart rate seconds] > 0 THEN
          [Measures].[Heart beats] * 60 / [Measures].[Heart rate seconds]
        END`,
      formatString: "#,##0"
    });
    c.calculatedMember("Split pace", {
      formula: `
        CASE WHEN [Measures].[Split distance m] > 0 THEN
          [Measures].[Split duration] * 1000 / [Measures].[Split distance m]
        END`,
      formatString: "SecondsFormatter"
    });
    c.calculatedMember("Split average heart rate", {
      formula: `
        CASE WHEN [Measures].[Split heart rate seconds] > 0 THEN
          [Measures].[Split heart beats] * 60 / [Measures].[Split heart rate seconds]
        END`,
      formatString: "#,##0"
    });
    c.calculatedMember("Time in zone %", {
      formula: `
        CASE WHEN ([Measures].[Time in zone], [Heart rate zone].DefaultMember) > 0 THEN
          [Measures].[Time in zone] / ([Measures].[Time in zone], [Heart rate zone].DefaultMember)
        END`,
      formatString: "#,##0.0%"
    });

    var activityProperties = {group: "Activity properties"};
    [
      ["Activity start time", "Start time"],
      ["Activity route name", "Route name"],
      ["Activity notes", "Notes"],
      ["Activity friends", "Friends"],
      ["Activity GPX file", "GPX file"],
      ["Activity UTC offset", "UTC offset"]
    ].forEach((property) => {
      c.calculatedMember(property[0], {
        formula: `[Activity].CurrentHierarchyMember.get('${property[1]}')`,
        annotations: activityProperties
      });
    });
  });
});
