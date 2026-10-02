// The export fixtures are synthetic Runkeeper exports, see test/importer_test.js.
const EXPORT_URL = "https://files.example.com/runkeeper-export.zip";

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

  test("adds the download parameter to a Dropbox link without one", () => {
    mock.sourceParams({export_url: "https://www.dropbox.com/s/abc/export.zip"});
    expect(app.api.exportUrl()).toBe("https://www.dropbox.com/s/abc/export.zip?dl=1");
  });

  test("turns a Google Drive share link into its direct download link", () => {
    mock.sourceParams({export_url: "https://drive.google.com/file/d/1AbC-dEf_9/view?usp=sharing"});
    expect(app.api.exportUrl()).
      toBe("https://drive.usercontent.google.com/download?id=1AbC-dEf_9&export=download&confirm=t");
  });

  test("downloads a Dropbox link of plain HTTP over HTTPS", () => {
    mock.sourceParams({export_url: "http://www.dropbox.com/s/abc/export.zip"});
    expect(app.api.exportUrl()).toBe("https://www.dropbox.com/s/abc/export.zip?dl=1");
  });

  test("reads the file id of a Google Drive open link", () => {
    mock.sourceParams({export_url: "https://drive.google.com/open?id=1AbC-dEf_9"});
    expect(app.api.exportUrl()).
      toBe("https://drive.usercontent.google.com/download?id=1AbC-dEf_9&export=download&confirm=t");
  });
});

describe("app.api.downloadExport", () => {
  test("finds the entries of the export", () => {
    mockExport("runkeeper_export.zip");

    var exportFile = app.api.downloadExport();

    expect(exportFile.activitiesEntry).toBe("cardioActivities.csv");
    expect(exportFile.heartRateEntry).toBe("heartRate.csv");
    expect(_.keys(exportFile.gpxEntries).sort()).toEqual(["2026-08-10-183000.gpx", "2026-09-24-070332.gpx"]);
    source.deleteFile(exportFile.file);
  });

  test("finds the entries of an export packed in a directory", () => {
    mockExport("runkeeper_export_without_august.zip");

    var exportFile = app.api.downloadExport();

    expect(exportFile.activitiesEntry).toBe("export/cardioActivities.csv");
    expect(exportFile.heartRateEntry).toBeNull();
    expect(exportFile.gpxEntries).toEqual({"2026-09-24-070332.gpx": "export/2026-09-24-070332.gpx"});
    source.deleteFile(exportFile.file);
  });

  test("tells that a ZIP file without cardioActivities.csv is no Runkeeper export", () => {
    mockExport("not_runkeeper.zip");
    expect(() => app.api.downloadExport()).toThrow("has no cardioActivities.csv file");
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
    mock.sourceParams({export_url: "http://files.example.com/runkeeper-export.zip"});
    expect(() => app.api.downloadExport()).toThrow("Enter an HTTPS link");
    expect(mock.requests()).toEqual([]);
  });
});

describe("app.api.testConnection", () => {
  test("requests only the end of the export, which names its entries", () => {
    mockExport("runkeeper_export_without_august.zip");

    expect(app.api.testConnection()).toBeUndefined();
    expect(mock.requests()).toHaveLength(1);
    expect(mock.requests()[0].headers.Range).toBe("bytes=-1048576");
  });

  test("answers the error on the export URL field for a ZIP file which is no Runkeeper export", () => {
    mockExport("not_runkeeper.zip");
    var result = app.api.testConnection();
    expect(result.errors[0].field).toBe("export_url");
    expect(result.errors[0].message).toContain("has no cardioActivities.csv file");
  });

  test("tells that a web page is not the ZIP file", () => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {body: "<html><body>Preview</body></html>", headers: {"Content-Type": "text/html"}});
    expect(app.api.testConnection().errors[0].message).toContain("does not answer a ZIP file");
  });

  test("tells that the file could not be downloaded", () => {
    mock.sourceParams({export_url: EXPORT_URL});
    mock.get(EXPORT_URL, {status: 404, body: "Not found"});
    expect(app.api.testConnection().errors[0].message).toContain("could not be downloaded");
  });

  test("answers the error on the export URL field for a plain HTTP link without requesting it", () => {
    mock.sourceParams({export_url: "http://files.example.com/runkeeper-export.zip"});
    var result = app.api.testConnection();
    expect(result.errors[0].field).toBe("export_url");
    expect(result.errors[0].message).toContain("Enter an HTTPS link");
    expect(mock.requests()).toEqual([]);
  });

  test("accepts a plain HTTP link of the own computer", () => {
    var url = "http://127.0.0.1:8765/runkeeper_export.zip";
    mock.sourceParams({export_url: url});
    mock.get(url, {fixture: "runkeeper_export_without_august.zip", headers: {"Content-Type": "application/zip"}});
    expect(app.api.testConnection()).toBeUndefined();
  });
});

describe("app.api.readTrackLines", () => {
  test("answers the lines of a GPX file, and null for a file which is not in the export", () => {
    mockExport("runkeeper_export.zip");
    var exportFile = app.api.downloadExport();

    var lines = app.api.readTrackLines(exportFile, "2026-09-24-070332.gpx");

    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(lines.filter((line) => line.indexOf("<trkpt") >= 0)).toHaveLength(43);
    expect(app.api.readTrackLines(exportFile, "2025-06-01-090000.gpx")).toBeNull();
    source.deleteFile(exportFile.file);
  });
});
