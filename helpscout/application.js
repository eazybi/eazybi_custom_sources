// The office hours times of every half hour, "00:00" to "24:00".
const OFFICE_TIMES = Array.from({length: 49}, (_, index) =>
  `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

app.defineApplication({
  key: "helpscout",
  name: "Help Scout",
  description: "Imports Help Scout conversations, messages, customers and satisfaction ratings",
  version: "1.6.0",
  author: "eazyBI",
  license: "MIT",
  baseUrl: "https://api.helpscout.net",

  sourceParams: [
    {key: "oauth_client_id", type: "text", label: "App ID", required: true,
     hint: "Create the app in Help Scout under Your Profile > My apps > Create My App, " +
           "with the eazyBI redirect URL shown below as its redirection URL."},
    {key: "oauth_client_secret", type: "secret", label: "App secret", required: true,
     hint: "The App Secret of the same Help Scout app."}
  ],

  auth: {
    type: "oauth2",
    authorizeUrl: "https://secure.helpscout.net/authentication/authorizeClientApplication",
    tokenUrl: "https://api.helpscout.net/v2/oauth2/token",
    clientId: "{{params.oauth_client_id | default: settings.auth.client_id}}",
    clientSecret: "{{params.oauth_client_secret | default: settings.auth.client_secret}}"
  },

  sourceSelection: {enabled: true},

  customFields: {enabled: true},

  extraOptions: [
    {key: "import_history", type: "select", label: "Import history", default: "12", clearsMax: true,
     hint: "How far back conversations are imported by the first import",
     options: [
       {value: "3", label: "3 months"},
       {value: "6", label: "6 months"},
       {value: "12", label: "1 year"},
       {value: "24", label: "2 years"},
       {value: "0", label: "All history"}
     ]},
    {key: "import_messages", type: "checkbox", label: "Import conversation messages",
     default: true, clearsMax: true,
     hint: "Imports one row per conversation thread — customer messages, agent replies and notes."},
    {key: "import_ratings", type: "checkbox", label: "Import satisfaction ratings",
     default: true, clearsMax: true,
     hint: "Imports the happiness ratings customers gave to the agent replies."},
    {key: "use_office_hours", type: "checkbox", label: "Use office hours", default: false, clearsMax: true,
     hint: "Also counts the first reply and the closing time within the office hours only."},
    {key: "office_hours", type: "table", label: "Office hours", clearsMax: true,
     showIf: {field: "use_office_hours", value: true},
     hint: "The office days and hours of the team, in the Time dimension time zone.",
     columns: [
       {key: "open", type: "checkbox", label: "Day"},
       {key: "start_time", type: "select", label: "Start", options: OFFICE_TIMES.slice(0, -1), default: "09:00",
        showIf: {field: "open", value: true}},
       {key: "end_time", type: "select", label: "End", options: OFFICE_TIMES.slice(1), default: "18:00",
        showIf: {field: "open", value: true}}
     ],
     rowLabels: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
     default: [
       {open: true}, {open: true}, {open: true}, {open: true}, {open: true}, {open: false}, {open: false}
     ]}
  ]
});
