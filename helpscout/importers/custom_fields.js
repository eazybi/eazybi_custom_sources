// The Help Scout custom fields the user selected on the Custom fields tab.
//
// Help Scout defines its custom fields per inbox and returns their values with every conversation,
// so nothing has to be requested per conversation: the values are read from `conversation.customFields`
// and written into the `cf_{key}` columns the schema declared for the selection. Only the option
// lists of the dropdown fields are requested once per inbox, so that their dimension members are
// ordered as they are in Help Scout.
app.importers.customFields = {
  // The member of a conversation that has no value for the field, so that such conversations stay
  // visible in a report grouped by the field. A Help Scout dropdown option id is a number and a
  // text value of exactly this shape is not worth guarding against further.
  NONE_KEY: "(none)",
  // The position of a dropdown option the inbox does not define anymore — after every option it
  // does — and the largest position a member of a numeric dimension gets from its own value.
  MAX_POSITION: 2147483647,

  // The selected fields, and the option list of each dropdown among them by field key.
  fields: [],
  optionsByKey: {},

  reset() {
    this.fields = [];
    this.optionsByKey = {};
  },

  // Reads the selection and seeds the members of every custom field dimension: the `(none)` member
  // and, for a dropdown, one member per option in the Help Scout order.
  prepare(customFields, mailboxIds) {
    this.fields = customFields || [];
    this.optionsByKey = {};
    var dimensionFields = this.fields.filter((field) => field.dimension);
    if (dimensionFields.length === 0) return 0;

    logger.startImport("custom fields");
    this.fetchOptions(mailboxIds);
    dimensionFields.forEach((field) => {
      this.storeMember(field, this.NONE_KEY, this.NONE_KEY, 0);
      (this.optionsByKey[field.key] || []).forEach((option) => {
        this.storeMember(field, String(option.id), option.label, option.order);
      });
    });
    logger.finishImport("custom fields", dimensionFields.length);
    return dimensionFields.length;
  },

  // The option lists of the selected inboxes. An inbox whose fields cannot be read is only logged:
  // its dropdown members are then created from the conversations instead, without their order.
  fetchOptions(mailboxIds) {
    var ids = (mailboxIds && mailboxIds.length > 0)
      ? mailboxIds : Object.keys(app.importers.mailboxes.namesById);
    var selectedKeys = {};
    this.fields.forEach((field) => selectedKeys[field.key] = true);

    ids.forEach((mailboxId) => {
      try {
        app.api.getMailboxCustomFields(mailboxId).forEach((definition) => {
          var key = String(definition.id);
          if (!selectedKeys[key] || !definition.options) return;
          this.optionsByKey[key] = definition.options;
        });
      } catch (error) {
        logger.warn(`Could not read the custom fields of inbox ${mailboxId}: ${error.message}`);
      }
    });
  },

  storeMember(field, valueKey, name, position) {
    return dwh.dimensions[`cf_${field.key}`].createAndLookupId({value_key: String(valueKey)},
      {name: name, position: position});
  },

  // The `cf_{key}` property values of one conversation, for the Conversation dimension member.
  valuesOf(conversation) {
    var values = {};
    var valuesById = this.valuesById(conversation);
    this.fields.forEach((field) => {
      if (!field.property) return;
      values[`cf_${field.key}`] = this.columnValue(field, valuesById[field.key]);
    });
    return values;
  },

  // The `cf_{key}_id` foreign keys of one conversation — the fact table column of a custom field
  // dimension is named after its `cf_{key}` table.
  dimensionIds(conversation) {
    var ids = {};
    var valuesById = this.valuesById(conversation);
    this.fields.forEach((field) => {
      if (!field.dimension) return;
      ids[`cf_${field.key}_id`] = this.memberIdOf(field, valuesById[field.key]);
    });
    return ids;
  },

  // The `cf_{key}` measure values of one conversation.
  measureValues(conversation) {
    var values = {};
    var valuesById = this.valuesById(conversation);
    this.fields.forEach((field) => {
      if (!field.measure) return;
      var number = this.numberOf(valuesById[field.key]);
      if (number !== null) values[`cf_${field.key}`] = number;
    });
    return values;
  },

  // The custom field values of a conversation by field key. A dropdown value is the option id and
  // its text the option label; for every other type both are the value itself.
  valuesById(conversation) {
    var valuesById = {};
    (conversation.customFields || []).forEach((value) => {
      if (value && value.id !== undefined && value.id !== null)
        valuesById[String(value.id)] = value;
    });
    return valuesById;
  },

  // A member per distinct value, keyed by the dropdown option id or by the value itself.
  memberIdOf(field, value) {
    var text = this.textOf(value);
    if (text === null) return this.storeMember(field, this.NONE_KEY, this.NONE_KEY, 0);
    var valueKey = (value.value === undefined || value.value === null || value.value === "")
      ? text : String(value.value);
    return this.storeMember(field, valueKey, text.substring(0, 255), this.positionOf(field, value));
  },

  // A dropdown member keeps the Help Scout order of its option and an option the inbox does not
  // define anymore goes after all of them — a member without a position would come first. A numeric
  // member is ordered by its own value, and anything else has no order of its own.
  positionOf(field, value) {
    var options = this.optionsByKey[field.key];
    if (options) {
      let option = _.find(options, (one) => String(one.id) === String(value.value));
      return option ? option.order : this.MAX_POSITION;
    }
    if (field.dataType === "decimal") {
      let number = this.numberOf(value);
      if (number !== null && Math.abs(number) <= this.MAX_POSITION) return Math.round(number);
    }
    return null;
  },

  // The value to store in the `cf_{key}` column declared for the data type of the field.
  columnValue(field, value) {
    if (field.dataType === "decimal") return this.numberOf(value);
    if (field.dataType === "date") return this.dateOf(field, value);
    var text = this.textOf(value);
    if (text === null) return null;
    return field.dataType === "string" ? text.substring(0, 255) : text;
  },

  // Help Scout writes a date custom field as `YYYY-MM-DD`, which `Date.parse` reads as midnight UTC
  // — in a Time dimension time zone behind UTC that is the day before. The date is therefore
  // converted from the middle of its own day, which lands on the right date in every time zone.
  dateOf(field, value) {
    var text = this.textOf(value);
    if (text === null) return null;
    var timestamp = /^\d{4}-\d\d-\d\d$/.test(text) ? `${text}T12:00:00Z` : text;
    return dwh.dateValue(timestamp, `custom field ${field.name}`);
  },

  numberOf(value) {
    var text = this.textOf(value);
    if (text === null) return null;
    var number = parseFloat(text);
    return isNaN(number) ? null : number;
  },

  // The displayed text of a value — the option label of a dropdown — or null when it is empty.
  textOf(value) {
    if (!value) return null;
    var text = (value.text === undefined || value.text === null || value.text === "")
      ? value.value : value.text;
    if (text === undefined || text === null) return null;
    text = String(text).trim();
    return text === "" ? null : text;
  }
};
