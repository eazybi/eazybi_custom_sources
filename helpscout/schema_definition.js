app.defineSchema((schema) => {
  var dimension = schema.dimension, timeDimension = schema.timeDimension,
      weekDayDimension = schema.weekDayDimension, cube = schema.cube, expr = schema.expr;

  var importMessages = source.getExtraOption("import_messages");
  var importRatings = source.getExtraOption("import_ratings");
  var useOfficeHours = source.getExtraOption("use_office_hours") === true;

  // The custom fields the user selected on the Custom fields tab. Everything derived from them is
  // named `cf_{key}`, which is what lets eazyBI remove the columns, the dimension tables and their
  // data again when a field is deselected. The list is empty when the type is installed and when a
  // source application has not been configured yet, so the schema must be valid without it.
  var customFields = source.getCustomFields();

  // The Conversation level properties a report or a drill through list of conversations shows next to
  // the measures of each conversation, and the format each is displayed in. Each gets a property
  // measure named "Conversation {property}" in the "Conversation properties" group below.
  var DATETIME_FORMAT = "mmm dd yyyy hh:nn";
  var CONVERSATION_PROPERTIES = [
    {name: "Status"}, {name: "Channel"}, {name: "Inbox"}, {name: "State"}, {name: "Source via"},
    {name: "Customer email"},
    {name: "Created at", formatString: DATETIME_FORMAT},
    {name: "Closed at", formatString: DATETIME_FORMAT},
    {name: "Updated at", formatString: DATETIME_FORMAT},
    {name: "Waiting since", formatString: DATETIME_FORMAT},
    {name: "Threads", formatString: "#,##0"},
    {name: "Created by"}, {name: "Closed by"}, {name: "Assignee"}, {name: "Tags"},
    {name: "Messages", formatString: "#,##0"},
    {name: "Customer messages", formatString: "#,##0"},
    {name: "Agent replies", formatString: "#,##0"}
  ];

  // The names of everything this schema defines itself. A custom field named like one of them, or
  // like another selected custom field, is shown with its inbox name appended.
  var RESERVED_NAMES = [
    "Inbox", "Conversation", "Status", "Channel", "Source", "Tag", "Assignee", "Closed By", "Agent",
    "Customer", "Organization", "Hour", "Time", "Week Day",
    "First reply interval", "Closing interval", "Message count interval",
    "First reply office hours interval", "Closing office hours interval",
    "State", "Source via", "Customer email", "Created at", "Closed at", "Updated at",
    "Waiting since", "Threads", "Created by", "Closed by", "Tags", "Messages", "Customer messages",
    "Agent replies", "Job title", "Email", "Location", "Type",
    "Conversations created", "Conversations updated", "Conversations closed",
    "Conversations with first reply", "First reply hours", "Closing hours",
    "First reply office hours", "Closing office hours",
    "Conversations resolved", "Conversations resolved on first reply",
    "Closed conversations messages", "Customers",
    "Conversation messages created", "Customer messages created", "Agent replies created",
    "Notes created", "Attachments created", "Customers helped", "Response hours",
    "Response office hours", "Agent replies with response time", "Ratings", "Great ratings",
    "Okay ratings", "Not good ratings", "Average first reply hours", "Average closing hours",
    "Average first reply office hours", "Average closing office hours",
    "Average response hours", "Average response office hours",
    "Average messages per closed conversation",
    "Resolved on first reply %", "Conversations closed without reply", "Happiness score",
    "% great ratings", "% okay ratings", "% not good ratings"
  ].concat(CONVERSATION_PROPERTIES.map((property) => `Conversation ${property.name}`));

  // eazyBI rejects these characters in a displayed name, and Help Scout allows them in a field name.
  function sanitizeName(name) {
    return String(name).replace(/[<>&"'\\\[\]]/g, " ").replace(/\s+/g, " ").trim().substring(0, 100);
  }

  function isTaken(name, field) {
    var lowerName = name.toLowerCase();
    if (_.some(RESERVED_NAMES, (reserved) => reserved.toLowerCase() === lowerName)) return true;
    return _.some(customFields, (other) =>
      other.key !== field.key && sanitizeName(other.name).toLowerCase() === lowerName);
  }

  // Help Scout defines its custom fields per inbox, so two inboxes can have a field of the same
  // name — and a field can be named like a dimension of this cube. Such a name gets its inbox
  // appended, and a name colliding even then gets the field key, so that every name is unique.
  function displayName(field) {
    var name = sanitizeName(field.name || field.key);
    if (!isTaken(name, field)) return name;
    if (field.group) {
      let grouped = sanitizeName(`${name} (${field.group})`);
      if (!isTaken(grouped, field)) return grouped;
    }
    return sanitizeName(`${name} (${field.key})`);
  }

  function propertyOptions(field) {
    return {property: displayName(field)};
  }

  // Everything that comes from a custom field is annotated with this group, so that the dimensions,
  // the measures and the property measures of the selection are listed together and apart from the
  // dimensions and measures this type defines itself.
  var CUSTOM_FIELDS_GROUP = "Custom fields";

  function customFieldAnnotations() {
    return {group: CUSTOM_FIELDS_GROUP};
  }

  // The measure showing the value of the field of the conversation a report row is on, named after
  // the object it describes the way the built-in applications name theirs ("Issue Priority").
  function propertyMeasureName(field) {
    return sanitizeName(`Conversation ${displayName(field)}`);
  }

  function propertyFormatString(field) {
    if (field.dataType === "decimal") return "#,##0.00";
    if (field.dataType === "integer") return "#,##0";
    if (field.dataType === "date" || field.dataType === "datetime") return "mmm dd yyyy";
    return null;
  }

  // A Help Scout person — an agent, a customer or a team. The same shape is used by the three
  // dimensions that name someone, each with its own table so that each gets its own foreign key.
  // A member without a name — the `unassigned` member of Assignee, the `not_closed` member of
  // Closed By — is named by the schema, so the importer only has to create it. An explicit
  // `allMemberName` is given where the dimension name does not pluralize on its own — "Closed By"
  // would otherwise generate the ungrammatical "All Closed Bies".
  function personLevel(l, keyColumn, fallbackName, allMemberName) {
    var keyOptions = {key: true, limit: 50};
    if (allMemberName) keyOptions.allMemberName = allMemberName;
    l.string(keyColumn, keyOptions);
    var nameOptions = {name: true, ordinal: true};
    if (fallbackName) {
      nameOptions.nameExpression = expr.coalesce("display_name", fallbackName);
      nameOptions.ordinalExpression = expr.coalesce("display_name", fallbackName);
    }
    l.string("display_name", nameOptions);
    l.string("person_type", {property: "Type", limit: 20});
    l.string("email", {property: "Email"});
    l.string("job_title", {property: "Job title"});
  }

  dimension("Inbox", (d) => {
    d.table("mailboxes");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("name", {name: true, ordinal: true});
      l.string("email", {property: "Email"});
    });
  });

  dimension("Conversation", (d) => {
    d.table("conversations");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8, property: "URL_ID"});
      l.integer("number", {limit: 8, ordinal: true, property: "DISPLAY_KEY"});
      // The subject prefixed with the conversation number — the importer builds it, so that two
      // conversations with the same subject, or without one, are still two differently named members.
      l.string("name", {name: true});
      l.string("status", {property: "Status", limit: 20});
      l.string("channel", {property: "Channel", limit: 30});
      l.string("mailbox_name", {property: "Inbox"});
      l.string("state", {property: "State", limit: 20});
      l.string("source_via", {property: "Source via", limit: 20});
      l.string("customer_email", {property: "Customer email"});
      l.datetime("created_at", {property: "Created at"});
      l.datetime("closed_at", {property: "Closed at"});
      // The last agent activity and how long the customer has been waiting for an answer — what a
      // report of the conversations still to be worked on is filtered and sorted by.
      l.datetime("user_updated_at", {property: "Updated at"});
      l.datetime("customer_waiting_since", {property: "Waiting since"});
      l.integer("threads_count", {property: "Threads"});
      // Who started and who closed the conversation. Analysis is done by Assignee and by Agent —
      // these two name the people of one conversation in a detail report.
      l.string("created_by_name", {property: "Created by"});
      l.string("closed_by_name", {property: "Closed by"});
      // Who the conversation is assigned to now — the same person the Assignee dimension of the same
      // row names, as a property for a detail report or a drill through list. Empty while unassigned.
      l.string("assignee_name", {property: "Assignee"});
      // Every tag of the conversation as one comma separated string — the Tag dimension already
      // counts each tag of its own, this is for a report or a drill through list that shows the
      // whole set of one conversation at a glance. "(untagged)" when it carries none.
      l.string("tags_list", {property: "Tags"});
      // The customer messages and the agent replies together — the messages that passed between the
      // customer and the team. Internal notes do not count, here or in any of the measures derived
      // from it, including what the Message count interval dimension below buckets by.
      l.integer("messages_count", {property: "Messages"});
      l.integer("customer_messages_count", {property: "Customer messages"});
      l.integer("agent_replies_count", {property: "Agent replies"});
      // The first reply and the closing time within the office hours, in minutes, which the two office
      // hours interval dimensions bucket. Declared on the level, so that the columns exist also while
      // the Use office hours option is not selected and those dimensions are not defined.
      l.integer("first_reply_office_minutes", {limit: 8});
      l.integer("closing_office_minutes", {limit: 8});
      customFields.forEach((field) => {
        if (field.property) l[field.dataType](`cf_${field.key}`, propertyOptions(field));
      });
      l.annotations({source_url: "https://secure.helpscout.net/conversation/{{id}}/{{key}}"});
    });
  });

  dimension("Status", (d) => {
    d.table("statuses");
    d.level((l) => {
      l.string("status_key", {key: true, limit: 20});
      l.string("name", {name: true, limit: 50});
      l.integer("position", {ordinal: true});
    });
  });

  dimension("Channel", (d) => {
    d.table("channels");
    d.level((l) => {
      l.string("channel_key", {key: true, limit: 30});
      l.string("name", {name: true, ordinal: true, limit: 50});
    });
  });

  // The Help Scout conversation `source.type` — how the conversation entered Help Scout.
  // The table is deliberately not named `sources`: its foreign key would then be `source_id`,
  // one underscore away from the reserved `_source_id` column of every fact table.
  dimension("Source", (d) => {
    d.table("source_types");
    d.level((l) => {
      l.string("source_type_key", {key: true, limit: 30});
      l.string("name", {name: true, ordinal: true, limit: 50});
    });
  });

  dimension("Tag", (d) => {
    d.table("tags");
    d.level((l) => {
      l.integer("id", {id: true, limit: 8});
      l.string("name", {key: true, name: true});
    });
    d.bridgeTable("tags_bt", (b) => {
      b.string("_bt_id", {primaryKey: true, limit: 150, bridgeDimensionForeignKeyColumn: "tag_bt_id"});
      b.integer("tag_id", {parentKey: true});
    });
  });

  // Who the conversation is assigned to now — the workload of the team.
  dimension("Assignee", (d) => {
    d.table("assignees");
    d.level((l) => personLevel(l, "assignee_key", "(unassigned)"));
  });

  // Who actually closed the conversation — unlike Assignee, which is who it is assigned to now and
  // can change after it was closed. A conversation not closed yet has no closer, so the
  // "(not closed)" member keeps it visible in a report grouped by Closed By.
  dimension("Closed By", (d) => {
    d.table("closers");
    d.level("User", (l) => personLevel(l, "closed_by_key", "(not closed)", "All Closers"));
  });

  // Which staff member wrote a message and was rated for it. Unlike Assignee, this dimension
  // describes the individual message and rating rows, which is what the replies sent and the
  // happiness of one agent are counted by. A message the customer wrote carries no agent — that
  // person is the customer the Customer dimension of the same row already names.
  dimension("Agent", (d) => {
    d.table("agents");
    d.level((l) => personLevel(l, "agent_key"));
  });

  dimension("Customer", (d) => {
    d.table("customers");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("display_name", {name: true, ordinal: true});
      l.string("email", {property: "Email"});
      l.string("job_title", {property: "Job title"});
      l.string("location", {property: "Location"});
      l.string("organization_name", {property: "Organization"});
    });
  });

  dimension("Organization", (d) => {
    d.table("organizations");
    d.level((l) => {
      l.integer("id", {id: true, key: true, limit: 8});
      l.string("name", {name: true, ordinal: true});
    });
  });

  // The hour of the day of the event a fact row counts — the created row carries the hour the
  // conversation was created, the closed row the hour it was closed, a message row the hour it was
  // written. The hour is the one of the Time dimension time zone, so it agrees with the Time member
  // of the same row.
  dimension("Hour", (d) => {
    d.table("hours");
    d.level((l) => {
      l.integer("hour", {key: true, ordinal: true});
      l.string("name", {name: true, limit: 5});
    });
  });

  // One dimension per custom field selected as a dimension. Its table is `cf_{key}`, so the fact
  // table foreign key of the field is `cf_{key}_id` — also inside the `cf_` naming contract.
  customFields.forEach((field) => {
    if (!field.dimension) return;
    dimension(displayName(field), (d) => {
      d.table(`cf_${field.key}`);
      d.level((l) => {
        l.string("value_key", {key: true});
        l.string("name", {name: true});
        l.integer("position", {ordinal: true});
      });
      d.dimensionAnnotations(customFieldAnnotations());
    });
  });

  // The two conversation durations, bucketed at report query time. Both share the Conversation
  // dimension table and are joined to the fact tables by its existing `conversation_id` foreign
  // key, so they add no fact table column — the importer only writes the raw minutes on the
  // dimension member. Minutes is the unit the standard application types store durations in; the
  // interval boundaries are declared in the unit each duration is read in, and users can change
  // them per account in the report editor.
  schema.intervalDimension("First reply interval", {
    sharedTable: "conversations",
    column: "first_reply_minutes",
    limit: 8,
    timeUnit: "minutes",
    timeInterval: "duration",
    defaultIntervals: "6,12,24",
    defaultIntervalUnit: "hours"
  });

  schema.intervalDimension("Closing interval", {
    sharedTable: "conversations",
    column: "closing_minutes",
    limit: 8,
    timeUnit: "minutes",
    timeInterval: "duration",
    defaultIntervals: "0-14/1",
    defaultIntervalUnit: "days"
  });

  // The same two durations within the office hours, defined when the Use office hours option is selected.
  // eazyBI keeps a dimension in the cube once it was added, so they stay without values when the option
  // is deselected again. A closing time is bucketed by hours of office time and not by days: a day of
  // 24 office hours would be about three working days.
  if (useOfficeHours) {
    schema.intervalDimension("First reply office hours interval", {
      sharedTable: "conversations",
      column: "first_reply_office_minutes",
      limit: 8,
      timeUnit: "minutes",
      timeInterval: "duration",
      defaultIntervals: "6,12,24",
      defaultIntervalUnit: "hours"
    });

    schema.intervalDimension("Closing office hours interval", {
      sharedTable: "conversations",
      column: "closing_office_minutes",
      limit: 8,
      timeUnit: "minutes",
      timeInterval: "duration",
      defaultIntervals: "0-72/8",
      defaultIntervalUnit: "hours"
    });
  }

  // How many messages passed between the customer and the team, bucketed the same way — it shares
  // the `messages_count` column the Messages property of the Conversation dimension already stores,
  // so it adds neither a dimension table nor a fact table column. Internal notes are not counted, so
  // a conversation with only notes and no reply does not bucket as if it had been answered. A message
  // count is a plain number and not a duration, so it declares none of the three time options: the
  // counts are bucketed as they are stored, and no interval unit is shown to the user. The default is
  // one bucket per message up to ten, and an account changes the boundaries and the bucket names in
  // the report editor.
  schema.intervalDimension("Message count interval", {
    sharedTable: "conversations",
    column: "messages_count",
    defaultIntervals: "0-10/1"
  });

  timeDimension("Time");

  // The week day of the event a fact row counts, over the shared time table of the Time dimension —
  // it is joined by the same `time_id` foreign key, so it adds no fact table column and nothing to
  // import. Together with the Hour dimension it is what a report of the busiest days and hours of
  // the week is built from.
  weekDayDimension("Week Day");

  cube((c) => {
    c.table("conversations");
    // Every fact table row is about one conversation — a created, closed, message or rating row — so a
    // report cell of any measure is drilled through to the conversations aggregated into it.
    c.annotations({
      default_measures: ["Conversations created"],
      drill_through_dimension_levels: ["[Conversation].[Conversation]"]
    });

    // One row per conversation event — created, updated, closed, first replied — so that each
    // measure is counted in the Time dimension period of its own timestamp.
    c.measures((m) => {
      m.integer("conversations_created", {name: "Conversations created"});
      m.integer("conversations_updated", {name: "Conversations updated"});
      m.integer("conversations_closed", {name: "Conversations closed"});
      m.integer("conversations_with_first_reply", {name: "Conversations with first reply"});
      m.decimal("first_reply_hours", {name: "First reply hours", precision: 19, scale: 2,
        formatString: "#,##0.00"});
      m.decimal("closing_hours", {name: "Closing hours", precision: 19, scale: 2,
        formatString: "#,##0.00"});
      // The same durations counted within the office hours only.
      m.decimal("first_reply_office_hours", {name: "First reply office hours", precision: 19, scale: 2,
        formatString: "#,##0.00", visible: useOfficeHours});
      m.decimal("closing_office_hours", {name: "Closing office hours", precision: 19, scale: 2,
        formatString: "#,##0.00", visible: useOfficeHours});
      // Help Scout counts a conversation as resolved only when an agent answered it before it was
      // closed — a conversation closed without a reply was never worked on.
      m.integer("conversations_resolved", {name: "Conversations resolved"});
      m.integer("conversations_resolved_on_first_reply",
        {name: "Conversations resolved on first reply"});
      // The messages of the conversations closed in the period, for the average below.
      m.integer("closed_messages_count", {name: "Closed conversations messages"});
      // The customers who wrote in or were written to in the period, counted once each however
      // many conversations they have. Only the created and the updated rows carry a customer the
      // period saw — the closing of an old conversation is not a customer of the period.
      m.integerExpression(
        expr.caseNotNull(["conversations_created", "conversations_updated"], "customer_id"),
        {name: "Customers", aggregator: "distinct-count"});
      // A numeric custom field selected as a measure, summed over the conversations of a period.
      customFields.forEach((field) => {
        if (field.measure)
          m.decimal(`cf_${field.key}`, {name: displayName(field), precision: 19, scale: 2,
            formatString: "#,##0.00", annotations: customFieldAnnotations()});
      });
      m.datetime("_updated_at", {index: true});
    });

    // One row per conversation thread, at the time the thread was created.
    c.measures("Messages", (m) => {
      m.table("conversations_messages");
      m.integer("conversation_messages_created", {name: "Conversation messages created",
        visible: importMessages});
      m.integer("customer_messages_created", {name: "Customer messages created",
        visible: importMessages});
      m.integer("agent_replies_created", {name: "Agent replies created", visible: importMessages});
      m.integer("notes_created", {name: "Notes created", visible: importMessages});
      m.integer("attachments_created", {name: "Attachments created", visible: importMessages});
      // The customers the team actually answered, counted once each. The column holds the customer
      // of the rows that carry an agent reply and is null on the others, so the distinct count of
      // it counts exactly them.
      m.integer("replied_customer_id", {name: "Customers helped", aggregator: "distinct-count",
        limit: 8, visible: importMessages});
      // How long the customer waited for each reply, not only for the first one: every agent reply
      // that answers a customer message adds the wait before it.
      m.decimal("response_hours", {name: "Response hours", precision: 19, scale: 2,
        formatString: "#,##0.00", visible: importMessages});
      // The same wait within the office hours only, when they are used.
      m.decimal("response_office_hours", {name: "Response office hours", precision: 19, scale: 2,
        formatString: "#,##0.00", visible: importMessages && useOfficeHours});
      m.integer("agent_replies_with_response", {name: "Agent replies with response time",
        visible: importMessages});
      m.datetime("_updated_at", {index: true});
    });

    // One row per satisfaction rating, at the time the customer rated the reply.
    c.measures("Ratings", (m) => {
      m.table("conversations_ratings");
      m.integer("ratings", {name: "Ratings", visible: importRatings});
      m.integer("great_ratings", {name: "Great ratings", visible: importRatings});
      m.integer("okay_ratings", {name: "Okay ratings", visible: importRatings});
      m.integer("not_good_ratings", {name: "Not good ratings", visible: importRatings});
      m.datetime("_updated_at", {index: true});
    });

    c.timeDimensionCalculatedMembers();

    c.calculatedMember("Average first reply hours", {
      formula: `
        CASE WHEN [Measures].[Conversations with first reply] > 0 THEN
          [Measures].[First reply hours] / [Measures].[Conversations with first reply]
        END`,
      formatString: "#,##0.00"
    });
    c.calculatedMember("Average closing hours", {
      formula: `
        CASE WHEN [Measures].[Conversations closed] > 0 THEN
          [Measures].[Closing hours] / [Measures].[Conversations closed]
        END`,
      formatString: "#,##0.00"
    });
    c.calculatedMember("Average first reply office hours", {
      formula: `
        CASE WHEN [Measures].[Conversations with first reply] > 0 THEN
          [Measures].[First reply office hours] / [Measures].[Conversations with first reply]
        END`,
      formatString: "#,##0.00",
      visible: useOfficeHours
    });
    c.calculatedMember("Average closing office hours", {
      formula: `
        CASE WHEN [Measures].[Conversations closed] > 0 THEN
          [Measures].[Closing office hours] / [Measures].[Conversations closed]
        END`,
      formatString: "#,##0.00",
      visible: useOfficeHours
    });
    c.calculatedMember("Average response hours", {
      formula: `
        CASE WHEN [Measures].[Agent replies with response time] > 0 THEN
          [Measures].[Response hours] / [Measures].[Agent replies with response time]
        END`,
      formatString: "#,##0.00",
      visible: importMessages
    });
    c.calculatedMember("Average response office hours", {
      formula: `
        CASE WHEN [Measures].[Agent replies with response time] > 0 THEN
          [Measures].[Response office hours] / [Measures].[Agent replies with response time]
        END`,
      formatString: "#,##0.00",
      visible: importMessages && useOfficeHours
    });
    c.calculatedMember("Average messages per closed conversation", {
      formula: `
        CASE WHEN [Measures].[Conversations closed] > 0 THEN
          [Measures].[Closed conversations messages] / [Measures].[Conversations closed]
        END`,
      formatString: "#,##0.00"
    });
    c.calculatedMember("Conversations closed without reply", {
      formula: `
        [Measures].[Conversations closed] - [Measures].[Conversations resolved]`,
      formatString: "#,##0"
    });
    c.calculatedMember("Resolved on first reply %", {
      formula: `
        CASE WHEN [Measures].[Conversations resolved] > 0 THEN
          [Measures].[Conversations resolved on first reply] /
          [Measures].[Conversations resolved]
        END`,
      formatString: "#0.0%"
    });

    // Help Scout scores happiness as the share of great ratings less the share of not good ones,
    // so a page of okay ratings scores zero and a page of bad ones scores below it.
    c.calculatedMember("Happiness score", {
      formula: `
        CASE WHEN [Measures].[Ratings] > 0 THEN
          ([Measures].[Great ratings] - [Measures].[Not good ratings]) / [Measures].[Ratings]
        END`,
      formatString: "#0.0%",
      visible: importRatings
    });
    [["% great ratings", "Great ratings"],
     ["% okay ratings", "Okay ratings"],
     ["% not good ratings", "Not good ratings"]].forEach((names) => {
      c.calculatedMember(names[0], {
        formula: `
          CASE WHEN [Measures].[Ratings] > 0 THEN
            [Measures].[${names[1]}] / [Measures].[Ratings]
          END`,
        formatString: "#0.0%",
        visible: importRatings
      });
    });

    // One property measure per custom field selected as a property — the value of the conversation
    // the report row is on. A deselected field takes its property measure with it: eazyBI removes
    // the predefined calculated members whose formula reads a property that is gone.
    customFields.forEach((field) => {
      if (!field.property) return;
      var options = {
        formula: `[Conversation].CurrentHierarchyMember.get('${displayName(field)}')`,
        annotations: customFieldAnnotations()
      };
      let formatString = propertyFormatString(field);
      if (formatString) options.formatString = formatString;
      c.calculatedMember(propertyMeasureName(field), options);
    });

    // One property measure per Conversation property, named like the custom field ones above, so
    // that a report or a drill through list of conversations shows the status, the people and the
    // timestamps of each conversation next to its measures.
    CONVERSATION_PROPERTIES.forEach((property) => {
      var options = {
        formula: `[Conversation].CurrentHierarchyMember.get('${property.name}')`,
        annotations: {group: "Conversation properties"}
      };
      if (property.formatString) options.formatString = property.formatString;
      c.calculatedMember(`Conversation ${property.name}`, options);
    });
  });
});
