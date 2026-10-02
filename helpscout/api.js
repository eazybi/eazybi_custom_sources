// All requests to the Help Scout Mailbox API v2.
//
// Help Scout answers with HAL+JSON: list responses carry their items in `_embedded.<name>` and the
// next page URL in `_links.next.href`. That URL is the request URL with a `page` number added — the
// lists are numbered pages, not cursors — and the page size is fixed: conversations come 25 per page,
// the other endpoints 50. The two lists that can run to thousands of pages, conversations and
// customers, are therefore requested by page number with several pages in flight at once; the short
// lists follow the next page URL one page at a time.
app.api = {
  // The fixed page sizes of the two lists paged by page number — a page shorter than this is the
  // last one.
  CONVERSATIONS_PAGE_SIZE: 25,
  CUSTOMERS_PAGE_SIZE: 50,
  // The types of conversation thread that count as an agent reply to the customer.
  AGENT_REPLY_THREAD_TYPES: ["message", "chat", "phone", "forwardparent", "forwardchild"],
  // The thread types that are not messages at all — `lineitem` records a status or assignment change.
  NON_MESSAGE_THREAD_TYPES: ["lineitem"],
  // Help Scout user types. `system_user` is an AI powered user, which v2 reports as `user`.
  USER_TYPES: ["user", "system_user"],
  // The Help Scout custom field types, and what each of them can be selected as. A field is always
  // selectable as a conversation property; `dimension` and `measure` are offered only where they
  // make sense — a free text field would give a dimension a member per conversation, and only a
  // number can be summed. Help Scout writes the type upper case in some responses and lower case in
  // others, so the lookup is done on the upper cased value; an unknown type is not offered at all.
  CUSTOM_FIELD_TYPES: {
    SINGLE_LINE: {dataType: "string", dimension: true, measure: false},
    MULTI_LINE: {dataType: "text", dimension: false, measure: false},
    DROPDOWN: {dataType: "string", dimension: true, measure: false},
    NUMBER: {dataType: "decimal", dimension: true, measure: true},
    DATE: {dataType: "date", dimension: false, measure: false}
  },

  // Validates the entered app credentials by reading the owner of the authorized token, and returns
  // that user as the attribute identifying the authorized connection.
  testConnection() {
    var user = source.getDocument("/v2/users/me", {ignoreErrors: [401, 403]});
    if (!user || !user.id) {
      return {errors: [{field: "oauth_client_id",
        message: "Could not read the Help Scout user of this app. " +
                 "Check the App ID and App Secret and authorize the connection again."}]};
    }
    return {authentication: {user: this.userName(user)}};
  },

  // The full name of a Help Scout user, falling back to the email address of an unnamed one.
  userName(user) {
    var name = [user.firstName, user.lastName].filter((part) => part).join(" ");
    return name || user.email;
  },

  // The inboxes the user selects from before importing.
  getSourceSelections() {
    return {
      label: "Select inboxes",
      hint: "Only the conversations of the selected Help Scout inboxes are imported",
      multiple: true,
      options: this.getMailboxes().map((mailbox) => ({
        key: String(mailbox.id),
        name: mailbox.name
      }))
    };
  },

  getMailboxes() {
    return this.getAllHalDocuments("/v2/mailboxes", "mailboxes", {});
  },

  // The custom field definitions of one inbox, with the options of its dropdown fields.
  getMailboxCustomFields(mailboxId) {
    return this.getAllHalDocuments(`/v2/mailboxes/${mailboxId}/fields`, "fields", {});
  },

  // The custom fields the user selects from on the Custom fields tab. Help Scout defines them per
  // inbox, so the definitions are collected from the selected inboxes and grouped by inbox name. The
  // field id is the selection key: it survives a rename of the field, and two inboxes never share
  // one — a field of the same name in another inbox is its own selectable field with its own options.
  getAvailableCustomFields(sourceSelection) {
    var fields = [];
    this.selectedMailboxes(sourceSelection).forEach((mailbox) => {
      this.getMailboxCustomFields(mailbox.id).forEach((field) => {
        var fieldType = this.CUSTOM_FIELD_TYPES[String(field.type || "").toUpperCase()];
        if (!fieldType || !field.id) return;
        fields.push({
          key: String(field.id),
          name: field.name || `Custom field ${field.id}`,
          dataType: fieldType.dataType,
          dimension: fieldType.dimension,
          measure: fieldType.measure,
          group: mailbox.name
        });
      });
    });
    return fields;
  },

  // An empty selection imports the conversations of every inbox, so it offers the fields of every
  // inbox as well.
  selectedMailboxes(sourceSelection) {
    var mailboxes = this.getMailboxes();
    if (!sourceSelection || sourceSelection.length === 0) return mailboxes;
    var selectedKeys = sourceSelection.map((key) => String(key));
    return mailboxes.filter((mailbox) => selectedKeys.indexOf(String(mailbox.id)) >= 0);
  },

  getUsers() {
    return this.getAllHalDocuments("/v2/users", "users", {});
  },

  // The filters of the customers sweep, sent by the count request below as well.
  customersRequestParams(modifiedSince) {
    var requestParams = {sortField: "modifiedAt", sortOrder: "asc"};
    if (modifiedSince) requestParams.modifiedSince = modifiedSince;
    return requestParams;
  },

  // Streams the customer pages to the callback — an account can have many more customers than
  // conversations, and only their dimension members are needed.
  getCustomers(modifiedSince, batchCallback) {
    this.eachHalPageInParallel("/v2/customers", "customers", this.CUSTOMERS_PAGE_SIZE,
      this.customersRequestParams(modifiedSince), batchCallback);
  },

  // How many customers the sweep will return, read from the `page` envelope of the HAL list
  // response — one request, so that the sweep can report a percentage. Null when Help Scout
  // answers no total, and an error is ignored, which costs only the percentage.
  getCustomersCount(modifiedSince) {
    var requestParams = this.customersRequestParams(modifiedSince);
    requestParams.ignoreErrors = true;
    var document = source.getDocument("/v2/customers", requestParams);
    return (document && document.page && document.page.totalElements) || null;
  },

  // The filters of the conversations sweep. The count request below sends the same ones, so that
  // the total it reads describes exactly the conversations the sweep will return.
  // `status=all` is required — Help Scout lists only active conversations by default.
  conversationsRequestParams(mailboxIds, modifiedSince) {
    var requestParams = {
      status: "all",
      embed: "threads",
      sortField: "modifiedAt",
      sortOrder: "asc"
    };
    if (mailboxIds && mailboxIds.length > 0) requestParams.mailbox = mailboxIds.join(",");
    if (modifiedSince) requestParams.modifiedSince = modifiedSince;
    return requestParams;
  },

  // Streams the conversation pages to the callback with their threads embedded.
  getConversations(mailboxIds, modifiedSince, batchCallback) {
    this.eachHalPageInParallel("/v2/conversations", "conversations",
      this.CONVERSATIONS_PAGE_SIZE, this.conversationsRequestParams(mailboxIds, modifiedSince),
      batchCallback);
  },

  // How many conversations the sweep will return, read from the `page` envelope of a HAL list
  // response. The `mailbox` filter takes every selected inbox at once, so the total of the whole
  // import costs one request — and it is requested without `embed=threads`, which the count does
  // not need. Returns null when Help Scout answers no total, which costs only the percentage, and
  // an error is ignored for the same reason: the sweep itself reports a real problem right after.
  getConversationsCount(mailboxIds, modifiedSince) {
    var requestParams = this.conversationsRequestParams(mailboxIds, modifiedSince);
    delete requestParams.embed;
    requestParams.ignoreErrors = true;
    var document = source.getDocument("/v2/conversations", requestParams);
    return (document && document.page && document.page.totalElements) || null;
  },

  // The complete thread list of one conversation — the fallback for a truncated `embed=threads`.
  getConversationThreads(conversationId) {
    return this.getAllHalDocuments(`/v2/conversations/${conversationId}/threads`, "threads", {});
  },

  // The happiness ratings of a date range. This report is not HAL: it answers with a `results`
  // array and numbered pages, so it is paged by page number and not by a next page URL.
  //
  // No page size is sent, because the report has no page size parameter — and a `limit` that
  // disagreed with the page size Help Scout chooses would make a full page look like a short last
  // one and cut the import off there. The pagination therefore ends on the first empty page, which
  // costs one request past the last one; `maxConcurrency: 1` keeps that at a single request rather
  // than a batch of them. A report that clamped an out of range page number to the last page
  // instead of answering it empty would page forever, so a page repeating the previous one ends
  // the pagination as well — the same safety net `getAllGraphqlPages` applies to a repeated cursor.
  getHappinessRatings(mailboxIds, start, end, batchCallback) {
    var requestParams = {start: start, end: end};
    if (mailboxIds && mailboxIds.length > 0) requestParams.mailboxes = mailboxIds.join(",");

    var previousPageKey = null;
    source.getAllPaginatedDocuments("/v2/reports/happiness/ratings", {
      pagination: "page",
      arrayKey: "results",
      requestParams: requestParams,
      maxConcurrency: 1
    }, (batch) => {
      var pageKey = batch.map((rating) => rating.threadid).join(",");
      if (pageKey === previousPageKey) return "stop";
      previousPageKey = pageKey;
      return batchCallback(batch);
    });
  },

  // A long HAL list, paged by page number so that the pages after the current one are requested
  // while it is being imported. How many are in flight at once is the `max_concurrent_requests`
  // advanced setting of the source application (3 by default) — it is not fixed here on purpose,
  // so that an account which hits the Help Scout rate limit can lower it to 1 without a code change.
  //
  // The pagination ends on the first page shorter than `pageSize`, which is why the size has to be
  // the one Help Scout actually returns: a larger value would make every page look like the last.
  // eazyBI sends the size as a `limit` parameter as well; Help Scout has no page size parameter, and
  // since the value is its own page size the parameter changes nothing either way. A last page that
  // is exactly full costs the pages after it that are already in flight, which Help Scout answers
  // with an empty list rather than an error. The pages are sorted by `modifiedAt`, so a conversation
  // modified during the sweep can move to a later page and be imported twice, which is harmless, or
  // be missed, which the next import — that starts from the time this one started — catches up.
  // Both were just as true of following the next page URL, which carries the same page number.
  eachHalPageInParallel(path, embeddedKey, pageSize, requestParams, batchCallback) {
    source.getAllPaginatedDocuments(path, {
      pagination: "page",
      limit: pageSize,
      arrayKey: `_embedded.${embeddedKey}`,
      requestParams: requestParams
    }, batchCallback);
  },

  // A short HAL list — inboxes, users, custom fields, the threads of one conversation — follows the
  // next page URL of each response.
  eachHalPage(path, embeddedKey, requestParams, batchCallback) {
    source.getAllPaginatedDocuments(path, {
      pagination: "nextUrl",
      nextUrlPath: "_links.next.href",
      arrayKey: `_embedded.${embeddedKey}`,
      requestParams: requestParams
    }, batchCallback);
  },

  getAllHalDocuments(path, embeddedKey, requestParams) {
    var documents = [];
    this.eachHalPage(path, embeddedKey, requestParams, (batch) => {
      batch.forEach((document) => documents.push(document));
    });
    return documents;
  }
};
