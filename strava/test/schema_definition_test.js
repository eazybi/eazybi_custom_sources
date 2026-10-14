// The export fixture is described in test/importer_test.js.
const EXPORT_URL = "https://files.example.com/strava-export.zip";

describe("schema", () => {
  test("defines the Strava cube and its dimensions", () => {
    expect(schema.cubes()).toEqual(["Strava"]);
    ["Activity", "Activity type", "Distance range", "Gear", "Heart rate zone", "Hour", "Kilometer", "Time",
      "Week Day"].forEach((name) => expect(schema.dimensions()).toContain(name));
    var properties = schema.dimension("Activity").level("Activity").properties();
    ["Start time", "Title", "Description", "File", "Strava URL"].forEach((name) => expect(properties).toContain(name));
  });

  test("defines the measures of the activities, the splits and the heart rate zones", () => {
    ["Activities", "Distance km", "Moving time", "Elapsed time", "Max heart rate", "Fastest km", "Relative effort",
      "Split distance m", "Split duration", "Time in zone"].forEach((name) => expect(schema.measures()).toContain(name));
    ["[Measures].[Average pace]", "[Measures].[Average heart rate]", "[Measures].[Average power W]",
      "[Measures].[Split pace]", "[Measures].[Time in zone %]", "[Measures].[Activity start time]",
      "[Measures].[Activity title]", "[Measures].[Activity description]", "[Measures].[Activity file]",
      "[Measures].[Activity Strava URL]"].
      forEach((name) => expect(schema.calculatedMembers()).toContain(name));
  });
});

describe("olap", () => {
  beforeAll(() => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {fixture: "strava_export.zip", headers: {"Content-Type": "application/zip"}});
    importRun.run();
  });

  // The values of a query rounded to two decimals, against the float noise of the decimal sums.
  function results(mdx) {
    return olap.results(mdx).map((row) =>
      row.map((value) => typeof value === "number" ? Math.round(value * 100) / 100 : value));
  }

  test("aggregates the activities by type", () => {
    expect(results(`
      SELECT {[Measures].[Activities], [Measures].[Distance km], [Measures].[Moving time],
              [Measures].[Average pace], [Measures].[Longest distance km]} ON COLUMNS,
             [Activity type].[Activity type].Members ON ROWS
      FROM [Strava]
    `)).toEqual([
      ["Ride", 1, 20, 2400, 120, 20],
      ["Run", 2, 7.05, 2115, 300, 5],
      ["Walk", 1, 3, 1800, 600, 3],
      ["Workout", 1, 0, 1800, null, 0]
    ]);
  });

  test("weights the average heart rate and power by the moving time", () => {
    // (155 * 615 + 100 * 1800) / (615 + 1800)
    expect(results(`
      SELECT {[Measures].[Average heart rate], [Measures].[Max heart rate], [Measures].[Fastest km],
              [Measures].[Average power W]} ON COLUMNS,
             {[Activity type].DefaultMember} ON ROWS
      FROM [Strava]
    `)).toEqual([["All Activity types", 114.01, 180, 100, 180]]);
  });

  test("groups the activities by gear, hour and distance range", () => {
    expect(results(`
      SELECT {[Measures].[Activities], [Measures].[Distance km]} ON COLUMNS, [Gear].[Gear].Members ON ROWS
      FROM [Strava]
    `)).toEqual([["(none)", 2, 3], ["Road bike", 1, 20], ["Trail shoes", 2, 7.05]]);
    expect(results(`
      SELECT {[Measures].[Activities]} ON COLUMNS,
             Filter([Hour].[Hour].Members, NOT IsEmpty([Measures].[Activities])) ON ROWS
      FROM [Strava]
    `)).toEqual([["04", 1], ["06", 1], ["09", 1], ["22", 1], ["23", 1]]);
    expect(results(`
      SELECT {[Measures].[Activities]} ON COLUMNS,
             Filter([Distance range].[Distance range].Members, NOT IsEmpty([Measures].[Activities])) ON ROWS
      FROM [Strava]
    `)).toEqual([["Under 5 km", 3], ["5-10 km", 1], ["10-21 km", 1]]);
  });

  test("computes the pace of the kilometer splits", () => {
    expect(results(`
      SELECT {[Measures].[Split distance m], [Measures].[Split pace], [Measures].[Split average heart rate]} ON COLUMNS,
             [Kilometer].[Kilometer].Members ON ROWS
      FROM [Strava]
    `)).toEqual([
      ["Km 1", 3000, 333.33, 118],
      ["Km 2", 3000, 333.33, 125],
      ["Km 3", 1550, 429.03, 105.34]
    ]);
  });

  test("computes the share of the time in each heart rate zone", () => {
    expect(results(`
      SELECT {[Measures].[Time in zone], [Measures].[Time in zone %]} ON COLUMNS,
             Filter([Heart rate zone].[Heart rate zone].Members, NOT IsEmpty([Measures].[Time in zone])) ON ROWS
      FROM [Strava]
    `)).toEqual([
      ["Below zone 1", 1800, 0.68],
      ["Zone 2 (60-70%)", 150, 0.06],
      ["Zone 3 (70-80%)", 395, 0.15],
      ["Zone 4 (80-90%)", 315, 0.12]
    ]);
  });

  test("shows the properties of an activity", () => {
    expect(olap.results(`
      SELECT {[Measures].[Activity start time], [Measures].[Activity title], [Measures].[Activity file],
              [Measures].[Activity Strava URL]} ON COLUMNS,
             {[Activity].[Activity].[2026-09-24 04:03 Morning Run]} ON ROWS
      FROM [Strava]
    `)).toEqual([["2026-09-24 04:03 Morning Run", "2026-09-24 04:03", "Morning Run", "1001.gpx",
      "https://www.strava.com/activities/1001"]]);
  });
});
