// The Help Scout inboxes. Their names are also needed as a conversation property, so the importer
// keeps them by id for the conversation importer.
app.importers.mailboxes = {
  namesById: {},

  reset() {
    this.namesById = {};
  },

  importAll() {
    logger.startImport("inboxes");
    var mailboxes = app.api.getMailboxes();
    mailboxes.forEach((mailbox) => {
      this.namesById[String(mailbox.id)] = mailbox.name;
      dwh.dimensions.mailboxes.createAndLookupId({id: mailbox.id},
        {name: mailbox.name, email: mailbox.email});
    });
    logger.finishImport("inboxes", mailboxes.length);
  },

  // The inboxes to import the conversations of, as `{key, name}` — the selected ones, or every
  // inbox when nothing is selected. The conversations of each are imported on their own, so that
  // the import log names the inbox whose conversations took the time.
  selected(mailboxIds) {
    var ids = (mailboxIds && mailboxIds.length > 0)
      ? mailboxIds.map((mailboxId) => String(mailboxId)) : Object.keys(this.namesById);
    return ids.map((mailboxId) => ({key: mailboxId, name: this.nameOf(mailboxId) || `Inbox ${mailboxId}`}));
  },

  nameOf(mailboxId) {
    return mailboxId ? this.namesById[String(mailboxId)] : null;
  },

  // An inbox the user has no access to any more still has conversations in the import.
  lookupId(mailboxId) {
    if (!mailboxId) return null;
    return dwh.dimensions.mailboxes.createAndLookupId({id: mailboxId},
      {name: this.nameOf(mailboxId) || `Inbox ${mailboxId}`});
  }
};
