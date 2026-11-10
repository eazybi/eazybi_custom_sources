// The product users, the licensed users and the product role holders of the workspaces, searched in the org
// directories.

app.importers.directory = {
  // The users with access to every selected workspace with any role, by account id: the product access of the
  // user search names only the products a user has been active in, so a user who never used a product is
  // found here.
  collectProductUsers(directories, workspaces) {
    return this.collectWorkspaceUsers(directories, workspaces.selectedWorkspaces, {
      importName: "product users",
      error: "The users with access to the products could not be read",
      search: (directoryId, workspace) => app.api.getWorkspaceAccountIds(directoryId, workspace.aris)
    });
  },

  // The keys of the workspaces whose search found any of the product users of collectProductUsers.
  workspacesWithUsers(productUsers) {
    var keys = {};
    Object.keys(productUsers).forEach((accountId) => {
      Object.keys(productUsers[accountId]).forEach((workspaceKey) => { keys[workspaceKey] = true; });
    });
    return keys;
  },

  // The users holding a license of every selected workspace, by account id and workspace key, with one search
  // per workspace for the user and the admin roles together. The workspaces whose roles take no license are
  // not searched.
  collectLicensedUsers(directories, workspaces) {
    var licensable = workspaces.selectedWorkspaces.filter((workspace) => app.api.isLicensable(workspace));
    var holders = this.collectWorkspaceUsers(directories, licensable, {
      importName: "licensed users",
      error: "The licensed users of the products could not be read",
      search: (directoryId, workspace) =>
        app.api.getRoleAccountIds(directoryId, workspace.aris, app.api.LICENSED_ROLE_IDS)
    });

    var licensedUsers = {};
    Object.keys(holders).forEach((accountId) => {
      licensedUsers[accountId] = {};
      Object.keys(holders[accountId]).forEach((workspaceKey) => { licensedUsers[accountId][workspaceKey] = true; });
    });
    return licensedUsers;
  },

  // The licensed users of the role ids found by collectProductRoles, in the shape of collectLicensedUsers.
  licensedUsersOf(productRoles, workspaces) {
    var licensable = {};
    workspaces.selectedWorkspaces.forEach((workspace) => {
      if (app.api.isLicensable(workspace)) licensable[workspace.key] = true;
    });

    var licensedUsers = {};
    Object.keys(productRoles).forEach((accountId) => {
      Object.keys(productRoles[accountId]).forEach((workspaceKey) => {
        var licensed = licensable[workspaceKey] === true && productRoles[accountId][workspaceKey].some((roleId) =>
          app.api.LICENSED_ROLE_IDS.indexOf(roleId) >= 0);
        if (licensed) (licensedUsers[accountId] || (licensedUsers[accountId] = {}))[workspaceKey] = true;
      });
    });
    return licensedUsers;
  },

  // The role ids of every user on every selected workspace, by account id and workspace key, with one search
  // per role. The admin role is searched on the deselected workspaces too, because the Product admin
  // member of the Admin Role dimension is an admin of any product.
  collectProductRoles(directories, workspaces) {
    var productRoles = {};
    for (let role of app.api.PRODUCT_ROLES) {
      let searched = role.id === app.api.PRODUCT_ADMIN_ROLE_ID
        ? this.allWorkspaces(workspaces) : workspaces.selectedWorkspaces;
      let collection = {
        importName: "product roles",
        objectName: role.name,
        error: `The ${role.name} role holders of the products could not be read`,
        search: (directoryId, workspace) => app.api.getRoleAccountIds(directoryId, workspace.aris, [role.id])
      };
      let holders = this.collectWorkspaceUsers(directories, searched, collection);
      Object.keys(holders).forEach((accountId) => {
        var userRoles = productRoles[accountId] || (productRoles[accountId] = {});
        Object.keys(holders[accountId]).forEach((workspaceKey) => {
          (userRoles[workspaceKey] || (userRoles[workspaceKey] = [])).push(role.id);
        });
      });
    }

    return productRoles;
  },

  allWorkspaces(workspaces) {
    return _.flatten(workspaces.catalog.sites.map((site) => site.workspaces));
  },

  // One search per directory and workspace. Returns the found workspaces by account id and workspace key.
  // A search the API answers with an error, also after the retries of eazyBI, fails the import before any
  // user is written: the users would be imported without the product access and the roles it did not find,
  // and the import replaces the stored rows of every user it imports.
  collectWorkspaceUsers(directories, searchedWorkspaces, collection) {
    var usersWorkspaces = {};
    if (directories.length === 0 || searchedWorkspaces.length === 0) return usersWorkspaces;

    logger.startImport(collection.importName, collection.objectName);
    var count = 0;
    for (let directory of directories) {
      for (let workspace of searchedWorkspaces) {
        let accountIds;
        try {
          accountIds = collection.search(directory.directoryId, workspace);
        } catch (error) {
          source.checkCanceling();
          throw new Error(`${collection.error}: ${error.message}`);
        }

        accountIds.forEach((accountId) => {
          var entry = usersWorkspaces[accountId] || (usersWorkspaces[accountId] = {});
          if (!entry[workspace.key]) count++;
          entry[workspace.key] = workspace;
        });
      }
    }
    logger.finishImport(collection.importName, count);

    return usersWorkspaces;
  },

  // "ari:cloud:identity::group/<uuid>" — the uuid is what the Atlassian Administration group URL takes.
  groupExternalId(group) {
    var match = /group\/(.+)$/.exec(String(group.id || ""));
    return match ? match[1] : null;
  }
};
