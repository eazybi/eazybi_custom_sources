describe("app.importers.heartRates.sample", () => {
  test("reads a row of heartRate.csv by its column names with a leading space", () => {
    expect(app.importers.heartRates.sample({"Activity Id": "a1", " Timestamp": "745.198", " Heart Rate": "160"})).
      toEqual({activityId: "a1", seconds: 745.198, heartRate: 160});
  });

  test("skips a value which is no heart rate", () => {
    expect(app.importers.heartRates.sample({"Activity Id": "a1", " Timestamp": "5", " Heart Rate": "0"})).toBeNull();
    expect(app.importers.heartRates.sample({"Activity Id": "a1", " Timestamp": "", " Heart Rate": "150"})).toBeNull();
  });
});

describe("app.importers.heartRates.intervals", () => {
  test("sorts the samples and counts a gap as MAX_SAMPLE_SECONDS", () => {
    var intervals = app.importers.heartRates.intervals([
      {seconds: 10, heartRate: 152}, {seconds: 0, heartRate: 150}, {seconds: 5, heartRate: 151},
      {seconds: 130, heartRate: 175}
    ]);

    expect(intervals).toEqual([
      {heartRate: 150, seconds: 5}, {heartRate: 151, seconds: 5}, {heartRate: 152, seconds: 30},
      {heartRate: 175, seconds: 0}
    ]);
    expect(app.importers.heartRates.maximum(intervals)).toBe(175);
  });
});

describe("app.importers.heartRates.zoneSeconds", () => {
  test("adds up the seconds of each zone of the maximum heart rate", () => {
    var zoneSeconds = app.importers.heartRates.zoneSeconds([
      {heartRate: 90, seconds: 10}, {heartRate: 150, seconds: 20}, {heartRate: 159, seconds: 5},
      {heartRate: 160, seconds: 7}, {heartRate: 199, seconds: 0}
    ], 200);

    expect(zoneSeconds.map((zoneTime) => [zoneTime.zone.name, zoneTime.seconds])).toEqual([
      ["Below zone 1", 10], ["Zone 3 (70-80%)", 25], ["Zone 4 (80-90%)", 7]
    ]);
  });

  test("has no zones without a maximum", () => {
    expect(app.importers.heartRates.zoneSeconds([{heartRate: 150, seconds: 5}], null)).toEqual([]);
  });
});

describe("app.importers.heartRates.zonesMaximum", () => {
  test("is the Maximum heart rate import option", () => {
    mock.extraOptions({max_heart_rate: 195});
    expect(app.importers.heartRates.zonesMaximum(180)).toBe(195);
  });

  test("is the highest recorded heart rate when the option is empty", () => {
    mock.extraOptions({max_heart_rate: null});
    expect(app.importers.heartRates.zonesMaximum(180)).toBe(180);
  });
});
