// A cardioActivities.csv row as source.readDocuments answers it: an empty cell which is not quoted is
// null, a quoted empty cell is "".
function activityRow(values) {
  return _.extend({
    "Activity Id": "a1",
    "Date": "2026-09-24 07:03:32",
    "Type": "Running",
    "Route Name": null,
    "Distance (km)": "4.67",
    "Duration": "28:21",
    "Average Pace": "6:04",
    "Average Speed (km/h)": "9.88",
    "Calories Burned": "370.0",
    "Climb (m)": "14",
    "Average Heart Rate (bpm)": "162",
    "Friend's Tagged": "",
    "Notes": "",
    "GPX File": "2026-09-24-070332.gpx"
  }, values);
}

describe("app.importers.activities.build", () => {
  test("parses the values of an activity", () => {
    var activity = app.importers.activities.build(activityRow({}));

    expect(activity).toMatchObject({
      id: "a1",
      type: "Running",
      routeName: null,
      distanceKm: 4.67,
      durationSeconds: 1701,
      calories: 370,
      climbM: 14,
      averageHeartRate: 162,
      friends: [],
      notes: null,
      gpxFile: "2026-09-24-070332.gpx"
    });
    expect(activity.start).toMatchObject({date: "2026-09-24", time: "07:03", year: 2026, hour: 7});
  });

  test("parses a duration of hours", () => {
    expect(app.importers.activities.build(activityRow({"Duration": "1:13:28"})).durationSeconds).toBe(4408);
  });

  test("leaves out a duration with minutes or seconds out of range", () => {
    var durationSeconds = (duration) => app.importers.activities.build(activityRow({"Duration": duration})).durationSeconds;

    expect(durationSeconds("28:99")).toBeNull();
    expect(durationSeconds("1:72:00")).toBeNull();
    expect(durationSeconds("75:30")).toBe(4530);
  });

  test("leaves the missing values empty", () => {
    var activity = app.importers.activities.build(activityRow({
      "Average Heart Rate (bpm)": null, "Climb (m)": "", "GPX File": "", "Type": null
    }));

    expect(activity.averageHeartRate).toBeNull();
    expect(activity.climbM).toBeNull();
    expect(activity.gpxFile).toBeNull();
    expect(activity.type).toBe("Other");
  });

  test("leaves out the average heart rate of a monitor error", () => {
    expect(app.importers.activities.build(activityRow({"Average Heart Rate (bpm)": "255"})).averageHeartRate).
      toBeNull();
    expect(app.importers.activities.build(activityRow({"Average Heart Rate (bpm)": "29"})).averageHeartRate).
      toBeNull();
  });

  test("reads the tagged friends and the notes", () => {
    var activity = app.importers.activities.build(activityRow({
      "Friend's Tagged": "Anna ,Ben,Anna,", "Notes": " First run ", "Route Name": "Park loop"
    }));

    expect(activity.friends).toEqual(["Anna", "Ben"]);
    expect(activity.notes).toBe("First run");
    expect(activity.routeName).toBe("Park loop");
  });

  test("converts the miles and feet of an account with imperial units", () => {
    var row = activityRow({});
    delete row["Distance (km)"];
    delete row["Climb (m)"];
    row["Distance (mi)"] = "3.10";
    row["Climb (ft)"] = "100";

    var activity = app.importers.activities.build(row);

    expect(activity.distanceKm).toBeCloseTo(4.989, 3);
    expect(activity.climbM).toBeCloseTo(30.5, 1);
  });

  test("skips a row without an id or a valid date", () => {
    expect(app.importers.activities.build(activityRow({"Activity Id": null}))).toBeNull();
    expect(app.importers.activities.build(activityRow({"Date": "yesterday"}))).toBeNull();
  });

  test("skips a row with a date or a time which does not exist, or with more after it", () => {
    ["2026-02-31 07:03:32", "2026-09-24 25:03:32", "2026-09-24 07:99", "2026-09-24 07:03garbage"].
      forEach((date) => expect(app.importers.activities.build(activityRow({"Date": date}))).toBeNull());
    expect(app.importers.activities.build(activityRow({"Date": "2028-02-29 23:59:59"})).start).
      toMatchObject({date: "2028-02-29", time: "23:59", hour: 23});
  });
});

describe("app.importers.activities.memberName", () => {
  test("names the activity by its start, type and distance", () => {
    var activity = app.importers.activities.build(activityRow({}));
    expect(app.importers.activities.memberName(activity)).toBe("2026-09-24 07:03 Running 4.67 km");
  });

  test("leaves the distance out when there is none", () => {
    var activity = app.importers.activities.build(activityRow({"Distance (km)": ""}));
    expect(app.importers.activities.memberName(activity)).toBe("2026-09-24 07:03 Running");
  });
});

describe("app.importers.activities.implausibility", () => {
  function activity(values) {
    return _.extend(app.importers.activities.build(activityRow({})), values);
  }

  test("accepts an activity with the average speed of its type", () => {
    expect(app.importers.activities.implausibility(activity({}))).toBeNull();
    expect(app.importers.activities.implausibility(activity({type: "Cycling", distanceKm: 36.32, durationSeconds: 11655}))).
      toBeNull();
  });

  test("rejects a run whose tracking was left running for hours", () => {
    expect(app.importers.activities.implausibility(activity({distanceKm: 1.66, durationSeconds: 46545}))).
      toBe("its average speed 0.13 km/h is below the 1 km/h of an activity of the type Running");
  });

  test("rejects a run of no distance", () => {
    expect(app.importers.activities.implausibility(activity({distanceKm: 0, durationSeconds: 3600}))).
      toBe("its average speed 0.00 km/h is below the 1 km/h of an activity of the type Running");
  });

  test("accepts a run without a distance or a duration", () => {
    expect(app.importers.activities.implausibility(activity({distanceKm: null}))).toBeNull();
    expect(app.importers.activities.implausibility(activity({distanceKm: 0, durationSeconds: null}))).toBeNull();
  });

  test("rejects a run recorded in a vehicle", () => {
    expect(app.importers.activities.implausibility(activity({distanceKm: 8.18, durationSeconds: 306}))).
      toBe("its average speed 96.24 km/h is above the 30 km/h of an activity of the type Running");
  });

  test("does not check a type without a meaningful speed, or an activity without a distance", () => {
    expect(app.importers.activities.implausibility(activity({type: "Other", distanceKm: 0.1, durationSeconds: 3600}))).
      toBeNull();
    expect(app.importers.activities.implausibility(activity({distanceKm: null}))).toBeNull();
  });
});
