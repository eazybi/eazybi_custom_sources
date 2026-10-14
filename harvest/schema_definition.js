// The cubes, their dimensions, levels, properties and measures carry the names of the built-in Harvest
// source application, so that a report written for one of them reads the same on the other. The Department
// hierarchy of the Person dimension is the only one left out: Harvest removed departments in 2018 and the
// built-in application deletes that hierarchy on every import.
//
// The `generation` column of every table has no name and no property, so it is neither a measure nor a
// level property. A table which two dimensions declare has it declared once.
app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension, cube = schema.cube,
      expr = schema.expr;

  // The web address of the Harvest account, which the member links of the levels below are built from.
  // A schema definition requests nothing itself, so it is entered as a source param. The address is
  // taken without the spaces and the trailing slash which the connection form accepts, so that a path
  // can follow it.
  var siteUrl = String(source.getSourceParam("site_url") || "").trim().replace(/\/+$/, "") || null;
  schema.setAnnotationAttributes({site_url: siteUrl});

  // A member link is declared only when the site URL is known: the placeholder of an annotation whose
  // attribute has no value is kept as it is and would link to a host that does not exist.
  function linkTo(l, path) {
    if (siteUrl) l.annotations({source_url: `{{site_url}}${path}`});
  }

  // The client and the project levels are stored in the tables of their own objects, so that a project
  // keeps its attributes however many tasks it has.
  dimension("Project Task", (d) => {
    d.table("project_tasks");
    d.level("Client", (l) => {
      l.table("clients");
      l.integer("id", {id: true, key: true, property: "URL_ID"});
      l.string("name", {name: true, ordinal: true});
      l.string("currency", {property: "Currency", limit: 10});
      l.integer("generation");
      linkTo(l, "/clients/{{id}}");
    });
    d.level("Project", (l) => {
      l.table("projects");
      l.integer("id", {id: true, key: true, property: "URL_ID"});
      l.integer("client_id", {parentKey: true});
      l.string("name", {name: true, ordinal: true});
      l.string("code", {property: "Code"});
      l.string("status", {property: "Status", limit: 20});
      l.boolean("billable", {property: "Billable"});
      l.string("budget_by", {property: "Budget by", limit: 20});
      l.string("bill_by", {property: "Bill by", limit: 20});
      l.decimal("hourly_rate", {property: "Hourly rate"});
      l.date("created_at", {property: "Created date"});
      l.date("updated_at", {property: "Updated date"});
      l.date("starts_on", {property: "Start date"});
      l.date("ends_on", {property: "End date"});
      l.boolean("cost_budget_include_expenses", {property: "Budget includes expenses"});
      // A project can have any number of managers, so the column is a text column.
      l.text("project_manager", {property: "Project manager"});
      l.text("notes", {property: "Notes"});
      l.integer("generation");
      linkTo(l, "/projects/{{id}}");
    });
    // The task as it is assigned to one project: its own billable flag, rate and budget, which is what a
    // timesheet row is measured with.
    d.level("Task", (l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.integer("project_id", {parentKey: true});
      l.integer("task_id", {limit: 8});
      l.string("name", {name: true, ordinal: true});
      l.boolean("deactivated", {property: "Deactivated"});
      l.boolean("billable", {property: "Billable"});
      l.decimal("hourly_rate", {property: "Hourly rate"});
      l.integer("generation");
    });
  });

  // Active or archived, over the project table and the project foreign key of the Project Task
  // dimension, which already declares and fills the column.
  dimension("Project Status", (d) => {
    d.sharedTable("projects");
    d.level((l) => l.string("status", {key: true, name: true, limit: 20, sharedTableColumn: true}));
  });

  // The Harvest people who manage a project now, one row per manager of the project. A project can have
  // several of them, so the dimension joins the rows of both cubes by their project foreign key, the way the
  // Role dimension joins them by their person, and a manager change applies to all rows of the project.
  dimension("Project Manager", (d) => {
    d.table("project_managers");
    d.level("Project Manager", (l) => {
      // A project member id, which is the Harvest id of the project, or the negative id of a client for
      // the nameless project member of the client.
      l.integer("project_id", {primaryKey: true, sharedForeignKey: true});
      l.string("name", {key: true});
      l.integer("generation");
    });
  });

  // The task itself, as it is defined for the whole account.
  dimension("Task", (d) => {
    d.table("tasks");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("name", {name: true, ordinal: true});
      l.boolean("deactivated", {property: "Deactivated"});
      l.boolean("billable_by_default", {property: "Billable by default"});
      l.boolean("is_default", {property: "Common task"});
      l.decimal("hourly_rate", {property: "Hourly rate"});
      l.integer("generation");
    });
  });

  dimension("Person", (d) => {
    d.table("people");
    d.level("Type", (l) => {
      l.string("person_type", {key: true, name: true, limit: 20});
      l.boolean("is_contractor", {ordinal: true});
    });
    d.level("Person", (l) => {
      l.integer("id", {id: true, key: true, limit: 8, property: "URL_ID"});
      l.string("name", {name: true, ordinal: true});
      l.string("person_type", {property: "Person type", limit: 20});
      l.boolean("is_active", {property: "Active"});
      l.boolean("is_contractor", {property: "Contractor"});
      l.decimal("weekly_capacity_hours", {precision: 15, scale: 4, property: "Weekly capacity"});
      l.decimal("default_hourly_rate", {property: "Default hourly rate"});
      l.decimal("cost_rate", {property: "Cost rate"});
      l.date("created_at", {property: "Created date"});
      l.date("first_tracked_date", {property: "First tracked date"});
      l.date("last_tracked_date", {property: "Last tracked date"});
      l.string("email", {property: "Email"});
      l.integer("generation");
      // The digest of what the stored capacity rows of the person were built from (importers/capacity.js).
      l.string("capacity_digest", {limit: 20});
      linkTo(l, "/people/{{id}}");
    });
  });

  // The Harvest roles a person has now, one row per role of the person. A person can have several of
  // them, so the dimension joins the timesheet rows by their person foreign key, the way the built-in
  // Harvest application joins it, and a role change applies to all rows of the person at once.
  dimension("Role", (d) => {
    d.table("person_roles");
    d.level("Role", (l) => {
      // A person member id, which the Person level stores as a long integer.
      l.integer("person_id", {primaryKey: true, sharedForeignKey: true, limit: 8});
      l.string("name", {key: true});
      l.integer("generation");
    });
  });

  // Where the time or the expense is in a Harvest timesheet approval: unsubmitted, submitted or approved.
  dimension("Approval Status", (d) => {
    d.table("approval_statuses");
    d.level((l) => {
      l.integer("id", {id: true, key: true});
      l.string("name", {name: true, limit: 50});
      l.integer("generation");
    });
  });

  // Whether the time was tracked within the business hours of a working day (importers/working_times.js).
  // A time entry tracked partly within them is two rows, one of each member. An expense and a budget
  // belong to no time of day and are reported under neither.
  dimension("Working Time", (d) => {
    d.table("working_times");
    d.level((l) => {
      l.integer("id", {id: true, key: true});
      l.string("name", {name: true, limit: 50});
      l.integer("generation");
      // The digest of the business hours and the non-working days the stored time entries were classified by.
      l.string("classification", {limit: 20});
    });
  });

  // The item of another tool a time entry was tracked on, by the tool it is in (importers/external_items.js).
  // A time entry which is not linked to an item, an expense and a budget are reported under no item. The
  // name is not "Issue": the dimensions of all the cubes of an account share one set of names, and the
  // Issue dimension of a Jira import would be taken for this one.
  dimension("External Item", (d) => {
    d.table("external_items");
    // A large account links many thousand items, so a report shows only the items with time by default.
    d.dimensionAnnotations({default_nonempty_crossjoin: true});
    d.level("Service", (l) => {
      l.table("external_services");
      l.string("name", {key: true, name: true, ordinal: true, limit: 100});
      l.integer("generation");
    });
    d.level("Item", (l) => {
      l.string("key", {key: true});
      l.integer("service_id", {parentKey: true});
      l.string("name", {name: true, ordinal: true});
      l.string("item_id", {property: "Item ID"});
      l.string("group_id", {property: "Group ID"});
      l.string("account_id", {property: "Account ID"});
      l.string("service", {property: "Service"});
      l.string("issue_key", {property: "Issue key"});
      // A property of this name is the address the member links to, the permalink Harvest stores with the
      // reference, because the address differs by service and cannot be built from a template.
      l.text("permalink", {property: "URL"});
      l.integer("generation");
    });
  });

  dimension("Expense Category", (d) => {
    d.table("expense_categories");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("name", {name: true, ordinal: true});
      l.integer("generation");
    });
  });

  // The client and the project an invoice line item is billed for, of the Invoices cube. It reports by the
  // client and the project tables of the Project Task dimension, so that both cubes report by the same
  // clients and projects; an invoice which names no project of its client is reported by the nameless
  // project member the import creates for every client.
  dimension("Client Project", (d) => {
    d.table("projects");
    d.level("Client", (l) => {
      l.table("clients");
      l.integer("id", {id: true, key: true, property: "URL_ID"});
      l.string("name", {name: true, ordinal: true});
      l.string("currency", {property: "Currency", limit: 10});
      linkTo(l, "/clients/{{id}}");
    });
    d.level("Project", (l) => {
      l.integer("id", {id: true, key: true, property: "URL_ID"});
      l.integer("client_id", {parentKey: true});
      l.string("name", {name: true, ordinal: true});
      l.string("code", {property: "Code"});
      l.string("status", {property: "Status", limit: 20});
      l.text("project_manager", {property: "Project manager"});
      l.text("notes", {property: "Notes"});
      l.date("starts_on", {property: "Start date"});
      l.date("ends_on", {property: "End date"});
      linkTo(l, "/projects/{{id}}");
    });
  });

  // The invoice and its line items. A line item is keyed by its position on the invoice, which is the only
  // identifier Harvest answers for all of them, and the amounts of the invoice itself hang under the one
  // item of position -1 the import adds.
  dimension("Invoice", (d) => {
    d.table("invoice_items");
    d.level("Invoice", (l) => {
      l.table("invoices");
      l.integer("id", {id: true, key: true, property: "URL_ID"});
      l.string("name", {name: true});
      l.string("number", {property: "Number", limit: 50});
      l.string("subject", {property: "Subject"});
      l.date("issued_date", {ordinal: true, property: "Issued date"});
      l.date("due_date", {property: "Due date"});
      l.date("sent_date", {property: "Sent date"});
      l.date("paid_date", {property: "Paid date"});
      l.date("closed_date", {property: "Closed date"});
      l.date("period_start_date", {property: "Period start date"});
      l.date("period_end_date", {property: "Period end date"});
      l.string("payment_term", {property: "Payment term", limit: 50});
      l.string("currency", {property: "Currency", limit: 10});
      l.string("client_name", {property: "Client"});
      l.string("status", {property: "Status", limit: 20});
      l.string("created_by", {property: "Created by"});
      l.string("purchase_order", {property: "PO number"});
      l.integer("retainer_id", {property: "Retainer ID", limit: 8});
      l.integer("estimate_id", {property: "Estimate ID", limit: 8});
      l.text("notes", {property: "Notes"});
      l.integer("generation");
      linkTo(l, "/invoices/{{id}}");
    });
    d.level("Invoice Item", (l) => {
      l.integer("position", {key: true});
      l.integer("invoice_id", {parentKey: true});
      l.string("description", {name: true});
      l.string("category", {property: "Category", limit: 100});
      l.string("project", {property: "Project"});
      l.decimal("quantity", {property: "Quantity"});
      l.decimal("unit_price", {property: "Unit price"});
      l.boolean("taxed", {property: "Taxed"});
      l.boolean("taxed2", {property: "Taxed by the second tax"});
      l.integer("generation");
    });
  });

  // Draft, Open, Paid or Closed, over the invoice table and the invoice foreign key of the Invoice
  // dimension, which already declares and fills the column.
  dimension("Invoice Status", (d) => {
    d.sharedTable("invoices");
    d.level((l) => l.string("status", {key: true, name: true, limit: 20, sharedTableColumn: true}));
  });

  dimension("Invoice Item Category", (d) => {
    d.table("invoice_item_categories");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("name", {name: true, ordinal: true});
      l.integer("generation");
    });
  });

  // The currency a project is billed in and an invoice is issued in, with the euro reference rate of the
  // European Central Bank that the amount measures of both cubes are converted with. The currency of the
  // Harvest account is flagged.
  dimension("Currency", (d) => {
    d.table("currencies");
    d.level((l) => {
      l.string("currency", {key: true, name: true, ordinal: true, limit: 10});
      l.decimal("eur_rate", {precision: 15, scale: 4, property: "EUR rate"});
      l.boolean("account_currency", {property: "Account currency"});
      l.integer("generation");
    });
  });

  timeDimension("Time");

  // Mondrian drills a calculated measure through only when its formula is arithmetic of stored measures,
  // and Detailed data rows of a cell of any other calculated measure fails, so the action is hidden for it.
  var noDrillThrough = {disable_drill_through: true};

  // An amount is stored in the currency of the row — the currency the project is billed in, or the one the
  // invoice is issued in — so a report which sums the rows of several currencies converts every amount with
  // the euro reference rate of its own currency. The dollar member converts that euro sum once more, at the
  // dollar rate. The amounts of a currency without a rate are left out: Mondrian divides by an empty rate
  // into Infinity. DescendantsSet takes the currencies of the aggregate member which a page filter of
  // several currencies is, where Descendants would take none.
  function currencyConvertedMembers(c, measureName) {
    c.calculatedMember(`${measureName} EUR`, {
      formula: `
        Sum(
          DescendantsSet({[Currency].CurrentMember}, [Currency].[Currency]),
          CASE WHEN [Currency].CurrentMember.get('EUR rate') > 0 THEN
            [Measures].[${measureName}] /
            [Currency].CurrentMember.get('EUR rate')
          END
        )`,
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    c.calculatedMember(`${measureName} USD`, {
      formula: `
        [Measures].[${measureName} EUR] *
        [Currency].[USD].get('EUR rate')`,
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
  }

  // The host names a cube "<source cube name> <cube name>", and the source cube name is the manifest name
  // "Harvest" — so the two cubes below are "Harvest Timesheets" and "Harvest Invoices", the names the
  // built-in Harvest source application gives the same two cubes.
  cube("Timesheets", (c) => {
    c.dimensions("Project Task", "Project Status", "Project Manager", "Task", "Person", "Role",
      "Approval Status", "Working Time", "External Item", "Expense Category", "Currency", "Time");
    c.table("timesheets");
    // A report cell is drilled through to the timesheet rows it sums, as in the built-in Harvest source
    // application, and each row shows its working time, which tells the two rows of a split time entry
    // apart. A cell of a calculated measure which Mondrian drills through names no stored measure of its
    // own, so its rows show the rounded hours and the expenses amount.
    c.annotations({
      enable_drill_through: true,
      drill_through_return: [
        "[Time].[Year]",
        "[Time].[Month]",
        "[Time].[Day]",
        "Name([Project Task].[Project])",
        "Name([Project Task].[Task])",
        "Name([Person].[Person])",
        "Name([Approval Status].[Approval Status])",
        "Name([Working Time].[Working Time])",
        "Name([External Item].[Item])",
        "[Measures].[Notes]"
      ],
      drill_through_default_measures: "[Measures].[Rounded hours],[Measures].[Expenses amount]"
    });
    c.measures((m) => {
      m.decimal("hours", {name: "Hours", formatString: "#,##0.00"});
      m.decimal("rounded_hours", {name: "Rounded hours", formatString: "#,##0.00"});
      m.decimal("billable_hours", {name: "Billable hours", formatString: "#,##0.00"});
      m.decimal("invoiced_hours", {name: "Invoiced hours", formatString: "#,##0.00"});
      m.decimal("budgeted_hours", {name: "Budgeted hours", formatString: "#,##0.00"});
      m.decimal("budgeted_cost", {name: "Budgeted cost", formatString: "#,##0.00"});
      m.decimal("billable_amount", {name: "Billable amount", formatString: "#,##0.00"});
      m.decimal("invoiced_amount", {name: "Invoiced amount", formatString: "#,##0.00"});
      m.decimal("expenses_amount", {name: "Expenses amount", formatString: "#,##0.00"});
      m.decimal("billable_expenses", {name: "Billable expenses", formatString: "#,##0.00"});
      m.decimal("invoiced_expenses", {name: "Invoiced expenses", formatString: "#,##0.00"});
      // The rounded hours at the cost rate of the person, in the currency of the Harvest account.
      m.decimal("cost_amount", {name: "Cost amount", formatString: "#,##0.00"});
      // The hours a person is available on a working day, a share of the weekly capacity of the person.
      m.decimal("capacity_hours",
        {name: "Capacity hours", precision: 15, scale: 4, formatString: "#,##0.00"});
      // What the person wrote on the time entry or the expense. It is not a measure users report on —
      // it is the column that makes a drill through list of timesheet rows readable.
      m.text("notes", {name: "Notes", aggregator: "distinct-count", visible: false});
      // An expense row has no hours, so it adds nothing.
      m.decimalExpression(expr.caseNotNull("notes", "hours"),
        {name: "Hours with notes", formatString: "#,##0.00"});
      m.decimalExpression(expr.caseNotNull("external_item_id", "hours"),
        {name: "Linked hours", formatString: "#,##0.00"});
      m.integer("generation");
    });
    c.timeDimensionCalculatedMembers();

    c.calculatedMember("Unbillable hours", {
      formula: "[Measures].[Rounded hours] - [Measures].[Billable hours]",
      formatString: "#,##0.00"
    });
    c.calculatedMember("Billable hours %", {
      formula: `
        IIF([Measures].[Rounded hours] > 0,
          CoalesceEmpty([Measures].[Billable hours],0)/[Measures].[Rounded hours],
          NULL
        )`,
      formatString: "#0%",
      annotations: noDrillThrough
    });
    // Only arithmetic of the stored measures, because Mondrian drills through no other formula, and a
    // cell of it is drilled through to see the entries of the person.
    c.calculatedMember("Hours without notes", {
      formula: "[Measures].[Hours] - [Measures].[Hours with notes]",
      formatString: "#,##0.00"
    });
    c.calculatedMember("Unlinked hours", {
      formula: "[Measures].[Hours] - [Measures].[Linked hours]",
      formatString: "#,##0.00"
    });
    c.calculatedMember("Linked hours %", {
      formula: `
        IIF([Measures].[Hours] > 0,
          CoalesceEmpty([Measures].[Linked hours],0)/[Measures].[Hours],
          NULL
        )`,
      formatString: "#0%",
      annotations: noDrillThrough
    });
    c.calculatedMember("Uninvoiced hours", {
      formula: "[Measures].[Billable hours] - [Measures].[Invoiced hours]",
      formatString: "#,##0.00"
    });
    c.calculatedMember("Uninvoiced amount", {
      formula: "[Measures].[Billable amount] - [Measures].[Invoiced amount]",
      formatString: "#,##0.00"
    });
    c.calculatedMember("Uninvoiced expenses", {
      formula: "[Measures].[Billable expenses] - [Measures].[Invoiced expenses]",
      formatString: "#,##0.00"
    });
    c.calculatedMember("Uninvoiced amount with expenses", {
      formula: "[Measures].[Uninvoiced amount] + [Measures].[Uninvoiced expenses]",
      formatString: "#,##0.00"
    });

    currencyConvertedMembers(c, "Billable amount");
    currencyConvertedMembers(c, "Invoiced amount");
    currencyConvertedMembers(c, "Expenses amount");
    currencyConvertedMembers(c, "Billable expenses");
    currencyConvertedMembers(c, "Invoiced expenses");
    // Already converted amounts, which are added in the same currency instead of converted again.
    c.calculatedMember("Invoiced amount with expenses EUR", {
      formula: "[Measures].[Invoiced amount EUR] + [Measures].[Invoiced expenses EUR]",
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    c.calculatedMember("Invoiced amount with expenses USD", {
      formula: "[Measures].[Invoiced amount USD] + [Measures].[Invoiced expenses USD]",
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    currencyConvertedMembers(c, "Uninvoiced amount");
    currencyConvertedMembers(c, "Uninvoiced expenses");
    currencyConvertedMembers(c, "Uninvoiced amount with expenses");
    currencyConvertedMembers(c, "Budgeted cost");

    // A cost amount is in the currency of the Harvest account and not in the currency of its row, so it
    // is converted with the rate of the flagged account currency. It has no conversion when the import
    // did not learn the currency of the account or its rate: a division by no rate is infinite.
    var accountCurrencies = `
      Filter([Currency].[Currency].Members,
        [Currency].CurrentMember.getBoolean('Account currency') AND
        [Currency].CurrentMember.get('EUR rate') > 0)`;
    c.calculatedMember("Cost amount EUR", {
      formula: `
        CASE WHEN Count(${accountCurrencies}) > 0 THEN
          [Measures].[Cost amount] /
          ${accountCurrencies}.Item(0).get('EUR rate')
        END`,
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    c.calculatedMember("Cost amount USD", {
      formula: `
        [Measures].[Cost amount EUR] *
        [Currency].[USD].get('EUR rate')`,
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    // The billable amount of the time less its cost, the way the Harvest profitability report counts the
    // time. The expenses are in neither of them. Without the account currency the cost is unknown, and
    // the margin would otherwise be the whole billable amount. Without the rate of a currency the cell
    // bills in, the converted billable amount leaves that currency out while its cost is in, and the
    // margin would be too low; time billed at a rate of zero converts to zero without a rate.
    var marginKnown = `
      Count(${accountCurrencies}) > 0 AND
      Count(Filter(DescendantsSet({[Currency].CurrentMember}, [Currency].[Currency]),
        NOT ([Currency].CurrentMember.get('EUR rate') > 0) AND
        NOT IsEmpty([Measures].[Billable amount]) AND [Measures].[Billable amount] <> 0)) = 0`;
    c.calculatedMember("Margin EUR", {
      formula: `
        CASE WHEN ${marginKnown} THEN
          [Measures].[Billable amount EUR] - [Measures].[Cost amount EUR]
        END`,
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    c.calculatedMember("Margin USD", {
      formula: `
        CASE WHEN ${marginKnown} THEN
          [Measures].[Billable amount USD] - [Measures].[Cost amount USD]
        END`,
      formatString: "#,##0.00",
      annotations: noDrillThrough
    });
    c.calculatedMember("Margin %", {
      formula: `
        IIF([Measures].[Billable amount EUR] > 0,
          [Measures].[Margin EUR] / [Measures].[Billable amount EUR],
          NULL
        )`,
      formatString: "#0%",
      annotations: noDrillThrough
    });

    // A budget is set for a project or for one of its tasks, and it is a budget of hours or of money,
    // so the share of it which is spent has a value on those two levels and for one of the two.
    c.calculatedMember("Budget spent %", {
      formula: `
        CASE WHEN [Project Task].CurrentMember.Level.Name = 'Project'
            OR [Project Task].CurrentMember.Level.Name = 'Task'
        THEN CASE
          WHEN [Measures].[Budgeted hours] > 0 THEN
            CoalesceEmpty([Measures].[Rounded hours], 0) /
              [Measures].[Budgeted hours]
          WHEN [Measures].[Budgeted cost] > 0 THEN
            CoalesceEmpty([Measures].[Billable amount] +
              [Measures].[Expenses amount], 0) /
              [Measures].[Budgeted cost]
          END
        END`,
      formatString: "#0%",
      annotations: noDrillThrough
    });

    // The capacity of the people and the days of the report cell, whatever project, task, approval status,
    // working time, external item, expense category and currency the cell is for: a capacity row belongs to
    // none of them. The utilisation of a project is therefore the share of the capacity of its people which
    // they tracked on it.
    var nonPersonDimensions = ["Project Task", "Project Status", "Project Manager", "Task", "Approval Status",
                               "Working Time", "External Item", "Expense Category", "Currency"];
    var capacityOfPeople = `
      ([Measures].[Capacity hours],
        ${nonPersonDimensions.map((name) => `[${name}].DefaultMember`).join(", ")})`;
    // A person without time has no utilisation of a project or of anything else they did not work on, so that
    // a report of them which leaves out the empty rows leaves those out; only their utilisation as such is 0.
    var noOtherDimension = nonPersonDimensions.
      map((name) => `[${name}].CurrentMember IS [${name}].DefaultMember`).join(" AND ");
    function utilisationOf(hoursMeasure) {
      return `
        CASE WHEN ${capacityOfPeople} > 0 THEN
          CASE
          WHEN NOT IsEmpty([Measures].[Hours]) THEN
            CoalesceEmpty([Measures].[${hoursMeasure}], 0) / ${capacityOfPeople}
          WHEN ${noOtherDimension} THEN 0
          END
        END`;
    }
    c.calculatedMember("Utilisation %", {
      formula: utilisationOf("Hours"),
      formatString: "#0%",
      annotations: noDrillThrough
    });
    c.calculatedMember("Billable utilisation %", {
      formula: utilisationOf("Billable hours"),
      formatString: "#0%",
      annotations: noDrillThrough
    });

    var propertyGroup = {group: "Properties", disable_drill_through: true};

    function projectProperty(valueOfMember) {
      return `
        CASE [Project Task].CurrentMember.Level.Name
        WHEN 'Project' THEN
          ${ofProjectInReport("[Project Task].CurrentMember", valueOfMember)}
        WHEN 'Task' THEN
          ${ofProjectInReport("[Project Task].CurrentMember.Parent", valueOfMember)}
        END`;
    }

    // A property of a project shows in a report whose other dimensions are all at their All member, so that
    // a project without any row shows it as well, unless the project is not in the Project Status member the
    // report is filtered by. In a report narrowed by another dimension it shows only where the cell has
    // hours, expenses or a budget of the project, so that it does not keep the row of a project, a task or a
    // client which the filters leave out in a non-empty report. CurrentHierarchyMember answers the member of
    // any hierarchy of a dimension, so that a Time filter of the Weekly hierarchy counts as well.
    var unfilteredByOthers = ["Project Manager", "Task", "Person", "Role", "Approval Status", "Working Time",
                              "External Item", "Expense Category", "Currency", "Time"].
      map((name) => `[${name}].CurrentHierarchyMember IS [${name}].DefaultMember`).join(" AND ");
    var withProjectRows = ["Hours", "Expenses amount", "Budgeted hours", "Budgeted cost"].
      map((name) => `NOT IsEmpty([Measures].[${name}])`).join(" OR ");

    function inReport(inStatus, value) {
      return `
        CASE WHEN (([Project Status].CurrentMember.Level.Name <> 'Project Status' OR ${inStatus})
            AND ${unfilteredByOthers}) OR ${withProjectRows}
        THEN ${value}
        END`;
    }

    function ofProjectInReport(project, valueOfMember) {
      return inReport(`[Project Status].CurrentMember.Name = ${project}.get('Status')`,
        valueOfMember(project));
    }

    function propertyValue(name) {
      return (member) => `${member}.get('${name}')`;
    }

    function personProperty(name) {
      return `
        CASE [Person].CurrentMember.Level.Name WHEN 'Person' THEN
          [Person].CurrentMember.get('${name}')
        END`;
    }

    // The currency is a property of the client, which both the project and its tasks are reported in. A
    // client is in the Project Status member a report is filtered by when one of its projects is.
    c.calculatedMember("Project currency", {
      formula: `
        CASE [Project Task].CurrentMember.Level.Name
        WHEN 'Client' THEN
          ${inReport(`Count(Filter([Project Task].CurrentMember.Children,
                [Project Task].CurrentMember.get('Status') = [Project Status].CurrentMember.Name)) > 0`,
            "[Project Task].CurrentMember.get('Currency')")}
        WHEN 'Project' THEN
          ${ofProjectInReport("[Project Task].CurrentMember",
            (project) => `${project}.Parent.get('Currency')`)}
        WHEN 'Task' THEN
          ${ofProjectInReport("[Project Task].CurrentMember.Parent",
            (project) => `${project}.Parent.get('Currency')`)}
        END`,
      annotations: propertyGroup
    });
    c.calculatedMember("Project status", {
      formula: projectProperty(propertyValue("Status")),
      annotations: propertyGroup
    });
    c.calculatedMember("Project manager", {
      formula: projectProperty(propertyValue("Project manager")),
      annotations: propertyGroup
    });
    c.calculatedMember("Project notes", {
      formula: projectProperty(propertyValue("Notes")),
      annotations: propertyGroup
    });
    c.calculatedMember("Project billable?", {
      formula: projectProperty((member) => `IIF(${member}.getBoolean('Billable'), 'Yes', 'No')`),
      annotations: propertyGroup
    });
    c.calculatedMember("Project budget by", {
      formula: projectProperty((member) => `Titleize(${member}.get('Budget by'))`),
      annotations: propertyGroup
    });
    // Only a cost budget of a project can include its expenses.
    c.calculatedMember("Project budget includes expenses?", {
      formula: `
        IIF([Measures].[Project budget by] = 'Project Cost',
        CASE [Project Task].CurrentMember.Level.Name
        WHEN 'Project' THEN
          IIF([Project Task].CurrentMember.getBoolean('Budget includes expenses'), 'Yes', 'No')
        WHEN 'Task' THEN
          IIF([Project Task].CurrentMember.Parent.getBoolean('Budget includes expenses'), 'Yes', 'No')
        END, NULL)`,
      annotations: propertyGroup
    });
    c.calculatedMember("Project bill by", {
      formula: projectProperty((member) => `Titleize(${member}.get('Bill by'))`),
      annotations: propertyGroup
    });
    c.calculatedMember("Project hourly rate", {
      formula: projectProperty(propertyValue("Hourly rate")),
      formatString: "#,##0.00",
      annotations: propertyGroup
    });
    c.calculatedMember("Project start date", {
      formula: projectProperty(propertyValue("Start date")),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Project end date", {
      formula: projectProperty(propertyValue("End date")),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Project task billable?", {
      formula: `
        CASE [Project Task].CurrentMember.Level.Name
        WHEN 'Task' THEN
          ${ofProjectInReport("[Project Task].CurrentMember.Parent",
            () => "IIF([Project Task].CurrentMember.getBoolean('Billable'), 'Yes', 'No')")}
        END`,
      annotations: propertyGroup
    });
    c.calculatedMember("Project task hourly rate", {
      formula: `
        CASE [Project Task].CurrentMember.Level.Name
        WHEN 'Task' THEN
          ${ofProjectInReport("[Project Task].CurrentMember.Parent",
            () => "[Project Task].CurrentMember.get('Hourly rate')")}
        END`,
      formatString: "#,##0.00",
      annotations: propertyGroup
    });
    c.calculatedMember("Person type", {
      formula: `
        CASE WHEN NOT [Person].CurrentMember IS [Person].DefaultMember THEN
          [Person].CurrentMember.get('Person type')
        END`,
      annotations: propertyGroup
    });
    c.calculatedMember("Task hourly rate", {
      formula: "[Task].CurrentMember.get('Hourly rate')",
      formatString: "#,##0.00",
      annotations: propertyGroup
    });
    c.calculatedMember("Person weekly capacity", {
      formula: personProperty("Weekly capacity"),
      formatString: "#,##0.00",
      annotations: propertyGroup
    });
    c.calculatedMember("Person default hourly rate", {
      formula: personProperty("Default hourly rate"),
      formatString: "#,##0.00",
      annotations: propertyGroup
    });
    c.calculatedMember("Person cost rate", {
      formula: personProperty("Cost rate"),
      formatString: "#,##0.00",
      annotations: propertyGroup
    });
    c.calculatedMember("Person created date", {
      formula: personProperty("Created date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Person first tracked date", {
      formula: personProperty("First tracked date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Person last tracked date", {
      formula: personProperty("Last tracked date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
  });

  cube("Invoices", (c) => {
    c.dimensions("Client Project", "Project Manager", "Invoice", "Invoice Status", "Invoice Item Category",
      "Currency", "Time");
    c.table("invoices");
    c.measures((m) => {
      m.decimal("invoice_amount", {name: "Invoice amount", formatString: "#,##0.00"});
      m.decimal("item_amount", {name: "Item amount", formatString: "#,##0.00"});
      m.decimal("discount_amount", {name: "Discount amount", formatString: "#,##0.00"});
      m.decimal("tax_amount", {name: "Tax amount", formatString: "#,##0.00"});
      m.decimal("tax2_amount", {name: "Second tax amount", formatString: "#,##0.00"});
      m.decimal("due_amount", {name: "Due amount", formatString: "#,##0.00"});
      m.integer("generation");
    });
    c.timeDimensionCalculatedMembers();

    currencyConvertedMembers(c, "Invoice amount");
    currencyConvertedMembers(c, "Item amount");
    currencyConvertedMembers(c, "Discount amount");
    currencyConvertedMembers(c, "Tax amount");
    currencyConvertedMembers(c, "Second tax amount");
    currencyConvertedMembers(c, "Due amount");

    var propertyGroup = {group: "Properties"};

    function invoiceProperty(name) {
      return `
        CASE [Invoice].CurrentMember.Level.Name
        WHEN 'Invoice' THEN
          ${ofInvoiceInReport(`[Invoice].CurrentMember.get('${name}')`)}
        WHEN 'Invoice Item' THEN
          ${ofInvoiceInReport(`[Invoice].CurrentMember.Parent.get('${name}')`)}
        END`;
    }

    function invoiceItemProperty(name) {
      return `
        CASE [Invoice].CurrentMember.Level.Name
        WHEN 'Invoice Item' THEN
          ${ofInvoiceInReport(`[Invoice].CurrentMember.get('${name}')`)}
        END`;
    }

    // A property of an invoice or a line item without a row in the report cell — of another status, client,
    // currency or period than the page filters select — is empty, so that it does not keep the row of an
    // invoice the report leaves out. Every invoice has a row of its amount, and every line item one of its
    // own, so without filters every property has a value.
    var withInvoiceRows = ["Invoice amount", "Item amount", "Due amount"].
      map((name) => `NOT IsEmpty([Measures].[${name}])`).join(" OR ");

    function ofInvoiceInReport(value) {
      return `
        CASE WHEN ${withInvoiceRows}
        THEN ${value}
        END`;
    }

    // A property of a project or a client shows in a report whose other dimensions are all at their All
    // member, so that a project without invoices shows it as well, and otherwise only where the cell has
    // rows of the project, as in the Timesheets cube.
    var invoicesUnfilteredByOthers = ["Project Manager", "Invoice", "Invoice Status", "Invoice Item Category",
                                      "Currency", "Time"].
      map((name) => `[${name}].CurrentHierarchyMember IS [${name}].DefaultMember`).join(" AND ");

    function ofProjectInInvoices(value) {
      return `
        CASE WHEN ${invoicesUnfilteredByOthers} OR ${withInvoiceRows}
        THEN ${value}
        END`;
    }

    function projectProperty(name) {
      return `
        CASE [Client Project].CurrentMember.Level.Name
        WHEN 'Project' THEN
          ${ofProjectInInvoices(`[Client Project].CurrentMember.get('${name}')`)}
        END`;
    }

    c.calculatedMember("Project currency", {
      formula: `
        CASE [Client Project].CurrentMember.Level.Name
        WHEN 'Client' THEN
          ${ofProjectInInvoices("[Client Project].CurrentMember.get('Currency')")}
        WHEN 'Project' THEN
          ${ofProjectInInvoices("[Client Project].CurrentMember.Parent.get('Currency')")}
        END`,
      annotations: propertyGroup
    });
    c.calculatedMember("Project status", {
      formula: projectProperty("Status"),
      annotations: propertyGroup
    });
    c.calculatedMember("Project manager", {
      formula: projectProperty("Project manager"),
      annotations: propertyGroup
    });
    c.calculatedMember("Project notes", {
      formula: projectProperty("Notes"),
      annotations: propertyGroup
    });
    c.calculatedMember("Project start date", {
      formula: projectProperty("Start date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Project end date", {
      formula: projectProperty("End date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice issued date", {
      formula: invoiceProperty("Issued date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice due date", {
      formula: invoiceProperty("Due date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice period start date", {
      formula: invoiceProperty("Period start date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice period end date", {
      formula: invoiceProperty("Period end date"),
      formatString: "mmm dd yyyy",
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice currency", {
      formula: invoiceProperty("Currency"),
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice client", {
      formula: invoiceProperty("Client"),
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice status", {
      formula: invoiceProperty("Status"),
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice created by", {
      formula: invoiceProperty("Created by"),
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice item category", {
      formula: invoiceItemProperty("Category"),
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice item project", {
      formula: invoiceItemProperty("Project"),
      annotations: propertyGroup
    });
    c.calculatedMember("Invoice PO number", {
      formula: invoiceProperty("PO number"),
      annotations: propertyGroup
    });
  });
});
