describe("app.api", () => {
  beforeEach(() => {
    mock.sourceParams({oauth_client_id: "app-id", oauth_client_secret: "app-secret"});
  });

  test("testConnection returns its own user, and reports a rejected token on the form", () => {
    mock.get("/v2/users/me", {json: {id: 99, firstName: "Mr", lastName: "Robot",
                                     email: "mrobot@acme.com"}});
    expect(app.api.testConnection()).toEqual({authentication: {user: "Mr Robot"}});

    mock.get("/v2/users/me", {json: {id: 99, email: "mrobot@acme.com"}});
    expect(app.api.testConnection()).toEqual({authentication: {user: "mrobot@acme.com"}});

    mock.get("/v2/users/me", {status: 401, json: {message: "Unauthorized"}});
    var result = app.api.testConnection();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("oauth_client_id");
  });

  test("getMailboxes follows the HAL next page link", () => {
    mock.get("/v2/mailboxes", {json: {
      _embedded: {mailboxes: [{id: 13, name: "Support"}]},
      _links: {next: {href: "https://api.helpscout.net/v2/mailboxes?page=2"}}
    }});
    mock.get("/v2/mailboxes", {params: {page: 2}, json: {
      _embedded: {mailboxes: [{id: 14, name: "Sales"}]},
      _links: {}
    }});

    expect(app.api.getMailboxes().map((mailbox) => mailbox.id)).toEqual([13, 14]);
    expect(mock.requests()).toHaveLength(2);
  });

  test("getSourceSelections offers the inboxes to select from", () => {
    mock.get("/v2/mailboxes", {fixture: "mailboxes"});

    var selections = app.api.getSourceSelections();

    expect(selections.multiple).toBe(true);
    expect(selections.options).toEqual([
      {key: "13", name: "Support"},
      {key: "14", name: "Sales"}
    ]);
  });

  test("getConversations requests the selected inboxes with their threads embedded", () => {
    mock.get("/v2/conversations", {fixture: "conversations"});
    var conversations = [];

    app.api.getConversations(["13", "14"], "2026-01-01T00:00:00Z",
      (batch) => batch.forEach((conversation) => conversations.push(conversation)));

    expect(conversations.map((conversation) => conversation.number)).toEqual([12, 13]);
    // The fixture page is shorter than a full page of 25, so it is the last one — one request.
    expect(mock.requests()).toHaveLength(1);
    expect(mock.requests()[0].params).toMatchObject({
      status: "all",
      embed: "threads",
      mailbox: "13,14",
      sortField: "modifiedAt",
      sortOrder: "asc",
      modifiedSince: "2026-01-01T00:00:00Z",
      page: "1"
    });

    // A full import has no lower bound to send.
    app.api.getConversations(["13"], null, () => {});
    expect(mock.requests()[1].params.modifiedSince).toBeUndefined();
  });

  // The conversation pages are requested by page number, several at once, so that the following
  // pages arrive while the current one is imported. A page shorter than the fixed page size of 25
  // is the last one; the pages already requested after it are answered empty.
  test("getConversations requests the pages by number until a page is short", () => {
    var fullPage = _.map(_.range(1, 26), (number) => ({id: 1000 + number, number: number}));
    // Any page after the last one: Help Scout answers a page past the end with an empty list.
    mock.get("/v2/conversations", {json: {_embedded: {conversations: []}}});
    mock.get("/v2/conversations", {params: {page: 1}, json: {
      _embedded: {conversations: fullPage},
      _links: {next: {href: "https://api.helpscout.net/v2/conversations?status=all&page=2"}},
      page: {size: 25, totalElements: 26, totalPages: 2, number: 1}
    }});
    mock.get("/v2/conversations", {params: {page: 2}, json: {
      _embedded: {conversations: [{id: 1026, number: 26}]},
      _links: {},
      page: {size: 25, totalElements: 26, totalPages: 2, number: 2}
    }});
    var numbers = [];

    app.api.getConversations(["13"], null,
      (batch) => batch.forEach((conversation) => numbers.push(conversation.number)));

    // Every conversation once, in the page order — whatever order the parallel requests answered in.
    expect(numbers).toEqual(_.range(1, 27));
    var pages = _.map(mock.requests(), (request) => request.params.page);
    // The first page is requested alone, before anything is known about the list.
    expect(pages[0]).toBe("1");
    expect(pages).toContain("2");
    expect(_.uniq(pages)).toHaveLength(pages.length);
    // Every page request carries the filters of the sweep.
    _.each(mock.requests(), (request) => {
      expect(request.params).toMatchObject({status: "all", embed: "threads", mailbox: "13"});
    });
  });

  test("getConversationThreads and getCustomers read their HAL lists", () => {
    mock.get("/v2/conversations/124/threads", {fixture: "threads_124"});
    mock.get("/v2/customers", {fixture: "customers"});

    expect(app.api.getConversationThreads(124).map((thread) => thread.id)).toEqual([2001, 2002]);

    var customers = [];
    app.api.getCustomers("2026-01-01T00:00:00Z",
      (batch) => batch.forEach((customer) => customers.push(customer)));

    expect(customers.map((customer) => customer.id)).toEqual([238604, 29418]);
    // Customers are paged by page number as well, 50 per page.
    expect(mock.requests()).toHaveLength(2);
    expect(mock.requests()[1].params).toMatchObject({
      sortField: "modifiedAt", sortOrder: "asc", modifiedSince: "2026-01-01T00:00:00Z", page: "1"
    });
  });

  test("getCustomers requests the pages by number until a page is short", () => {
    var fullPage = _.map(_.range(1, 51), (id) => ({id: id}));
    mock.get("/v2/customers", {json: {_embedded: {customers: []}}});
    mock.get("/v2/customers", {params: {page: 1}, json: {_embedded: {customers: fullPage}}});
    mock.get("/v2/customers", {params: {page: 2}, json: {_embedded: {customers: [{id: 51}]}}});
    var ids = [];

    app.api.getCustomers(null, (batch) => batch.forEach((customer) => ids.push(customer.id)));

    expect(ids).toEqual(_.range(1, 52));
    var pages = _.map(mock.requests(), (request) => request.params.page);
    expect(pages[0]).toBe("1");
    expect(pages).toContain("2");
    expect(_.uniq(pages)).toHaveLength(pages.length);
  });

  test("getAvailableCustomFields offers the fields of the selected inboxes", () => {
    mock.get("/v2/mailboxes", {fixture: "mailboxes"});
    mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});

    var fields = app.api.getAvailableCustomFields(["13"]);

    // A dropdown and a single line field can be a dimension, only a number can be a measure, and a
    // date and a multi line field are properties only. The unsupported type is not offered at all.
    expect(fields).toEqual([
      {key: "104", name: "Priority", dataType: "string", dimension: true, measure: false,
       group: "Support"},
      {key: "105", name: "Product", dataType: "string", dimension: true, measure: false,
       group: "Support"},
      {key: "106", name: "Order value", dataType: "decimal", dimension: true, measure: true,
       group: "Support"},
      {key: "107", name: "Renewal date", dataType: "date", dimension: false, measure: false,
       group: "Support"},
      {key: "108", name: "Internal notes", dataType: "text", dimension: false, measure: false,
       group: "Support"},
      {key: "109", name: "AI topic", dataType: "string", dimension: true, measure: false,
       group: "Support"}
    ]);
    expect(mock.requestedPaths()).not.toContain("/v2/mailboxes/14/fields");
  });

  test("getAvailableCustomFields offers every inbox when nothing is selected", () => {
    mock.get("/v2/mailboxes", {fixture: "mailboxes"});
    mock.get("/v2/mailboxes/13/fields", {fixture: "mailbox_fields_13"});
    mock.get("/v2/mailboxes/14/fields", {fixture: "mailbox_fields_14"});

    // An empty selection imports the conversations of every inbox, so it offers their fields too.
    var fields = app.api.getAvailableCustomFields([]);

    expect(_.map(fields, (field) => field.key)).
      toEqual(["104", "105", "106", "107", "108", "109", "204", "205"]);
    // A field of the same name in another inbox is its own field, grouped by its inbox.
    expect(_.map(_.filter(fields, (field) => field.name === "Priority"),
      (field) => field.group)).toEqual(["Support", "Sales"]);
  });

  test("getCustomersCount reads the total of the customers sweep in one request", () => {
    mock.get("/v2/customers", {fixture: "customers"});

    expect(app.api.getCustomersCount("2026-01-01T00:00:00Z")).toBe(2);

    expect(mock.requests()).toHaveLength(1);
    expect(mock.requests()[0].params).toMatchObject({
      sortField: "modifiedAt", modifiedSince: "2026-01-01T00:00:00Z"
    });
  });

  test("getCustomersCount returns null when there is no total to read", () => {
    mock.get("/v2/customers", {status: 500, json: {message: "Server error"}});

    expect(app.api.getCustomersCount(null)).toBeNull();
  });

  test("getConversationsCount reads the total of the whole selection in one request", () => {
    mock.get("/v2/conversations", {fixture: "conversations"});

    expect(app.api.getConversationsCount(["13", "14"], "2026-01-01T00:00:00Z")).toBe(2);

    expect(mock.requests()).toHaveLength(1);
    // Every selected inbox in one request, with the filters of the sweep — but without the
    // embedded threads, which the count does not need.
    expect(mock.requests()[0].params).toMatchObject({
      status: "all", mailbox: "13,14", modifiedSince: "2026-01-01T00:00:00Z"
    });
    expect(mock.requests()[0].params.embed).toBeUndefined();
  });

  test("getConversationsCount returns null when there is no total to read", () => {
    mock.get("/v2/conversations", {status: 500, json: {message: "Server error"}});

    expect(app.api.getConversationsCount(["13"], null)).toBeNull();
  });

  test("getHappinessRatings pages the report by page number until a page is empty", () => {
    mock.get("/v2/reports/happiness/ratings", {params: {page: 1}, json: {
      results: [{threadid: 1, ratingId: 1}], page: 1, count: 1, pages: 2
    }});
    mock.get("/v2/reports/happiness/ratings", {params: {page: 2}, json: {
      results: [{threadid: 2, ratingId: 3}], page: 2, count: 1, pages: 2
    }});
    mock.get("/v2/reports/happiness/ratings", {params: {page: 3}, json: {
      results: [], page: 3, count: 0, pages: 2
    }});
    var ratings = [];

    app.api.getHappinessRatings(["13"], "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z",
      (batch) => batch.forEach((rating) => ratings.push(rating)));

    expect(ratings.map((rating) => rating.threadid)).toEqual([1, 2]);
    // The two pages of ratings, plus the empty page that ends the pagination.
    expect(mock.requests()).toHaveLength(3);
    expect(mock.requests()[0].params).toMatchObject({
      start: "2026-01-01T00:00:00Z", end: "2026-04-01T00:00:00Z", mailboxes: "13"
    });
  });

  // A report which clamped an out of range page number to the last page would otherwise be paged
  // until the pagination request limit, re-importing the same ratings on every page.
  test("getHappinessRatings stops when a page repeats the previous one", () => {
    mock.get("/v2/reports/happiness/ratings", {json: {
      results: [{threadid: 1, ratingId: 1}], page: 1, count: 1, pages: 1
    }});
    var batches = 0;

    app.api.getHappinessRatings([], "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z",
      () => { batches++; });

    expect(batches).toBe(1);
    expect(mock.requests()).toHaveLength(2);
  });
});
