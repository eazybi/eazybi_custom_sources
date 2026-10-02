var DEVELOPER_ID = "11111111-2222-3333-4444-555555555555";
var BASE = "/marketplace/rest/3";
var LICENSES_EXPORT_PATH =
  `${BASE}/reporting/developer-space/${DEVELOPER_ID}/licenses/async/export`;
var LICENSES_EXPORT_ID = "aaaa1111-bbbb-2222-cccc-333333333333";

// An importer of two rows per record, which writes the record key of each row — enough to see
// which rows of which record reached which importRows call.
function twoRowImporter() {
  app.importers.testRecords = {
    MEASURES_TABLE: "licenses",
    importOne(record, rows) {
      rows.push({_source_id: record.key, _source_name: "license", licenses: 1});
      rows.push({_source_id: record.key, _source_name: "license", licenses_ending: 1});
      return 1;
    }
  };
  return app.importers.testRecords;
}

describe("app.importers.exports", () => {
  beforeEach(() => {
    mock.sourceParams({developer_id: DEVELOPER_ID, username: "vendor@example.com",
                       api_token: "secret-token"});
    mock.extraOptions({time_dimension_time_zone: "UTC"});
    importRun.prepare();
    mock.post(LICENSES_EXPORT_PATH, {fixture: "licenses_export_started"});
    mock.get(`${LICENSES_EXPORT_PATH}/${LICENSES_EXPORT_ID}/status`,
      {fixture: "licenses_export_completed"});
    mock.get(`${LICENSES_EXPORT_PATH}/${LICENSES_EXPORT_ID}`, {fixture: "licenses_export.csv"});
  });

  test("reads the export and reports its progress", () => {
    var imported = app.importers.exports.run(DEVELOPER_ID, "licenses", {accept: "csv"},
      app.importers.licenses);

    expect(imported).toBe(15);
    expect(importRun.statusMessages()).toContain("Preparing the licenses export");
    expect(importRun.statusMessages()).toContain("Importing licenses, 15 read of 15 (100%)");
  });

  test("fails the import when the Marketplace answers no export id", () => {
    mock.post(LICENSES_EXPORT_PATH, {json: {_links: {}}});

    expect(() => app.importers.exports.run(DEVELOPER_ID, "licenses", {accept: "csv"},
      app.importers.licenses)).toThrow("licenses export was not started");
  });

  // eazyBI compares the rows of one record with the stored rows of the same record and deletes
  // what is not in the call, so all rows of a record have to reach it in one call — also when the
  // record straddles the boundary of two batches of the downloaded file.
  describe("holdBackLastScope", () => {
    test("takes the rows of the last record out of the batch", () => {
      var rows = [
        {_source_id: "a", licenses: 1},
        {_source_id: "b", licenses: 1},
        {_source_id: "b", licenses_ending: 1}
      ];

      var held = app.importers.exports.holdBackLastScope(rows);

      expect(rows).toEqual([{_source_id: "a", licenses: 1}]);
      expect(held).toEqual([{_source_id: "b", licenses: 1},
                            {_source_id: "b", licenses_ending: 1}]);
    });

    test("holds back everything when the whole batch is one record", () => {
      var rows = [{_source_id: "a", licenses: 1}, {_source_id: "a", licenses_ending: 1}];

      expect(app.importers.exports.holdBackLastScope(rows)).toHaveLength(2);
      expect(rows).toEqual([]);
    });

    test("holds back nothing of an empty batch", () => {
      var rows = [];

      expect(app.importers.exports.holdBackLastScope(rows)).toEqual([]);
      expect(rows).toEqual([]);
    });
  });

  // The rows of a record split over two batches must not be written by two calls: the second call
  // would delete the rows of the first one and the record would lose half of its data.
  test("writes the rows of a record split over two batches in one call", () => {
    var importer = twoRowImporter();
    // The reader yields the records in batches; the second row of "b" arrives in the next batch.
    mock.spyOn(app.api, "downloadExport").mockImplementation(
      (developerId, kind, exportId, batchCallback) => {
        batchCallback([{key: "a"}, {key: "b"}], {processed: 2, total: 3});
        batchCallback([{key: "b"}, {key: "c"}], {processed: 4, total: 3});
      });
    var importRows = mock.spyOn(dwh.measures.licenses, "importRows");

    app.importers.exports.run(DEVELOPER_ID, "licenses", {accept: "csv"}, importer);

    // Every call holds all the rows of the records it writes, and no record is written twice.
    var writtenIds = importRows.mock.calls.map((call) =>
      _.uniq(call[0].map((row) => row._source_id)));
    expect(writtenIds).toEqual([["a"], ["b"], ["c"]]);
    expect(_.flatten(writtenIds)).toEqual(_.uniq(_.flatten(writtenIds)));
    // The four rows of the record that straddles the boundary are written together.
    var rowsOfB = _.find(importRows.mock.calls, (call) => call[0][0]._source_id === "b")[0];
    expect(rowsOfB).toHaveLength(4);
  });
});
