// A shortened activities.csv header with the repeated column names in the order of a Strava export.
const HEADER = [
  "Activity ID", "Activity Date", "Activity Name", "Activity Type", "Activity Description", "Elapsed Time",
  "Distance", "Max Heart Rate", "Relative Effort", "Commute", "Activity Gear", "Filename", "Elapsed Time",
  "Moving Time", "Distance", "Max Speed", "Elevation Gain", "Max Heart Rate", "Average Heart Rate",
  "Average Watts", "Calories", "Relative Effort", "Commute", "Total Steps"
];

// The cells of a row of the header, from {name: value} of the first occurrence of a column name and
// {"name#last": value} of the last one.
function activityCells(values) {
  var all = _.extend({
    "Activity ID": "1001",
    "Activity Date": "Sep 24, 2026, 4:03:32 AM",
    "Activity Name": "Morning Run",
    "Activity Type": "Run",
    "Elapsed Time": "675",
    "Distance": "2.05",
    "Max Heart Rate": "180.0",
    "Relative Effort": "25",
    "Activity Gear": "Trail shoes",
    "Filename": "activities/1001.gpx",
    "Elapsed Time#last": "675.0",
    "Moving Time": "615.0",
    "Distance#last": "2050.0",
    "Max Speed": "4.5",
    "Elevation Gain": "24.0",
    "Max Heart Rate#last": "175.0",
    "Average Heart Rate": "155.0",
    "Calories": "150.0",
    "Total Steps": "1900.0"
  }, values);
  var cells = HEADER.map(() => "");
  _.keys(all).forEach((key) => {
    var last = /#last$/.test(key), name = key.replace(/#last$/, "");
    cells[last ? HEADER.lastIndexOf(name) : HEADER.indexOf(name)] = all[key];
  });
  return cells;
}

function build(values) {
  var activities = app.importers.activities;
  return activities.build(activityCells(values), activities.resolveColumns(HEADER));
}

describe("app.importers.activities.resolveColumns", () => {
  test("reads the meters and seconds of the later Distance and Elapsed Time, the first Max Heart Rate", () => {
    var columns = app.importers.activities.resolveColumns(HEADER);

    expect(columns).toMatchObject({id: 0, distance: 14, elapsed: 12, elapsedDisplay: 5, maxHeartRate: 7,
      relativeEffort: 8, moving: 13});
  });

  test("fails with the missing columns of a file which is no activities.csv of a Strava export", () => {
    expect(() => app.importers.activities.resolveColumns(["Activity Id", "Date", "Type", "Distance (km)"])).
      toThrow("is not from a Strava account export: it has no Activity ID, Activity Date, Activity Type, " +
        "second Distance column");
  });

  test("tells to request the export in English for a header in another language", () => {
    // Made up column names: Strava names the columns in the language of the account.
    var header = HEADER.map((name) => `${name} (de)`);

    expect(() => app.importers.activities.resolveColumns(header)).
      toThrow("set the language to English in the Strava settings under Display Preferences");
  });

  test("fails for a header with one Distance, which is in the display unit and not in meters", () => {
    var header = HEADER.filter((name, index) => name !== "Distance" || index === HEADER.indexOf("Distance"));

    expect(() => app.importers.activities.resolveColumns(header)).toThrow("it has no second Distance column");
  });

  test("reads the only Elapsed Time of a header with one as the display text", () => {
    var header = HEADER.filter((name, index) => name !== "Elapsed Time" || index === HEADER.indexOf("Elapsed Time"));
    var columns = app.importers.activities.resolveColumns(header);

    expect(columns.elapsed).toBeUndefined();
    expect(columns.elapsedDisplay).toBe(5);
  });
});

