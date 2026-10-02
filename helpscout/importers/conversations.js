// One Help Scout conversation becomes one dimension member and a handful of fact rows — one row per
// conversation event, so that every measure is counted in the Time dimension period of its own
// timestamp. Rows that fall into the same Time member are merged.
app.importers.conversations = {
  // The conversations of one inbox. Started per inbox, so that the import log names the inbox
  // whose conversations took the time.
  importAllOf(mailbox, shared, progress) {
    logger.startImport("conversations", mailbox.name);
    var count = 0;
    this.showProgress(mailbox, progress);
    app.api.getConversations([mailbox.key], shared.since, (batch) => {
      batch.forEach((conversation) => {
        var imported = this.importOne(conversation, shared);
        count += imported;
        if (progress) progress.imported += imported;
      });
      // After every page rather than after every conversation: one status message per 25
      // conversations is what the user sees moving, without a write per row.
      this.showProgress(mailbox, progress);
    });
    logger.finishImport("conversations", count);
    return count;
  },

  // The inbox being imported and the conversations imported so far. The count is the running total
  // of the whole import, not of this inbox alone, so it never goes backwards when the next inbox
  // starts.
  showProgress(mailbox, progress) {
    if (!progress) return;
    var message = `Importing conversations of ${mailbox.name}`;
    if (progress.imported > 0) {
      message += `, ${progress.imported} imported`;
      if (progress.total) message += ` of ${progress.total}`;
    }
    source.setStatusMessage(message, {percentage: this.percentageOf(progress)});
  },

  // The share of the conversations imported when Help Scout answered a total for the selection, and
  // the share of the inboxes finished when it did not. A conversation changed while a long import
  // runs enters the sweep after the total was read, so the percentage is capped rather than
  // allowed past 100; drafts and failed conversations leave it short of 100 instead.
  percentageOf(progress) {
    if (progress.total > 0) return Math.min(progress.imported * 100 / progress.total, 100);
    return progress.mailboxIndex * 100 / progress.mailboxCount;
  },

  importOne(conversation, shared) {
    var warningKey = `conversation/${conversation.id}`;
    try {
      var imported = this.storeRows(conversation, shared);
      source.warnings.clearOld(warningKey);
      return imported;
    } catch (error) {
      // This conversation is skipped, the import continues, and the incremental mark stays put.
      source.warnings.addObjectFailure(warningKey,
        `Import of conversation #${conversation.number} failed: ${error.message}`);
      return 0;
    }
  },

  storeRows(conversation, shared) {
    // A draft was never sent to anybody.
    if (conversation.state === "draft") return 0;
    // An exceptional conversation the account owner chose to leave out of the import entirely, named
    // by number in the skip_conversations advanced setting. Its already fetched ratings are dropped
    // too, so importRemaining does not import them afterwards with fallback ids.
    if ((shared.skippedConversationNumbers || []).indexOf(conversation.number) >= 0) {
      if (shared.importRatings) app.importers.ratings.discard(conversation.id);
      return 0;
    }

    var threads = this.threadsOf(conversation);
    // Resolved before the dimension member is stored: the two interval dimensions keep their raw
    // durations on the Conversation dimension table, and `createAndLookupId` writes the attributes
    // of a member once per import.
    var firstReplyAt = this.firstReplyAt(conversation, threads);
    // Counted from the threads the conversation was fetched with, so that the message counts of a
    // conversation cost no request of their own and are there also with messages not imported.
    var counts = app.importers.messages.countsOf(threads);
    var ids = this.dimensionIds(conversation, firstReplyAt, counts, shared.officeHours);

    dwh.measures.conversations.importRows(
      this.buildRows(conversation, ids, firstReplyAt, counts, shared.officeHours),
      {sourceId: String(conversation.id), sourceName: "conversation"});

    if (shared.importMessages) {
      app.importers.messages.importAllOf(conversation, ids, threads, shared.officeHours);
    }
    if (shared.importRatings) app.importers.ratings.importAllOf(conversation, ids);
    return 1;
  },

  // Help Scout truncates the embedded chat threads of `embed=threads` by design, so a conversation
  // whose embedded threads are fewer than its own thread count is requested in full.
  threadsOf(conversation) {
    var embedded = (conversation._embedded && conversation._embedded.threads) || [];
    if (conversation.threads && embedded.length < conversation.threads)
      return app.api.getConversationThreads(conversation.id);
    return embedded;
  },

  dimensionIds(conversation, firstReplyAt, counts, officeHours) {
    // The custom field dimensions of the selection are part of every fact row of the conversation,
    // so the message and the rating rows carry them as well.
    return app.importers.rows.merge(app.importers.customFields.dimensionIds(conversation), {
      conversation_id: this.storeConversation(conversation, firstReplyAt, counts, officeHours),
      mailbox_id: app.importers.mailboxes.lookupId(conversation.mailboxId),
      status_id: app.importers.statuses.lookupStatusId(conversation.status),
      channel_id: app.importers.statuses.lookupChannelId(conversation.type),
      source_type_id: app.importers.statuses.lookupSourceTypeId(
        conversation.source && conversation.source.type),
      assignee_id: this.assigneeId(conversation),
      closer_id: this.closedById(conversation),
      customer_id: app.importers.customers.storeConversationCustomer(conversation.primaryCustomer),
      organization_id: app.importers.customers.organizationIdFor(conversation.primaryCustomer),
      tag_bt_id: this.tagBtId(conversation.tags)
    });
  },

  assigneeId(conversation) {
    if (conversation.assignee && conversation.assignee.id)
      return app.importers.people.store("assignees", "assignee_key", conversation.assignee);
    return app.importers.people.unassignedId();
  },

  closedById(conversation) {
    if (conversation.closedByUser && conversation.closedByUser.id)
      return app.importers.people.store("closers", "closed_by_key", conversation.closedByUser);
    return app.importers.people.notClosedId();
  },

  // A conversation with no tags is bridged to the "(untagged)" member instead of an empty set, so
  // that it stays visible in a report grouped by Tag.
  tagBtId(tags) {
    var validTags = (tags || []).filter((tag) => tag && tag.tag);
    if (validTags.length === 0) {
      return dwh.dimensions.tags_bt.btIdFor(
        [dwh.dimensions.tags.createAndLookupId({name: "(untagged)"}, {id: -1})]);
    }
    var tagIds = validTags.map((tag) =>
      dwh.dimensions.tags.createAndLookupId({name: tag.tag}, {id: tag.id}));
    return dwh.dimensions.tags_bt.btIdFor(tagIds);
  },

  // Every tag of the conversation as one comma separated string, for the Tags property — the Tag
  // dimension itself already counts each tag of its own.
  tagsList(tags) {
    var names = (tags || []).filter((tag) => tag && tag.tag).map((tag) => tag.tag);
    return names.length > 0 ? names.join(", ") : "(untagged)";
  },

  storeConversation(conversation, firstReplyAt, counts, officeHours) {
    var rows = app.importers.rows;
    var people = app.importers.people;
    var messageCounts = counts || {};
    return dwh.dimensions.conversations.createAndLookupId(
      {id: conversation.id},
      rows.merge(app.importers.customFields.valuesOf(conversation), {
        number: conversation.number,
        // Prefixed with the conversation number, so that two conversations with the same subject —
        // or none — are two members with two different names.
        name: `#${conversation.number} ${conversation.subject || "(no subject)"}`,
        status: rows.humanize(conversation.status),
        channel: rows.humanize(conversation.type),
        mailbox_name: app.importers.mailboxes.nameOf(conversation.mailboxId),
        state: rows.humanize(conversation.state),
        source_via: rows.humanize(conversation.source && conversation.source.via),
        customer_email: conversation.primaryCustomer && conversation.primaryCustomer.email,
        created_at: dwh.datetimeValue(conversation, "createdAt"),
        closed_at: dwh.datetimeValue(conversation, "closedAt"),
        user_updated_at: dwh.datetimeValue(conversation, "userUpdatedAt"),
        customer_waiting_since: dwh.datetimeValue(
          this.customerWaitingSince(conversation), "customer waiting since"),
        threads_count: conversation.threads,
        created_by_name: people.displayName(conversation.createdBy),
        closed_by_name: people.displayName(conversation.closedByUser),
        assignee_name: people.displayName(conversation.assignee),
        tags_list: this.tagsList(conversation.tags),
        messages_count: messageCounts.messages,
        customer_messages_count: messageCounts.customerMessages,
        agent_replies_count: messageCounts.agentReplies,
        // The raw durations the interval dimensions bucket, in minutes.
        first_reply_minutes: rows.minutesBetween(conversation.createdAt, firstReplyAt),
        closing_minutes: rows.minutesBetween(conversation.createdAt, conversation.closedAt),
        first_reply_office_minutes: this.officeMinutesBetween(
          conversation.createdAt, firstReplyAt, officeHours),
        closing_office_minutes: this.officeMinutesBetween(
          conversation.createdAt, conversation.closedAt, officeHours)
      }));
  },

  // The office hours durations stay empty unless the Use office hours option is selected.
  officeMinutesBetween(fromTimestamp, toTimestamp, officeHours) {
    if (!officeHours) return null;
    return app.importers.officeHours.minutesBetween(fromTimestamp, toTimestamp, officeHours.schedule);
  },

  // Help Scout answers the waiting time as `{time, friendly}`, and older responses as the timestamp
  // itself.
  customerWaitingSince(conversation) {
    var waitingSince = conversation.customerWaitingSince;
    if (!waitingSince) return null;
    return waitingSince.time || (typeof waitingSince === "string" ? waitingSince : null);
  },

  buildRows(conversation, ids, firstReplyAt, counts, officeHours) {
    var rowsByKey = {};
    var messageCounts = counts || {};
    var updatedAt = dwh.datetimeValue(conversation, "userUpdatedAt") ||
                    dwh.datetimeValue(conversation, "createdAt");

    // Each event of the conversation is counted in the Time member and the hour of its own
    // timestamp, so two events of the same period are one row only when they also share the hour.
    var rowAt = (timeId, timestamp) => {
      if (!timeId) return null;
      var hourId = app.importers.statuses.lookupHourId(timestamp);
      var rowKey = `${timeId}/${hourId}`;
      var row = rowsByKey[rowKey];
      if (!row) {
        row = app.importers.rows.copy(ids);
        row.time_id = timeId;
        row.hour_id = hourId;
        row._updated_at = updatedAt;
        rowsByKey[rowKey] = row;
      }
      return row;
    };

    var createdRow = rowAt(dwh.lookupTimeId(conversation, "createdAt"), conversation.createdAt);
    if (createdRow) {
      createdRow.conversations_created = 1;
      // A numeric custom field describes the conversation as a whole, so it is counted once, at the
      // time the conversation was created.
      app.importers.rows.merge(createdRow, app.importers.customFields.measureValues(conversation));
    }

    var updatedRow = rowAt(dwh.lookupTimeId(conversation, "userUpdatedAt"),
      conversation.userUpdatedAt);
    if (updatedRow) updatedRow.conversations_updated = 1;

    var closedRow = rowAt(dwh.lookupTimeId(conversation, "closedAt"), conversation.closedAt);
    if (closedRow) {
      closedRow.conversations_closed = 1;
      closedRow.closing_hours = app.importers.rows.hoursBetween(
        conversation.createdAt, conversation.closedAt);
      if (officeHours) {
        closedRow.closing_office_hours = app.importers.officeHours.hoursBetween(
          conversation.createdAt, conversation.closedAt, officeHours.schedule);
      }
      closedRow.closed_messages_count = messageCounts.messages;
      // Help Scout counts a conversation as resolved only when the team answered it — a
      // conversation closed without a reply was never worked on.
      if (messageCounts.agentReplies > 0) closedRow.conversations_resolved = 1;
      if (messageCounts.agentReplies === 1) closedRow.conversations_resolved_on_first_reply = 1;
    }

    var replyRow = rowAt(dwh.lookupTimeId(firstReplyAt, "first reply at"), firstReplyAt);
    if (replyRow) {
      replyRow.conversations_with_first_reply = 1;
      replyRow.first_reply_hours = app.importers.rows.hoursBetween(
        conversation.createdAt, firstReplyAt);
      if (officeHours) {
        replyRow.first_reply_office_hours = app.importers.officeHours.hoursBetween(
          conversation.createdAt, firstReplyAt, officeHours.schedule);
      }
    }

    return _.values(rowsByKey);
  },

  // The first published agent reply after the conversation was created. Notes and the `lineitem`
  // status changes are not replies, and a conversation an agent started is outbound — its first
  // message answers nobody, so it gets no first reply at all.
  firstReplyAt(conversation, threads) {
    if (conversation.createdBy &&
        app.api.USER_TYPES.indexOf(conversation.createdBy.type) >= 0) return null;

    var createdAtMs = Date.parse(conversation.createdAt);
    if (isNaN(createdAtMs)) return null;

    var replies = (threads || []).filter((thread) =>
      thread.state === "published" &&
      app.api.AGENT_REPLY_THREAD_TYPES.indexOf(thread.type) >= 0 &&
      thread.createdBy && app.api.USER_TYPES.indexOf(thread.createdBy.type) >= 0 &&
      thread.createdAt && Date.parse(thread.createdAt) >= createdAtMs);
    if (replies.length === 0) return null;

    return _.sortBy(replies, (thread) => Date.parse(thread.createdAt))[0].createdAt;
  }
};
