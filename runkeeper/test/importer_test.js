// The fixtures are synthetic Runkeeper exports, made up for the tests:
//
// runkeeper_export.zip — cardioActivities.csv with four activities, heartRate.csv, two GPX files:
//   a1 2026-09-24 07:03 Running 2.05 km in 10:15, at +03:00. Its GPX track has two segments with a pause and
//      a gap of 30 m between them, 50 m every 15 s, the heart rate of every point, and climbs 24 m. Friends
//      Anna and Ben. heartRate.csv: every 5 s from 0 to 60 s at 150..162 bpm, then 180 bpm at 180 s.
//   a2 2026-08-10 18:30 Running 2.20 km in 12:01, at -05:00, route Park loop. Its GPX track has no heart
//      rate and a jump of the GPS position of 200 m in 5 s in the first kilometer.
//   a3 2025-12-31 23:50 Running 10.00 km in 1:05:00, average heart rate 160, no GPX file. heartRate.csv:
//      every 10 s from 0 to 60 s at 120 bpm.
//   a4 2025-06-01 09:00 Cycling 42.50 km in 1:30:00, friend Ben. Its GPX file is missing from the export.
//   a5 2026-09-25 09:21 Running 1.66 km in 12:55:45 — the tracking was left running after a run, so its
//      average speed of 0.13 km/h is implausible. No GPX file.
// runkeeper_export_without_august.zip — the next export: a2 was deleted, there is no heartRate.csv, and the
//   files are in an export/ directory of the archive.
// runkeeper_export_with_skipped_maximum.zip — runkeeper_export.zip with the heart rates of the skipped a5 in
//   heartRate.csv: 195 bpm at 0 s and 200 bpm at 5 s, the highest heart rate of the export.
// runkeeper_export_with_duplicate_name.zip — runkeeper_export.zip with a6 2025-12-31 23:50:41 Running 10.004 km
//   in 1:04:30, no GPX file, whose member name is the same as that of a3.
// not_runkeeper.zip — a ZIP file of a readme.txt.
const EXPORT_URL = "https://files.example.com/runkeeper-export.zip";

function mockExport(fixture) {
  mock.sourceParams({export_url: EXPORT_URL});
  mock.get(EXPORT_URL, {fixture: fixture, headers: {"Content-Type": "application/zip"}});
}