describe("app.importers.activities.build", () => {
  test("parses the values of an activity", () => {
    expect(build({})).toEqual({
      id: "1001",
      startUtc: "2026-09-24T04:03:32Z",
      start: {datetime: "2026-09-24 04:03:32", date: "2026-09-24", time: "04:03", hour: 4, month: "2026-09"},
      type: "Run",
      title: "Morning Run",
      description: null,
      gear: "Trail shoes",
      fileName: "1001.gpx",
      distanceKm: 2.05,
      movingSeconds: 615,
      elapsedSeconds: 675,
      elevationGainM: 24,
      maxSpeedKmh: 16.2,
      averageHeartRate: 155,
      maxHeartRate: 180,
      relativeEffort: 25,
      calories: 150,
      steps: 1900,
      averageWatts: null
    });
  });

  test("reads the meters of the later Distance, not the display unit of the first one", () => {
    // An athlete who chose miles: 2.05 km is 1.27 mi in the first Distance.
    expect(build({"Distance": "1.27"}).distanceKm).toBe(2.05);
  });

  test("reads the first Elapsed Time when the later one is empty, also as a display text", () => {
    expect(build({"Elapsed Time#last": "", "Elapsed Time": "11:15"}).elapsedSeconds).toBe(675);
    expect(build({"Elapsed Time#last": "", "Elapsed Time": "675"}).elapsedSeconds).toBe(675);
  });

  test("starts the activity in the Time dimension time zone", () => {
    mock.extraOptions({time_dimension_time_zone: "Europe/Riga"});

    expect(build({"Activity Date": "Dec 31, 2025, 10:50:00 PM"}).start).
      toEqual({datetime: "2026-01-01 00:50:00", date: "2026-01-01", time: "00:50", hour: 0, month: "2026-01"});
  });

  test("reads the hours of the morning and the afternoon", () => {
    expect(build({"Activity Date": "Jan 5, 2026, 12:10:00 AM"}).startUtc).toBe("2026-01-05T00:10:00Z");
    expect(build({"Activity Date": "Jan 5, 2026, 12:10:00 PM"}).startUtc).toBe("2026-01-05T12:10:00Z");
    expect(build({"Activity Date": "Jan 5, 2026, 1:10:00 PM"}).startUtc).toBe("2026-01-05T13:10:00Z");
  });

  test("skips a row without an id or a valid date", () => {
    expect(build({"Activity ID": ""})).toBeNull();
    ["yesterday", "Feb 31, 2026, 4:03:32 AM", "Sep 24, 2026, 13:03:32 PM", "Foo 24, 2026, 4:03:32 AM"].
      forEach((date) => expect(build({"Activity Date": date})).toBeNull());
  });

  test("leaves the missing values and the heart rates of a monitor error empty", () => {
    var activity = build({"Max Heart Rate": "", "Average Heart Rate": "255", "Filename": "", "Activity Type": "",
      "Activity Gear": "", "Total Steps": "0.0", "Average Watts": "0.0"});

    expect(activity).toMatchObject({maxHeartRate: null, averageHeartRate: null, fileName: null, type: "Other",
      gear: null, steps: null, averageWatts: null});
  });
});

describe("app.importers.activities.memberName", () => {
  test("names the activity by its start and title", () => {
    expect(app.importers.activities.memberName(build({}))).toBe("2026-09-24 04:03 Morning Run");
  });

  test("names an activity without a title by its type and distance", () => {
    var memberName = (values) => app.importers.activities.memberName(build(values));

    expect(memberName({"Activity Name": ""})).toBe("2026-09-24 04:03 Run 2.05 km");
    expect(memberName({"Activity Name": "", "Distance#last": ""})).toBe("2026-09-24 04:03 Run");
  });

  test("shortens a long title, so that the name fits its column with the appended activity id", () => {
    var activity = build({"Activity Name": "x".repeat(300)});
    var name = app.importers.activities.memberName(activity);

    expect(activity.title).toHaveLength(255);
    expect(name).toHaveLength(217);
    expect(name.substring(name.length - 2)).toBe("x…");
  });
});

describe("app.importers.activities.implausibility", () => {
  function activity(values) {
    return _.extend(build({}), values);
  }

  test("accepts an activity with the average speed of its type", () => {
    expect(app.importers.activities.implausibility(activity({}))).toBeNull();
    expect(app.importers.activities.implausibility(activity({type: "Ride", distanceKm: 36.32, movingSeconds: 5400}))).
      toBeNull();
  });

  test("rejects a walk of a jump of the GPS position", () => {
    expect(app.importers.activities.implausibility(activity({type: "Walk", distanceKm: 1.022, movingSeconds: 1}))).
      toBe("its average speed 3679.20 km/h is above the 15 km/h of an activity of the type Walk");
  });

  test("uses the elapsed time when Strava counted no moving time", () => {
    expect(app.importers.activities.implausibility(activity({distanceKm: 1.66, movingSeconds: 0,
      elapsedSeconds: 46545}))).toBe("its average speed 0.13 km/h is below the 1 km/h of an activity of the type Run");
  });

  test("does not check a type without a meaningful speed, or an activity without a distance", () => {
    expect(app.importers.activities.implausibility(activity({type: "Workout", distanceKm: 0}))).toBeNull();
    expect(app.importers.activities.implausibility(activity({distanceKm: null}))).toBeNull();
  });
});

describe("app.importers.activities.stravaUrl", () => {
  test("links the activity on Strava", () => {
    expect(app.importers.activities.stravaUrl(build({}))).toBe("https://www.strava.com/activities/1001");
  });
});
