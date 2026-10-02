describe("app.importers.conversations", () => {
  function conversation(attributes) {
    return app.importers.rows.merge({
      id: 500, number: 50, threads: 2, type: "email", status: "active", state: "published",
      subject: "Help", mailboxId: 13,
      createdBy: {id: 5, type: "customer", first: "Vernon", last: "Bear"},
      createdAt: "2026-03-01T08:00:00Z",
      userUpdatedAt: "2026-03-01T09:00:00Z",
      source: {type: "email", via: "customer"},
      tags: [],
      primaryCustomer: {id: 5, type: "customer", first: "Vernon", last: "Bear"}
    }, attributes || {});
  }

  function thread(attributes) {
    return app.importers.rows.merge({
      id: 1, type: "message", state: "published", createdAt: "2026-03-01T10:00:00Z",
      createdBy: {id: 99, type: "user"}
    }, attributes || {});
  }

  describe("firstReplyAt", () => {
    test("is the earliest published agent reply after the conversation was created", () => {
      var threads = [
        thread({id: 1, type: "customer", createdBy: {id: 5, type: "customer"},
                createdAt: "2026-03-01T08:00:00Z"}),
        thread({id: 2, createdAt: "2026-03-01T12:00:00Z"}),
        thread({id: 3, createdAt: "2026-03-01T10:00:00Z"})
      ];

      expect(app.importers.conversations.firstReplyAt(conversation(), threads)).
        toBe("2026-03-01T10:00:00Z");
      // v2 reports an AI powered system user as a plain user, v3 does not — both are agents.
      expect(app.importers.conversations.firstReplyAt(conversation(),
        [thread({createdBy: {id: 7, type: "system_user"}})])).toBe("2026-03-01T10:00:00Z");
    });

    test("is not any of the threads that are not an agent reply", () => {
      var notReplies = {
        "an internal note": thread({type: "note"}),
        "a status change line item": thread({type: "lineitem"}),
        "an unpublished draft reply": thread({state: "draft"}),
        "a chat the customer wrote": thread({type: "chat",
          createdBy: {id: 5, type: "customer"}}),
        "a message the customer wrote": thread({type: "customer",
          createdBy: {id: 5, type: "customer"}}),
        "a reply written before the conversation": thread({createdAt: "2026-02-01T10:00:00Z"})
      };

      for (let description in notReplies) {
        expect(app.importers.conversations.firstReplyAt(conversation(),
          [notReplies[description]])).toBeNull();
      }
    });

    test("has none for an outbound conversation an agent started", () => {
      var outbound = conversation({createdBy: {id: 99, type: "user"}});

      expect(app.importers.conversations.firstReplyAt(outbound, [thread()])).toBeNull();
      expect(app.importers.conversations.firstReplyAt(conversation(), [])).toBeNull();
    });
  });

  describe("threadsOf", () => {
    test("uses the threads embedded in the conversation when they are complete", () => {
      var complete = conversation({threads: 1, _embedded: {threads: [thread()]}});

      expect(app.importers.conversations.threadsOf(complete).map((one) => one.id)).toEqual([1]);
      expect(mock.requests()).toEqual([]);
    });

    test("requests the threads when the embedded ones are truncated", () => {
      mock.get("/v2/conversations/500/threads", {json: {
        _embedded: {threads: [thread({id: 1}), thread({id: 2})]}, _links: {}
      }});
      var truncated = conversation({threads: 2, _embedded: {threads: [thread({id: 1})]}});

      expect(app.importers.conversations.threadsOf(truncated).map((one) => one.id)).
        toEqual([1, 2]);
    });
  });

  describe("buildRows", () => {
    beforeEach(() => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();
    });

    test("counts the conversation as created, updated, closed and first replied", () => {
      var closed = conversation({
        status: "closed", closedAt: "2026-03-03T08:00:00Z", userUpdatedAt: "2026-03-03T08:00:00Z"
      });
      var threads = [thread({createdAt: "2026-03-01T14:00:00Z"})];
      var firstReplyAt = app.importers.conversations.firstReplyAt(closed, threads);

      var rows = app.importers.conversations.buildRows(closed, {}, firstReplyAt,
        app.importers.messages.countsOf(threads));

      // Created 08:00 and first replied 14:00 on Mar 1, updated and closed on Mar 3 — an event is
      // counted in the hour of its own timestamp, so the two events of Mar 1 are two rows.
      expect(rows).toHaveLength(3);
      var createdRow = _.find(rows, (row) => row.conversations_created === 1);
      expect(createdRow.conversations_with_first_reply).toBeUndefined();
      var replyRow = _.find(rows, (row) => row.conversations_with_first_reply === 1);
      expect(replyRow.first_reply_hours).toBe(6);
      var closedRow = _.find(rows, (row) => row.conversations_closed === 1);
      expect(closedRow.conversations_updated).toBe(1);
      expect(closedRow.closing_hours).toBe(48);
    });

    // Help Scout counts a conversation as resolved only when the team answered it before it was
    // closed, and as resolved on the first reply when one reply was enough.
    test("counts a closed conversation as resolved when an agent answered it", () => {
      var closed = conversation({status: "closed", closedAt: "2026-03-03T08:00:00Z"});
      var oneReply = [thread({type: "customer", createdBy: {id: 5, type: "customer"}}),
                      thread({id: 2, createdAt: "2026-03-01T11:00:00Z"})];

      var rows = app.importers.conversations.buildRows(closed, {}, null,
        app.importers.messages.countsOf(oneReply));

      var closedRow = _.find(rows, (row) => row.conversations_closed === 1);
      expect(closedRow.conversations_resolved).toBe(1);
      expect(closedRow.conversations_resolved_on_first_reply).toBe(1);
      expect(closedRow.closed_messages_count).toBe(2);

      // A second reply resolves it as well, but no longer on the first reply.
      var twoReplies = oneReply.concat([thread({id: 3, createdAt: "2026-03-02T11:00:00Z"})]);
      var replied = _.find(app.importers.conversations.buildRows(closed, {}, null,
        app.importers.messages.countsOf(twoReplies)), (row) => row.conversations_closed === 1);
      expect(replied.conversations_resolved).toBe(1);
      expect(replied.conversations_resolved_on_first_reply).toBeUndefined();
    });

    test("counts a conversation closed without a reply as closed but not resolved", () => {
      var closed = conversation({status: "closed", closedAt: "2026-03-03T08:00:00Z"});
      var noReply = [thread({type: "customer", createdBy: {id: 5, type: "customer"}})];

      var rows = app.importers.conversations.buildRows(closed, {}, null,
        app.importers.messages.countsOf(noReply));

      var closedRow = _.find(rows, (row) => row.conversations_closed === 1);
      expect(closedRow.conversations_resolved).toBeUndefined();
      expect(closedRow.conversations_resolved_on_first_reply).toBeUndefined();
    });

    // 2026-03-02 is a Monday, and the default office hours are 09:00 to 18:00 from Monday to Friday.
    test("counts the first reply and the closing time within the office hours when they are used", () => {
      var closed = conversation({
        status: "closed", createdAt: "2026-03-02T08:00:00Z", closedAt: "2026-03-04T08:00:00Z",
        userUpdatedAt: "2026-03-04T08:00:00Z"
      });
      var threads = [thread({createdAt: "2026-03-02T14:00:00Z"})];
      var firstReplyAt = app.importers.conversations.firstReplyAt(closed, threads);
      var officeHours = {schedule: app.importers.officeHours.schedule()};

      var rows = app.importers.conversations.buildRows(closed, {}, firstReplyAt,
        app.importers.messages.countsOf(threads), officeHours);

      var replyRow = _.find(rows, (row) => row.conversations_with_first_reply === 1);
      expect(replyRow.first_reply_hours).toBe(6);
      expect(replyRow.first_reply_office_hours).toBe(5);
      // Nine office hours on Monday and on Tuesday, none on Wednesday before 09:00.
      var closedRow = _.find(rows, (row) => row.conversations_closed === 1);
      expect(closedRow.closing_hours).toBe(48);
      expect(closedRow.closing_office_hours).toBe(18);

      var withoutOfficeHours = app.importers.conversations.buildRows(closed, {}, firstReplyAt,
        app.importers.messages.countsOf(threads));
      expect(_.filter(withoutOfficeHours, (row) =>
        row.first_reply_office_hours !== undefined || row.closing_office_hours !== undefined)).toEqual([]);
    });

    test("leaves the closing measures empty while the conversation is open", () => {
      var rows = app.importers.conversations.buildRows(conversation(), {}, null, {});

      // Created 08:00 and updated 09:00 — two hours of the same day, so two rows.
      expect(rows).toHaveLength(2);
      expect(_.find(rows, (row) => row.conversations_created === 1)).toBeDefined();
      expect(_.find(rows, (row) => row.conversations_updated === 1)).toBeDefined();
      expect(_.filter(rows, (row) => row.conversations_closed)).toEqual([]);
      expect(_.filter(rows, (row) => row.closing_hours)).toEqual([]);
    });
  });

  describe("storeConversation", () => {
    beforeEach(() => {
      mock.extraOptions({time_dimension_time_zone: "Europe/Riga"});
      importRun.prepare();
    });

    test("stores the timestamps in the Time dimension time zone", () => {
      // 23:30 UTC is half past one of the next day in Riga.
      app.importers.conversations.storeConversation(conversation({
        createdAt: "2026-03-01T23:30:00Z", closedAt: "2026-03-02T23:30:00Z"
      }));

      var rows = dwh.dimensions.conversations.rows({columns: ["created_at", "closed_at"]});
      expect(rows[0].created_at.substring(0, 19)).toBe("2026-03-02T01:30:00");
      expect(rows[0].closed_at.substring(0, 19)).toBe("2026-03-03T01:30:00");
    });

    // The two interval dimensions bucket these columns of the Conversation dimension table; they
    // are written in minutes, so they must be resolved before the member is stored.
    test("stores the raw durations the interval dimensions bucket, in minutes", () => {
      app.importers.conversations.storeConversation(conversation({
        createdAt: "2026-03-01T10:00:00Z", closedAt: "2026-03-02T10:00:00Z"
      }), "2026-03-01T12:30:00Z");

      expect(dwh.dimensions.conversations.rows({
        columns: ["first_reply_minutes", "closing_minutes"]})).
        toEqual([{first_reply_minutes: 150, closing_minutes: 1440}]);
    });

    // Created at 10:00 on Monday in Riga, first replied at 14:30 and closed at 10:00 on Tuesday.
    test("stores the durations within the office hours when they are used", () => {
      var officeHours = {schedule: app.importers.officeHours.schedule()};
      app.importers.conversations.storeConversation(conversation({
        createdAt: "2026-03-02T08:00:00Z", closedAt: "2026-03-03T08:00:00Z"
      }), "2026-03-02T12:30:00Z", {}, officeHours);

      expect(dwh.dimensions.conversations.rows({
        columns: ["first_reply_office_minutes", "closing_office_minutes"]})).
        toEqual([{first_reply_office_minutes: 270, closing_office_minutes: 540}]);
    });

    test("leaves the office hours durations empty unless the office hours are used", () => {
      app.importers.conversations.storeConversation(conversation({
        createdAt: "2026-03-02T08:00:00Z", closedAt: "2026-03-03T08:00:00Z"
      }), "2026-03-02T12:30:00Z", {});

      expect(dwh.dimensions.conversations.rows({
        columns: ["first_reply_office_minutes", "closing_office_minutes"]})).
        toEqual([{first_reply_office_minutes: null, closing_office_minutes: null}]);
    });

    test("leaves the durations empty for an open conversation with no reply", () => {
      app.importers.conversations.storeConversation(conversation({closedAt: null}), null);

      expect(dwh.dimensions.conversations.rows({
        columns: ["first_reply_minutes", "closing_minutes"]})).
        toEqual([{first_reply_minutes: null, closing_minutes: null}]);
    });

    test("stores the display name of who it is assigned to, empty while unassigned", () => {
      app.importers.conversations.storeConversation(conversation({
        id: 501, assignee: {id: 99, type: "user", first: "Mr", last: "Robot"}
      }), null, {});
      app.importers.conversations.storeConversation(conversation({id: 502, assignee: null}), null, {});

      expect(dwh.dimensions.conversations.rows({columns: ["id", "assignee_name"], orderBy: "id"})).
        toEqual([{id: 501, assignee_name: "Mr Robot"}, {id: 502, assignee_name: null}]);
    });

    test("stores every tag as one comma separated string, or (untagged) when it has none", () => {
      app.importers.conversations.storeConversation(conversation({
        id: 501, tags: [{id: 1, tag: "vip"}, {id: 2, tag: "billing"}]
      }), null, {});
      app.importers.conversations.storeConversation(conversation({id: 502, tags: []}), null, {});

      expect(dwh.dimensions.conversations.rows({columns: ["id", "tags_list"], orderBy: "id"})).
        toEqual([{id: 501, tags_list: "vip, billing"}, {id: 502, tags_list: "(untagged)"}]);
    });

    // Help Scout answers the waiting time as an object, and older responses as the timestamp.
    test("stores how long the customer has been waiting, given either way", () => {
      app.importers.conversations.storeConversation(conversation({
        customerWaitingSince: {time: "2026-03-01T10:00:00Z", friendly: "2 hours ago"}
      }), null, {});

      expect(dwh.dimensions.conversations.rows({columns: ["customer_waiting_since"]})[0].
        customer_waiting_since.substring(0, 19)).toBe("2026-03-01T12:00:00");
      expect(app.importers.conversations.customerWaitingSince(
        conversation({customerWaitingSince: "2026-03-01T10:00:00Z"}))).
        toBe("2026-03-01T10:00:00Z");
      expect(app.importers.conversations.customerWaitingSince(conversation())).toBeNull();
    });
  });

  describe("importOne", () => {
    test("reports the conversation as failed instead of failing the import", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();
      mock.get("/v2/conversations/500/threads", {status: 404, json: {message: "Not found"}});
      var truncated = conversation({threads: 5, _embedded: {threads: []}});

      expect(app.importers.conversations.importOne(truncated, {})).toBe(0);

      expect(importRun.objectFailures()).toEqual(["conversation/500"]);
    });

    test("skips a draft conversation", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();

      expect(app.importers.conversations.importOne(
        conversation({state: "draft"}), {})).toBe(0);

      expect(dwh.measures.conversations.rows()).toEqual([]);
    });

    // The skip_conversations advanced setting names an exceptional conversation to leave out of the
    // import entirely, by its number — not its id, which the account owner does not see in Help Scout.
    test("skips a conversation named in the skip_conversations advanced setting", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();

      expect(app.importers.conversations.importOne(
        conversation({number: 50}), {skippedConversationNumbers: [50]})).toBe(0);

      expect(dwh.measures.conversations.rows()).toEqual([]);
    });
  });
});
