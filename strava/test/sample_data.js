// The sample data of the Strava sample reports: the account export of an invented athlete with a little more
// than two years of activities. The athlete runs two to four times a week — easy runs, tempo and interval runs
// on weekdays and a long run on Saturday, on the treadmill now and then in the winter — rides a road bike
// on summer Sundays and a gravel bike in the spring and the autumn, skis in the winter, walks and hikes,
// runs a half marathon every year and a first marathon a month ago. The athlete gets fitter over the years:
// the runs get longer and faster at a lower heart rate. A heart rate monitor came a few months after the first
// activities, a power meter on the road bike later, and the worn road shoes were replaced by a new pair.
// Every name is invented.
//
// The export is a ZIP file of activities.csv, general_preferences.csv and the activity file of every
// activity: a GPX track of an outdoor activity and a TCX file without positions of a treadmill run. A mocked
// response body is text which reaches the downloaded file as UTF-8, where a character of 0x80 or more takes
// two bytes, so the archive is written of characters below 0x80 only: its entries are stored uncompressed
// and are ASCII text, and every number of its headers is made of bytes below 0x80 (see zipArchive).
sample.seed(31);

var EXPORT_URL = "https://files.example.com/strava-export.zip";
var HISTORY_DAYS = 800;
var MAX_HEART_RATE = 188;
var MINUTE_MS = 60 * 1000;

// Activity Date is in UTC, so the Time, Hour and Week Day dimensions show the local start in the home time
// zone of the athlete.
mock.sourceParams({export_url: EXPORT_URL});
mock.extraOptions({skip_implausible_activities: true, time_dimension_time_zone: "Europe/Paris"});

// Where the routes of the athlete start, and the meters of one degree of latitude.
var HOME = {lat: 45.899247, lon: 6.129384, elevation: 448};
var DEGREE_METERS = 111320;

// The activity types of Strava: the calories per km, the height of the hills of their routes in meters, the
// steps per minute and the type of their GPX file.
var TYPES = {
  "Run": {caloriesPerKm: 68, hills: 12, stepsPerMinute: 168, gpxType: "running"},
  "Ride": {caloriesPerKm: 24, hills: 45, gpxType: "cycling"},
  "Walk": {caloriesPerKm: 52, hills: 8, stepsPerMinute: 112, gpxType: "walking"},
  "Hike": {caloriesPerKm: 74, hills: 160, stepsPerMinute: 104, gpxType: "hiking"},
  "Nordic Ski": {caloriesPerKm: 48, hills: 25, gpxType: "nordic_ski"}
};
// A device records a point every second or two. These points are further apart so that the archive stays
// small (see zipArchive), but not more than the importer counts the heart rate of a point. A longer step
// would leave a part of the moving time out of the heart rate zones, and a longer step without a position
// would be a pause.
var POINT_SECONDS = app.importers.tracks.MAX_SAMPLE_SECONDS;
var HEART_RATE_MONITOR_PROGRESS = 0.15;
var POWER_METER_PROGRESS = 0.4;
var NEW_ROAD_SHOES_PROGRESS = 0.7;

