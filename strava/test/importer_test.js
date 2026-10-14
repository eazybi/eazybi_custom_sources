// The fixtures are synthetic Strava exports, made up for the tests. activities.csv has the 103 columns of a
// real export, with only the cells filled which an activity of its kind has. The titles are Morning Run,
// Night Ride, Evening Walk, Workout, Glitch and Lunch Run in the order of the activities:
//
// strava_export.zip — six activities, general_preferences.csv with the Maximum Heartrate 210, contacts.csv,
// and the activity files:
//   1001 Sep 24, 2026, 4:03:32 AM UTC Run 2050 m in 615 s of moving time, 675 s elapsed, gear Trail shoes,
//        max heart rate 180 (175 in the later column), average heart rate 155. 1001.gpx has one segment:
//        1000 m at 150 bpm, 10 m every 3 s, climbing 24 m, a pause of 60 s, then 1050 m at 170 bpm.
//   1002 Aug 10, 2026, 11:30:00 PM UTC Ride 20 km in 2400 s, gear Road bike, average power 180 W, max speed
//        12.5 m/s, no heart rate. 1002.fit.gz has a point at 125 bpm before the GPS fix, then 1500 m at
//        130 bpm, 50 m every 5 s, climbing 20 m in the first km, a stop of the timer for 120 s, and 1000 m at
//        150 bpm, with one point without a heart rate.
//   1003 Dec 31, 2025, 10:50:00 PM UTC Walk 3 km in 1800 s, no gear, average heart rate 100. 1003.tcx.gz has
//        10 m every 6 s at 100 bpm.
//   1004 Jun 1, 2025, 9:00:00 AM UTC Workout of no distance, 1800 s. 1004.gpx has no track points.
//   1005 Sep 25, 2026, 6:21:00 AM UTC Walk 1022 m in 1 s — a jump of the GPS position, implausible — with
//        the max heart rate 200, the highest of the export. No file.
//   1006 Jan 15, 2026, 6:00:00 AM UTC Run 5 km in 1500 s, gear Trail shoes. Its file 1006.gpx is missing from
//        the activities directory; a media/1006.gpx is no activity file.
// strava_export_without_august.zip — the next export: 1002 was deleted, there is no general_preferences.csv,
//   and the files are in an export_123/ directory of the archive.
// strava_export_with_duplicate_name.zip — strava_export.zip with 1007 Jan 15, 2026, 6:00:40 AM UTC Run
//   Lunch Run 5000.4 m in 1490 s, whose member name is the same as that of 1006.
// not_strava.zip — a ZIP file of a readme.txt.
const EXPORT_URL = "https://files.example.com/strava-export.zip";

function mockExport(fixture) {
  mock.sourceParams({export_url: EXPORT_URL});
  mock.get(EXPORT_URL, {fixture: fixture, headers: {"Content-Type": "application/zip"}});
}

function activityRows() {
  return dwh.measures.activities.rows({
    columns: ["_source_id", "distance_km", "moving_seconds", "elapsed_seconds", "max_heart_rate", "fastest_km_seconds",
      "heart_beats", "heart_rate_seconds", "energy_joules", "power_seconds", "max_speed_kmh", "steps"],
    orderBy: "_source_id"
  });
}

// The warning of the activities whose message contains the text.
function activityWarning(text) {
  return _.find(importRun.warnings(), (candidate) =>
    candidate.key === app.importers.activities.WARNING_KEY && candidate.message.indexOf(text) >= 0);
}

function splitRows(month) {
  var rows = dwh.measures.splits.rows({
    columns: ["_source_id", "split_distance_m", "split_seconds", "split_elevation_gain_m", "split_heart_beats"]
  }).filter((row) => row._source_id === month);
  return _.sortBy(rows, (row) => -row.split_distance_m * 10000 + row.split_seconds).map((row) => [
    Math.round(row.split_distance_m), Math.round(row.split_seconds), Math.round(row.split_elevation_gain_m),
    row.split_heart_beats === null ? null : Math.round(row.split_heart_beats * 10) / 10
  ]);
}

