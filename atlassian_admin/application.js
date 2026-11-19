app.defineApplication({
  key: "atlassian_admin",
  name: "Atlassian Admin",
  description: "Imports the users of an Atlassian organization with their admin roles, groups, product" +
    " access and the license plans and seats of the selected Atlassian products.",
  version: "1.1.0",
  author: "eazyBI",
  license: "MIT",
  defaultCubeName: "Atlassian Admin",
  baseUrl: "https://api.atlassian.com",
  sourceParams: [
    {
      key: "org_id",
      type: "text",
      label: "Organization ID",
      required: true,
      hint: "The ID in the Atlassian Administration URL: https://admin.atlassian.com/o/<organization ID>"
    },
    {
      key: "api_key",
      type: "secret",
      label: "Organization API key",
      required: true,
      hint: "An API key created by an organization admin at admin.atlassian.com > Settings > API keys." +
        " Create the key without scopes: Atlassian offers no scope for the user search and the last active" +
        " dates that the import reads."
    }
  ],
  auth: {type: "header", headerName: "Authorization", headerValue: "Bearer {{params.api_key}}"},
  sourceSelection: {enabled: true, all: true},
  customFields: {enabled: true},
  extraOptions: [
    {
      key: "import_product_roles",
      type: "checkbox",
      label: "Import product roles",
      clearsMax: true,
      hint: "Imports the roles of the users on every selected product — user, admin, user access admin," +
        " contributor, basic, stakeholder, customer and guest — with one extra request per role and" +
        " product, and finds the product admins." +
        " Without this option the Admin Role dimension tells apart only org admins, site admins and the" +
        " users without an admin role."
    }
  ]
});
