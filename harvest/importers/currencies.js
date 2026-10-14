// The currencies the amounts of the cube are in, each with the euro reference rate of the European
// Central Bank that the amount measures are converted with.
app.importers.currencies = {
  // Imported whatever the account bills in, the way the built-in Harvest application imports them, so
  // that the euro and the US dollar conversions have a rate in every account.
  ALWAYS_IMPORTED: ["EUR", "USD"],
  // The max param of the currencies the stored invoices and projects are billed in, as sorted comma
  // separated codes.
  BILLED_CURRENCIES_PARAM: "currencies",
  // The longest string a max param holds.
  MAX_PARAM_LENGTH: 1000,
  WARNING_KEY: "currency_rates",

  euroRates: {},
  // The currency of the Harvest account, which the cost rates are kept in. Harvest answers it with the
  // company, although its documentation does not list it.
  accountCurrency: null,
  // By code: the currencies the stored invoices and projects are billed in.
  billedCurrencies: {},
  currenciesWithoutRate: {},

  // The incremental import reads an invoice or a timesheet row again only when it changed, so the
  // currencies the stored ones are billed in are remembered from the imports which read them, and every
  // import reads their rates with the currencies of the account. A check for deleted records reads every
  // invoice and every row and collects them anew, which forgets a currency nothing is billed in any more.
  importAll(company, clientCurrencies) {
    logger.startImport("currencies");
    this.accountCurrency = (company && company.currency) || null;
    var accountCurrencies = _.uniq(_.compact(
      this.ALWAYS_IMPORTED.concat([this.accountCurrency], clientCurrencies)));
    var billedCurrencies = app.importers.sweep.sweeping ? [] : this.rememberedCurrencies();
    this.billedCurrencies = this.setOf(billedCurrencies);

    var importedCurrencies = _.uniq(accountCurrencies.concat(billedCurrencies)).sort();
    this.euroRates = app.api.getEuroExchangeRates();
    this.currenciesWithoutRate = {};
    // The former account currency may be one nothing is billed in, which is not stored again, and a
    // failed import may have flagged one without saving what it flagged, so every flag is taken first.
    dwh.dimensions.currencies.update({account_currency: false}, {account_currency: true});
    importedCurrencies.forEach((currency) => this.storeCurrency(currency));
    logger.finishImport("currencies", importedCurrencies.length);
  },

  // The member of the currency of a project, of a timesheet row or of an invoice. A currency of an
  // invoice which no client of the account is billed in is not in the list above, so it is created here
  // with its rate; a currency the rates did not name still gets a member, so that the amounts are
  // reported in the currency they are billed in. A currency of the account is remembered as well: a
  // client may be billed in another one later, while its unchanged invoices and rows keep this one.
  lookupId(currency) {
    if (!currency) return null;
    this.billedCurrencies[currency] = true;
    return this.storeCurrency(currency);
  },

  // Stages the billed currencies for the next import. The codes of all the currencies there are fit into
  // one max param many times over, so the cap only guards its limit.
  finish() {
    var currencies = _.keys(this.billedCurrencies).sort();
    var value = currencies.join(",");
    if (value.length > this.MAX_PARAM_LENGTH) {
      value = value.substring(0, value.lastIndexOf(",", this.MAX_PARAM_LENGTH));
      logger.warn(`Only ${value.split(",").length} of the ${currencies.length} currencies the stored ` +
        "invoices and projects are billed in are remembered, the others get a new rate only with the " +
        "invoices and the rows which are read again");
    }
    if (value !== (source.getMaxParam(this.BILLED_CURRENCIES_PARAM) || "")) {
      source.setMaxParam(this.BILLED_CURRENCIES_PARAM, value);
    }
    this.warnOfCurrenciesWithoutRate();
  },

  // A report does not show that an EUR or USD amount left out a currency, or converted it with an old
  // rate: the rates document could not be read, or the European Central Bank publishes no rate of it.
  warnOfCurrenciesWithoutRate() {
    var currencies = _.keys(this.currenciesWithoutRate).sort();
    if (currencies.length === 0) {
      source.warnings.clearOld(this.WARNING_KEY);
      return;
    }
    var codes = currencies.join(", ");
    source.warnings.add(this.WARNING_KEY, `No euro reference rate of ${codes} was read from the European ` +
      `Central Bank. The EUR and USD measures convert the amounts in ${codes} with the rate of an earlier ` +
      "import, or leave them out when there is none.");
  },

  rememberedCurrencies() {
    return _.compact(String(source.getMaxParam(this.BILLED_CURRENCIES_PARAM) || "").split(","));
  },

  setOf(currencies) {
    var set = {};
    currencies.forEach((currency) => {
      set[currency] = true;
    });
    return set;
  },

  // A reference rate is published for every business day, so the rate of a currency is written on every
  // import. A rate the European Central Bank did not answer — a currency it does not publish, or a
  // document which could not be read — leaves the stored rate as it is: the amounts of that currency are
  // then converted with the rate of the last import which read one, instead of with none at all.
  //
  // The flag of the account currency is written with it, so that the currency the account had before
  // loses the flag when the account changes it.
  storeCurrency(currency) {
    var attributes = {account_currency: currency === this.accountCurrency,
                      generation: app.importers.sweep.generation};
    var eurRate = this.rateOf(currency);
    if (eurRate !== null) {
      attributes.eur_rate = eurRate;
    } else {
      this.currenciesWithoutRate[currency] = true;
    }

    return dwh.dimensions.currencies.createAndLookupId({currency: currency}, attributes);
  },

  rateOf(currency) {
    return this.euroRates[currency] || null;
  }
};
