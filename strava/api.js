// The Strava account export: a ZIP file which the user requests on the Strava website at strava.com/account
// and shares at a direct download URL, the `export_url` source param. It holds activities.csv with one row
// per activity, the original file of every recorded activity in the activities/ directory — GPX, TCX or
// FIT, often gzipped — and general_preferences.csv with the settings of the athlete. The rest of the
// export — contacts, messages, media and the other account data — is never read.
//
// The URL is the base URL of the connection, so the file may be on any host and is downloaded without
// credentials. The share links of Dropbox and Google Drive open a preview page instead of the file, so
// they are turned into their direct download links first.
app.api = {
  ACTIVITIES_ENTRY: "activities.csv",
  PREFERENCES_ENTRY: "general_preferences.csv",
  // The activity files of the export: activities/12345678901.gpx, .gpx.gz, .tcx.gz or .fit.gz.
  ACTIVITY_FILE_PATTERN: /\.(gpx|tcx|fit)(\.gz)?$/i,

  // The end of a ZIP file which the connection test requests: the central directory, which names every
  // entry of the archive, comes last and is followed by the end of central directory record. 1 MB holds
  // the central directory of an export with more than ten thousand files.
  ZIP_TAIL_BYTES: 1048576,
  END_OF_CENTRAL_DIRECTORY_SIGNATURE: "PK\u0005\u0006",
  LOCAL_FILE_HEADER_SIGNATURE: "PK\u0003\u0004",

  DOWNLOAD_FAILED_MESSAGE: "The export file could not be downloaded from the URL. Check that the link is " +
    "shared with anyone who has it and that it has not expired.",
  INSECURE_URL_MESSAGE: "Enter an HTTPS link of the export file: the export holds your GPS tracks, heart " +
    "rates and contacts, which a plain HTTP link would send unencrypted.",
  NOT_ZIP_MESSAGE: "The URL does not answer a ZIP file. Enter a direct download link of the Strava " +
    "export ZIP file, not the link of a web page which shows it.",

  // Requests only the end of the export file, so that a link which answers a web page instead of the file,
  // or a ZIP file which is not a Strava export, is reported on the form without downloading the export.
  // The body is answered as text, which keeps the ASCII signature and entry names of the binary bytes.
  // A server which ignores the Range header answers the whole file, which is checked the same way.
  testConnection() {
    var url = this.exportUrl();
    if (!this.isSecureUrl(url)) return {errors: [{field: "export_url", message: this.INSECURE_URL_MESSAGE}]};
    var tail = source.getDocument(url, {},
      {format: "html", headers: {Range: `bytes=-${this.ZIP_TAIL_BYTES}`}, ignoreErrors: true});
    var message = !tail ? this.DOWNLOAD_FAILED_MESSAGE :
      tail.indexOf(this.END_OF_CENTRAL_DIRECTORY_SIGNATURE) < 0 ? this.NOT_ZIP_MESSAGE :
      this.hasWholeCentralDirectory(tail) && tail.indexOf(this.ACTIVITIES_ENTRY) < 0 ? this.notExportMessage() : null;
    if (message) return {errors: [{field: "export_url", message: message}]};
  },

  // The central directory follows the last entry, so a tail with the header of an entry holds the whole
  // directory. The directory of an export with more files than the tail holds starts before the tail, and
  // the import checks its entries instead.
  hasWholeCentralDirectory(tail) {
    return tail.indexOf(this.LOCAL_FILE_HEADER_SIGNATURE) >= 0;
  },

  notExportMessage() {
    return `The ZIP file is not a Strava account export: it has no ${this.ACTIVITIES_ENTRY} file.`;
  },

  // The direct download URL of the entered link.
  exportUrl() {
    var url = String(source.getSourceParam("export_url") || "").trim();
    var driveFileId = this.googleDriveFileId(url);
    if (driveFileId) {
      // `confirm=t` skips the page which Google Drive shows instead of a file too large to scan for viruses.
      return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveFileId)}` +
        "&export=download&confirm=t";
    }
    if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(url)) {
      return this.withQueryParam(url.replace(/^http:/i, "https:"), "dl", "1");
    }
    return url;
  },

  // The export holds the GPS tracks, the heart rates and the contacts of the user, so it is downloaded over
  // HTTPS only — over plain HTTP only from the computer which runs eazyBI, which a development server
  // reads it from.
  isSecureUrl(url) {
    return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
  },

  // The file id of a Google Drive share link: https://drive.google.com/file/d/<id>/view,
  // https://drive.google.com/open?id=<id> or https://drive.google.com/uc?id=<id>.
  googleDriveFileId(url) {
    if (!/^https?:\/\/drive\.google\.com\//i.test(url)) return null;
    var match = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  },

  // The URL with the query parameter set to the value, replacing it when the URL already has it.
  withQueryParam(url, name, value) {
    var hashIndex = url.indexOf("#");
    var hash = hashIndex >= 0 ? url.substring(hashIndex) : "";
    var base = hashIndex >= 0 ? url.substring(0, hashIndex) : url;
    var pattern = new RegExp(`([?&])${name}=[^&]*`);
    if (pattern.test(base)) return base.replace(pattern, `$1${name}=${value}`) + hash;
    return `${base}${base.indexOf("?") >= 0 ? "&" : "?"}${name}=${value}${hash}`;
  },

  // Downloads the export into a temporary file and returns it with the names of its entries:
  // {file, activitiesEntry, preferencesEntry, activityFileEntries: {"12345678901.gpx": "<entry name>"}}.
  // An export which was unpacked and packed again has its files in a directory of the archive, so the
  // entries are found by their file names wherever they are. Throws an error which tells the user what
  // is wrong with the link when it does not answer a Strava export.
  downloadExport() {
    var url = this.exportUrl();
    if (!this.isSecureUrl(url)) throw new Error(this.INSECURE_URL_MESSAGE);
    var file = source.downloadFile(url, {fileName: "strava_export.zip", ignoreErrors: true});
    if (!file) throw new Error(this.DOWNLOAD_FAILED_MESSAGE);
    var entries = source.archiveEntries(file);
    var exportFile = this.exportEntries(entries);
    exportFile.file = file;
    if (entries.length === 0 || !exportFile.activitiesEntry) {
      source.deleteFile(file);
      throw new Error(entries.length === 0 ? this.NOT_ZIP_MESSAGE : this.notExportMessage());
    }
    return exportFile;
  },

  // The entries of the export by what they hold, from the [{name, size}] entries of the archive. Only the
  // activity files of an activities/ directory are activity files: a media/ file is never one.
  exportEntries(entries) {
    var exportFile = {activitiesEntry: null, preferencesEntry: null, activityFileEntries: {}};
    entries.forEach((entry) => {
      var path = entry.name.split("/");
      var fileName = path.pop();
      if (fileName === this.ACTIVITIES_ENTRY) exportFile.activitiesEntry = entry.name;
      else if (fileName === this.PREFERENCES_ENTRY) exportFile.preferencesEntry = entry.name;
      else if (path.pop() === "activities" && this.ACTIVITY_FILE_PATTERN.test(fileName)) {
        exportFile.activityFileEntries[fileName] = entry.name;
      }
    });
    return exportFile;
  },

  // Calls batchCallback with the rows of activities.csv as arrays of their cells, the header row first.
  // activities.csv repeats some column names — Distance is in the display unit of the athlete first and in
  // meters later — so its rows are read by the position of the column, never by the column name.
  readActivityRows(exportFile, batchCallback) {
    source.readDocuments(exportFile.file,
      {format: "csv", headers: false, entry: exportFile.activitiesEntry, batchSize: 1000},
      (rows) => { batchCallback(rows); });
  },

  // The row of general_preferences.csv keyed by its column names, or null when the export has none.
  readPreferences(exportFile) {
    if (!exportFile.preferencesEntry) return null;
    var preferences = null;
    source.readDocuments(exportFile.file, {format: "csv", entry: exportFile.preferencesEntry},
      (rows) => { if (!preferences) preferences = rows[0] || null; });
    return preferences;
  },

  // The lines of one activity file of the export, gunzipped when it is gzipped, or null when the export has
  // no file of that name.
  readActivityFileLines(exportFile, fileName) {
    var entry = exportFile.activityFileEntries[fileName];
    if (!entry) return null;
    var lines = [];
    source.readDocuments(exportFile.file, {format: "lines", entry: entry, batchSize: 10000},
      (batch) => { batch.forEach((line) => lines.push(line)); });
    return lines;
  },

  // The bytes of one FIT activity file of the export as a Uint8Array, gunzipped when it is gzipped, or null
  // when the export has no file of that name.
  readActivityFileBytes(exportFile, fileName) {
    var entry = exportFile.activityFileEntries[fileName];
    if (!entry) return null;
    var bytes = null;
    source.readDocuments(exportFile.file, {format: "binary", entry: entry},
      (documents) => { bytes = documents[0].bytes; });
    return bytes;
  }
};
