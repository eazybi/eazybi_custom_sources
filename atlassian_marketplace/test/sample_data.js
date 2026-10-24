// The sample data of the Atlassian Marketplace sample reports: the developer space of an invented vendor
// with three apps, and about four years of their licenses and sales transactions. The customers start
// evaluations, a part of them buy a monthly or an annual cloud subscription or an annual Data Center
// license, renew it, upgrade it and now and then cancel it. The sales grow over the years, dip in the
// summer and in December, the third app is launched a little more than a year ago, and the server
// licenses of the oldest app ran out with the end of the server support. A part of the annual sales is
// made through partners, some of which sell through several subsidiaries. Every name, company and email
// address is invented.
sample.seed(17);

var TODAY = sample.today();
var NOW_MS = Date.parse(`${TODAY}T00:00:00Z`);
var DAY_MS = 24 * 60 * 60 * 1000;
var HISTORY_DAYS = 4 * 365;
// The cloud prices were raised by 10% this many days ago.
var PRICE_INCREASE_DAYS_AGO = 300;

var DEVELOPER_ID = "5a3c9e10-7b2d-4f61-9c84-2e7d0b6a1f35";
var BASE = "/marketplace/rest/3";
var REPORTING_PATH = `${BASE}/reporting/developer-space/${DEVELOPER_ID}`;

// The apps of the vendor: their share of the new customers, the cloud price of one user per month, and
// the Data Center price as a share of the price list below (null for a cloud only app).
var APPS = [
  {key: "com.lumenforge.jira.timeline", name: "Lumen Timeline for Jira", parent: "Jira",
   productId: "8c2f4a61-3d7e-4b90-a5c1-6e0f9b2d7a43", launchedDaysAgo: 3000, weight: 50,
   userPrice: 1.4, dataCenterFactor: 1, serverLicenses: 220},
  {key: "com.lumenforge.jira.release-notes", name: "Lumen Release Notes for Jira", parent: "Jira",
   productId: "1f6d8b30-9a4c-4e27-b8f5-3c71d0e9a6b2", launchedDaysAgo: 3 * 365, weight: 32,
   userPrice: 0.8, dataCenterFactor: 0.55, serverLicenses: 0},
  {key: "com.lumenforge.confluence.checklists", name: "Lumen Checklists for Confluence", parent: "Confluence",
   productId: "b47e2c95-6f18-4d3a-9e02-7a5c8f1b4d60", launchedDaysAgo: 420, weight: 25,
   userPrice: 0.6, dataCenterFactor: null, serverLicenses: 0}
];

// The annual price of a Data Center or server license of each user tier, before the app factor.
var DATA_CENTER_PRICES = [[50, 900], [100, 1600], [250, 3200], [500, 5600], [750, 7500], [1000, 9200],
  [2000, 14500], [3000, 18000], [5000, 23000], [10000, 32000]];
var DATA_CENTER_TIER_WEIGHTS = [[50, 10], [100, 15], [250, 22], [500, 20], [750, 8], [1000, 10], [2000, 8],
  [3000, 3], [5000, 3], [10000, 1]];
