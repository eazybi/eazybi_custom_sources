// The Harvest clients — the top level of the Project Task dimension. A client names the currency every
// project of it is billed in, which the projects and the timesheet rows below read from here.
app.importers.clients = {
  storedById: {},
  // The ids of every client of the clients list, also of those which are not imported.
  listedIds: {},
  accountCurrencies: [],

  importAll() {
    logger.startImport("clients");
    this.storedById = {};
    this.listedIds = {};
    var fetchedClients = app.api.getClients();
    var imported = 0;
    fetchedClients.forEach((client) => {
      this.listedIds[String(client.id)] = true;
      // A client an earlier import did not find in the list (invoices.js reportUnknownClient) is found now.
      source.warnings.clearOld(`client/${client.id}`);
      if (!app.importers.selection.includesClient(client.id)) return;
      this.storeClient(client);
      imported++;
    });
    this.accountCurrencies = _.uniq(_.compact(_.map(fetchedClients, (client) => client.currency)));
    logger.finishImport("clients", imported);
  },

  storeClient(client) {
    var memberId = dwh.dimensions.clients.createAndLookupId({id: client.id},
      {name: client.name, currency: client.currency, generation: app.importers.sweep.generation});
    this.storedById[String(client.id)] = {id: client.id, memberId: memberId, name: client.name,
                                          currency: client.currency};
    return memberId;
  },

  stored(clientId) {
    return this.storedById[String(clientId)] || null;
  },

  listed(clientId) {
    return this.listedIds[String(clientId)] === true;
  },

  currencyOf(clientId) {
    var client = this.stored(clientId);
    return client && client.currency;
  },

  each(callback) {
    _.values(this.storedById).forEach(callback);
  },

  // Every currency the account bills in, which the euro rates are imported for — also the currencies of
  // the clients a selection of projects does not import.
  currencies() {
    return this.accountCurrencies;
  }
};
