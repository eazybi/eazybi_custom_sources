// The Harvest users — the people of the Person dimension — and the roles they are listed under. The
// roles are rows of the person, which the Role dimension joins to the timesheet rows by their person, so
// every row of a person is reported under the roles the person has now.
app.importers.users = {
  // The member a person without a Harvest role is reported under, so that the hours of everybody are
  // still there when the Role dimension is on the report rows.
  NO_ROLE: "(no role)",

  storedById: {},
  nameCounts: {},
  // The first and the last day with tracked time of every user the time entries this import read name,
  // [first, last] by the user id. They are all the days only when the import checks for deleted records,
  // which reads every time entry (importers/capacity.js).
  trackedDays: {},

  importAll() {
    logger.startImport("people");
    this.storedById = {};
    this.trackedDays = {};
    var fetchedUsers = app.api.getUsers();
    this.nameCounts = _.countBy(fetchedUsers, (user) => this.displayName(user).toLowerCase());
    fetchedUsers.forEach((user) => this.storeUser(user));
    // Two people of the same name would be one member otherwise, and the hours of both would land on
    // it; the built-in Harvest application appends the Harvest id the same way.
    dwh.dimensions.people.updateDuplicateNames({nameColumn: "name", addNumericColumn: "id"});
    logger.finishImport("people", fetchedUsers.length);
  },

  storeUser(user) {
    var name = this.displayName(user);
    var memberId = dwh.dimensions.people.createAndLookupId({id: user.id}, {
      name: name,
      // The Type level of the Person dimension, which Harvest tells apart by the contractor flag.
      person_type: user.is_contractor ? "Contractors" : "Employees",
      is_active: user.is_active,
      is_contractor: user.is_contractor,
      // Harvest answers the weekly capacity in seconds.
      weekly_capacity_hours: this.hoursOf(user.weekly_capacity),
      default_hourly_rate: user.default_hourly_rate,
      cost_rate: user.cost_rate,
      created_at: dwh.dateValue(user, "created_at"),
      email: user.email,
      generation: app.importers.sweep.generation
    });
    this.storeRoles(user, memberId);
    this.storedById[String(user.id)] = {
      id: user.id, memberId: memberId, name: name, weeklyCapacity: user.weekly_capacity,
      isActive: user.is_active !== false, createdDate: dwh.dateValue(user, "created_at")
    };
    return memberId;
  },

  hoursOf(seconds) {
    if (seconds === null || seconds === undefined) return null;
    return seconds / app.importers.capacity.SECONDS_PER_HOUR;
  },

  each(callback) {
    _.values(this.storedById).forEach(callback);
  },

  // Called with the user and the day of every time entry with hours which this import read.
  noteTracked(userId, date) {
    if (!userId || !date) return;
    var key = String(userId), days = this.trackedDays[key];
    this.trackedDays[key] = days ? [days[0] < date ? days[0] : date, days[1] > date ? days[1] : date] :
      [date, date];
  },

  firstTrackedDateOf(userId) {
    var days = this.trackedDays[String(userId)];
    return days ? days[0] : null;
  },

  lastTrackedDateOf(userId) {
    var days = this.trackedDays[String(userId)];
    return days ? days[1] : null;
  },

  storeTrackedDays(person) {
    dwh.dimensions.people.update({first_tracked_date: this.firstTrackedDateOf(person.id),
                                  last_tracked_date: this.lastTrackedDateOf(person.id)},
      {id: person.memberId});
  },

  displayName(user) {
    var name = [user.first_name, user.last_name].filter((part) => part).join(" ").trim();
    return name || user.email || `Person ${user.id}`;
  },

  // A check for deleted records writes the rows of every person again, so that they carry its generation
  // and the rows of a person Harvest no longer lists are the only ones it removes. Any other import writes
  // them only when the roles changed.
  storeRoles(user, personId) {
    var roleNames = this.roleNamesOf(user);
    if (!app.importers.sweep.sweeping && this.storedRolesMatch(personId, roleNames)) return;

    var generation = app.importers.sweep.generation;
    dwh.dimensions.person_roles.deleteRows({person_id: personId});
    dwh.dimensions.person_roles.insertRows(roleNames.map((roleName) =>
      ({person_id: personId, name: roleName, generation: generation})));
  },

  // A role stored twice for a person would count the hours of the person twice under it.
  roleNamesOf(user) {
    var roleNames = _.uniq(user.roles || []);
    return roleNames.length > 0 ? roleNames : [this.NO_ROLE];
  },

  // The stored rows cannot be listed, so they are counted: one row of every role and no other row.
  storedRolesMatch(personId, roleNames) {
    var personRoles = dwh.dimensions.person_roles;
    return personRoles.selectCount({person_id: personId}) === roleNames.length &&
      roleNames.every((roleName) => personRoles.selectCount({person_id: personId, name: roleName}) === 1);
  },

  stored(userId) {
    return this.storedById[String(userId)] || null;
  },

  personIdOf(userId) {
    var person = this.stored(userId);
    return person && person.memberId;
  },

  nameOf(userId) {
    var person = this.stored(userId);
    return person && person.name;
  },

  // The name of the person as the Person dimension shows it: a name which several people have gets the
  // Harvest id of the person appended, the way updateDuplicateNames appends it to the Person member, so
  // that two managers of the same name are two members. Any other name stays as it is.
  uniqueNameOf(userId) {
    var name = this.nameOf(userId);
    if (!name || (this.nameCounts[name.toLowerCase()] || 0) < 2) return name;

    return `${name} (${userId})`;
  }
};
