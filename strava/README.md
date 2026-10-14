# Strava for eazyBI

Imports your [Strava](https://www.strava.com/) activities into eazyBI as a cube named **Strava**, so
that you can report on your distance, pace, heart rate, gear and training habits over the years: the
activities themselves, the pace of every kilometer from the GPS tracks, and the time you spent in each
heart rate zone.

## Connecting

The Strava API Policy does not allow an application to store, analyze or share the data it reads from
the Strava API, so the data comes from the account export that Strava prepares for you:

1. Sign in on the Strava website — the Strava app does not offer the export — and set the language to
   **English** under **Settings > Display Preferences**: Strava writes the column names of the export in
   the language of the account, and the import reads the English ones. Then open
   [strava.com/account](https://www.strava.com/account) (**Settings > My Account**), choose **Get
   Started** under **Download your account**, and then **Request download**. Strava emails you a
   download link, which may take a few hours. Download the ZIP file — do not unpack it. You may set
   the language back afterwards.
2. Put the ZIP file where eazyBI can download it with a link, and copy its sharing link:
   - **Dropbox** — upload the file, choose **Share > Copy link**. The link opens a preview page, and
     eazyBI turns it into the download link of the file itself (`dl=1`).
   - **Google Drive** — upload the file, choose **Share**, set **General access** to **Anyone with the
     link**, and **Copy link**. eazyBI downloads the file from the Google Drive download address of
     the same file.
   - **Any other HTTPS server**, such as an S3 bucket — a URL that answers the ZIP file itself.

   A plain HTTP link is not accepted, because it would send your export unencrypted.
3. Paste the link into the **Export file URL** field of the eazyBI connection form. Testing the
   connection requests only the end of the file, which lists the files in the ZIP, to check that the
   link answers a Strava export and not a web page — a server which does not answer such a request
   sends the whole file instead. The whole file is downloaded by the import.

To update the data, request a new download and replace the shared file with the new export so that the
link stays the same — in Dropbox upload the new file with the same name over the old one, in Google
Drive choose **Manage versions > Upload new version** of the file — then import again.

**The export holds much more than your activities**: your contacts, messages, followers, logins and
photos too. Everyone who has the link can download all of it. Share the file with a link that is not
published anywhere, and remove it when you no longer import it. The import reads only
`activities.csv`, `general_preferences.csv` and the files of the `activities` folder; it never reads or
stores the rest of the export.

## Import options

| Option | Default | Effect |
|---|---|---|
| Skip implausible activities | on | leaves out the activities whose average speed is impossible for their type, see below |
| Maximum heart rate | the maximum heart rate of your Strava settings | the heart rate in beats per minute that the heart rate zones are the percentages of |
| Time dimension time zone | the eazyBI default | the time zone of the Time, Hour and Week Day dimensions — set it to your home time zone |

Without a Maximum heart rate in the import options or in your Strava settings, the zones are the
percentages of the highest heart rate in the export.

### Implausible activities

A recording mistake — a jump of the GPS position, or a walk recorded in a car or a bus — gives an
activity an average speed no one walks at, and it would distort the averages of its month. The import
leaves such an activity out and names it in the import warnings, so that you can correct or delete it in
Strava — its warning is gone with the first import of an export after that:

| Activity type | Plausible average speed |
|---|---|
| Run, Trail Run | 1–30 km/h |
| Walk | 1–15 km/h |
| Hike | 0.5–15 km/h |
| Ride | 1–80 km/h |
| Gravel Ride | 1–70 km/h |
| Mountain Bike Ride, E-Bike Ride | 1–60 km/h |
| E-Mountain Bike Ride | 1–50 km/h |

The average speed is that of the moving time. An activity of one of these types with a distance of 0 and
a duration has an average speed of 0 km/h, and it is left out too. The other activity types have no
meaningful speed, and the virtual ones a distance of a trainer, so they are always imported. Deselect
**Skip implausible activities** to import every activity as it is.

## What is imported

| File of the export | Becomes |
|---|---|
| `activities.csv` | one Activity member per activity, and the activity measures |
| the GPX, TCX or FIT file of each activity (`activities/12345678901.gpx`, also gzipped) | the kilometer splits, the Fastest km and the time in the heart rate zones |
| `general_preferences.csv` | the maximum heart rate of the heart rate zones |

Strava keeps the file of an activity in the format it was recorded or uploaded in. An activity
recorded with the Strava app has a GPX file. A device such as a Garmin watch often uploads a FIT file,
whose pauses of the timer are left out of the splits as well. An activity file which can not be read —
also a FIT file larger than the size limit of binary files, 16 MB by default — is named in the import
warnings, and its activity has its activity measures, but no kilometer splits and no time in the heart
rate zones. An activity recorded indoors has
a file without a GPS position, so it has no splits either, but the heart rate of its file counts in the
heart rate zones.

The weather, the photos, the routes, the segments and the social data of the export are not imported.

## Dimensions

**Activity**, **Activity type** (Run, Ride, Walk, …), **Gear**, **Distance range**, **Hour**,
**Kilometer**, **Heart rate zone**, **Time** and **Week Day**.

- **Time**, **Hour** and **Week Day** are the start of the activity in the **Time dimension time zone**
  of the import options. Strava exports the start in UTC, so an activity on a trip abroad is at the
  hour of your home time zone.
- **Activity** members are named by the start and the title (`2026-10-02 19:32 Morning Walk`), or by
  the start, the type and the distance when the activity has no title (`2026-10-02 19:32 Walk 5.64 km`)
  — when two activities have the same name, the Strava activity ID is appended to it in parentheses —
  and carry the **Start time**, **Title**, **Description**, **File** and **Strava URL** as properties.
  The **Activity properties** measures show them as report columns.
- **Gear** is the shoes or the bike of the activity, and `(none)` for an activity without gear.
- **Distance range** buckets the activities into Under 5 km, 5-10 km, 10-21 km, 21-42 km and 42 km and
  more.
- **Kilometer** is the number of the kilometer within its activity: **Km 1** is the first kilometer
  of every activity. It splits only the split measures.
- **Heart rate zone** is the zone of the percentage of your maximum heart rate: Zone 1 (50-60%) to
  Zone 5 (90-100%), and Below zone 1. It splits only **Time in zone**.

## Measures

| Measure | Is |
|---|---|
| Activities | the number of activities |
| Distance km, Moving time, Elapsed time, Elevation gain m, Calories, Steps, Relative effort | the totals of the activities, as in Strava |
| Longest distance km | the longest activity |
| Max speed km/h, Max heart rate | the highest values of an activity |
| Fastest km | the fastest whole kilometer of an activity, from its GPS track |
| Split distance m, Split duration, Split elevation gain m | the kilometer splits of the GPS tracks |
| Time in zone | the time spent in the heart rate zones |

Also **Average pace** (the moving time per kilometer), **Average speed km/h**, **Average distance km**,
**Average heart rate** and **Average power W** (the averages of the activities weighted by their moving
time), **Split pace**, **Split average heart rate** and **Time in zone %**.

- The distances and the elevation are always kilometers and meters, also for an account that shows
  miles and feet.
- Strava leaves the points of a pause out of the GPS track. A step of more than 10 seconds between two
  track points which is also less than half as fast as the activity is a pause: the way and the time of
  a pause are not in any split. A device which records a point only every few seconds keeps its splits.
  The splits are the distance of the GPS track, which can differ from the distance Strava shows by
  about 1%.
- A kilometer that contains a jump of the GPS position — a step of the track much faster than the
  activity itself — is no **Fastest km**. A track which is inaccurate all the way can still give an
  unrealistic Fastest km.
- The heart rate between two track points counts for at most 30 seconds, so a gap where the monitor
  lost contact does not count as time in the zone of the heart rate before it.

## Sample reports

The first import creates the **Samples Strava** folder: **Distance by month**, **Pace and heart rate by
month**, **Yearly summary**, **Activities by hour and week day**, **Time in heart rate zones by month**,
**Kilometer splits**, **Distance by gear** and **Activities**, and the **Strava overview** dashboard.

## Imports after the first one

Every import downloads the whole export again and replaces the imported data with it. The export is a
snapshot of your account, so an activity you deleted in Strava disappears from eazyBI with the next
export, and one you changed is imported with its changes. A month that has no activities in the new
export is emptied. An export whose `activities.csv` is empty fails the import and keeps the imported
data.

## License

MIT — see [LICENSE](LICENSE).
