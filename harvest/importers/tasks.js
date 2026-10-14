// The tasks of the account — what the time is tracked on, before a project assigns its own rate and
// billable flag to them.
app.importers.tasks = {
  storedById: {},

  importAll() {
    logger.startImport("tasks");
    this.storedById = {};
    var fetchedTasks = app.api.getTasks();
    fetchedTasks.forEach((task) => this.storeTask(task));
    logger.finishImport("tasks", fetchedTasks.length);
  },

  storeTask(task) {
    var memberId = dwh.dimensions.tasks.createAndLookupId({id: task.id}, {
      name: task.name,
      deactivated: !task.is_active,
      billable_by_default: task.billable_by_default,
      is_default: task.is_default,
      hourly_rate: task.default_hourly_rate,
      generation: app.importers.sweep.generation
    });
    this.storedById[String(task.id)] = {id: task.id, memberId: memberId, name: task.name};
    return memberId;
  },

  stored(taskId) {
    return this.storedById[String(taskId)] || null;
  },

  taskIdOf(taskId) {
    var task = this.stored(taskId);
    return task && task.memberId;
  },

  nameOf(taskId) {
    var task = this.stored(taskId);
    return task && task.name;
  }
};
