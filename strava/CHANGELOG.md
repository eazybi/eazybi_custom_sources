# Changelog

All notable changes of the Strava source application type are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-14

### Added

- The kilometer splits and the time in the heart rate zones of the FIT activity files, gzipped or not, which
  a device such as a Garmin watch uploads to Strava. The time from a stop to the next start of the timer of
  a FIT file is a pause. The import no longer warns how many activities have a FIT file.

### Changed

- The **Activities by hour and week day** sample report colors its cells by the number of activities, so
  the most active hours and week days stand out.

## [1.0.0] - 2026-10-06

### Added

- The Strava source application, which imports the account export of strava.com/account from a shared
  download link — Dropbox and Google Drive share links are turned into their download links. It reads
  only the activities and the settings of the export, never its contacts, messages or media. The export
  is requested in English, and an export in another language fails the import with that hint.
- The activities of `activities.csv`, read by the position of their columns because the export repeats
  some column names, with the Activity, Activity type, Gear, Distance range, Hour, Time and Week Day
  dimensions, on the date and hour of the Time dimension time zone. An activity member is named by
  its start and its title.
- The kilometer splits of the GPX and TCX tracks, gzipped or not, with the Kilometer dimension, the split
  pace, heart rate and elevation gain, and the Fastest km of each activity. A step of more than 10
  seconds between two track points which is less than half as fast as the activity is a pause, which
  is in no split. The import warns how many activities have a FIT file, which it does not read.
- The time in the heart rate zones of the track points, of the Maximum heart rate import option, the
  maximum heart rate of the Strava settings or the highest heart rate of the export, also of an
  activity recorded indoors, whose track points have no position.
- Every import replaces the imported data with the export by the month of the activities, so that an
  activity deleted in Strava disappears with the next export. An empty `activities.csv` fails the
  import instead.
- The Skip implausible activities import option, selected by default, which leaves out the activities
  whose average speed is impossible for their type and names each of them in the import warnings.
- The Samples Strava reports and the Strava overview dashboard.
