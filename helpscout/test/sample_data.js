// The sample data of the Help Scout sample reports: the support team of an invented software company
// with three inboxes and six agents, and about 13 months of its conversations. The volume grows over
// the year, dips in the summer and in December and peaks after the New Year, and the Billing inbox is
// busiest in the first days of a month. The first reply times improve over the year, the customers
// write in mostly during the working day, and the agents reply during their office hours. Every name,
// company and email address is invented.
sample.seed(11);

// Nothing happens after the start of today, so that the same sample data is generated during the day
// and no event lies in the future.
var NOW_MS = Date.parse(`${sample.today()}T00:00:00Z`);
var HISTORY_DAYS = 400;
var HOUR_MS = 60 * 60 * 1000;
var DAY_MS = 24 * HOUR_MS;

var MAILBOXES = [
  {id: 101, name: "Support", slug: "support", email: "support@brightloop.example"},
  {id: 102, name: "Billing", slug: "billing", email: "billing@brightloop.example"},
  {id: 103, name: "Sales", slug: "sales", email: "sales@brightloop.example"}
];

var USERS = [
  {id: 3001, firstName: "Maya", lastName: "Lindqvist", jobTitle: "Support lead", role: "owner"},
  {id: 3002, firstName: "Tomas", lastName: "Reyes", jobTitle: "Support engineer", role: "user"},
  {id: 3003, firstName: "Priya", lastName: "Natarajan", jobTitle: "Support engineer", role: "user"},
  {id: 3004, firstName: "Jonas", lastName: "Berzins", jobTitle: "Support engineer", role: "user"},
  {id: 3005, firstName: "Elena", lastName: "Marchetti", jobTitle: "Billing specialist", role: "user"},
  {id: 3006, firstName: "Samuel", lastName: "Okoro", jobTitle: "Account executive", role: "user"}
].map((user) => Object.assign(user, {
  email: `${user.firstName.toLowerCase()}@brightloop.example`, type: "user", timezone: "UTC",
  createdAt: "2023-01-09T09:00:00Z", updatedAt: "2025-01-09T09:00:00Z"
}));

function userById(id) {
  return _.find(USERS, (user) => user.id === id);
}

// What each inbox receives: its share of the conversations, the agents who work it, the channels, tags
// and subjects of its conversations, and how many of them the team starts itself.
var INBOX_PROFILES = {
  101: {
    weight: 60, outbound: 0.03, spam: 0.03,
    agents: [[3001, 15], [3002, 30], [3003, 30], [3004, 25]],
    channels: [["email", 55], ["chat", 35], ["phone", 10]],
    tags: [["how-to", 30], ["bug", 20], ["integration", 15], ["feature-request", 14], ["account", 11],
           ["onboarding", 10]]
  },
  102: {
    weight: 25, outbound: 0.05, spam: 0.01,
    agents: [[3005, 70], [3001, 15], [3003, 15]],
    channels: [["email", 80], ["chat", 10], ["phone", 10]],
    tags: [["invoice", 35], ["upgrade", 22], ["payment-failed", 16], ["refund", 15], ["tax", 12]]
  },
  103: {
    weight: 15, outbound: 0.25, spam: 0.06,
    agents: [[3006, 75], [3005, 25]],
    channels: [["email", 75], ["chat", 20], ["phone", 5]],
    tags: [["pricing", 35], ["trial", 28], ["demo", 22], ["enterprise", 15]]
  }
};

