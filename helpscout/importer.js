app.importer = {
  importAll() {
    // Captured before anything is fetched, so that nothing changed while the import runs is missed
    // by the next one.
    var importStartedAt = this.isoSeconds(new Date());
    var since = source.isReimport() ? null : source.getMaxParam("modified_at");
    if (!since) since = this.historyStart();
    since = this.isoSeconds(since);

    var mailboxIds = source.getSourceSelection();
    var shared = {
      since: since,
      importMessages: source.getExtraOption("import_messages"),
      importRatings: source.getExtraOption("import_ratings"),
      officeHours: app.importers.officeHours.selected(),
      skippedConversationNumbers: this.skippedConversationNumbers()
    };
    var customFields = source.getCustomFields();

    // The importers that remember something for the whole import keep it in their own namespace,
    // which outlives one import in a test run.
    app.importers.mailboxes.reset();
    app.importers.customers.reset();
    app.importers.ratings.reset();
    app.importers.customFields.reset();

    source.setStatusMessage("Importing inboxes and users");
    app.importers.statuses.importAll();
    app.importers.mailboxes.importAll();
    app.importers.users.importAll();

    // After the inboxes: the custom field options are requested per inbox, and their members are
    // seeded before the conversations reference them.
    if (customFields.length > 0) {
      source.setStatusMessage("Importing custom fields");
      app.importers.customFields.prepare(customFields, mailboxIds);
    }

    // The customers importer sets its own status message, so that it can report its progress.
    app.importers.customers.importAll(since);

    if (shared.importRatings) {
      source.setStatusMessage("Importing satisfaction ratings");
      app.importers.ratings.fetchAll(mailboxIds, since, importStartedAt);
    }

    // One inbox at a time, so that the import log and the profiling results name the inbox whose
    // conversations took the time. The conversation importer counts into this object and reports it
    // after every page, so that the status message keeps moving through a large inbox instead of
    // standing still until the inbox is done; the percentage counts the inboxes.
    var mailboxes = app.importers.mailboxes.selected(mailboxIds);
    var progress = {
      imported: 0,
      mailboxIndex: 0,
      mailboxCount: mailboxes.length,
      total: app.api.getConversationsCount(mailboxIds, since)
    };
    mailboxes.forEach((mailbox, index) => {
      progress.mailboxIndex = index;
      app.importers.conversations.importAllOf(mailbox, shared, progress);
    });

    if (shared.importRatings) app.importers.ratings.importRemaining(shared.skippedConversationNumbers);

    app.importers.users.updateDuplicateNames();
    app.importers.customers.updateDuplicateNames();

    // The incremental mark may only advance when every conversation was imported — the next import
    // requests the same range again and retries the failed ones.
    if (source.warnings.objectFailures().length === 0)
      source.setMaxParam("modified_at", importStartedAt);
  },

  // The conversation numbers the skip_conversations advanced setting names, so that an exceptional
  // conversation an account owner does not want counted at all — one whose duration is a data entry
  // mistake and skews the averages, for example — can be left out of the import entirely without a
  // code change. TOML: skip_conversations = [4821, 5310]. Empty when not entered, or entered as
  // something other than an array, so that a typo in the TOML leaves out nothing instead of failing
  // every conversation of the import.
  skippedConversationNumbers() {
    var value = source.getAdvancedSetting("skip_conversations");
    return Array.isArray(value) ? value : [];
  },

  // The `modifiedSince` value of the first import, from the "Import history" option.
  // "All history" is stored as 0 months and imports without a lower bound.
  historyStart() {
    var months = parseInt(source.getExtraOption("import_history"), 10);
    if (!months) return null;
    var start = new Date();
    start.setMonth(start.getMonth() - months);
    return this.isoSeconds(start);
  },

  // Help Scout accepts its date filters with second precision only — `yyyy-MM-ddTHH:mm:ssZ` — and
  // answers HTTP 400 for the milliseconds that `Date#toISOString` adds. Truncating the milliseconds
  // of the incremental mark is safe: the next import asks for a slightly wider range, never a
  // narrower one.
  isoSeconds(value) {
    if (!value) return null;
    var timestamp = value instanceof Date ? value.toISOString() : String(value);
    return timestamp.replace(/\.\d+Z$/, "Z");
  }
};