// The workouts of the athlete. A run has the pace of its workout relative to the easy pace of the day,
// which gets faster with the fitness of the athlete, and the other types a speed in km/h. The heart rate
// is the average of the workout, the profile the changes of the speed within it (see effort), growKm
// the kilometers that the workout gets longer over the history, gear the gear of activities.csv (see
// gearOf), and titles the titles which the athlete gives instead of the title which Strava gives.
var WORKOUTS = {
  easy: {type: "Run", km: [5, 8], growKm: 2, paceOffset: 25, heartRate: 148, gear: "road",
         descriptions: ["Felt strong", "Windy, cold hands", "Rain the whole way", "Legs heavy after yesterday"],
         descriptionChance: 0.15},
  recovery: {type: "Run", km: [4, 6], paceOffset: 50, heartRate: 140, gear: "road", titles: ["Recovery run"],
             titleChance: 0.5},
  tempo: {type: "Run", km: [7, 10], paceOffset: -30, heartRate: 165, profile: "tempo", gear: "tempo",
          titles: ["Tempo run", "Threshold Thursday"], titleChance: 1, descriptions: ["5 km at threshold"],
          descriptionChance: 0.5},
  intervals: {type: "Run", km: [6, 9], paceOffset: 0, heartRate: 160, profile: "intervals", gear: "tempo",
              titles: ["Intervals 6 x 800 m", "Intervals 5 x 1 km"], titleChance: 1},
  long: {type: "Run", km: [11, 16], growKm: 6, paceOffset: 40, heartRate: 150, profile: "fade", gear: "long",
         titles: ["Long run", "Long run by the lake"], titleChance: 0.6, descriptions: ["With gels"],
         descriptionChance: 0.2},
  treadmill: {type: "Run", km: [5, 8], paceOffset: 20, heartRate: 151, indoor: true, gear: "road",
              titles: ["Treadmill run"], titleChance: 1},
  halfMarathon: {type: "Run", km: [21.1, 21.1], paceOffset: -25, heartRate: 173, profile: "race", race: true,
                 gear: "race", titles: ["Lakeside half marathon"], titleChance: 1},
  marathon: {type: "Run", km: [42.2, 42.2], paceOffset: 15, heartRate: 163, profile: "fade", race: true,
             gear: "race", titles: ["First marathon!"], titleChance: 1,
             descriptions: ["Finished strong, so happy"], descriptionChance: 1},
  ride: {type: "Ride", km: [25, 50], growKm: 10, speed: [23, 28], heartRate: 132, gear: "bike",
         titles: ["Lake loop", "Hill repeats", "Coffee ride"], titleChance: 0.4},
  hike: {type: "Hike", km: [8, 16], speed: [3.4, 4.6], heartRate: 121, gear: "boots",
         titles: ["Ridge hike", "Waterfall trail"], titleChance: 0.5},
  walk: {type: "Walk", km: [3, 6], speed: [4.8, 5.8], heartRate: 102, noMonitorChance: 0.4},
  ski: {type: "Nordic Ski", km: [10, 20], speed: [9, 13], heartRate: 146, titles: ["Skating on the plateau"],
        titleChance: 0.3}
};

// The share of the planned runs that the athlete does in each month.
var RUN_MONTH_FACTORS = [0.7, 0.75, 0.9, 1, 1, 1, 0.9, 0.95, 1, 0.95, 0.8, 0.65];
// The local start hours of the activities of each week day, Sunday first.
var START_HOURS = [[8, 11], [17, 20], [6, 8], [17, 20], [12, 13], [11, 13], [7, 10]];
// The races, by how many days ago they were, moved back to the Sunday before.
var RACES = [[595, "halfMarathon"], [230, "halfMarathon"], [30, "marathon"]];

// The easy pace in seconds per km, from 6:10 at the start of the history to 5:25 now.
function easyPace(progress) {
  return 370 - 45 * progress;
}

// The workout of the day, or null on a rest day: more runs in the summer, and more of them as the athlete
// gets fitter. Every activity type and week day occurs several times in any 12 months, because the dates
// are relative to today and the tests expect each of them in the last 12 months.
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
    case 1: return sample.chance(0.25) ? "walk" : null;
    case 2: return run(0.75, sample.chance(0.8) ? "easy" : "recovery");
    case 3: return run(0.15, "easy") || (sample.chance(0.1) ? "walk" : null);
    case 4: return run(0.75, sample.pickWeighted([["tempo", 40], ["intervals", 35], ["easy", 25]]));
    case 5: return run(0.3, "easy");
    case 6: return run(0.7, "long");
    default:
      if (summer) return sample.pickWeighted([["ride", 45], ["hike", 30], [null, 25]]);
      if (winter) return sample.pickWeighted([["ski", 80], ["walk", 15], [null, 5]]);
      return sample.pickWeighted([["walk", 30], ["ride", 10], ["hike", 20], [null, 40]]);
  }
}

