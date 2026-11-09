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

  // The conversations, messages and ratings of the inboxes that are not selected any more. The
  // conversation importer rewrites only the conversations it fetches, so the rows of a deselected
  // inbox would stay in the cube next to the selected ones. Every other inbox of the user is
  // treated as deselected, which also clears the rows imported before the selection was changed
  // by an earlier version. Nothing is removed while no inbox is selected, as every inbox is imported
  // then.
  removeDeselectedData(mailboxIds) {
    if (!mailboxIds || mailboxIds.length === 0) return;
    var selectedIds = mailboxIds.map((mailboxId) => String(mailboxId));
    Object.keys(this.namesById).forEach((mailboxId) => {
      if (selectedIds.indexOf(mailboxId) >= 0) return;
      var memberId = dwh.dimensions.mailboxes.lookupId({id: Number(mailboxId)});
      if (!memberId) return;
      // Rows are matched by their source name too, as each importer stores its rows under its own.
      [["conversations", "conversation"], ["conversations_messages", "message"],
       ["conversations_ratings", "rating"]].forEach((target) => {
        dwh.measures[target[0]].deleteRows({mailbox_id: memberId, _source_name: target[1]});
      });
    });
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
