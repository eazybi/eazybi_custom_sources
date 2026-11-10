// Every import reads the whole organization: the admin APIs answer no "changed since" filter. What the
// import did not write is removed at its end (importers/sweep.js).

app.importer = {
  importAll() {
    source.setStatusMessage("Importing Atlassian organization products");
    var selectedKeys = source.getSourceSelection();
    if (selectedKeys.length === 0) {
      throw new Error("No Atlassian products selected for import." +
        " Select the products on the Source Data page.");
    }

    app.importers.sweep.begin();
    logger.startImport("products");
    var workspaces = app.importers.workspaces.importAll(selectedKeys);
    logger.finishImport("products", workspaces.selectedWorkspaces.length);
    if (workspaces.selectedWorkspaces.length === 0) {
      throw new Error("None of the selected products was answered by the workspaces API." +
        " Check the selection on the Source Data page.");
    }

    var directories = app.api.getDirectories();
    source.setStatusMessage("Reading the product users");
    workspaces.productUsers = app.importers.directory.collectProductUsers(directories, workspaces);
    workspaces.workspacesWithUsers = app.importers.directory.workspacesWithUsers(workspaces.productUsers);

    // The roles imported anyway tell the licensed users without a search of their own.
    var productRoles = {};
    if (source.getExtraOption("import_product_roles") === true) {
      source.setStatusMessage("Reading the product roles");
      productRoles = app.importers.directory.collectProductRoles(directories, workspaces);
      workspaces.licensedUsers = app.importers.directory.licensedUsersOf(productRoles, workspaces);
    } else {
      source.setStatusMessage("Reading the product licenses");
      workspaces.licensedUsers = app.importers.directory.collectLicensedUsers(directories, workspaces);
    }

    source.setStatusMessage("Importing users");
    app.importers.users.importAll(workspaces, directories, productRoles);
    app.importers.sweep.finish();
    dwh.dimensions.users.updateDuplicateNames({nameColumn: "display_name", addColumn: "account_id"});
    dwh.dimensions.sites.updateDuplicateNames({nameColumn: "name", addColumn: "site_key"});
  }
};
