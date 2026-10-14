// The categories an expense is booked under.
app.importers.expenseCategories = {
  storedById: {},

  importAll() {
    logger.startImport("expense categories");
    this.storedById = {};
    var fetchedCategories = app.api.getExpenseCategories();
    fetchedCategories.forEach((category) => this.storeCategory(category));
    logger.finishImport("expense categories", fetchedCategories.length);
  },

  storeCategory(category) {
    var memberId = dwh.dimensions.expense_categories.createAndLookupId({id: category.id},
      {name: category.name, generation: app.importers.sweep.generation});
    this.storedById[String(category.id)] = {id: category.id, memberId: memberId};
    return memberId;
  },

  categoryIdOf(categoryId) {
    var category = this.storedById[String(categoryId)];
    return category && category.memberId;
  }
};
