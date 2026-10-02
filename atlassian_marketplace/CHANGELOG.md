# Changelog

All notable changes of the Atlassian Marketplace source application type are documented in this
file, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-02

### Added

- The License country, hosting, partner, latest maintenance start date and last updated date
  property measures, and the Transaction license type, billing period, product edition, payment
  attempts, license ID and maintenance start date property measures.

### Changed

- The License app and Transaction app property measures name the app as the App dimension does,
  by its Marketplace listing, instead of by the name the record carries.
- Vendor amount cloud % is shown with two decimals, and is empty when the vendor amount of the
  period is negative.
- The import log counts the wait for an export in the time of the licenses and the transactions
  importers.
- The app icon is a square icon without the app name, which eazyBI displays next to the icon.
- The manifest declares the application type with `key` instead of `type`.

### Fixed

- The warning about a license or a transaction without an identifier is cleared by the next import
  instead of being shown after every later import.

## [1.1.1] - 2026-09-14

### Added

- The `author` attribute of the manifest, which eazyBI now requires.
- This changelog.

## [1.1.0] - 2026-09-09

The first version documented here — the changelog was started with this version, so the changes of
the versions before it are not listed.

### Added

- Import of the app licenses and the sales transactions of an Atlassian Marketplace developer
  space, read from the asynchronous Marketplace exports of a selected set of apps.
- The App, License, Transaction, Customer, Partner, Country, Hosting, License Type, License Status,
  License Tier, Sale Type, Billing Period, Payment Status and Product Edition dimensions.
- The license, transaction, sale amount, discount, maintenance and customer measures, with the
  License properties and Transaction properties measure groups and drill through to the licenses
  and the transaction lines.
- The Group hierarchy of the Partner dimension, which joins the subsidiaries of one partner under
  their trade name, and the Type hierarchy, which splits the partners by Expert, Reseller,
  Corporate reseller and Direct.
- The Import licenses, Import sales transactions, Include Atlassian licenses and Import
  transactions of import options.
- Incremental imports, which read the records changed since the previous import started less three
  days.
- Sample reports and a dashboard of the sales, the licenses, the renewals and the customers.
