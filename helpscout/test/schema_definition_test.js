describe("app.defineSchema", () => {
  test("defines one cube named after the application", () => {
    expect(schema.cubes()).toEqual(["Help Scout"]);
  });

  test("defines the dimensions, with Inbox and Conversation first", () => {
    expect(schema.dimensions()).toEqual([
      "Agent", "Assignee", "Channel", "Closed By", "Closing interval", "Conversation", "Customer",
      "First reply interval", "Hour", "Inbox", "Message count interval", "Organization",
      "Source", "Status", "Tag", "Time", "Week Day"
    ]);
  });

  // The interval dimensions share the Conversation dimension table and add no fact table column of
  // their own, so they need no importer beyond the raw minutes on the dimension member.
  test("buckets the conversation durations into interval dimensions", () => {
    expect(schema.dimension("First reply interval").levels()).toEqual(["First reply interval"]);
    expect(schema.dimension("Closing interval").levels()).toEqual(["Closing interval"]);
    // The message count is a count and not a duration, but it is bucketed the same way.
    expect(schema.dimension("Message count interval").levels()).
      toEqual(["Message count interval"]);
  });

  // The dimensions are not defined by default — the dimension list above has none of them. A dimension
  // stays in the cube once it was added, therefore this test is not followed by one that deselects the
  // option again.
  test("buckets the durations within the office hours into interval dimensions when they are used", () => {
    // Rebuilds the schema of the run with the import option set — mock.extraOptions alone does not,
    // mock.customFields does, and it reads the fields of the selected inboxes.
    mock.extraOptions({use_office_hours: true});
    mock.sourceSelection(["13"]);
    mock.get("/v2/mailboxes", {fixture: "mailboxes"});
    mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});
    mock.customFields({});

    expect(schema.dimensions()).toContain("First reply office hours interval");
    expect(schema.dimensions()).toContain("Closing office hours interval");
    expect(schema.dimension("Closing office hours interval").levels()).
      toEqual(["Closing office hours interval"]);
  });

  test("shows the conversation number as the member key and the subject as the name", () => {
    var properties = schema.dimension("Conversation").level("Conversation").properties();
    ["Status", "Created at", "Updated at", "Waiting since", "Created by", "Closed by", "Assignee",
     "Tags", "Messages", "Customer messages", "Agent replies"].forEach((name) =>
      expect(properties).toContain(name));
  });

  test("defines the conversation measures", () => {
    var measures = schema.measures();
    expect(measures).toContain("Conversations created");
    expect(measures).toContain("Conversations updated");
    expect(measures).toContain("Conversations closed");
    expect(measures).toContain("First reply hours");
    expect(measures).toContain("Closing hours");
    expect(measures).toContain("First reply office hours");
    expect(measures).toContain("Closing office hours");
    expect(measures).toContain("Conversations resolved");
    expect(measures).toContain("Conversations resolved on first reply");
    expect(measures).toContain("Customers");
  });

  test("defines the message and rating measures", () => {
    var measures = schema.measures();
    expect(measures).toContain("Conversation messages created");
    expect(measures).toContain("Customer messages created");
    expect(measures).toContain("Agent replies created");
    expect(measures).toContain("Notes created");
    expect(measures).toContain("Customers helped");
    expect(measures).toContain("Response hours");
    expect(measures).toContain("Response office hours");
    expect(measures).toContain("Agent replies with response time");
    expect(measures).toContain("Ratings");
    expect(measures).toContain("Great ratings");
  });

  describe("with custom fields selected", () => {
    // Leave the schema of the run without the custom field columns for the tests that follow.
    afterAll(() => mock.customFields({}));

    function selectCustomFields(selection, mailboxIds) {
      mock.sourceSelection(mailboxIds || ["13"]);
      mock.get("/v2/mailboxes", {fixture: "mailboxes"});
      mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});
      mock.get("/v2/mailboxes/14/fields", {fixture: "mailbox_fields_14"});
      mock.customFields(selection);
    }

    test("adds the selected fields as properties, dimensions and measures", () => {
      selectCustomFields({
        "104": {property: true, dimension: true},
        "106": {property: true, measure: true},
        "107": {property: true},
        "108": {property: true}
      });

      var properties = schema.dimension("Conversation").level("Conversation").properties();
      ["Priority", "Order value", "Renewal date", "Internal notes"].forEach((name) =>
        expect(properties).toContain(name));
      expect(schema.dimensions()).toContain("Priority");
      // A field selected only as a property gets no dimension of its own.
      expect(schema.dimensions()).not.toContain("Renewal date");
      expect(schema.measures()).toContain("Order value");
    });

    test("gives every field selected as a property its own property measure", () => {
      selectCustomFields({
        "104": {property: true, dimension: true},
        "106": {property: true, measure: true},
        "107": {property: true}
      });

      var calculatedMembers = schema.calculatedMembers();
      ["Conversation Priority", "Conversation Order value", "Conversation Renewal date"].
        forEach((name) => expect(calculatedMembers).toContain(`[Measures].[${name}]`));
      // A field selected as a measure keeps both: the summed measure and its property measure.
      expect(schema.measures()).toContain("Order value");
    });

    test("removes the property measure of a field that is deselected again", () => {
      selectCustomFields({"107": {property: true}});
      expect(schema.calculatedMembers()).toContain("[Measures].[Conversation Renewal date]");

      mock.customFields({});

      expect(schema.calculatedMembers()).not.toContain("[Measures].[Conversation Renewal date]");
    });

    test("appends the inbox to a name another selected field or a dimension already has", () => {
      selectCustomFields({
        "104": {dimension: true},
        "204": {dimension: true},
        "205": {property: true}
      }, ["13", "14"]);

      expect(schema.dimensions()).toContain("Priority (Support)");
      expect(schema.dimensions()).toContain("Priority (Sales)");
      expect(schema.dimensions()).not.toContain("Priority");
      // "Status" is a dimension and a Conversation property of this cube already.
      expect(schema.dimension("Conversation").level("Conversation").properties()).
        toContain("Status (Sales)");
    });

    test("defines nothing of a field that is deselected again", () => {
      selectCustomFields({"104": {property: true, dimension: true}});
      expect(schema.dimensions()).toContain("Priority");

      mock.customFields({});

      expect(schema.dimensions()).not.toContain("Priority");
      expect(schema.dimension("Conversation").level("Conversation").properties()).
        not.toContain("Priority");
    });
  });

  test("gives every Conversation property a property measure", () => {
    var calculatedMembers = schema.calculatedMembers();
    // URL_ID and DISPLAY_KEY are the member link and key, not values to show as a measure.
    var properties = schema.dimension("Conversation").level("Conversation").properties().
      filter((name) => name !== "URL_ID" && name !== "DISPLAY_KEY");
    expect(properties).toContain("Status");
    expect(properties).toContain("Agent replies");
    properties.forEach((name) =>
      expect(calculatedMembers).toContain(`[Measures].[Conversation ${name}]`));
  });

  test("defines the average and happiness calculated members", () => {
    var calculatedMembers = schema.calculatedMembers();
    ["Average first reply hours", "Average closing hours", "Average first reply office hours",
     "Average closing office hours", "Average response hours", "Average response office hours",
     "Average messages per closed conversation", "Conversations closed without reply",
     "Resolved on first reply %", "Happiness score", "% great ratings", "% okay ratings",
     "% not good ratings"].forEach((name) =>
      expect(calculatedMembers).toContain(`[Measures].[${name}]`));
  });
});
