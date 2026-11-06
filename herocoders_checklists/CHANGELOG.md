# Changelog

All notable changes of this addon are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## 1.4.1 - 2026-11-05

### Added
- Sample reports in the `Samples Checklists by HeroCoders` folder: *Checklist item completion by issue type*,
  *Checklist items by issue type*, *Checklists over time* and *Work items with checklists*.
- Sample data of two projects with checklists and the Checklist Text changes which complete and reopen their items.

### Changed
- `HC Checklist items not completed` is empty for a completed item instead of 0, like `HC Checklist items
  completed` for a not completed item. Run a full reimport to update the imported items.

### Fixed
- An issue with several Checklist Text fields dated its items by the changes of all of them, so a change of
  another field could change the completion date of an item or count a false reopening.
- A checked `[x]` item and a `[done]` item were imported as one Done status of one completion when Done is not
  counted as completed. A status is now a member of each of its completions.
- The items without a status (`[]`, `[]?` and a bullet without a status) did not count as completed when Open is
  one of the *Statuses counted as completed*, although they are Open items.
- Editing the first of several items of the same text moved its completion date to the edit and counted a
  reopening of the next item of that text.
- An issue with more than 10,000 checklist item rows (items, completions and reopenings) stopped the import.
  It is reported as a failed issue now, and the other issues are imported.
- *Statuses counted as completed* saved by version 1.0.0 as a comma separated text was read as one status, so
  none of its statuses counted as completed.

## 1.4.0 - 2026-11-03

### Added
- `HC Checklist Header` dimension — the header (`--- Header`) of the checklist items, `(none)` for the items without
  a header.

### Changed
- `HC Checklist content` shows the headers as italic lines between the items, and the links of the items
  (`[text](url)`) as links; a URL without a scheme (`eazybi.com`) opens as `https://eazybi.com`.
- `HC Checklist Item` names are the item texts without the link URLs.

### Fixed
- An item which starts with a link (`* [text](url)`) was read with the link text as its status.

## 1.3.0 - 2026-11-03

### Added
- `HC Checklist items reopened` — the items which changed from a completed to a not completed status, dated by
  their last reopening. Run a full reimport to import it for the imported issues.

## 1.2.0 - 2026-11-03

### Changed
- `HC Checklist items completed` is dated by the last completion of the item, found in the Checklist Text changes
  of the issue changelog, instead of the created date of the issue. Run a full reimport to date the imported items.
- The icon is drawn as a vector of the HeroCoders logo, without the embedded image which the icon security
  policy may block.

## 1.1.1 - 2026-11-03

### Changed
- The icon is the Checklists for Jira (Pro) by HeroCoders logo of the Atlassian Marketplace.

## 1.1.0 - 2026-11-02

### Changed
- *Statuses counted as completed* is a multiple select of the default statuses and of the statuses used in
  the checklists of the recently updated issues, instead of a comma separated text.

## 1.0.0 - 2026-11-02

### Added
- `HC Checklist`, `HC Checklist Item` and `HC Checklist Item Status` dimensions.
- `HC Checklists`, `HC Checklist items`, `HC Checklist items completed`, `HC Checklist items not completed`,
  `HC Issues with checklists` measures and the `HC Checklist progress %` calculated measure.
- Issue properties with the item totals, the progress and the checklists as Markdown.
- The *Statuses counted as completed* import option.