var SUBJECTS = {
  "how-to": ["How do I export a report to PDF?", "Sharing a dashboard with my team",
             "Can I schedule a weekly email?", "Filtering by a custom date range", "Where are my saved views?"],
  "bug": ["Chart does not load", "Export fails with an error", "Numbers do not match the source",
          "Page is blank after login", "Sync stopped yesterday"],
  "integration": ["Connecting our CRM", "Webhook is not firing", "API rate limit question",
                  "Slack notifications missing", "SSO setup with our identity provider"],
  "feature-request": ["Dark mode please", "Request: more chart types", "Bulk edit of records",
                      "Idea for the mobile app", "Custom fields in exports"],
  "account": ["Change the account owner", "Add more seats", "Delete a user", "Reset two-factor authentication"],
  "onboarding": ["Getting started questions", "Importing our historical data", "Training session for new users",
                 "Best way to set up projects"],
  "invoice": ["Invoice copy needed", "VAT number on the invoice", "Change the billing address",
              "Invoice for last month"],
  "upgrade": ["Upgrade to the Business plan", "Switch to annual billing", "Add-on pricing question"],
  "payment-failed": ["Card was declined", "Payment failed notice", "Update the payment method"],
  "refund": ["Refund request", "Charged twice this month", "Cancel and refund"],
  "tax": ["Tax exemption certificate", "Sales tax on the invoice"],
  "pricing": ["Pricing for 50 users", "Discount for non-profits", "Quote request", "Volume pricing"],
  "trial": ["Extend our trial", "Trial questions", "Trial expired, need more time"],
  "demo": ["Book a demo", "Demo for our leadership team", "Follow-up after the demo"],
  "enterprise": ["Security questionnaire", "Enterprise agreement", "On-premise option?"]
};

var TAG_IDS = {};
Object.keys(SUBJECTS).concat(["vip"]).forEach((tag, index) => TAG_IDS[tag] = 9001 + index);

// The custom fields of each inbox. A field picks its value for a conversation from its tag and from the
// values picked before it; null leaves the field empty.
var CUSTOM_FIELDS = {
  101: [
    {id: 201, type: "dropdown", name: "Priority", options: ["High", "Medium", "Low"],
     pick: (tag) => sample.pickWeighted(tag === "bug" ? [["High", 50], ["Medium", 35], ["Low", 15]]
                                                      : [["High", 12], ["Medium", 50], ["Low", 38]])},
    {id: 202, type: "dropdown", name: "Product area", options: ["Reports", "Dashboards", "Integrations", "Mobile app"],
     pick: (tag) => tag === "integration" ? "Integrations"
       : sample.pickWeighted([["Reports", 40], ["Dashboards", 30], ["Integrations", 15], ["Mobile app", 15]])}
  ],
  102: [
    {id: 203, type: "dropdown", name: "Plan", options: ["Starter", "Business", "Enterprise"],
     pick: () => sample.pickWeighted([["Starter", 45], ["Business", 40], ["Enterprise", 15]])},
    {id: 204, type: "NUMBER", name: "Invoice amount",
     pick: (tag, values) => ["invoice", "payment-failed", "refund"].indexOf(tag) < 0 ? null
       : {Starter: () => sample.decimal(49, 199), Business: () => sample.decimal(300, 1500),
          Enterprise: () => sample.decimal(3000, 12000)}[values.Plan || "Starter"]().toFixed(2)}
  ],
  103: [
    {id: 205, type: "dropdown", name: "Lead source", options: ["Website", "Referral", "Event", "Partner"],
     pick: () => sample.pickWeighted([["Website", 50], ["Referral", 20], ["Event", 15], ["Partner", 15]])},
    {id: 206, type: "NUMBER", name: "Seats",
     pick: (tag) => String(tag === "enterprise" ? sample.integer(100, 1000) : sample.integer(5, 120))}
  ]
};
var optionId = 301;
_.flatten(_.values(CUSTOM_FIELDS)).forEach((field) => {
  if (field.options) field.options = field.options.map((label, index) => ({id: optionId++, order: index + 1,
                                                                           label: label}));
});

var RATING_COMMENTS = {
  1: ["Thank you, quick and clear!", "Great help as always.", "Solved in minutes, thanks!", null, null],
  2: ["OK, but it took a while.", "Helpful, though I needed a workaround.", null],
  3: ["Still not solved.", "Took too long to get an answer.", null]
};

