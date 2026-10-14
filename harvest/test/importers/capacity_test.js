var STARTED_AT = "2026-12-20T10:00:00Z";
// The last day of the capacity as the import answers it, before any test pins it.
var LAST_DAY_OF = app.importers.capacity.lastDayOf;

// A Harvest user created on Monday, 21 December 2026, available 35 hours a week.
function user(attributes) {
  var record = {id: 312294, first_name: "Riley", last_name: "Smith", is_active: true,
                weekly_capacity: 126000, created_at: "2026-12-21T09:00:00Z", roles: []};
  for (var key in attributes) record[key] = attributes[key];
  return record;
}

// Imports the people and their capacity the way a check for deleted records does after its time entries,
// which `tracked` lists as [user id, spent date] pairs, and removes the rows of the previous check.
function importCapacity(users, options) {
  options = options || {};
  // The tests which import the fixture account pin the last day of the capacity, and a spy stays for the
  // test files after them.
  mock.spyOn(app.importers.capacity, "lastDayOf").mockImplementation(LAST_DAY_OF);
  mock.sourceParams({api_token: "secret-token"});
  mock.get("https://id.getharvest.com/api/v2/accounts",
    {json: {accounts: [{id: "1234567", name: "Acme", product: "harvest"}]}});
  mock.extraOptions(Object.assign({time_dimension_time_zone: "UTC"}, options.extraOptions));
  mock.get("/v2/users", {json: {users: users}});
  importRun.prepare();
  var sweep = app.importers.sweep;
  sweep.sweeping = options.sweeping !== false;
  sweep.generation = options.generation || 1;
  app.importers.workingTimes.readNonWorkingDays();
  app.importers.users.importAll();
  (options.tracked || []).forEach((pair) => app.importers.users.noteTracked(pair[0], pair[1]));
  if (options.failure) source.warnings.addObjectFailure("time entry/99", "Import of time entry 99 failed");
  app.importers.capacity.importAll(options.startedAt || STARTED_AT);
  if (sweep.sweeping && !options.failure) {
    sweep.deleteGenerations([sweep.otherGeneration(sweep.generation), null]);
  }
  importRun.finish();
}

function capacityRows(columns) {
  return dwh.measures.timesheets.rows({
    columns: ["_source_id", "_source_name", "time_id"].concat(columns || []),
    orderBy: ["_source_id", "time_id"]
  }).filter((row) => row._source_name === "custom_harvest capacity");
}

// The capacity rows of a person as [date, hours] pairs, in the order of the days.
function capacityByDay(userId) {
  var dates = _.object(_.range(0, 730).map((offset) => {
    var date = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().substring(0, 10);
    return [dwh.lookupDateId(date), date];
  }));
  return _.sortBy(capacityRows(["person_id", "capacity_hours"]).
    filter((row) => row.person_id === userId).
    map((row) => [dates[row.time_id], row.capacity_hours]), (day) => day[0]);
}

function personValues(userId, columns) {
  return _.detect(dwh.dimensions.people.rows({columns: ["id"].concat(columns)}), (row) => row.id === userId);
}

