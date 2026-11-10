# Changelog

All notable changes to the Atlassian Admin custom source application are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-10

### Added

- Users of an Atlassian organization, read from its directories, with their admin roles, org groups and
  account statuses.
- The selection of the products to import: whole Atlassian Cloud sites, single products, the products
  without a site such as Bitbucket, or all products. With all products selected, the product access to a
  site the organization no longer has, such as a deleted sandbox, is imported under a "(removed)" site.
- Product access of every user to the selected products with the last activity per product, the
  "Licensed users" measure of the users holding the user or admin role of a product, and the "Unused
  licenses" measure of the licensed users who never used the product.
- License plans and seats of the selected products.
- The "Import product roles" import option with the Product Role dimension of the user, admin, user access
  admin, contributor, basic, stakeholder, customer and guest roles on every product, the Product admins
  measure, and the "Product users by product role" and "Admins by product" sample reports.
- The "Users active in last 30 days" measure next to the "Active users" and "Inactive users" by account
  status.
- The "Product inactive days" and "User inactive days" measures of the days since the last activity, and
  the Inactivity interval dimension of the product access with the "User product activity" sample report.
- The Activity Tracking dimension that tells the product access whose activity Atlassian does not track,
  such as Goals, Projects and the portal customers of Jira Service Management, from the access never used.
- The user profile and security attributes (Department, Job title, Organization, Location, Time zone,
  Two-step verification, Management source, Claim status, Nickname, Email verified, Added to org) on the
  Custom fields tab, as User properties with their property measures and as own dimensions.
- Sample reports — among them "Licensed users by last activity" — and the "Atlassian Admin overview"
  dashboard.
- Generated sample data in `test/sample_data.js` — the organization of an invented software company with
  about 370 users on three sites and a Bitbucket workspace — which imports with
  `eazybi custom-source-apps import-sample-data` and shows the sample reports without an Atlassian
  organization.
- The eazyBI Marketplace description in `MARKETPLACE.md` with the screenshots of the sample reports
  in `assets/`.
