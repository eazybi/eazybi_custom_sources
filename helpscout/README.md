# Help Scout for eazyBI

Imports [Help Scout](https://www.helpscout.com/) conversations into eazyBI as a cube named
**Help Scout**, so that you can report on conversation volume, response and resolution times,
agent workload and customer happiness.

## Connecting

1. In Help Scout, open **Your Profile > My apps > Create My App** and enter the eazyBI redirect URL
   shown on the eazyBI connection page as the redirection URL.
2. Paste the **App ID** and **App Secret** into the eazyBI connection form and authorize the
   connection. eazyBI stores and refreshes the access tokens itself — a Help Scout access token
   expires after two days, so a token pasted by hand would stop working.
3. Select the inboxes to import, and on the **Custom fields** tab the custom fields to import.

An eazyBI administrator may configure a default Help Scout app for the whole deployment in the
`[source_application.custom_helpscout.auth]` settings table with the `client_id` and `client_secret`
keys (and the Help Scout OAuth hosts in `allowed_hosts`). The **App ID** and **App Secret** fields then
show a `(default)` placeholder and may be left empty; values entered in the form still take precedence.

## Import options

| Option | Default | Effect |
|---|---|---|
| Import history | 1 year | how far back the **first** import reaches; later imports continue where the previous one stopped |
| Import conversation messages | on | imports the individual messages, replies and notes of each conversation |
| Import satisfaction ratings | on | imports the happiness ratings customers gave to the agent replies |
| Use office hours | off | also counts the first reply, the response and the closing time within the office hours only |
| Office hours | Monday to Friday, 09:00–18:00 | shown when Use office hours is selected: the office days and hours of the team, in the Time dimension time zone |

Changing any of them makes the next import re-import everything, so that the data matches the new
selection. When no office day is open, every hour is an office hour, as in Help Scout, and an open
day needs a start and an end time.

## What is imported

| Object | Becomes |
|---|---|
| Inboxes | the Inbox dimension and the list of inboxes you select from |
| Users (agents) | members of the Assignee, Closed By and Agent dimensions |
| Customers | the Customer and Organization dimensions |
| Conversations | the Conversation dimension and the conversation measures |
| Messages, replies and notes | the message measures and the message counts of the conversation |
| Satisfaction ratings | the rating measures |
| Custom fields | the properties, dimensions and measures of the fields you select |

## Dimensions

**Inbox**, **Conversation**, **Status**, **Channel** (email / chat / phone), **Source** (how the
conversation reached Help Scout), **Tag**, **Assignee**, **Closed By**, **Agent**, **Customer**,
**Organization**, **Hour**, **Week Day**, **First reply interval**, **Closing interval**,
**Message count interval** and **Time**, and with **Use office hours** also
**First reply office hours interval** and **Closing office hours interval**.

- **Tag** is a multi value dimension — a conversation counts under each of its tags, and the total
  counts it once. It has an `(untagged)` member, so a conversation with no tags stays visible in a
  report grouped by tag.
- **Assignee** is who the conversation is assigned to now. It has an `(unassigned)` member, so
  unassigned conversations stay visible in a report grouped by assignee, and conversations assigned
  to a team appear under the team.
- **Closed By** is who actually closed the conversation, unlike **Assignee**, which can change
  after it was closed. It has a `(not closed)` member, so conversations still open stay visible in
  a report grouped by it.
- **Agent** is which of your staff members wrote a message and was rated for it, so it has values
  on the message and the rating measures rather than on the conversation ones — it is what replies
  sent, response time and happiness per person are counted by. A message the customer wrote carries
  no agent; that person is named by the **Customer** dimension of the same row.
- **Conversation** members are named by the conversation number and subject (`#12 Help`, or
  `#12 (no subject)` when it has none), and carry the status, channel, inbox, customer email,
  message counts, who created it, who closed it, who it is assigned to, its tags and the timestamps
  as properties — including **Updated at** (the last agent activity) and **Waiting since** (how long
  the customer has been waiting for an answer), which is what a report of the conversations still to
  be worked on is filtered and sorted by. **Tags** is every tag as one comma separated string
  (`"vip, billing"`, or `"(untagged)"` with none) — the **Tag** dimension itself already counts each
  tag of its own; this is for a report or a drill through list that shows the whole set at a glance.
- **Hour** is the hour of the day of the event a row counts — a conversation created at 09:15 counts
  under `09` in **Conversations created** and the reply that closed it under the hour it was sent.
  The hours are the ones of the Time dimension time zone you chose.
- **Week Day** is the day of the week of the same event, Monday to Sunday. It is the standard week
  day dimension over the days of the Time dimension, so it splits any measure by week day and
  crosses with **Hour** into the busiest days and hours of the week.
- **First reply interval**, **Closing interval** and **Message count interval** bucket how long a
  conversation took to answer, how long it took to close, and how many messages passed between the
  customer and the team — the distributions behind the matching average measures. None of the three
  count internal notes, so a conversation with only notes and no reply does not bucket as if it had
  been answered. The defaults are boundaries at 6, 12 and 24 hours for First reply interval, daily
  buckets over two weeks for Closing interval, and one bucket per message up to ten for Message count
  interval; you can change the boundaries and the bucket names of your account in the report editor,
  and those overrides survive a re-import.
- **First reply office hours interval** and **Closing office hours interval** bucket the same two
  durations counted within the office hours only — boundaries at 6, 12 and 24 office hours for the
  first, and 8 hour buckets (about one working day each) over the first 72 office hours for the
  second. They are added with the **Use office hours** option and stay in the cube, with no values,
  when it is deselected again.

## Measures

| Measure | Counted at |
|---|---|
| Conversations created | when the conversation was created |
| Conversations updated | when it was last updated |
| Conversations closed | when it was closed |
| Conversations resolved | when it was closed, if an agent had answered it |
| Conversations resolved on first reply | when it was closed, if one reply was enough |
| Closed conversations messages | when it was closed |
| Conversations with first reply | the first agent reply |
| First reply hours | the first agent reply |
| Closing hours | when the conversation was closed |
| First reply office hours | the first agent reply, with Use office hours |
| Closing office hours | when the conversation was closed, with Use office hours |
| Customers | when the conversation was created or updated |
| Conversation messages created | when each message was written |
| Customer messages created / Agent replies created / Notes created | when each message was written |
| Attachments created | when the message carrying them was written |
| Customers helped | when the agent replied |
| Response hours, Response office hours, Agent replies with response time | when the agent replied |
| Ratings, Great ratings, Okay ratings, Not good ratings | when the customer rated the reply |

Also **Average first reply hours**, **Average response hours**, **Average closing hours**, and with
**Use office hours** also **Average first reply office hours**, **Average response office hours**
and **Average closing office hours**, plus **Average messages per closed conversation**,
**Conversations closed without reply**, **Resolved on first reply %**, **Happiness score** and the
**% great / okay / not good ratings** shares.

The **Conversation properties** group holds one property measure per Conversation property —
**Conversation Status**, **Conversation Inbox**, **Conversation Created at**,
**Conversation Closed at**, **Conversation Updated at**, **Conversation Waiting since**,
**Conversation Created by**, **Conversation Closed by**, **Conversation Messages** and so on — for
a report with conversations on rows or a drill through list of conversations that shows the
properties of each conversation next to its measures.

Every event of a conversation is counted in the Time period it happened in, not in the period the
conversation was created — so a conversation created in January and closed in February adds to
**Conversations created** in January and to **Conversations closed** in February.

### How the response and resolution measures are defined

They follow the definitions of the Help Scout reports, so that the numbers can be compared with
what Help Scout itself shows:

- The **first reply** is the earliest message an agent sent to the customer at or after the
  conversation was created. Internal notes and status changes are not replies. A conversation an
  agent started is outbound — its first message answers nobody, so it gets no first reply and is
  not counted in **Conversations with first reply**.
- **Response hours** measures the wait before *every* reply and not only before the first one: each
  agent reply is paired with the earliest customer message no reply has answered yet. A reply
  written when nobody is waiting — the team writing again, or an outbound conversation — answers
  nobody and adds no response time.
- A conversation is **resolved** only when an agent answered it before it was closed. A conversation
  closed without a reply is counted in **Conversations closed** but not in **Conversations
  resolved**; the difference is **Conversations closed without reply**.
- **Customers** counts the customers who wrote in or were written to in the period, and **Customers
  helped** the ones the team actually replied to — each of them once, however many conversations or
  replies they have.
- **First reply office hours**, **Response office hours** and **Closing office hours** count only
  the time within the office hours of the **Office hours** option, on the local times of the Time
  dimension time zone: a conversation created on Friday evening and answered on Monday morning waits
  only the office hours of Monday morning.
- **Happiness score** is the share of great ratings less the share of not good ratings, the way
  Help Scout scores it, so a period of only okay ratings scores zero and a bad one scores below it.

## What to build with account calculated members

Some of what a support team reports on is specific to that team, so the import gives you the
dimension members it can and you group them the way your account needs:

- **Teams** — aggregate the members of Assignee, Closed By or Agent into a `Support team` /
  `Dev team` calculated member, rather than listing agents one by one in every report.
- **Tag groups** — aggregate Tag members into the categories you use (`Urgent`, `Technical`,
  `First contact`), and read the tags of one conversation with
  `[Conversation].CurrentHierarchyMember.get('Tags')`.
- **Working days** — aggregate Monday to Friday of the Week Day dimension into a `Working days`
  calculated member, and select it to leave the events of the weekend out of every report at once.
  It filters the events by the day they happened on; to leave the nights and the weekend out of the
  first reply and the closing time themselves, select **Use office hours**.
- **Conversations still to be worked on** — filter the Conversation dimension by
  `DateDiffWorkdays([Conversation].CurrentHierarchyMember.get('Updated at'), Now())`, or by the
  **Waiting since** property.

## Custom fields

Help Scout inboxes define their own conversation custom fields, and the **Custom fields** tab of the
import options page lists them, grouped by inbox. What you can import a field as depends on its type:

| Help Scout type | Property | Dimension | Measure |
|---|---|---|---|
| Single line | text of the value | one member per distinct value | — |
| Dropdown | the option label | one member per option | — |
| Number | the number | one member per distinct value | summed over the conversations |
| Date | the date | — | — |
| Multi line | the whole text | — | — |

Everything a custom field adds is listed under the **Custom fields** group in the report editor. A
field imported as a property becomes a property of the Conversation dimension member and a
**Conversation `<field>`** measure showing the value of the conversation a report row is on.

Custom fields belong to one inbox, so a field of the same name in two inboxes is two separate
fields — the second is shown as `Priority (Sales)`. Renaming a field in Help Scout keeps its
imported data.

Every custom field dimension has a `(none)` member, so conversations without a value stay visible in
a report grouped by the field. Dropdown members keep the order of the options in Help Scout, and
numeric members are ordered by their value.

Deselecting a field removes its dimension, measures and data with the next import. Selecting a field
does not fill it with history by itself — run a full reimport for that.

## Sample reports

The first import can create a **Samples Help Scout** report folder and a **Help Scout overview**
dashboard: conversations over time, response and resolution times, conversations by inbox, the first
reply time distribution, conversations by tag, closed conversations by message count, customers
helped over time, the busiest time of day, replies by agent and happiness over time. The dashboard
filters all of them at once by time period, inbox, channel, tag and assignee. Switch this off with
the "import sample reports" option if you do not want them.

## Incremental imports

Each import continues where the previous one stopped, and re-imports the conversations that changed
since. A conversation that changed is re-imported as a whole, so its measures always match its
current state in Help Scout.

A conversation that could not be imported is reported as a warning and retried by the next import,
rather than being silently skipped.

## Performance

Help Scout lists conversations 25 per page and customers 50 per page, with no way to ask for
larger pages, and rate limits its API per account per minute (200 requests on most plans). The
conversation and the customer pages are requested by page number with several pages in flight at
once — `max_concurrent_requests` of them, 3 by default — so that the next pages arrive while the
current one is imported. A first import of a large account is still bound by what Help Scout
allows rather than by eazyBI — use the **Import history** option to keep the first import
manageable, then let the incremental imports catch up.

Advanced settings worth knowing:

| Setting | Default | When to change it |
|---|---|---|
| `max_concurrent_requests` | 3 | how many pages are requested at once; lower it to 1 when the account hits rate limit errors |
| `import_timeout_limit` | 14400 | raise it for a first import of a large account |
| `object_warning_limit` | 100 | how many failed conversations are tolerated before the import fails |
| `logger.level` | info | set to `debug` while investigating an import |
| `skip_conversations` | none | an array of conversation numbers (not ids) to leave out of the import entirely, for example `skip_conversations = [4821, 5310]` — an exceptional conversation whose data is a mistake and skews the averages, rather than a real outlier worth keeping |

Changing `skip_conversations` does not clear the incremental import state, so a conversation already
imported before it was added stays until the next full reimport.

## License

MIT — see [LICENSE](LICENSE).
