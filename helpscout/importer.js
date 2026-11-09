app.importer = {
  importAll() {
    // Captured before anything is fetched, so that nothing changed while the import runs is missed
    // by the next one.
    var importStartedAt = this.isoSeconds(new Date());
    var mailboxIds = source.getSourceSelection();
    // An inbox added to the selection has no history yet, and the incremental mark of the inboxes
    // imported before would skip it, so the import goes back to the start like a full reimport.
    var since = (source.isReimport() || this.hasAddedMailboxes(mailboxIds)) ?
      null : source.getMaxParam("modified_at");
    if (!since) since = this.historyStart();
    since = this.isoSeconds(since);

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
    var mailboxes = app.importers.mailboxes.selected(mailboxIds);

    // After the inboxes: the custom field options are requested per inbox, and their members are
    // seeded before the conversations reference them.
    if (customFields.length > 0) {
      source.setStatusMessage("Importing custom fields");
      app.importers.customFields.prepare(customFields, mailboxIds);
    }

    // The customers importer sets its own status message, so that it can report its progress.
    app.importers.customers.importAll(since);

    // Ratings stored by an earlier version have no inbox, so the rows of a deselected inbox cannot be
    // told from the rest. Fetching the ratings of the selected inboxes from the start writes them
    // again with their inbox, and the ones left without it are the ratings of deselected inboxes.
    var repairRatings = shared.importRatings && app.importers.ratings.hasUnscopedRows();
    if (shared.importRatings) {
      source.setStatusMessage("Importing satisfaction ratings");
      app.importers.ratings.fetchAll(mailboxes.map((mailbox) => mailbox.key),
        repairRatings ? null : since, importStartedAt);
    }

    // One inbox at a time, so that the import log and the profiling results name the inbox whose
    // conversations took the time. The conversation importer counts into this object and reports it
    // after every page, so that the status message keeps moving through a large inbox instead of
    // standing still until the inbox is done; the percentage counts the inboxes.
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
    // The rows of the deselected inboxes are removed together with it, so that the stored selection
    // always tells whose data the cube holds — a failed import keeps both as they were.
    if (source.warnings.objectFailures().length === 0) {
      app.importers.mailboxes.removeDeselectedData(mailboxIds);
      if (repairRatings) app.importers.ratings.removeUnscoped();
      source.setMaxParam("modified_at", importStartedAt);
      source.setMaxParam("selected_mailboxes", this.selectionKey(mailboxIds));
    }
  },

  // The selection as one string that can be stored as a max param. "*" when every inbox is
  // imported, so that it is told apart from any selection of inboxes.
  selectionKey(mailboxIds) {
    if (!mailboxIds || mailboxIds.length === 0) return "*";
    return mailboxIds.map((mailboxId) => String(mailboxId)).sort().join(",");
  },

  // Whether the selection holds an inbox that the previous import did not — also when the inboxes
  // were selected one by one and are all selected now. The import of a version that did not remember
  // the selection leaves nothing to compare with, so it counts as an added inbox: one import goes
  // back to the start, and the selection is remembered from then on.
  hasAddedMailboxes(mailboxIds) {
    var previous = source.getMaxParam("selected_mailboxes");
    if (!previous) return true;
    if (previous === "*") return false;
    if (!mailboxIds || mailboxIds.length === 0) return true;
    var previousIds = String(previous).split(",");
    return mailboxIds.some((mailboxId) => previousIds.indexOf(String(mailboxId)) < 0);
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
