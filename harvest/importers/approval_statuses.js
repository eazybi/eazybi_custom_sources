// The three states a Harvest timesheet approval leaves a time entry or an expense in. Harvest reports the
// state as the `approval_status` of the record itself and has no endpoint for the states, so the members
// are written by the import. The ids of the first two are the ids of the Unapproved and the Approved
// members of the earlier versions, which reported only the deprecated `is_closed` flag.
app.importers.approvalStatuses = {
  STATES: [
    {status: "unsubmitted", id: 0, name: "Unsubmitted"},
    {status: "approved", id: 1, name: "Approved"},
    {status: "submitted", id: 2, name: "Submitted"}
  ],

  idsByStatus: {},

  importAll() {
    logger.startImport("approval statuses");
    var generation = app.importers.sweep.generation;
    this.idsByStatus = {};
    this.STATES.forEach((state) => {
      this.idsByStatus[state.status] = dwh.dimensions.approval_statuses.createAndLookupId({id: state.id},
        {name: state.name, generation: generation});
    });
    logger.finishImport("approval statuses", this.STATES.length);
  },

  // A record of an account which does not use timesheet approval carries no state and gets no member.
  lookupId(record) {
    var id = this.idsByStatus[this.statusOf(record)];
    return id === undefined ? null : id;
  },

  // A record without `approval_status` still carries `is_closed`, which tells only whether it is approved.
  statusOf(record) {
    if (record.approval_status) return record.approval_status;
    if (record.is_closed === true) return "approved";
    if (record.is_closed === false) return "unsubmitted";
    return null;
  }
};
