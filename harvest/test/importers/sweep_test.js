var CHECKED_AT = "2026-09-22T03:00:05Z";

function sweepDue(importStartedAt, options) {
  importRun.prepare(options);
  return app.importers.sweep.sweepDue(importStartedAt);
}

function begin(importStartedAt, options) {
  importRun.prepare(options);
  app.importers.sweep.begin(importStartedAt);
  return {sweeping: app.importers.sweep.sweeping, generation: app.importers.sweep.generation};
}

// Two projects of one client, and whether an import of a selection of them on the day of the last check
// checks.
var PROJECTS = [
  {id: 1, name: "Website", client: {id: 10, name: "Alpha"}},
  {id: 2, name: "Support", client: {id: 10, name: "Alpha"}}
];

function sweepDueOf(selection, projects) {
  mock.sourceSelection(selection);
  importRun.prepare();
  app.importers.selection.begin(projects || PROJECTS);
  return app.importers.sweep.sweepDue(CHECKED_AT);
}

describe("app.importers.sweep", () => {
  describe("sweepDue", () => {
    test("checks with the first import", () => {
      expect(sweepDue(CHECKED_AT)).toBe(true);
    });

    test("checks every day with the first import of a later day", () => {
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT});

      expect(sweepDue("2026-09-22T23:59:59Z")).toBe(false);
      expect(sweepDue("2026-09-23T02:59:00Z")).toBe(true);
    });

    test("checks every week with the first import seven days later", () => {
      mock.extraOptions({deleted_records_check: "weekly"});
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT});

      expect(sweepDue("2026-09-28T23:59:59Z")).toBe(false);
      expect(sweepDue("2026-09-29T00:00:00Z")).toBe(true);
    });

    test("checks only with a full reimport when the option says so", () => {
      mock.extraOptions({deleted_records_check: "reimport"});
      mock.maxParams({generation: 1, sweep_at: "2025-01-01T00:00:00Z"});

      expect(sweepDue(CHECKED_AT)).toBe(false);
      expect(sweepDue(CHECKED_AT, {reimport: true})).toBe(true);
    });

    test("checks with a full reimport also on the day of the last check", () => {
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT});

      expect(sweepDue(CHECKED_AT, {reimport: true})).toBe(true);
    });

    test("checks on the day of the last check when a project was taken out of the selection", () => {
      mock.extraOptions({deleted_records_check: "reimport"});
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, selection: "project/1,project/2",
                      selection_clients: "10"});

      expect(sweepDueOf(["project/1"])).toBe(true);
    });

    test("checks when a selection of projects replaced all projects", () => {
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, selection: "(all)", selection_clients: "(all)"});

      expect(sweepDueOf(["project/1"])).toBe(true);
    });

    test("checks on the day of the last check when another client has selected projects", () => {
      mock.extraOptions({deleted_records_check: "reimport"});
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, selection: "project/1", selection_clients: "10"});

      expect(sweepDueOf(["project/1"], [{id: 1, name: "Website", client: {id: 20, name: "Beta"}}])).
        toBe(true);
      expect(sweepDueOf(["project/1"])).toBe(false);
    });

    test("checks for a selection whose clients are not stored", () => {
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, selection: "project/1"});

      expect(sweepDueOf(["project/1"])).toBe(true);
    });

    test("does not check for the same selection, however ordered, nor for all projects", () => {
      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, selection: "project/1,project/2",
                      selection_clients: "10"});

      expect(sweepDueOf(["project/2", "project/1"])).toBe(false);
      expect(sweepDueOf(["(all)", "project/1"])).toBe(false);
    });

    test("checks with the two imports after a check which removed nothing", () => {
      mock.extraOptions({deleted_records_check: "reimport"});

      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, sweep_pending: 2});
      expect(sweepDue(CHECKED_AT)).toBe(true);

      mock.maxParams({generation: 2, sweep_at: CHECKED_AT, sweep_pending: 1});
      expect(sweepDue(CHECKED_AT)).toBe(true);

      mock.maxParams({generation: 1, sweep_at: CHECKED_AT, sweep_pending: 0});
      expect(sweepDue(CHECKED_AT)).toBe(false);
    });
  });

  describe("begin", () => {
    test("writes the generation of the last check with an import which does not check", () => {
      mock.maxParams({updated_at: CHECKED_AT, generation: 2, sweep_at: CHECKED_AT});

      expect(begin(CHECKED_AT)).toEqual({sweeping: false, generation: 2});
    });

    test("writes the other generation than the last check with a check", () => {
      mock.maxParams({updated_at: CHECKED_AT, generation: 2, sweep_at: "2026-09-21T03:00:00Z"});

      expect(begin(CHECKED_AT)).toEqual({sweeping: true, generation: 1});
    });

    test("writes generation 1 with the first check", () => {
      expect(begin(CHECKED_AT)).toEqual({sweeping: true, generation: 1});
    });

    test("reads the generation of the stored rows when a full reimport cleared it", () => {
      dwh.dimensions.approval_statuses.insert({id: 0, name: "Unapproved", generation: 1});

      expect(begin(CHECKED_AT, {reimport: true})).toEqual({sweeping: true, generation: 2});
    });
  });
});
