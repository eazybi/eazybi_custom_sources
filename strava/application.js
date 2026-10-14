app.defineApplication({
  key: "strava",
  name: "Strava",
  description: "Imports Strava activities, kilometer splits and heart rate zones from a Strava account export",
  version: "1.1.0",
  author: "eazyBI",
  license: "MIT",

  // The Strava API Policy does not allow storing, analyzing or sharing the data of its API, so the data
  // comes from the account export that Strava prepares for its user at strava.com/account, which the user
  // shares at a direct download URL. That URL is the base URL, so it may be on any host, and the file
  // needs no credentials.
  sourceParams: [
    {key: "export_url", type: "text", label: "Export file URL", required: true, url: true,
     hint: "Set the Strava language to English, request the download of your account on the Strava website at " +
           "strava.com/account (the Strava app does not offer it), put the downloaded ZIP file where it can be " +
           "downloaded by a link (Dropbox, Google Drive, S3 or any HTTPS server), and paste the direct " +
           "download link here. Replace the file with a new export to update the data."}
  ],

  auth: {type: "none"},

  // The direct download host of the Google Drive share links, see app.api.exportUrl. A Dropbox link is
  // downloaded from its own host, which redirects to the file.
  additionalHosts: ["drive.usercontent.google.com"],

  extraOptions: [
    {key: "skip_implausible_activities", type: "checkbox", label: "Skip implausible activities", default: true,
     hint: "Leaves out the activities whose average speed is impossible for their type — a jump of the GPS " +
           "position, or a walk recorded in a car — and lists them in the import warnings."},
    {key: "max_heart_rate", type: "number", label: "Maximum heart rate",
     hint: "Your maximum heart rate in beats per minute, which sets the heart rate zones. Leave it empty to " +
           "use the maximum heart rate of your Strava settings, or else the highest heart rate in the export."}
  ]
});
