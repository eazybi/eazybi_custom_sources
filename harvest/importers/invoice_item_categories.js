// The categories an invoice line item is billed as.
//
// A line item names its category by name, in its `kind` field, and never by id — so the members are kept
// by name here, the way the built-in Harvest application matches them.
app.importers.invoiceItemCategories = {
  storedByName: {},

  importAll() {
    logger.startImport("invoice item categories");
    this.storedByName = {};
    var fetchedCategories = app.api.getInvoiceItemCategories();
    fetchedCategories.forEach((category) => this.storeCategory(category));
    logger.finishImport("invoice item categories", fetchedCategories.length);
  },

  storeCategory(category) {
    var memberId = dwh.dimensions.invoice_item_categories.createAndLookupId({id: category.id},
      {name: category.name, generation: app.importers.sweep.generation});
    this.storedByName[category.name] = memberId;
    return memberId;
  },

  categoryIdOf(categoryName) {
    var memberId = categoryName && this.storedByName[categoryName];
    return memberId === undefined ? null : memberId;
  }
};
