// Writing the rows of the two fact tables — the timesheet rows of the Timesheets cube and the invoice
// rows of the Invoices cube.
//
// Every fact row carries the scope of the Harvest object it belongs to — one time entry, one expense, the
// budget of one project or one invoice — so the rows of many objects are written in one call and each
// object is compared with its stored rows on its own.
app.importers.rows = {
  // How many rows are collected before they are written. `importRows` compares a whole batch with the
  // stored rows in one query, which is what makes a large import fast.
  BATCH_SIZE: 5000,
  // The most rows one `importRows` call takes.
  MAX_ROWS_PER_CALL: 10000,

  // Writes the collected rows and answers the empty array the caller collects the next batch in. All
  // rows of one scope must be in the same call, so a batch is only ever flushed between two objects.
  writeTimesheetBatch(rows) {
    if (rows.length > 0) dwh.measures.timesheets.importRows(this.withGeneration(rows));
    return [];
  },

  writeInvoiceBatch(rows) {
    if (rows.length > 0) dwh.measures.invoices.importRows(this.withGeneration(rows));
    return [];
  },

  // Adds the rows of one scope of many rows, the budget of a project or an invoice, to the collected batch
  // and answers the batch the caller collects the next scope in.
  addTimesheetScope(batch, scopeRows) {
    return this.addScope(batch, scopeRows, (rows) => this.writeTimesheetBatch(rows));
  },

  addInvoiceScope(batch, scopeRows) {
    return this.addScope(batch, scopeRows, (rows) => this.writeInvoiceBatch(rows));
  },

  addScope(batch, scopeRows, writeBatch) {
    if (batch.length + scopeRows.length > this.MAX_ROWS_PER_CALL) batch = writeBatch(batch);
    scopeRows.forEach((row) => batch.push(row));
    return batch.length >= this.BATCH_SIZE ? writeBatch(batch) : batch;
  },

  // Why a scope cannot be written at all, or null when it can: its rows must be in one call. The caller
  // reports its object as failed and skips it, which keeps the incremental mark back and makes a check for
  // deleted records remove nothing, the stored rows of the object included.
  oversizeReasonOf(scopeRows) {
    if (scopeRows.length <= this.MAX_ROWS_PER_CALL) return null;
    return `its ${scopeRows.length} rows are more than the ${this.MAX_ROWS_PER_CALL} which eazyBI writes ` +
      "in one call";
  },

  // Every row carries the generation of the import which wrote it, which is how a check for deleted
  // records tells the rows it did not write (see sweep.js).
  withGeneration(rows) {
    var generation = app.importers.sweep.generation;
    rows.forEach((row) => {
      row.generation = generation;
    });
    return rows;
  },

  // The notes of a time entry or an expense, or null when it has none. A note of only spaces or line
  // breaks is stored as no note, so that the Hours with notes measure does not count it.
  notesOf(record) {
    var notes = record.notes;
    return (notes && notes.trim()) ? notes : null;
  },

  // Removes the stored timesheet rows of an object the source no longer has rows for.
  deleteTimesheetRowsOf(sourceId, sourceName) {
    dwh.measures.timesheets.importRows([], {sourceId: String(sourceId), sourceName: sourceName});
  },

  deleteInvoiceRowsOf(sourceId, sourceName) {
    dwh.measures.invoices.importRows([], {sourceId: String(sourceId), sourceName: sourceName});
  }
};
