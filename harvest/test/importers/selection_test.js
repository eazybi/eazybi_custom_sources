var PROJECTS = [
  {id: 1930103, name: "eazyBI development", client: {id: 915259, name: "eazyBI"}},
  {id: 1930099, name: "Internal", client: {id: 915259, name: "eazyBI"}},
  {id: 1930115, name: "Consulting for Small European company",
   client: {id: 915262, name: "Small European company"}}
];

function begin(selection) {
  mock.sourceSelection(selection);
  importRun.prepare();
  app.importers.selection.begin(PROJECTS);
  return app.importers.selection;
}

// The keys of `count` projects, which do not fit into one max param.
function manyProjectKeys(count) {
  return _.range(count).map((index) => `project/${10000000 + index}`);
}

describe("app.importers.selection", () => {
  describe("begin", () => {
    test("includes every project and client when all projects are selected", () => {
      var selection = begin(["project/1930103", "(all)"]);

      expect(selection.all).toBe(true);
      expect(selection.keys).toEqual(["(all)"]);
      expect(selection.includesProject(4242)).toBe(true);
      expect(selection.includesClient(915261)).toBe(true);
    });

    test("includes the selected projects and the clients they belong to", () => {
      var selection = begin(["project/1930115", "project/1930103"]);

      expect(selection.all).toBe(false);
      expect(selection.keys).toEqual(["project/1930103", "project/1930115"]);
      expect(selection.includesProject(1930103)).toBe(true);
      expect(selection.includesProject("1930115")).toBe(true);
      expect(selection.includesProject(1930099)).toBe(false);
      expect(selection.includesClient(915259)).toBe(true);
      expect(selection.includesClient(915262)).toBe(true);
      expect(selection.includesClient(915261)).toBe(false);
    });

    test("ignores a selected project which is not in the projects list with one log line", () => {
      var selection = begin(["project/1930103", "project/4242", "project/4343"]);

      expect(_.keys(selection.projectIds)).toEqual(["1930103"]);
      expect(importRun.log().filter((line) => line.indexOf("Harvest no longer lists") >= 0)).
        toHaveLength(1);
      expect(importRun.log().join("\n")).toContain("not imported: project/4242, project/4343");
      expect(importRun.objectFailures()).toEqual([]);
    });
  });

  describe("requestedProjectIds", () => {
    test("requests the selected projects one by one for a full read", () => {
      expect(begin(["project/1930115", "project/1930103"]).requestedProjectIds(null)).
        toEqual(["1930103", "1930115"]);
    });

    test("requests the whole account for all projects, for the changes and above the limit", () => {
      expect(begin(["(all)"]).requestedProjectIds(null)).toEqual([null]);
      expect(begin(["project/1930103"]).requestedProjectIds("2026-01-01T00:00:00Z")).toEqual([null]);

      var maxProjectRequests = app.importers.selection.MAX_PROJECT_REQUESTS;
      app.importers.selection.MAX_PROJECT_REQUESTS = 1;
      try {
        expect(begin(["project/1930103", "project/1930115"]).requestedProjectIds(null)).toEqual([null]);
      } finally {
        app.importers.selection.MAX_PROJECT_REQUESTS = maxProjectRequests;
      }
    });

    test("requests nothing when no selected project is in the projects list", () => {
      expect(begin(["project/4242"]).requestedProjectIds(null)).toEqual([]);
    });
  });

  // A max param holds at most 1000 characters, which is some 60 project keys.
  describe("the stored selection", () => {
    test("is the keys of the selection while they fit into one max param, and their digest then", () => {
      var selection = app.importers.selection;

      expect(selection.paramValue(["project/1", "project/2"])).toBe("project/1,project/2");
      expect(selection.paramValue(manyProjectKeys(100))).toMatch(/^100 projects #[0-9a-f]+$/);
      expect(selection.paramValue(manyProjectKeys(100))).
        not.toBe(selection.paramValue(manyProjectKeys(99).concat(["project/20000000"])));
    });

    test("tells a project taken out of a selection too long for one max param", () => {
      var keys = manyProjectKeys(100);
      mock.maxParams({selection: app.importers.selection.paramValue(keys)});

      mock.sourceSelection(_.shuffle(keys));
      importRun.prepare();
      expect(app.importers.selection.deselected()).toBe(false);

      mock.sourceSelection(keys.slice(1));
      importRun.prepare();
      expect(app.importers.selection.deselected()).toBe(true);
    });

    test("is stored by finish, with the keys of the projects Harvest no longer lists", () => {
      mock.maxParams({selection: "project/1930103"});
      begin(["project/4242", "project/1930103"]);

      app.importers.selection.finish();
      importRun.finish();

      expect(importRun.maxParams().selection).toBe("project/1930103,project/4242");
    });
  });

  describe("the stored clients", () => {
    test("are the clients of the selected projects, sorted by id", () => {
      expect(begin(["project/1930115", "project/1930103"]).clientsParamValue()).toBe("915259,915262");
      expect(begin(["project/1930099", "project/1930103"]).clientsParamValue()).toBe("915259");
    });

    test("are all with all projects and none when Harvest lists no selected project", () => {
      expect(begin(["(all)"]).clientsParamValue()).toBe("(all)");
      expect(begin(["project/4242"]).clientsParamValue()).toBe("none");
    });

    test("tell a selected project which was moved to another client", () => {
      mock.maxParams({selection: "project/1930103", selection_clients: "915259"});
      expect(begin(["project/1930103"]).clientsChanged()).toBe(false);

      app.importers.selection.begin([
        {id: 1930103, name: "eazyBI development", client: {id: 915262, name: "Small European company"}}
      ]);
      expect(app.importers.selection.clientsChanged()).toBe(true);
    });

    test("tell the last selected project of a client which Harvest no longer lists", () => {
      mock.maxParams({selection: "project/1930103,project/1930115", selection_clients: "915259,915262"});
      begin(["project/1930103", "project/1930115"]);

      app.importers.selection.begin(PROJECTS.filter((project) => project.id !== 1930115));
      expect(app.importers.selection.clientsChanged()).toBe(true);
    });

    test("count as changed when only the selection is stored, and not when nothing is", () => {
      mock.maxParams({selection: "project/1930103"});
      expect(begin(["project/1930103"]).clientsChanged()).toBe(true);

      mock.maxParams({});
      expect(begin(["project/1930103"]).clientsChanged()).toBe(false);
    });

    test("do not change with all projects", () => {
      mock.maxParams({selection: "(all)"});

      expect(begin(["(all)"]).clientsChanged()).toBe(false);
    });

    test("are stored by finish", () => {
      begin(["project/1930115", "project/1930103"]);

      app.importers.selection.finish();
      importRun.finish();

      expect(importRun.maxParams()).toMatchObject({selection: "project/1930103,project/1930115",
                                                   selection_clients: "915259,915262"});
    });
  });
});
