// A track point `meters` north of the start, along a meridian where the distance of two points is exact.
function trackPoint(meters, seconds, ele, hr) {
  return {
    lat: 56.95 + meters / 6371000 * 180 / Math.PI,
    lon: 24.1,
    ele: ele === undefined ? null : ele,
    timeMs: Date.parse("2026-09-24T04:03:32Z") + seconds * 1000,
    hr: hr === undefined ? null : hr
  };
}

// Points every `stepMeters` and `stepSeconds` from `fromMeters` to `toMeters`.
function straightPoints(fromMeters, toMeters, stepMeters, fromSeconds, stepSeconds, hr) {
  var points = [];
  for (var meters = fromMeters, seconds = fromSeconds; meters <= toMeters + 0.001;
       meters += stepMeters, seconds += stepSeconds) {
    points.push(trackPoint(meters, seconds, null, hr));
  }
  return points;
}

describe("app.importers.tracks.parse", () => {
  test("reads the points of a GPX file and divides its segment at a pause", () => {
    var track = app.importers.tracks.parse([
      '<gpx creator="StravaGPX"><trk><trkseg>',
      '<trkpt lat="56.9500000" lon="24.1000000">',
      " <ele>135.7</ele>",
      " <time>2026-09-24T04:03:32Z</time>",
      " <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>155</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>",
      "</trkpt>",
      '<trkpt lat="56.9500900" lon="24.1000000"><ele>136.2</ele><time>2026-09-24T04:03:42Z</time></trkpt>',
      '<trkpt lat="56.9501000" lon="24.1000000"><time>2026-09-24T04:03:53Z</time></trkpt>',
      "</trkseg></trk></gpx>"
    ], "1001.gpx");

    expect(track.segments).toEqual([
      [
        {lat: 56.95, lon: 24.1, ele: 135.7, timeMs: Date.parse("2026-09-24T04:03:32Z"), hr: 155},
        {lat: 56.95009, lon: 24.1, ele: 136.2, timeMs: Date.parse("2026-09-24T04:03:42Z"), hr: null}
      ],
      [{lat: 56.9501, lon: 24.1, ele: null, timeMs: Date.parse("2026-09-24T04:03:53Z"), hr: null}]
    ]);
  });

  test("divides a track with a point every 15 s only at its pause", () => {
    // 50 m every 15 s, a pause of 60 s in place after 1000 m, then 50 m more.
    var gpxPoint = (point) => `<trkpt lat="${point.lat}" lon="${point.lon}"><time>` +
      `${new Date(point.timeMs).toISOString()}</time></trkpt>`;
    var points = straightPoints(0, 1000, 50, 0, 15).concat(straightPoints(1000, 1050, 50, 360, 15));
    var track = app.importers.tracks.parse(["<gpx><trk><trkseg>"].concat(points.map(gpxPoint)).
      concat(["</trkseg></trk></gpx>"]), "1001.gpx");
    var splits = app.importers.tracks.analyze(track).splits;

    expect(track.segments.map((segment) => segment.length)).toEqual([21, 2]);
    expect(splits.map((split) => [split.distanceM, split.seconds])).toEqual([[1000, 300], [50, 15]]);
  });

  test("reads the points of a TCX file", () => {
    var track = app.importers.tracks.parse([
      "<TrainingCenterDatabase><Activities><Activity><Lap><Track>",
      "<Trackpoint><Time>2025-12-31T22:50:00Z</Time><Position><LatitudeDegrees>56.95</LatitudeDegrees>" +
        "<LongitudeDegrees>24.1</LongitudeDegrees></Position><AltitudeMeters>10.5</AltitudeMeters>" +
        "<HeartRateBpm><Value>100</Value></HeartRateBpm></Trackpoint>",
      "<Trackpoint><Time>2025-12-31T22:50:06Z</Time><Position><LatitudeDegrees>56.9501</LatitudeDegrees>" +
        "<LongitudeDegrees>24.1</LongitudeDegrees></Position></Trackpoint>",
      "</Track></Lap></Activity></Activities></TrainingCenterDatabase>"
    ], "1003.tcx.gz");

    expect(track.segments).toEqual([[
      {lat: 56.95, lon: 24.1, ele: 10.5, timeMs: Date.parse("2025-12-31T22:50:00Z"), hr: 100},
      {lat: 56.9501, lon: 24.1, ele: null, timeMs: Date.parse("2025-12-31T22:50:06Z"), hr: null}
    ]]);
  });

  test("reads the tracks of all the laps of a TCX file as one segment", () => {
    var trackpoint = (time, lat) => `<Trackpoint><Time>${time}</Time><Position><LatitudeDegrees>${lat}` +
      "</LatitudeDegrees><LongitudeDegrees>24.1</LongitudeDegrees></Position></Trackpoint>";
    var track = app.importers.tracks.parse([
      "<TrainingCenterDatabase><Activities><Activity>",
      `<Lap><Track>${trackpoint("2025-12-31T22:50:00Z", 56.95)}${trackpoint("2025-12-31T22:50:05Z", 56.9501)}</Track></Lap>`,
      `<Lap><Track>${trackpoint("2025-12-31T22:50:10Z", 56.9502)}</Track></Lap>`,
      "</Activity></Activities></TrainingCenterDatabase>"
    ], "1003.tcx");

    expect(track.segments).toHaveLength(1);
    expect(track.segments[0].map((point) => point.lat)).toEqual([56.95, 56.9501, 56.9502]);
  });

  test("skips a point without a time", () => {
    var gpx = app.importers.tracks.parse(
      ['<trkseg><trkpt lat="56.95" lon="24.1"><ele>1</ele></trkpt></trkseg>'], "1004.gpx");

    expect(gpx.segments).toEqual([]);
  });

  test("counts the heart rate of an indoor track with a sample every 15 s, and not over its pause", () => {
    var trackpoint = (seconds, hr) => `<Trackpoint><Time>${new Date(Date.UTC(2025, 11, 31, 22, 50, seconds)).
      toISOString()}</Time><HeartRateBpm><Value>${hr}</Value></HeartRateBpm></Trackpoint>`;
    var track = app.importers.tracks.parse(["<Track>", trackpoint(0, 120), trackpoint(15, 130), trackpoint(30, 140),
      trackpoint(90, 150), trackpoint(105, 160), "</Track>"], "1004.tcx");

    expect(app.importers.tracks.analyze(track).heartRateIntervals).toEqual([
      {heartRate: 120, seconds: 15}, {heartRate: 130, seconds: 15}, {heartRate: 140, seconds: 0},
      {heartRate: 150, seconds: 15}, {heartRate: 160, seconds: 0}
    ]);
  });

  test("keeps a point of an indoor activity, which has a time and a heart rate but no position", () => {
    var tcx = app.importers.tracks.parse(
      ["<Track><Trackpoint><Time>2025-12-31T22:50:00Z</Time><HeartRateBpm><Value>100</Value></HeartRateBpm>" +
        "</Trackpoint></Track>"], "1004.tcx");

    expect(tcx.segments).toEqual([[{lat: null, lon: null, ele: null, timeMs: Date.parse("2025-12-31T22:50:00Z"),
      hr: 100}]]);
  });
});

