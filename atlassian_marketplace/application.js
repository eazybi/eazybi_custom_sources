app.defineApplication({
  key: "atlassian_marketplace",
  name: "Atlassian Marketplace",
  description: "Imports Atlassian Marketplace app licenses and sales transactions of a vendor",
  version: "1.2.0",
  author: "eazyBI",
  license: "MIT",
  tableAlias: "amkt",
  baseUrl: "https://api.atlassian.com/marketplace/rest/3",
  // A vendor may report on several developer spaces in one account.
  multiplePerAccount: true,

  sourceParams: [
    {key: "developer_id", type: "text", label: "Developer space ID", required: true,
     hint: "The developer space UUID of your Marketplace vendor account, or its numeric vendor " +
           "ID — both are in the address of the Atlassian Marketplace partner portal pages."},
    {key: "username", type: "text", label: "Atlassian account email", required: true,
     hint: "The email address of the Atlassian account that has access to the vendor reports."},
    {key: "api_token", type: "secret", label: "API token", required: true,
     hint: "Create it at id.atlassian.com under Security > API tokens. The account needs a role " +
           "on the developer space which may read the licenses and the sales reports."}
  ],

  auth: {type: "basic", username: "{{params.username}}", password: "{{params.api_token}}"},

  sourceSelection: {enabled: true},

  extraOptions: [
    {key: "import_licenses", type: "checkbox", label: "Import licenses", default: true,
     clearsMax: true,
     hint: "Imports the app licenses — evaluations, paid, free and their maintenance periods."},
    {key: "import_transactions", type: "checkbox", label: "Import sales transactions",
     default: true, clearsMax: true,
     hint: "Imports the sales transactions with their purchase prices, vendor amounts and " +
           "discounts."},
    {key: "include_atlassian_licenses", type: "checkbox", label: "Include Atlassian licenses",
     default: false, clearsMax: true,
     hint: "Includes the licenses of Atlassian's own accounts, which are excluded by default."},
    {key: "transactions_history", type: "select", label: "Import transactions of",
     default: "0", clearsMax: true,
     hint: "How far back the first import reads the sales transactions. Licenses are always " +
           "imported in full.",
     options: [
       {value: "1", label: "Last year"},
       {value: "2", label: "Last 2 years"},
       {value: "3", label: "Last 3 years"},
       {value: "5", label: "Last 5 years"},
       {value: "0", label: "All history"}
     ]}
  ]
});
