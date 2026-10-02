// The export fixture is described in test/importer_test.js.
const EXPORT_URL = "https://files.example.com/runkeeper-export.zip";

describe("schema", () => {
  test("defines the Runkeeper cube and its dimensions", () => {
    expect(schema.cubes()).toEqual(["Runkeeper"]);
    ["Activity", "Activity type", "Distance range", "Friend", "Heart rate zone", "Hour", "Kilometer", "Time",
      "Week Day"].forEach((name) => expect(schema.dimensions()).toContain(name));
    var properties = schema.dimension("Activity").level("Activity").properties();
    ["Start time", "Route name", "Notes", "Friends", "GPX file", "UTC offset"].
      forEach((name) => expect(properties).toContain(name));
  });

  test("defines the measures of the activities, the splits and the heart rate zones", () => {
    ["Activities", "Distance km", "Duration", "Max heart rate", "Fastest km", "Split distance m", "Split duration",
      "Time in zone"].forEach((name) => expect(schema.measures()).toContain(name));
    ["[Measures].[Average pace]", "[Measures].[Average heart rate]", "[Measures].[Split pace]",
      "[Measures].[Time in zone %]", "[Measures].[Activity start time]", "[Measures].[Activity route name]",
      "[Measures].[Activity notes]", "[Measures].[Activity friends]", "[Measures].[Activity GPX file]",
      "[Measures].[Activity UTC offset]"].
      forEach((name) => expect(schema.calculatedMembers()).toContain(name));
  });
});

describe("olap", () => {
  beforeAll(() => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {fixture: "runkeeper_export.zip", headers: {"Content-Type": "application/zip"}});
    importRun.run();
  });

  // The values of a query rounded to two decimals, against the float noise of the decimal sums.
  function results(mdx) {
    return olap.results(mdx).map((row) =>
      row.map((value) => typeof value === "number" ? Math.round(value * 100) / 100 : value));
  }

  test("aggregates the activities by type", () => {
    expect(results(`
      SELECT {[Measures].[Activities], [Measures].[Distance km], [Measures].[Duration],
              [Measures].[Average pace], [Measures].[Longest distance km]} ON COLUMNS,
             [Activity type].[Activity type].Members ON ROWS
      FROM [Runkeeper]
    `)).toEqual([
      ["Cycling", 1, 42.5, 5400, 127.06, 42.5],
      ["Running", 3, 14.25, 5236, 367.44, 10]
    ]);
  });

  test("weights the average heart rate by the duration", () => {
    // (155 * 615 + 160 * 3900) / (615 + 3900)
    expect(results(`
      SELECT {[Measures].[Average heart rate], [Measures].[Max heart rate], [Measures].[Fastest km]} ON COLUMNS,
             {[Activity type].DefaultMember} ON ROWS
      FROM [Runkeeper]
    `)).toEqual([["All Activity types", 159.32, 180, 300]]);
  });

  test("counts an activity for each tagged friend", () => {
    expect(results(`
      SELECT {[Measures].[Activities]} ON COLUMNS, [Friend].[Friend].Members ON ROWS FROM [Runkeeper]
    `)).toEqual([["(none)", 2], ["Anna", 1], ["Ben", 2]]);
  });

  test("groups the activities by the local hour and the distance range", () => {
    expect(results(`
      SELECT {[Measures].[Activities]} ON COLUMNS,
             Filter([Hour].[Hour].Members, NOT IsEmpty([Measures].[Activities])) ON ROWS
      FROM [Runkeeper]
    `)).toEqual([["07", 1], ["09", 1], ["18", 1], ["23", 1]]);
    expect(results(`
      SELECT {[Measures].[Activities]} ON COLUMNS,
             Filter([Distance range].[Distance range].Members, NOT IsEmpty([Measures].[Activities])) ON ROWS
      FROM [Runkeeper]
    `)).toEqual([["Under 5 km", 2], ["10-21 km", 1], ["42 km and more", 1]]);
  });

  test("puts an activity on its local date", () => {
    expect(results(`
      SELECT {[Measures].[Activities]} ON COLUMNS, Filter([Time].[Day].Members, NOT IsEmpty([Measures].[Activities])) ON ROWS
      FROM [Runkeeper]
    `).map((row) => row[0])).toEqual(["Jun 01 2025", "Dec 31 2025", "Aug 10 2026", "Sep 24 2026"]);
  });

  test("computes the pace of the kilometer splits", () => {
    expect(results(`
      SELECT {[Measures].[Split distance m], [Measures].[Split pace], [Measures].[Split average heart rate]} ON COLUMNS,
             [Kilometer].[Kilometer].Members ON ROWS
      FROM [Runkeeper]
    `)).toEqual([
      ["Km 1", 2000, 312.5, 149.5],
      ["Km 2", 2000, 315, 168.3],
      ["Km 3", 250, 324, 170]
    ]);
  });

  test("computes the share of the time in each heart rate zone", () => {
    expect(results(`
      SELECT {[Measures].[Time in zone], [Measures].[Time in zone %]} ON COLUMNS,
             Filter([Heart rate zone].[Heart rate zone].Members, NOT IsEmpty([Measures].[Time in zone])) ON ROWS
      FROM [Runkeeper]
    `)).toEqual([["Zone 2 (60-70%)", 60, 0.4], ["Zone 4 (80-90%)", 60, 0.4], ["Zone 5 (90-100%)", 30, 0.2]]);
  });

  test("shows the properties of an activity", () => {
    expect(olap.results(`
      SELECT {[Measures].[Activity start time], [Measures].[Activity friends], [Measures].[Activity GPX file],
              [Measures].[Activity UTC offset]} ON COLUMNS,
             {[Activity].[Activity].[2026-09-24 07:03 Running 2.05 km]} ON ROWS
      FROM [Runkeeper]
    `)).toEqual([["2026-09-24 07:03 Running 2.05 km", "2026-09-24 07:03", "Anna, Ben", "2026-09-24-070332.gpx",
      "+03:00"]]);
  });
});
