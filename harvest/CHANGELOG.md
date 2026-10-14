# Changelog

All notable changes of the Harvest source application type are documented in this file, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and by
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-06

### Added

- Import of the clients, projects, tasks, people, roles, time entries, expenses, budgets and invoices
  of a Harvest account, connected with a personal access token of a Harvest administrator and the
  web address of the account.
- Project selection: all projects, also the ones created later, or only the selected projects with
  their clients and the invoices of those clients.
- The **Harvest Timesheets** cube with the Project Task, Project Status, Project Manager, Task,
  Person, Role, Approval Status, Working Time, External Item, Expense Category, Currency and Time
  dimensions, and the hours, rounded, billable and invoiced hours, budget, billable, invoiced, expense
  and cost amount measures.
- The **Harvest Invoices** cube with the Invoice, Client Project, Project Manager, Invoice Status,
  Invoice Item Category, Currency and Time dimensions, and the invoice, item, discount, tax and due
  amount measures.
- Calculated measures of unbillable and uninvoiced work, budget spent, margins, hours with and
  without notes, and EUR and USD conversions of every amount with the daily euro reference rates of
  the European Central Bank.
- The Properties measure group of the project, task, person, invoice and line item properties.
- The Working Time dimension, which splits tracked time into business and non-business hours by the
  Business hours start and end import options and the non-working days of the Time dimension.
- The External Item dimension: the Jira issue, Trello card, Asana task, GitHub issue or other item
  a time entry was tracked on through a Harvest integration, linked to the item in its tool, with the
  linked hours, unlinked hours and linked hours % measures.
- The Capacity hours measure, the weekly capacity of every person spread over the working days of the
  Time dimension, with the utilisation % and billable utilisation % measures, and the first and last
  tracked date of every person.
- Detailed data rows of the timesheet rows with their notes.
- Incremental imports, and the Check for deleted records import option, which removes the records
  deleted in Harvest every day, every week or only with a full reimport.
- Sample reports and the Harvest overview dashboard.