// More conversations around the New Year and the quarter starts, fewer in the summer and in December.
var MONTH_FACTORS = [1.15, 1.1, 1.05, 1.05, 1.0, 0.95, 0.88, 0.88, 1.05, 1.05, 1.0, 0.88];
// When the customers write in, by hour of the day.
var HOUR_WEIGHTS = [1, 1, 1, 1, 1, 2, 3, 6, 10, 13, 14, 13, 10, 11, 13, 12, 10, 8, 6, 4, 3, 2, 2, 1]
  .map((weight, hour) => [hour, weight]);

var FIRST_NAMES = ["Ada", "Bruno", "Chloe", "Dario", "Edith", "Felix", "Greta", "Hugo", "Ines", "Jasper",
  "Kira", "Leon", "Mila", "Nico", "Olive", "Pavel", "Quinn", "Rosa", "Silas", "Talia", "Umar", "Vera",
  "Wes", "Xenia", "Yusuf", "Zoe", "Amelie", "Boris", "Celine", "Dmitri", "Esme", "Farid", "Gwen", "Hector",
  "Ilse", "Jonah", "Kaito", "Lena", "Marek", "Nadia"];
var LAST_NAMES = ["Ashdown", "Brightwell", "Castellan", "Dunmore", "Elsworth", "Fairbank", "Galloway",
  "Hartwick", "Ingleby", "Jessop", "Kettering", "Larkspur", "Merriweather", "Northcott", "Oakhurst",
  "Pemberton", "Quillfeather", "Rowntree", "Stanmore", "Thistlewood", "Underhill", "Vantongeren",
  "Whitcombe", "Yarborough", "Zellweger", "Abernathy", "Blackmore", "Cresswell", "Delacroix", "Everleigh"];
var ORGANIZATION_WORDS = [["Blue", "Cedar", "Copper", "Silver", "North", "Harbor", "Maple", "Granite",
  "Willow", "Summit", "Pine", "Coral", "Amber", "Iron", "Lumen"],
  ["Peak", "Field", "Stone", "River", "Grove", "Bridge", "Forge", "Crest", "Leaf", "Wave"],
  ["Analytics", "Logistics", "Labs", "Studio", "Health", "Retail", "Systems", "Foods", "Media", "Energy"]];
var JOB_TITLES = ["Operations manager", "Data analyst", "CTO", "Office manager", "Product manager",
  "Finance lead", "Marketing specialist", "IT administrator", null, null];
var LOCATIONS = ["Austin", "Berlin", "Toronto", "Melbourne", "Lisbon", "Oslo", "Denver", "Dublin",
  "Singapore", "Cape Town", null];

