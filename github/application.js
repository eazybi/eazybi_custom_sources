app.defineApplication({
  key: "github",
  name: "GitHub",
  description: "Imports GitHub pull requests with their authors, assignees, reviewers, labels, milestones," +
    " comments, commits and state transitions.",
  version: "1.0.0",
  author: "eazyBI",
  license: "MIT",
  defaultCubeName: "GitHub",
  // GitHub Enterprise Server has its own host, which would need a url source param instead.
  baseUrl: "https://api.github.com",
  sourceParams: [
    {
      key: "api_token",
      type: "secret",
      label: "API token",
      required: true,
      hint: "Personal access token created at https://github.com/settings/tokens. A classic token needs the" +
        " repo, read:org and read:user scopes; a fine grained token needs read access to Metadata, Contents," +
        " Pull requests, Issues and Email addresses of the repositories to import."
    }
  ],
  auth: {type: "header", headerName: "Authorization", headerValue: "Bearer {{params.api_token}}"},
  sourceSelection: {enabled: true},
  extraOptions: [
    {
      key: "import_commits",
      type: "checkbox",
      label: "Import pull request commits",
      clearsMax: true,
      hint: "Imports one row per commit of a pull request with its author and its line changes." +
        " Without this option only the commit count of a closed pull request is imported."
    },
    {
      key: "import_changes",
      type: "checkbox",
      label: "Import pull request state transitions",
      clearsMax: true,
      hint: "Imports the open, changes requested, approved, merged and closed transitions of every pull request," +
        " which is what the historical measures are calculated from. It reads the timeline of every pull request," +
        " making the import noticeably slower."
    }
  ]
});
