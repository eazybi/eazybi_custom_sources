app.importer = {
  // The Marketplace filters the exports by whole days, so an incremental import asks for a few
  // days more than it needs: a record changed while the previous import was running carries the
  // date of that day, and the overlap makes sure the next import sees it.
  OVERLAP_DAYS: 3,

  importAll() {
    // Captured before anything is exported, so that nothing changed while the import runs is
    // missed by the next one.
    var importStartedOn = strftime("%Y-%m-%d", new Date());
    var importLicenses = source.getExtraOption("import_licenses");
    var importTransactions = source.getExtraOption("import_transactions");
    var developerId = app.api.resolveDeveloperId();
    if (!developerId) {
      throw new Error("Could not find the developer space. Check the developer space ID on the " +
                      "source application connection page.");
    }

    app.importers.lookups.importAll();
    var appKeys = app.importers.apps.importAll(developerId, source.getSourceSelection());

    var shared = {
      appKeys: appKeys,
      includeAtlassianLicenses: source.getExtraOption("include_atlassian_licenses"),
      licensesSince: this.since("licenses_last_updated"),
      transactionsSince: this.since("transactions_last_updated"),
      // The first transactions export reads only the chosen history; every import after it
      // continues from the stored mark and needs no lower bound of its own.
      transactionsFrom: null
    };
    if (!shared.transactionsSince) shared.transactionsFrom = this.transactionsHistoryStart();

    // The licenses are imported first: they write the attributes of the License dimension
    // members, which the transactions then only reference.
    if (importLicenses) app.importers.licenses.importAll(developerId, shared);
    if (importTransactions) app.importers.transactions.importAll(developerId, shared);

    // The marks may only advance when every record was imported — the next import asks for the
    // same range again and retries the failed ones.
    if (source.warnings.objectFailures().length === 0) {
      if (importLicenses) source.setMaxParam("licenses_last_updated", importStartedOn);
      if (importTransactions) source.setMaxParam("transactions_last_updated", importStartedOn);
    }
  },

  // The `lastUpdated` filter of an incremental export: the date the previous import started, less
  // the overlap. A full reimport and a first import read everything and send none.
  since(maxParamKey) {
    if (source.isReimport()) return null;
    var mark = source.getMaxParam(maxParamKey);
    if (!mark) return null;
    return this.daysBefore(String(mark), this.OVERLAP_DAYS);
  },

  // The `startDate` of the first transactions export, from the "Import transactions of" option.
  // "All history" is stored as 0 years and reads everything.
  transactionsHistoryStart() {
    var years = parseInt(source.getExtraOption("transactions_history"), 10);
    if (!years) return null;
    var start = new Date();
    start.setFullYear(start.getFullYear() - years);
    return strftime("%Y-%m-%d", start);
  },

  // `"2026-09-02"` and 3 days -> `"2026-08-30"`. The date is parsed and formatted as UTC, so that
  // the result does not depend on the time zone of the eazyBI server. A mark which is not a date
  // is used as it is, so that a value stored by another version of this type does not fail the
  // import.
  daysBefore(date, days) {
    if (!/^\d{4}-\d\d-\d\d/.test(date)) return date;
    var timestamp = Date.parse(`${date.substring(0, 10)}T00:00:00Z`);
    if (isNaN(timestamp)) return date;
    return new Date(timestamp - days * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  }
};