// The user tiers of an annual cloud subscription.
var CLOUD_ANNUAL_TIERS = [25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
// The users of a cloud site that pays for an app.
var CLOUD_USER_RANGES = [[[11, 25], 22], [[26, 50], 22], [[51, 100], 22], [[101, 250], 18], [[251, 500], 9],
  [[501, 2000], 5], [[2001, 8000], 2]];
// The share of the price that the Marketplace pays out to the vendor.
var VENDOR_SHARE = {"Cloud": 0.85, "Data Center": 0.75};

var COUNTRIES = [
  ["United States of America", "Americas", 30], ["Canada", "Americas", 4], ["Brazil", "Americas", 3],
  ["Mexico", "Americas", 1], ["Germany", "EMEA", 9], ["United Kingdom", "EMEA", 7], ["France", "EMEA", 5],
  ["Netherlands", "EMEA", 3], ["Poland", "EMEA", 2], ["Sweden", "EMEA", 2], ["Spain", "EMEA", 2],
  ["Switzerland", "EMEA", 2], ["Italy", "EMEA", 2], ["Israel", "EMEA", 1.5], ["Norway", "EMEA", 1],
  ["India", "APAC", 5], ["Australia", "APAC", 4], ["Japan", "APAC", 3], ["Singapore", "APAC", 1.5],
  ["New Zealand", "APAC", 1]
].map((country) => [{name: country[0], region: country[1]}, country[2]]);

// The partners, with the subsidiaries of one partner as partners of their own, the way the Marketplace
// names them. The Marketplace reports some sales of the solution partners under the Unknown type.
var PARTNERS = [
  ["Cobaltway Consulting Ltd", "Expert", "EMEA", 14], ["Cobaltway GmbH", "Expert", "EMEA", 8],
  ["Cobaltway Pty Ltd", "Unknown", "APAC", 4], ["Nordhaven Solutions AB", "Expert", "EMEA", 6],
  ["Altiqo Technologies Inc.", "Expert", "Americas", 12], ["Brightrail Partners LLC", "Expert", "Americas", 9],
  ["Kestrelpoint SAS", "Expert", "EMEA", 5], ["Quayside Digital Ltd", "Expert", "EMEA", 4],
  ["Tidewater IT Services Pvt Ltd", "Expert", "APAC", 6], ["Orbelle Consultoria Ltda", "Expert", "Americas", 3],
  ["Lizenzwerk GmbH", "Reseller", "EMEA", 8], ["Parcelsoft BV", "Reseller", "EMEA", 5],
  ["Softcrate Licensing Inc", "Reseller", "Americas", 7], ["Vantora Corporate IT Ltd", "Corporate_reseller", "EMEA", 4],
  ["Nexbridge Procurement Inc", "Corporate_reseller", "Americas", 6]
].map((partner) => ({name: partner[0], type: partner[1], region: partner[2], weight: partner[3],
                     contact: `Partner desk ${partner[0].split(" ")[0]}`,
                     email: `apps@${partner[0].split(" ")[0].toLowerCase()}.example`}));

var REFUND_REASONS = ["Purchased by mistake", "Did not meet our requirements", "Switched to another app",
                      "Budget was cut", "Duplicate purchase"];

// More new customers around the New Year and the quarter starts, fewer in the summer and in December.
var MONTH_FACTORS = [1.1, 1.05, 1.05, 1.0, 1.0, 0.95, 0.85, 0.85, 1.0, 1.05, 1.05, 0.8];

var FIRST_NAMES = ["Ada", "Bruno", "Chloe", "Dario", "Edith", "Felix", "Greta", "Hugo", "Ines", "Jasper",
  "Kira", "Leon", "Mila", "Nico", "Olive", "Pavel", "Quinn", "Rosa", "Silas", "Talia", "Umar", "Vera",
  "Wes", "Xenia", "Yusuf", "Zoe", "Amelie", "Boris", "Celine", "Dmitri", "Esme", "Farid", "Gwen", "Hector"];
var LAST_NAMES = ["Ashdown", "Brightwell", "Castellan", "Dunmore", "Elsworth", "Fairbank", "Galloway",
  "Hartwick", "Ingleby", "Jessop", "Kettering", "Larkspur", "Merriweather", "Northcott", "Oakhurst",
  "Pemberton", "Quillfeather", "Rowntree", "Stanmore", "Thistlewood", "Underhill", "Whitcombe", "Yarborough"];
var COMPANY_WORDS = [["Blue", "Cedar", "Copper", "Silver", "North", "Harbor", "Maple", "Granite", "Willow",
  "Summit", "Pine", "Coral", "Amber", "Iron", "Lumen", "Birch", "Falcon", "Meadow", "Quartz", "Raven", "Sable",
  "Tundra", "Velvet", "Aspen", "Cobalt", "Delta", "Ember", "Frost", "Glacier", "Hollow"],
  ["peak", "field", "stone", "river", "grove", "bridge", "forge", "crest", "leaf", "wave", "point", "gate",
   "mark", "light", "works"],
  ["Analytics", "Logistics", "Labs", "Studio", "Health", "Retail", "Systems", "Foods", "Media", "Energy",
   "Bank", "Insurance", "Games", "Mobility"]];

function dateOf(ms) {
  return new Date(ms).toISOString().substring(0, 10);
}

function msOf(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function daysBetween(fromDate, toDate) {
  return Math.round((msOf(toDate) - msOf(fromDate)) / DAY_MS);
}

// The date the given number of months after `date`, on the same day of the month or on the last day of a
// shorter month, so that every period of a subscription starts on the day it was bought.
function addMonths(date, months) {
  var parts = date.split("-").map(Number);
  var first = new Date(Date.UTC(parts[0], parts[1] - 1 + months, 1));
  var lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(parts[2], lastDay));
  return dateOf(first.getTime());
}

function money(amount) {
  return Math.round(amount * 100) / 100;
}

var codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function code(length) {
  return sample.times(length, () => codeAlphabet.charAt(sample.integer(0, codeAlphabet.length - 1))).join("");
}

function uuid() {
  var hex = (length) => sample.times(length, () => sample.integer(0, 15).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${sample.pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`;
}

function entitlementNumber() {
  return `E-${code(3)}-${code(3)}-${code(3)}-${code(3)}`;
}

var companyNames = {};
var customers = [];

function newCustomer() {
  var name = null;
  for (let attempt = 0; attempt < 20 && (!name || companyNames[name]); attempt++) {
    name = `${sample.pick(COMPANY_WORDS[0])}${sample.pick(COMPANY_WORDS[1])} ${sample.pick(COMPANY_WORDS[2])}`;
  }
  if (companyNames[name]) name = `${name} ${customers.length}`;
  companyNames[name] = true;
  var domain = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example`;
  var contact = () => {
    var firstName = sample.pick(FIRST_NAMES), lastName = sample.pick(LAST_NAMES);
    return {name: `${firstName} ${lastName}`, email: `${firstName}.${lastName}@${domain}`.toLowerCase()};
  };
  var technicalContact = contact();
  var customer = {
    company: name, country: sample.pickWeighted(COUNTRIES), technicalContact: technicalContact,
    billingContact: sample.chance(0.6) ? contact() : technicalContact,
    siteName: name.split(" ")[0].toLowerCase(), cloudId: uuid(), hostEntitlementNumber: entitlementNumber(),
    hostEntitlementId: uuid()
  };
  customers.push(customer);
  return customer;
}

// A customer of one more app is often a customer of an app already.
function pickCustomer() {
  return customers.length > 50 && sample.chance(0.15) ? sample.pick(customers) : newCustomer();
}

// A partner of the region of the customer, now and then one of another region.
function pickPartner(customer) {
  return sample.pickWeighted(PARTNERS.map((partner) =>
    [partner, partner.weight * (partner.region === customer.country.region ? 4 : 1)]));
}

var licenses = [];
var transactions = [];
var invoiceNumber = sample.integer(100000000, 199999999);

function nextInvoiceId(prefix) {
  invoiceNumber += sample.integer(1, 40);
  var digits = String(invoiceNumber);
  return `${prefix}-${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6, 9)}`;
}

// The columns which a license and a transaction of the same installation share.
function installationColumns(installation) {
  var customer = installation.customer;
  var partner = installation.partner;
  var columns = {
    addonKey: installation.addon.key, addonName: installation.addon.name, hosting: installation.hosting,
    appEntitlementId: installation.appEntitlementId, appEntitlementNumber: installation.appEntitlementNumber,
    company: customer.company, country: customer.country.name, region: customer.country.region,
    technicalContactName: customer.technicalContact.name, technicalContactEmail: customer.technicalContact.email,
    billingContactName: customer.billingContact.name, billingContactEmail: customer.billingContact.email,
    partnerType: partner ? partner.type : "", partnerName: partner ? partner.name : "",
    partnerContactName: partner ? partner.contact : "", partnerContactEmail: partner ? partner.email : "",
    licenseLevel: "single-instance", productId: installation.addon.productId, cloudComplianceBoundaries: "commercial"
  };
  if (installation.hosting === "Cloud") {
    Object.assign(columns, {cloudId: customer.cloudId, hostEntitlementId: customer.hostEntitlementId,
                            hostEntitlementNumber: customer.hostEntitlementNumber});
  } else {
    Object.assign(columns, {addonLicenseId: installation.addonLicenseId, licenseId: installation.licenseId});
  }
  return columns;
}

var serverLicenseNumber = 3000000;

function newInstallation(addon, hosting, customer) {
  var installation = {addon: addon, hosting: hosting, customer: customer, partner: null,
                      appEntitlementId: uuid(), appEntitlementNumber: entitlementNumber()};
  if (hosting !== "Cloud") {
    serverLicenseNumber += sample.integer(1, 300);
    installation.addonLicenseId = String(serverLicenseNumber);
    installation.licenseId = `SEN-L${serverLicenseNumber + 15000000}`;
  }
  return installation;
}

function addLicense(installation, license) {
  var lastUpdated = license.lastUpdated || license.maintenanceStartDate;
  if (lastUpdated >= TODAY) lastUpdated = sample.daysAgo(1);
  licenses.push(Object.assign(installationColumns(installation), {
    licenseType: license.licenseType, maintenanceStartDate: license.maintenanceStartDate,
    maintenanceEndDate: license.maintenanceEndDate || "", status: license.status, tier: license.tier,
    lastUpdated: lastUpdated, latestMaintenanceStartDate: license.latestMaintenanceStartDate || license.maintenanceStartDate,
    latestEvaluationStartDate: license.latestEvaluationStartDate || "", appEdition: "",
    cloudSiteHostname: installation.hosting === "Cloud" ? `${installation.customer.siteName}.atlassian.net` : "",
    licenseSourceType: "Non-Atlassian", newBillingSystem: installation.hosting === "Cloud" ? "Yes" : "No",
    inGracePeriod: "No", extendedServerSupport: "NA"
  }));
}

function priceFactor(date) {
  return daysBetween(date, TODAY) <= PRICE_INCREASE_DAYS_AGO ? 1.1 : 1;
}

// The monthly price of a cloud subscription: the user price of the app for the first 100 users, and less
// for every user above them.
function cloudMonthlyPrice(addon, users, date) {
  var bands = [{upTo: 100, factor: 1}, {upTo: 250, factor: 0.6}, {upTo: 1000, factor: 0.35},
               {upTo: 1000000, factor: 0.15}];
  var price = 0, counted = 0;
  bands.forEach((band) => {
    var inBand = Math.max(0, Math.min(users, band.upTo) - counted);
    price += inBand * band.factor;
    counted += inBand;
  });
  return price * addon.userPrice * priceFactor(date);
}

function annualPrice(installation, tierUsers, date) {
  if (installation.hosting === "Cloud") return 10 * cloudMonthlyPrice(installation.addon, tierUsers, date);
  var listed = _.find(DATA_CENTER_PRICES, (price) => price[0] >= tierUsers) || _.last(DATA_CENTER_PRICES);
  return listed[1] * installation.addon.dataCenterFactor;
}

function tierAtLeast(tiers, users) {
  return _.find(tiers, (tier) => tier >= users) || _.last(tiers);
}

function tierAbove(tiers, tier) {
  return _.find(tiers, (other) => other > tier) || tier;
}

function tierBelow(tiers, tier) {
  return _.last(tiers.filter((other) => other < tier)) || tier;
}

// A transaction line of a subscription with its discounts. `sale.listPrice` is the price before the
// discounts; a refund passes the negative amounts of the sale it reverses instead.
function addSale(installation, subscription, sale) {
  var listPrice = money(sale.listPrice * (subscription.academic ? 0.5 : 1));
  var discounts = sale.discounts || {
    expert: installation.partner && ["Expert", "Unknown"].indexOf(installation.partner.type) >= 0
      ? money(listPrice * 0.2) : null,
    promotion: sale.saleType === "New" && subscription.promotion ? money(listPrice * 0.2) : null,
    loyalty: sale.saleType === "New" && subscription.loyalty ? money(listPrice * 0.3) : null,
    manual: subscription.manualDiscount ? money(listPrice * 0.1) : null
  };
  var purchasePrice = sale.purchasePrice !== undefined ? sale.purchasePrice
    : money(listPrice - (discounts.expert || 0) - (discounts.promotion || 0) - (discounts.loyalty || 0) -
            (discounts.manual || 0));
  var vendorAmount = sale.vendorAmount !== undefined ? sale.vendorAmount
    : money(purchasePrice * VENDOR_SHARE[installation.hosting]);
  var recent = daysBetween(sale.saleDate, TODAY) <= 7;
  var paymentStatus = sale.paymentStatus || (installation.hosting === "Cloud"
    ? (recent && sample.chance(0.12) ? "Open" : "Paid")
    : (daysBetween(sale.saleDate, TODAY) <= 20 && sample.chance(0.3) ? "Open" : "Fully paid"));
  var attempts = paymentStatus === "Open" || paymentStatus === "Uncollectible"
    ? sample.times(paymentStatus === "Open" ? 1 : 4, (index) => ({
        attemptCount: index + 1, errorCode: sample.pick(["card_declined", "expired_card", "insufficient_funds"]),
        paymentAttemptDate: `${sample.addDays(sale.saleDate, index * 3)}T0${sample.integer(1, 9)}:12:40Z`}))
    : [];
  var amount = (value) => value === null || value === undefined ? "" : value.toFixed(2);
  var transaction = Object.assign(installationColumns(installation), {
    saleDate: sale.saleDate, transactionId: sale.transactionId || nextInvoiceId("IN"),
    transactionLineItemId: uuid(), licenseType: subscription.licenseType,
    billingPeriod: subscription.billingPeriod, oldBillingPeriod: sale.saleType === "New" ? "" : subscription.billingPeriod,
    changeInBillingPeriod: "No", tier: sale.tier, oldTier: sale.oldTier || "",
    changeInTier: sale.oldTier && sale.oldTier !== sale.tier ? (sale.increase ? "Increase" : "Decrease") : "NA",
    parentProductName: installation.addon.parent, parentProductEdition: subscription.edition,
    oldParentProductEdition: sale.saleType === "New" ? "NA" : subscription.edition,
    changeInParentProductEdition: "No",
    maintenanceStartDate: sale.maintenanceStartDate, maintenanceEndDate: sale.maintenanceEndDate,
    saleType: sale.saleType, purchasePrice: amount(purchasePrice), vendorAmount: amount(vendorAmount),
    paymentStatus: paymentStatus, dunningStatus: JSON.stringify(attempts), proratedDetails: "[]",
    expertDiscountAmount: amount(discounts.expert),
    expertDiscountReason: discounts.expert ? "Solution partner discount" : "",
    marketplacePromotionDiscountAmount: amount(discounts.promotion),
    marketplacePromotionDiscountCode: discounts.promotion ? "LUMEN20" : "",
    marketplacePromotionDiscountReason: discounts.promotion ? "Promotion code" : "",
    loyaltyDiscountAmount: amount(discounts.loyalty),
    loyaltyDiscountReason: discounts.loyalty ? "Server loyalty discount" : "",
    manualDiscountAmount: amount(discounts.manual),
    manualDiscountReason: discounts.manual ? "Volume agreement" : "",
    refundReason: sale.refundReason || "", originalTransactionId: sale.originalTransactionId || "",
    originalTransactionSaleDate: sale.originalTransactionSaleDate || "",
    lastUpdated: sale.saleDate
  });
  transactions.push(transaction);
  return {transaction: transaction, discounts: discounts, purchasePrice: purchasePrice, vendorAmount: vendorAmount};
}

// A sale that the customer asks back within a few weeks: a refund line with the negative amounts and the
// maintenance period of the sale, after which the subscription ends.
function refund(installation, subscription, sale, saleTerms) {
  var refundDate = sample.addDays(sale.saleDate, sample.integer(2, 20));
  if (refundDate >= TODAY) return null;
  var negative = (value) => value === null ? null : -value;
  addSale(installation, subscription, {
    saleDate: refundDate, saleType: "Refund", tier: sale.tier, transactionId: nextInvoiceId("CN"),
    maintenanceStartDate: sale.maintenanceStartDate, maintenanceEndDate: sale.maintenanceEndDate,
    purchasePrice: -saleTerms.purchasePrice, vendorAmount: -saleTerms.vendorAmount, paymentStatus: "Refunded",
    discounts: {expert: negative(saleTerms.discounts.expert), promotion: negative(saleTerms.discounts.promotion),
                loyalty: negative(saleTerms.discounts.loyalty), manual: negative(saleTerms.discounts.manual)},
    refundReason: sample.pick(REFUND_REASONS), originalTransactionId: saleTerms.transaction.transactionId,
    originalTransactionSaleDate: sale.saleDate
  });
  saleTerms.transaction.lastUpdated = refundDate;
  return refundDate;
}

// The monthly invoices of a cloud subscription, which follows the user count of the site, until the
// customer stops it or today. Returns how it ended.
function monthlySubscription(installation, subscription) {
  var users = subscription.users, previousUsers = null;
  for (let month = 0; ; month++) {
    let periodStart = addMonths(subscription.startDate, month);
    let periodEnd = addMonths(subscription.startDate, month + 1);
    let failed = month > 0 && daysBetween(periodStart, TODAY) > 30 && sample.chance(0.008);
    let sale = {
      saleDate: periodStart, saleType: month === 0 ? "New" : "Renewal",
      tier: `Per Unit Pricing (${users} Users)`,
      oldTier: previousUsers ? `Per Unit Pricing (${previousUsers} Users)` : null, increase: users > previousUsers,
      listPrice: cloudMonthlyPrice(installation.addon, users, periodStart),
      maintenanceStartDate: periodStart, maintenanceEndDate: periodEnd,
      paymentStatus: failed ? "Uncollectible" : null
    };
    let terms = addSale(installation, subscription, sale);
    if (month === 0 && sample.chance(0.03)) {
      let refundDate = refund(installation, subscription, sale, terms);
      if (refundDate) return {endDate: refundDate, status: "cancelled", users: users, lastStart: periodStart};
    }
    let churned = failed || sample.chance(month < 3 ? 0.06 : 0.022);
    if (periodEnd >= TODAY) return {endDate: periodEnd, status: "active", users: users, lastStart: periodStart};
    if (churned) {
      return {endDate: periodEnd, status: sample.chance(0.75) ? "inactive" : "cancelled", users: users,
              lastStart: periodStart};
    }
    previousUsers = users;
    users = Math.max(11, Math.round(users * (1 + sample.decimal(-0.03, 0.06, 3))));
  }
}

// The yearly invoices of an annual cloud subscription or a Data Center license, with an upgrade to a
// larger tier now and then, until the customer does not renew it or today.
function annualSubscription(installation, subscription, tiers) {
  var tier = tierAtLeast(tiers, subscription.users);
  for (let year = 0; ; year++) {
    let termStart = addMonths(subscription.startDate, 12 * year);
    let termEnd = addMonths(subscription.startDate, 12 * (year + 1));
    let saleType = "New", oldTier = null;
    if (year > 0) {
      oldTier = tier;
      saleType = "Renewal";
      if (sample.chance(0.04)) {
        tier = tierBelow(tiers, tier);
        saleType = tier < oldTier ? "Downgrade" : "Renewal";
      } else if (sample.chance(0.3)) {
        tier = tierAbove(tiers, tier);
      }
    }
    let sale = {
      saleDate: termStart, saleType: saleType, tier: `${tier} Users`, oldTier: oldTier ? `${oldTier} Users` : null,
      increase: tier > oldTier, listPrice: annualPrice(installation, tier, termStart),
      maintenanceStartDate: termStart, maintenanceEndDate: termEnd
    };
    let terms = addSale(installation, subscription, sale);
    if (year === 0 && sample.chance(0.04)) {
      let refundDate = refund(installation, subscription, sale, terms);
      if (refundDate) return {endDate: refundDate, status: "cancelled", tier: tier, lastStart: termStart};
    }
    // An upgrade pays the difference of the two tiers for the rest of the year.
    if (sample.chance(0.1)) {
      let upgradeDate = sample.addDays(termStart, sample.integer(30, 330));
      let upgradeTier = tierAbove(tiers, tier);
      if (upgradeDate < TODAY && upgradeDate < termEnd && upgradeTier > tier) {
        let remaining = daysBetween(upgradeDate, termEnd) / daysBetween(termStart, termEnd);
        addSale(installation, subscription, {
          saleDate: upgradeDate, saleType: "Upgrade", tier: `${upgradeTier} Users`, oldTier: `${tier} Users`,
          increase: true, maintenanceStartDate: upgradeDate, maintenanceEndDate: termEnd,
          listPrice: (annualPrice(installation, upgradeTier, upgradeDate) -
                      annualPrice(installation, tier, upgradeDate)) * remaining
        });
        tier = upgradeTier;
      }
    }
    if (termEnd >= TODAY) return {endDate: termEnd, status: "active", tier: tier, lastStart: termStart};
    if (!sample.chance(installation.hosting === "Cloud" ? 0.82 : 0.88)) {
      return {endDate: termEnd, status: sample.chance(0.8) ? "inactive" : "cancelled", tier: tier,
              lastStart: termStart};
    }
  }
}

function cloudEdition(users) {
  return users > 500 ? sample.pickWeighted([["Standard", 20], ["Premium", 50], ["Enterprise", 30]])
                     : sample.pickWeighted([["Standard", 62], ["Premium", 35], ["Enterprise", 3]]);
}

// A cloud site of 10 users or fewer uses the app for free, and some uninstall it again.
function freeCloudInstallation(addon, startDate) {
  var installation = newInstallation(addon, "Cloud", pickCustomer());
  var uninstalled = sample.chance(0.3) ? sample.addDays(startDate, sample.integer(10, 500)) : null;
  if (uninstalled && uninstalled >= TODAY) uninstalled = null;
  addLicense(installation, {licenseType: "FREE", maintenanceStartDate: startDate,
    maintenanceEndDate: uninstalled, status: uninstalled ? "inactive" : "active", tier: "10 Users",
    lastUpdated: uninstalled || startDate});
}

// A community, open source or demonstration license, which is free of charge as well.
function grantedInstallation(addon, hosting, startDate) {
  var installation = newInstallation(addon, hosting, pickCustomer());
  var licenseType = sample.pickWeighted([["COMMUNITY", 45], ["OPEN_SOURCE", 35], ["DEMONSTRATION", 20]]);
  var endDate = sample.addDays(startDate, licenseType === "DEMONSTRATION" ? sample.integer(90, 365) : 365);
  addLicense(installation, {licenseType: licenseType, maintenanceStartDate: startDate, maintenanceEndDate: endDate,
    status: endDate >= TODAY ? "active" : "inactive",
    tier: hosting === "Cloud" ? `${sample.integer(11, 400)} Users` : `${sample.pickWeighted(DATA_CENTER_TIER_WEIGHTS)} Users`,
    lastUpdated: endDate < TODAY ? endDate : startDate});
}

// An evaluation, which a part of the customers turns into a subscription at its end. A cloud license
// keeps its entitlement when it is bought; a bought Data Center license is a license of its own.
function evaluation(addon, hosting, startDate, progress) {
  var customer = pickCustomer();
  var installation = newInstallation(addon, hosting, customer);
  var cloud = hosting === "Cloud";
  var users = cloud ? sample.integer.apply(sample, sample.pickWeighted(CLOUD_USER_RANGES))
                    : sample.pickWeighted(DATA_CENTER_TIER_WEIGHTS);
  var evaluationEnd = sample.addDays(startDate, 30);
  var buyDate = sample.addDays(startDate, sample.integer(10, 30));
  var bought = buyDate < TODAY && sample.chance(cloud ? 0.34 + 0.08 * progress : 0.3);
  var edition = cloud ? cloudEdition(users) : "";

  if (!bought || !cloud) {
    addLicense(installation, {licenseType: "EVALUATION", maintenanceStartDate: startDate,
      maintenanceEndDate: evaluationEnd, status: evaluationEnd >= TODAY ? "active" : "inactive", tier: "Evaluation",
      latestEvaluationStartDate: startDate, lastUpdated: evaluationEnd < TODAY ? evaluationEnd : startDate});
    if (!bought) return;
    installation = newInstallation(addon, hosting, customer);
  }

  var annual = !cloud || sample.chance(users <= 100 ? 0.15 : users <= 500 ? 0.35 : 0.6);
  var partnerChance = !cloud ? 0.55 : annual ? 0.32 : 0.04;
  if (sample.chance(partnerChance)) installation.partner = pickPartner(customer);
  var subscription = {
    startDate: buyDate, users: users, edition: edition, billingPeriod: annual ? "Annual" : "Monthly",
    academic: sample.chance(0.05), promotion: sample.chance(0.04),
    loyalty: annual && sample.chance(cloud ? 0.06 : 0.1), manualDiscount: !cloud && sample.chance(0.04)
  };
  subscription.licenseType = subscription.academic ? "ACADEMIC" : "COMMERCIAL";
  var ended = annual
    ? annualSubscription(installation, subscription, cloud ? CLOUD_ANNUAL_TIERS : DATA_CENTER_PRICES.map((price) => price[0]))
    : monthlySubscription(installation, subscription);
  addLicense(installation, {
    licenseType: subscription.licenseType, maintenanceStartDate: cloud ? startDate : buyDate,
    maintenanceEndDate: ended.endDate, status: ended.status,
    tier: ended.tier ? `${ended.tier} Users` : `${ended.users} Users`,
    latestMaintenanceStartDate: ended.lastStart, latestEvaluationStartDate: cloud ? startDate : "",
    lastUpdated: ended.status === "active" ? ended.lastStart : ended.endDate
  });
}

// The new customers of every day, more of them as the years go on.
for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
  let date = sample.daysAgo(daysAgo);
  let day = new Date(msOf(date));
  let weekend = [0, 6].indexOf(day.getUTCDay()) >= 0;
  let progress = (HISTORY_DAYS - daysAgo) / HISTORY_DAYS;
  APPS.forEach((addon) => {
    let age = addon.launchedDaysAgo - daysAgo;
    if (age < 0) return;
    let expected = 3.2 * addon.weight / 100 * (0.5 + 1.0 * progress) * MONTH_FACTORS[day.getUTCMonth()] *
      (weekend ? 0.35 : 1.25) * Math.min(1, (age + 10) / 120);
    let count = Math.floor(expected * sample.decimal(0.5, 1.5) + sample.random());
    for (let index = 0; index < count; index++) {
      let hosting = addon.dataCenterFactor && sample.chance(0.14 - 0.06 * progress) ? "Data Center" : "Cloud";
      if (sample.chance(0.03)) grantedInstallation(addon, hosting, date);
      else if (hosting === "Cloud" && sample.chance(0.24)) freeCloudInstallation(addon, date);
      else evaluation(addon, hosting, date, progress);
    }
  });
}

// The server licenses of the oldest app, bought before the history above, which were not renewed after
// the end of the server support.
APPS.forEach((addon) => {
  sample.times(addon.serverLicenses, () => {
    var installation = newInstallation(addon, "Server", pickCustomer());
    var startDate = sample.daysAgo(sample.integer(HISTORY_DAYS + 30, HISTORY_DAYS + 2000));
    var endDate = sample.addDays(startDate, 365 * sample.integer(1, 5));
    var latestEnd = sample.daysAgo(sample.integer(HISTORY_DAYS - 500, HISTORY_DAYS + 20));
    if (endDate > latestEnd) endDate = latestEnd;
    addLicense(installation, {
      licenseType: sample.pickWeighted([["COMMERCIAL", 85], ["ACADEMIC", 6], ["COMMUNITY", 5], ["OPEN_SOURCE", 4]]),
      maintenanceStartDate: startDate, maintenanceEndDate: endDate, status: "inactive",
      tier: `${sample.pickWeighted(DATA_CENTER_TIER_WEIGHTS)} Users`, lastUpdated: endDate
    });
  });
});

var LICENSE_COLUMNS = ["addonLicenseId", "hostLicenseId", "licenseId", "addonKey", "addonName", "licenseType",
  "maintenanceStartDate", "maintenanceEndDate", "status", "hosting", "tier", "company", "country", "region",
  "technicalContactName", "technicalContactEmail", "technicalContactPhone", "technicalContactAddress1",
  "technicalContactAddress2", "technicalContactCity", "technicalContactState", "technicalContactPostcode",
  "billingContactName", "billingContactEmail", "billingContactPhone", "billingContactAddress1",
  "billingContactAddress2", "billingContactCity", "billingContactState", "billingContactPostcode", "partnerType",
  "partnerName", "partnerContactName", "partnerContactEmail", "lastUpdated", "appEntitlementId",
  "appEntitlementNumber", "hostEntitlementId", "hostEntitlementNumber", "cloudId", "cloudSiteHostname", "cmtStatus",
  "cmtRelatedOnPremLicense", "extendedServerSupport", "licenseSourceType", "transactionAccountId",
  "newBillingSystem", "latestMaintenanceStartDate", "latestEvaluationStartDate", "appEdition",
  "upgradeEvaluatingEdition", "upgradeEvaluationStartDate", "licenseLevel", "multiInstanceEntitlementId",
  "multiInstanceEntitlementNumber", "inGracePeriod", "productId", "cloudComplianceBoundaries"];

var TRANSACTION_COLUMNS = ["saleDate", "transactionId", "addonLicenseId", "hostLicenseId", "licenseId",
  "addonName", "addonKey", "licenseType", "hosting", "changeInBillingPeriod", "oldBillingPeriod", "billingPeriod",
  "changeInTier", "oldTier", "tier", "appEntitlementId", "appEntitlementNumber", "parentProductName",
  "changeInParentProductEdition", "oldParentProductEdition", "parentProductEdition", "hostEntitlementId",
  "hostEntitlementNumber", "cloudId", "maintenanceStartDate", "maintenanceEndDate", "saleType", "purchasePrice",
  "vendorAmount", "partnerDiscountAmount", "proratedDetails", "paymentStatus", "dunningStatus", "refundReason",
  "creditNoteReason", "loyaltyDiscountAmount", "loyaltyDiscountReason", "marketplacePromotionDiscountAmount",
  "marketplacePromotionDiscountCode", "marketplacePromotionDiscountReason", "expertDiscountAmount",
  "expertDiscountReason", "manualDiscountAmount", "manualDiscountReason", "paymentTerms", "originalTransactionId",
  "originalTransactionSaleDate", "company", "country", "region", "technicalContactName", "technicalContactEmail",
  "billingContactName", "billingContactEmail", "partnerType", "partnerName", "partnerContactEmail",
  "partnerContactName", "lastUpdated", "transactionLineItemId", "appEdition", "licenseLevel", "productId",
  "cloudComplianceBoundaries"];

// The exported file: every value quoted, as the Marketplace writes it.
function csv(columns, records) {
  var quote = (value) => `"${value === null || value === undefined ? "" : String(value).replace(/"/g, "\"\"")}"`;
  return [columns.map(quote).join(",")]
    .concat(records.map((record) => columns.map((column) => quote(record[column])).join(","))).join("\n") + "\n";
}

mock.sourceParams({developer_id: DEVELOPER_ID, username: "reports@lumenforge.example", api_token: "sample"});
mock.sourceSelection(APPS.map((addon) => ({key: addon.key, name: addon.name})));
mock.extraOptions({
  time_dimension_time_zone: "UTC",
  import_licenses: true,
  import_transactions: true,
  include_atlassian_licenses: false,
  transactions_history: "0"
});

// The apps fit in one listing page, without a next page link.
mock.get(`${BASE}/product-listing/developer-space/${DEVELOPER_ID}`, {
  params: {limit: app.api.LISTINGS_PAGE_SIZE, includePrivate: true},
  json: {
    links: {self: `/rest/3/product-listing/developer-space/${DEVELOPER_ID}?limit=${app.api.LISTINGS_PAGE_SIZE}`},
    items: APPS.map((addon) => ({productId: addon.productId, appKey: addon.key, appName: addon.name,
                                 state: "PUBLIC", approvalStatus: "APPROVED", slug: addon.key.split(".").pop()}))
  }
});

// Each export is started, is prepared at the first status request and answers its file in the
// Marketplace order, by date.
[
  {kind: "licenses", exportId: "6e1b7c42-0a9d-4f35-8b26-d4c3e5f70a18", columns: LICENSE_COLUMNS,
   records: _.sortBy(licenses, (license) => license.maintenanceStartDate)},
  {kind: "transactions", exportId: "c93f0d58-2e7a-4b61-9f14-a8b5d2e6c307", columns: TRANSACTION_COLUMNS,
   records: _.sortBy(transactions, (transaction) => transaction.saleDate)}
].forEach((exported) => {
  var exportPath = `${REPORTING_PATH}/${app.api.EXPORTS[exported.kind].path}/async/export`;
  var exportHref = exportPath.substring(BASE.length) + `/${exported.exportId}`;
  mock.post(exportPath, {json: {
    _links: {status: {href: `${exportHref}/status`}, download: {href: exportHref, type: "text/csv"}},
    export: {id: exported.exportId}
  }});
  mock.get(`${exportPath}/${exported.exportId}/status`, {json: {
    _links: {self: {href: `${exportHref}/status`}, download: {href: exportHref}},
    export: {id: exported.exportId, status: "COMPLETED"}
  }});
  mock.get(`${exportPath}/${exported.exportId}`,
    {body: csv(exported.columns, exported.records), headers: {"Content-Type": "text/csv"}});
});
