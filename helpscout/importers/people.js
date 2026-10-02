// Help Scout names a person the same way everywhere — {id, type, first, last, email} — and three
// dimensions store them: Assignee, Closed By and Agent. Each has its own table, because a fact
// table foreign key is named after the dimension table and two dimensions sharing a table would
// claim the same column.
app.importers.people = {
  // Member keys are prefixed with the person type, so that a user and a customer of the same
  // numeric id stay apart: "user-99", "customer-238604", "team-1234".
  keyOf(person) {
    if (!person || !person.id) return null;
    return `${this.typeOf(person)}-${person.id}`;
  },

  typeOf(person) {
    var type = (person && person.type) || "user";
    // v2 reports the AI powered system users as plain users, v3 does not — treat them alike.
    return type === "system_user" ? "user" : type;
  },

  displayName(person) {
    if (!person) return null;
    var name = [person.first, person.last].filter((part) => part).join(" ").trim();
    return name || person.email || `${app.importers.rows.humanize(this.typeOf(person))} ${person.id}`;
  },

  attributesOf(person) {
    return {
      display_name: this.displayName(person),
      person_type: app.importers.rows.humanize(this.typeOf(person)),
      email: person.email,
      job_title: person.jobTitle
    };
  },

  // Stores the person in one of the three people tables and returns the member id.
  store(tableName, keyColumn, person) {
    var key = this.keyOf(person);
    if (!key) return null;
    var keys = {};
    keys[keyColumn] = key;
    return dwh.dimensions[tableName].createAndLookupId(keys, this.attributesOf(person));
  },

  // The member of the conversations nobody is assigned to, so that they stay visible in a report
  // grouped by Assignee. It has no name of its own — the schema names it `(unassigned)`.
  unassignedId() {
    return dwh.dimensions.assignees.createAndLookupId({assignee_key: "unassigned"},
      {display_name: null, person_type: "Unassigned"});
  },

  // The member of the conversations not closed yet, so that they stay visible in a report grouped
  // by Closed By. It has no name of its own — the schema names it `(not closed)`.
  notClosedId() {
    return dwh.dimensions.closers.createAndLookupId({closed_by_key: "not_closed"},
      {display_name: null, person_type: "Not closed"});
  },

  // Makes two agents of the same name distinguishable in reports.
  updateDuplicateNames(tableName) {
    dwh.dimensions[tableName].updateDuplicateNames({nameColumn: "display_name", addColumn: "email"});
  }
};
