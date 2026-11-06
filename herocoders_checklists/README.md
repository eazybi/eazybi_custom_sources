# Checklists by HeroCoders — eazyBI Jira addon

Imports [Checklists for Jira by HeroCoders](https://marketplace.atlassian.com/apps/1211562/checklists-for-jira-enterprise-by-herocoders)
into the Issues cube of a Jira source application. Turn it on in the **Addons** tab of the Jira import options.

## Requirements

The addon reads the **Checklist Text** custom field. Enable *Sync checklists to Custom Fields* in the
Checklists for Jira global settings, so that HeroCoders keeps the field up to date. Global Checklists are not
included in the Checklist Text field and are therefore not imported.

## Data

**Dimensions**

- `HC Checklist` — checklists by their name; the checklists of the same name on several issues are one member.
- `HC Checklist Item` — checklist items by their text (up to 200 characters), without the URLs of the links.
- `HC Checklist Header` — the header of the items in the checklist, `(none)` for the items without a header.
- `HC Checklist Item Status` — `Completion` (Completed, Not completed) → `Status` (Open, In progress, Done,
  Skipped and the custom statuses).

**Measures** — which can be analyzed by all Jira dimensions of the issue as well:

- `HC Checklists` — distinct count of the checklists of the issues
- `HC Checklist items`, `HC Checklist items not completed` — dated by the created date of the issue; `HC Checklist items not
  completed` is empty (not 0) for the completed items
- `HC Checklist items completed` — dated by the last completion of the item (see
  [Completion and reopening date](#completion-and-reopening-date))
- `HC Checklist items reopened` — the items which were reopened, dated by the last reopening of the item (see
  [Completion and reopening date](#completion-and-reopening-date))
- `HC Issues with checklists` — distinct count of the issues
- `HC Checklist progress %` — completed items / items. The items and the completed items are dated differently,
  so use it with the Time dimension at All Times (a period compares the items completed in it with the items of
  the issues created in it).

**Issue properties** — `HC Checklist total items`, `HC Checklist completed items`, `HC Checklist progress` and
`HC Checklist content`, the checklists of the issue as Markdown, with the headers as italic lines and the links of
the items as links. The `HC Issue checklist content` measure shows
the rendered Markdown with the issues on report rows.

## Import options

- **Statuses counted as completed** — a multiple select, Done and Skipped by default. Items checked as `[x]`
  always count as completed. It lists the default statuses of Checklists for Jira (Open, In progress, Done,
  Skipped) and the statuses used in the Checklist Text of the 500 most recently updated issues of the selected
  projects — the custom statuses of the app are not available in the Jira REST API, so a custom status is listed
  once a checklist uses it. Select the custom statuses which are associated with a checked checkbox.

## Checklist Text syntax

`# Name` starts a checklist, `--- text` (also `---text`) is a header of the next items of the checklist (`---`
without a text ends the header), `* [status] text` (also `- [status] text` or `[status] text`) is an item with a
status, `[x]` a checked and `[]` an open item, `[]?` an optional item, and `>> text` an item description. The
headers are not items, and the descriptions are not imported. `[text](url)` in an item is a link — also at the start
of an item without a status, `* [eazyBI](eazybi.com)`; a URL without a scheme opens as an `https://` link.

## Completion and reopening date

The completion date of an item is read from the changelog of the issue: every change of the Checklist Text field
has the whole checklist text before and after the change. The import replays the changes and dates a completed item
by the last change which completed it — an item which was completed, opened again and completed again is dated by
its last completion. A change from one completed status to another one (Done → Skipped) keeps the completion date.

An item is reopened by a change from a completed status to a not completed one (Done → Open, `[x]` → `[]`,
Skipped → In progress). A reopened item counts once in `HC Checklist items reopened`, dated by its last reopening,
also when it is completed again later. A change between two completed statuses or two not completed statuses
is not a reopening.

- An item keeps its history when it stays at its position with the same text. Otherwise it is followed by its
  checklist, its text and its order among the items of the same text. An item whose text was edited keeps its
  completion when it stays at the same position, also next to the items of the same text.
- The items which were completed already before the first change of the field are dated by the created date of the
  issue, also the completed items of an issue without changes.
- The *Statuses counted as completed* option applies to the past changes too.

## Import

The checklist item rows are imported after the Jira issues: a full import reads all issues of the selected
projects with a Checklist Text together with their changelog, an incremental import the issues updated since the
previous import (with one day of margin). The issue properties are imported together with the issues. Run a full reimport after changing
*Statuses counted as completed*.

## Tests

The tests in `test/` use the eazyBI custom source app test API with a simulated Jira Cloud instance. Run them with
`eazybi custom-source-apps run-tests herocoders_checklists`. `test/jira_import_test.js` runs the full Jira import
with the addon, and `test/sample_data.js` generates the sample data — two projects of issues with checklists and the
Checklist Text changes which complete and reopen their items — which
`eazybi custom-source-apps import-sample-data herocoders_checklists -a <account id>` imports.
