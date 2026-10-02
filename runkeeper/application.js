app.defineApplication({
  key: "runkeeper",
  name: "Runkeeper",
  description: "Imports Runkeeper activities, kilometer splits and heart rate zones from a Runkeeper data export",
  version: "1.0.0",
  author: "eazyBI",
  license: "MIT",

  // Runkeeper has no public API — its Health Graph API takes no new developers — and its login is
  // protected from any client which is not a browser. The data comes from the export ZIP file that
  // Runkeeper prepares at runkeeper.com/exportData, which the user shares at a direct download URL.
  // That URL is the base URL, so it may be on any host, and the file needs no credentials.
  sourceParams: [
    {key: "export_url", type: "text", label: "Export file URL", required: true, url: true,
     hint: "Export all your data at runkeeper.com/exportData, put the downloaded ZIP file where it can " +
           "be downloaded by a link (Dropbox, Google Drive, S3 or any HTTPS server), and paste the " +
           "direct download link here. Replace the file with a new export to update the data."}
  ],

  auth: {type: "none"},

  // The direct download host of the Google Drive share links, see app.api.exportUrl. A Dropbox link is
  // downloaded from its own host, which redirects to the file.
  additionalHosts: ["drive.usercontent.google.com"],

  extraOptions: [
    {key: "skip_implausible_activities", type: "checkbox", label: "Skip implausible activities", default: true,
     hint: "Leaves out the activities whose average speed is impossible for their type — the tracking left " +
           "running for hours after a run, or a run recorded in a car — and lists them in the import warnings."},
    {key: "max_heart_rate", type: "number", label: "Maximum heart rate",
     hint: "Your maximum heart rate in beats per minute, which sets the heart rate zones. " +
           "Leave it empty to use the highest heart rate recorded in the export."}
  ]
});
