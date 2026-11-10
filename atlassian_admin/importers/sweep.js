// Removing what the organization no longer has. The admin APIs report no deletions: a user removed from
// the organization, a product access the user lost, a deleted group and a removed or deselected workspace
// simply stop being answered or imported. Every fact row and every dimension member the import writes
// therefore carries a generation, 1 or 2, in a hidden `generation` column.
//
// Every import reads the whole organization (importer.js), so every import writes everything it reads
// with the other generation than the previous import, and then deletes the rows and the members which
// still carry the previous generation, or none: those are the ones it did not write. The bridge tables
// are left alone — a member set no fact row uses any more is harmless.
//
// An import in which an object failed deletes nothing, because the stored rows of the failed object would
// be taken for the rows of a removed one, and does not store its generation: the next import writes the
// same generation again and deletes what this one would have. The rows of a user removed after the failed
// import wrote them carry that generation too, so they survive the next import and go with the one after.
app.importers.sweep = {
  // The source names of the fact rows by measures table, which the importers write and the sweep deletes by.
  SOURCE_NAMES: {users: "user", productAccess: "product access", licenses: "workspace"},

  // The generation of what this import writes.
  generation: null,

  // Decides before anything is written.
  begin() {
    var storedGeneration = source.getMaxParam("generation");
    var previousGeneration = (storedGeneration === 1 || storedGeneration === 2) ? storedGeneration :
      this.generationOfStoredRows();
    this.generation = this.otherGeneration(previousGeneration);
  },

  // Deletes what this import did not write and stores its generation, unless an object failed.
  finish() {
    var failureCount = source.warnings.objectFailures().length;
    if (failureCount > 0) {
      logger.warn("What the organization no longer has is not removed by this import, because not" +
        ` everything was imported (${failureCount} failed). The next import removes it.`);
      return;
    }

    var removed = this.deleteGenerations([this.otherGeneration(this.generation), null]);
    logger.info(`Removed ${removed.rows} fact rows and ${removed.members} dimension members which the` +
      " organization no longer has");
    source.setMaxParam("generation", this.generation);
  },

  otherGeneration(generation) {
    return generation === 1 ? 2 : 1;
  },

  // A full reimport clears the stored generation, while the stored rows still carry it. Every import that
  // imported something wrote User members, so they tell it.
  generationOfStoredRows() {
    var users = dwh.dimensions.users;
    if (users.selectCount({generation: 1}) > 0) return 1;
    if (users.selectCount({generation: 2}) > 0) return 2;
    return null;
  },

  // Deletes the fact rows first and the dimension members after them, so that no member is deleted while
  // rows of it are still stored.
  deleteGenerations(generations) {
    var removed = {rows: 0, members: 0};
    this.factScopes().forEach((scope) => generations.forEach((generation) => {
      removed.rows += scope.table.deleteRows({_source_name: scope.sourceName, generation: generation});
    }));
    this.dimensionTables().forEach((table) => generations.forEach((generation) => {
      removed.members += table.deleteRows({generation: generation});
    }));
    return removed;
  },

  // The rows of a measures table are deleted per source name, which the host prefixes with the
  // application type.
  factScopes() {
    return [
      {table: dwh.measures.users, sourceName: this.SOURCE_NAMES.users},
      {table: dwh.measures.product_access, sourceName: this.SOURCE_NAMES.productAccess},
      {table: dwh.measures.licenses, sourceName: this.SOURCE_NAMES.licenses}
    ];
  },

  // Every dimension table the import writes members of, also the ones of the selected user profile fields.
  dimensionTables() {
    var dimensions = dwh.dimensions;
    var tables = [dimensions.users, dimensions.admin_roles, dimensions.statuses, dimensions.groups,
                  dimensions.product_roles, dimensions.sites, dimensions.products, dimensions.plans,
                  dimensions.product_accesses];
    source.getCustomFields().forEach((field) => {
      if (field.dimension) tables.push(dimensions[`cf_${field.key}`]);
    });
    return tables;
  }
};
