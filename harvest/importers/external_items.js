// The items of other tools a time entry was tracked on: a Jira issue, a Trello card, an Asana task, a GitHub
// issue and so on. Harvest stores one `external_reference` per time entry, written by the Harvest app of
// the tool or by the Harvest browser extension, and answers it with the entry. The reference carries no
// title, so the name of an item is built from what the reference does carry and from the notes of the
// entry, which the integrations fill with the title of the item when the timer starts.
//
// The members are written while the time entries are imported, once per item and import. A check for
// deleted records reads every time entry again (importers/sweep.js), so it also removes an item which no
// time entry refers to any more.
app.importers.externalItems = {
  // The services of the Harvest integrations, by the `service` Harvest stores. Harvest stores the host of
  // the permalink, whatever service the integration sends: the Harvest app for Jira sends "JIRA" and gets
  // the host of the Jira site, `*.atlassian.net`.
  SERVICE_NAMES: {
    "trello.com": "Trello",
    "app.asana.com": "Asana",
    "github.com": "GitHub",
    "linear.app": "Linear",
    "3.basecamp.com": "Basecamp",
    "app.basecamp.com": "Basecamp",
    "basecamp.com": "Basecamp",
    "www.notion.so": "Notion",
    "app.notion.com": "Notion",
    "notion.so": "Notion"
  },
  SERVICE_HOST_SUFFIXES: [
    {suffix: ".atlassian.net", name: "Jira"},
    {suffix: ".monday.com", name: "monday.com"}
  ],
  // An issue key at the start of the notes, which the Harvest app for Jira writes as "KEY-123: Summary".
  ISSUE_KEY_PATTERN: /^([A-Z][A-Z0-9_]*-\d+)\b/,
  PERMALINK_ISSUE_KEY_PATTERN: /(?:\/browse\/|[?&]selectedIssue=)([A-Z][A-Z0-9_]*-\d+)\b/,
  // A GitHub issue or pull request permalink, which the extension always writes as `/issues/<number>`.
  GITHUB_PATH_PATTERN: /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/,
  LINEAR_PATH_PATTERN: /^\/([^/]+)\/issue\//,
  // Shorter than the name column, so that the id updateDuplicateNames appends to a repeated name fits.
  NAME_LIMIT: 240,
  SERVICE_NAME_LIMIT: 100,
  // The length of the string columns, the key among them.
  STRING_LIMIT: 255,

  serviceIdsByName: {},
  itemIdsByKey: {},

  begin() {
    this.serviceIdsByName = {};
    this.itemIdsByKey = {};
  },

  lookupId(entry) {
    var reference = entry.external_reference;
    if (!reference || !reference.id) return null;

    var serviceName = this.serviceNameOf(reference);
    var key = this.keyOf(reference, serviceName);
    if (this.itemIdsByKey[key] === undefined) {
      this.itemIdsByKey[key] = this.storeItem(reference, serviceName, key, entry);
    }
    return this.itemIdsByKey[key];
  },

  // The name of an item comes from the notes, so two items can share it, and two members of the same
  // name would be one member of the Item level.
  updateDuplicateNames() {
    dwh.dimensions.external_items.updateDuplicateNames({nameColumn: "name", addNumericColumn: "id"});
  },

  storeItem(reference, serviceName, key, entry) {
    var generation = app.importers.sweep.generation;
    var issueKey = serviceName === "Jira" ? this.issueKeyOf(entry, reference) : null;
    return dwh.dimensions.external_items.createAndLookupId({key: key}, {
      service_id: this.serviceIdOf(serviceName),
      name: this.nameOf(reference, serviceName, entry).substring(0, this.NAME_LIMIT),
      item_id: this.stringOf(reference.id),
      group_id: this.stringOf(reference.group_id),
      account_id: this.stringOf(reference.account_id),
      service: this.stringOf(reference.service),
      issue_key: this.stringOf(issueKey),
      permalink: this.textOf(reference.permalink),
      generation: generation
    });
  },

  // Two unknown hosts which differ only after the length of the name column are one service member; their
  // items stay apart, because the key of an item names the whole host.
  serviceIdOf(serviceName) {
    if (this.serviceIdsByName[serviceName] === undefined) {
      this.serviceIdsByName[serviceName] = dwh.dimensions.external_services.createAndLookupId(
        {name: serviceName.substring(0, this.SERVICE_NAME_LIMIT)},
        {generation: app.importers.sweep.generation});
    }
    return this.serviceIdsByName[serviceName];
  },

  // A service without a known name is reported by what Harvest stores, so a new integration shows up
  // under its host name instead of being left out.
  serviceNameOf(reference) {
    var service = String(reference.service || this.hostOf(reference.permalink) || "").toLowerCase();
    if (this.SERVICE_NAMES[service]) return this.SERVICE_NAMES[service];

    var hostSuffix = _.detect(this.SERVICE_HOST_SUFFIXES, (entry) => service.endsWith(entry.suffix));
    return hostSuffix ? hostSuffix.name : (service || "Other");
  },

  keyOf(reference, serviceName) {
    var key = `${serviceName}|${this.scopeOf(reference, serviceName)}|${reference.id}`;
    // A key of a long host or id is cut to the key column and told apart by a hash of the whole key.
    if (key.length <= this.STRING_LIMIT) return key;
    return `${key.substring(0, this.STRING_LIMIT - 9)}#${this.hashOf(key)}`;
  },

  // What the id of an item is unique within. A GitHub issue number within its repository and a Linear
  // identifier within its workspace, both named by the permalink, or else by the owner and the repository
  // the reference names. Any other id within the account or the site of the tool; not within the group,
  // since a Jira issue moved to another project keeps its id and a Trello card moved to another board its
  // short link.
  scopeOf(reference, serviceName) {
    var accountScope = this.textOf(reference.account_id) || this.hostOf(reference.permalink) || "";
    switch (serviceName) {
      case "GitHub":
        return this.gitHubRepositoryOf(reference) ||
          `${reference.account_id || ""}/${reference.group_id || ""}`.toLowerCase();
      case "Linear":
        return this.linearWorkspaceOf(reference) || this.textOf(reference.group_id) || accountScope;
      default:
        return accountScope;
    }
  },

  // FNV-1a, 32 bits: eight hex digits.
  hashOf(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
    }
    return ("0000000" + hash.toString(16)).slice(-8);
  },

  // The notes name the item when the integration filled them in and nobody changed them. An item without
  // notes is named by the identifier its tool shows, or by its service and id.
  nameOf(reference, serviceName, entry) {
    var title = this.firstLineOf(entry.notes);
    var label = this.labelOf(reference, serviceName, entry);
    if (label && title) return title.indexOf(label) === 0 ? title : `${label} ${title}`;
    return label || title || `${serviceName} ${reference.id}`;
  },

  // The identifier the tool shows for the item, where the reference carries it.
  labelOf(reference, serviceName, entry) {
    switch (serviceName) {
      case "Jira": return this.issueKeyOf(entry, reference);
      case "GitHub": return this.gitHubLabelOf(reference);
      case "Linear": return String(reference.id);
      default: return null;
    }
  },

  gitHubLabelOf(reference) {
    var path = this.pathOf(reference.permalink);
    var parts = path && this.GITHUB_PATH_PATTERN.exec(path);
    return parts ? `${parts[1]}/${parts[2]}#${parts[3]}` : `#${reference.id}`;
  },

  gitHubRepositoryOf(reference) {
    var path = this.pathOf(reference.permalink);
    var parts = path && this.GITHUB_PATH_PATTERN.exec(path);
    return parts ? `${parts[1]}/${parts[2]}`.toLowerCase() : null;
  },

  linearWorkspaceOf(reference) {
    var path = this.pathOf(reference.permalink);
    var parts = path && this.LINEAR_PATH_PATTERN.exec(path);
    return parts ? parts[1].toLowerCase() : null;
  },

  // The key from the notes, or from a permalink of the issue itself. The Harvest app for Jira stores the
  // page the timer was started on, which can be a board, so the permalink does not always name the issue.
  // The key is the one the issue had then: Jira gives a moved issue a new key and keeps its id.
  issueKeyOf(entry, reference) {
    var notesKey = this.ISSUE_KEY_PATTERN.exec(this.firstLineOf(entry.notes) || "");
    if (notesKey) return notesKey[1];

    var permalinkKey = this.PERMALINK_ISSUE_KEY_PATTERN.exec(String(reference.permalink || ""));
    return permalinkKey ? permalinkKey[1] : null;
  },

  firstLineOf(notes) {
    if (!notes) return null;
    var line = String(notes).split("\n")[0].trim();
    return line || null;
  },

  hostOf(url) {
    var parts = url && /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(String(url));
    return parts ? parts[1].toLowerCase() : null;
  },

  pathOf(url) {
    var parts = url && /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(String(url));
    return parts ? parts[1] : null;
  },

  textOf(value) {
    return (value === null || value === undefined || value === "") ? null : String(value);
  },

  // Harvest does not limit what an integration stores, and a value too long for its column would fail
  // the whole time entry.
  stringOf(value) {
    var text = this.textOf(value);
    return text && text.substring(0, this.STRING_LIMIT);
  }
};
