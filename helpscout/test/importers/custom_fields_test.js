describe("app.importers.customFields", () => {
  // Priority (dropdown, dimension), Product (single line, property), Order value (number,
  // property + dimension + measure), Renewal date (date, property).
  var SELECTION = {
    "104": {property: true, dimension: true},
    "105": {property: true},
    "106": {property: true, dimension: true, measure: true},
    "107": {property: true}
  };

  // `mock.customFields` builds the selection with `getAvailableCustomFields`, which requests the
  // fields of the inbox itself — only the requests `prepare` adds to that are counted.
  var prepareRequests = 0;

  function fieldsRequests() {
    return _.filter(mock.requestedPaths(), (path) => path === "/v2/mailboxes/13/fields").length;
  }

  function conversation(customFields) {
    return {id: 500, number: 50, customFields: customFields};
  }

  function selectFields(selection) {
    mock.sourceSelection(["13"]);
    mock.get("/v2/mailboxes", {fixture: "mailboxes"});
    mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});
    mock.customFields(selection || SELECTION);
    mock.extraOptions({time_dimension_time_zone: "UTC"});
    importRun.prepare();
    app.importers.customFields.reset();
    var requestsBefore = fieldsRequests();
    app.importers.customFields.prepare(source.getCustomFields(), ["13"]);
    prepareRequests = fieldsRequests() - requestsBefore;
  }

  // Leave the schema of the run without the custom field columns for the tests that follow.
  afterAll(() => mock.customFields({}));

  function membersOf(fieldKey) {
    return dwh.dimensions[`cf_${fieldKey}`].rows({
      columns: ["value_key", "name", "position"], orderBy: "position"});
  }

  describe("prepare", () => {
    test("seeds the dropdown options in the Help Scout order, with a (none) member", () => {
      selectFields();

      expect(membersOf("104")).toEqual([
        {value_key: "(none)", name: "(none)", position: 0},
        {value_key: "168", name: "High", position: 1},
        {value_key: "169", name: "Medium", position: 2},
        {value_key: "170", name: "Low", position: 3}
      ]);
      // The options of an inbox are requested once, whatever it defines for the selection.
      expect(prepareRequests).toBe(1);
    });

    test("requests nothing when no field is selected as a dimension", () => {
      selectFields({"105": {property: true}});

      expect(prepareRequests).toBe(0);
    });

    test("only warns when the fields of an inbox cannot be read", () => {
      mock.sourceSelection(["13"]);
      mock.get("/v2/mailboxes", {fixture: "mailboxes"});
      mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});
      mock.customFields(SELECTION);
      importRun.prepare();
      var selected = source.getCustomFields();
      mock.get("/v2/mailboxes/13/fields", {status: 403, json: {message: "Forbidden"}});
      app.importers.customFields.reset();

      app.importers.customFields.prepare(selected, ["13"]);

      // Only the (none) member is seeded; the options arrive with the conversations instead.
      expect(membersOf("104")).toEqual([{value_key: "(none)", name: "(none)", position: 0}]);
      expect(importRun.warnings()).toEqual([]);
      expect(importRun.log().join("\n")).
        toContain("Could not read the custom fields of inbox 13");
    });
  });

  describe("valuesOf", () => {
    beforeEach(selectFields);

    test("reads the value of every field selected as a property", () => {
      var values = app.importers.customFields.valuesOf(conversation([
        {id: 104, value: "168", text: "High"},
        {id: 105, value: "Reports", text: "Reports"},
        {id: 106, value: "250", text: "250"},
        {id: 107, value: "2026-04-01", text: "2026-04-01"}
      ]));

      // A dropdown is stored by its label, a number as a number and a date as a date.
      expect(values).toEqual({
        cf_104: "High", cf_105: "Reports", cf_106: 250, cf_107: "2026-04-01"
      });
    });

    test("stores a missing, empty or unparsable value as null", () => {
      var values = app.importers.customFields.valuesOf(conversation([
        {id: 105, value: "", text: ""},
        {id: 106, value: "not a number", text: "not a number"}
      ]));

      expect(values).toEqual({cf_104: null, cf_105: null, cf_106: null, cf_107: null});
    });

    test("keeps a date on its own day in a time zone behind UTC", () => {
      mock.extraOptions({time_dimension_time_zone: "America/New_York"});
      importRun.prepare();

      var values = app.importers.customFields.valuesOf(conversation([
        {id: 107, value: "2026-04-01", text: "2026-04-01"}
      ]));

      // Midnight UTC is the day before in New York, so the date is converted from midday.
      expect(values.cf_107).toBe("2026-04-01");
    });
  });

  describe("dimensionIds", () => {
    beforeEach(selectFields);

    test("resolves a value to its member and an empty one to the (none) member", () => {
      var ids = app.importers.customFields.dimensionIds(conversation([
        {id: 104, value: "168", text: "High"},
        {id: 106, value: "250", text: "250"}
      ]));

      expect(ids.cf_104_id).toBe(
        dwh.dimensions.cf_104.lookupId({value_key: "168"}));
      // A numeric dimension member is keyed and ordered by its own value.
      expect(_.find(membersOf("106"), (member) => member.value_key === "250")).
        toEqual({value_key: "250", name: "250", position: 250});
      // Nothing was selected for Priority in the other conversation.
      var noneIds = app.importers.customFields.dimensionIds(conversation([]));
      expect(noneIds.cf_104_id).toBe(dwh.dimensions.cf_104.lookupId({value_key: "(none)"}));
      // A field selected only as a property has no foreign key.
      expect(ids.cf_105_id).toBeUndefined();
    });

    test("creates a member of an option the inbox does not define anymore", () => {
      app.importers.customFields.dimensionIds(conversation([
        {id: 104, value: "999", text: "Whenever"}
      ]));

      expect(_.find(membersOf("104"), (member) => member.value_key === "999")).
        toEqual({value_key: "999", name: "Whenever",
                 position: app.importers.customFields.MAX_POSITION});
    });
  });

  describe("measureValues", () => {
    beforeEach(selectFields);

    test("returns the number of every field selected as a measure", () => {
      expect(app.importers.customFields.measureValues(conversation([
        {id: 106, value: "125.50", text: "125.50"},
        {id: 104, value: "168", text: "High"}
      ]))).toEqual({cf_106: 125.5});

      // A conversation without the value writes no measure at all.
      expect(app.importers.customFields.measureValues(conversation([]))).toEqual({});
    });
  });
});
