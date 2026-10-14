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
  var preferences = {"Maximum Heartrate": "190"};

  test("is the Maximum heart rate import option", () => {
    mock.extraOptions({max_heart_rate: 195});
    expect(app.importers.heartRates.zonesMaximum(preferences, 180)).toBe(195);
  });

  test("is the maximum heart rate of the Strava settings when the option is empty", () => {
    mock.extraOptions({max_heart_rate: null});
    expect(app.importers.heartRates.zonesMaximum(preferences, 180)).toBe(190);
  });

  test("is the highest recorded heart rate without a setting", () => {
    expect(app.importers.heartRates.zonesMaximum(null, 180)).toBe(180);
    expect(app.importers.heartRates.zonesMaximum({"Maximum Heartrate": ""}, 180)).toBe(180);
    expect(app.importers.heartRates.zonesMaximum({"Maximum Heartrate": "0"}, 180)).toBe(180);
  });
});
