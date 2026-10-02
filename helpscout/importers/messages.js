// The threads of one conversation. Every published thread that is a message becomes one fact row at
// the time it was written; threads written in the same Time member and hour by the same author are
// merged.
app.importers.messages = {
  importAllOf(conversation, ids, threads, officeHours) {
    var rows = this.buildRows(conversation, ids, threads, officeHours);
    dwh.measures.conversations_messages.importRows(rows,
      {sourceId: String(conversation.id), sourceName: "message"});
    return rows.length;
  },

  buildRows(conversation, ids, threads, officeHours) {
    var rowsByKey = {};
    var updatedAt = dwh.datetimeValue(conversation, "userUpdatedAt") ||
                    dwh.datetimeValue(conversation, "createdAt");
    var responseHoursByThreadId = this.responseHoursOf(threads, officeHours);

    this.messageThreadsOf(threads).forEach((thread) => {
      var timeId = dwh.lookupTimeId(thread, "createdAt");
      if (!timeId) return;

      var hourId = app.importers.statuses.lookupHourId(thread.createdAt);
      var authorId = this.agentIdOf(thread.createdBy);
      var rowKey = `${timeId}/${hourId}/${authorId}`;
      var row = rowsByKey[rowKey];
      if (!row) {
        row = app.importers.rows.copy(ids);
        row.time_id = timeId;
        row.hour_id = hourId;
        row.agent_id = authorId;
        row._updated_at = updatedAt;
        row.conversation_messages_created = 0;
        row.customer_messages_created = 0;
        row.agent_replies_created = 0;
        row.notes_created = 0;
        row.attachments_created = 0;
        rowsByKey[rowKey] = row;
      }

      // A note is not a message that passed between the customer and the team, so it does not count
      // toward it — only toward its own Notes created.
      var measureColumn = this.measureColumnOf(thread);
      if (measureColumn && measureColumn !== "notes_created") row.conversation_messages_created += 1;
      row.attachments_created += this.attachmentCount(thread);
      if (measureColumn) row[measureColumn] += 1;

      if (measureColumn === "agent_replies_created") {
        // The customer of the conversation counts as helped once the team answered them, and the
        // distinct count of the column counts each of them once however many replies they got.
        row.replied_customer_id = ids.customer_id;
        var response = responseHoursByThreadId[thread.id];
        if (response !== undefined) {
          row.response_hours = (row.response_hours || 0) + response.hours;
          row.agent_replies_with_response = (row.agent_replies_with_response || 0) + 1;
          if (officeHours) {
            row.response_office_hours = (row.response_office_hours || 0) + response.officeHours;
          }
        }
      }
    });

    return _.values(rowsByKey);
  },

  // The Agent dimension holds the staff members only, so that a report grouped by Agent counts the
  // work of the team. A message the customer wrote carries no agent — the person who wrote it is
  // the customer the Customer dimension of the same row already names.
  agentIdOf(person) {
    if (!person || app.api.USER_TYPES.indexOf(person.type) < 0) return null;
    return app.importers.people.store("agents", "agent_key", person);
  },

  // The published threads that are messages, oldest first — the order the conversation was written
  // in, which `embed=threads` does not guarantee.
  messageThreadsOf(threads) {
    var messages = (threads || []).filter((thread) =>
      thread.state === "published" &&
      app.api.NON_MESSAGE_THREAD_TYPES.indexOf(thread.type) < 0);
    return _.sortBy(messages, (thread) => Date.parse(thread.createdAt) || 0);
  },

  // How many messages of each kind the conversation holds. The conversations importer stores these
  // on the conversation itself, so that they are counted the same way whether or not the individual
  // messages are imported. `messages` is the customer messages and the agent replies together, not
  // the internal notes — the messages that actually passed between the customer and the team.
  countsOf(threads) {
    var counts = {messages: 0, customerMessages: 0, agentReplies: 0};
    this.messageThreadsOf(threads).forEach((thread) => {
      var measureColumn = this.measureColumnOf(thread);
      if (measureColumn === "agent_replies_created") {
        counts.agentReplies += 1;
        counts.messages += 1;
      } else if (measureColumn === "customer_messages_created") {
        counts.customerMessages += 1;
        counts.messages += 1;
      }
    });
    return counts;
  },

  // How long the customer waited for each agent reply — the wait Help Scout reports as the response
  // time, measured for every reply and not only for the first one. A reply answers the earliest
  // customer message that no reply has answered yet; a reply written when nobody is waiting (the
  // team writing again, or an outbound conversation) answers nobody and has no response time.
  // Keyed by thread id, so that the row of the reply can add it — `{hours, officeHours}`, the same
  // wait within the office hours only, when they are used.
  responseHoursOf(threads, officeHours) {
    var responseHours = {};
    var waitingSince = null;
    this.messageThreadsOf(threads).forEach((thread) => {
      var measureColumn = this.measureColumnOf(thread);
      if (measureColumn === "customer_messages_created") {
        if (!waitingSince) waitingSince = thread.createdAt;
      } else if (measureColumn === "agent_replies_created" && waitingSince) {
        var hours = app.importers.rows.hoursBetween(waitingSince, thread.createdAt);
        if (hours !== null) {
          responseHours[thread.id] = {hours: hours};
          if (officeHours) {
            responseHours[thread.id].officeHours = app.importers.officeHours.hoursBetween(
              waitingSince, thread.createdAt, officeHours.schedule);
          }
        }
        waitingSince = null;
      }
    });
    return responseHours;
  },

  // The thread type says what the message is; who wrote it decides the direction of the types that
  // both sides use — a chat or a phone thread can come from either.
  measureColumnOf(thread) {
    if (thread.type === "note") return "notes_created";
    if (thread.type === "customer") return "customer_messages_created";
    if (app.api.AGENT_REPLY_THREAD_TYPES.indexOf(thread.type) >= 0) {
      var createdByType = thread.createdBy && thread.createdBy.type;
      return app.api.USER_TYPES.indexOf(createdByType) >= 0
        ? "agent_replies_created" : "customer_messages_created";
    }
    return null;
  },

  attachmentCount(thread) {
    var attachments = thread._embedded && thread._embedded.attachments;
    return (attachments && attachments.length) || 0;
  }
};
