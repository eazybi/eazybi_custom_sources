# Runkeeper for eazyBI

Imports your [Runkeeper](https://runkeeper.com/) activities into eazyBI as a cube named
**Runkeeper**, so that you can report on your distance, pace, heart rate and training habits over the
years: the activities themselves, the pace of every kilometer from the GPS tracks, and the time you
spent in each heart rate zone.

## Connecting

Runkeeper has no API that eazyBI could import from, so the data comes from the data export Runkeeper
prepares for you:

1. Sign in at [runkeeper.com](https://runkeeper.com/), open
   [runkeeper.com/exportData](https://runkeeper.com/exportData) and export your data for the whole
   period since your first activity. Download the ZIP file when it is ready — do not unpack it.
2. Put the ZIP file where eazyBI can download it with a link, and copy its sharing link:
   - **Dropbox** — upload the file, choose **Share > Copy link**. The link opens a preview page, and
     eazyBI turns it into the download link of the file itself (`dl=1`).
   - **Google Drive** — upload the file, choose **Share**, set **General access** to **Anyone with the
     link**, and **Copy link**. eazyBI downloads the file from the Google Drive download address of
     the same file.
   - **Any other HTTPS server**, such as an S3 bucket — a URL that answers the ZIP file itself.

   A plain HTTP link is not accepted, because it would send your GPS tracks and heart rates
   unencrypted.
3. Paste the link into the **Export file URL** field of the eazyBI connection form. Testing the
   connection reads only the end of the file, which lists the files in the ZIP, to check that the
   link answers a Runkeeper export and not a web page. The whole file is downloaded by the import.

To update the data, export again and replace the shared file with the new export so that the link
stays the same — in Dropbox upload the new file with the same name over the old one, in Google Drive
choose **Manage versions > Upload new version** of the file — then import again.

Everyone who has the link can download your export, with your GPS tracks. Share it with a link that is
not published anywhere, and remove the file when you no longer import it.

## Import options

| Option | Default | Effect |
|---|---|---|
| Skip implausible activities | on | leaves out the activities whose average speed is impossible for their type, see below |
| Maximum heart rate | the highest heart rate in the export | the heart rate in beats per minute that the heart rate zones are the percentages of |

### Implausible activities

A recording mistake — the tracking left running for hours after a run, or a run recorded while
traveling in a car or a bus — gives an activity an average speed no one runs at, and it would distort
the averages of its month: one 13 hour "run" of 1.66 km makes the average pace of the month look like
a walk. The import leaves such an activity out and names it in the import warnings, so that you can
delete or correct it in Runkeeper — its warning is gone with the first import of an export after that:

| Activity type | Plausible average speed |
|---|---|
| Running | 1–30 km/h |
| Walking | 1–15 km/h |
| Hiking | 0.5–15 km/h |
| Cycling | 1–80 km/h |
| Mountain Biking | 1–60 km/h |

An activity of one of these types with a distance of 0 and a duration has an average speed of 0 km/h,
and it is left out too. The other activity types have no meaningful speed and are always imported. Deselect **Skip implausible
activities** to import every activity as it is.

## What is imported

| File of the export | Becomes |
|---|---|
| `cardioActivities.csv` | one Activity member per activity, and the activity measures |
| the GPX track of each activity (`2026-09-23-070232.gpx`) | the kilometer splits, the Fastest km and the UTC offset of the activity |
| `heartRate.csv` | the Max heart rate and the time in the heart rate zones |

An export of all your data has the heart rate samples of every activity in `heartRate.csv`. An export
without that file still has the heart rate of each GPS track point, and the heart rate measures then
come from the GPX tracks. The photos, the step counts, the routes and the weight measurements of the
export are not imported.

## Dimensions

**Activity**, **Activity type** (Running, Cycling, Walking, …), **Distance range**, **Friend**,
**Hour**, **Kilometer**, **Heart rate zone**, **Time** and **Week Day**.

- **Time**, **Hour** and **Week Day** are the local date and time where the activity started, as
  Runkeeper shows them — a run at 7:00 in the morning on a trip abroad is a morning run too. The
  export gives these times without a time zone, so the **Time dimension time zone** import option
  does not change them.
- **Activity** members are named by the start, the type and the distance
  (`2026-09-24 07:03 Running 4.67 km`) — when two activities have the same name, the Runkeeper
  activity ID is appended to it in parentheses — and carry the **Start time**, **Route name**, **Notes**,
  **Friends**, **GPX file** and **UTC offset** (`+03:00`, from the GPS track) as properties. The
  **Activity properties** measures show them as report columns.
- **Distance range** buckets the activities into Under 5 km, 5-10 km, 10-21 km, 21-42 km and 42 km and
  more.
- **Friend** is a multi value dimension — an activity counts under each friend tagged in it, and the
  total counts it once. An activity without friends is under `(none)`.
- **Kilometer** is the number of the kilometer within its activity: **Km 1** is the first kilometer
  of every activity. It splits only the split measures.
- **Heart rate zone** is the zone of the percentage of your maximum heart rate: Zone 1 (50-60%) to
  Zone 5 (90-100%), and Below zone 1. It splits only **Time in zone**.

## Measures

| Measure | Is |
|---|---|
| Activities | the number of activities |
| Distance km, Duration, Calories, Climb m | the totals of the activities, as in Runkeeper |
| Longest distance km | the longest activity |
| Fastest km | the fastest whole kilometer of an activity, from its GPS track |
| Max heart rate | the highest heart rate of an activity |
| Split distance m, Split duration, Split elevation gain m | the kilometer splits of the GPS tracks |
| Time in zone | the time spent in the heart rate zones |

Also **Average pace** (the time per kilometer), **Average speed km/h**, **Average distance km**,
**Average heart rate** (the average heart rate of the activities weighted by their duration),
**Split pace**, **Split average heart rate** and **Time in zone %**.

- **Duration** is the moving time Runkeeper counts, without the pauses. The splits are the kilometers
  of the moving time too: the way and the time of a pause are not in any split, and the splits of an
  activity add up to its distance and duration.
- The splits are always kilometers, also for an account that shows miles — the distance and the
  climb of an account in miles and feet are converted into kilometers and meters.
- A kilometer that contains a jump of the GPS position — a step of the track much faster than the
  activity itself — is no **Fastest km**. A track which is inaccurate all the way can still give an
  unrealistic Fastest km.
- The heart rate between two samples counts for at most 30 seconds, so a gap where the monitor lost
  contact does not count as time in the zone of the heart rate before it, and it does not outweigh
  the other samples in the Split average heart rate.

## Sample reports

The first import creates the **Samples Runkeeper** folder: **Distance by month**, **Pace and heart
rate by month**, **Yearly summary**, **Activities by hour and week day**, **Time in heart rate zones
by month**, **Kilometer splits** and **Activities**, and the **Runkeeper overview** dashboard.

## Imports after the first one

Every import downloads the whole export again and replaces the imported data with it. The export is a
snapshot of your account, so an activity you deleted in Runkeeper disappears from eazyBI with the next
export, and one you changed is imported with its changes. A month that has no activities in the new
export is emptied, so always export the whole period — an export of the last months only would remove
the earlier ones.

## License

MIT — see [LICENSE](LICENSE).