var organizations = sample.times(70, (index) => {
  var name = `${sample.pick(ORGANIZATION_WORDS[0])}${sample.pick(ORGANIZATION_WORDS[1]).toLowerCase()} ` +
    sample.pick(ORGANIZATION_WORDS[2]);
  return {id: 7001 + index, name: name, domain: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}.example`};
});

var customers = sample.times(480, (index) => {
  var firstName = sample.pick(FIRST_NAMES), lastName = sample.pick(LAST_NAMES);
  var organization = sample.chance(0.8) ? sample.pick(organizations) : null;
  var domain = organization ? organization.domain : sample.pick(["mailbox.example", "inbox.example"]);
  return {
    id: 500001 + index, firstName: firstName, lastName: lastName,
    email: `${firstName}.${lastName}${index}@${domain}`.toLowerCase(),
    jobTitle: sample.pick(JOB_TITLES), location: sample.pick(LOCATIONS),
    organization: organization ? organization.name : null,
    organizationId: organization ? organization.id : null
  };
});
// A few customers write in again and again.
var frequentCustomers = customers.slice(0, 60);

function isoDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

function personOf(person, type) {
  return {id: person.id, type: type, first: person.firstName, last: person.lastName, email: person.email};
}

// The time an agent answers at: the time itself during the office hours, otherwise the morning of the
// next working day.
function officeTime(ms) {
  var date = new Date(ms);
  var hour = date.getUTCHours(), officeHours = OFFICE_HOURS[date.getUTCDay()];
  if (hour >= officeHours[0] && hour < officeHours[1]) return ms;

  var dayMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (hour >= officeHours[1]) dayMs += DAY_MS;
  return dayMs + OFFICE_HOURS[new Date(dayMs).getUTCDay()][0] * HOUR_MS + sample.integer(0, 90) * 60000;
}

// The [start, end] hours the team answers in by JavaScript week day: a long shift on the working days
// and a short one on the weekend.
var OFFICE_HOURS = [[9, 17], [7, 20], [7, 20], [7, 20], [7, 20], [7, 20], [9, 17]];

// How long the customer waits for the first reply, shorter in chat and on the phone, and shorter as
// the year goes on.
function firstReplyHours(channel, progress) {
  if (channel === "chat") return sample.decimal(0.02, 0.4);
  if (channel === "phone") return sample.decimal(0.01, 0.1);
  return weightedHours([[[0.1, 1], 35], [[1, 4], 30], [[4, 10], 18], [[10, 24], 12], [[24, 48], 5]]) *
    (1.3 - 0.5 * progress);
}

function laterReplyHours(channel) {
  if (channel !== "email") return sample.decimal(0.02, 0.5);
  return weightedHours([[[0.1, 2], 50], [[2, 8], 30], [[8, 30], 20]]);
}

// A number of hours from one of the [from, to] ranges, picked in proportion to their weights.
function weightedHours(weightedRanges) {
  var range = sample.pickWeighted(weightedRanges);
  return sample.decimal(range[0], range[1]);
}

var threadId = 800001;

function buildThread(type, author, authorType, ms) {
  var thread = {
    id: threadId++, type: type, state: "published", createdAt: isoDateTime(ms),
    createdBy: personOf(author, authorType)
  };
  if (type !== "note" && sample.chance(0.12)) {
    thread._embedded = {attachments: [{id: thread.id, filename: "screenshot.png", mimeType: "image/png",
                                       size: sample.integer(20000, 400000)}]};
  }
  return thread;
}

var conversations = [];
var ratings = [];

function buildConversation(createdMs, progress, mailbox) {
  var profile = INBOX_PROFILES[mailbox.id];
  var channel = sample.pickWeighted(profile.channels);
  var assignee = userById(sample.pickWeighted(profile.agents));
  var otherAgent = () => userById(sample.pickWeighted(profile.agents));
  var customer = sample.chance(0.35) ? sample.pick(frequentCustomers) : sample.pick(customers);
  var outbound = channel === "email" && sample.chance(profile.outbound);
  var spam = !outbound && channel === "email" && sample.chance(profile.spam);
  var tag = sample.pickWeighted(profile.tags);
  var tags = sample.chance(0.05) ? [] : [tag];
  if (tags.length > 0 && sample.chance(0.08)) tags.push("vip");

  var customerThreadType = channel === "email" ? "customer" : channel;
  var agentThreadType = channel === "email" ? "message" : channel;
  var threads = [];
  // Every event of the conversation, until one would happen after today.
  var happened = (ms) => ms < NOW_MS;
  var lastCustomerMs = null, lastAgentMs = null, lastAgentReply = null;

  if (outbound) {
    threads.push(buildThread("message", assignee, "user", createdMs));
    lastAgentMs = createdMs;
  } else {
    threads.push(buildThread(customerThreadType, customer, "customer", createdMs));
    lastCustomerMs = createdMs;
  }

  var closedMs = null, closer = null, status;
  if (spam) {
    status = "spam";
    assignee = null;
  } else if (!outbound && sample.chance(0.03)) {
    // Solved by the customer before anybody answered, closed without a reply.
    closedMs = officeTime(createdMs + sample.decimal(0.5, 6) * HOUR_MS);
    closer = assignee;
  } else {
    var replyMs = officeTime(createdMs + firstReplyHours(channel, progress) * HOUR_MS);
    if (outbound) replyMs = null;
    var rounds = outbound ? sample.pickWeighted([[0, 40], [1, 45], [2, 15]])
                          : sample.pickWeighted([[0, 45], [1, 28], [2, 14], [3, 7], [4, 4], [6, 2]]);
    if (replyMs && happened(replyMs)) {
      lastAgentReply = buildThread(agentThreadType, sample.chance(0.85) ? assignee : otherAgent(), "user", replyMs);
      threads.push(lastAgentReply);
      lastAgentMs = replyMs;
    }
    for (let round = 0; round < rounds && lastAgentMs && happened(lastAgentMs); round++) {
      let customerMs = lastAgentMs + laterReplyHours(channel) * HOUR_MS * (channel === "email" ? 2 : 1);
      if (!happened(customerMs)) break;
      threads.push(buildThread(customerThreadType, customer, "customer", customerMs));
      lastCustomerMs = customerMs;
      // Now and then the customer adds a detail before anybody answers.
      if (sample.chance(0.2)) {
        let detailMs = customerMs + sample.decimal(0.05, 2) * HOUR_MS;
        if (!happened(detailMs)) break;
        threads.push(buildThread(customerThreadType, customer, "customer", detailMs));
        lastCustomerMs = detailMs;
      }
      let agentMs = officeTime(lastCustomerMs + laterReplyHours(channel) * HOUR_MS);
      if (!happened(agentMs)) break;
      lastAgentReply = buildThread(agentThreadType, sample.chance(0.85) ? assignee : otherAgent(), "user", agentMs);
      threads.push(lastAgentReply);
      lastAgentMs = agentMs;
    }
    if (lastAgentMs && sample.chance(0.15)) {
      let noteMs = lastAgentMs - sample.integer(5, 60) * 60000;
      if (noteMs > createdMs) threads.push(buildThread("note", otherAgent(), "user", noteMs));
    }
    var answered = lastAgentMs && (!lastCustomerMs || lastAgentMs > lastCustomerMs);
    // Many customers say thanks for the answer, and the conversation is closed after it.
    if (answered && !outbound && sample.chance(0.3)) {
      let thanksMs = lastAgentMs + sample.decimal(0.1, 12) * HOUR_MS;
      if (happened(thanksMs)) {
        threads.push(buildThread(customerThreadType, customer, "customer", thanksMs));
        lastCustomerMs = thanksMs;
      }
    }
    if (answered) {
      closedMs = Math.max(lastAgentMs, lastCustomerMs || 0) +
        weightedHours([[[0.05, 2], 50], [[2, 24], 35], [[24, 72], 15]]) * HOUR_MS;
      closer = sample.chance(0.9) ? assignee : otherAgent();
    }
  }
  if (closedMs && !happened(closedMs)) closedMs = null;
  if (!status) {
    if (closedMs) status = "closed";
    else status = lastCustomerMs && (!lastAgentMs || lastCustomerMs > lastAgentMs) ? "active" : "pending";
  }
  if (!closedMs) closer = null;
  // A few open conversations wait in the queue unassigned.
  if (!closedMs && status === "active" && sample.chance(0.2)) assignee = null;

  threads = _.sortBy(threads, (thread) => Date.parse(thread.createdAt));
  var lastMs = _.max([Date.parse(threads[threads.length - 1].createdAt), closedMs || 0]);
  var number = 1001 + conversations.length;
  var conversation = {
    id: 400001 + conversations.length, number: number, threads: threads.length, type: channel,
    status: status, state: "published",
    subject: tags.length > 0 ? sample.pick(SUBJECTS[tag]) : "Question",
    mailboxId: mailbox.id,
    assignee: assignee ? personOf(assignee, "user") : null,
    createdBy: threads[0].createdBy,
    createdAt: isoDateTime(createdMs),
    closedBy: closer ? closer.id : 0,
    closedByUser: closer ? personOf(closer, "user") : null,
    closedAt: closedMs ? isoDateTime(closedMs) : null,
    userUpdatedAt: isoDateTime(lastMs),
    customerWaitingSince: status === "active" ? {time: isoDateTime(lastCustomerMs)} : null,
    source: {type: channel === "email" ? sample.pickWeighted([["email", 75], ["web", 20], ["api", 5]]) : channel,
             via: outbound ? "user" : "customer"},
    tags: tags.map((name) => ({id: TAG_IDS[name], tag: name})),
    customFields: [],
    primaryCustomer: personOf(customer, "customer"),
    _embedded: {threads: threads}
  };
  conversations.push(conversation);

  // About a third of the customers rate the last reply they got, more happily as the year goes on.
  if (lastAgentReply && !outbound && sample.chance(0.32)) {
    var ratedMs = Date.parse(lastAgentReply.createdAt) + sample.decimal(0.2, 30) * HOUR_MS;
    if (happened(ratedMs)) {
      var ratingId = sample.pickWeighted([[1, 78 + 10 * progress], [2, 14], [3, 8 - 5 * progress]]);
      var rater = lastAgentReply.createdBy;
      ratings.push({
        number: number, threadid: lastAgentReply.id, threadCreatedAt: lastAgentReply.createdAt,
        id: conversation.id, type: channel, ratingId: ratingId, ratingCustomerId: customer.id,
        ratingCustomerName: `${customer.firstName} ${customer.lastName}`,
        ratingComments: sample.pick(RATING_COMMENTS[ratingId]), ratingCreatedAt: isoDateTime(ratedMs),
        ratingUserId: rater.id, ratingUserName: `${rater.first} ${rater.last}`
      });
    }
  }
}

for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
  let dayMs = NOW_MS - daysAgo * DAY_MS;
  let date = new Date(dayMs);
  let weekend = [0, 6].indexOf(date.getUTCDay()) >= 0;
  let progress = (HISTORY_DAYS - daysAgo) / HISTORY_DAYS;
  let expected = 7.5 * (0.75 + 0.5 * progress) * MONTH_FACTORS[date.getUTCMonth()] * (weekend ? 0.2 : 1);
  let count = Math.round(expected * sample.decimal(0.7, 1.3));
  // The invoices go out on the first of the month, and the Billing inbox hears about them.
  let billingWeight = INBOX_PROFILES[102].weight * (date.getUTCDate() <= 5 ? 2.5 : 1);
  let mailboxWeights = MAILBOXES.map((mailbox) =>
    [mailbox, mailbox.id === 102 ? billingWeight : INBOX_PROFILES[mailbox.id].weight]);

  let createdTimes = sample.times(count, () =>
    dayMs + (sample.pickWeighted(HOUR_WEIGHTS) * 60 + sample.integer(0, 59)) * 60000 + sample.integer(0, 59) * 1000);
  _.sortBy(createdTimes).forEach((createdMs) =>
    buildConversation(createdMs, progress, sample.pickWeighted(mailboxWeights)));
}

// The agents fill in most custom fields of the conversations they handle, but none of a spam
// conversation. They are picked after every conversation is generated, so that the conversations stay
// the same as without them.
conversations.forEach((conversation) => {
  if (conversation.status === "spam") return;
  var tag = conversation.tags.length > 0 ? conversation.tags[0].tag : null;
  var values = {};
  CUSTOM_FIELDS[conversation.mailboxId].forEach((field) => {
    if (!sample.chance(0.85)) return;
    var value = field.pick(tag, values);
    if (value === null) return;
    values[field.name] = value;
    var option = field.options && _.find(field.options, (option) => option.label === value);
    conversation.customFields.push({id: field.id, name: field.name, value: option ? String(option.id) : value,
                                    text: value});
  });
});

mock.sourceParams({oauth_client_id: "sample", oauth_client_secret: "sample"});
mock.sourceSelection(MAILBOXES.map((mailbox) => ({key: String(mailbox.id), name: mailbox.name})));
mock.extraOptions({
  time_dimension_time_zone: "UTC",
  import_history: "12",
  import_messages: true,
  import_ratings: true,
  use_office_hours: false
});

function halPage(embeddedKey, items, pageSize, totalElements, pageNumber) {
  var embedded = {};
  embedded[embeddedKey] = items;
  return {
    _embedded: embedded,
    page: {size: pageSize, totalElements: totalElements,
           totalPages: Math.ceil(totalElements / pageSize), number: pageNumber}
  };
}

// The short lists come in one page, without a next page URL.
mock.get("/v2/users/me", {json: USERS[0]});
mock.get("/v2/mailboxes", {json: halPage("mailboxes", MAILBOXES, 50, MAILBOXES.length, 1)});
mock.get("/v2/users", {json: halPage("users", USERS, 50, USERS.length, 1)});
MAILBOXES.forEach((mailbox) => {
  var fields = CUSTOM_FIELDS[mailbox.id].map((field, index) => {
    var definition = {id: field.id, required: false, order: index + 1, type: field.type, name: field.name};
    if (field.options) definition.options = field.options;
    return definition;
  });
  mock.get(`/v2/mailboxes/${mailbox.id}/fields`, {json: halPage("fields", fields, 50, fields.length, 1)});
});

// The long lists are requested by page number. The response without a page number answers the count
// requests and the pages past the last one, which Help Scout answers with an empty list; the pages
// themselves are mocked after it, so that they win.
mock.get("/v2/customers", {json: halPage("customers", [], app.api.CUSTOMERS_PAGE_SIZE, customers.length, 1)});
sample.pages(customers.map((customer) => ({
  id: customer.id, firstName: customer.firstName, lastName: customer.lastName, jobTitle: customer.jobTitle,
  location: customer.location, organization: customer.organization, organizationId: customer.organizationId,
  _embedded: {emails: [{id: customer.id, value: customer.email, type: "work"}]}
})), app.api.CUSTOMERS_PAGE_SIZE).forEach((page, pageIndex) => {
  mock.get("/v2/customers", {params: {page: String(pageIndex + 1)},
    json: halPage("customers", page, app.api.CUSTOMERS_PAGE_SIZE, customers.length, pageIndex + 1)});
});

mock.get("/v2/conversations",
  {json: halPage("conversations", [], app.api.CONVERSATIONS_PAGE_SIZE, conversations.length, 1)});
MAILBOXES.forEach((mailbox) => {
  var mailboxConversations = conversations.filter((conversation) => conversation.mailboxId === mailbox.id);
  sample.pages(mailboxConversations, app.api.CONVERSATIONS_PAGE_SIZE).forEach((page, pageIndex) => {
    mock.get("/v2/conversations", {params: {mailbox: String(mailbox.id), page: String(pageIndex + 1)},
      json: halPage("conversations", page, app.api.CONVERSATIONS_PAGE_SIZE, mailboxConversations.length,
                    pageIndex + 1)});
  });
});

// The happiness report pages end on the first empty page.
var RATINGS_PAGE_SIZE = 50;
var ratingPages = sample.pages(ratings, RATINGS_PAGE_SIZE);
mock.get("/v2/reports/happiness/ratings", {json: {results: [], page: ratingPages.length + 1,
                                                  count: ratings.length, pages: ratingPages.length}});
ratingPages.forEach((page, pageIndex) => {
  mock.get("/v2/reports/happiness/ratings", {params: {page: String(pageIndex + 1)},
    json: {results: page, page: pageIndex + 1, count: ratings.length, pages: ratingPages.length}});
});
