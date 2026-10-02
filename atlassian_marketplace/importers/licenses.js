// One exported license becomes one License dimension member and one or two fact rows: the license
// starts its maintenance, and — unless it is a free license which never ends — it ends. The
// cumulative difference of the two is the number of licenses in force at any date.
app.importers.licenses = {
  MEASURES_TABLE: "licenses",
  UNIDENTIFIED_WARNING_KEY: "license/unidentified",

  importAll(developerId, shared) {
    // The warning of the licenses without a key is shared by all of them, so it is cleared here
    // and added again only when this import exports such a license.
    source.warnings.clearOld(this.UNIDENTIFIED_WARNING_KEY);
    return app.importers.exports.run(developerId, "licenses", {
      accept: "csv",
      addon: shared.appKeys,
      lastUpdated: shared.licensesSince,
      // The Marketplace excludes the licenses of Atlassian's own accounts unless they are asked
      // for, so the option is sent only when it is on.
      includeAtlassianLicenses: shared.includeAtlassianLicenses ? "true" : null
    }, this);
  },

  // Builds the rows of one license into `rows` and returns how many licenses it imported. A
  // license that can not be imported is reported and skipped, so that the rest of the export is
  // imported and the next import asks for the same range again.
  importOne(record, rows) {
    if (!app.importers.apps.isSelected(record)) return 0;
    var licenseKey = app.importers.records.licenseKey(record);
    if (!licenseKey) {
      source.warnings.add(this.UNIDENTIFIED_WARNING_KEY,
        "An exported license carries neither a license ID nor an app entitlement number and " +
        "was not imported.");
      return 0;
    }

    var warningKey = `license/${licenseKey}`;
    try {
      this.buildRows(record, licenseKey).forEach((row) => rows.push(row));
      source.warnings.clearOld(warningKey);
      return 1;
    } catch (error) {
      source.warnings.addObjectFailure(warningKey,
        `Import of license ${licenseKey} failed: ${error.message}`);
      return 0;
    }
  },

  buildRows(record, licenseKey) {
    var records = app.importers.records;
    var ids = this.dimensionIds(record, licenseKey);
    var updatedAt = dwh.datetimeValue(records.date(record.lastUpdated));
    var rows = [];

    var startTimeId = dwh.lookupDateId(records.date(record.maintenanceStartDate));
    if (startTimeId) {
      rows.push(this.row(licenseKey, ids,
        {time_id: startTimeId, licenses: 1, _updated_at: updatedAt}));
    }

    // A free license has no end date at all — it is in force until the Marketplace says otherwise.
    var endTimeId = dwh.lookupDateId(records.date(record.maintenanceEndDate));
    if (endTimeId) {
      rows.push(this.row(licenseKey, ids,
        {time_id: endTimeId, licenses_ending: 1, _updated_at: updatedAt}));
    }

    // A license the Marketplace answers without any date is a member without a single fact row,
    // which no measure would ever count — the user is told instead of the license disappearing
    // from every report without a trace.
    if (rows.length === 0) {
      source.warnings.add(`license/${licenseKey}`,
        `License ${licenseKey} has no maintenance start date and was imported without data.`);
    }
    return rows;
  },

  row(licenseKey, ids, values) {
    return Object.assign({_source_id: licenseKey, _source_name: "license"}, ids, values);
  },

  dimensionIds(record, licenseKey) {
    var lookups = app.importers.lookups;
    return {
      app_id: app.importers.apps.lookupId(record),
      license_id: this.storeLicense(record, licenseKey),
      hosting_id: lookups.lookupHostingId(record.hosting),
      license_type_id: lookups.lookupLicenseTypeId(record.licenseType),
      license_status_id: lookups.lookupLicenseStatusId(record.status),
      license_tier_id: lookups.lookupTierId(record.tier),
      country_id: lookups.lookupCountryId(record.country, record.region),
      partner_id: lookups.lookupPartnerId(record.partnerName, record.partnerType),
      customer_id: lookups.lookupCustomerId(record.company, record.country, record.region)
    };
  },

  storeLicense(record, licenseKey) {
    var records = app.importers.records;
    return dwh.dimensions.licenses.createAndLookupId({license_key: licenseKey}, {
      license_sen: records.text(record.licenseId),
      app_key: records.text(record.addonKey),
      app_name: records.text(record.addonName),
      hosting: records.text(record.hosting),
      license_type: records.humanize(record.licenseType),
      status: records.humanize(record.status),
      tier: records.normalizeTier(record.tier),
      start_date: dwh.dateValue(records.date(record.maintenanceStartDate)),
      end_date: dwh.dateValue(records.date(record.maintenanceEndDate)),
      latest_maintenance_start_date:
        dwh.dateValue(records.date(record.latestMaintenanceStartDate)),
      latest_evaluation_start_date:
        dwh.dateValue(records.date(record.latestEvaluationStartDate)),
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
      cloud_site_hostname: records.text(record.cloudSiteHostname),
      cloud_id: records.text(record.cloudId),
      app_entitlement_number: records.text(record.appEntitlementNumber),
      host_entitlement_number: records.text(record.hostEntitlementNumber),
      license_level: records.text(record.licenseLevel),
      license_source_type: records.text(record.licenseSourceType),
      new_billing_system: records.optional(record.newBillingSystem),
      in_grace_period: records.optional(record.inGracePeriod),
      extended_server_support: records.optional(record.extendedServerSupport),
      cmt_status: records.text(record.cmtStatus)
    });
  }
};