// The gear of the activity: the road shoes of the time, trail shoes for some long runs, race shoes for the
// races and some tempo runs, the road bike in the summer and the gravel bike in the other months, the hiking
// boots, or none.
function gearOf(workout, date, progress) {
  var roadShoes = progress < NEW_ROAD_SHOES_PROGRESS ? "Road shoes (blue)" : "Road shoes (orange)";
  switch (workout.gear) {
    case "road": return roadShoes;
    case "long": return sample.chance(0.3) ? "Trail shoes" : roadShoes;
    case "tempo": return sample.chance(0.4) ? "Race shoes" : roadShoes;
    case "race": return "Race shoes";
    case "bike": return ["06", "07", "08"].includes(date.substring(5, 7)) ? "Road bike" : "Gravel bike";
    case "boots": return "Hiking boots";
    default: return "";
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

// The heart rate at a point of the activity: rising during the first minutes, drifting up during a long
// activity and following the speed of the workout.
function heartRate(activity, elapsedSeconds, pointEffort) {
  var average = activity.workout.heartRate - (activity.type === "Run" ? 6 * activity.progress : 0);
  var rate = average + (pointEffort - 1) * (activity.type === "Run" ? 85 : 40) + elapsedSeconds / 3600 * 4;
  rate = 95 + (rate - 95) * Math.min(1, 0.65 + elapsedSeconds / 900);
  return Math.max(80, Math.min(193, Math.round(rate + sample.integer(-3, 3))));
}

// The points of the activity as {lat, lon, elevation, ms, hr} — without a position on a treadmill. An
// outdoor activity is a loop from home and back, with a pause in some of them. Strava writes the points of
// an activity as one track segment and no points during a pause, so the pause is a gap of time between two
// points at the same position.
function buildPoints(activity) {
  var plannedMeters = activity.plannedKm * 1000;
  var speed = activity.speedKmh / 3.6;
  var kmFactors = sample.times(Math.ceil(activity.plannedKm) + 1, () => 1 + sample.decimal(-0.04, 0.04, 3));
  var hills = {height: TYPES[activity.type].hills * sample.decimal(0.5, 1.5), wave: sample.integer(700, 2500),
               phase: sample.decimal(0, 6.28)};
  var pauseAtMeters = !activity.workout.indoor && activity.type !== "Ride" && sample.chance(0.2) ?
    plannedMeters * sample.decimal(0.3, 0.7) : null;
  var heading = sample.decimal(0, 2 * Math.PI, 3);
  var position = {lat: HOME.lat + sample.decimal(-0.01, 0.01, 6), lon: HOME.lon + sample.decimal(-0.01, 0.01, 6)};
  var start = {lat: position.lat, lon: position.lon};
  var ms = activity.startMs, meters = 0;
  var points = [];
  var addPoint = (pointEffort) => {
    var point = {ms: ms, hr: activity.hasMonitor ? heartRate(activity, (ms - activity.startMs) / 1000, pointEffort) : null,
                 meters: meters, effort: pointEffort};
    if (!activity.workout.indoor) {
      point.lat = position.lat;
      point.lon = position.lon;
      point.elevation = HOME.elevation + hills.height * (Math.sin(meters / hills.wave + hills.phase) +
        Math.sin(meters / (hills.wave / 3.7)) / 3);
    }
    points.push(point);
  };
  addPoint(1);
  while (meters < plannedMeters) {
    let stepEffort = effort(activity.workout.profile, meters, plannedMeters) * kmFactors[Math.floor(meters / 1000)];
    let stepMeters = speed * stepEffort * POINT_SECONDS;
    let stepSeconds = POINT_SECONDS;
    if (meters + stepMeters > plannedMeters) {
      stepSeconds = Math.max(1, Math.round(POINT_SECONDS * (plannedMeters - meters) / stepMeters));
      stepMeters = plannedMeters - meters;
    }
    if (!activity.workout.indoor) {
      // Wander, and head back home in the second half.
      if (meters > plannedMeters / 2) {
        let home = Math.atan2((start.lon - position.lon) * Math.cos(position.lat * Math.PI / 180), start.lat - position.lat);
        let turn = Math.atan2(Math.sin(home - heading), Math.cos(home - heading));
        heading += turn * Math.min(1, 0.15 + meters / plannedMeters / 2);
      }
      heading += sample.decimal(-0.25, 0.25, 3);
      position.lat += stepMeters * Math.cos(heading) / DEGREE_METERS;
      position.lon += stepMeters * Math.sin(heading) / (DEGREE_METERS * Math.cos(position.lat * Math.PI / 180));
    }
    meters += stepMeters;
    ms += stepSeconds * 1000;
    addPoint(stepEffort);
    if (pauseAtMeters !== null && meters >= pauseAtMeters) {
      pauseAtMeters = null;
      ms += sample.integer(40, 240) * 1000;
      addPoint(stepEffort);
    }
  }
  return points;
}

// The UTC offset of the home time zone of the athlete in minutes: the summer time of the European Union
// lasts from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October.
function utcOffsetMinutes(utcMs) {
  var year = new Date(utcMs).getUTCFullYear();
  var lastSunday = (month) => {
    var last = new Date(Date.UTC(year, month + 1, 0));
    return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
  };
  return utcMs >= lastSunday(2) && utcMs < lastSunday(9) ? 120 : 60;
}

// The title which Strava gives an activity by its local start hour, for example "Morning Run".
function stravaTitle(type, localHour) {
  var time = localHour < 4 ? "Night" : localHour < 11 ? "Morning" : localHour < 14 ? "Lunch" :
    localHour < 17 ? "Afternoon" : localHour < 21 ? "Evening" : "Night";
  return `${time} ${type}`;
}

// The relative effort of Strava grows with the moving minutes in each heart rate zone, more in the higher
// zones.
var RELATIVE_EFFORT_PER_ZONE_MINUTE = [0, 0.5, 1, 1.6, 2.6, 4];

function relativeEffort(points) {
  var effortPoints = 0;
  for (let index = 1; index < points.length; index++) {
    let from = points[index - 1], to = points[index];
    if (to.meters === from.meters) continue;
    let zone = app.importers.heartRates.zone(to.hr, MAX_HEART_RATE);
    effortPoints += RELATIVE_EFFORT_PER_ZONE_MINUTE[zone.key] * (to.ms - from.ms) / MINUTE_MS;
  }
  return Math.round(effortPoints);
}

// The Activity Strava URL opens the activity of the id. Real Strava activity ids are below 20 billion in
// 2026, so these ids open no activity of a real athlete.
var nextActivityId = 900000000000000;

function buildActivity(date, workoutKey, progress) {
  var workout = WORKOUTS[workoutKey];
  var hours = workout.race ? [9, 9] : START_HOURS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  var localMs = Date.parse(`${date}T00:00:00Z`) + sample.integer(hours[0] * 3600, hours[1] * 3600 + 3599) * 1000;
  var startMs = localMs - utcOffsetMinutes(localMs) * MINUTE_MS;
  nextActivityId += sample.integer(2000000, 9000000);
  var activity = {
    id: nextActivityId,
    type: workout.type,
    workout: workout,
    progress: progress,
    startMs: startMs,
    plannedKm: workout.km[0] === workout.km[1] ? workout.km[0] :
      sample.decimal(workout.km[0], workout.km[1]) + (workout.growKm || 0) * progress,
    speedKmh: workout.speed ? sample.decimal(workout.speed[0], workout.speed[1]) :
      3600 / (easyPace(progress) + workout.paceOffset + sample.integer(-8, 8)),
    hasMonitor: progress >= HEART_RATE_MONITOR_PROGRESS &&
      !(workout.noMonitorChance && sample.chance(workout.noMonitorChance))
  };
  activity.points = buildPoints(activity);
  measure(activity);
  var title = workout.titles && sample.chance(workout.titleChance) ? sample.pick(workout.titles) : null;
  activity.title = title || stravaTitle(activity.type, new Date(localMs).getUTCHours());
  activity.description = workout.descriptions && sample.chance(workout.descriptionChance) ?
    sample.pick(workout.descriptions) : "";
  activity.gear = gearOf(workout, date, progress);
  activity.watts = activity.gear === "Road bike" && progress >= POWER_METER_PROGRESS ?
    Math.round(150 + 35 * progress + sample.integer(-15, 15)) : null;
  activity.fileName = `${activity.id}.${workout.indoor ? "tcx" : "gpx"}`;
  return activity;
}

// The distance, the moving and the elapsed time, the climb, the maximum speed and the heart rate of the
// points of the activity. A step at the same position is a pause, which is no moving time.
function measure(activity) {
  var points = activity.points;
  activity.distanceM = 0;
  activity.movingSeconds = 0;
  activity.climbM = 0;
  activity.maxSpeed = 0;
  for (let index = 1; index < points.length; index++) {
    let from = points[index - 1], to = points[index];
    let meters = activity.workout.indoor ? to.meters - from.meters : app.importers.tracks.distanceMeters(from, to);
    let seconds = (to.ms - from.ms) / 1000;
    activity.distanceM += meters;
    if (meters > 0) {
      activity.movingSeconds += seconds;
      activity.maxSpeed = Math.max(activity.maxSpeed, meters / seconds);
    }
    if (!activity.workout.indoor) activity.climbM += Math.max(0, to.elevation - from.elevation);
  }
  activity.elapsedSeconds = (points[points.length - 1].ms - points[0].ms) / 1000 + sample.integer(0, 30);
  activity.maxSpeed *= sample.decimal(1.03, 1.12);
  if (activity.hasMonitor) {
    activity.maxHeartRate = _.max(points.map((point) => point.hr));
    activity.averageHeartRate = _.reduce(points, (sum, point) => sum + point.hr, 0) / points.length;
    activity.relativeEffort = relativeEffort(points);
  }
}

// The activities of every day of the history until yesterday. A race takes the place of the workout of its
// Sunday, and the athlete rests on the day before it.
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

var MONTH_NAMES = Object.keys(app.importers.rows.MONTHS);

function pad2(number) {
  return number < 10 ? `0${number}` : String(number);
}

// "Sep 24, 2026, 4:03:32 AM" in UTC, as activities.csv of an English export writes it.
function activityDate(ms) {
  var date = new Date(ms);
  var hour = date.getUTCHours();
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ` +
    `${hour % 12 === 0 ? 12 : hour % 12}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} ${hour < 12 ? "AM" : "PM"}`;
}

function isoTime(ms) {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

// Strava quotes a value with a comma, a quote or a line break, and leaves the others unquoted.
function csvValue(value) {
  var text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// The columns of activities.csv of an English export. Five names are repeated: the first Elapsed Time and
// Distance are display values, the later ones exact seconds and meters.
var ACTIVITY_COLUMNS = [
  "Activity ID", "Activity Date", "Activity Name", "Activity Type", "Activity Description", "Elapsed Time",
  "Distance", "Max Heart Rate", "Relative Effort", "Commute", "Activity Private Note", "Activity Gear", "Filename",
  "Athlete Weight", "Bike Weight", "Elapsed Time", "Moving Time", "Distance", "Max Speed", "Average Speed",
  "Elevation Gain", "Elevation Loss", "Elevation Low", "Elevation High", "Max Grade", "Average Grade",
  "Average Positive Grade", "Average Negative Grade", "Max Cadence", "Average Cadence", "Max Heart Rate",
  "Average Heart Rate", "Max Watts", "Average Watts", "Calories", "Max Temperature", "Average Temperature",
  "Relative Effort", "Total Work", "Number of Runs", "Uphill Time", "Downhill Time", "Other Time",
  "Perceived Exertion", "Type", "Start Time", "Weighted Average Power", "Power Count", "Prefer Perceived Exertion",
  "Perceived Relative Effort", "Commute", "Total Weight Lifted", "From Upload", "Grade Adjusted Distance",
  "Weather Observation Time", "Weather Condition", "Weather Temperature", "Apparent Temperature", "Dewpoint",
  "Humidity", "Weather Pressure", "Wind Speed", "Wind Gust", "Wind Bearing", "Precipitation Intensity",
  "Sunrise Time", "Sunset Time", "Moon Phase", "Bike", "Gear", "Precipitation Probability", "Precipitation Type",
  "Cloud Cover", "Weather Visibility", "UV Index", "Weather Ozone", "Jump Count", "Total Grit", "Average Flow",
  "Flagged", "Average Elapsed Speed", "Dirt Distance", "Newly Explored Distance", "Newly Explored Dirt Distance",
  "Activity Count", "Total Steps", "Carbon Saved", "Pool Length", "Training Load", "Intensity",
  "Average Grade Adjusted Pace", "Timer Time", "Total Cycles", "Recovery", "With Pet", "Competition", "Long Run",
  "For a Cause", "With Kid", "Downhill Distance", "Total Sets", "Total Reps", "Media"
];

// The cells of one row of activities.csv, set by the column name and, for a repeated name, by its first
// or last occurrence.
function activityRow(values) {
  var cells = ACTIVITY_COLUMNS.map(() => "");
  values.forEach((value) => {
    var index = value[2] === "last" ? ACTIVITY_COLUMNS.lastIndexOf(value[0]) : ACTIVITY_COLUMNS.indexOf(value[0]);
    if (index < 0) throw new Error(`${app.api.ACTIVITIES_ENTRY} has no ${value[0]} column`);
    cells[index] = csvValue(value[1]);
  });
  return cells.join(",");
}

function activitiesCsv() {
  var lines = [ACTIVITY_COLUMNS.join(",")];
  activities.forEach((activity) => {
    var type = TYPES[activity.type];
    var calories = activity.distanceM / 1000 * type.caloriesPerKm * sample.decimal(0.95, 1.05);
    var steps = type.stepsPerMinute ?
      `${Math.round(activity.movingSeconds / 60 * type.stepsPerMinute * sample.decimal(0.96, 1.04))}.0` : "";
    var heartRates = activity.hasMonitor ? [
      ["Max Heart Rate", `${activity.maxHeartRate}.0`], ["Max Heart Rate", `${activity.maxHeartRate}.0`, "last"],
      ["Average Heart Rate", activity.averageHeartRate.toFixed(1)],
      ["Relative Effort", activity.relativeEffort], ["Relative Effort", `${activity.relativeEffort}.0`, "last"]
    ] : [];
    lines.push(activityRow([
      ["Activity ID", activity.id],
      ["Activity Date", activityDate(activity.startMs)],
      ["Activity Name", activity.title],
      ["Activity Type", activity.type],
      ["Activity Description", activity.description],
      ["Elapsed Time", Math.round(activity.elapsedSeconds)],
      ["Distance", (activity.distanceM / 1000).toFixed(2)],
      ["Commute", "false"],
      ["Activity Gear", activity.gear],
      ["Filename", `activities/${activity.fileName}`],
      ["Elapsed Time", activity.elapsedSeconds.toFixed(1), "last"],
      ["Moving Time", activity.movingSeconds.toFixed(1)],
      ["Distance", activity.distanceM.toFixed(1), "last"],
      ["Max Speed", activity.maxSpeed.toFixed(3)],
      ["Average Speed", (activity.distanceM / activity.movingSeconds).toFixed(3)],
      ["Elevation Gain", activity.workout.indoor ? "0.0" : activity.climbM.toFixed(1)],
      ["Average Watts", activity.watts === null ? "" : `${activity.watts}.0`],
      ["Calories", calories.toFixed(1)],
      ["From Upload", "1.0"],
      ["Total Steps", steps]
    ].concat(heartRates)));
  });
  return lines.join("\n");
}

function generalPreferencesCsv() {
  return [
    "Date of Birth,Weight,Functional Threshold Power,Maximum Heartrate,Athlete Type,Measurement Preference," +
      "Date Preference,Chart Preference,Email Language,Pace Zone Time,Pace Zone Distance,Default Leaderboard View",
    `"Mar 3, 1991",64.0 kg,,${MAX_HEART_RATE},Runner,Metric,mm/dd/YYYY,Week,English,0:30:00,Five Kilometers,All`
  ].join("\n");
}

function heartRateExtension(point) {
  return point.hr === null ? "" :
    `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${point.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
}

// A GPX file as Strava writes it, with one track point per line to keep it small.
function gpx(activity) {
  var lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    ` <metadata><time>${isoTime(activity.startMs)}</time></metadata>`,
    " <trk>",
    `  <name>${activity.title}</name>`,
    `  <type>${TYPES[activity.type].gpxType}</type>`,
    "  <trkseg>"
  ];
  activity.points.forEach((point) => {
    lines.push(`<trkpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}"><ele>${point.elevation.toFixed(1)}</ele>` +
      `<time>${isoTime(point.ms)}</time>${heartRateExtension(point)}</trkpt>`);
  });
  lines.push("  </trkseg>", " </trk>", "</gpx>");
  return lines.join("\n");
}

// A TCX file of a watch on a treadmill: the time, the distance and the heart rate of every point, no position.
function tcx(activity) {
  var lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">',
    " <Activities>",
    '  <Activity Sport="Running">',
    `   <Id>${isoTime(activity.startMs)}</Id>`,
    `   <Lap StartTime="${isoTime(activity.startMs)}">`,
    `    <TotalTimeSeconds>${activity.movingSeconds.toFixed(1)}</TotalTimeSeconds>`,
    `    <DistanceMeters>${activity.distanceM.toFixed(1)}</DistanceMeters>`,
    "    <Track>"
  ];
  activity.points.forEach((point) => {
    var heartRateValue = point.hr === null ? "" : `<HeartRateBpm><Value>${point.hr}</Value></HeartRateBpm>`;
    lines.push(`     <Trackpoint><Time>${isoTime(point.ms)}</Time><DistanceMeters>${point.meters.toFixed(1)}` +
      `</DistanceMeters>${heartRateValue}</Trackpoint>`);
  });
  lines.push("    </Track>", "   </Lap>", "  </Activity>", " </Activities>", "</TrainingCenterDatabase>");
  return lines.join("\n");
}

