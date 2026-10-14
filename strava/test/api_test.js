// The export fixtures are synthetic Strava exports, see test/importer_test.js.
const EXPORT_URL = "https://files.example.com/strava-export.zip";

function mockExport(fixture) {
  mock.sourceParams({export_url: EXPORT_URL});
  mock.get(EXPORT_URL, {fixture: fixture, headers: {"Content-Type": "application/zip"}});
}

describe("app.api.exportUrl", () => {
  test("keeps a direct download link as it is", () => {
    mock.sourceParams({export_url: EXPORT_URL});
    expect(app.api.exportUrl()).toBe(EXPORT_URL);
  });

  test("turns a Dropbox preview link into its download link", () => {
    mock.sourceParams({export_url: "https://www.dropbox.com/scl/fi/abc/export.zip?rlkey=xyz&dl=0"});
    expect(app.api.exportUrl()).toBe("https://www.dropbox.com/scl/fi/abc/export.zip?rlkey=xyz&dl=1");
  });

  test("turns a Google Drive share link into its direct download link", () => {
    mock.sourceParams({export_url: "https://drive.google.com/file/d/1AbC-dEf_9/view?usp=sharing"});
    expect(app.api.exportUrl()).
      toBe("https://drive.usercontent.google.com/download?id=1AbC-dEf_9&export=download&confirm=t");
  });
});

describe("app.api.downloadExport", () => {
  test("finds the entries of the export, only the activity files of the activities directory", () => {
    mockExport("strava_export.zip");

    var exportFile = app.api.downloadExport();

    expect(exportFile.activitiesEntry).toBe("activities.csv");
    expect(exportFile.preferencesEntry).toBe("general_preferences.csv");
    expect(exportFile.activityFileEntries).toEqual({
      "1001.gpx": "activities/1001.gpx",
      "1002.fit.gz": "activities/1002.fit.gz",
      "1003.tcx.gz": "activities/1003.tcx.gz",
      "1004.gpx": "activities/1004.gpx"
    });
    source.deleteFile(exportFile.file);
  });

  test("finds the entries of an export packed in a directory", () => {
    mockExport("strava_export_without_august.zip");

    var exportFile = app.api.downloadExport();

    expect(exportFile.activitiesEntry).toBe("export_123/activities.csv");
    expect(exportFile.preferencesEntry).toBeNull();
    expect(exportFile.activityFileEntries["1001.gpx"]).toBe("export_123/activities/1001.gpx");
    source.deleteFile(exportFile.file);
  });

  test("tells that a ZIP file without activities.csv is no Strava export", () => {
    mockExport("not_strava.zip");
    expect(() => app.api.downloadExport()).toThrow("has no activities.csv file");
  });

  test("tells that a web page is not the ZIP file", () => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {body: "<html><body>Preview</body></html>", headers: {"Content-Type": "text/html"}});
    expect(() => app.api.downloadExport()).toThrow("does not answer a ZIP file");
  });

  test("tells that the file could not be downloaded", () => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {status: 404, body: "Not found"});
    expect(() => app.api.downloadExport()).toThrow("could not be downloaded");
  });

  test("downloads nothing from a plain HTTP link", () => {
    mock.sourceParams({export_url: "http://files.example.com/strava-export.zip"});
    expect(() => app.api.downloadExport()).toThrow("Enter an HTTPS link");
    expect(mock.requests()).toEqual([]);
  });
});

describe("app.api.testConnection", () => {
  test("requests only the end of the export, which names its entries", () => {
    mockExport("strava_export.zip");

    expect(app.api.testConnection()).toBeUndefined();
    expect(mock.requests()).toHaveLength(1);
    expect(mock.requests()[0].headers.Range).toBe("bytes=-1048576");
  });

  test("answers the error on the export URL field for a ZIP file which is no Strava export", () => {
    mockExport("not_strava.zip");
    var result = app.api.testConnection();
    expect(result.errors[0].field).toBe("export_url");
    expect(result.errors[0].message).toContain("has no activities.csv file");
  });

  test("accepts the tail of an export whose central directory is longer than the tail", () => {
    // Only central directory entries and the end record: activities.csv is listed before the tail.
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {body: "PK\u0001\u0002media/photo1.jpgPK\u0001\u0002media/photo2.jpgPK\u0005\u0006"});

    expect(app.api.testConnection()).toBeUndefined();
  });

  test("tells that a whole central directory without activities.csv is no Strava export", () => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {body: "PK\u0003\u0004readme.txtPK\u0001\u0002readme.txtPK\u0005\u0006"});

    expect(app.api.testConnection().errors[0].message).toContain("has no activities.csv file");
  });

  test("answers the error on the export URL field for a plain HTTP link without requesting it", () => {
    mock.sourceParams({export_url: "http://files.example.com/strava-export.zip"});
    var result = app.api.testConnection();
    expect(result.errors[0].message).toContain("Enter an HTTPS link");
    expect(mock.requests()).toEqual([]);
  });
});

describe("app.api.readActivityRows", () => {
  test("answers the rows as arrays of their cells, the header with its repeated column names first", () => {
    mockExport("strava_export.zip");
    var exportFile = app.api.downloadExport();
    var rows = [];

    app.api.readActivityRows(exportFile, (batch) => batch.forEach((row) => rows.push(row)));

    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveLength(103);
    expect(rows[0].filter((name) => name === "Distance")).toHaveLength(2);
    expect([rows[1][0], rows[1][6], rows[1][17]]).toEqual(["1001", "2.05", "2050.0"]);
    source.deleteFile(exportFile.file);
  });
});

describe("app.api.readPreferences", () => {
  test("answers the settings of the athlete, and null for an export without them", () => {
    mockExport("strava_export.zip");
    var exportFile = app.api.downloadExport();
    expect(app.api.readPreferences(exportFile)["Maximum Heartrate"]).toBe("210");
    source.deleteFile(exportFile.file);

    mockExport("strava_export_without_august.zip");
    var otherExportFile = app.api.downloadExport();
    expect(app.api.readPreferences(otherExportFile)).toBeNull();
    source.deleteFile(otherExportFile.file);
  });
});

describe("app.api.readActivityFileLines", () => {
  test("answers the lines of a GPX file and of a gzipped TCX file, and null for a missing file", () => {
    mockExport("strava_export.zip");
    var exportFile = app.api.downloadExport();

    var gpxLines = app.api.readActivityFileLines(exportFile, "1001.gpx");
    var tcxLines = app.api.readActivityFileLines(exportFile, "1003.tcx.gz");

    expect(gpxLines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpxLines.filter((line) => line.indexOf("<trkpt") >= 0)).toHaveLength(207);
    expect(tcxLines.filter((line) => line.indexOf("<Trackpoint>") >= 0)).toHaveLength(301);
    expect(app.api.readActivityFileLines(exportFile, "1006.gpx")).toBeNull();
    source.deleteFile(exportFile.file);
  });
});

describe("app.api.readActivityFileBytes", () => {
  test("answers the gunzipped bytes of a FIT file, and null for a missing file", () => {
    mockExport("strava_export.zip");
    var exportFile = app.api.downloadExport();

    var bytes = app.api.readActivityFileBytes(exportFile, "1002.fit.gz");

    expect(bytes).toHaveLength(1329);
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe(".FIT");
    expect(app.api.readActivityFileBytes(exportFile, "1006.fit")).toBeNull();
    source.deleteFile(exportFile.file);
  });
});
