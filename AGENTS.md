# AGENTS.md

This repository holds several eazyBI custom source app implementations, one per subdirectory. Each
subdirectory is a complete app — manifest, importers, schema definition, sample reports and tests —
and has its own README describing what it imports and how its cube is shaped. The apps are listed in
the [README](README.md).

Work on one app at a time and keep the subdirectories independent of each other: an app must not
require files from another one.

## Required reading

Before working on any file in this repository, load the eazyBI custom source apps skill and follow
it:

https://eazybi.com/skills/eazybi-custom-sources

It documents the manifest, the connection form, the importer API, the schema definition DSL, sample
reports and the test harness that these apps rely on, and links a reference file for each of them.

## Adding an app

- Name the subdirectory after the application type that the manifest `key` declares.
- Give the app a `README.md` for its users, a `CHANGELOG.md` and a `LICENSE`, as the skill
  describes.
- Add the app to the Apps table of the repository [README](README.md).

## Documenting a change

- Describe every notable change of an app in the `Unreleased` section of its `CHANGELOG.md`, in the
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, and update its `README.md` when
  the change is visible to the users of the app.
- Leave out the `Unreleased` section when there are no unreleased changes. Add it with the first
  change after a published version, and do not add an empty `Unreleased` section.
- Do not increment the manifest `version` of an app for every change — it is incremented when a new
  version is published, by the rules the skill gives for the `version` option.

## Running the tests

`eazybi custom-source-apps run-tests <directory>` packages an app directory and runs its tests
on eazyBI, without installing anything, and exits non-zero when a test failed. It needs eazyBI CLI
0.4.0 or newer, the version the skill requires. Run the tests of an app after every change to it.

## Git commits

- Use git commit messages with up to a 50-character subject line and up to 72-character body lines.
  Use a concise commit message body to describe a summary of what is changed.
- Do not commit or push unless asked to do so.