function activityRows() {
  return dwh.measures.activities.rows({
    columns: ["_source_id", "distance_km", "duration_seconds", "max_heart_rate", "fastest_km_seconds",
      "heart_beats", "heart_rate_seconds", "climb_m"],
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

describe("app.importer.importAll", () => {
  describe("of an export", () => {
    beforeAll(() => {
      mockExport("runkeeper_export.zip");
      importRun.run();
    });

    test("imports every activity as a member", () => {
      expect(dwh.dimensions.activities.rows({
        columns: ["activity_key", "name", "start_time", "route_name", "friends", "gpx_file", "utc_offset"],
        orderBy: "activity_key"
      })).toEqual([
        {activity_key: "a1", name: "2026-09-24 07:03 Running 2.05 km", start_time: "2026-09-24 07:03",
         route_name: null, friends: "Anna, Ben", gpx_file: "2026-09-24-070332.gpx", utc_offset: "+03:00"},
        {activity_key: "a2", name: "2026-08-10 18:30 Running 2.20 km", start_time: "2026-08-10 18:30",
         route_name: "Park loop", friends: null, gpx_file: "2026-08-10-183000.gpx", utc_offset: "-05:00"},
        {activity_key: "a3", name: "2025-12-31 23:50 Running 10.00 km", start_time: "2025-12-31 23:50",
         route_name: null, friends: null, gpx_file: null, utc_offset: null},
        {activity_key: "a4", name: "2025-06-01 09:00 Cycling 42.50 km", start_time: "2025-06-01 09:00",
         route_name: null, friends: "Ben", gpx_file: "2025-06-01-090000.gpx", utc_offset: null}
      ]);
    });

    test("imports one row per activity, by the month of the activity", () => {
      var rows = activityRows();
      expect(rows.map((row) => row._source_id)).toEqual(["2025-06", "2025-12", "2026-08", "2026-09"]);
      expect(rows[3]).toMatchObject({duration_seconds: 615, max_heart_rate: 180, fastest_km_seconds: 300,
        heart_rate_seconds: 615});
      expect(rows[3].distance_km).toBeCloseTo(2.05, 3);
      expect(rows[3].heart_beats).toBeCloseTo(1588.8, 1);
      expect(rows[2]).toMatchObject({duration_seconds: 721, max_heart_rate: null, fastest_km_seconds: 330,
        heart_beats: null, heart_rate_seconds: null});
      expect(rows[1]).toMatchObject({duration_seconds: 3900, max_heart_rate: 120, fastest_km_seconds: null,
        heart_rate_seconds: 3900});
      expect(rows[0]).toMatchObject({duration_seconds: 5400, max_heart_rate: null, fastest_km_seconds: null});
    });

    test("imports the kilometer splits of the GPX tracks", () => {
      // The heart rate of the splits is the heart rate of the track points.
      expect(splitRows("2026-09")).toEqual([[1000, 300, 20, 747.5], [1000, 300, 4, 841.5], [50, 15, 0, 42.5]]);
      expect(splitRows("2026-08")).toEqual([[1000, 325, 0, null], [1000, 330, 0, null], [200, 66, 0, null]]);
      expect(splitRows("2025-06")).toEqual([]);
    });

    test("imports the time in the heart rate zones of the highest heart rate", () => {
      var zones = _.object(dwh.dimensions.heart_rate_zones.rows({columns: ["id", "name"]}).
        map((zone) => [zone.id, zone.name]));
      var rows = dwh.measures.heart_rate_zones.rows({columns: ["_source_id", "heart_rate_zone_id", "zone_seconds"]});
      expect(_.sortBy(rows.map((row) => [row._source_id, zones[row.heart_rate_zone_id], row.zone_seconds]), (row) => row.join())).
        toEqual([
          ["2025-12", "Zone 2 (60-70%)", 60],
          ["2026-09", "Zone 4 (80-90%)", 60],
          ["2026-09", "Zone 5 (90-100%)", 30]
        ]);
    });

    test("imports the dimension members of the activities", () => {
      expect(dwh.dimensions.activity_types.rows({columns: ["name"], orderBy: "name"})).
        toEqual([{name: "Cycling"}, {name: "Running"}]);
      expect(dwh.dimensions.friends.rows({columns: ["name"], orderBy: "name"})).
        toEqual([{name: "(none)"}, {name: "Anna"}, {name: "Ben"}]);
      expect(dwh.dimensions.hours.rows()).toHaveLength(24);
      expect(dwh.dimensions.kilometers.rows({columns: ["number", "name"], orderBy: "number"})).
        toEqual([{number: 1, name: "Km 1"}, {number: 2, name: "Km 2"}, {number: 3, name: "Km 3"}]);
    });

    test("skips the implausible activity with a warning", () => {
      expect(dwh.dimensions.activities.rows({columns: ["activity_key"]}).map((row) => row.activity_key)).
        not.toContain("a5");
      var warning = activityWarning("2026-09-25 09:21 Running 1.66 km was skipped");
      expect(warning.message).toContain("0.13 km/h is below the 1 km/h");
    });

    test("warns about the GPX file which is missing from the export", () => {
      expect(activityWarning("2025-06-01-090000.gpx")).toBeDefined();
      expect(importRun.objectFailures()).toEqual([]);
    });

    test("stores the months of the rows", () => {
      expect(JSON.parse(importRun.maxParams().months)).toEqual({"2025": 2080, "2026": 384});
    });
  });

  describe("of the next export", () => {
    test("removes the rows of a deleted activity and of its month", () => {
      mockExport("runkeeper_export.zip");
      importRun.run();
      mock.maxParams(importRun.maxParams());
      mockExport("runkeeper_export_without_august.zip");

      importRun.run();

      expect(activityRows().map((row) => row._source_id)).toEqual(["2025-06", "2025-12", "2026-09"]);
      expect(splitRows("2026-08")).toEqual([]);
      expect(splitRows("2026-09")).toHaveLength(3);
      expect(JSON.parse(importRun.maxParams().months)).toEqual({"2025": 2080, "2026": 256});
    });

    test("reads the heart rate of the track points when the export has no heartRate.csv", () => {
      mockExport("runkeeper_export_without_august.zip");

      importRun.run();

      var rows = activityRows();
      expect(rows[2].max_heart_rate).toBe(170);
      expect(rows[1].max_heart_rate).toBeNull();
      expect(dwh.measures.heart_rate_zones.rows({columns: ["_source_id"]}).map((row) => row._source_id)).
        not.toContain("2025-12");
    });
  });

  describe("with the Maximum heart rate option", () => {
    test("sets the zones by the option", () => {
      mockExport("runkeeper_export.zip");
      mock.extraOptions({max_heart_rate: 200});

      importRun.run();

      var zones = _.object(dwh.dimensions.heart_rate_zones.rows({columns: ["id", "name"]}).
        map((zone) => [zone.id, zone.name]));
      var rows = dwh.measures.heart_rate_zones.rows({columns: ["_source_id", "heart_rate_zone_id", "zone_seconds"]}).
        filter((row) => row._source_id === "2026-09");
      expect(_.sortBy(rows.map((row) => [zones[row.heart_rate_zone_id], row.zone_seconds]), (row) => row[0])).
        toEqual([["Zone 3 (70-80%)", 50], ["Zone 4 (80-90%)", 40]]);
    });
  });

  describe("of an export whose highest heart rate is of a skipped activity", () => {
    test("sets the zones by the highest heart rate of the export", () => {
      mockExport("runkeeper_export_with_skipped_maximum.zip");

      importRun.run();

      var zones = _.object(dwh.dimensions.heart_rate_zones.rows({columns: ["id", "name"]}).
        map((zone) => [zone.id, zone.name]));
      var rows = dwh.measures.heart_rate_zones.rows({columns: ["_source_id", "heart_rate_zone_id", "zone_seconds"]}).
        filter((row) => row._source_id === "2026-09");
      expect(_.sortBy(rows.map((row) => [zones[row.heart_rate_zone_id], row.zone_seconds]), (row) => row[0])).
        toEqual([["Zone 3 (70-80%)", 50], ["Zone 4 (80-90%)", 40]]);
      expect(activityRows().map((row) => row.max_heart_rate)).not.toContain(200);
    });
  });

  describe("of two activities with the same member name", () => {
    test("appends the activity id to both names, once also after the next import", () => {
      mockExport("runkeeper_export_with_duplicate_name.zip");
      importRun.run();
      mock.maxParams(importRun.maxParams());

      importRun.run();

      expect(dwh.dimensions.activities.rows({columns: ["activity_key", "name"], orderBy: "activity_key"})).
        toEqual([
          {activity_key: "a1", name: "2026-09-24 07:03 Running 2.05 km"},
          {activity_key: "a2", name: "2026-08-10 18:30 Running 2.20 km"},
          {activity_key: "a3", name: "2025-12-31 23:50 Running 10.00 km (a3)"},
          {activity_key: "a4", name: "2025-06-01 09:00 Cycling 42.50 km"},
          {activity_key: "a6", name: "2025-12-31 23:50 Running 10.00 km (a6)"}
        ]);
    });
  });

  describe("of a GPX file without track points", () => {
    test("imports its activity without splits with a warning", () => {
      mockExport("runkeeper_export.zip");
      mock.spyOn(app.api, "readTrackLines").mockReturnValue(["<gpx><trk><trkseg>", "</trkseg></trk></gpx>"]);

      importRun.run();

      expect(activityRows().map((row) => row._source_id)).toContain("2026-09");
      expect(splitRows("2026-09")).toEqual([]);
      expect(activityWarning("The GPX file 2026-09-24-070332.gpx of the activity 2026-09-24 07:03 Running 2.05 km " +
        "has no track points")).toBeDefined();
    });
  });

  describe("of the warnings of the earlier imports", () => {
    test("clears the ones which the import did not add again at its end", () => {
      // Also the warning of an activity deleted since, which no later export has: the warnings of the
      // activities share one key, which is cleared after every warning of the import was added.
      mockExport("runkeeper_export.zip");
      var calls = [];
      mock.spyOn(source.warnings, "add").mockImplementation((key) => calls.push(["add", key]));
      mock.spyOn(source.warnings, "clearOld").mockImplementation((key) => calls.push(["clearOld", key]));

      importRun.run();

      // The skipped a5 and the missing GPX file of a4.
      expect(calls).toEqual([["add", "activities"], ["add", "activities"], ["clearOld", "activities"]]);
    });
  });

  describe("without the Skip implausible activities option", () => {
    test("imports the implausible activity too", () => {
      mockExport("runkeeper_export.zip");
      mock.extraOptions({skip_implausible_activities: false});

      importRun.run();

      var rows = activityRows();
      expect(rows.map((row) => row._source_id)).toEqual(["2025-06", "2025-12", "2026-08", "2026-09", "2026-09"]);
      expect(_.pluck(rows, "duration_seconds")).toContain(46545);
      expect(activityWarning("2026-09-25 09:21 Running 1.66 km")).toBeUndefined();
    });
  });

  describe("of a file which is no export", () => {
    test("fails with the reason", () => {
      mockExport("not_runkeeper.zip");
      expect(() => importRun.run()).toThrow("not a Runkeeper data export");
    });
  });
});
