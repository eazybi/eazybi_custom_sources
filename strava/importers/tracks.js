// The tracks of the activity files of the export: the original file of every recorded activity, gzipped
// or not. A GPX file has one track point per second of the moving time — position, elevation, UTC time and
// the heart rate of a paired monitor:
//
//   <trkpt lat="56.9500000" lon="24.1000000">
//    <ele>12.4</ele>
//    <time>2026-10-02T16:32:47Z</time>
//    <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>103</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
//   </trkpt>
//
// A TCX file has the same values in its <Trackpoint> elements, and a FIT file in its binary record messages,
// see app.importers.fit. A point of an activity recorded indoors has a time and a heart rate but no
// position: it counts in the heart rate zones and in no split.
//
// Strava writes the whole activity as one track segment and leaves out the points of a pause, so a step
// between two points longer than PAUSE_SECONDS and much slower than the activity is a pause: it ends the
// segment, and the next one starts after it. A device which records a point only every few seconds has
// long steps at the speed of the activity, which are no pause. The distance and the moving time of an
// activity are those within the segments, which is why a split never counts the time or the way of a pause.
// The points are parsed from the whole text of a file, so a track written with other line breaks is read
// the same.
app.importers.tracks = {
  SPLIT_METERS: 1000,
  EARTH_RADIUS_METERS: 6371000,
  // A step between two points longer than PAUSE_SECONDS is a pause when it is slower than
  // PAUSE_SPEED_RATIO times the speed of the shorter steps. The moving time of a track without the pauses
  // differs from the Moving Time of activities.csv by 0.3% for a typical activity.
  PAUSE_SECONDS: 10,
  PAUSE_SPEED_RATIO: 0.5,
  // Heart rate samples further apart than this are a gap of the monitor, not a steady heart rate.
  MAX_SAMPLE_SECONDS: 30,
  // The last split is kept when it is at least this long, so that a GPS jitter at the end is not a split.
  MIN_SPLIT_METERS: 1,
  // A step between two points longer than JUMP_METERS and faster than JUMP_SPEED_RATIO times the average
  // speed of the activity is a jump of the GPS position. The split with a jump is no fastest kilometer.
  JUMP_METERS: 50,
  JUMP_SPEED_RATIO: 3,

  isFit(fileName) {
    return /\.fit(\.gz)?$/i.test(fileName);
  },

  // {segments: [[{lat, lon, ele, timeMs, hr}, ...], ...]} of the lines of a GPX or TCX file.
  parse(lines, fileName) {
    var text = lines.join("\n");
    var segments = /\.tcx(\.gz)?$/i.test(fileName) ? this.tcxSegments(text) : this.gpxSegments(text);
    return {segments: this.withoutPauses(segments)};
  },

  // The same of the bytes of a FIT file. A FIT file ends a segment at every stop of the timer, and a pause
  // without a stop of the timer is divided the same way as one of a GPX file.
  parseFit(bytes) {
    return {segments: this.withoutPauses(app.importers.fit.segments(bytes))};
  },

  gpxSegments(text) {
    return text.split(/<trkseg\b[^>]*>/).slice(1).map((segmentText) =>
      this.points(segmentText, /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g, (match) => this.gpxPoint(match)));
  },

  // A TCX file has a track of its own in every lap, and the laps follow each other without a pause, so the
  // points of all the tracks are one segment.
  tcxSegments(text) {
    return [this.points(text, /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g, (match) => this.tcxPoint(match[1]))];
  },

  // The points of the matches of the pattern, without the ones which have no time.
  points(text, pattern, pointOf) {
    var points = [];
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var point = pointOf(match);
      if (point) points.push(point);
    }
    return points;
  },

  gpxPoint(match) {
    var attributes = match[1], body = match[2] || "";
    return this.point(this.attribute(attributes, "lat"), this.attribute(attributes, "lon"),
      this.element(body, "time"), this.element(body, "ele"), this.element(body, "hr"));
  },

  tcxPoint(body) {
    var heartRate = body.match(/<HeartRateBpm\b[^>]*>\s*<Value>\s*([^<]*?)\s*<\/Value>/);
    var rows = app.importers.rows;
    return this.point(rows.number(this.element(body, "LatitudeDegrees")),
      rows.number(this.element(body, "LongitudeDegrees")), this.element(body, "Time"),
      this.element(body, "AltitudeMeters"), heartRate ? heartRate[1] : null);
  },

  point(lat, lon, time, ele, hr) {
    var timeMs = time ? Date.parse(time) : NaN;
    if (isNaN(timeMs)) return null;
    var rows = app.importers.rows;
    var hasPosition = lat !== null && lon !== null;
    return {lat: hasPosition ? lat : null, lon: hasPosition ? lon : null, ele: rows.number(ele), timeMs: timeMs,
      hr: rows.number(hr)};
  },

  hasPosition(point) {
    return point.lat !== null;
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

  // The segments divided at every pause, without the empty ones.
  withoutPauses(segments) {
    var movingSpeed = this.movingSpeed(segments);
    var divided = [];
    segments.forEach((points) => {
      var current = [];
      points.forEach((point) => {
        var previous = current[current.length - 1];
        if (previous && this.isPause(previous, point, movingSpeed)) {
          divided.push(current);
          current = [];
        }
        current.push(point);
      });
      if (current.length > 0) divided.push(current);
    });
    return divided;
  },

  // A step without a position has no speed, so it is a pause only when it is longer than a heart rate
  // sample counts: a device indoors may record a heart rate only every 15 seconds.
  isPause(from, to, movingSpeed) {
    var seconds = (to.timeMs - from.timeMs) / 1000;
    if (seconds <= this.PAUSE_SECONDS) return false;
    if (!this.hasPosition(from) || !this.hasPosition(to)) return seconds > this.MAX_SAMPLE_SECONDS;
    return this.distanceMeters(from, to) / seconds < this.PAUSE_SPEED_RATIO * movingSpeed;
  },

  // The meters per second of the steps between points with a position which are not longer than
  // PAUSE_SECONDS, or of all such steps when every step is longer.
  movingSpeed(segments) {
    var short = {meters: 0, seconds: 0}, all = {meters: 0, seconds: 0};
    segments.forEach((points) => {
      for (let index = 1; index < points.length; index++) {
        let from = points[index - 1], to = points[index];
        if (!this.hasPosition(from) || !this.hasPosition(to)) continue;
        let meters = this.distanceMeters(from, to), seconds = Math.max(0, (to.timeMs - from.timeMs) / 1000);
        all.meters += meters;
        all.seconds += seconds;
        if (seconds <= this.PAUSE_SECONDS) {
          short.meters += meters;
          short.seconds += seconds;
        }
      }
    });
    var steps = short.seconds > 0 ? short : all;
    return steps.seconds > 0 ? steps.meters / steps.seconds : 0;
  },

  // What the track adds to its activity: the kilometer splits of the points with a position, the fastest
  // whole kilometer and the heart rate intervals of all the points. A step over a point without a position,
  // such as one in a tunnel, is the step between the points with a position around it.
  analyze(track) {
    var splits = this.splits(track.segments.map((points) => points.filter((point) => this.hasPosition(point))));
    return {
      splits: splits,
      fastestKmSeconds: this.fastestKmSeconds(splits),
      heartRateIntervals: this.heartRateIntervals(track.segments)
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
  // heart rate of the activity. A value outside the heart rates app.importers.heartRates accepts is a
  // monitor error.
  heartRateIntervals(segments) {
    var intervals = [];
    segments.forEach((points) => {
      points.forEach((point, index) => {
        if (!app.importers.heartRates.isHeartRate(point.hr)) return;
        var next = points[index + 1];
        var seconds = next ?
          Math.min(this.MAX_SAMPLE_SECONDS, Math.max(0, (next.timeMs - point.timeMs) / 1000)) : 0;
        if (seconds > 0 || !next) intervals.push({heartRate: point.hr, seconds: seconds});
      });
    });
    return intervals;
  }
};
