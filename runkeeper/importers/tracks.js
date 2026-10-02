// The GPX tracks of the export, one file per activity recorded with GPS. Runkeeper writes one track
// point per line — position, elevation, UTC time and the heart rate of a paired monitor:
//
//   <trkpt lat="30.260681000" lon="-97.749580000"><ele>135.7</ele><time>2026-09-23T12:02:32Z</time>
//     <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>155</gpxtpx:hr></gpxtpx:TrackPointExtension>
//     </extensions></trkpt>
//
// A pause ends the track segment and the next one starts after it. The distance and the moving time of
// an activity are those within the segments: they add up to the Distance and the Duration of the
// activity in cardioActivities.csv, which is why a split never counts the time or the way of a pause.
// The points are parsed from the whole text of a file, so a track written with other line breaks is
// read the same.
app.importers.tracks = {
  SPLIT_METERS: 1000,
  EARTH_RADIUS_METERS: 6371000,
  // Heart rate samples further apart than this are a gap of the monitor, not a steady heart rate.
  MAX_SAMPLE_SECONDS: 30,
  // The last split is kept when it is at least this long, so that a GPS jitter at the end is not a split.
  MIN_SPLIT_METERS: 1,
  // A step between two points longer than JUMP_METERS and faster than JUMP_SPEED_RATIO times the average
  // speed of the activity is a jump of the GPS position. The split with a jump is no fastest kilometer.
  JUMP_METERS: 50,
  JUMP_SPEED_RATIO: 3,

  // {segments: [[{lat, lon, ele, timeMs, hr}, ...], ...]} of the lines of a GPX file.
  parse(lines) {
    var text = lines.join("\n");
    var segments = [];
    var segmentTexts = text.split(/<trkseg\b[^>]*>/).slice(1);
    segmentTexts.forEach((segmentText) => {
      var points = [];
      var pointPattern = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
      var match;
      while ((match = pointPattern.exec(segmentText)) !== null) {
        var point = this.point(match[1], match[2] || "");
        if (point) points.push(point);
      }
      if (points.length > 0) segments.push(points);
    });
    return {segments: segments};
  },

  point(attributes, body) {
    var lat = this.attribute(attributes, "lat"), lon = this.attribute(attributes, "lon");
    var time = this.element(body, "time");
    var timeMs = time ? Date.parse(time) : NaN;
    if (lat === null || lon === null || isNaN(timeMs)) return null;
    var ele = this.element(body, "ele");
    var hr = this.element(body, "hr");
    return {
      lat: lat,
      lon: lon,
      ele: ele === null ? null : app.importers.rows.number(ele),
      timeMs: timeMs,
      hr: hr === null ? null : app.importers.rows.number(hr)
    };
  },

  attribute(attributes, name) {
    var match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
    return match ? app.importers.rows.number(match[1]) : null;
  },

  // The text of the first element of the name, also with a namespace prefix (<gpxtpx:hr>).
  element(body, name) {
    var match = body.match(new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`));
    return match ? match[1] : null;
  },

  // What the track adds to its activity: the kilometer splits, the fastest whole kilometer, the heart
  // rate intervals of the track points, and the UTC offset of the local start time.
  analyze(track, activity) {
    var splits = this.splits(track.segments);
    return {
      splits: splits,
      fastestKmSeconds: this.fastestKmSeconds(splits),
      heartRateIntervals: this.heartRateIntervals(track.segments),
      utcOffsetMinutes: this.utcOffsetMinutes(track.segments, activity)
    };
  },

  // The kilometer splits of the moving time: [{number, distanceM, seconds, elevationGainM,
  // heartBeats, heartRateSeconds}]. The way between two points which crosses a kilometer boundary is
  // divided between the two splits in proportion to the distance, and so are its time, climb and the
  // seconds of its heart rate — at most MAX_SAMPLE_SECONDS, like those of the heart rate intervals.
  splits(segments) {
    var splits = [];
    var current = this.newSplit(1);
    var jumpSpeed = this.JUMP_SPEED_RATIO * this.averageSpeed(segments);
    segments.forEach((points) => {
      for (let index = 1; index < points.length; index++) {
        let from = points[index - 1], to = points[index];
        let step = {
          meters: this.distanceMeters(from, to),
          seconds: Math.max(0, (to.timeMs - from.timeMs) / 1000),
          gain: from.ele !== null && to.ele !== null ? Math.max(0, to.ele - from.ele) : 0,
          heartRate: this.stepHeartRate(from, to)
        };
        step.heartRateSeconds = step.heartRate === null ? 0 : Math.min(this.MAX_SAMPLE_SECONDS, step.seconds);
        step.jump = step.meters > this.JUMP_METERS && (step.seconds === 0 || step.meters / step.seconds > jumpSpeed);
        while (step.meters > 0 && current.distanceM + step.meters >= this.SPLIT_METERS) {
          let fraction = (this.SPLIT_METERS - current.distanceM) / step.meters;
          this.addToSplit(current, step, fraction);
          splits.push(current);
          current = this.newSplit(current.number + 1);
        }
        this.addToSplit(current, step, 1);
      }
    });
    if (current.distanceM >= this.MIN_SPLIT_METERS) splits.push(current);
    return splits.map((split) => this.roundSplit(split));
  },

  // The heart rate of the step between two points: of the first point, or of the second one when the first
  // has none. A value outside the heart rates app.importers.heartRates accepts is a monitor error.
  stepHeartRate(from, to) {
    var heartRates = app.importers.heartRates;
    if (heartRates.isHeartRate(from.hr)) return from.hr;
    return heartRates.isHeartRate(to.hr) ? to.hr : null;
  },

  newSplit(number) {
    return {number: number, distanceM: 0, seconds: 0, elevationGainM: 0, heartBeats: 0, heartRateSeconds: 0,
      hasJump: false};
  },

  // Adds the fraction of the rest of the step to the split, and leaves the rest of it in the step.
  addToSplit(split, step, fraction) {
    var meters = step.meters * fraction, seconds = step.seconds * fraction;
    var heartRateSeconds = step.heartRateSeconds * fraction;
    split.distanceM += meters;
    split.seconds += seconds;
    split.elevationGainM += step.gain * fraction;
    if (step.heartRate !== null) {
      split.heartBeats += step.heartRate * heartRateSeconds / 60;
      split.heartRateSeconds += heartRateSeconds;
    }
    if (step.jump && meters >= this.MIN_SPLIT_METERS) split.hasJump = true;
    step.meters -= meters;
    step.seconds -= seconds;
    step.heartRateSeconds -= heartRateSeconds;
    step.gain -= step.gain * fraction;
  },

  roundSplit(split) {
    var round = app.importers.rows.round;
    return {
      number: split.number,
      distanceM: round(split.distanceM, 1),
      seconds: round(split.seconds, 1),
      elevationGainM: round(split.elevationGainM, 1),
      heartBeats: round(split.heartBeats, 1),
      heartRateSeconds: round(split.heartRateSeconds, 1),
      hasJump: split.hasJump
    };
  },

  // The meters per second of the moving time of all the segments.
  averageSpeed(segments) {
    var meters = 0, seconds = 0;
    segments.forEach((points) => {
      for (let index = 1; index < points.length; index++) {
        meters += this.distanceMeters(points[index - 1], points[index]);
        seconds += Math.max(0, (points[index].timeMs - points[index - 1].timeMs) / 1000);
      }
    });
    return seconds > 0 ? meters / seconds : 0;
  },

  // The seconds of the fastest whole kilometer without a GPS jump, or null when the activity has none.
  fastestKmSeconds(splits) {
    var whole = splits.filter((split) =>
      split.distanceM >= this.SPLIT_METERS - 0.5 && split.seconds > 0 && !split.hasJump);
    if (whole.length === 0) return null;
    return Math.round(_.min(whole.map((split) => split.seconds)));
  },

  // The great circle distance of two points.
  distanceMeters(from, to) {
    var toRadians = Math.PI / 180;
    var fromLat = from.lat * toRadians, toLat = to.lat * toRadians;
    var deltaLat = toLat - fromLat, deltaLon = (to.lon - from.lon) * toRadians;
    var a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    return 2 * this.EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
  },

  // [{heartRate, seconds}] between the consecutive points of each segment which carry a heart rate, and
  // the last point of each segment with no seconds — it ends no interval, but it may be the highest
  // heart rate of the activity.
  heartRateIntervals(segments) {
    var intervals = [];
    segments.forEach((points) => {
      points.forEach((point, index) => {
        if (point.hr === null || point.hr <= 0) return;
        var next = points[index + 1];
        var seconds = next ?
          Math.min(this.MAX_SAMPLE_SECONDS, Math.max(0, (next.timeMs - point.timeMs) / 1000)) : 0;
        if (seconds > 0 || !next) intervals.push({heartRate: point.hr, seconds: seconds});
      });
    });
    return intervals;
  },

  // The local start time minus the UTC time of the first point, rounded to a quarter of an hour.
  utcOffsetMinutes(segments, activity) {
    if (segments.length === 0 || !activity.start) return null;
    var minutes = (activity.start.wallClockMs - segments[0][0].timeMs) / 60000;
    var offset = Math.round(minutes / 15) * 15;
    return Math.abs(offset) <= 14 * 60 ? offset : null;
  }
};
