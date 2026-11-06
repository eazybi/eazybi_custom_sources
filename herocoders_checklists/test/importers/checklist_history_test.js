describe("app.importers.checklistHistory", () => {
  var history = app.importers.checklistHistory;
  var parser = app.importers.checklistParser;
  var issue = {id: "10001", key: "DEV-1", fields: {created: "2026-01-05T10:00:00.000+0000"}};
  var change = (day, fromString, toString) =>
    ({created: "2026-01-" + day + "T12:00:00.000+0000", fromString: fromString, toString: toString});

  // The completion or reopening dates of the items of the last change, by "checklist index/item index".
  function eventDays(method, changes, completedStatuses) {
    var current = changes.length > 0 ? changes[changes.length - 1].toString : null;
    var events = history[method](issue, parser.parse(current, completedStatuses), changes, completedStatuses);
    return _.mapObject(events, (event) => event.created.substring(0, 10));
  }
  var completionDays = (changes, completedStatuses) => eventDays("completions", changes, completedStatuses);
  var reopeningDays = (changes, completedStatuses) => eventDays("reopenings", changes, completedStatuses);

  describe("fieldChanges", () => {
    test("returns the Checklist Text changes oldest first", () => {
      var histories = [
        {id: "12", created: "2026-01-12", items: [{fieldId: "customfield_10100", fromString: "b", toString: "c"}]},
        {id: "9", created: "2026-01-09", items: [
          {fieldId: "status", fromString: "To Do", toString: "Done"},
          {fieldId: "customfield_10100", fromString: null, toString: "a"},
          {fieldId: "customfield_10200", fromString: "a", toString: "b"}
        ]},
        {id: "10", created: "2026-01-10", items: [{fieldId: "customfield_10101", fromString: "x", toString: "y"}]}
      ];

      expect(history.fieldChanges(histories, ["customfield_10100", "customfield_10200"])).toEqual([
        {created: "2026-01-09", fromString: null, toString: "a"},
        {created: "2026-01-09", fromString: "a", toString: "b"},
        {created: "2026-01-12", fromString: "b", toString: "c"}
      ]);
    });

    test("finds the changes by the field name in Jira Data Center", () => {
      var histories = [{id: "1", created: "2026-01-09", items: [
        {field: "Checklist Text", fieldtype: "custom", fromString: "a", toString: "b"},
        {field: "Checklist Progress %", fieldtype: "custom", fromString: "0%", toString: "50%"}
      ]}];

      expect(history.fieldChanges(histories, ["customfield_10100"])).
        toEqual([{created: "2026-01-09", fromString: "a", toString: "b"}]);
    });
  });

  describe("completions", () => {
    test("date an item by its last completion", () => {
      expect(completionDays([
        change("08", "* [open] One\n* [open] Two", "* [done] One\n* [open] Two"),
        change("09", "* [done] One\n* [open] Two", "* [open] One\n* [open] Two"),
        change("10", "* [open] One\n* [open] Two", "* [open] One\n* [x] Two"),
        change("12", "* [open] One\n* [x] Two", "* [done] One\n* [x] Two")
      ])).toEqual({"0/0": "2026-01-12", "0/1": "2026-01-10"});
    });

    test("keep the completion when a completed item changes to another completed status", () => {
      expect(completionDays([
        change("08", "* [open] One", "* [done] One"),
        change("09", "* [done] One", "* [skipped] One")
      ])).toEqual({"0/0": "2026-01-08"});
    });

    test("date the items completed before the first change by the issue created date", () => {
      expect(completionDays([
        change("08", "* [x] One\n* [open] Two", "* [x] One\n* [done] Two")
      ])).toEqual({"0/0": "2026-01-05", "0/1": "2026-01-08"});
    });

    test("date the items added as completed by the change which added them", () => {
      expect(completionDays([
        change("08", null, "# A\n* [done] One"),
        change("09", "# A\n* [done] One", "# A\n* [done] One\n# B\n* [done] Two")
      ])).toEqual({"0/0": "2026-01-08", "1/0": "2026-01-09"});
    });

    test("keep the completion of an item whose text was edited", () => {
      expect(completionDays([
        change("08", "* [open] One\n* [open] Two", "* [done] One\n* [open] Two"),
        change("09", "* [done] One\n* [open] Two", "* [done] One edited\n* [open] Two")
      ])).toEqual({"0/0": "2026-01-08"});
    });

    test("tell apart the items of the same text by their order and their checklist", () => {
      expect(completionDays([
        change("08", "# A\n* [open] Same\n* [open] Same\n# B\n* [open] Same",
          "# A\n* [done] Same\n* [open] Same\n# B\n* [open] Same"),
        change("09", "# A\n* [done] Same\n* [open] Same\n# B\n* [open] Same",
          "# A\n* [done] Same\n* [done] Same\n# B\n* [done] Same")
      ])).toEqual({"0/0": "2026-01-08", "0/1": "2026-01-09", "1/0": "2026-01-09"});
    });

    test("count the statuses counted as completed", () => {
      expect(completionDays([
        change("08", "* [open] One", "* [verified] One"),
        change("09", "* [verified] One", "* [done] One")
      ], ["verified", "done"])).toEqual({"0/0": "2026-01-08"});
    });

    test("date the completed items by the issue created date without changes", () => {
      var completions = history.completions(issue, parser.parse("* [x] One\n* [] Two"), []);

      expect(completions).toEqual({"0/0": {created: "2026-01-05T10:00:00.000+0000"}});
    });

    test("date the items which no change completed by the last change", () => {
      var changes = [change("08", null, "* [open] One")];
      var completions = history.completions(issue, parser.parse("* [done] One"), changes);

      expect(completions).toEqual({"0/0": {created: "2026-01-08T12:00:00.000+0000"}});
    });
  });

  describe("reopenings", () => {
    test("date an item by its last reopening", () => {
      expect(reopeningDays([
        change("08", "* [open] One\n* [open] Two", "* [done] One\n* [done] Two"),
        change("09", "* [done] One\n* [done] Two", "* [open] One\n* [done] Two"),
        change("10", "* [open] One\n* [done] Two", "* [x] One\n* [done] Two"),
        change("11", "* [x] One\n* [done] Two", "* [in progress] One\n* [done] Two")
      ])).toEqual({"0/0": "2026-01-11"});
    });

    test("keep the reopening of an item which was completed again", () => {
      expect(reopeningDays([
        change("08", "* [done] One", "* [open] One"),
        change("09", "* [open] One", "* [done] One")
      ])).toEqual({"0/0": "2026-01-08"});
    });

    test("count only the changes from a completed to a not completed status", () => {
      expect(reopeningDays([
        change("08", "* [open] One\n* [done] Two\n* [verified] Three", "* [in progress] One\n* [skipped] Two\n* [open] Three"),
        change("09", "* [in progress] One\n* [skipped] Two\n* [open] Three", "* [open] One\n* [x] Two\n* [open] Three")
      ])).toEqual({});
    });

    test("count the statuses counted as completed", () => {
      expect(reopeningDays([
        change("08", "* [verified] One", "* [open] One")
      ], ["verified"])).toEqual({"0/0": "2026-01-08"});
    });

    test("find an item reopened in the change which edited its text", () => {
      expect(reopeningDays([
        change("08", "* [done] One\n* [open] Two", "* [open] One edited\n* [open] Two")
      ])).toEqual({"0/0": "2026-01-08"});
    });

    test("keep the items of the same text apart when the first one is edited", () => {
      var changes = [
        change("08", "* [open] Same\n* [open] Same", "* [done] Same\n* [open] Same"),
        change("09", "* [done] Same\n* [open] Same", "* [done] Same edited\n* [open] Same")
      ];

      expect(reopeningDays(changes)).toEqual({});
      expect(completionDays(changes)).toEqual({"0/0": "2026-01-08"});
    });
  });
});
