// The generated sample data of test/sample_data.js imports without an unmocked request and fills every
// dimension the sample reports group by.

// The members of the set which have a value of the measure.
function membersWith(set, measure, where) {
  return olap.results(`
    SELECT Filter(${set}, NOT IsEmpty([Measures].[${measure}])) ON ROWS,
           {[Measures].[${measure}]} ON COLUMNS
    FROM [Strava] WHERE ${where}`).map((row) => row[0]);
}

var LAST_12_MONTHS = "[Time].[Last 12 months]";

describe("sample data", () => {
  beforeAll(() => {
    mock.sampleData();
    importRun.run();
  });

  test("imports the activities without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    var total = olap.results(`
      SELECT {[Measures].[Activities]} ON COLUMNS, {[Activity type].DefaultMember} ON ROWS
      FROM [Strava]`)[0][1];
    expect(total).toBeGreaterThan(200);
  });

  // The history ends yesterday, so the current month has no activity yet on its first day, and the 800 days
  // of the history span three or four years. The heart rate monitor came after the first 120 days, and the
  // remaining 680 days span only two years in late November and December.
  test("has activities in the months of the last 12 months and in at least three years", () => {
    expect(membersWith(`DescendantsSet(${LAST_12_MONTHS}, [Time].[Month])`, "Distance km", "[Activity type].DefaultMember")
      .length).toBeGreaterThan(10);
    expect(membersWith("[Time].[Year].Members", "Fastest km", "[Activity type].DefaultMember").length)
      .toBeGreaterThan(2);
    expect(membersWith("[Time].[Year].Members", "Average heart rate", "[Activity type].DefaultMember").length)
      .toBeGreaterThan(1);
  });

  test("has several members of every dimension of the sample reports in the last 12 months", () => {
    expect(membersWith("[Activity type].[Activity type].Members", "Activities", LAST_12_MONTHS)).toEqual([
      "Hike", "Nordic Ski", "Ride", "Run", "Walk"
    ]);
    expect(membersWith("[Distance range].[Distance range].Members", "Activities", LAST_12_MONTHS)).toEqual([
      "Under 5 km", "5-10 km", "10-21 km", "21-42 km", "42 km and more"
    ]);
    expect(membersWith("[Gear].[Gear].Members", "Distance km", LAST_12_MONTHS).length).toBeGreaterThan(5);
    expect(membersWith("[Hour].[Hour].Members", "Activities", LAST_12_MONTHS).length).toBeGreaterThan(8);
    expect(membersWith("[Week Day].[Week Day].Members", "Activities", LAST_12_MONTHS).length).toBe(7);
    expect(membersWith("[Heart rate zone].[Heart rate zone].Members", "Time in zone", LAST_12_MONTHS).length)
      .toBeGreaterThan(4);
    expect(membersWith("[Kilometer].[Kilometer].Members", "Split distance m", LAST_12_MONTHS).length)
      .toBeGreaterThan(40);
  });

  test("has no activity after yesterday", () => {
    var latest = dwh.dimensions.activities.rows({columns: ["start_time"], limit: 1000})
      .map((row) => row.start_time).sort().pop();
    expect(latest.substring(0, 10) < sample.today()).toBe(true);
  });
});
