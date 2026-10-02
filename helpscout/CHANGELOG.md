# Changelog

All notable changes of the Help Scout source application type are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-09-30

### Added

- The Closed By dimension, so a report can group results by who actually closed a conversation,
  apart from Assignee, which is who it is assigned to now. Every sample report filters by it, and
  the Help Scout overview dashboard filters by it in common with its other reports. Its all member
  is named "All Closers", since the dimension name does not pluralize on its own.
- The `skip_conversations` advanced setting, which leaves the conversations of the named numbers out
  of the import entirely, including their satisfaction ratings, whether or not the conversation
  itself is part of the current incremental import — an exceptional conversation whose data is a
  mistake and skews the averages, rather than a real outlier worth keeping. A setting entered as
  something other than a list of numbers leaves out nothing, rather than failing the import.
- The Assignee and Tags properties of the Conversation dimension, so a report or a drill through
  list of conversations shows who a conversation is assigned to and its tags without adding either
  dimension to the report. Tags is every tag as one comma separated string, or "(untagged)" with
  none.
- The Response office hours measure and the Average response office hours it feeds, alongside the
  existing First reply office hours and Closing office hours, when Use office hours is selected.

### Changed

- Internal notes no longer count as messages — the Messages property of the Conversation dimension,
  the Message count interval dimension, the Conversation messages created measure and the Closed
  conversations messages measure (and the Average messages per closed conversation it feeds) now all
  count only the messages that passed between the customer and the team. A conversation with only
  notes and no reply no longer buckets in Message count interval as if it had been answered.
- The default boundaries of First reply interval and First reply office hours interval, from 2 hour
  buckets over the first day to 6, 12 and 24 hours.

### Fixed

- The Tag dimension now has an `(untagged)` member — a conversation with no tags was bridged to an
  empty set before, so it was left out of every report grouped by Tag entirely.

## [1.5.0] - 2026-09-28

### Added

- The Use office hours import option with the Office hours of the team, which adds the First reply
  office hours and Closing office hours measures, their averages, and the First reply office hours
  interval and Closing office hours interval dimensions — the first reply and the closing time counted
  within the office hours only.

### Changed

- The app icon is a square icon without the app name, which eazyBI displays next to the icon.

## [1.4.1] - 2026-09-14

### Added

- The Week Day dimension, which splits any measure by the day of the week of the event it counts.
- The `author` attribute of the manifest, which eazyBI now requires.
- This changelog.

## [1.4.0] - 2026-09-07

The first version documented here — the changelog was started with this version, so the changes of
the versions before it are not listed.

### Added

- Import of the conversations, messages, customers and satisfaction ratings of the selected Help
  Scout inboxes, authorized with OAuth2 and with a default app configurable for the deployment.
- The Inbox, Conversation, Status, Channel, Source, Tag, Assignee, Agent, Customer, Organization,
  Hour, First reply interval, Closing interval and Message count interval dimensions.
- The conversation, message, rating and customer measures, the response, resolution and happiness
  measures defined the way the Help Scout reports define them, and the Conversation properties
  measure group.
- Import of the conversation custom fields selected on the Custom fields tab as properties,
  dimensions and measures.
- The Import history, Import conversation messages and Import satisfaction ratings import options.
- Incremental imports, which continue where the previous import stopped and re-import the
  conversations changed since; a conversation which could not be imported is reported as a warning
  and retried by the next import.
- Sample reports and a dashboard of the conversation volume, the response and resolution times, the
  agent workload and the customer happiness.
