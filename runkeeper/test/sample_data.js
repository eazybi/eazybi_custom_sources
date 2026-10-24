// The sample data of the Runkeeper sample reports: the data export of an invented runner with about two and
// a half years of activities. The runner runs two to four times a week — easy runs, tempo and interval runs
// on weekdays and a long run on Saturday, on the treadmill now and then in the winter — rides a bike on
// summer Sundays, skis in the winter, walks and hikes with friends, runs a half marathon every year and a
// first marathon a month ago. The runner gets fitter over the years: the runs get longer and faster at a
// lower heart rate. A heart rate monitor came a few months after the first activities. Every name is invented.
//
// The export is a ZIP file of cardioActivities.csv, heartRate.csv and the GPX track of every outdoor
// activity. A mocked response body is text which reaches the downloaded file as UTF-8, where a character of
// 0x80 or more takes two bytes, so the archive is written of characters below 0x80 only: its entries are
// stored uncompressed and are ASCII text, and every number of its headers is made of bytes below 0x80
// (see zipArchive).
sample.seed(23);

var EXPORT_URL = "https://files.example.com/runkeeper-export.zip";
var HISTORY_DAYS = 900;
var MAX_HEART_RATE = 190;
var MINUTE_MS = 60 * 1000;
var DAY_MS = 24 * 60 * MINUTE_MS;

mock.sourceParams({export_url: EXPORT_URL});
mock.extraOptions({skip_implausible_activities: true, max_heart_rate: MAX_HEART_RATE});

// Where the routes of the runner start, and the meters of one degree of latitude.
var HOME = {lat: 47.051824, lon: 8.307912, elevation: 436};
var DEGREE_METERS = 111320;

// The activity types: the calories per km, the height of the hills of their routes in meters, and the
// seconds between two GPS track points. A real export has a track point and a heart rate sample every few
// seconds; these are further apart so that the archive stays small enough for the offsets of its entries
// (see zipArchive). The heart rate samples are HEART_RATE_SECONDS apart, the longest time that the
// importer counts as a steady heart rate.
var TYPES = {
  "Running": {caloriesPerKm: 68, hills: 12, pointSeconds: 45},
  "Cycling": {caloriesPerKm: 24, hills: 45, pointSeconds: 60},
  "Walking": {caloriesPerKm: 52, hills: 8, pointSeconds: 60},
  "Hiking": {caloriesPerKm: 74, hills: 160, pointSeconds: 60},
  "Cross-Country Skiing": {caloriesPerKm: 48, hills: 25, pointSeconds: 45}
};
var HEART_RATE_SECONDS = 30;
var HEART_RATE_MONITOR_PROGRESS = 0.15;

