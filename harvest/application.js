// The times of day in 30 minute steps from `fromStep` to `toStep`, "00:00" at step 0 and "24:00" at step 48.
function halfHourOptions(fromStep, toStep) {
  var options = [];
  for (var step = fromStep; step <= toStep; step++) {
    var hour = Math.floor(step / 2);
    var time = `${hour < 10 ? "0" : ""}${hour}:${step % 2 === 0 ? "00" : "30"}`;
    options.push({value: time, label: time});
  }
  return options;
}

app.defineApplication({
  key: "harvest",
  name: "Harvest",
  description: "Imports Harvest clients, projects, people, timesheet entries, expenses and invoices",
  version: "1.0.0",
  author: "eazyBI",
  license: "MIT",
  baseUrl: "https://api.harvestapp.com/v2",

  sourceParams: [
    {key: "api_token", type: "secret", label: "Personal access token", required: true,
     hint: "Create it in Harvest under Settings > Developers > Create new personal access token, " +
           "at id.getharvest.com/developers. It has to belong to a Harvest administrator — only an " +
           "administrator may read the time, the expenses and the invoices of the whole account."},
    {key: "site_url", type: "text", label: "Harvest web address", required: true,
     hint: "The web address you open Harvest at, for example https://yourcompany.harvestapp.com. " +
           "It tells which Harvest account to import, and clients, projects and people link to Harvest " +
           "with it."}
  ],

  // Harvest needs both the token and the account ID on every request; the account ID is the `account_id`
  // query parameter that api.js adds.
  auth: {type: "header", headerName: "Authorization", headerValue: "Bearer {{params.api_token}}"},

  // The Harvest accounts of the token, among which the account of the web address is found (api.js
  // findAccount).
  additionalHosts: ["id.getharvest.com"],

  // The daily euro reference rates, requested without the Harvest credentials.
  publicHosts: ["www.ecb.europa.eu"],

  // All projects, or the selected ones (importers/selection.js). The column shows their count and not
  // their names: a selection of a large account is too long to read there.
  sourceSelection: {
    enabled: true,
    all: true,
    display: "{{source_params.site_url}}\n" +
      "{% if authentication.account %}{{authentication.account}}{% endif %}\n" +
      "{% if authentication.user %}User: {{authentication.user}}{% endif %}\n" +
      "{% assign all_projects = source_selection | where: 'key', '(all)' %}" +
      "{% if all_projects.size > 0 %}All projects" +
      "{% elsif source_selection.size == 0 %}No projects selected" +
      "{% elsif source_selection.size == 1 %}1 selected project" +
      "{% else %}{{source_selection.size}} selected projects{% endif %}"
  },

  extraOptions: [
    // Not clearsMax: the option changes when the import reads everything, not what it imports.
    {key: "deleted_records_check", type: "select", label: "Check for deleted records", default: "daily",
     hint: "Harvest does not report deleted records. At this interval the import reads all Harvest data " +
           "again and removes the time entries, expenses, invoices, clients, projects, tasks and people " +
           "that Harvest no longer lists; the imports in between read only what changed.",
     options: [
       {value: "daily", label: "every day"},
       {value: "weekly", label: "every week"},
       {value: "reimport", label: "only with a full reimport"}
     ]},
    // Not clearsMax: the Working Time dimension of the stored time entries depends on them, and the import
    // reads the time entries again itself when they change, not everything (importers/working_times.js).
    {key: "business_hours_start", type: "select", label: "Business hours start", default: "09:00",
     hint: "The time entries of a working day are Business hours from this time until the end below, " +
           "and Non-business hours before and after it. The working days are the days which the Time " +
           "dimension settings do not list as non-working days.",
     options: halfHourOptions(0, 47)},
    {key: "business_hours_end", type: "select", label: "Business hours end", default: "17:00",
     hint: "Has to be later than the start. Otherwise the time entries of a working day are all Business " +
           "hours and the import warns.",
     options: halfHourOptions(1, 48)}
  ]
});
