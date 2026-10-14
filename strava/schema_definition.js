app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension,
      weekDayDimension = schema.weekDayDimension, cube = schema.cube;

  // One member per activity, the level that every measure drills through to. The start time is the
  // date and time in the Time dimension time zone, as the Time and Hour dimensions show it.
  dimension("Activity", (d) => {
    d.table("activities");
    d.level((l) => {
      l.string("activity_key", {key: true});
      l.string("name", {name: true, ordinal: true});
      l.string("start_time", {property: "Start time", limit: 16});
      l.string("title", {property: "Title"});
      l.text("description", {property: "Description"});
      l.string("activity_file", {property: "File"});
      l.string("strava_url", {property: "Strava URL"});
    });
  });

  dimension("Activity type", (d) => {
    d.table("activity_types");
    d.level((l) => {
      l.string("name", {key: true, name: true});
    });
  });

  // The shoes or the bike of the activity.
  dimension("Gear", (d) => {
    d.table("gears");
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

  // The hour when the activity started, in the Time dimension time zone.
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
      m.integer("moving_seconds", {name: "Moving time", formatString: "SecondsFormatter"});
      m.integer("elapsed_seconds", {name: "Elapsed time", formatString: "SecondsFormatter"});
      m.decimal("elevation_gain_m", {name: "Elevation gain m", precision: 15, scale: 1, formatString: "#,##0"});
      m.decimal("calories", {name: "Calories", precision: 15, scale: 1, formatString: "#,##0"});
      m.integer("steps", {name: "Steps", formatString: "#,##0"});
      m.decimal("relative_effort", {name: "Relative effort", precision: 15, scale: 1, formatString: "#,##0"});
      m.decimal("max_speed_kmh", {name: "Max speed km/h", precision: 15, scale: 2, aggregator: "max",
        formatString: "#,##0.0"});
      m.integer("max_heart_rate", {name: "Max heart rate", aggregator: "max", formatString: "#,##0"});
      m.integer("fastest_km_seconds", {name: "Fastest km", aggregator: "min", formatString: "SecondsFormatter"});
      // The moving time weighted averages of the heart rate and the power: the heart beats and the energy
      // of the activities, and the moving seconds of the activities with a value.
      m.decimal("heart_beats", {name: "Heart beats", precision: 15, scale: 1, visible: false});
      m.integer("heart_rate_seconds", {name: "Heart rate seconds", visible: false});
      m.decimal("energy_joules", {name: "Energy joules", precision: 18, scale: 1, visible: false});
      m.integer("power_seconds", {name: "Power seconds", visible: false});
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
          [Measures].[Moving time] / [Measures].[Distance km]
        END`,
      formatString: "SecondsFormatter"
    });
    c.calculatedMember("Average speed km/h", {
      formula: `
        CASE WHEN [Measures].[Moving time] > 0 THEN
          [Measures].[Distance km] * 3600 / [Measures].[Moving time]
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
    c.calculatedMember("Average power W", {
      formula: `
        CASE WHEN [Measures].[Power seconds] > 0 THEN
          [Measures].[Energy joules] / [Measures].[Power seconds]
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
      ["Activity title", "Title"],
      ["Activity description", "Description"],
      ["Activity file", "File"],
      ["Activity Strava URL", "Strava URL"]
    ].forEach((property) => {
      c.calculatedMember(property[0], {
        formula: `[Activity].CurrentHierarchyMember.get('${property[1]}')`,
        annotations: activityProperties
      });
    });
  });
});
