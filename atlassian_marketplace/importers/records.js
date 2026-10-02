// The values of one exported CSV row, read the way the cube needs them. Both the licenses and
// the transactions export answer flat rows of strings, where a missing value is an empty string.
app.importers.records = {
  // The user counts the License Tier ranges group the tiers into.
  TIER_RANGES: [
    {max: 10, name: "1-10 Users"},
    {max: 25, name: "11-25 Users"},
    {max: 50, name: "26-50 Users"},
    {max: 100, name: "51-100 Users"},
    {max: 250, name: "101-250 Users"},
    {max: 500, name: "251-500 Users"},
    {max: 2000, name: "501-2000 Users"},
    {max: 10000, name: "2001-10000 Users"}
  ],
  // The tier of an unlimited license, and the range of everything above the largest range.
  UNLIMITED_USERS: 1000000,
  UNLIMITED_RANGE: {max: 1000000, name: "Unlimited Users"},
  LARGEST_RANGE: {max: 999999, name: "10000+ Users"},
  // A tier which names no user count at all — "Evaluation", "Demonstration License".
  OTHER_RANGE: {max: 0, name: "Other"},

  // The words the Partner Group level takes off the end of a partner name, compared after the
  // name is lower cased and its accents and dots are removed: the legal forms of the companies
  // ("GmbH", "Pty Ltd", "S.A. de C.V.", "Sp. z o.o."), the descriptors of what they do
  // ("Consulting", "Technologies", "Group") and the places of a local subsidiary ("UK",
  // "Deutschland", "LATAM").
  PARTNER_LEGAL_FORMS: [
    "ltd", "limited", "inc", "incorporated", "incorporate", "gmbh", "llc", "llp", "plc", "corp",
    "corporation", "company", "co", "cia", "ag", "ab", "as", "aps", "oy", "ou", "sa", "sas",
    "sarl", "sl", "slu", "sau", "srl", "slr", "spa", "sro", "doo", "dooel", "bv", "nv", "bvba",
    "se", "kg", "kft", "zrt", "ltda", "lda", "pty", "pte", "pvt", "private", "sdn", "bhd", "sac",
    "jsc", "est", "fze", "fzco", "dwc", "uab", "sia", "lp", "sp", "z", "o", "oo", "spolka",
    "ograniczona", "odpowiedzialnoscia", "sk", "cv", "rl", "unipersonal", "sociedad", "anonima",
    "anonim", "sirketi", "srketi", "sti", "bt"
  ],
  PARTNER_DESCRIPTORS: [
    "international", "global", "holding", "holdings", "group", "groupe", "services", "service",
    "servicos", "solutions", "solution", "solucoes", "software", "technology", "technologies",
    "tech", "consulting", "consultants", "consultancy", "consultoria", "conseil", "systems",
    "system", "sistemas", "partners", "partner", "labs", "branch", "division", "media",
    "licenciamentos", "bilisim", "teknolojileri", "teknoloji", "yazilim", "cozumleri",
    "informatica", "informacao", "informatika", "tecnologia", "tecnologias", "reseller", "deal",
    "reg", "dnu", "no"
  ],
  PARTNER_PLACES: [
    "uk", "usa", "us", "america", "americas", "north", "europe", "emea", "latam", "apac", "asia",
    "pacific", "benelux", "nordic", "deutschland", "germany", "austria", "switzerland", "swiss",
    "france", "belgium", "netherlands", "nederland", "spain", "espana", "italy", "italia",
    "portugal", "ireland", "sweden", "sverige", "norway", "denmark", "finland", "poland", "polska",
    "czech", "republic", "turkey", "turkiye", "greece", "cyprus", "malta", "hungary", "romania",
    "bulgaria", "croatia", "serbia", "slovakia", "lithuania", "latvia", "estonia", "ukraine",
    "india", "singapore", "malaysia", "indonesia", "thailand", "vietnam", "philippines", "china",
    "hong", "kong", "japan", "korea", "australia", "nz", "canada", "mexico", "brasil", "brazil",
    "chile", "colombia", "peru", "argentina", "uruguay", "guatemala", "egypt", "morocco", "ksa",
    "uae", "saudi", "arabia", "middle", "east", "me", "lebanon", "kenya", "africa", "federal",
    "fr", "ch", "at", "nl", "mx", "pe", "sp", "lv", "ca", "bx", "sg", "hk", "cz", "shanghai",
    "beijing", "shenzhen", "hangzhou", "wuhan"
  ],
  // The words a name may start with and its group does not: an article, the "PT" and "UAB" legal
  // forms written first, the city of a Chinese company.
  PARTNER_NAME_PREFIXES: ["the", "pt", "uab", "sia", "llc", "shanghai", "beijing", "shenzhen",
                          "hangzhou", "wuhan"],
  // The short words which are not abbreviations, so they stay in lower case inside a group name
  // and are taken off the end of one.
  PARTNER_SMALL_WORDS: [
    "and", "of", "the", "for", "to", "in", "on", "at", "by", "de", "del", "di", "da", "do", "dos",
    "das", "la", "le", "el", "los", "en", "em", "y", "e", "et", "und", "von", "van", "der"
  ],
  // The accented Latin letters and the plain letter of each, for an engine without
  // `String.prototype.normalize`.
  ACCENTED_LETTERS: "àáâãäåāăąçćčďđèéêëēėęěğìíîïīıłñńňòóôõöøőŕřśšşșťţțùúûüūůűýÿźžż" +
                    "ÀÁÂÃÄÅĀĂĄÇĆČĎĐÈÉÊËĒĖĘĚĞÌÍÎÏĪİŁÑŃŇÒÓÔÕÖØŐŔŚŠŞȘŤŢȚÙÚÛÜŪŮŰÝŸŹŽŻ",
  PLAIN_LETTERS: "aaaaaaaaacccddeeeeeeeegiiiiiilnnnooooooorrsssstttuuuuuuuyyzzz" +
                 "AAAAAAAAACCCDDEEEEEEEEGIIIIIILNNNOOOOOOORSSSSTTTUUUUUUUYYZZZ",

  // The value of a column, with the empty string of a missing value read as null.
  text(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    return text === "" ? null : text;
  },

  // The value of a column which the Marketplace fills with "NA" where it does not apply.
  optional(value) {
    var text = this.text(value);
    return text === "NA" ? null : text;
  },

  // The display name of a coded value: "OPEN_SOURCE" -> "Open source", "active" -> "Active",
  // "Corporate_reseller" -> "Corporate reseller".
  //
  // A value which is already written for display is kept exactly as it is — "Data Center" must
  // not become "Data center", which would be a second member next to the one this type seeds.
  // A value is a code when it carries an underscore or when it is written in one case only.
  humanize(value) {
    var text = this.text(value);
    if (!text) return null;
    var isCode = text.indexOf("_") >= 0 || text === text.toUpperCase() ||
      text === text.toLowerCase();
    if (!isCode) return text;
    var words = text.replace(/[_-]+/g, " ").toLowerCase().trim();
    return words.charAt(0).toUpperCase() + words.substring(1);
  },

  // An amount column: a decimal number, or null when the column is empty. A refund carries
  // negative amounts, which are kept as they are so that they subtract from the sums.
  amount(value) {
    var text = this.text(value);
    if (text === null) return null;
    var number = parseFloat(text);
    if (isNaN(number)) return null;
    return Math.round(number * 100) / 100;
  },

  // A date column, as the `YYYY-MM-DD` string the Marketplace answers, or null.
  //
  // The exports answer plain calendar dates without a time and without a time zone, which is what
  // the `dwh` time functions want of such a value: `dwh.lookupDateId`, `dwh.dateValue` and
  // `dwh.datetimeValue` take it as the date it is written as, without any time zone conversion.
  // `dwh.lookupTimeId` must not be given one — it would take it as midnight UTC, which is the
  // previous day in every time zone behind UTC.
  date(value) {
    var text = this.text(value);
    if (!text) return null;
    return /^\d{4}-\d\d-\d\d/.test(text) ? text.substring(0, 10) : null;
  },

  // "10 User" -> "10 Users", so that the same tier of two records is one member. The tiers which
  // name no user count ("Evaluation") and the per unit pricing tiers are kept as they are.
  normalizeTier(value) {
    var tier = this.text(value);
    if (!tier) return null;
    return tier.replace(/^(\d+) User$/i, "$1 Users");
  },

  // The user count a tier names: "250 Users" -> 250, "Per Unit Pricing (68 Users)" -> 68,
  // "Unlimited Users" -> the unlimited count. Null for a tier which names none.
  tierUsers(value) {
    var tier = this.text(value);
    if (!tier) return null;
    if (/unlimited/i.test(tier)) return this.UNLIMITED_USERS;
    var match = tier.match(/(\d+)\s*Users?/i);
    return match ? parseInt(match[1], 10) : null;
  },

  // The range a tier belongs to, as `{name, max}` — the member of the Range level and its order.
  tierRange(value) {
    var users = this.tierUsers(value);
    if (users === null) return this.OTHER_RANGE;
    if (users >= this.UNLIMITED_USERS) return this.UNLIMITED_RANGE;
    for (let range of this.TIER_RANGES) {
      if (users <= range.max) return range;
    }
    return this.LARGEST_RANGE;
  },

  // The partner type of a record: the Marketplace leaves it empty for a sale without a partner,
  // which is a direct sale and its own member. The sales it reports under the "Unknown" type are
  // the sales of solution partners whose type it did not record — Cprime, Praecipio, Adaptavist
  // and the other experts are among them — so the type is read as Expert, the way the vendor
  // reports of the Marketplace REST API were read before this type.
  partnerType(value) {
    var type = this.humanize(value) || "Direct";
    return type === "Unknown" ? "Expert" : type;
  },

  // The partner name of a record, with a name for the direct sales.
  partnerName(value) {
    return this.text(value) || "(direct)";
  },

  // The group of a partner: the trade name that is left of the partner name when its legal form,
  // the descriptors of its business and the country of the subsidiary are taken off the end —
  // "Adaptavist UK Services Limited", "Adaptavist Germany GmbH" and "The Adaptavist Group" are
  // all "Adaptavist". The name is compared without its case, accents and dots, so that
  // "Deiser SL" and "DEISER SL" are one group, and the group is named from the words that are
  // left: every word capitalized, a word of up to three letters written in capitals as the
  // abbreviation it usually is ("SHI", "NTT Data"), so that the group name does not depend on
  // how the record happened to write it.
  partnerGroup(value) {
    var name = this.partnerName(value);
    if (name.charAt(0) === "(") return name;
    var key = this.partnerGroupKey(name);
    return key ? this.partnerGroupName(key) : name;
  },

  // The lower case words of the trade name, or null for a name without any Latin letter or digit.
  partnerGroupKey(name) {
    var text = this.decodeEntities(name).replace(/[（(]\s*terminated\s*[)）]/gi, " ");
    // A partner "doing business as" a trade name belongs to that name, one "formerly known as"
    // another name to its current one.
    var tradeName = text.match(/\s(?:dba|d\/b\/a)\s+(.+)$/i);
    if (tradeName) text = tradeName[1];
    text = text.replace(/\s+fka\s+.*$/i, "").replace(/,\s+a\s+.*\bcompany\s*$/i, "");
    // A qualifier after a dash or a bar ("Puratech - Division of Lindus NV", "Spectrum Groupe |
    // Middle East") and in parentheses ("Accenture (UK) Limited"). A dash inside a word is kept.
    text = text.split(/\s*(?:\s-|-\s|[|\u2013\u2014])\s*/)[0];
    text = text.replace(/\s*[（(][^)）]*[)）]\s*/g, " ");
    text = this.foldLetters(text).toLowerCase().replace(/&/g, " and ").replace(/\//g, " ");
    var words = text.split(/[\s,;:]+/).filter((word) => word).map((word) => {
      // "empyra.com" and "testcrew.sa" are the names of their domains.
      return word.replace(/^([a-z0-9][a-z0-9-]{2,})\.(?:com|net|org|io|[a-z]{2})$/, "$1").
        replace(/\./g, "");
    }).filter((word) => word);
    while (words.length > 1 && this.isPartnerNameSuffix(words[words.length - 1])) words.pop();
    while (words.length > 1 && this.PARTNER_NAME_PREFIXES.indexOf(words[0]) >= 0) words.shift();
    var key = words.join(" ");
    return /[a-z0-9]/.test(key) ? key : null;
  },

  // A word a legal name ends with and its trade name does not, or a single letter — "Carahsoft
  // Technology Corporation D".
  isPartnerNameSuffix(word) {
    return /^[a-z]$/.test(word) || this.PARTNER_LEGAL_FORMS.indexOf(word) >= 0 ||
      this.PARTNER_DESCRIPTORS.indexOf(word) >= 0 || this.PARTNER_PLACES.indexOf(word) >= 0 ||
      this.PARTNER_SMALL_WORDS.indexOf(word) >= 0;
  },

  // "knowmad mood" -> "Knowmad Mood", "shi" -> "SHI", "e-core" -> "E-Core".
  partnerGroupName(key) {
    return key.split(" ").map((word, wordIndex) => word.split("-").map((part, partIndex) => {
      if (wordIndex + partIndex > 0 && this.PARTNER_SMALL_WORDS.indexOf(part) >= 0) return part;
      if (/^[a-z]{1,3}$/.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.substring(1);
    }).join("-")).join(" ");
  },

  // An exported name with HTML entities in it — "SERVI&amp;amp;Ccedil;OS" — read by its letters.
  decodeEntities(text) {
    return text.replace(/&(?:amp;)+/gi, "&").replace(/&([a-z])[a-z]+;/gi, "$1");
  },

  // The Latin letters of a name without their accents: "Consultoría" -> "Consultoria".
  foldLetters(text) {
    if (typeof text.normalize === "function") {
      text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return text.replace(/[^\u0000-\u007f]/g, (letter) => {
      var index = this.ACCENTED_LETTERS.indexOf(letter);
      return index >= 0 ? this.PLAIN_LETTERS.charAt(index) : letter;
    });
  },

  // The edition of the parent product. "Free Standard" is the free plan of a parent product,
  // which the Marketplace also reports as "Free"; "NA" means the record has no parent product.
  productEdition(value) {
    var edition = this.optional(value);
    if (!edition) return null;
    return edition === "Free Standard" ? "Free" : edition;
  },

  // The customer of a record, with a name for the records the Marketplace anonymized.
  customerName(value) {
    return this.text(value) || "(unknown customer)";
  },

  // The key which identifies a license between imports. Cloud licenses are identified by their
  // app entitlement, server and data center licenses by their license id.
  licenseKey(record) {
    return this.text(record.addonLicenseId) || this.text(record.appEntitlementNumber) ||
      this.text(record.appEntitlementId);
  },

  // The key of one transaction line. The line item id alone is not unique: a credit note reuses
  // the line item id of the invoice it credits, so the transaction id belongs in the key.
  transactionKey(record) {
    var transactionId = this.text(record.transactionId);
    if (!transactionId) return null;
    var lineId = this.text(record.transactionLineItemId) || this.licenseKey(record);
    return lineId ? `${transactionId}/${lineId}` : transactionId;
  },

  // How often the payment of a transaction was attempted, from the dunning status the export
  // writes as a JSON array into one column. Null when the column is empty or unreadable.
  paymentAttempts(value) {
    var entries = this.parseArray(value);
    return entries && entries.length > 0 ? entries.length : null;
  },

  parseArray(value) {
    var text = this.text(value);
    if (!text || text === "[]") return null;
    try {
      var parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }
};
