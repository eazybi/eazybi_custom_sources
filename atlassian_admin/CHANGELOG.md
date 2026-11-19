# Changelog

All notable changes to the Atlassian Admin custom source application are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-17

### Changed

- The users import reads the Studio activity of the users of a directory page in parallel, as many
  requests at once as the `max_concurrent_requests` advanced setting allows, instead of one user after
  another.
- The progress bar of the users import step moves by the share of the imported managed accounts and users
  of the selected products.
- The "Users by admin role" and "Product users by site" sample reports show the values above the bars, so
  the small sites and sandboxes are visible next to the main site. "Product users by site" shows the whole
  site addresses.

### Fixed

- Suspended, deactivated, closed and for deletion users no longer count as licensed users, as Atlassian
  does not bill them, even when a group synced from an identity provider still gives them a role. They
  still count as product users.
- Atlassian Analytics is named so instead of "Avp", and its users count as licensed users only on a paid
  plan, like the other products that come with a site. Atlassian does not track its activity, so all its
  licensed users counted as unused licenses.
- Two Studio workspaces, or other products without a site that share a name, show the start of their
  workspace id after the name. They looked the same in the product selection and showed their whole key in
  the Site dimension.
- The Studio activity of a managed account that no directory answers is imported. Its Studio access counted
  as never used.
- The import log counts the time of the Studio activity requests in the lines of the imported users, which
  showed only a fraction of the time of every batch.
- The connection page and the README ask for an organization API key without scopes. They named read
  scopes for a scoped key, but Atlassian offers no scope for the user search and the last active dates
  that the import reads.

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
