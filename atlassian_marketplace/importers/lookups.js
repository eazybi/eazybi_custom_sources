// The small dimensions whose members are known in advance — hosting platforms, license types and
// statuses, sale types, billing periods, payment statuses and product editions — plus the lookup
// functions of the dimensions the records fill. The known members are seeded with their order, so
// that reports list them the way a vendor reads them; a value the Marketplace adds later is
// created as it is seen and sorted after them.
//
// Every record of an export looks the same few members up, so the lookups which have attributes to
// store pass them as a function: eazyBI calls it only for a member it actually stores, and the
// rows which find the id in the import cache never build the attributes at all.
app.importers.lookups = {
  HOSTINGS: ["Cloud", "Data Center", "Server"],
  LICENSE_TYPES: ["Commercial", "Academic", "Social impact", "Evaluation", "Demonstration",
                  "Free", "Legacy free", "Community", "Open source", "Classroom"],
  LICENSE_STATUSES: ["Active", "Inactive", "Cancelled"],
  SALE_TYPES: ["New", "Renewal", "Upgrade", "Downgrade", "Refund"],
  BILLING_PERIODS: ["Monthly", "Annual"],
  PAYMENT_STATUSES: ["Paid", "Fully paid", "Partially paid", "Open", "Uncollectible", "Refunded"],
  PRODUCT_EDITIONS: ["Free", "Standard", "Premium", "Enterprise"],
  // The order of a member the Marketplace added after this list was written.
  UNKNOWN_POSITION: 99,

  // The seeded dimensions, as the logical table name, its key column and the seeded names.
  seeded() {
    return [
      {table: "hostings", keyColumn: "hosting_key", names: this.HOSTINGS},
      {table: "license_types", keyColumn: "license_type_key", names: this.LICENSE_TYPES},
      {table: "license_statuses", keyColumn: "license_status_key", names: this.LICENSE_STATUSES},
      {table: "sale_types", keyColumn: "sale_type_key", names: this.SALE_TYPES},
      {table: "billing_periods", keyColumn: "billing_period_key", names: this.BILLING_PERIODS},
      {table: "payment_statuses", keyColumn: "payment_status_key", names: this.PAYMENT_STATUSES},
      {table: "product_editions", keyColumn: "product_edition_key", names: this.PRODUCT_EDITIONS}
    ];
  },

  importAll() {
    logger.startImport("dimension members");
    var count = 0;
    this.seeded().forEach((dimension) => {
      dimension.names.forEach((name, index) => {
        this.store(dimension.table, dimension.keyColumn, name, index + 1);
        count++;
      });
    });
    logger.finishImport("dimension members", count);
  },

  store(table, keyColumn, name, position) {
    var keys = {};
    keys[keyColumn] = name;
    return dwh.dimensions[table].createAndLookupId(keys, {position: position});
  },

  // The lookup of one seeded dimension: the value is humanized the way the members are named, and
  // a value which is not seeded becomes a member of its own after the seeded ones.
  lookupSeededId(table, keyColumn, value) {
    var name = app.importers.records.humanize(value);
    if (!name) return null;
    return this.store(table, keyColumn, name, this.UNKNOWN_POSITION);
  },

  lookupHostingId(value) {
    return this.lookupSeededId("hostings", "hosting_key", value);
  },

  lookupLicenseTypeId(value) {
    return this.lookupSeededId("license_types", "license_type_key", value);
  },

  lookupLicenseStatusId(value) {
    return this.lookupSeededId("license_statuses", "license_status_key", value);
  },

  lookupSaleTypeId(value) {
    return this.lookupSeededId("sale_types", "sale_type_key", value);
  },

  lookupBillingPeriodId(value) {
    return this.lookupSeededId("billing_periods", "billing_period_key", value);
  },

  lookupPaymentStatusId(value) {
    return this.lookupSeededId("payment_statuses", "payment_status_key", value);
  },

  // The product edition is written as it is and not humanized: "Standard" and "Premium" are the
  // names Atlassian uses, and a record without a parent product has none at all.
  lookupProductEditionId(value) {
    var edition = app.importers.records.productEdition(value);
    if (!edition) return null;
    return this.store("product_editions", "product_edition_key", edition, this.UNKNOWN_POSITION);
  },

  // The tier of a license or a transaction, with the user count range it belongs to.
  lookupTierId(value) {
    var records = app.importers.records;
    var tier = records.normalizeTier(value);
    if (!tier) return null;
    return dwh.dimensions.license_tiers.createAndLookupId({tier_key: tier}, () => {
      var range = records.tierRange(tier);
      return {
        users: records.tierUsers(tier),
        range_key: range.name,
        range_max: range.max
      };
    });
  },

  lookupCountryId(country, region) {
    var records = app.importers.records;
    return dwh.dimensions.countries.createAndLookupId(
      {country: records.text(country) || "(unknown)"},
      () => ({region: records.text(region) || "(unknown)"}));
  },

  // One member per partner name and partner type — the same partner is reported under different
  // types over time, and the Partner hierarchy of the dimension joins them again. The group is
  // computed from the name alone, so every row of one partner carries the same group, and it is
  // computed again by every import, so a partner is regrouped when the grouping rules change.
  lookupPartnerId(name, partnerType) {
    var records = app.importers.records;
    return dwh.dimensions.partners.createAndLookupId({
      name: records.partnerName(name),
      partner_type: records.partnerType(partnerType)
    }, () => ({partner_group: records.partnerGroup(name)}));
  },

  lookupCustomerId(name, country, region) {
    var records = app.importers.records;
    return dwh.dimensions.customers.createAndLookupId(
      {name: records.customerName(name)},
      () => ({country: records.text(country), region: records.text(region)}));
  }
};
