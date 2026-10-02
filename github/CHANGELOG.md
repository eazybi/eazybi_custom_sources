# Changelog

All notable changes of the GitHub source application type are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