describe("app.importers.capacity", () => {
  test("writes the daily share of the weekly capacity on every working day until the end of the year", () => {
    importCapacity([user()]);

    expect(capacityByDay(312294)).toEqual([
      ["2026-12-21", 7], ["2026-12-22", 7], ["2026-12-23", 7], ["2026-12-24", 7], ["2026-12-25", 7],
      ["2026-12-28", 7], ["2026-12-29", 7], ["2026-12-30", 7], ["2026-12-31", 7]
    ]);
    expect(importRun.maxParams().capacity_year).toBe("2026");
  });

  test("writes a row of the person and the day only, in a scope of the person and the year", () => {
    importCapacity([user()]);

    var row = _.detect(capacityRows(["person_id", "project_id", "project_task_id", "task_id",
      "approval_status_id", "working_time_id", "external_item_id", "currency_id", "hours"]),
      (capacityRow) => capacityRow.time_id === dwh.lookupDateId("2026-12-21"));
    expect(row).toEqual({
      _source_id: "312294/2026", _source_name: "custom_harvest capacity",
      time_id: dwh.lookupDateId("2026-12-21"), person_id: 312294, project_id: null, project_task_id: null,
      task_id: null, approval_status_id: null, working_time_id: null, external_item_id: null,
      currency_id: null, hours: null
    });
  });

  test("spreads the weekly capacity over the working weekdays and skips the non-working dates", () => {
    importCapacity([user()], {extraOptions: {time_dimension_non_working_weekdays: "7",
                                             time_dimension_additional_non_working_days: "2026-12-25"}});

    // 35 hours over the six days from Monday to Saturday.
    expect(capacityByDay(312294)).toEqual([
      ["2026-12-21", 5.8333], ["2026-12-22", 5.8333], ["2026-12-23", 5.8333], ["2026-12-24", 5.8333],
      ["2026-12-26", 5.8333], ["2026-12-28", 5.8333], ["2026-12-29", 5.8333], ["2026-12-30", 5.8333],
      ["2026-12-31", 5.8333]
    ]);
  });

  test("gives a person who is no longer active capacity until the last day with tracked time", () => {
    importCapacity([user({is_active: false}), user({id: 312875, first_name: "Chuck", is_active: false})],
      {tracked: [[312294, "2026-12-22"], [312294, "2026-12-23"], [312294, "2026-12-21"]]});

    expect(capacityByDay(312294)).toEqual([["2026-12-21", 7], ["2026-12-22", 7], ["2026-12-23", 7]]);
    // Without tracked time a person who is not active has no capacity.
    expect(capacityByDay(312875)).toEqual([]);
  });

  test("starts on the first day with tracked time when it is before the person was created", () => {
    importCapacity([user({created_at: "2026-12-30T09:00:00Z"})], {tracked: [[312294, "2026-12-24"]]});

    expect(capacityByDay(312294)).toEqual([
      ["2026-12-24", 7], ["2026-12-25", 7], ["2026-12-28", 7], ["2026-12-29", 7], ["2026-12-30", 7],
      ["2026-12-31", 7]
    ]);
  });

  test("writes no capacity of a person without a weekly capacity", () => {
    importCapacity([user({weekly_capacity: null}),
                    user({id: 312875, first_name: "Chuck", weekly_capacity: 0})]);

    expect(capacityRows()).toEqual([]);
  });

  test("replaces the rows when the capacity changes and removes them when it is gone", () => {
    importCapacity([user()]);
    importCapacity([user({weekly_capacity: 72000})], {generation: 2});
    expect(_.uniq(capacityByDay(312294).map((day) => day[1]))).toEqual([4]);

    importCapacity([user({weekly_capacity: null})], {generation: 1});
    expect(capacityRows()).toEqual([]);
  });

  test("gives unchanged rows the generation of the check instead of writing them again", () => {
    importCapacity([user()]);
    var writeBatch = mock.spyOn(app.importers.rows, "writeTimesheetBatch");

    importCapacity([user()], {generation: 2});

    expect(writeBatch.mock.calls.filter((call) => call[0].length > 0)).toEqual([]);
    expect(_.uniq(capacityRows(["generation"]).map((row) => row.generation))).toEqual([2]);
    expect(capacityByDay(312294)).toHaveLength(9);
  });

  test("writes the rows again when the stored ones are gone", () => {
    importCapacity([user()]);
    dwh.measures.timesheets.deleteRows({_source_name: "capacity"});

    importCapacity([user()], {generation: 2});

    expect(capacityByDay(312294)).toHaveLength(9);
  });

  // The rows of the other capacity are written, but not the digest of them.
  test("writes the rows again after an interrupted check changed them and the capacity changed back", () => {
    importCapacity([user()]);
    var writeBatch = mock.spyOn(app.importers.rows, "writeTimesheetBatch");
    writeBatch.mockImplementation((rows) => {
      dwh.measures.timesheets.importRows(rows.map((row) => Object.assign({generation: 2}, row)));
      throw new Error("Interrupted");
    });
    expect(() => importCapacity([user({weekly_capacity: 72000})], {generation: 2})).toThrow("Interrupted");
    writeBatch.mockRestore();

    importCapacity([user()], {generation: 2});

    expect(_.uniq(capacityByDay(312294).map((day) => day[1]))).toEqual([7]);
  });

  // The retry writes the generation the interrupted check wrote its rows with, so they would survive it.
  test("removes the rows an interrupted check wrote when the retry has no capacity", () => {
    importCapacity([user()]);
    var writeBatch = mock.spyOn(app.importers.rows, "writeTimesheetBatch");
    writeBatch.mockImplementation((rows) => {
      dwh.measures.timesheets.importRows(rows.map((row) => Object.assign({generation: 2}, row)));
      throw new Error("Interrupted");
    });
    expect(() => importCapacity([user({weekly_capacity: 72000})], {generation: 2})).toThrow("Interrupted");
    writeBatch.mockRestore();

    importCapacity([user({weekly_capacity: 0})], {generation: 2});

    expect(capacityRows()).toEqual([]);
  });

  test("adds the days of a new year in a scope of their own", () => {
    importCapacity([user()]);
    importCapacity([user()], {generation: 2, startedAt: "2027-01-04T10:00:00Z"});

    expect(_.last(capacityByDay(312294))).toEqual(["2027-12-31", 7]);
    expect(capacityByDay(312294)).toHaveLength(9 + 261);
    expect(_.uniq(capacityRows().map((row) => row._source_id))).toEqual(["312294/2026", "312294/2027"]);
  });

  test("leaves the capacity as it is with an import which does not check for deleted records", () => {
    importCapacity([user()]);
    importCapacity([user({weekly_capacity: 72000})], {sweeping: false});

    expect(_.uniq(capacityByDay(312294).map((day) => day[1]))).toEqual([7]);
  });

  test("leaves the capacity as it is when a record failed to import", () => {
    importCapacity([user({is_active: false})], {tracked: [[312294, "2026-12-23"]]});
    importCapacity([user({is_active: false})], {generation: 2, failure: true});

    expect(capacityByDay(312294)).toEqual([["2026-12-21", 7], ["2026-12-22", 7], ["2026-12-23", 7]]);
    expect(importRun.log().join("\n")).toContain("The capacity of the people is not written by this import");
  });

  test("stores the weekly capacity of a person in hours", () => {
    importCapacity([user({weekly_capacity: 100000})]);

    expect(personValues(312294, ["weekly_capacity_hours"])).
      toEqual({id: 312294, weekly_capacity_hours: 27.7778});
  });

  test("stores the first and the last day every person tracked time on", () => {
    importCapacity([user(), user({id: 312875, first_name: "Chuck"})],
      {tracked: [[312294, "2026-12-22"], [312294, "2026-12-24"], [312294, "2026-12-21"]]});

    expect(personValues(312294, ["first_tracked_date", "last_tracked_date"])).
      toEqual({id: 312294, first_tracked_date: "2026-12-21", last_tracked_date: "2026-12-24"});
    expect(personValues(312875, ["first_tracked_date", "last_tracked_date"])).
      toEqual({id: 312875, first_tracked_date: null, last_tracked_date: null});
  });

  test("makes the first import of a new year a check for deleted records", () => {
    mock.maxParams({capacity_year: "2026"});
    importRun.prepare();

    expect(app.importers.capacity.yearDue("2026-12-31T23:00:00Z")).toBe(false);
    expect(app.importers.capacity.yearDue("2027-01-01T01:00:00Z")).toBe(true);
  });
});