// [month, zone name, seconds] of the heart rate zone rows.
function zoneRows() {
  var zones = _.object(dwh.dimensions.heart_rate_zones.rows({columns: ["id", "name"]}).
    map((zone) => [zone.id, zone.name]));
  var rows = dwh.measures.heart_rate_zones.rows({columns: ["_source_id", "heart_rate_zone_id", "zone_seconds"]});
  return _.sortBy(rows.map((row) => [row._source_id, zones[row.heart_rate_zone_id], row.zone_seconds]),
    (row) => row.join());
}

function activityNames() {
  return dwh.dimensions.activities.rows({columns: ["activity_key", "name"], orderBy: "activity_key"});
}

describe("app.importer.importAll", () => {
  describe("of an export", () => {
    beforeAll(() => {
      mockExport("strava_export.zip");
      importRun.run();
    });

    test("imports every plausible activity as a member", () => {
      expect(dwh.dimensions.activities.rows({
        columns: ["activity_key", "name", "start_time", "title", "description", "activity_file", "strava_url"],
        orderBy: "activity_key"
      })).toEqual([
        {activity_key: "1001", name: "2026-09-24 04:03 Morning Run", start_time: "2026-09-24 04:03",
         title: "Morning Run", description: "Easy run\nwith a stop", activity_file: "1001.gpx",
         strava_url: "https://www.strava.com/activities/1001"},
        {activity_key: "1002", name: "2026-08-10 23:30 Night Ride", start_time: "2026-08-10 23:30",
         title: "Night Ride", description: null, activity_file: "1002.fit.gz",
         strava_url: "https://www.strava.com/activities/1002"},
        {activity_key: "1003", name: "2025-12-31 22:50 Evening Walk", start_time: "2025-12-31 22:50",
         title: "Evening Walk", description: null, activity_file: "1003.tcx.gz",
         strava_url: "https://www.strava.com/activities/1003"},
        {activity_key: "1004", name: "2025-06-01 09:00 Workout", start_time: "2025-06-01 09:00",
         title: "Workout", description: null, activity_file: "1004.gpx",
         strava_url: "https://www.strava.com/activities/1004"},
        {activity_key: "1006", name: "2026-01-15 06:00 Lunch Run", start_time: "2026-01-15 06:00",
         title: "Lunch Run", description: null, activity_file: "1006.gpx",
         strava_url: "https://www.strava.com/activities/1006"}
      ]);
    });

    test("imports one row per activity, by the month of the activity", () => {
      var rows = activityRows();
      expect(rows.map((row) => row._source_id)).toEqual(["2025-06", "2025-12", "2026-01", "2026-08", "2026-09"]);
      expect(rows[4]).toMatchObject({moving_seconds: 615, elapsed_seconds: 675, max_heart_rate: 180,
        fastest_km_seconds: 300, heart_rate_seconds: 615, energy_joules: null, steps: 1900});
      expect(rows[4].distance_km).toBeCloseTo(2.05, 3);
      expect(rows[4].heart_beats).toBeCloseTo(1588.8, 1);
      expect(rows[3]).toMatchObject({moving_seconds: 2400, max_heart_rate: 150, fastest_km_seconds: 100,
        heart_beats: null, power_seconds: 2400});
      expect(rows[3].energy_joules).toBeCloseTo(432000, 1);
      expect(rows[3].max_speed_kmh).toBeCloseTo(45, 2);
      expect(rows[1]).toMatchObject({moving_seconds: 1800, max_heart_rate: 100, fastest_km_seconds: 600,
        heart_rate_seconds: 1800});
      expect(rows[0]).toMatchObject({moving_seconds: 1800, fastest_km_seconds: null});
      expect(rows[0].distance_km).toBe(0);
    });

    test("imports the kilometer splits of the GPX, TCX and FIT tracks without the pause", () => {
      expect(splitRows("2026-09")).toEqual([[1000, 300, 24, 750], [1000, 300, 0, 850], [50, 15, 0, 42.5]]);
      expect(splitRows("2025-12")).toEqual([[1000, 600, 0, 1000], [1000, 600, 0, 1000], [1000, 600, 0, 1000]]);
      expect(splitRows("2026-08")).toEqual([[1000, 100, 20, 216.7], [1000, 100, 0, 233.3], [500, 50, 0, 125]]);
      expect(splitRows("2025-06")).toEqual([]);
    });

    test("imports the time in the heart rate zones of the maximum heart rate of the Strava settings", () => {
      // 100 bpm is 47.6% of 210 bpm, and it would be 50% of the 200 bpm of the export.
      expect(zoneRows()).toEqual([
        ["2025-12", "Below zone 1", 1800],
        ["2026-08", "Zone 2 (60-70%)", 150],
        ["2026-08", "Zone 3 (70-80%)", 95],
        ["2026-09", "Zone 3 (70-80%)", 300],
        ["2026-09", "Zone 4 (80-90%)", 315]
      ]);
    });

    test("imports the dimension members of the activities", () => {
      expect(dwh.dimensions.activity_types.rows({columns: ["name"], orderBy: "name"})).
        toEqual([{name: "Ride"}, {name: "Run"}, {name: "Walk"}, {name: "Workout"}]);
      expect(dwh.dimensions.gears.rows({columns: ["name"], orderBy: "name"})).
        toEqual([{name: "(none)"}, {name: "Road bike"}, {name: "Trail shoes"}]);
      expect(dwh.dimensions.hours.rows()).toHaveLength(24);
      expect(dwh.dimensions.kilometers.rows({columns: ["number", "name"], orderBy: "number"})).
        toEqual([{number: 1, name: "Km 1"}, {number: 2, name: "Km 2"}, {number: 3, name: "Km 3"}]);
    });

    test("skips the implausible activity with a warning", () => {
      expect(activityNames().map((row) => row.activity_key)).not.toContain("1005");
      expect(activityWarning("2026-09-25 06:21 Glitch was skipped").message).
        toContain("3679.20 km/h is above the 15 km/h");
    });

    test("warns about the file which is missing from the export", () => {
      expect(activityWarning("The file 1006.gpx of the activity 2026-01-15 06:00 Lunch Run is not in the export").
        message).toContain("no kilometer splits and no time in the heart rate zones");
      expect(importRun.objectFailures()).toEqual([]);
    });

    test("stores the months of the rows", () => {
      expect(JSON.parse(importRun.maxParams().months)).toEqual({"2025": 2080, "2026": 385});
    });
  });

  describe("of the next export", () => {
    test("removes the rows of a deleted activity and of its month", () => {
      mockExport("strava_export.zip");
      importRun.run();
      mock.maxParams(importRun.maxParams());
      mockExport("strava_export_without_august.zip");

      importRun.run();

      expect(activityRows().map((row) => row._source_id)).toEqual(["2025-06", "2025-12", "2026-01", "2026-09"]);
      expect(splitRows("2026-09")).toHaveLength(3);
      expect(JSON.parse(importRun.maxParams().months)).toEqual({"2025": 2080, "2026": 257});
    });

    test("sets the zones by the highest heart rate of the export without the Strava settings", () => {
      // 200 bpm of the skipped 1005: an implausible speed is a mistake of the GPS, not of the monitor.
      mockExport("strava_export_without_august.zip");

      importRun.run();

      expect(zoneRows()).toEqual([
        ["2025-12", "Zone 1 (50-60%)", 1800],
        ["2026-09", "Zone 3 (70-80%)", 300],
        ["2026-09", "Zone 4 (80-90%)", 315]
      ]);
      expect(activityRows().map((row) => row.max_heart_rate)).not.toContain(200);
    });
  });

  describe("with the Maximum heart rate option", () => {
    test("sets the zones by the option", () => {
      mockExport("strava_export.zip");
      mock.extraOptions({max_heart_rate: 160});

      importRun.run();

      expect(zoneRows()).toEqual([
        ["2025-12", "Zone 2 (60-70%)", 1800],
        ["2026-08", "Zone 4 (80-90%)", 150],
        ["2026-08", "Zone 5 (90-100%)", 95],
        ["2026-09", "Zone 5 (90-100%)", 615]
      ]);
    });
  });

  describe("with a Time dimension time zone", () => {
    test("imports the activities on their local date and hour", () => {
      mockExport("strava_export.zip");
      mock.extraOptions({time_dimension_time_zone: "Europe/Riga"});

      importRun.run();

      var names = activityNames().map((row) => row.name);
      expect(names).toContain("2026-08-11 02:30 Night Ride");
      expect(names).toContain("2026-01-01 00:50 Evening Walk");
      expect(activityRows().map((row) => row._source_id)).toEqual(["2025-06", "2026-01", "2026-01", "2026-08", "2026-09"]);
    });
  });

  describe("of two activities with the same member name", () => {
    test("appends the activity id to both names, once also after the next import", () => {
      mockExport("strava_export_with_duplicate_name.zip");
      importRun.run();
      mock.maxParams(importRun.maxParams());

      importRun.run();

      var names = activityNames().filter((row) => ["1006", "1007"].indexOf(row.activity_key) >= 0);
      expect(names).toEqual([
        {activity_key: "1006", name: "2026-01-15 06:00 Lunch Run (1006)"},
        {activity_key: "1007", name: "2026-01-15 06:00 Lunch Run (1007)"}
      ]);
    });
  });

  describe("of an activity file which can not be read", () => {
    test("imports its activity without splits with an object failure", () => {
      mockExport("strava_export.zip");
      mock.spyOn(app.api, "readActivityFileLines").mockImplementation(() => { throw new Error("broken file"); });

      importRun.run();

      expect(activityRows().map((row) => row._source_id)).toContain("2026-09");
      expect(splitRows("2026-09")).toEqual([]);
      expect(activityWarning("The file 1001.gpx of the activity 2026-09-24 04:03 Morning Run could not be read: " +
        "broken file")).toBeDefined();
    });

    test("imports the activity without splits when its FIT file can not be decoded", () => {
      mockExport("strava_export.zip");
      mock.spyOn(app.api, "readActivityFileBytes").mockImplementation(() => new Uint8Array([1, 2, 3]));

      importRun.run();

      expect(splitRows("2026-08")).toEqual([]);
      expect(activityWarning("The file 1002.fit.gz of the activity 2026-08-10 23:30 Night Ride could not be read: " +
        "it is not a FIT file")).toBeDefined();
    });
  });

  describe("of the warnings of the earlier imports", () => {
    test("clears the ones which the import did not add again at its end", () => {
      mockExport("strava_export.zip");
      var calls = [];
      mock.spyOn(source.warnings, "add").mockImplementation((key) => calls.push(["add", key]));
      mock.spyOn(source.warnings, "clearOld").mockImplementation((key) => calls.push(["clearOld", key]));

      importRun.run();

      // The missing 1006.gpx and the skipped 1005.
      expect(calls).toEqual([["add", "activities"], ["add", "activities"], ["clearOld", "activities"]]);
    });
  });

  describe("without the Skip implausible activities option", () => {
    test("imports the implausible activity too", () => {
      mockExport("strava_export.zip");
      mock.extraOptions({skip_implausible_activities: false});

      importRun.run();

      expect(activityNames().map((row) => row.activity_key)).toContain("1005");
      expect(activityWarning("2026-09-25 06:21 Glitch")).toBeUndefined();
    });
  });

  describe("of an export with an empty activities.csv", () => {
    test("fails and keeps the rows of the previous import", () => {
      mockExport("strava_export.zip");
      importRun.run();
      mock.maxParams(importRun.maxParams());
      mock.spyOn(app.api, "readActivityRows").mockImplementation(() => {});

      expect(() => importRun.run()).toThrow("The activities.csv file of the export is empty.");
      expect(activityRows()).toHaveLength(5);
    });
  });

  describe("of a file which is no export", () => {
    test("fails with the reason", () => {
      mockExport("not_strava.zip");
      expect(() => importRun.run()).toThrow("not a Strava account export");
    });
  });
});
