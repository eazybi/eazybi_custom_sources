// One exported transaction line becomes one Transaction dimension member and up to three fact
// rows: the sale itself at its sale date, and the start and the end of the maintenance period it
// paid for. A refund carries negative amounts and counts its maintenance rows negative, so a
// cumulative sum of the maintenance rows needs no special case for it.
app.importers.transactions = {
  MEASURES_TABLE: "transactions",
  UNIDENTIFIED_WARNING_KEY: "transaction/unidentified",

  importAll(developerId, shared) {
    // The warning of the transactions without an id is shared by all of them, so it is cleared
    // here and added again only when this import exports such a transaction.
    source.warnings.clearOld(this.UNIDENTIFIED_WARNING_KEY);
    return app.importers.exports.run(developerId, "transactions", {
      accept: "csv",
      addon: shared.appKeys,
      lastUpdated: shared.transactionsSince,
      startDate: shared.transactionsFrom
    }, this);
  },

  // Called by the export import after the last batch. Several lines of one invoice carry the same
  // transaction id, which is the member name — the line item tells the members of such an invoice
  // apart in a report.
  afterImport() {
    dwh.dimensions.transactions.updateDuplicateNames(
      {nameColumn: "name", addColumn: "line_item_id"});
  },

  importOne(record, rows) {
    if (!app.importers.apps.isSelected(record)) return 0;
    var transactionKey = app.importers.records.transactionKey(record);
    if (!transactionKey) {
      source.warnings.add(this.UNIDENTIFIED_WARNING_KEY,
        "An exported transaction carries no transaction ID and was not imported.");
      return 0;
    }

    var warningKey = `transaction/${transactionKey}`;
    try {
      this.buildRows(record, transactionKey).forEach((row) => rows.push(row));
      source.warnings.clearOld(warningKey);
      return 1;
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `Import of transaction ${transactionKey} failed: ${error.message}`);
      return 0;
    }
  },

  buildRows(record, transactionKey) {
    var records = app.importers.records;
    var ids = this.dimensionIds(record, transactionKey);
    var updatedAt = dwh.datetimeValue(records.date(record.lastUpdated));
    // A refund reverses a sale, so it also reverses the maintenance period that sale paid for.
    var maintenanceSign = records.humanize(record.saleType) === "Refund" ? -1 : 1;
    var rows = [];

    var saleTimeId = dwh.lookupDateId(records.date(record.saleDate));
    if (saleTimeId) {
      rows.push(this.row(transactionKey, ids, {
        time_id: saleTimeId,
        transactions: 1,
        purchase_price: records.amount(record.purchasePrice),
        vendor_amount: records.amount(record.vendorAmount),
        partner_discount_amount: this.partnerDiscount(record),
        promotion_discount_amount: records.amount(record.marketplacePromotionDiscountAmount),
        loyalty_discount_amount: records.amount(record.loyaltyDiscountAmount),
        manual_discount_amount: records.amount(record.manualDiscountAmount),
        _updated_at: updatedAt
      }));
    }

    var startTimeId = dwh.lookupDateId(records.date(record.maintenanceStartDate));
    if (startTimeId) {
      rows.push(this.row(transactionKey, ids,
        {time_id: startTimeId, maintenance_started: maintenanceSign, _updated_at: updatedAt}));
    }

    var endTimeId = dwh.lookupDateId(records.date(record.maintenanceEndDate));
    if (endTimeId) {
      rows.push(this.row(transactionKey, ids,
        {time_id: endTimeId, maintenance_ended: maintenanceSign, _updated_at: updatedAt}));
    }
    return rows;
  },

  // The partner discount of a sale is the expert discount the export reports: the column holds
  // the amount of the EXPERT entry of the `discounts` of the same transaction in the REST API,
  // which is where the vendor reports of the Marketplace REST API read it from. The older server
  // and data center invoices report the same discount, rounded differently, in the legacy
  // `partnerDiscountAmount` column as well, and the invoices of 2015 and before only there — so
  // the legacy column is read when the expert discount is empty. An expert discount of zero is a
  // discount the sale really did not get, so the columns are not merged with `||`.
  partnerDiscount(record) {
    var records = app.importers.records;
    var expertDiscount = records.amount(record.expertDiscountAmount);
    return expertDiscount === null ? records.amount(record.partnerDiscountAmount) : expertDiscount;
  },

  row(transactionKey, ids, values) {
    return Object.assign({_source_id: transactionKey, _source_name: "transaction"}, ids, values);
  },

  dimensionIds(record, transactionKey) {
    var lookups = app.importers.lookups;
    return {
      app_id: app.importers.apps.lookupId(record),
      transaction_id: this.storeTransaction(record, transactionKey),
      // The license the transaction was paid for. The licenses import writes the attributes of
      // the member; a transaction of a license which was not exported creates it bare.
      license_id: this.lookupLicenseId(record),
      hosting_id: lookups.lookupHostingId(record.hosting),
      license_type_id: lookups.lookupLicenseTypeId(record.licenseType),
      license_tier_id: lookups.lookupTierId(record.tier),
      sale_type_id: lookups.lookupSaleTypeId(record.saleType),
      billing_period_id: lookups.lookupBillingPeriodId(record.billingPeriod),
      payment_status_id: lookups.lookupPaymentStatusId(record.paymentStatus),
      product_edition_id: lookups.lookupProductEditionId(record.parentProductEdition),
      country_id: lookups.lookupCountryId(record.country, record.region),
      partner_id: lookups.lookupPartnerId(record.partnerName, record.partnerType),
      customer_id: lookups.lookupCustomerId(record.company, record.country, record.region)
    };
  },

  lookupLicenseId(record) {
    var licenseKey = app.importers.records.licenseKey(record);
    if (!licenseKey) return null;
    return dwh.dimensions.licenses.lookupOrCreateId({license_key: licenseKey}, () => ({
      app_key: app.importers.records.text(record.addonKey),
      app_name: app.importers.records.text(record.addonName)
    }));
  },

  storeTransaction(record, transactionKey) {
    var records = app.importers.records;
    return dwh.dimensions.transactions.createAndLookupId({transaction_key: transactionKey}, {
      name: records.text(record.transactionId),
      transaction_id: records.text(record.transactionId),
      line_item_id: records.text(record.transactionLineItemId),
      sale_date: dwh.dateValue(records.date(record.saleDate)),
      sale_type: records.humanize(record.saleType),
      payment_status: records.text(record.paymentStatus),
      payment_terms: records.text(record.paymentTerms),
      app_key: records.text(record.addonKey),
      app_name: records.text(record.addonName),
      hosting: records.text(record.hosting),
      license_type: records.humanize(record.licenseType),
      tier: records.normalizeTier(record.tier),
      old_tier: records.normalizeTier(record.oldTier),
      change_in_tier: records.optional(record.changeInTier),
      billing_period: records.text(record.billingPeriod),
      old_billing_period: records.optional(record.oldBillingPeriod),
      product_edition: records.productEdition(record.parentProductEdition),
      old_product_edition: records.productEdition(record.oldParentProductEdition),
      maintenance_start_date: dwh.dateValue(records.date(record.maintenanceStartDate)),
      maintenance_end_date: dwh.dateValue(records.date(record.maintenanceEndDate)),
      last_updated: dwh.dateValue(records.date(record.lastUpdated)),
      customer: records.text(record.company),
      country: records.text(record.country),
      region: records.text(record.region),
      technical_contact_name: records.text(record.technicalContactName),
      technical_contact_email: records.text(record.technicalContactEmail),
      billing_contact_name: records.text(record.billingContactName),
      billing_contact_email: records.text(record.billingContactEmail),
      partner: records.partnerName(record.partnerName),
      partner_type: records.partnerType(record.partnerType),
      license_key: records.licenseKey(record),
      license_sen: records.text(record.licenseId),
      app_entitlement_number: records.text(record.appEntitlementNumber),
      host_entitlement_number: records.text(record.hostEntitlementNumber),
      cloud_id: records.text(record.cloudId),
      refund_reason: records.text(record.refundReason),
      credit_note_reason: records.text(record.creditNoteReason),
      original_transaction_id: records.text(record.originalTransactionId),
      original_sale_date: dwh.dateValue(records.date(record.originalTransactionSaleDate)),
      payment_attempts: records.paymentAttempts(record.dunningStatus)
    });
  }
};
