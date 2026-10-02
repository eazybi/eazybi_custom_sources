// The mocked Help Scout account: two inboxes, two agents, two customers, two conversations and one
// satisfaction rating. Conversation 123 was created by a customer, answered 2.5 hours later and
// closed a day after it was created; conversation 124 is still open and its embedded threads are
// short, so the importer has to fetch its threads separately.
function sumOf(rows, column) {
  return _.reduce(rows, (total, row) => total + (row[column] || 0), 0);
}

function mockHelpScout() {
  mock.sourceParams({oauth_client_id: "app-id", oauth_client_secret: "app-secret"});
  mock.sourceSelection(["13"]);
  mock.extraOptions({
    time_dimension_time_zone: "UTC",
    import_history: "0",
    import_messages: true,
    import_ratings: true
  });
  mock.get("/v2/mailboxes", {fixture: "mailboxes"});
  mock.get("/v2/users", {fixture: "users"});
  mock.get("/v2/customers", {fixture: "customers"});
  mock.get("/v2/conversations", {fixture: "conversations"});
  mock.get("/v2/conversations/124/threads", {fixture: "threads_124"});
  mock.get("/v2/reports/happiness/ratings", {fixture: "happiness_ratings"});
}

describe("app.importer.skippedConversationNumbers", () => {
  beforeEach(() => {
    mock.extraOptions({time_dimension_time_zone: "UTC"});
    importRun.prepare();
  });

  test("is empty while the skip_conversations advanced setting is not entered", () => {
    expect(app.importer.skippedConversationNumbers()).toEqual([]);
  });

  test("names the conversation numbers of the skip_conversations advanced setting", () => {
    mock.advancedSettings({skip_conversations: [4821, 5310]});

    expect(app.importer.skippedConversationNumbers()).toEqual([4821, 5310]);
  });

  // A TOML typo (a bare number or string instead of an array) leaves out nothing, rather than
  // failing every conversation of the import when `.indexOf` is called on a non-array value.
  test("is empty when the advanced setting is entered as something other than an array", () => {
    mock.advancedSettings({skip_conversations: 4821});
    expect(app.importer.skippedConversationNumbers()).toEqual([]);

    mock.advancedSettings({skip_conversations: "4821"});
    expect(app.importer.skippedConversationNumbers()).toEqual([]);
  });
});

