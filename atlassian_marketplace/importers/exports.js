// The import of one asynchronous export, which the licenses and the transactions share: request
// the export, wait until the Marketplace has prepared it, then read the downloaded file batch by
// batch and write the fact rows of each batch with one call.
app.importers.exports = {
  // `importer` is the object of the imported record type — `app.importers.licenses` or
  // `app.importers.transactions` — which names its measures table and builds the rows of one
  // record, and may define `afterImport()` to run after the last batch. Returns how many records
  // were imported.
  run(developerId, kind, params, importer) {
    var label = app.api.EXPORTS[kind].label;

    // The importer is started before the export is requested, so that the import log counts the
    // wait for the export, often minutes, in the time of the importer.
    logger.startImport(label);
    source.setStatusMessage(`Preparing the ${label} export`);
    var started = app.api.startExport(developerId, kind, params);
    var exportId = started && started.export && started.export.id;
    if (!exportId) {
      throw new Error(`The Atlassian Marketplace ${label} export was not started`);
    }
    app.api.waitForExport(developerId, kind, exportId);

    var imported = 0;
    // The rows of the last record of the previous batch, which the batch after it may continue:
    // the lines of one invoice follow each other in the exported file, so a record can straddle
    // the boundary of two batches.
    var heldRows = [];
    this.showProgress(label, 0, null);
    app.api.downloadExport(developerId, kind, exportId, (records, info) => {
      var rows = heldRows;
      records.forEach((record) => {
        imported += importer.importOne(record, rows);
      });
      heldRows = this.holdBackLastScope(rows);
      // All rows of every scope of this batch in one call: eazyBI compares them with the stored
      // rows of the same record and removes what the export no longer has, so a second call for
      // the same record would delete the rows of the first one.
      if (rows.length > 0) dwh.measures[importer.MEASURES_TABLE].importRows(rows);
      // After every batch rather than after every record: one status message per 1000 records is
      // what the user sees moving, without a write per row.
      this.showProgress(label, info.processed, info.total);
    });
    // The last record of the file is complete, so what was held back is written now.
    if (heldRows.length > 0) dwh.measures[importer.MEASURES_TABLE].importRows(heldRows);
    if (importer.afterImport) importer.afterImport();
    logger.finishImport(label, imported);
    return imported;
  },

  // Removes the rows of the last record from `rows` and returns them, so that they are written
  // together with the rest of that record when the next batch continues it.
  holdBackLastScope(rows) {
    if (rows.length === 0) return [];
    var lastSourceId = rows[rows.length - 1]._source_id;
    var held = [];
    while (rows.length > 0 && rows[rows.length - 1]._source_id === lastSourceId) {
      held.unshift(rows.pop());
    }
    return held;
  },

  // How much of the downloaded export is read. The percentage is capped rather than allowed past
  // 100, because the counted rows and the read rows can disagree by the header row of a part file.
  showProgress(label, processed, total) {
    var message = `Importing ${label}`;
    if (processed > 0) {
      message += `, ${processed} read`;
      if (total) message += ` of ${total}`;
    }
    if (total > 0)
      source.setStatusMessage(message, {percentage: Math.min(processed * 100 / total, 100)});
    else
      source.setStatusMessage(message);
  }
};