describe("app.importers.tracks.analyze", () => {
  function indoorPoint(seconds, hr) {
    return {lat: null, lon: null, ele: null, timeMs: Date.parse("2026-09-24T04:03:32Z") + seconds * 1000, hr: hr};
  }

  test("counts the heart rate of an indoor activity in the zones and in no split", () => {
    var analysis = app.importers.tracks.analyze({segments: [[indoorPoint(0, 120), indoorPoint(5, 130),
      indoorPoint(10, 140)]]});

    expect(analysis.splits).toEqual([]);
    expect(analysis.fastestKmSeconds).toBeNull();
    expect(analysis.heartRateIntervals).toEqual([
      {heartRate: 120, seconds: 5}, {heartRate: 130, seconds: 5}, {heartRate: 140, seconds: 0}
    ]);
  });

  test("splits the step over a point without a position, as in a tunnel", () => {
    var points = straightPoints(0, 500, 50, 0, 15).concat([indoorPoint(160, 150)]).
      concat(straightPoints(600, 1000, 50, 165, 15));
    var analysis = app.importers.tracks.analyze({segments: [points]});

    expect(analysis.splits.map((split) => [split.distanceM, split.seconds])).toEqual([[1000, 285]]);
    expect(analysis.heartRateIntervals).toEqual([{heartRate: 150, seconds: 5}]);
  });
});

describe("app.importers.tracks.isFit", () => {
  test("answers whether the file is a FIT file, gzipped or not", () => {
    expect(["1.fit", "1.FIT.GZ", "1.gpx", "1.tcx.gz"].map((name) => app.importers.tracks.isFit(name))).
      toEqual([true, true, false, false]);
  });
});

