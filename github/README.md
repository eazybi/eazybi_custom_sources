# GitHub for eazyBI

Imports [GitHub](https://github.com/) pull requests into eazyBI as a cube named **GitHub**, so that you
can report on pull request volume and closing time, review load and review depth, code changes, and how
long pull requests wait in each state. The installed source application type is `custom_github`.

## Connecting

1. Create a personal access token at <https://github.com/settings/tokens>:
   - a **classic** token needs the `repo`, `read:org` and `read:user` scopes;
   - a **fine grained** token needs read access to Metadata, Contents, Pull requests, Issues and Email
     addresses of the repositories to import.
2. Paste it into the **API token** field of the eazyBI connection form.
3. Select the repositories to import — individually, by owner, or all of them. An owner selection
   includes the repositories added to that owner later.

A token missing a scope fails every import rather than importing less — GitHub rejects the whole query,
not just the fields the scope protects. The connection test asks for the same account fields as the
import, so a token that may not read account names and email addresses is reported on the connection
form; the repository and organization scopes are checked only by the first import.

The connection test also returns the account the token belongs to, which the source selection column of
the Source Data tab shows as `User: <name> (<login>)` — or as the bare login for an account with no
display name. The token itself is a secret and is never readable, so that line is what tells you which
account the imports read with.

The API URL is fixed to `https://api.github.com`, so GitHub Enterprise Server is not supported without a
change to the manifest.

## Import options

| Option | Default | Effect |
|---|---|---|
| Import pull request commits | off | one row per commit of a pull request with its author and line changes. Without it only the commit count of a closed pull request is imported |
| Import pull request state transitions | off | the open, changes requested, approved, merged and closed transitions of every pull request, which the historical measures are calculated from. It reads the timeline of every pull request, which makes the import noticeably slower |

Changing either of them makes the next import re-import everything, so that the data matches the new
selection.

## What is imported

| GitHub object | Becomes |
|---|---|
| Repositories | the Repository dimension |
| Pull requests | the Pull Request dimension and the pull request measures |
| Labels and milestones | the Label and Milestone dimensions |
| Accounts — authors, assignees, reviewers, comment authors | the six account dimensions |
| Conversation comments and submitted reviews | the comment and review measures, with the Comment Author and Review State dimensions |
| Commits (option) | the commit measures and the Commit Author dimension |
| Timeline events (option) | the state transition measures and the Transition Author dimension |

## Dimensions

**Repository**, **Pull Request**, **Pull Request State**, **Merge State**, **Review State**,
**Pull Request Author**, **Pull Request Assignee**, **Pull Request Reviewer**, **Comment Author**,
**Commit Author**, **Transition Author**, **Label**, **Milestone** and **Time**.

- **Repository** has an **Owner** level above the repository, so an organization can be reported on as a
  whole. The **Pull Request** dimension carries the same grouping as a second hierarchy,
  Owner → Repository → Pull Request, for drilling from an owner straight into the pull requests.
- **Pull Request** members are named by number and title (`#12 Fix the importer`) and carry **Created
  at**, **Closed at**, **State**, **Draft**, **Branch Name**, **Milestone**, **Merge state** and the
  repository as properties. The member name links to the pull request on GitHub.
- **Pull Request Assignee**, **Pull Request Reviewer** and **Label** are multi value dimensions — a pull
  request counts under each of its assignees, reviewers and labels. Each has a member for the pull requests
  without a value: `(no assignee)`, `(no reviewer)`, `(none)`.
- **Pull Request Reviewer** holds both the accounts that submitted a review and the ones a review was
  only requested from, so a review still waiting is visible as review load. Requested reviewer teams are
  members too, named by their team path. The author of the pull request is never one of its reviewers,
  and neither is somebody who only replied in one of its review threads.
- The six account dimensions — author, assignee, reviewer, comment author, commit author, transition
  author — share one shape but each holds only the accounts seen in that role, so an account present in
  one of them is not necessarily a member of the others. Each has a **By type** hierarchy that
  groups the accounts by their GitHub account type (`User`, `Bot`, `Mannequin`, `Organization`).
  The **Email** property is filled for user and mannequin accounts; a bot has no email address on GitHub,
  and the public email of an organization is not imported.
- **Commit Author** and **Transition Author** dimensions exist whether or not their import option is on, and stay
  empty while it is off. Every commit is imported; GitHub itself matches the email a commit was authored
  with against the emails linked to its accounts, and a commit GitHub returns no account for counts
  under `(no author)`.
- **Review State** is the verdict of a submitted review — approved, changes requested, commented — with
  a `(no state)` member carrying the comments that belong to no review: the conversation comments of the
  pull request, and the replies written in its review threads.
- **Merge State** is what GitHub reports about mergeability (`Mergeable`, `Conflicting`), with a
  `(none)` member for the pull requests it reports no mergeable state for — the ones it is still
  computing one for, and the ones it no longer computes one for, which is most of the merged ones. A
  closed pull request that was not merged keeps the state GitHub computed for it last.
- **Milestone** members carry the milestone **Number**, its **Repository** and its **Due date**. Two
  repositories using the same milestone title stay separate members, each named with its repository:
  `2026Q2 (acme/app)` and `2026Q2 (acme/tools)`.

## Measures

| Measure | Counted at |
|---|---|
| Pull requests created | the day the pull request was created |
| Pull requests closed | the day it was closed |
| Merged pull requests | when it was closed, if it was merged |
| Total closing days, Average closing days | when it was closed; the average is over the pull requests closed in the period |
| Average merge days, Merge rate | when it was closed; the average is over the pull requests merged in the period, and the rate is the merged share of the closed ones |
| Closed pull request commit count | when it was closed, as the total commit count of the pull request |
| Changed files count, Additions, Deletions, Changes | when it was closed, and for a pull request still open when it was created |
| Pull requests with milestone due date | the due date of its milestone |
| Comments submitted | the day a conversation comment was written, and for the comments of a review the day that review was submitted |
| Reviews submitted, Comments per review | the day each review was submitted |
| Commits submitted, Lines added, Lines removed, Net lines (option) | the day each commit was authored |
| Transitions to state, Transitions from state (option) | the day the pull request entered and left the state |
| Days in transition state, Average days in transition state (option) | when it left the state |
| Transitions to author, Transitions from author (option) | when the pull request was assigned to its own author and unassigned again |

**Open pull requests** is a running total — how many stood open at the end of each period — rather than
something counted on a day. **Pull requests history** (transitions option) is the same running total per state.

Every event is counted in the Time period it happened in and not in the period the pull request was
created, so a pull request created in January and merged in February adds to **Pull requests created** in
January and to **Pull requests closed** in February.

A review counts as a review whether or not it carries a comment, so a bare approval is counted too. A
review that was later dismissed still counts: the pull request enters the state that review set and
leaves it again at the dismissal, which withdraws the verdict and leaves the pull request waiting for a
review.

A reply written in a review thread does **not** count as a review, although GitHub sends it as one.
GitHub has no object for a single inline comment: a comment written outside the review form arrives
among the reviews of the pull request, as a review of its own with no body, no verdict and the one
comment it carries. Counting those as reviews adds the author of a reply as a reviewer — most often
the author of the pull request, answering the review it received. So a submission with no body whose
only comment is a reply is imported as just that comment, under `(no state)`; every other submission
counts as a review. **Comments submitted** counts the reply either way, while **Reviews submitted**,
**Comments per review** and **Reviewed pull requests count** leave it out.

The **Distinct pull requests count** group answers "how many pull requests", where the plain measures
count events — **Reviewed pull requests count**, for instance, is how many pull requests an account
reviewed.
The **Pull Request properties** group holds one measure per property (**Pull request state**, **Pull request branch**,
**Open pull request age days** and so on) for a report with pull requests on its rows.

## Sample reports

Every import creates three report folders and two dashboards, unless the account switches the "import
sample reports" option off. The folders are named after the part of GitHub they analyze.

**Samples Pull requests** — *Pull requests overview*, *Pull requests created and closed over time*,
*Pull requests by repository*, *Pull requests by author*, *Review load by reviewer* and *Open pull
requests by age*, with a **Samples Pull requests** dashboard. These need no import option, except that
the commit series of *Pull requests by author* and the *Code changes over time* tile of the dashboard
stay empty until the commits option is on.

**Samples Pull request history** — *Pull requests cumulative flow* and *Time in active pull request
states* need the state transitions option, and *Code changes over time* needs the commits option. The
folder is created for every account, and each report names the option it needs in its description.

**Samples AI and automation** — *Review activity by account type*, *Reviewed pull requests by account
type* and *Pull request outcomes by author type*, with a dashboard of their own. They read the same pull
requests by the GitHub account type of the accounts involved, and need no import option.
The account type comes from GitHub: `Bot` means an account of its own — a code review app, a dependency bot,
a CI account. Work done with an AI assistant and committed under a user account is **not** distinguishable,
because a commit carries only its author, which is always a user account. Read them as what the bot accounts
of a repository do, above all in code review, and not as the share of the code an AI wrote.

## Imports after the first one

Each import reads the pull requests that changed since the previous one and re-imports each of them as a
whole, so their measures always match their current state on GitHub. The mark is taken before anything is
fetched, so a pull request updated while an import runs is read by the next one.

The mark is kept per repository and moves only when that repository finished. A repository that fails is
read again at the end of the same import, and only if it fails a second time is it reported as a failed
object and left for the next import — which then starts it from where it stopped, while the other
repositories continue from theirs.

A repository you deselect has its rows and its mark deleted with the next import, so selecting it again
imports it from scratch. A repository GitHub stops answering for at all — a permission change, an
archived repository, an outage — keeps its rows, because those three cannot be told apart.

A reimport reads every pull request again and clears the stored rows of a repository before it reads it,
one repository at a time, so a repository that fails during a reimport loses no more than its own rows.

## Limitations

- **The review state is the state of the last review, not GitHub's review decision.** Every approval and
  changes requested review moves the pull request into its own state, and a dismissal returns it to open
  while the pull request is still in the state the dismissed review set. GitHub instead derives one
  decision per pull request from the reviews of all its reviewers that still stand, so the two differ
  when reviewers disagree: dismissing a changes requested review that followed somebody else's approval
  leaves this history open, while GitHub reports the pull request as approved because that approval
  stands.
- **Calendar days, not workdays.** *Days in transition state* and *Average days in transition state*
  count calendar days; the non working days settings of the Time dimension do not change them.
- **The transition dates are calculated in UTC.** *Transition to state first date* and its three sibling
  measures read a timestamp stored in UTC, while the transition is counted in the Time dimension time
  zone — a transition late in the day can show a date one day off from the Time member it is counted in.
- **A label named `(none)` is counted as no label.** Labels are shared across repositories by name, and
  the pull requests without a label are the `(none)` member of the same level — a repository that names
  a label `(none)` adds its pull requests to that member instead of getting one of its own.
- **A renamed repository stays in the name of a duplicate milestone title** until a pull request of that
  milestone is imported again; the Repository property of the member is corrected right away.
- **An owner whose last repository was deselected stays** in the Repository dimension; only the
  repository itself and its data are deleted.
- **Commit Author and Transition Author apply to the whole cube.** There are no per measure group
  dimension options, so both are offered with the pull request and comment measures too.
- **The import is sequential.** The repositories are read one at a time and the pages of a repository
  one after another.
- **About a thousand repositories fit the stored repository list** that deselection cleanup reads. Past
  that the import logs an error, and the rows of a deselected repository that GitHub no longer returns
  stay in the account.

## Advanced settings

| Setting | Default | When to change it |
|---|---|---|
| `api_timeout_in_seconds` | 120 | raise it when GitHub is slow to answer a page of a large repository |
| `max_concurrent_requests` | 3 | how many pages are requested at once when a truncated connection is read again; the pull request pages themselves are always read one after another |
| `object_warning_limit` | 100 | how many failed repositories are tolerated before the import fails |
| `import_timeout_limit` | 14400 | raise it for a first import of many repositories |
| `max_wait_seconds` | 3600 | bounds one wait for a GitHub rate limit to reset |

A full page of 25 pull requests with all of its connections costs about 2 points of the 5000 points an
hour GitHub allows, so an import reaches the limit together with whatever else uses the same token.

## License

MIT — see [LICENSE](LICENSE).