// The workouts of the runner. A run has the pace of its workout relative to the easy pace of the day,
// which gets faster with the fitness of the runner, and the other types a speed in km/h. The heart rate
// is the average of the workout, the profile the changes of the speed within it (see effort), growKm
// the kilometers that the workout gets longer over the history, and friends the friends who come along.
var WORKOUTS = {
  easy: {type: "Running", km: [5, 8], growKm: 2, paceOffset: 25, heartRate: 148,
         routes: ["Riverside loop", "Park 5K", "Old town loop", "Forest trail"],
         notes: ["Felt strong", "Windy, cold hands", "Rain the whole way", "Legs heavy after yesterday"],
         noteChance: 0.15},
  recovery: {type: "Running", km: [4, 6], paceOffset: 50, heartRate: 140, routes: ["Park 5K"],
             notes: ["Recovery run"], noteChance: 0.6},
  tempo: {type: "Running", km: [7, 10], paceOffset: -30, heartRate: 165, profile: "tempo",
          routes: ["Riverside loop"], notes: ["Tempo run", "Tempo, 5 km at threshold"], noteChance: 1},
  intervals: {type: "Running", km: [6, 9], paceOffset: 0, heartRate: 160, profile: "intervals",
              routes: ["Stadium track"], notes: ["Intervals 6 x 800 m", "Intervals 5 x 1 km"], noteChance: 1},
  long: {type: "Running", km: [11, 16], growKm: 6, paceOffset: 40, heartRate: 150, profile: "fade",
         routes: ["Lakeshore path", "Long river route"], friends: [["Tomas", 20], ["Ines", 15]],
         notes: ["Long run", "Long run with gels"], noteChance: 0.3},
  treadmill: {type: "Running", km: [5, 8], paceOffset: 20, heartRate: 151, indoor: true,
              notes: ["Treadmill"], noteChance: 1},
  halfMarathon: {type: "Running", km: [21.1, 21.1], paceOffset: -25, heartRate: 173, profile: "race",
                 race: true, routes: ["City half marathon course"], notes: ["City half marathon"], noteChance: 1},
  marathon: {type: "Running", km: [42.2, 42.2], paceOffset: 15, heartRate: 163, profile: "fade",
             race: true, routes: ["Lake marathon course"], friends: [["Tomas", 100]],
             notes: ["First marathon, finished strong"], noteChance: 1},
  ride: {type: "Cycling", km: [20, 40], growKm: 8, speed: [21, 27], heartRate: 132,
         routes: ["Vineyard loop", "Lake road"], friends: [["Pieter", 40], ["Tomas", 10]]},
  hike: {type: "Hiking", km: [8, 16], speed: [3.4, 4.6], heartRate: 121, routes: ["Ridge trail", "Waterfall trail"],
         friends: [["Laura", 60], ["Ines", 40]]},
  walk: {type: "Walking", km: [3, 6], speed: [4.8, 5.8], heartRate: 102, noMonitorChance: 0.4,
         routes: ["Neighborhood walk"], friends: [["Laura", 50]]},
  ski: {type: "Cross-Country Skiing", km: [8, 18], speed: [8.5, 12], heartRate: 146, routes: ["Forest ski track"],
        friends: [["Laura", 30]]}
};

// The share of the planned runs that the runner does in each month.
var RUN_MONTH_FACTORS = [0.7, 0.75, 0.9, 1, 1, 1, 0.9, 0.95, 1, 0.95, 0.8, 0.65];
// The local start hours of the activities of each week day, Sunday first.
var START_HOURS = [[8, 11], [17, 20], [6, 8], [17, 20], [17, 19], [11, 13], [7, 10]];
// The races, by how many days ago they were, moved back to the Sunday before.
var RACES = [[760, "halfMarathon"], [390, "halfMarathon"], [30, "marathon"]];

// The easy pace in seconds per km, from 6:15 at the start of the history to 5:30 now.
function easyPace(progress) {
  return 375 - 45 * progress;
}

function dateOf(ms) {
  return new Date(ms).toISOString().substring(0, 10);
}

// The workout of the day, or null on a rest day: more runs in the summer, and more of them as the runner
// gets fitter.
function plannedWorkout(date, progress) {
  var weekDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  var month = parseInt(date.substring(5, 7), 10);
  var winter = month === 12 || month <= 2, summer = month >= 4 && month <= 9;
  var keen = RUN_MONTH_FACTORS[month - 1] * (0.7 + 0.3 * progress);
  var run = (chance, workout) => {
    if (!sample.chance(chance * keen)) return null;
    return winter && workout !== "long" && sample.chance(0.35) ? "treadmill" : workout;
  };
  switch (weekDay) {
    case 1: return sample.chance(0.15) ? "walk" : null;
    case 2: return run(0.75, sample.chance(0.8) ? "easy" : "recovery");
    case 3: return run(0.15, "easy") || (sample.chance(0.1) ? "walk" : null);
    case 4: return run(0.75, sample.pickWeighted([["tempo", 40], ["intervals", 35], ["easy", 25]]));
    case 5: return run(0.1, "easy");
    case 6: return run(0.7, "long");
    default:
      if (summer) return sample.pickWeighted([["ride", 30], ["hike", 15], [null, 55]]);
      if (winter) return sample.pickWeighted([["ski", 30], ["walk", 25], [null, 45]]);
      return sample.pickWeighted([["walk", 30], ["ride", 10], [null, 60]]);
  }
}