describe("app.importers.tracks.splits", () => {
  test("divides the moving distance into kilometers and the rest", () => {
    // 2.5 km at 5:00 per km: 50 m every 15 s.
    var splits = app.importers.tracks.splits([straightPoints(0, 2500, 50, 0, 15, 150)]);

    expect(splits.map((split) => [split.number, split.distanceM, split.seconds])).toEqual([
      [1, 1000, 300], [2, 1000, 300], [3, 500, 150]
    ]);
    expect(splits[0].heartBeats).toBeCloseTo(750, 1);
    expect(splits[0].heartRateSeconds).toBe(300);
  });

  test("leaves the heart rate of a monitor error out of the split heart rate", () => {
    // 550 m at 150 bpm — the step to the first point of 255 bpm counts at the heart rate it starts with —
    // then 450 m at 255 bpm, which is no heart rate.
    var points = straightPoints(0, 500, 50, 0, 15, 150).concat(straightPoints(550, 1000, 50, 165, 15, 255));
    var splits = app.importers.tracks.splits([points]);

    expect(splits[0].heartRateSeconds).toBe(165);
    expect(splits[0].heartBeats).toBeCloseTo(412.5, 1);
  });

  test("counts a gap of the heart rate monitor as MAX_SAMPLE_SECONDS of the split heart rate", () => {
    // 900 m at 150 bpm, a step of 200 m and 120 s across the first kilometer, then 400 m at 150 bpm. The
    // 30 s of the heart rate of the gap are divided like its 120 s: half of them in each split.
    var points = straightPoints(0, 900, 50, 0, 15, 150).concat(straightPoints(1100, 1500, 50, 390, 15, 150));
    var splits = app.importers.tracks.splits([points]);

    expect(splits.map((split) => [split.seconds, split.heartRateSeconds])).toEqual([[330, 285], [180, 135]]);
    expect(splits[0].heartBeats).toBeCloseTo(712.5, 1);
  });

  test("divides a step across a kilometer boundary in proportion to its distance", () => {
    // 400 m steps of 100 s: the third step ends 200 m after the first kilometer.
    var splits = app.importers.tracks.splits([[
      trackPoint(0, 0, 10), trackPoint(400, 100, 10), trackPoint(800, 200, 10), trackPoint(1200, 300, 18)
    ]]);

    expect(splits.map((split) => [split.distanceM, split.seconds, split.elevationGainM])).toEqual([
      [1000, 250, 4], [200, 50, 4]
    ]);
  });

  test("counts neither the way nor the time of a pause between the segments", () => {
    var splits = app.importers.tracks.splits([
      straightPoints(0, 600, 100, 0, 30),
      // After a pause of 10 minutes 300 m further.
      straightPoints(900, 1500, 100, 780, 30)
    ]);

    expect(splits.map((split) => [split.distanceM, split.seconds])).toEqual([[1000, 300], [200, 60]]);
  });

  test("keeps no split for a jitter at the end", () => {
    var points = straightPoints(0, 1000, 100, 0, 30);
    points.push(trackPoint(1000.5, 330));
    expect(app.importers.tracks.splits([points])).toHaveLength(1);
  });
});

describe("app.importers.tracks.fastestKmSeconds", () => {
  test("is the fastest whole kilometer", () => {
    var points = straightPoints(0, 1000, 100, 0, 33).concat(straightPoints(1100, 2000, 100, 360, 30)).
      concat(straightPoints(2100, 2400, 100, 660, 20));
    var splits = app.importers.tracks.splits([points]);

    expect(app.importers.tracks.fastestKmSeconds(splits)).toBe(300);
  });

  test("leaves out a kilometer with a jump of the GPS position", () => {
    // 700 m at 40 s per 100 m, a jump of 300 m in 5 s, then a kilometer of 330 s.
    var points = straightPoints(0, 700, 100, 0, 40).concat(straightPoints(1000, 2000, 100, 285, 33));
    var splits = app.importers.tracks.splits([points]);

    expect(splits[0].hasJump).toBe(true);
    expect(splits[1].hasJump).toBe(false);
    expect(app.importers.tracks.fastestKmSeconds(splits)).toBe(330);
  });

  test("is empty for an activity shorter than a kilometer", () => {
    var splits = app.importers.tracks.splits([straightPoints(0, 800, 100, 0, 30)]);
    expect(app.importers.tracks.fastestKmSeconds(splits)).toBeNull();
  });
});

describe("app.importers.tracks.heartRateIntervals", () => {
  test("counts a gap of the heart rate monitor as MAX_SAMPLE_SECONDS", () => {
    var intervals = app.importers.tracks.heartRateIntervals([[
      trackPoint(0, 0, null, 150), trackPoint(10, 5, null, 152), trackPoint(20, 125, null), trackPoint(30, 130, null, 170)
    ]]);

    expect(intervals).toEqual([
      {heartRate: 150, seconds: 5}, {heartRate: 152, seconds: 30}, {heartRate: 170, seconds: 0}
    ]);
  });
});
