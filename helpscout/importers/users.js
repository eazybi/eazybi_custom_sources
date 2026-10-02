// The Help Scout users — the agents. Every agent is written into all three people dimensions, so
// that a report grouped by Assignee, Closed By or Agent shows the agent name and job title even
// before that agent appears in an imported conversation.
app.importers.users = {
  PEOPLE_TABLES: [
    {table: "assignees", keyColumn: "assignee_key"},
    {table: "closers", keyColumn: "closed_by_key"},
    {table: "agents", keyColumn: "agent_key"}
  ],

  importAll() {
    logger.startImport("users");
    var users = app.api.getUsers();
    users.forEach((user) => this.storeUser(user));
    app.importers.people.unassignedId();
    app.importers.people.notClosedId();
    logger.finishImport("users", users.length);
  },

  storeUser(user) {
    var person = {id: user.id, type: "user", first: user.firstName, last: user.lastName,
                  email: user.email, jobTitle: user.jobTitle};
    this.PEOPLE_TABLES.forEach((people) =>
      app.importers.people.store(people.table, people.keyColumn, person));
  },

  // Called once at the end of the import, when every person of this import is stored.
  updateDuplicateNames() {
    this.PEOPLE_TABLES.forEach((people) =>
      app.importers.people.updateDuplicateNames(people.table));
  }
};
