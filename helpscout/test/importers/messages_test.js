describe("app.importers.messages", () => {
  function thread(attributes) {
    return app.importers.rows.merge({
      id: 1, type: "message", state: "published", createdAt: "2026-03-01T10:00:00Z",
      createdBy: {id: 99, type: "user", first: "Mr", last: "Robot"}
    }, attributes || {});
  }

  var conversation = {id: 500, number: 50, createdAt: "2026-03-01T08:00:00Z",
                      userUpdatedAt: "2026-03-01T12:00:00Z"};

  describe("measureColumnOf", () => {
    test("classifies a thread by its type and by who wrote it", () => {
      var expected = {
        notes_created: thread({type: "note"}),
        agent_replies_created: thread(),
        customer_messages_created: thread({type: "customer"})
      };

      for (let measureColumn in expected) {
        expect(app.importers.messages.measureColumnOf(expected[measureColumn])).
          toBe(measureColumn);
      }
      // A chat or a phone thread comes from either side, so its author decides the direction.
      expect(app.importers.messages.measureColumnOf(
        thread({type: "chat", createdBy: {id: 5, type: "customer"}}))).
        toBe("customer_messages_created");
      expect(app.importers.messages.measureColumnOf(thread({type: "chat"}))).
        toBe("agent_replies_created");
    });
  });

  describe("buildRows", () => {
    beforeEach(() => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();
    });

    test("merges the threads of one author, day and hour into one row", () => {
      var threads = [
        thread({id: 1, createdAt: "2026-03-01T10:00:00Z",
                _embedded: {attachments: [{id: 1}, {id: 2}]}}),
        thread({id: 2, type: "note", createdAt: "2026-03-01T10:30:00Z"}),
        thread({id: 3, type: "customer", createdAt: "2026-03-01T09:00:00Z",
                createdBy: {id: 5, type: "customer", first: "Vernon", last: "Bear"}})
      ];

      var rows = app.importers.messages.buildRows(conversation, {}, threads);

      expect(rows).toHaveLength(2);
      var agentRow = _.find(rows, (row) => row.agent_replies_created === 1);
      // The note merged into this row does not count toward conversation_messages_created.
      expect(agentRow.conversation_messages_created).toBe(1);
      expect(agentRow.notes_created).toBe(1);
      expect(agentRow.attachments_created).toBe(2);
      var customerRow = _.find(rows, (row) => row.customer_messages_created === 1);
      expect(customerRow.conversation_messages_created).toBe(1);
      expect(customerRow.attachments_created).toBe(0);
    });

    // March 2 2026 is a Monday, and the default office hours are 09:00 to 18:00. Two agent replies
    // by the same author in the same hour merge into one row — their response times, calendar and
    // office, must both accumulate rather than the second overwriting the first.
    test("accumulates the response time within the office hours when several replies merge into one row",
      () => {
        mock.extraOptions({time_dimension_time_zone: "UTC"});
        var officeHours = {schedule: app.importers.officeHours.schedule()};
        var threads = [
          thread({id: 1, type: "customer", createdAt: "2026-03-02T08:00:00Z",
                  createdBy: {id: 5, type: "customer"}}),
          thread({id: 2, createdAt: "2026-03-02T10:00:00Z"}),
          thread({id: 3, type: "customer", createdAt: "2026-03-02T10:15:00Z",
                  createdBy: {id: 5, type: "customer"}}),
          thread({id: 4, createdAt: "2026-03-02T10:45:00Z"})
        ];

        var rows = app.importers.messages.buildRows(conversation, {}, threads, officeHours);

        var agentRow = _.find(rows, (row) => row.agent_replies_with_response === 2);
        // 08:00-10:00 is 2 calendar hours but only 1 office hour (09:00-10:00); 10:15-10:45 is the
        // same 0.5 hours either way, fully inside the office day.
        expect(agentRow.response_hours).toBe(2.5);
        expect(agentRow.response_office_hours).toBe(1.5);
      });

    // Agent counts the work of the team, so only a staff member is one — the person who wrote a
    // customer message is the customer the Customer dimension of the same row already names.
    test("names the staff member who wrote a message and no customer", () => {
      var threads = [
        thread({id: 1, createdAt: "2026-03-01T10:00:00Z"}),
        thread({id: 2, type: "customer", createdAt: "2026-03-01T09:00:00Z",
                createdBy: {id: 5, type: "customer", first: "Vernon", last: "Bear"}})
      ];

      var rows = app.importers.messages.buildRows(conversation, {}, threads);

      expect(_.find(rows, (row) => row.agent_replies_created === 1).agent_id).toBeDefined();
      expect(_.find(rows, (row) => row.customer_messages_created === 1).agent_id).toBeNull();
      expect(dwh.dimensions.agents.rows({columns: ["agent_key"]})).
        toEqual([{agent_key: "user-99"}]);
      // v2 reports an AI powered system user as a plain user — it is a staff member too.
      expect(app.importers.messages.agentIdOf({id: 7, type: "system_user"})).not.toBeNull();
      expect(app.importers.messages.agentIdOf({id: 5, type: "customer"})).toBeNull();
      expect(app.importers.messages.agentIdOf(null)).toBeNull();
    });

    test("skips the line items and the unpublished threads", () => {
      var threads = [thread({type: "lineitem"}), thread({state: "draft"})];

      expect(app.importers.messages.buildRows(conversation, {}, threads)).toEqual([]);
    });

    // The customer of the conversation counts as helped once the team answered them, however many
    // replies they got — the distinct count of the column is what counts each of them once.
    test("names the customer the team answered on the rows that carry a reply", () => {
      var threads = [
        thread({id: 1, type: "customer", createdAt: "2026-03-01T09:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 2, createdAt: "2026-03-01T10:00:00Z"})
      ];

      var rows = app.importers.messages.buildRows(conversation, {customer_id: 77}, threads);

      expect(_.find(rows, (row) => row.agent_replies_created === 1).replied_customer_id).toBe(77);
      expect(_.find(rows, (row) => row.customer_messages_created === 1).replied_customer_id).
        toBeUndefined();
    });
  });

  // Help Scout measures the wait before every reply and not only before the first one.
  describe("responseHoursOf", () => {
    test("measures the wait before each reply from the customer message it answers", () => {
      var threads = [
        thread({id: 1, type: "customer", createdAt: "2026-03-01T08:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 2, createdAt: "2026-03-01T10:00:00Z"}),
        thread({id: 3, type: "customer", createdAt: "2026-03-01T12:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 4, createdAt: "2026-03-01T12:30:00Z"})
      ];

      expect(app.importers.messages.responseHoursOf(threads)).toEqual({2: {hours: 2}, 4: {hours: 0.5}});
    });

    test("measures the wait from the earliest message the customer is still waiting on", () => {
      var threads = [
        thread({id: 1, type: "customer", createdAt: "2026-03-01T08:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 2, type: "customer", createdAt: "2026-03-01T09:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 3, createdAt: "2026-03-01T10:00:00Z"})
      ];

      expect(app.importers.messages.responseHoursOf(threads)).toEqual({3: {hours: 2}});
    });

    // March 2 2026 is a Monday, March 3 is a Tuesday, and the default office hours are 09:00 to
    // 18:00 from Monday to Friday: 2 hours left on Monday plus 1 hour into Tuesday.
    test("also measures the wait within the office hours, when they are used", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      var officeHours = {schedule: app.importers.officeHours.schedule()};
      var threads = [
        thread({id: 1, type: "customer", createdAt: "2026-03-02T16:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 2, createdAt: "2026-03-03T10:00:00Z"})
      ];

      expect(app.importers.messages.responseHoursOf(threads, officeHours)).
        toEqual({2: {hours: 18, officeHours: 3}});
    });

    test("measures nothing for a reply nobody is waiting for", () => {
      // The team writing again, and the outbound conversation an agent started.
      var followUp = [
        thread({id: 1, type: "customer", createdAt: "2026-03-01T08:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 2, createdAt: "2026-03-01T10:00:00Z"}),
        thread({id: 3, createdAt: "2026-03-01T11:00:00Z"})
      ];

      expect(app.importers.messages.responseHoursOf(followUp)).toEqual({2: {hours: 2}});
      expect(app.importers.messages.responseHoursOf([thread()])).toEqual({});
      // A note is not a reply and answers nobody.
      expect(app.importers.messages.responseHoursOf([
        thread({id: 1, type: "customer", createdAt: "2026-03-01T08:00:00Z",
                createdBy: {id: 5, type: "customer"}}),
        thread({id: 2, type: "note", createdAt: "2026-03-01T09:00:00Z"})
      ])).toEqual({});
    });
  });

  describe("countsOf", () => {
    test("counts the messages, the customer messages and the replies", () => {
      var threads = [
        thread({id: 1, type: "customer", createdBy: {id: 5, type: "customer"}}),
        thread({id: 2}),
        thread({id: 3, type: "note"}),
        thread({id: 4, type: "lineitem"}),
        thread({id: 5, state: "draft"})
      ];

      // A note does not count toward messages, only the customer message and the reply do; a line
      // item and an unpublished draft are not messages at all.
      expect(app.importers.messages.countsOf(threads)).
        toEqual({messages: 2, customerMessages: 1, agentReplies: 1});
      expect(app.importers.messages.countsOf([])).
        toEqual({messages: 0, customerMessages: 0, agentReplies: 0});
    });
  });

  describe("importAllOf", () => {
    beforeEach(() => {
      mock.extraOptions({time_dimension_time_zone: "UTC"});
      importRun.prepare();
    });

    test("replaces the message rows of the conversation on the next import", () => {
      app.importers.messages.importAllOf(conversation, {}, [thread({id: 1})]);
      expect(dwh.measures.conversations_messages.rows()).toHaveLength(1);

      importRun.prepare();
      app.importers.messages.importAllOf(conversation, {}, []);

      expect(dwh.measures.conversations_messages.rows()).toEqual([]);
    });
  });
});
