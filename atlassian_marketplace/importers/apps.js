// The apps of the developer space. Their names come from the Marketplace listings, so that an app
// is named the same in every report even when no record of it was exported; an app which the
// records name but the listings do not is created from the record.
app.importers.apps = {
  // App key -> the listing of the app, for the whole import.
  listingsByKey: {},
  // The app keys the user selected, or an empty array when everything is imported.
  selectedKeys: [],

  reset() {
    this.listingsByKey = {};
    this.selectedKeys = [];
  },

  // Imports the App members and returns the app keys the exports are narrowed to — the selected
  // ones, or an empty array when the user selected nothing and everything is imported.
  importAll(developerId, selectedKeys) {
    this.reset();
    this.selectedKeys = (selectedKeys || []).map((key) => String(key));

    logger.startImport("apps");
    var imported = 0;
    app.api.getApps(developerId).forEach((listing) => {
      this.listingsByKey[listing.appKey] = listing;
      // Only the selected apps become members: an app the user does not import would otherwise
      // stand in every report as a member without data.
      if (this.isSelectedKey(listing.appKey)) {
        this.storeListing(listing);
        imported++;
      }
    });
    logger.finishImport("apps", imported);

    return this.selectedKeys;
  },

  storeListing(listing) {
    return dwh.dimensions.apps.createAndLookupId({app_key: listing.appKey}, () => ({
      name: listing.appName,
      product_id: listing.productId,
      state: app.importers.records.humanize(listing.state)
    }));
  },

  isSelectedKey(appKey) {
    if (this.selectedKeys.length === 0) return true;
    return this.selectedKeys.indexOf(String(appKey)) >= 0;
  },

  // Whether an exported record belongs to an app that is imported. The export is already narrowed
  // by the app keys, so this only guards against a record the Marketplace answers anyway.
  isSelected(record) {
    return this.isSelectedKey(app.importers.records.text(record.addonKey));
  },

  // The App member of a record. An app which the listings did not name — an app that was deleted
  // but still has licenses — is created from the name the record carries.
  lookupId(record) {
    var appKey = app.importers.records.text(record.addonKey);
    if (!appKey) return null;
    var listing = this.listingsByKey[appKey];
    if (listing) return this.storeListing(listing);
    return dwh.dimensions.apps.createAndLookupId({app_key: appKey},
      () => ({name: app.importers.records.text(record.addonName) || appKey}));
  }
};