// The speed multiplier of the workout profile at the meters done of the planned meters.
function effort(profile, meters, plannedMeters) {
  var fraction = meters / plannedMeters;
  var warmUp = meters < 2000 || meters > plannedMeters - 1500;
  switch (profile) {
    case "tempo": return warmUp ? 0.88 : 1.07;
    case "intervals": return warmUp ? 0.85 : (Math.floor((meters - 2000) / 600) % 2 === 0 ? 1.2 : 0.8);
    case "fade": return 1.03 - 0.08 * fraction;
    case "race": return 0.99 + 0.04 * fraction;
    default: return 1;
  }
}

function distanceMeters(from, to) {
  var toRadians = Math.PI / 180;
  var fromLat = from.lat * toRadians, toLat = to.lat * toRadians;
  var deltaLat = toLat - fromLat, deltaLon = (to.lon - from.lon) * toRadians;
  var a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The GPS track of an outdoor activity: a loop from home and back, with a pause in some of them, as track
// segments of {lat, lon, elevation, ms, effort} points.
function buildTrack(activity) {
  var pointSeconds = TYPES[activity.type].pointSeconds;
  var plannedMeters = activity.plannedKm * 1000;
  var speed = activity.speedKmh / 3.6;
  var kmFactors = sample.times(Math.ceil(activity.plannedKm) + 1, () => 1 + sample.decimal(-0.04, 0.04, 3));
  var hills = {height: TYPES[activity.type].hills * sample.decimal(0.5, 1.5), wave: sample.integer(700, 2500),
               phase: sample.decimal(0, 6.28)};
  var pauseAtMeters = activity.type !== "Cycling" && sample.chance(0.2) ? plannedMeters * sample.decimal(0.3, 0.7) : null;
  var heading = sample.decimal(0, 2 * Math.PI, 3);
  var position = {lat: HOME.lat + sample.decimal(-0.01, 0.01, 6), lon: HOME.lon + sample.decimal(-0.01, 0.01, 6)};
  var start = {lat: position.lat, lon: position.lon};
  var ms = activity.startMs, meters = 0;
  var segment = [];
  var segments = [segment];
  var addPoint = (pointEffort) => segment.push({
    lat: position.lat, lon: position.lon, ms: ms, effort: pointEffort,
    elevation: HOME.elevation + hills.height * (Math.sin(meters / hills.wave + hills.phase) +
      Math.sin(meters / (hills.wave / 3.7)) / 3)
  });
  addPoint(1);
  while (meters < plannedMeters) {
    let stepEffort = effort(activity.workout.profile, meters, plannedMeters) * kmFactors[Math.floor(meters / 1000)];
    let stepMeters = speed * stepEffort * pointSeconds;
    let stepSeconds = pointSeconds;
    if (meters + stepMeters > plannedMeters) {
      stepSeconds = Math.max(1, Math.round(pointSeconds * (plannedMeters - meters) / stepMeters));
      stepMeters = plannedMeters - meters;
    }
    // Wander, and head back home in the second half.
    if (meters > plannedMeters / 2) {
      let home = Math.atan2((start.lon - position.lon) * Math.cos(position.lat * Math.PI / 180), start.lat - position.lat);
      let turn = Math.atan2(Math.sin(home - heading), Math.cos(home - heading));
      heading += turn * Math.min(1, 0.15 + meters / plannedMeters / 2);
    }
    heading += sample.decimal(-0.25, 0.25, 3);
    position.lat += stepMeters * Math.cos(heading) / DEGREE_METERS;
    position.lon += stepMeters * Math.sin(heading) / (DEGREE_METERS * Math.cos(position.lat * Math.PI / 180));
    meters += stepMeters;
    ms += stepSeconds * 1000;
    addPoint(stepEffort);
    if (pauseAtMeters !== null && meters >= pauseAtMeters) {
      pauseAtMeters = null;
      ms += sample.integer(40, 240) * 1000;
      segment = [];
      segments.push(segment);
      addPoint(stepEffort);
    }
  }
  return segments;
}

// The heart rate at a point of the activity: rising during the first minutes, drifting up during a long
// activity and following the speed of the workout.
function heartRate(activity, elapsedSeconds, pointEffort) {
  var average = activity.workout.heartRate - (activity.type === "Running" ? 6 * activity.progress : 0);
  var rate = average + (pointEffort - 1) * (activity.type === "Running" ? 85 : 40) + elapsedSeconds / 3600 * 4;
  rate = 95 + (rate - 95) * Math.min(1, 0.65 + elapsedSeconds / 900);
  return Math.max(80, Math.min(193, Math.round(rate + sample.integer(-3, 3))));
}

// The heart rate samples of the moving time of the activity, at the effort of the track point ahead. The
// runner got a heart rate monitor a few months into the history, and leaves it at home for some walks.
function heartRateSamples(activity) {
  if (activity.progress < HEART_RATE_MONITOR_PROGRESS) return [];
  if (activity.workout.noMonitorChance && sample.chance(activity.workout.noMonitorChance)) return [];
  var segments = activity.segments ||
    [[{ms: activity.startMs, effort: 1}, {ms: activity.startMs + activity.durationSeconds * 1000, effort: 1}]];
  var samples = [];
  segments.forEach((points) => {
    var index = 0;
    for (let ms = points[0].ms; ms <= points[points.length - 1].ms; ms += HEART_RATE_SECONDS * 1000) {
      while (index < points.length - 2 && points[index + 1].ms <= ms) index++;
      let elapsedSeconds = (ms - activity.startMs) / 1000;
      samples.push({seconds: elapsedSeconds + sample.integer(0, 999) / 1000,
                    heartRate: heartRate(activity, elapsedSeconds, points[index + 1].effort)});
    }
  });
  return samples;
}

// The time zone offset of the home of the runner in minutes, with the summer time roughly from April to
// October.
function utcOffsetMinutes(date) {
  var month = parseInt(date.substring(5, 7), 10);
  return month >= 4 && month <= 10 ? 120 : 60;
}

function buildActivity(date, workoutKey, progress) {
  var workout = WORKOUTS[workoutKey];
  var hours = workout.race ? [9, 9] : START_HOURS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  var localMs = Date.parse(`${date}T00:00:00Z`) + sample.integer(hours[0] * 3600, hours[1] * 3600 + 3599) * 1000;
  var plannedKm = workout.km[0] === workout.km[1] ? workout.km[0] :
    sample.decimal(workout.km[0], workout.km[1]) + (workout.growKm || 0) * progress;
  var activity = {
    id: sample.uuid(),
    type: workout.type,
    workout: workout,
    progress: progress,
    localMs: localMs,
    startMs: localMs - utcOffsetMinutes(date) * MINUTE_MS,
    plannedKm: plannedKm,
    speedKmh: workout.speed ? sample.decimal(workout.speed[0], workout.speed[1]) :
      3600 / (easyPace(progress) + workout.paceOffset + sample.integer(-8, 8))
  };
  if (workout.indoor) {
    activity.distanceKm = plannedKm;
    activity.durationSeconds = Math.round(plannedKm / activity.speedKmh * 3600);
    activity.climbM = 0;
  } else {
    activity.segments = buildTrack(activity);
    activity.distanceKm = 0;
    activity.durationSeconds = 0;
    activity.climbM = 0;
    activity.segments.forEach((points) => {
      for (let index = 1; index < points.length; index++) {
        activity.distanceKm += distanceMeters(points[index - 1], points[index]) / 1000;
        activity.durationSeconds += (points[index].ms - points[index - 1].ms) / 1000;
        activity.climbM += Math.max(0, Math.round(points[index].elevation * 10) / 10 -
          Math.round(points[index - 1].elevation * 10) / 10);
      }
    });
  }
  activity.heartRates = heartRateSamples(activity);
  activity.friends = (workout.friends || []).filter((friend) => sample.chance(friend[1] / 100)).map((friend) => friend[0]);
  activity.routeName = workout.routes && sample.chance(workout.race ? 1 : 0.5) ? sample.pick(workout.routes) : "";
  activity.notes = workout.notes && sample.chance(workout.noteChance) ? sample.pick(workout.notes) : "";
  return activity;
}

// The activities of every day of the history until yesterday. A race takes the place of the workout of its
// Sunday, and the runner rests on the day before it.
var raceWorkouts = {};
RACES.forEach((race) => {
  var date = sample.daysAgo(race[0]);
  raceWorkouts[sample.daysAgo(race[0] + new Date(`${date}T00:00:00Z`).getUTCDay())] = race[1];
});
var activities = [];
for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
  let date = sample.daysAgo(daysAgo);
  if (raceWorkouts[sample.daysAgo(daysAgo - 1)]) continue;
  let progress = 1 - daysAgo / HISTORY_DAYS;
  let workoutKey = raceWorkouts[date] || plannedWorkout(date, progress);
  if (workoutKey) activities.push(buildActivity(date, workoutKey, progress));
}

