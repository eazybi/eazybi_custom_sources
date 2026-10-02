app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension, cube = schema.cube,
      expr = schema.expr;

  var importLicenses = source.getExtraOption("import_licenses");
  var importTransactions = source.getExtraOption("import_transactions");

  // The licenses fact table has one row per license event and the transactions fact table one row
  // per transaction event, so a cell of a license measure lists licenses and a cell of a
  // transaction measure lists transaction lines.
  var licenseAnnotations = {drill_through_dimension_levels: ["[License].[License]"]};
  var transactionAnnotations = {drill_through_dimension_levels: ["[Transaction].[Transaction]"]};

  // A measure showing the value of one property of the license or the transaction a report row is
  // on: `["License end date", "License", "End date", "mmm dd yyyy"]`. The property measures of one
  // object are listed together in a group named after it. A property without a format string
  // declares none, because an option without a value is not a valid option.
  //
  // The App key property is shown as the name of its App member, so that the app is named the
  // same as in the App dimension, which names it by its Marketplace listing.
  function propertyMeasure(property, annotations, visible) {
    var value = `[${property[1]}].CurrentHierarchyMember.get('${property[2]}')`;
    var options = {
      formula: property[2] === "App key" ? `[App].[App].getMemberNameByKey(${value})` : value,
      annotations: Object.assign({group: `${property[1]} properties`}, annotations),
      visible: visible
    };
    if (property[3]) options.formatString = property[3];
    return options;
  }

  dimension("App", (d) => {
    d.table("apps");
    d.level((l) => {
      l.string("app_key", {key: true, property: "App key"});
      l.string("name", {name: true, ordinal: true,
        nameExpression: expr.coalesce("name", "(unknown app)")});
      l.string("product_id", {property: "Product ID"});
      l.string("state", {property: "Listing state", limit: 30});
    });
  });

  dimension("Hosting", (d) => {
    d.table("hostings");
    d.level((l) => {
      l.string("hosting_key", {key: true, name: true, limit: 30});
      l.integer("position", {ordinal: true});
    });
  });

  dimension("License Type", (d) => {
    d.table("license_types");
    d.level((l) => {
      l.string("license_type_key", {key: true, name: true, limit: 50});
      l.integer("position", {ordinal: true});
    });
  });

  dimension("License Status", (d) => {
    d.table("license_statuses");
    d.level((l) => {
      l.string("license_status_key", {key: true, name: true, limit: 30});
      l.integer("position", {ordinal: true});
    });
  });

  // The user or edition count of the license. The Range level groups the tiers into the size
  // brackets a vendor thinks in, the Tier level keeps the exact tier.
  dimension("License Tier", (d) => {
    d.table("license_tiers");
    d.level("Range", (l) => {
      l.string("range_key", {key: true, name: true, limit: 50});
      l.integer("range_max", {ordinal: true});
    });
    d.level("Tier", (l) => {
      l.string("tier_key", {key: true, name: true});
      l.integer("users", {ordinal: true, property: "Users"});
    });
  });

  dimension("Country", (d) => {
    d.table("countries");
    d.level("Region", (l) => l.string("region", {key: true, name: true, limit: 50}));
    d.level("Country", (l) => l.string("country", {key: true, name: true}));
  });

  // One row per partner name and partner type, because the same partner is reported with
  // different types over time. The main hierarchy has the partner name alone, so that all sales
  // of one partner aggregate into one member whatever type they were reported under; the Group
  // hierarchy joins the subsidiaries of one partner, which the Marketplace reports under their
  // own legal names, into the partner they belong to; the Type hierarchy splits the partners by
  // the partner type again.
  dimension("Partner", (d) => {
    d.table("partners");
    d.level((l) => {
      l.string("name", {key: true, name: true});
    });
    d.hierarchy("Group", () => {
      d.level("Group", (l) => l.string("partner_group", {key: true, name: true}));
      d.level("Partner", (l) => l.string("name", {key: true, name: true}));
    });
    d.hierarchy("Type", () => {
      d.level("Type", (l) => l.string("partner_type", {key: true, name: true, limit: 50}));
      d.level("Partner", (l) => l.string("name", {key: true, name: true}));
    });
  });

  dimension("Product Edition", (d) => {
    d.table("product_editions");
    d.level((l) => {
      l.string("product_edition_key", {key: true, name: true, limit: 50});
      l.integer("position", {ordinal: true});
    });
  });

  dimension("Billing Period", (d) => {
    d.table("billing_periods");
    d.level((l) => {
      l.string("billing_period_key", {key: true, name: true, limit: 30});
      l.integer("position", {ordinal: true});
    });
  });

  dimension("Sale Type", (d) => {
    d.table("sale_types");
    d.level((l) => {
      l.string("sale_type_key", {key: true, name: true, limit: 30});
      l.integer("position", {ordinal: true});
    });
  });

  dimension("Payment Status", (d) => {
    d.table("payment_statuses");
    d.level((l) => {
      l.string("payment_status_key", {key: true, name: true, limit: 30});
      l.integer("position", {ordinal: true});
    });
  });

  // The billed organization, shared by the licenses and by the transactions.
  dimension("Customer", (d) => {
    d.table("customers");
    d.level((l) => {
      l.string("name", {key: true, name: true, ordinal: true});
      l.string("country", {property: "Country"});
      l.string("region", {property: "Region", limit: 50});
    });
  });

  dimension("License", (d) => {
    d.table("licenses");
    d.level((l) => {
      l.string("license_key", {key: true, name: true});
      l.string("license_sen", {property: "License SEN"});
      l.string("app_key", {property: "App key"});
      l.string("app_name", {property: "App name"});
      l.string("hosting", {property: "Hosting", limit: 30});
      l.string("license_type", {property: "Type", limit: 50});
      l.string("status", {property: "Status", limit: 30});
      l.string("tier", {property: "Tier"});
      l.date("start_date", {property: "Start date"});
      l.date("end_date", {property: "End date"});
      l.date("latest_maintenance_start_date", {property: "Latest maintenance start date"});
      l.date("latest_evaluation_start_date", {property: "Latest evaluation start date"});
      l.date("last_updated", {property: "Last updated date"});
      l.string("customer", {property: "Customer"});
      l.string("country", {property: "Country"});
      l.string("region", {property: "Region", limit: 50});
      l.string("technical_contact_name", {property: "Technical contact name"});
      l.string("technical_contact_email", {property: "Technical contact email"});
      l.string("billing_contact_name", {property: "Billing contact name"});
      l.string("billing_contact_email", {property: "Billing contact email"});
      l.string("partner", {property: "Partner"});
      l.string("partner_type", {property: "Partner type", limit: 50});
      l.string("cloud_site_hostname", {property: "Cloud site hostname"});
      l.string("cloud_id", {property: "Cloud ID"});
      l.string("app_entitlement_number", {property: "App entitlement number"});
      l.string("host_entitlement_number", {property: "Host entitlement number"});
      l.string("license_level", {property: "License level", limit: 30});
      l.string("license_source_type", {property: "License source", limit: 30});
      l.string("new_billing_system", {property: "New billing system", limit: 10});
      l.string("in_grace_period", {property: "In grace period", limit: 10});
      l.string("extended_server_support", {property: "Extended server support", limit: 10});
      l.string("cmt_status", {property: "CMT status", limit: 30});
    });
  });

  dimension("Transaction", (d) => {
    d.table("transactions");
    d.level((l) => {
      l.string("transaction_key", {key: true});
      // Several lines of one invoice share the transaction ID, so the member is named by the ID
      // in a column of its own: the importer makes the duplicates unique by appending the line
      // item to the name, which leaves the Transaction ID property the ID as it was reported.
      l.string("name", {name: true});
      l.string("transaction_id", {property: "Transaction ID"});
      l.string("line_item_id", {property: "Line item ID"});
      l.date("sale_date", {property: "Date", ordinal: true});
      l.string("sale_type", {property: "Sale type", limit: 30});
      l.string("payment_status", {property: "Payment status", limit: 30});
      l.string("payment_terms", {property: "Payment terms", limit: 30});
      l.string("app_key", {property: "App key"});
      l.string("app_name", {property: "App name"});
      l.string("hosting", {property: "Hosting", limit: 30});
      l.string("license_type", {property: "License type", limit: 50});
      l.string("tier", {property: "Tier"});
      l.string("old_tier", {property: "Old tier"});
      l.string("change_in_tier", {property: "Tier change", limit: 30});
      l.string("billing_period", {property: "Billing period", limit: 30});
      l.string("old_billing_period", {property: "Old billing period", limit: 30});
      l.string("product_edition", {property: "Product edition", limit: 50});
      l.string("old_product_edition", {property: "Old product edition", limit: 50});
      l.date("maintenance_start_date", {property: "Maintenance start date"});
      l.date("maintenance_end_date", {property: "Maintenance end date"});
      l.date("last_updated", {property: "Last updated date"});
      l.string("customer", {property: "Customer"});
      l.string("country", {property: "Country"});
      l.string("region", {property: "Region", limit: 50});
      l.string("technical_contact_name", {property: "Technical contact name"});
      l.string("technical_contact_email", {property: "Technical contact email"});
      l.string("billing_contact_name", {property: "Billing contact name"});
      l.string("billing_contact_email", {property: "Billing contact email"});
      l.string("partner", {property: "Partner"});
      l.string("partner_type", {property: "Partner type", limit: 50});
      l.string("license_key", {property: "License ID"});
      l.string("license_sen", {property: "License SEN"});
      l.string("app_entitlement_number", {property: "App entitlement number"});
      l.string("host_entitlement_number", {property: "Host entitlement number"});
      l.string("cloud_id", {property: "Cloud ID"});
      l.string("refund_reason", {property: "Refund reason"});
      l.string("credit_note_reason", {property: "Credit note reason"});
      l.string("original_transaction_id", {property: "Original transaction ID"});
      l.date("original_sale_date", {property: "Original sale date"});
      // How often the payment of this transaction failed and was retried.
      l.integer("payment_attempts", {property: "Payment attempts"});
    });
  });

  timeDimension("Time");

  cube((c) => {
    c.table("licenses");
    c.annotations(Object.assign({default_measures: ["Vendor amount"]}, licenseAnnotations));

    // One row per license event: the license starts its maintenance, and — when it has an end
    // date — it ends. A cumulative difference of the two is the number of licenses in force.
    c.measures((m) => {
      m.integer("licenses", {name: "Licenses", visible: importLicenses});
      m.integer("licenses_ending", {name: "Licenses ending", visible: importLicenses});
      // The customers who started a license in the period, counted once each. The column is the
      // Customer foreign key, so the distinct count is of the customers of the counted rows only.
      m.integerExpression(expr.caseNotNull("licenses", "customer_id"),
        {name: "Customers with new licenses", aggregator: "distinct-count",
         visible: importLicenses});
      m.datetime("_updated_at", {index: true});
    });

    // One row per transaction event: the sale itself at its sale date, and the start and the end
    // of the maintenance period it paid for. A refund carries negative amounts and counts its
    // maintenance rows negative, so a cumulative sum needs no special case for it.
    c.measures("Transactions", (m) => {
      m.table("transactions");
      m.integer("transactions", {name: "Transactions", annotations: transactionAnnotations,
        visible: importTransactions});
      ["Purchase price", "Vendor amount", "Partner discount amount", "Promotion discount amount",
       "Loyalty discount amount", "Manual discount amount"].forEach((name) => {
        m.decimal(name.toLowerCase().replace(/ /g, "_"), {name: name, precision: 19, scale: 2,
          formatString: "#,##0.00", annotations: transactionAnnotations,
          visible: importTransactions});
      });
      m.integer("maintenance_started", {name: "Maintenance started",
        annotations: transactionAnnotations, visible: importTransactions});
      m.integer("maintenance_ended", {name: "Maintenance ended",
        annotations: transactionAnnotations, visible: importTransactions});
      m.integerExpression(expr.caseNotNull("transactions", "customer_id"),
        {name: "Customers", aggregator: "distinct-count", annotations: transactionAnnotations,
         visible: importTransactions});
      m.datetime("_updated_at", {index: true});
    });

    c.timeDimensionCalculatedMembers();

    // The license counts by license type, the way a vendor reads them. The members are seeded by
    // every import, so the formulas always resolve.
    c.calculatedMember("Evaluation licenses", {
      formula: `([Measures].[Licenses], [License Type].[Evaluation])`,
      formatString: "#,##0",
      visible: importLicenses
    });
    c.calculatedMember("Paid licenses", {
      formula: `
        Aggregate({[License Type].[Commercial], [License Type].[Academic],
                   [License Type].[Social impact]}, [Measures].[Licenses])`,
      formatString: "#,##0",
      visible: importLicenses
    });
    c.calculatedMember("Free licenses", {
      formula: `
        Aggregate({[License Type].[Community], [License Type].[Open source],
                   [License Type].[Free], [License Type].[Legacy free]}, [Measures].[Licenses])`,
      formatString: "#,##0",
      visible: importLicenses
    });
    c.calculatedMember("Demonstration licenses", {
      formula: `([Measures].[Licenses], [License Type].[Demonstration])`,
      formatString: "#,##0",
      visible: importLicenses
    });

    // The licenses in force at the end of the period: everything that started, less everything
    // that ended. The period that is still running is counted up to and including today, so that
    // it is comparable with the finished periods before it instead of counting a whole month
    // ahead of the licenses that exist.
    c.calculatedMember("Active licenses", {
      formula: `
        Sum(
          IIF(DateInPeriod(Now(), [Time].CurrentHierarchyMember),
            {PreviousPeriods([Time].CurrentHierarchy.Levels('Day').CurrentDateMember),
             [Time].CurrentHierarchy.Levels('Day').CurrentDateMember},
            {PreviousPeriods([Time].CurrentHierarchyMember), [Time].CurrentHierarchyMember}
          ),
          [Measures].[Licenses] - [Measures].[Licenses ending]
        )`,
      formatString: "#,##0",
      visible: importLicenses
    });

    // The same for the maintenance periods the transactions paid for — the licenses a vendor is
    // paid for, which is not the same as the licenses that exist.
    c.calculatedMember("Active maintained licenses", {
      formula: `
        Sum(
          IIF(DateInPeriod(Now(), [Time].CurrentHierarchyMember),
            {PreviousPeriods([Time].CurrentHierarchy.Levels('Day').CurrentDateMember),
             [Time].CurrentHierarchy.Levels('Day').CurrentDateMember},
            {PreviousPeriods([Time].CurrentHierarchyMember), [Time].CurrentHierarchyMember}
          ),
          [Measures].[Maintenance started] - [Measures].[Maintenance ended]
        )`,
      formatString: "#,##0",
      annotations: transactionAnnotations,
      visible: importTransactions
    });

    c.calculatedMember("Average purchase price", {
      formula: `
        CASE WHEN [Measures].[Transactions] > 0 THEN
          [Measures].[Purchase price] / [Measures].[Transactions]
        END`,
      formatString: "#,##0.00",
      annotations: transactionAnnotations,
      visible: importTransactions
    });
    c.calculatedMember("Average vendor amount", {
      formula: `
        CASE WHEN [Measures].[Transactions] > 0 THEN
          [Measures].[Vendor amount] / [Measures].[Transactions]
        END`,
      formatString: "#,##0.00",
      annotations: transactionAnnotations,
      visible: importTransactions
    });
    c.calculatedMember("Vendor amount per customer", {
      formula: `
        CASE WHEN [Measures].[Customers] > 0 THEN
          [Measures].[Vendor amount] / [Measures].[Customers]
        END`,
      formatString: "#,##0.00",
      annotations: transactionAnnotations,
      visible: importTransactions
    });
    c.calculatedMember("Refunded amount", {
      formula: `([Measures].[Vendor amount], [Sale Type].[Refund])`,
      formatString: "#,##0.00",
      annotations: transactionAnnotations,
      visible: importTransactions
    });
    c.calculatedMember("Vendor amount cloud %", {
      formula: `
        CASE WHEN ([Measures].[Vendor amount], [Hosting].DefaultMember) > 0 THEN
          ([Measures].[Vendor amount], [Hosting].[Cloud]) /
          ([Measures].[Vendor amount], [Hosting].DefaultMember)
        END`,
      formatString: "#0.00%",
      annotations: transactionAnnotations,
      visible: importTransactions
    });

    // The properties of the transaction or the license a report row is on, so that a list report
    // of transactions or licenses can show them as columns.
    [["Transaction date", "Transaction", "Date", "mmm dd yyyy"],
     ["Transaction customer", "Transaction", "Customer", null],
     ["Transaction app", "Transaction", "App key", null],
     ["Transaction sale type", "Transaction", "Sale type", null],
     ["Transaction hosting", "Transaction", "Hosting", null],
     ["Transaction license type", "Transaction", "License type", null],
     ["Transaction tier", "Transaction", "Tier", null],
     ["Transaction billing period", "Transaction", "Billing period", null],
     ["Transaction product edition", "Transaction", "Product edition", null],
     ["Transaction partner", "Transaction", "Partner", null],
     ["Transaction payment status", "Transaction", "Payment status", null],
     ["Transaction payment attempts", "Transaction", "Payment attempts", "#,##0"],
     ["Transaction license ID", "Transaction", "License ID", null],
     ["Transaction maintenance start date", "Transaction", "Maintenance start date",
      "mmm dd yyyy"],
     ["Transaction maintenance end date", "Transaction", "Maintenance end date", "mmm dd yyyy"]
    ].forEach((property) => {
      c.calculatedMember(property[0],
        propertyMeasure(property, transactionAnnotations, importTransactions));
    });

    [["License customer", "License", "Customer", null],
     ["License country", "License", "Country", null],
     ["License app", "License", "App key", null],
     ["License hosting", "License", "Hosting", null],
     ["License type", "License", "Type", null],
     ["License status", "License", "Status", null],
     ["License tier", "License", "Tier", null],
     ["License partner", "License", "Partner", null],
     ["License start date", "License", "Start date", "mmm dd yyyy"],
     ["License end date", "License", "End date", "mmm dd yyyy"],
     ["License latest maintenance start date", "License", "Latest maintenance start date",
      "mmm dd yyyy"],
     ["License last updated date", "License", "Last updated date", "mmm dd yyyy"]
    ].forEach((property) => {
      c.calculatedMember(property[0], propertyMeasure(property, licenseAnnotations, importLicenses));
    });
  });
});
