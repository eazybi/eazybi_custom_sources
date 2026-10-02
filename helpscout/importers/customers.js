// The customers and their organizations. A conversation carries only the id, name and email of its
// primary customer, so the organization comes from the customer endpoint: the sweep remembers the
// organization of every customer it saw, and a customer the sweep did not return is requested once.
app.importers.customers = {
  // customer id -> organization member id (or null when the customer has no organization).
  organizationIdsByCustomerId: {},

  reset() {
    this.organizationIdsByCustomerId = {};
  },

  importAll(modifiedSince) {
    logger.startImport("customers");
    // An account can have far more customers than conversations, so the sweep reports its progress
    // against the total Help Scout answers for the same filter.
    var total = app.api.getCustomersCount(modifiedSince);
    var count = 0;
    this.showProgress(count, total);
    app.api.getCustomers(modifiedSince, (batch) => {
      batch.forEach((customer) => {
        source.checkCanceling();
        this.storeCustomer(customer);
        count++;
      });
      // After every page rather than after every customer: one status message per page is what the
      // user sees moving, without a write per row.
      this.showProgress(count, total);
    });
    logger.finishImport("customers", count);
  },

  // A customer modified while a long sweep runs enters it after the total was read, so the
  // percentage is capped rather than allowed past 100.
  showProgress(imported, total) {
    var message = "Importing customers";
    if (imported > 0) {
      message += `, ${imported} imported`;
      if (total) message += ` of ${total}`;
    }
    if (total > 0)
      source.setStatusMessage(message, {percentage: Math.min(imported * 100 / total, 100)});
    else
      source.setStatusMessage(message);
  },

  storeCustomer(customer) {
    var organizationId = this.storeOrganization(customer);
    this.organizationIdsByCustomerId[String(customer.id)] = organizationId;
    return dwh.dimensions.customers.createAndLookupId({id: customer.id}, {
      display_name: this.displayName(customer),
      email: this.primaryEmail(customer),
      job_title: customer.jobTitle,
      location: customer.location,
      organization_name: customer.organization
    });
  },

  // The customer of a conversation, which carries fewer fields than the customer endpoint.
  storeConversationCustomer(primaryCustomer) {
    if (!primaryCustomer || !primaryCustomer.id) return null;
    return dwh.dimensions.customers.createAndLookupId(
      {id: primaryCustomer.id},
      {display_name: app.importers.people.displayName(primaryCustomer),
       email: primaryCustomer.email});
  },

  storeOrganization(customer) {
    if (!customer.organizationId) return null;
    return dwh.dimensions.organizations.createAndLookupId(
      {id: customer.organizationId},
      {name: customer.organization || `Organization ${customer.organizationId}`});
  },

  organizationIdFor(primaryCustomer) {
    if (!primaryCustomer || !primaryCustomer.id) return null;
    var customerKey = String(primaryCustomer.id);
    var known = this.organizationIdsByCustomerId[customerKey];
    if (known !== undefined) return known;

    // Not returned by the sweep — an incremental import sees mostly customers older than its
    // modifiedSince. The response is memoized for the whole import.
    var customer = source.getCachedDocument(`/v2/customers/${primaryCustomer.id}`,
      {ignoreErrors: [403, 404]});
    var organizationId = customer ? this.storeOrganization(customer) : null;
    this.organizationIdsByCustomerId[customerKey] = organizationId;
    return organizationId;
  },

  displayName(customer) {
    var name = [customer.firstName, customer.lastName].filter((part) => part).join(" ").trim();
    return name || this.primaryEmail(customer) || `Customer ${customer.id}`;
  },

  // Customers share names far more often than agents do.
  updateDuplicateNames() {
    dwh.dimensions.customers.updateDuplicateNames({nameColumn: "display_name",
      addColumn: "email"});
  },

  primaryEmail(customer) {
    var emails = customer._embedded && customer._embedded.emails;
    return (emails && emails.length > 0 && emails[0].value) || null;
  }
};
