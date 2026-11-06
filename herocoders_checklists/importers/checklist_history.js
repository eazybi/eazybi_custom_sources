// Finds when the checklist items of an issue were completed, by replaying the Checklist Text changes of the
// issue changelog. The changelog has the whole field text before and after every change.
app.importers.checklistHistory = {
  // The Checklist Text changes of the changelog histories, oldest first: [{created, fromString, toString}].
  // Jira Cloud names the changed field by its fieldId, Jira Data Center by its name.
  fieldChanges(histories, fieldIds) {
    var text = (value) => typeof value === "string" ? value : null;
    var changes = [];
    _.sortBy(histories || [], (history) => Number(history.id)).forEach((history) => {
      (history.items || []).forEach((item) => {
        var isChecklistText = item.fieldId ? fieldIds.indexOf(item.fieldId) >= 0 : item.field === app.api.FIELD_NAME;
        if (isChecklistText) {
          changes.push({created: history.created, fromString: text(item.fromString), toString: text(item.toString)});
        }
      });
    });
    return changes;
  },

  // The last completion of every completed item of the current checklists, by the checklist and the item index
  // ("0/2"), as {created} for dwh.lookupTimeId. An item which was completed, then not completed and completed
  // again, is completed by the last change. The items completed before the first change are completed when the
  // issue was created, and the items which no change completed (a changelog without the current value) by the
  // last change.
  completions(issue, checklists, changes, completedStatuses) {
    return this.lastChanges(this.replay(issue, checklists, changes, completedStatuses), "completedBy");
  },

  // The last reopening of every item of the current checklists which was reopened (changed from a completed to a
  // not completed status), by the checklist and the item index, as {created} for dwh.lookupTimeId.
  reopenings(issue, checklists, changes, completedStatuses) {
    return this.lastChanges(this.replay(issue, checklists, changes, completedStatuses), "reopenedBy");
  },

  // The item states of the current checklists after all changes of the field.
  replay(issue, checklists, changes, completedStatuses) {
    var parser = app.importers.checklistParser;
    var created = {created: issue.fields.created};
    var state = this.track(changes.length > 0 ? parser.parse(changes[0].fromString, completedStatuses) : [], {}, created);
    changes.forEach((change) => {
      state = this.track(parser.parse(change.toString, completedStatuses), state, change);
    });
    return this.track(checklists, state, changes.length > 0 ? changes[changes.length - 1] : created);
  },

  lastChanges(state, attribute) {
    var result = {};
    _.each(state.byPosition, (entry, position) => {
      if (entry[attribute]) result[position] = {created: entry[attribute].created};
    });
    return result;
  },

  // The item states of the checklists after a change: {byKey, byPosition} of {key, textKey, completedBy,
  // reopenedBy}, the change of the last completion while the item is completed, and of the last reopening. An
  // item keeps the state of the item at its position when it has the same checklist and text. Otherwise it is
  // found by its checklist, its text and its occurrence of the same text, and an item which is still not found
  // keeps the state of the item at its position which no other item took, which is an item with an edited text.
  track(checklists, previous, change) {
    var entries = [];
    checklists.forEach((checklist, checklistIndex) => {
      var occurrences = {};
      checklist.items.forEach((item, itemIndex) => {
        var textKey = checklist.name + "\u0001" + item.text;
        occurrences[textKey] = (occurrences[textKey] || 0) + 1;
        entries.push({key: textKey + "\u0001" + occurrences[textKey], textKey: textKey,
          position: checklistIndex + "/" + itemIndex, completed: item.completed});
      });
    });

    var byKey = previous.byKey || {}, byPosition = previous.byPosition || {}, taken = {};
    var take = (entry, state) => {
      if (entry.before || !state || taken[state.key]) return;
      entry.before = state;
      taken[state.key] = true;
    };
    entries.forEach((entry) => {
      var atPosition = byPosition[entry.position];
      if (atPosition && atPosition.textKey === entry.textKey) take(entry, atPosition);
    });
    entries.forEach((entry) => take(entry, byKey[entry.key]));
    entries.forEach((entry) => take(entry, byPosition[entry.position]));

    var next = {byKey: {}, byPosition: {}};
    entries.forEach((entry) => {
      var before = entry.before;
      var wasCompleted = Boolean(before && before.completedBy);
      var state = {
        key: entry.key,
        textKey: entry.textKey,
        completedBy: entry.completed ? (before && before.completedBy) || change : null,
        reopenedBy: wasCompleted && !entry.completed ? change : (before && before.reopenedBy) || null
      };
      next.byKey[entry.key] = state;
      next.byPosition[entry.position] = state;
    });
    return next;
  }
};
