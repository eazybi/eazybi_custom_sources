// The product workspaces of the organization: the Site, Product and Plan dimension members and one licenses
// fact row per selected workspace. Also returns the selection context the users importer resolves every
// product access entry against.

var PLAN_ORDINALS = {free: 1, standard: 2, premium: 3, enterprise: 4};
var OTHER_PLAN_ORDINAL = 9;
// The source selection key of the Select all option, which also selects the products added later.
var ALL_KEY = "(all)";

app.importers.workspaces = {
  importAll(selectedKeys) {
    var workspaces = app.api.getWorkspaces();
    workspaces.forEach((workspace) => {
      var attributes = workspace.attributes || {};
      logger.debug(`Workspace ${workspace.id}: type ${attributes.type}, type key ${attributes.typeKey},` +
        ` name ${attributes.name}, host URL ${attributes.hostUrl},` +
        ` plan ${app.api.entitlementAttributes(workspace).planKey}, capacity ${attributes.capacity}`);
    });

    var context = {
      catalog: app.api.workspaceCatalog(workspaces),
      selectAll: selectedKeys.indexOf(ALL_KEY) >= 0,
      selectedKeys: {},
      selectedWorkspaces: []
    };
    selectedKeys.forEach((key) => { context.selectedKeys[key] = true; });

    var licenseRows = [];
    context.catalog.sites.forEach((site) => {
      site.workspaces.forEach((workspace) => this.addWorkspace(context, workspace, licenseRows));
    });
    dwh.measures.licenses.importRows(licenseRows);

    return context;
  },

  // Selecting a site selects all of its workspaces, also the ones added later; a site of its own is
  // selected by the key of its only workspace.
  isSiteSelected(context, site) {
    return context.selectAll || context.selectedKeys[site.key] === true;
  },

  isSelected(context, workspace) {
    return this.isSiteSelected(context, workspace.site) || context.selectedKeys[workspace.key] === true;
  },

  // The licenses row of a deselected workspace is not written, so the import removes it (sweep.js).
  addWorkspace(context, workspace, licenseRows) {
    if (!this.isSelected(context, workspace)) return;

    var generation = app.importers.sweep.generation;
    workspace.siteId = dwh.dimensions.sites.createAndLookupId({site_key: workspace.site.key},
      {name: workspace.site.name, generation: generation});
    workspace.productId = dwh.dimensions.products.createAndLookupId(
      {product_key: workspace.productKey}, {name: workspace.productName, generation: generation});
    workspace.planId = this.planId(workspace);
    context.selectedWorkspaces.push(workspace);

    licenseRows.push({
      _source_id: workspace.key,
      _source_name: app.importers.sweep.SOURCE_NAMES.licenses,
      site_id: workspace.siteId,
      product_id: workspace.productId,
      plan_id: workspace.planId,
      time_id: dwh.lookupTimeId(workspace.createdAt, "workspace created at"),
      workspaces_count: 1,
      license_seats: workspace.capacity,
      generation: generation
    });
  },

  planId(workspace) {
    if (!workspace.planKey) return null;

    var planKey = workspace.planKey;
    return dwh.dimensions.plans.createAndLookupId({plan_key: planKey}, {
      name: workspace.planName || planKey.charAt(0).toUpperCase() + planKey.slice(1),
      ordinal: PLAN_ORDINALS[planKey] || OTHER_PLAN_ORDINAL,
      generation: app.importers.sweep.generation
    });
  }
};