// A ZIP archive written of characters below 0x80, so that it reaches the downloaded file unchanged. Its
// entries are stored, uncompressed ASCII text, and every number of its headers must be made of bytes below
// 0x80 too: the CRC-32 and the size of each entry, the offset where each entry starts, the count of the
// entries, and the size and the offset of the central directory. Each file ends with as many spaces after
// its last value as it takes to give its CRC-32 and its size such bytes — the importer trims the values,
// and an activity file may end with spaces — and spaces between the entries move each one to such an
// offset: a ZIP reader finds the entries by the offsets of the central directory. Such an offset lies in
// the lower half of every 64 KB, so the entries are written in the order which leaves the fewest spaces
// between them. It is not from 8 MB to 16 MB either, so a larger archive gets 8 MB of spaces.
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

// A route which the athlete saved, as Strava writes it, without its points.
function routeGpx(number) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
    ` <trk><name>Route ${number}</name></trk>`,
    "</gpx>"
  ].join("\n");
}

var activityFiles = [
  {name: app.api.ACTIVITIES_ENTRY, text: activitiesCsv()},
  {name: app.api.PREFERENCES_ENTRY, text: generalPreferencesCsv()}
].concat(activities.map((activity) => ({
  name: `activities/${activity.fileName}`,
  text: activity.workout.indoor ? tcx(activity) : gpx(activity)
})));
// The count of the entries must be made of bytes below 0x80 as well (see zipArchive), so the export has as
// many saved routes as that count needs. The importer reads no route.
var routesCount = nextTextSafe(activityFiles.length) - activityFiles.length;
var files = activityFiles.concat(sample.times(routesCount, (index) => ({
  name: `routes/${index + 1}.gpx`,
  text: routeGpx(index + 1)
})));
mock.get(EXPORT_URL, {body: zipArchive(files), headers: {"Content-Type": "application/zip"}});