// The archive needs a count of entries made of bytes below 0x80 as well, so the oldest activities are left
// out until it is.
var entriesCount = () => 2 + activities.filter((activity) => activity.segments).length;
while (!isTextSafe(entriesCount())) activities.shift();

// The export, the newest activity first, as Runkeeper writes it.
activities.reverse();

function pad2(number) {
  return number < 10 ? `0${number}` : String(number);
}

// "28:21" or "1:13:28".
function durationText(seconds) {
  var rounded = Math.round(seconds);
  var hours = Math.floor(rounded / 3600), minutes = Math.floor(rounded % 3600 / 60), rest = rounded % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(rest)}` : `${minutes}:${pad2(rest)}`;
}

function localDateTime(activity) {
  return new Date(activity.localMs).toISOString().substring(0, 19).replace("T", " ");
}

function gpxFileName(activity) {
  return `${localDateTime(activity).replace(" ", "-").replace(/:/g, "")}.gpx`;
}

function isoTime(ms) {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

// Runkeeper quotes the friends and the notes, and leaves the other values unquoted.
function quoted(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cardioActivitiesCsv() {
  var lines = ["Activity Id,Date,Type,Route Name,Distance (km),Duration,Average Pace,Average Speed (km/h)," +
    "Calories Burned,Climb (m),Average Heart Rate (bpm),Friend's Tagged,Notes,GPX File"];
  activities.forEach((activity) => {
    var averageHeartRate = activity.heartRates.length === 0 ? "" :
      Math.round(_.reduce(activity.heartRates, (sum, heartRate) => sum + heartRate.heartRate, 0) / activity.heartRates.length);
    var calories = activity.distanceKm * TYPES[activity.type].caloriesPerKm * sample.decimal(0.95, 1.05);
    lines.push([
      activity.id, localDateTime(activity), activity.type, activity.routeName, activity.distanceKm.toFixed(2),
      durationText(activity.durationSeconds), durationText(activity.durationSeconds / activity.distanceKm),
      (activity.distanceKm * 3600 / activity.durationSeconds).toFixed(2), calories.toFixed(1),
      Math.round(activity.climbM), averageHeartRate,
      quoted(activity.friends.map((friend) => `${friend},`).join("")), quoted(activity.notes),
      activity.segments ? gpxFileName(activity) : ""
    ].join(","));
  });
  return lines.join("\n");
}

function heartRateCsv() {
  var lines = ["Activity Id, Timestamp, Heart Rate"];
  activities.forEach((activity) => {
    activity.heartRates.forEach((heartRate) => {
      lines.push(`${activity.id},${heartRate.seconds.toFixed(3)},${heartRate.heartRate}`);
    });
  });
  return lines.join("\n");
}

// "Running 9/24/26 7:03 am".
function gpxName(activity) {
  var local = new Date(activity.localMs);
  var hour = local.getUTCHours();
  return `${activity.type} ${local.getUTCMonth() + 1}/${local.getUTCDate()}/${String(local.getUTCFullYear()).substring(2)} ` +
    `${hour % 12 === 0 ? 12 : hour % 12}:${pad2(local.getUTCMinutes())} ${hour < 12 ? "am" : "pm"}`;
}

function gpx(activity) {
  var lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<gpx",
    '  version="1.1"',
    '  creator="Runkeeper - http://www.runkeeper.com"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xmlns="http://www.topografix.com/GPX/1/1"',
    '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"',
    '  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    "<trk>",
    `  <name><![CDATA[${gpxName(activity)}]]></name>`,
    `  <time>${isoTime(activity.startMs)}</time>`
  ];
  activity.segments.forEach((points) => {
    lines.push("<trkseg>");
    points.forEach((point) => {
      lines.push(`<trkpt lat="${point.lat.toFixed(9)}" lon="${point.lon.toFixed(9)}">` +
        `<ele>${point.elevation.toFixed(1)}</ele><time>${isoTime(point.ms)}</time></trkpt>`);
    });
    lines.push("</trkseg>");
  });
  lines.push("</trk>", "</gpx>");
  return lines.join("\n");
}

// A ZIP archive written of characters below 0x80, so that it reaches the downloaded file unchanged. Its
// entries are stored, uncompressed ASCII text, and every number of its headers must be made of bytes below
// 0x80 too: the CRC-32 and the size of each entry, the offset where each entry starts, the count of the
// entries, and the size and the offset of the central directory. Each file ends with as many spaces after
// its last value as it takes to give its CRC-32 and its size such bytes — the importer trims the values,
// and a GPX file may end with spaces — and spaces between the entries move each one to such an offset: a
// ZIP reader finds the entries by the offsets of the central directory. Such an offset lies in the lower
// half of every 64 KB and below 8 MB, so the entries are written in the order which leaves the fewest
// spaces between them, and the archive must stay under 8 MB.
var LOCAL_HEADER_BYTES = 30, CENTRAL_HEADER_BYTES = 46;
var CRC_TABLE = [];
for (let index = 0; index < 256; index++) {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
  CRC_TABLE.push(crc >>> 0);
}

function isTextSafe(number) {
  return number >= 0 && number < 0x80000000 && (number & 0x80808080) === 0;
}

// The smallest number from the given one on whose every byte is below 0x80.
function nextTextSafe(number) {
  var next = number;
  while (!isTextSafe(next)) {
    if (next >= 0x80000000) throw new Error(`No text safe number from ${number}`);
    for (let unit = 0x1000000; unit >= 1; unit /= 256) {
      if (Math.floor(next / unit) % 256 >= 0x80) {
        next = (Math.floor(next / unit / 256) + 1) * unit * 256;
        break;
      }
    }
  }
  return next;
}

function crcUpdate(crc, text) {
  var value = crc;
  for (let index = 0; index < text.length; index++) {
    value = CRC_TABLE[(value ^ text.charCodeAt(index)) & 0xFF] ^ (value >>> 8);
  }
  return value;
}

// The little endian bytes of a number.
function littleEndian(number, bytes) {
  var text = "";
  for (let index = 0; index < bytes; index++) text += String.fromCharCode(Math.floor(number / Math.pow(256, index)) % 256);
  return text;
}

function spaces(count) {
  return new Array(count + 1).join(" ");
}

// The text of the file with the spaces and the line break at its end which make its size and its CRC-32
// text safe, and the header fields of its entry.
function zipEntry(file, dosDate) {
  var state = crcUpdate(0xFFFFFFFF, file.text);
  var padding = 0;
  for (;;) {
    let size = file.text.length + padding + 1;
    if (!isTextSafe(size)) {
      let more = nextTextSafe(size) - size;
      state = crcUpdate(state, spaces(more));
      padding += more;
      continue;
    }
    let crc = (crcUpdate(state, "\n") ^ 0xFFFFFFFF) >>> 0;
    if (isTextSafe(crc)) {
      // The version needed to extract, no flags, stored, the time and the date, the CRC-32, the compressed and
      // the uncompressed size, the length of the name and no extra field.
      let fields = littleEndian(20, 2) + littleEndian(0, 2) + littleEndian(0, 2) + littleEndian(0, 2) +
        littleEndian(dosDate, 2) + littleEndian(crc, 4) + littleEndian(size, 4) + littleEndian(size, 4) +
        littleEndian(file.name.length, 2) + littleEndian(0, 2);
      return {name: file.name, fields: fields, data: file.text + spaces(padding) + "\n",
              bytes: LOCAL_HEADER_BYTES + file.name.length + size};
    }
    state = crcUpdate(state, " ");
    padding++;
  }
}

function zipArchive(files) {
  if (!isTextSafe(files.length)) throw new Error(`A ZIP archive of ${files.length} entries is not text safe`);
  // January 1 of this year, which has text safe bytes until 2043.
  var dosDate = (parseInt(sample.today().substring(0, 4), 10) - 1980) * 512 + 32 + 1;
  var entries = files.map((file) => zipEntry(file, dosDate));
  var parts = [], central = [];
  var offset = 0;
  while (entries.length > 0) {
    // The entry after which the next one can start soonest, and the longest of them, so that the short ones
    // are left to fill the rest of the lower half of a 64 KB.
    let entry = _.min(entries, (candidate) => {
      let end = offset + candidate.bytes;
      return (nextTextSafe(end) - end) * 0x1000000 - candidate.bytes;
    });
    entries = _.without(entries, entry);
    parts.push("PK\u0003\u0004", entry.fields, entry.name, entry.data);
    central.push({entry: entry, offset: offset});
    let end = offset + entry.bytes;
    offset = nextTextSafe(end);
    parts.push(spaces(offset - end));
  }
  var centralSize = _.reduce(central, (sum, item) => sum + CENTRAL_HEADER_BYTES + item.entry.name.length, 0);
  // The comments of the last entries make the size of the central directory text safe. A comment length is
  // text safe up to 0x7F, and a size with a low byte of 0x80 needs 128 bytes more, so the comments share them.
  var commentsLength = nextTextSafe(centralSize) - centralSize;
  if (commentsLength > 0x7F * central.length) throw new Error(`The central directory of ${centralSize} bytes is too large`);
  central.forEach((item, index) => {
    var entriesAfter = central.length - 1 - index;
    var comment = spaces(Math.max(0, Math.min(0x7F, commentsLength - 0x7F * entriesAfter)));
    // Made by version 2.0 on MS-DOS, the fields of the local header, the comment length, the disk, no
    // attributes and the offset of the local header.
    parts.push("PK\u0001\u0002", littleEndian(20, 2), item.entry.fields, littleEndian(comment.length, 2),
      littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 4), littleEndian(item.offset, 4), item.entry.name,
      comment);
  });
  parts.push("PK\u0005\u0006", littleEndian(0, 2), littleEndian(0, 2), littleEndian(files.length, 2),
    littleEndian(files.length, 2), littleEndian(centralSize + commentsLength, 4), littleEndian(offset, 4),
    littleEndian(0, 2));
  return parts.join("");
}

var files = [{name: "cardioActivities.csv", text: cardioActivitiesCsv()}, {name: "heartRate.csv", text: heartRateCsv()}].
  concat(activities.filter((activity) => activity.segments).map((activity) => ({name: gpxFileName(activity), text: gpx(activity)})));
mock.get(EXPORT_URL, {body: zipArchive(files), headers: {"Content-Type": "application/zip"}});