describe("app.importer.importAll", () => {
  describe("of a full import", () => {
    beforeAll(() => {
      mockHelpScout();

      importRun.run();
    });

    test("imports the inboxes and the agents into every people dimension", () => {
      expect(dwh.dimensions.mailboxes.rows({columns: ["id", "name"], orderBy: "name"})).
        toEqual([{id: 14, name: "Sales"}, {id: 13, name: "Support"}]);
      expect(dwh.dimensions.assignees.rows({columns: ["assignee_key", "display_name"],
        orderBy: "assignee_key"})).toEqual([
          {assignee_key: "unassigned", display_name: null},
          {assignee_key: "user-14", display_name: "Clo Ser"},
          {assignee_key: "user-99", display_name: "Mr Robot"}
        ]);
      // Agent holds the staff members only — the customers who wrote in are not agents.
      expect(dwh.dimensions.agents.rows({columns: ["agent_key", "person_type"],
        orderBy: "agent_key"})).toEqual([
          {agent_key: "user-14", person_type: "User"},
          {agent_key: "user-99", person_type: "User"}
        ]);
    });

    test("names who created and who closed the conversation on the conversation itself", () => {
      expect(dwh.dimensions.conversations.rows({
        columns: ["id", "created_by_name", "closed_by_name"],
        orderBy: "id"})).toEqual([
          {id: 123, created_by_name: "Rob Robertovic", closed_by_name: "Clo Ser"},
          {id: 124, created_by_name: "Vernon Bear", closed_by_name: null}
        ]);
    });

    // Unlike Assignee, which is who a conversation is assigned to now, Closed By names who actually
    // closed it — every agent is seeded into it up front, and a conversation not closed yet is
    // grouped under its own "(not closed)" member.
    test("groups conversations by who actually closed them, apart from who they are assigned to", () => {
      expect(dwh.dimensions.closers.rows({columns: ["closed_by_key", "display_name"],
        orderBy: "closed_by_key"})).toEqual([
          {closed_by_key: "not_closed", display_name: null},
          {closed_by_key: "user-14", display_name: "Clo Ser"},
          {closed_by_key: "user-99", display_name: "Mr Robot"}
        ]);
      expect(olap.results(`
        SELECT [Closed By].[User].Members ON ROWS,
               {[Measures].[Conversations created]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([
          ["(not closed)", 1], ["Clo Ser", 1], ["Mr Robot", null]
        ]);
    });

    test("counts the messages of each conversation on the conversation member", () => {
      expect(dwh.dimensions.conversations.rows({
        columns: ["id", "messages_count", "customer_messages_count",
                  "agent_replies_count"],
        orderBy: "id"})).toEqual([
          // Conversation 123 also holds a note, which is neither a customer message nor a reply, and
          // does not count toward messages_count — only the customer message and the reply do.
          {id: 123, messages_count: 2, customer_messages_count: 1,
           agent_replies_count: 1},
          {id: 124, messages_count: 2, customer_messages_count: 1,
           agent_replies_count: 1}
        ]);
    });

    test("seeds the status, channel and source members and adds the ones it sees", () => {
      expect(dwh.dimensions.statuses.rows({columns: ["status_key", "name"], orderBy: "position"})).
        toEqual([
          {status_key: "active", name: "Active"},
          {status_key: "pending", name: "Pending"},
          {status_key: "open", name: "Open"},
          {status_key: "closed", name: "Closed"},
          {status_key: "spam", name: "Spam"}
        ]);
      expect(dwh.dimensions.channels.rows({columns: ["channel_key", "name"], orderBy: "name"})).
        toEqual([
          {channel_key: "chat", name: "Chat"},
          {channel_key: "email", name: "Email"},
          {channel_key: "phone", name: "Phone"}
        ]);
      // Source members are open ended and are created as the conversations bring them.
      expect(dwh.dimensions.source_types.rows({columns: ["source_type_key", "name"],
        orderBy: "source_type_key"})).toEqual([
          {source_type_key: "email", name: "Email"},
          {source_type_key: "web", name: "Web"}
        ]);
    });

    test("imports the customers with their organization", () => {
      expect(dwh.dimensions.customers.rows({
        columns: ["id", "display_name", "email", "organization_name"],
        orderBy: "id"})).toEqual([
          {id: 29418, display_name: "Vernon Bear", email: "vbear@mywork.com",
           organization_name: null},
          {id: 238604, display_name: "Rob Robertovic", email: "rob@acme.com",
           organization_name: "Acme Inc"}
        ]);
      expect(dwh.dimensions.organizations.rows({columns: ["id", "name"]})).
        toEqual([{id: 7001, name: "Acme Inc"}]);
    });

    test("imports the conversations and their tags as dimension members", () => {
      expect(dwh.dimensions.conversations.rows({
        columns: ["id", "number", "name", "status", "mailbox_name",
                  "threads_count"],
        orderBy: "number"})).toEqual([
          {id: 123, number: 12, name: "#12 Help", status: "Closed",
           mailbox_name: "Support", threads_count: 3},
          {id: 124, number: 13, name: "#13 Question", status: "Active",
           mailbox_name: "Support", threads_count: 2}
        ]);
      expect(dwh.dimensions.tags.rows({columns: ["name", "id"], orderBy: "name"})).
        toEqual([{name: "(untagged)", id: -1}, {name: "billing", id: 9151}, {name: "vip", id: 9150}]);
    });

    test("counts the conversations, the messages and the ratings", () => {
      // 123: created 08:00 and first replied 10:30 on Mar 1, updated and closed on Mar 2.
      // 124: created, updated and first replied within the same hour of Mar 3 — the events of one
      // hour of one day share a row.
      var conversationRows = dwh.measures.conversations.rows();
      expect(conversationRows).toHaveLength(4);
      expect(sumOf(conversationRows, "conversations_created")).toBe(2);
      expect(sumOf(conversationRows, "conversations_updated")).toBe(2);
      expect(sumOf(conversationRows, "conversations_closed")).toBe(1);

      // One message row per author, day and hour — the reply and the note of conversation 123
      // were written by the same agent on the same day, but in two different hours. The note does
      // not count toward conversation_messages_created, only toward its own notes_created.
      var messageRows = dwh.measures.conversations_messages.rows();
      expect(messageRows).toHaveLength(5);
      expect(sumOf(messageRows, "conversation_messages_created")).toBe(4);
      expect(sumOf(messageRows, "customer_messages_created")).toBe(2);
      expect(sumOf(messageRows, "agent_replies_created")).toBe(2);
      expect(sumOf(messageRows, "notes_created")).toBe(1);
      expect(sumOf(messageRows, "attachments_created")).toBe(1);

      expect(dwh.measures.conversations_ratings.rows({
        columns: ["_source_id", "_source_name", "ratings", "great_ratings", "not_good_ratings"]})).
        toEqual([{_source_id: "1002", _source_name: "custom_helpscout rating", ratings: 1,
                  great_ratings: 1, not_good_ratings: 0}]);
    });

    test("measures the first reply and the closing hours", () => {
      var conversationRows = dwh.measures.conversations.rows();
      // 2.5 hours for conversation 123 and 15 minutes for conversation 124.
      expect(sumOf(conversationRows, "conversations_with_first_reply")).toBe(2);
      expect(sumOf(conversationRows, "first_reply_hours")).toBeCloseTo(2.75);
      // Conversation 123 was closed a day after it was created.
      expect(sumOf(conversationRows, "closing_hours")).toBeCloseTo(24);
    });

    // Help Scout counts a conversation as resolved only when the team answered it before it was
    // closed, and measures the wait before every reply and not only before the first one.
    test("measures the resolutions and the response times", () => {
      var conversationRows = dwh.measures.conversations.rows();
      // Conversation 123 is the only closed one, and its one reply resolved it.
      expect(sumOf(conversationRows, "conversations_resolved")).toBe(1);
      expect(sumOf(conversationRows, "conversations_resolved_on_first_reply")).toBe(1);
      // The note of conversation 123 does not count toward closed_messages_count.
      expect(sumOf(conversationRows, "closed_messages_count")).toBe(2);

      // Each conversation has one reply, which answers the customer message before it.
      var messageRows = dwh.measures.conversations_messages.rows();
      expect(sumOf(messageRows, "agent_replies_with_response")).toBe(2);
      expect(sumOf(messageRows, "response_hours")).toBeCloseTo(2.75);
    });

    test("joins a conversation to each of its tags through the bridge table", () => {
      // Both tags of conversation 123 under one bridge id, and the untagged conversation 124 under
      // the "(untagged)" member instead of an empty set, so it stays visible grouped by Tag.
      expect(dwh.dimensions.tags.rows({columns: ["id", "name"], orderBy: "id"})).toEqual([
        {id: -1, name: "(untagged)"},
        {id: 9150, name: "vip"},
        {id: 9151, name: "billing"}
      ]);
      expect(dwh.dimensions.tags_bt.rows({columns: ["_bt_id", "tag_id"], orderBy: "tag_id"})).
        toEqual([
          {_bt_id: "-1", tag_id: -1},
          {_bt_id: "9150,9151", tag_id: 9150},
          {_bt_id: "9150,9151", tag_id: 9151}
        ]);
      var rowsOf123 = _.filter(
        dwh.measures.conversations.rows({columns: ["_source_id", "tag_bt_id"]}),
        (row) => row._source_id === "123");
      expect(_.uniq(_.map(rowsOf123, (row) => row.tag_bt_id))).toEqual(["9150,9151"]);
      var rowsOf124 = _.filter(
        dwh.measures.conversations.rows({columns: ["_source_id", "tag_bt_id"]}),
        (row) => row._source_id === "124");
      expect(_.uniq(_.map(rowsOf124, (row) => row.tag_bt_id))).toEqual(["-1"]);
    });

    test("stores the incremental import mark of a clean import", () => {
      expect(typeof importRun.maxParams().modified_at).toBe("string");
      expect(importRun.objectFailures()).toEqual([]);
      // The conversations of each selected inbox are imported on their own, so the status message
      // names the inbox. The count is reported after every page and the percentage is the share of
      // the total Help Scout answered for the whole selection, so both keep moving through a large
      // inbox instead of standing still until the inbox is done.
      expect(importRun.statusMessages()).toContain("Importing customers (0%)");
      expect(importRun.statusMessages()).toContain("Importing customers, 2 imported of 2 (100%)");
      expect(importRun.statusMessages()).toContain("Importing conversations of Support (0%)");
      expect(importRun.statusMessages()).
        toContain("Importing conversations of Support, 2 imported of 2 (100%)");
    });
  });

  describe("of an import with custom fields selected", () => {
    // `mock.customFields` builds the selection with `getAvailableCustomFields`, which requests the
    // fields of the inbox itself — only the requests of the import are counted.
    var importRequests = 0;

    // Leave the schema of the run without the custom field columns for the tests that follow.
    afterAll(() => mock.customFields({}));

    beforeAll(() => {
      mockHelpScout();
      mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});
      // Priority as a dimension and a property, Order value as all three, Renewal date as a
      // property only.
      mock.customFields({
        "104": {property: true, dimension: true},
        "106": {property: true, dimension: true, measure: true},
        "107": {property: true}
      });
      var requestsBefore = _.filter(mock.requestedPaths(),
        (path) => path === "/v2/mailboxes/13/fields").length;

      importRun.run();

      importRequests = _.filter(mock.requestedPaths(),
        (path) => path === "/v2/mailboxes/13/fields").length - requestsBefore;
    });

    test("stores the custom field values as conversation properties", () => {
      expect(dwh.dimensions.conversations.rows({
        columns: ["id", "cf_104", "cf_106", "cf_107"], orderBy: "id"})).
        toEqual([
          {id: 123, cf_104: "High", cf_106: 250, cf_107: "2026-04-01"},
          {id: 124, cf_104: "Whenever", cf_106: 125.5, cf_107: null}
        ]);
    });

    test("imports the dropdown options as ordered dimension members", () => {
      expect(dwh.dimensions.cf_104.rows({columns: ["value_key", "name"], orderBy: "position"})).
        toEqual([
          {value_key: "(none)", name: "(none)"},
          {value_key: "168", name: "High"},
          {value_key: "169", name: "Medium"},
          {value_key: "170", name: "Low"},
          // Conversation 124 carries an option the inbox does not define anymore.
          {value_key: "999", name: "Whenever"}
        ]);
      expect(importRequests).toBe(1);
    });

    test("references the custom field member from every fact row of the conversation", () => {
      var highId = dwh.dimensions.cf_104.lookupId({value_key: "168"});
      var rowsOf = (rows) => _.filter(rows, (row) => row._source_id === "123");

      expect(_.uniq(_.map(rowsOf(dwh.measures.conversations.rows({
        columns: ["_source_id", "cf_104_id"]})), (row) => row.cf_104_id))).toEqual([highId]);
      expect(_.uniq(_.map(rowsOf(dwh.measures.conversations_messages.rows({
        columns: ["_source_id", "cf_104_id"]})), (row) => row.cf_104_id))).toEqual([highId]);
      expect(_.uniq(_.map(dwh.measures.conversations_ratings.rows({
        columns: ["cf_104_id"]}), (row) => row.cf_104_id))).toEqual([highId]);
    });

    test("sums a numeric custom field once per conversation", () => {
      // 250 of conversation 123 and 125.50 of conversation 124, each on its created row only.
      var rows = dwh.measures.conversations.rows();
      expect(sumOf(rows, "cf_106")).toBeCloseTo(375.5);
      expect(_.filter(rows, (row) => row.cf_106)).toHaveLength(2);
      expect(importRun.statusMessages()).toContain("Importing custom fields");
    });

    test("answers a report grouped by the custom field", () => {
      expect(olap.results(`
        SELECT [Priority].[Priority].Members ON ROWS,
               {[Measures].[Conversations created], [Measures].[Order value]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([
          ["(none)", null, null],
          ["High", 1, 250],
          ["Medium", null, null],
          ["Low", null, null],
          ["Whenever", 1, 125.5]
        ]);
    });
  });

  describe("of an import that changes what is imported", () => {
    beforeEach(mockHelpScout);

    test("imports no message rows when the option is off", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_history: "0",
        import_messages: false, import_ratings: true});

      importRun.run();

      expect(dwh.measures.conversations_messages.rows()).toEqual([]);
      expect(dwh.measures.conversations.rows()).toHaveLength(4);
      // The message counts of a conversation are read from the threads it was fetched with, so
      // they are there also when the messages themselves are not imported.
      expect(dwh.dimensions.conversations.rows({columns: ["messages_count"],
        orderBy: "id"})).toEqual([{messages_count: 2}, {messages_count: 2}]);
    });

    // Conversation 123 is number 12, conversation 124 is number 13 — named by number, the way the
    // account owner sees it in Help Scout, not by the internal id.
    // Conversation 123 (number 12) also has a satisfaction rating in the fixture — skipping the
    // conversation must leave its already fetched rating out too, not import it afterwards with a
    // fallback conversation lookup once the main sweep is done with it.
    test("leaves out a conversation named in the skip_conversations advanced setting", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_history: "0",
        import_messages: true, import_ratings: true});
      mock.advancedSettings({skip_conversations: [12]});

      importRun.run();

      expect(dwh.dimensions.conversations.rows({columns: ["id"]})).toEqual([{id: 124}]);
      expect(dwh.measures.conversations_ratings.rows()).toEqual([]);
    });

    test("does not request the happiness report when the option is off", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_history: "0",
        import_messages: true, import_ratings: false});

      importRun.run();

      expect(mock.requestedPaths()).not.toContain("/v2/reports/happiness/ratings");
      expect(dwh.measures.conversations_ratings.rows()).toEqual([]);
    });

    test("limits the first import to the chosen history", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_history: "3",
        import_messages: true, import_ratings: true});

      importRun.run();

      var conversationRequest = _.find(mock.requests(),
        (request) => request.path === "/v2/conversations");
      // Help Scout rejects a `modifiedSince` that carries milliseconds with HTTP 400.
      expect(conversationRequest.params.modifiedSince).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    });

    test("requests the happiness report and stores the mark without milliseconds", () => {
      mock.extraOptions({time_dimension_time_zone: "UTC", import_history: "3",
        import_messages: true, import_ratings: true});

      importRun.run();

      var secondsOnly = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
      var ratingsRequest = _.find(mock.requests(),
        (request) => request.path === "/v2/reports/happiness/ratings");
      expect(ratingsRequest.params.start).toMatch(secondsOnly);
      expect(ratingsRequest.params.end).toMatch(secondsOnly);
      expect(importRun.maxParams().modified_at).toMatch(secondsOnly);
    });

    test("continues from the stored mark on an incremental import", () => {
      mock.maxParams({modified_at: "2026-03-02T00:00:00Z"});

      importRun.run();

      var conversationRequest = _.find(mock.requests(),
        (request) => request.path === "/v2/conversations");
      expect(conversationRequest.params.modifiedSince).toBe("2026-03-02T00:00:00Z");
    });

    test("truncates the milliseconds of a stored mark left by an older version", () => {
      mock.maxParams({modified_at: "2026-03-02T00:00:00.936Z"});

      importRun.run();

      var conversationRequest = _.find(mock.requests(),
        (request) => request.path === "/v2/conversations");
      expect(conversationRequest.params.modifiedSince).toBe("2026-03-02T00:00:00Z");
    });

    test("ignores the stored mark on a reimport", () => {
      mock.maxParams({modified_at: "2026-03-02T00:00:00Z"});

      importRun.run({reimport: true});

      var conversationRequest = _.find(mock.requests(),
        (request) => request.path === "/v2/conversations");
      expect(conversationRequest.params.modifiedSince).toBeUndefined();
    });

    test("keeps the mark unstored when a conversation failed", () => {
      mock.get("/v2/conversations/124/threads", {status: 404, json: {message: "Not found"}});

      importRun.run();

      expect(importRun.objectFailures()).toEqual(["conversation/124"]);
      expect(importRun.maxParams().modified_at).toBeUndefined();
    });
  });

  describe("queried with MDX", () => {
    beforeAll(() => {
      mockHelpScout();
      // Conversation 124 without a subject is named by its number and "(no subject)".
      var conversations = mock.fixture("conversations");
      delete _.find(conversations._embedded.conversations, (one) => one.id === 124).subject;
      mock.get("/v2/conversations", {json: conversations});

      importRun.run();
    });

    test("names the members the importer stored without a name", () => {
      expect(dwh.dimensions.conversations.rows({columns: ["id", "name"],
        orderBy: "number"})).toEqual([
          {id: 123, name: "#12 Help"},
          {id: 124, name: "#13 (no subject)"}
        ]);
      expect(olap.results(`
        SELECT [Conversation].[Conversation].Members ON ROWS,
               {[Measures].[Conversations created]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([["#12 Help", 1], ["#13 (no subject)", 1]]);
      expect(olap.results(`
        SELECT [Assignee].[Assignee].Members ON ROWS,
               {[Measures].[Conversations created]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([["(unassigned)", 1], ["Clo Ser", null], ["Mr Robot", 1]]);
    });

    test("counts every conversation event in the Time period of its own timestamp", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Time].[Day].Members ON ROWS,
               {[Measures].[Conversations created], [Measures].[Conversations closed],
                [Measures].[Conversation messages created], [Measures].[Ratings]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([
          ["Mar 01 2026", 1, null, 2, null],
          ["Mar 02 2026", null, 1, null, 1],
          ["Mar 03 2026", 1, null, 2, null]
        ]);
    });

    test("calculates the averages and the happiness score", () => {
      expect(olap.results(`
        SELECT [Inbox].[Inbox].Members ON ROWS,
               {[Measures].[Conversations created], [Measures].[Average first reply hours],
                [Measures].[Average closing hours], [Measures].[Average response hours],
                [Measures].[Happiness score]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([
          ["Sales", null, null, null, null, null],
          ["Support", 2, 1.375, 24, 1.375, 1]
        ]);
    });

    // The two customer counts count each customer once however many conversations or replies they
    // have, which is what makes them different from the conversation counts.
    test("counts the customers of the period and the ones the team answered", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Time].[Day].Members ON ROWS,
               {[Measures].[Customers], [Measures].[Customers helped]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([
          ["Mar 01 2026", 1, 1],
          ["Mar 02 2026", 1, null],
          ["Mar 03 2026", 1, 1]
        ]);
      expect(olap.results(`
        SELECT [Time].[All Times] ON ROWS,
               {[Measures].[Customers], [Measures].[Customers helped]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([["All Times", 2, 2]]);
    });

    test("counts an event in the hour of the day of its own timestamp", () => {
      expect(olap.results(`
        SELECT NON EMPTY [Hour].[Hour].Members ON ROWS,
               {[Measures].[Conversations created], [Measures].[Conversations closed],
                [Measures].[Conversations with first reply]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([
          ["08", 1, 1, null],
          ["09", 1, null, 1],
          ["10", null, null, 1]
        ]);
    });

    // The all members are what the page filters of the sample reports and of the sample dashboard
    // show as the unfiltered choice, so their names stay as the users of the reports read them.
    test("names the all members of the dimensions", () => {
      var allMembers = {
        Agent: "All Agents", Assignee: "All Assignees", "Closed By": "All Closers", Hour: "All Hours",
        Inbox: "All Inboxes", Tag: "All Tags",
        Status: "All Statuses", Channel: "All Channels", Source: "All Sources",
        Customer: "All Customers", Organization: "All Organizations",
        "First reply interval": "All First reply intervals",
        "Closing interval": "All Closing intervals"
      };

      for (let dimension in allMembers) {
        expect(olap.results(`
          SELECT {[${dimension}].[${allMembers[dimension]}]} ON ROWS,
                 {[Measures].[Conversations created]} ON COLUMNS
          FROM [Help Scout]`)).toEqual([[allMembers[dimension], 2]]);
      }
    });

    // The message count is bucketed like the two durations are — it shares the `messages_count`
    // column of the Conversation dimension and adds no fact table column of its own, so the buckets
    // have to add up to the same conversations the measures count.
    test("buckets the conversations by how many messages passed between the customer and the team",
      () => {
        // Conversation 123 holds 3 threads, but one is an internal note — it buckets by 2 messages,
        // the same as conversation 124, which holds no note. A step of one message names each bucket
        // by the count itself.
        expect(olap.results(`
          SELECT NON EMPTY [Message count interval].[Message count interval].Members ON ROWS,
                 {[Measures].[Conversations created], [Measures].[Conversations closed]} ON COLUMNS
          FROM [Help Scout]`)).toEqual([["02 - 02", 2, 1]]);
      });

    // Help Scout counts a conversation as resolved only when the team answered it before it was
    // closed — the closed conversations that were never answered are the difference.
    test("calculates the resolutions of the closed conversations", () => {
      expect(olap.results(`
        SELECT [Time].[All Times] ON ROWS,
               {[Measures].[Conversations closed], [Measures].[Conversations resolved],
                [Measures].[Conversations closed without reply],
                [Measures].[Resolved on first reply %],
                [Measures].[Average messages per closed conversation]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([["All Times", 1, 1, 0, 1, 2]]);
    });

    // The interval dimensions are joined through the Conversation dimension foreign key of the fact
    // rows, so the buckets have to add up to the same conversations the measures count.
    test("buckets the durations into the interval dimensions", () => {
      // Conversation 124 replied after 15 minutes, conversation 123 after 2.5 hours — both under
      // the first "6,12,24" boundary, so they share the same bucket.
      expect(olap.results(`
        SELECT NON EMPTY [First reply interval].[First reply interval].Members ON ROWS,
               {[Measures].[Conversations with first reply]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([["... - 05", 2]]);
      // Conversation 123 was closed a day after it was created, 124 is still open.
      expect(olap.results(`
        SELECT NON EMPTY [Closing interval].[Closing interval].Members ON ROWS,
               {[Measures].[Conversations created], [Measures].[Conversations closed]} ON COLUMNS
        FROM [Help Scout]`)).toEqual([["(none)", 1, null], ["01 - 01", 1, 1]]);
    });
  });
});
