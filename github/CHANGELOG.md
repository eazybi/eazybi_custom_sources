# Changelog

All notable changes of the GitHub source application type are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-09

### Added

- Generated sample data in `test/sample_data.js` — two years of the pull requests, reviews,
  comments, commits and state transitions of six repositories of an invented software company,
  with a dependency update bot and a review bot next to its developers — which imports with
  `eazybi custom-source-apps import-sample-data` and shows the sample reports without a GitHub
  account.
- The eazyBI Marketplace description in `MARKETPLACE.md` with the screenshots of the sample reports
  in `assets/`.
- The app declares its incremental imports, so the regular import can run every hour in eazyBI
  Cloud plans that allow hourly imports.

### Changed

- All repositories are selected with Select all of the source selection, which includes the
  repositories the token can read later, instead of the "(all repositories)" option of the list. The
  import of a source application that selected that option fails, without changing its data, until
  its repositories are selected again. Select all is not offered on an eazyBI plan which allows only
  one selected source.

## [1.0.0] - 2026-09-14

The first version of the application.

### Added

- Import of the pull requests of the selected GitHub repositories with their labels, milestones,
  assignees, requested reviewers, reviews and comments, authorized with a personal access token.
  The repositories are selected individually, by owner, or as every one the token can read.
- The Repository, Pull Request, Pull Request State, Merge State, Review State, Pull Request Author,
  Pull Request Assignee, Pull Request Reviewer, Comment Author, Commit Author, Transition Author,
  Label and Milestone dimensions.
- The pull request, comment, review, commit and state transition measures, with the Pull request
  changes, Commit changes, Distinct pull requests count and Pull Request properties measure groups,
  and Open pull requests and Pull requests history as running totals.
- The Owner level of the Repository dimension, the Owner → Repository → Pull Request hierarchy of
  the Pull Request dimension, and the By type hierarchy of the six account dimensions, which groups
  the accounts as User, Bot, Mannequin and Organization.
- Pull Request Assignee, Pull Request Reviewer and Label as multi value dimensions, which count a
  pull request under each of its assignees, reviewers and labels and once in the total.
- The Import pull request commits and Import pull request state transitions import options.
- Incremental imports, which read the pull requests changed since the previous import and keep the
  mark per repository, so a repository that failed is read again from where it stopped while the
  others continue from theirs.
- Sample reports in the Samples Pull requests, Samples Pull request history and Samples AI and
  automation folders, with a dashboard for the first and the last of them, of the pull request
  volume and closing time, the review load, the cumulative flow of the pull request states and the
  activity of the bot accounts.
