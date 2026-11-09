// The satisfaction ratings customers gave to the agent replies.
//
// Ratings are only listable through the happiness report, whose rows carry the conversation id but
// none of its other attributes. They are therefore fetched before the conversations and written
// while each conversation is imported, with the full dimension foreign key set of that conversation.
// The ratings whose conversation is not part of this import are written afterwards with the
// dimensions the report itself knows.
app.importers.ratings = {
  // The rating values of the happiness report.
  MEASURE_COLUMNS: {1: "great_ratings", 2: "okay_ratings", 3: "not_good_ratings"},
  // Help Scout started in 2011 — the lower bound of an "All history" ratings import.
  EARLIEST_START: "2011-01-01T00:00:00Z",

  // conversation id -> the ratings of that conversation, emptied as they are imported.
  byConversationId: {},

  reset() {
    this.byConversationId = {};
  },

  // One request per inbox, so that every rating knows its inbox: the report rows do not name it, and
  // a rating written without its conversation could not be removed with the inbox otherwise.
  fetchAll(mailboxIds, start, end) {
    logger.startImport("ratings");
    var count = 0;
    var requests = (mailboxIds && mailboxIds.length > 0) ?
      mailboxIds.map((mailboxId) => ({mailboxId: String(mailboxId), mailboxIds: [mailboxId]})) :
      [{mailboxId: null, mailboxIds: []}];
    requests.forEach((request) => {
      app.api.getHappinessRatings(request.mailboxIds, start || this.EARLIEST_START, end, (batch) => {
        batch.forEach((rating) => {
          source.checkCanceling();
          rating.mailboxId = request.mailboxId;
          var conversationKey = String(rating.id);
          if (!this.byConversationId[conversationKey]) this.byConversationId[conversationKey] = [];
          this.byConversationId[conversationKey].push(rating);
          count++;
        });
      });
    });
    logger.finishImport("ratings", count);
    return count;
  },

  // Whether ratings are stored without an inbox — what an earlier version wrote for the ratings of a
  // conversation that was not part of the import.
  hasUnscopedRows() {
    return dwh.measures.conversations_ratings.selectCount({mailbox_id: null, _source_name: "rating"}) > 0;
  },

  removeUnscoped() {
    dwh.measures.conversations_ratings.deleteRows({mailbox_id: null, _source_name: "rating"});
  },

  importAllOf(conversation, ids) {
    var conversationKey = String(conversation.id);
    var ratings = this.byConversationId[conversationKey];
    if (!ratings) return 0;
    delete this.byConversationId[conversationKey];
    return this.storeRatings(ratings, ids);
  },

  // Drops the fetched ratings of a conversation left out of the import (skip_conversations), so
  // importRemaining does not import them afterwards with fallback ids.
  discard(conversationId) {
    delete this.byConversationId[String(conversationId)];
  },

  // skippedConversationNumbers also filters here, not only through discard: a skipped conversation
  // outside the current incremental sweep never reaches storeRows, so discard is never called for
  // it, yet its ratings still arrive through fetchAll and would otherwise import through here.
  importRemaining(skippedConversationNumbers) {
    var conversationKeys = Object.keys(this.byConversationId);
    if (conversationKeys.length === 0) return 0;

    logger.startImport("remaining ratings");
    var count = 0;
    conversationKeys.forEach((conversationKey) => {
      var ratings = this.byConversationId[conversationKey];
      delete this.byConversationId[conversationKey];
      if ((skippedConversationNumbers || []).indexOf(ratings[0].number) >= 0) return;
      count += this.storeRatings(ratings, this.fallbackIds(ratings[0]));
    });
    logger.finishImport("remaining ratings", count);
    return count;
  },

  fallbackIds(rating) {
    return {
      mailbox_id: app.importers.mailboxes.lookupId(rating.mailboxId),
      conversation_id: dwh.dimensions.conversations.lookupId({id: rating.id}),
      channel_id: app.importers.statuses.lookupChannelId(rating.type),
      customer_id: rating.ratingCustomerId
        ? dwh.dimensions.customers.lookupId({id: rating.ratingCustomerId}) : null
    };
  },

  // Each rating is its own import scope, keyed by the thread it rates, so that a rating added later
  // never deletes the earlier ratings of the same conversation.
  storeRatings(ratings, ids) {
    var rows = ratings.map((rating) => this.buildRow(rating, ids)).filter((row) => row);
    if (rows.length > 0) dwh.measures.conversations_ratings.importRows(rows);
    return rows.length;
  },

  buildRow(rating, ids) {
    var timeId = dwh.lookupTimeId(rating, "ratingCreatedAt");
    if (!timeId) return null;

    var row = app.importers.rows.copy(ids);
    row._source_id = String(rating.threadid);
    row._source_name = "rating";
    row.time_id = timeId;
    row.hour_id = app.importers.statuses.lookupHourId(rating.ratingCreatedAt);
    row._updated_at = dwh.datetimeValue(rating, "ratingCreatedAt");
    row.agent_id = app.importers.people.store("agents", "agent_key", this.ratedUser(rating));
    row.ratings = 1;
    row.great_ratings = 0;
    row.okay_ratings = 0;
    row.not_good_ratings = 0;

    var measureColumn = this.MEASURE_COLUMNS[rating.ratingId];
    if (measureColumn) row[measureColumn] = 1;
    return row;
  },

  // The report names the rated agent instead of describing them as a person object.
  ratedUser(rating) {
    if (!rating.ratingUserId) return null;
    var nameParts = String(rating.ratingUserName || "").split(" ");
    return {id: rating.ratingUserId, type: "user",
            first: nameParts[0], last: nameParts.slice(1).join(" ")};
  }
};
