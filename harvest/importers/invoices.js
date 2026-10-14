// The invoices of the account — the members of the Invoice dimension and the fact rows of the Invoices
// cube. Harvest answers the line items of an invoice inside the invoice itself, so one request per page
// imports both levels of the dimension.
//
// Every invoice is written as one row of its own amounts on the day it was issued, one row of the amount
// which is still due on the day it is due, and one row per line item — the amounts of the invoice are
// therefore not counted again for each of its items. All rows of one invoice are one import scope, so an
// invoice which Harvest reports as changed replaces exactly its own rows.
app.importers.invoices = {
  SOURCE_NAME: "invoice",

  // The line item member the rows of the invoice itself are reported under. A line item is keyed by its
  // position on the invoice, and this one belongs to no item at all.
  INVOICE_POSITION: -1,
  // The longest value of a string column without a limit of its own.
  STRING_LIMIT: 255,

  importAll(shared) {
    logger.startImport("invoices");
    var collected = {rows: [], movedIds: [], itemCounts: [], imported: 0,
                     incremental: !!shared.invoicesSince, importStartedAt: shared.importStartedAt};

    app.api.getInvoices(shared.invoicesSince, (batch) => {
      batch.forEach((invoice) => {
        source.checkCanceling();
        this.importOne(invoice, collected);
      });
      source.setStatusMessage(`Importing Harvest invoices, ${collected.imported} imported`);
    });

    this.writeCollected(collected);
    // After all rows are written: the stored rows of an invoice refer to the items removed from it until
    // its new rows replace them.
    collected.itemCounts.forEach((itemCount) => this.removeItemsAbove(itemCount.invoiceId, itemCount.count));
    collected.movedIds.forEach((invoiceId) => this.remove(invoiceId));
    // Harvest restarts its invoice numbering, so two invoices of one client can carry the same number.
    // Two members of the same name would be one member of the Invoice dimension, and the line items of
    // the second invoice would be reported under the first one.
    dwh.dimensions.invoices.updateDuplicateNames({nameColumn: "name", addNumericColumn: "id"});
    logger.finishImport("invoices", collected.imported);
  },

  writeCollected(collected) {
    collected.rows = app.importers.rows.writeInvoiceBatch(collected.rows);
  },

  // Removes the rows of an invoice and then its members, which the rows refer to, so that no report lists
  // an invoice which is not imported.
  remove(invoiceId) {
    app.importers.rows.deleteInvoiceRowsOf(invoiceId, this.SOURCE_NAME);
    dwh.dimensions.invoice_items.deleteRows({invoice_id: invoiceId});
    dwh.dimensions.invoices.deleteRows({id: invoiceId});
  },

  importOne(invoice, collected) {
    var clientId = this.idOf(invoice.client);
    var client = app.importers.clients.stored(clientId);
    if (!client) {
      // The invoice of a client of no selected project is not imported. The currency it is issued in is,
      // as every currency of the account is.
      // A changed invoice of such a client may have been moved to it from a client which is imported.
      if (app.importers.clients.listed(clientId)) {
        app.importers.currencies.lookupId(invoice.currency);
        source.warnings.clearOld(`invoice/${invoice.id}`);
        if (collected.incremental) collected.movedIds.push(invoice.id);
      } else {
        this.reportUnknownClient(invoice);
      }
      return;
    }

    var unknownProjectId = this.unknownProjectIdOf(invoice, collected.importStartedAt);
    if (unknownProjectId) {
      app.importers.projects.reportUnknown(unknownProjectId);
      return;
    }

    var warningKey = `invoice/${invoice.id}`;
    var invoiceRows;
    try {
      this.storeInvoice(invoice, client);
      var items = this.storeItems(invoice);
      invoiceRows = this.buildRows(invoice, items, client);
      var oversizeReason = app.importers.rows.oversizeReasonOf(invoiceRows);
      if (oversizeReason) throw new Error(oversizeReason);
      source.warnings.clearOld(warningKey);
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `Import of Harvest invoice ${invoice.id} failed: ${error.message}`);
      return;
    }
    // Outside the try: the batch holds the rows of other invoices as well, so a batch which cannot be
    // written fails the import and is not reported as the failure of this invoice.
    collected.rows = app.importers.rows.addInvoiceScope(collected.rows, invoiceRows);
    collected.itemCounts.push({invoiceId: invoice.id, count: items.length});
    collected.imported += 1;
  },

  storeInvoice(invoice, client) {
    return dwh.dimensions.invoices.createAndLookupId({id: invoice.id}, {
      // The name the built-in Harvest application gives an invoice: its number and its client.
      name: `#${invoice.number} ${client.name}`,
      number: invoice.number,
      subject: this.fitted(invoice.subject),
      issued_date: dwh.dateValue(invoice, "issue_date"),
      due_date: dwh.dateValue(invoice, "due_date"),
      sent_date: dwh.dateValue(invoice, "sent_at"),
      paid_date: dwh.dateValue(invoice, "paid_date"),
      closed_date: dwh.dateValue(invoice, "closed_at"),
      period_start_date: dwh.dateValue(invoice, "period_start"),
      period_end_date: dwh.dateValue(invoice, "period_end"),
      payment_term: invoice.payment_term || null,
      currency: invoice.currency,
      client_name: client.name,
      status: this.statusOf(invoice),
      created_by: app.importers.users.nameOf(invoice.creator && invoice.creator.id),
      purchase_order: this.fitted(invoice.purchase_order),
      retainer_id: this.idOf(invoice.retainer),
      estimate_id: this.idOf(invoice.estimate),
      notes: invoice.notes || null,
      generation: app.importers.sweep.generation
    });
  },

  // Harvest names the state of an invoice in lower case — draft, open, paid or closed.
  statusOf(invoice) {
    var state = invoice.state;
    return state ? state.charAt(0).toUpperCase() + state.substring(1) : null;
  },

  idOf(object) {
    return (object && object.id) || null;
  },

  // One member per line item of the invoice, and the values its fact row is built from. Harvest answers
  // no id for the items of an invoice it generated itself, so an item is identified by its position.
  //
  // The row of an item of a project which a selection does not import is reported under the nameless
  // project member of the client, as the rows of the invoice itself are, and the item still names the
  // project it is billed for.
  storeItems(invoice) {
    var lineItems = this.lineItemsOf(invoice);
    var descriptionCounts = _.countBy(lineItems, (lineItem) => this.descriptionOf(lineItem).toLowerCase());
    return lineItems.map((lineItem, index) => {
      var projectId = this.idOf(lineItem.project);
      var project = app.importers.projects.stored(projectId);
      var memberId = dwh.dimensions.invoice_items.createAndLookupId(
        {invoice_id: invoice.id, position: index + 1}, {
          description: this.itemNameOf(this.descriptionOf(lineItem), index + 1, descriptionCounts),
          category: lineItem.kind || null,
          project: app.importers.projects.listedNameOf(projectId),
          quantity: lineItem.quantity,
          unit_price: lineItem.unit_price,
          taxed: lineItem.taxed,
          taxed2: lineItem.taxed2,
          generation: app.importers.sweep.generation
        });

      return {
        memberId: memberId,
        projectId: project && project.memberId,
        categoryId: app.importers.invoiceItemCategories.categoryIdOf(lineItem.kind),
        amount: lineItem.amount
      };
    });
  },

  fitted(text) {
    return text ? String(text).substring(0, this.STRING_LIMIT) : null;
  },

  descriptionOf(lineItem) {
    return (lineItem.description || "").substring(0, this.STRING_LIMIT);
  },

  // The member name of a line item, its description. The items of one invoice need names of their own, so
  // an item whose description another item of the invoice has as well, in any case, or which has none, is
  // told apart by its position, and none of them takes the empty name of the item of the invoice itself.
  itemNameOf(description, position, descriptionCounts) {
    if (description && descriptionCounts[description.toLowerCase()] === 1) return description;

    var suffix = ` (${position})`;
    return (description || "Item").substring(0, this.STRING_LIMIT - suffix.length) + suffix;
  },

  lineItemsOf(invoice) {
    return invoice.line_items || [];
  },

  // The members of the line items removed from an invoice since it was imported: an item is keyed by its
  // position, so they are the positions above the current count, and their rows are replaced with the
  // rows of the invoice. The deletion stops at the first missing position, so the members above a gap
  // which an interrupted deletion left, which have no rows, stay until the next check for deleted records.
  removeItemsAbove(invoiceId, itemCount) {
    var invoiceItems = dwh.dimensions.invoice_items;
    var position = itemCount + 1;
    while (invoiceItems.lookupId({invoice_id: invoiceId, position: position}) !== null) {
      invoiceItems.deleteRows({invoice_id: invoiceId, position: position});
      position++;
    }
  },

  buildRows(invoice, items, client) {
    var invoiceMemberId = dwh.dimensions.invoice_items.createAndLookupId(
      {invoice_id: invoice.id, position: this.INVOICE_POSITION},
      {generation: app.importers.sweep.generation});
    // An invoice belongs to a client and names a project only on its line items, so its own rows are
    // reported under the nameless project member of the client.
    var clientProjectId = app.importers.projects.ofClient(client.id);
    var issuedTimeId = dwh.lookupDateId(invoice, "issue_date");
    var scope = {
      _source_id: String(invoice.id),
      _source_name: this.SOURCE_NAME,
      invoice_id: invoice.id,
      currency_id: app.importers.currencies.lookupId(invoice.currency)
    };
    var rows = [
      this.row(scope, {
        project_id: clientProjectId,
        invoice_item_id: invoiceMemberId,
        time_id: issuedTimeId,
        invoice_amount: invoice.amount,
        discount_amount: invoice.discount_amount,
        tax_amount: invoice.tax_amount,
        tax2_amount: invoice.tax2_amount
      }),
      // The amount which is still due is reported on the day it is due and not on the day the invoice
      // was issued, so that a report of the due amounts is a report of the days they are due on.
      this.row(scope, {
        project_id: clientProjectId,
        invoice_item_id: invoiceMemberId,
        time_id: dwh.lookupDateId(invoice, "due_date"),
        due_amount: invoice.due_amount
      })
    ];

    items.forEach((item) => rows.push(this.row(scope, {
      project_id: item.projectId || clientProjectId,
      invoice_item_id: item.memberId,
      invoice_item_category_id: item.categoryId,
      time_id: issuedTimeId,
      item_amount: item.amount
    })));
    return rows;
  },

  row(scope, attributes) {
    var row = {};
    for (var scopeColumn in scope) row[scopeColumn] = scope[scopeColumn];
    for (var column in attributes) row[column] = attributes[column];
    return row;
  },

  // A line item of a project the projects list did not answer, of an invoice changed after the list was read
  // — a project created while this import was reading. The invoice is left to the next import, which is
  // what the reported failure holds the incremental mark back for. A project deleted in Harvest keeps its
  // invoices, which an unchanged invoice names: its items are reported under the client, as the items of a
  // project which is not selected are, and the imports go on.
  unknownProjectIdOf(invoice, importStartedAt) {
    if (importStartedAt && invoice.updated_at && invoice.updated_at < importStartedAt) return null;

    var unknownIds = this.lineItemsOf(invoice).map((lineItem) => this.idOf(lineItem.project)).
      filter((projectId) => projectId && !app.importers.projects.listed(projectId));
    return unknownIds[0] || null;
  },

  // An invoice of a client the clients list did not answer, which is reported the way an unknown project
  // is: the invoice is imported by the next import.
  reportUnknownClient(invoice) {
    var clientId = this.idOf(invoice.client);
    source.warnings.addObjectFailure(`client/${clientId}`,
      `Harvest client ${clientId} was not in the clients list, so the invoices of it were not ` +
      "imported. The next import imports them.");
  }
};
