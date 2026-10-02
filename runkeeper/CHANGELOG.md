# Changelog

All notable changes of the Runkeeper source application type are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-30

### Added

- The Runkeeper source application, which imports the data export of runkeeper.com/exportData from a
  shared download link — Dropbox and Google Drive share links are turned into their download links.
- The activities of `cardioActivities.csv` with the Activity, Activity type, Distance range, Friend,
  Hour, Time and Week Day dimensions, on the local date and hour where each activity started.
- The kilometer splits of the GPX tracks, with the Kilometer dimension, the split pace, heart rate and
  elevation gain, and the Fastest km of each activity, which leaves out the kilometers with a jump of
  the GPS position.
- The time in the heart rate zones of the heart rate samples of `heartRate.csv`, or of the GPX track
  points when the export has no such file, and the Maximum heart rate import option the zones are the
  percentages of.
- Every import replaces the imported data with the export by the month of the activities, so that an
  activity deleted in Runkeeper disappears with the next export.
- The Skip implausible activities import option, selected by default, which leaves out the activities
  whose average speed is impossible for their type — the tracking left running for hours after a run,
  or a run recorded in a car — and names each of them in the import warnings.
- The Samples Runkeeper reports and the Runkeeper overview dashboard.
