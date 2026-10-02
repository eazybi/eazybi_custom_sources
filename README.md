# eazyBI custom source apps

This repository holds [eazyBI](https://eazybi.com/) custom source app reference implementations, one
per subdirectory. A custom source app is a directory of JavaScript files that eazyBI installs and
runs as a source application: it imports data from an external service into an eazyBI account and
defines the cube — dimensions, measures and sample reports — that the data is reported on.

Use these apps as they are, or as working examples when you build a custom source app of your own.
Each one is a published version of an app that eazyBI develops and tests in its own repository, and
the history of this repository has one commit per published version.

## Apps

| App | Imports |
|---|---|
| [atlassian_marketplace](atlassian_marketplace/README.md) | [Atlassian Marketplace](https://marketplace.atlassian.com/) app licenses and sales transactions of a vendor |
| [github](github/README.md) | [GitHub](https://github.com/) pull requests, their comments, reviews, commits and state transitions |

See the README of an app for what it imports, how to connect it, and what its cube contains, and its
CHANGELOG for the changes of every published version.

## Installing an app

Each subdirectory is named after the application type its manifest declares, is self-contained and is
installed into eazyBI on its own, straight from this repository with the
[eazyBI CLI](https://docs.eazybi.com/eazybi/set-up-and-administer/eazybi-cli):

```
eazybi custom-source-apps install https://github.com/eazybi/eazybi_custom_sources --subdir <app>
```

or from a local clone of the app directory:

```
eazybi custom-source-apps install ./<app> -a <account id>
```

## Layout of an app

| File | Contains |
|---|---|
| `application.js` | the manifest — the application type and name, the connection parameters and the import options |
| `api.js` | the client of the external service API |
| `importer.js`, `importers/` | what is fetched and which source data rows it becomes |
| `schema_definition.js` | the cube — its dimensions, measures and calculated members |
| `sample_reports.js` | the reports and dashboards the first import can create |
| `icon.svg`, `icon_dark.svg` | the square app icon, and its optional dark eazyBI theme variant |
| `test/`, `test/fixtures/` | the tests and the API response fixtures they run against |
| `README.md`, `CHANGELOG.md`, `LICENSE` | what the app does for its users, its notable changes and its license |

## Building your own app

The manifest, the connection form, the importer API, the schema definition DSL, the sample reports
and the test harness are documented by the eazyBI custom source apps skill:

https://eazybi.com/skills/eazybi-custom-sources

The skill is written for AI coding agents as well as for people. Add an `AGENTS.md` to the root of
your own repository that tells the agent to load it — the [AGENTS.md](AGENTS.md) of this repository
is an example you can start from.

Working on an app needs the eazyBI CLI version 0.4.0 or later. Sign in once with
`eazybi auth login`, then run the tests of an app on eazyBI without installing anything, and install
it into one test account to import with it:

```
eazybi custom-source-apps run-tests ./<app>
eazybi custom-source-apps install ./<app> -a <account id>
```

A repository can hold a single app in its top directory or several apps in subdirectories like this
one. A private repository is installable from its URL when an eazyBI administrator has configured
its credentials in the advanced settings, as the skill describes.

## License

Each app is licensed under the license in its own `LICENSE` file.
