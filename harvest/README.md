# Harvest for eazyBI

Imports [Harvest](https://www.getharvest.com/) time tracking and invoicing data into eazyBI as two
cubes, **Harvest Timesheets** and **Harvest Invoices**, so that you can report on tracked and
billable hours, budgets, costs and margins, uninvoiced work and invoices.

## Connecting

1. In Harvest, open [id.getharvest.com/developers](https://id.getharvest.com/developers) and create
   a personal access token. The token must belong to a Harvest **administrator** — only an
   administrator can read the time, expenses and invoices of the whole account.
2. Paste the token into the **Personal access token** field of the eazyBI connection form.
3. Enter the **Harvest web address** you open Harvest at, for example
   `https://yourcompany.harvestapp.com`. It tells which Harvest account to import when the token has
   access to several, and clients, projects and people in reports link to Harvest with it. An import
   stops with an error, and changes nothing, when the token reaches no account at this address.
4. Select the projects to import (see below).

## Selecting projects

Click **Select all** to import the whole Harvest account, also the projects created later, as in the
other eazyBI imports. Nothing is ticked for a new source application, and nothing is imported until you
tick something. Unticking a project after Select all imports only the ticked projects.

To import a part of a large account, tick single projects instead. A plan which allows only one
selected source imports one project. eazyBI then imports those projects
with their time entries, expenses and budgets, their clients, and the invoices of those clients. Tasks,
people and categories are always imported for the whole account.

A project you untick is removed from eazyBI with the next import. A project you add is imported with
the next import, together with its history.

Archived projects are imported as well. To report on running projects only, select **Active** in the
**Project Status** page filter.

## Import options

| Option | Default | Effect |
|---|---|---|
| Check for deleted records | every day | how often the import looks for records deleted in Harvest and updates the capacity of the people (every day, every week, or only with a full reimport) |
| Business hours start | 09:00 | the start of the business hours of the Working Time dimension |
| Business hours end | 17:00 | the end of the business hours |
| Time dimension non-working days | Saturday, Sunday | the days that are not working days, also in the Working Time dimension and the capacity |

Each import reads only what changed in Harvest since the previous import. Harvest does not report
deleted records, so a check for deleted records reads all data again and removes what Harvest no
longer has. Until the next check, a record deleted in Harvest still shows in reports. A check takes
about as long as a full import. The first import and a full reimport always check.

## What is imported

| Harvest object | Becomes |
|---|---|
| Clients, projects and tasks | the Project Task, Client Project, Project Status and Task dimensions and the list of projects you select from |
| People, roles and project managers | the Person, Role and Project Manager dimensions |
| Time entries | the hours and amount measures, split by the Working Time dimension |
| Expenses | the expense measures and the Expense Category dimension, when expense tracking is on in Harvest |
| Project budgets | the Budgeted hours and Budgeted cost measures |
| Weekly capacity of the people | the Capacity hours measure and the utilisation measures |
| Invoices and their line items | the **Harvest Invoices** cube, when invoicing is on in Harvest |
| Euro reference rates of the European Central Bank | the EUR and USD measures |

## Harvest Timesheets cube

### Dimensions

| Dimension | Members |
|---|---|
| Project Task | Client › Project › Task, with the project details (code, status, budget, billing, dates, managers) as properties |
| Project Status | Active, Archived |
| Project Manager | the people who manage the project |
| Task | the tasks of the account |
| Person | Type (Employees, Contractors) › Person, with the cost rate, weekly capacity in hours, email, created date, first and last tracked date and more as properties |
| Role | the Harvest roles of the person |
| Approval Status | Unsubmitted, Submitted, Approved |
| Working Time | Business hours, Non-business hours (see [Business hours](#business-hours)) |
| External Item | Service › Item: the Jira issue, Trello card, GitHub issue or other item the time was tracked on (see [Linked items](#linked-items)) |
| Expense Category | the categories of the expenses |
| Currency | the currency the project is billed in |
| Time | the day the time or the expense was spent on |

**Role** and **Project Manager** can have several members per row: a person with two roles, or a
project with two managers, is counted under each of them, so the members do not add up to the total
(the **All** member counts each row once). Both use the roles and managers from Harvest at the last
import for all history. Time of people without a role is under `(no role)`, and projects without a
manager are under `(no manager)`.

### Measures

| Measure | What it is |
|---|---|
| Hours | the tracked hours, without a timer that is still running |
| Rounded hours | the hours rounded by the time rounding setting of your Harvest account |
| Billable hours | the rounded hours of billable time entries (and of time that is already invoiced) |
| Invoiced hours | the rounded hours that are on an invoice |
| Billable amount, Invoiced amount | the billable and invoiced hours at the billable rate of each time entry |
| Cost amount | the rounded hours at the person's cost rate, in the currency of your Harvest account |
| Expenses amount, Billable expenses, Invoiced expenses | the expenses, the billable ones, and the part of them that is on an invoice or marked as invoiced |
| Budgeted hours, Budgeted cost | the budget of the project, of its tasks or of its people |
| Hours with notes | the hours of time entries that have a note |
| Linked hours | the hours of time entries linked to an item in another tool |
| Capacity hours | the hours a person is available, on every working day (see [Capacity and utilisation](#capacity-and-utilisation)) |

**Rounded hours** is the value Harvest uses in its own reports, and all billable, invoiced and
amount measures are based on it: **Billable hours** + **Unbillable hours** = **Rounded hours**. Use
**Hours** for the raw tracked time. When you change the rounding setting in Harvest, earlier entries
get their new rounded hours with the next check for deleted records or a full reimport.

Also the calculated **Unbillable hours**, **Billable hours %**, **Hours without notes**, **Unlinked
hours**, **Linked hours %**, the **Uninvoiced** hours, amount and expenses, **Budget spent %** of a
project or task, **Margin EUR** and **USD** (the billable amount less the cost amount, without
expenses), **Margin %**, **Utilisation %** and **Billable utilisation %**, and an **EUR** and **USD**
version of every amount, so that projects billed in different currencies can be added up. The
**Properties** group shows the project, task and person properties as report columns. In a report
filtered by time, task, person or another dimension, a project or invoice property is shown only
where the report has rows of that project or invoice, so that the filtered-out projects and invoices
do not stay in a report that hides empty rows. Without filters, every project shows its properties,
also one without any rows. The person properties and Task hourly rate always show.

**Billable amount** and **Cost amount** use the billable and cost rates that Harvest stores with
each time entry, so a later rate change does not change the amounts of earlier time unless Harvest
updates the rates of that time too. Cost rates are in the currency of your Harvest account, while
billable amounts are in the currency of the project, so compare them with the EUR or USD measures.
The EUR and USD measures leave out the amounts of a currency the European Central Bank publishes no
rate for, and the import then shows a warning. When the import cannot find the account currency or its rate, the converted cost and the
margins stay empty, and the margins also when a currency the time is billed in at a non-zero rate
has no rate.
**Uninvoiced expenses** counts only billable expenses. The **Uninvoiced** measures need invoicing in
Harvest: when it is turned off, nothing is invoiced, so all billable work shows as uninvoiced.

**Budget spent %** is an estimate, not Harvest's budget report: it counts all rounded hours of the
project or task, and for a fee budget the billable amount and all expenses. It does not leave out
the time of tasks or people that Harvest excludes from the budget, or the expenses of a budget that
does not include them, and it treats a monthly budget as the budget of the whole project.

## Capacity and utilisation

**Capacity hours** is the time a person is available: the person's weekly capacity from Harvest,
spread evenly over the working days of the week. Working days are the days that the Time dimension
settings do not mark as non-working, so a 35 hour week is 7 hours on each day from Monday to Friday by
default, and a holiday you add as a non-working day has no capacity.

A person has capacity from the day they were created in Harvest, or from the first day they tracked
time when that is earlier, to the end of the current year. A person who is no longer active has
capacity until the last day they tracked time, and none if they never did. The **First tracked date**
and **Last tracked date** person properties show these days.

**Utilisation %** is **Hours** divided by **Capacity hours**, and **Billable utilisation %** is
**Billable hours** divided by it.

- **Capacity belongs to people and days, not to projects.** With a project, task or other dimension
  on the report, **Capacity hours** is empty, and the utilisation measures divide the hours by the
  capacity of all the people in the report: the utilisation of a project is the share of the team's
  capacity spent on it.
- **Capacity runs to the end of the year.** A period that includes days still to come has their
  capacity but not their time yet, so look at utilisation for past periods, such as the previous
  month.
- **The check for deleted records writes the capacity** (see [Import options](#import-options)),
  because only it reads every time entry and so knows the days people tracked time on. A new
  person, a changed weekly capacity or a person who is no longer active shows in the capacity after
  the next check, every day by default; the first import of a new year always checks. The first and
  last tracked dates are as of the last check too.
- **Harvest keeps only the current weekly capacity.** A change applies to all history. Time off is
  not taken into account.
- **A person with several roles** has their capacity counted under each role, like their hours.

## Business hours

The **Working Time** dimension splits tracked time into **Business hours** and **Non-business
hours**. Business hours are the time between the **Business hours start** and **end** import options
on a working day. Working days are the days that the Time dimension settings do not mark as
non-working — Monday to Friday by default.

With the defaults (09:00–17:00, Monday to Friday):

| Time entry | Working Time |
|---|---|
| Monday 10:00–12:00 | 2 h Business hours |
| Monday 16:00–19:00 | 1 h Business hours and 2 h Non-business hours |
| Saturday 10:00–12:00 | 2 h Non-business hours |
| Monday, 3 h without start and end time | 3 h Business hours |

- An entry that is partly within business hours is split in two. All its measures — hours, rounded
  hours, billable and cost amounts — are shared in the same proportion, and the two parts add up to
  the entry.
- An entry without a start and end time (Harvest tracks durations by default) or a running timer is
  classified by its day only: Business hours on a working day, Non-business hours otherwise.
- An entry that ends after midnight counts the time after midnight by the next day's business hours.
- Start and end times are used as Harvest shows them, in the local time of the person.
- Expenses and budgets have no time of day, so they are shown only under **All Working Times**.

When you change the business hours or the non-working days, the next import reads all time entries
again to classify them anew.

## Linked items

A time entry started from another tool through a Harvest integration — the Harvest app for Jira, the
Trello Power-Up, or the Harvest browser extension on Asana, GitHub, Linear, Basecamp, Notion,
monday.com and other sites — is linked to the item it was started on. The **External Item**
dimension shows the time by tool (Service) and item. **Go to source** on an item opens it in its
tool. A tool this app does not know yet is shown under the host name of its pages.

Harvest does not keep the title of the item, so the name is built from what it keeps:

| Service | Item name |
|---|---|
| Jira | the notes the Harvest app for Jira writes, `HAR-31: Checkout page redesign`; the issue key and the notes when the notes do not start with the key; the notes alone when the key is not known; `Jira 10131`, the issue id, when there are neither notes nor a key |
| GitHub | the repository, the issue number and the notes, `eazybi/harvest-demo#42 Import expenses by category` |
| Linear | the issue identifier and the notes, `ENG-123 Fix the login page`, or the identifier alone when the notes are empty or start with it |
| other services | the first line of the notes, or the service and the item id when the notes are empty |

Only the first line of the notes is used. The name comes from the first time entry of the item that
an import reads. An incremental import reads only new and changed time entries, so a new entry on the
item, or edited notes, can rename it. Two items with the same name get a number in brackets to tell
them apart.

- A Jira issue is identified by its issue id, so it stays one item when it moves to another project
  and gets a new key. The **Issue key** property is the key from the time of tracking. Issues of two
  Jira sites are separate items.
- **External Item** is not the Issue dimension of a Jira import: eazyBI keeps the two cubes apart, so
  a Harvest Timesheets report cannot show Jira fields of the issue.
- Time entries without a link, expenses and budgets have no item, so the items add up to **Linked
  hours**, not to all **Hours**. **Unlinked hours** is the rest, and **Linked hours %** the linked
  share.
- A check for deleted records removes an item that no time entry links to any more.

## Harvest Invoices cube

| Dimension | Members |
|---|---|
| Invoice | Invoice › Invoice Item, with the number, subject, dates, status, client and more as properties |
| Client Project | Client › Project that the invoice or line item is billed for |
| Project Manager | the managers of that project, as in the Timesheets cube |
| Invoice Status | Draft, Open, Paid, Closed |
| Invoice Item Category | the category of the line item |
| Currency | the currency of the invoice |
| Time | the issue date of the invoice, and the due date of the due amount |

| Measure | What it is |
|---|---|
| Invoice amount | the total of the invoice |
| Item amount | the amount of a line item |
| Discount amount, Tax amount, Second tax amount | the discount and taxes of the invoice |
| Due amount | the unpaid part of the invoice, on its due date |

Every amount also has an **EUR** and a **USD** version, and the **Properties** group shows the
invoice, line item and project properties as report columns.

The invoice totals belong to the invoice, not to one of its items, so they are not counted again for
each item. An invoice or item without a project, or of a project you did not select, is shown under a
nameless project of the client. When two invoices have the same number, the Harvest ID is added to the
name of the second one.

## Detailed data rows

In the **Harvest Timesheets** cube, **Detailed data rows** of a report cell lists the timesheet rows
behind it: day, project, task, person, approval status, working time, external item and note. It is available for
the stored measures and for Unbillable hours, Hours without notes and the Uninvoiced measures. It is
not available for percentages, EUR and USD measures, margins and property measures. A time entry split
into business and non-business hours is listed as two rows.

⚠️ **Notes are visible to everyone who can open the Harvest Timesheets cube.** Harvest shows a time
entry and its note only to people who may see them, but eazyBI does not apply Harvest permissions.
Share the cube and its reports with that in mind.

Notes are only in Detailed data rows — a report cannot group by a note. A note of only spaces counts
as no note.

## Sample reports

The first import creates these reports in the **Samples Harvest** folder and the **Harvest
overview** dashboard. Turn off the "import sample reports" option if you do not want them.

| Report | What it shows |
|---|---|
| Sample hours by client | rounded and billable hours and the billable amount of every client |
| Sample hours by role | rounded, billable and unbillable hours of every role and its people |
| Sample hours without notes | the hours of every person with and without a note |
| Sample business and non-business hours by person | a bar chart of every person's hours within and outside business hours |
| Sample hours by external item | hours by the tool they were tracked in, expandable to the items |
| Sample linked hours by person | how much of every person's time is linked to an item, the smallest share first |
| Sample utilisation by person | every person's capacity, hours and utilisation in the previous month, the least used first |
| Sample uninvoiced hours and expenses | billable work and expenses of every client that are not invoiced yet |
| Sample active projects status | running projects with their managers, hours, budget and budget spent |
| Sample billable vs unbillable hours by project | a bar chart of billable and unbillable hours per project |
| Sample hours by task and month | a pie chart of hours or the billable amount in EUR or USD per task, month by month |
| Sample unpaid invoices | invoices that are not paid now, oldest first, with the amount still due |
| Sample invoice amounts by month | a bar chart of invoiced amounts per month, by invoice status |

The **Harvest overview** dashboard shows hours by project, invoice amounts, active projects and
uninvoiced work. Its time filter applies to the hours, the invoice amounts and the uninvoiced work, but
not to the active projects, which show their totals. The task and person filters apply to the hours,
the active projects and the uninvoiced work, and the client filter to the invoice amounts.

## Advanced settings

Harvest allows 100 requests per 15 seconds. When an import reaches this limit, eazyBI waits and
continues by itself.

| Setting | Default | When to change it |
|---|---|---|
| `api_timeout_in_seconds` | 120 | raise it when Harvest is slow to answer for a large account |
| `max_concurrent_requests` | 3 | lower it to 1 when imports often wait for the rate limit |

## License

MIT — see [LICENSE](LICENSE).
