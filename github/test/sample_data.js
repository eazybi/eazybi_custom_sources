// The sample data of the GitHub sample reports: two years of the pull requests of the six repositories of
// an invented software company. Twelve developers open, review and merge them, two of them join later
// and one leaves; a dependency update bot opens small pull requests in every repository, and a review
// bot, which the team started to use eight months ago, reviews more of the pull requests every month.
// The volume grows over the two years and dips in the summer and in December, the merge times get
// shorter once the review bot is there, and a few pull requests are left open for good. Every name is
// invented.
sample.seed(23);

// Nothing happens after the start of today, so that the same sample data is generated during the day
// and no event lies in the future.
var NOW_MS = Date.parse(`${sample.today()}T00:00:00Z`);
var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;
var HISTORY_DAYS = 730;
var PULL_REQUEST_COUNT = 1500;
var PAGE_SIZE = 25;
var REVIEW_BOT_START_DAYS_AGO = 240;

var OWNER = {id: 7100, login: "copperleaf-works", type: "Organization"};

var USERS = [
  {databaseId: 41001, login: "maren-holt-cl", name: "Maren Holt"},
  {databaseId: 41002, login: "tobias-renn-cl", name: "Tobias Renn"},
  {databaseId: 41003, login: "ilona-varga-cl", name: "Ilona Varga"},
  {databaseId: 41004, login: "kofi-mensah-cl", name: "Kofi Mensah"},
  {databaseId: 41005, login: "sara-lindgren-cl", name: "Sara Lindgren"},
  // Left the team half a year ago.
  {databaseId: 41006, login: "diego-ferraz-cl", name: "Diego Ferraz", leftDaysAgo: 190},
  {databaseId: 41007, login: "anouk-dekker-cl", name: "Anouk Dekker"},
  {databaseId: 41008, login: "ravi-iyer-cl", name: "Ravi Iyer"},
  {databaseId: 41009, login: "lena-kraus-cl", name: "Lena Kraus"},
  {databaseId: 41010, login: "mateo-silva-cl", name: "Mateo Silva"},
  // Joined the team in the last year.
  {databaseId: 41011, login: "yuki-sato-cl", name: "Yuki Sato", joinedDaysAgo: 160},
  {databaseId: 41012, login: "olga-petrova-cl", name: "Olga Petrova", joinedDaysAgo: 310}
].map((user) => Object.assign(user, {__typename: "User", email: `${user.name.toLowerCase().replace(" ", ".")}@copperleaf.example`}));

var DEPENDENCY_BOT = {__typename: "Bot", databaseId: 9101, login: "dependency-updater"};
var REVIEW_BOT = {__typename: "Bot", databaseId: 9102, login: "review-pilot"};

function userByLogin(login) {
  return _.find(USERS, (user) => user.login === login);
}

// The share of the pull requests of each repository, its contributors with their share of its pull
// requests, and its milestones, if it plans its releases with them.
var REPOSITORIES = [
  {id: 7201, name: "web-app", weight: 30, firstNumber: 1840, release: {major: 4, minor: 2},
   contributors: [["maren-holt-cl", 25], ["tobias-renn-cl", 20], ["anouk-dekker-cl", 20], ["yuki-sato-cl", 15],
                  ["sara-lindgren-cl", 10], ["diego-ferraz-cl", 10]]},
  {id: 7202, name: "api-server", weight: 25, firstNumber: 2610, release: {major: 2, minor: 31},
   contributors: [["kofi-mensah-cl", 25], ["ilona-varga-cl", 25], ["ravi-iyer-cl", 20], ["mateo-silva-cl", 15],
                  ["tobias-renn-cl", 10], ["olga-petrova-cl", 5]]},
  {id: 7203, name: "mobile-app", weight: 15, firstNumber: 412, release: {major: 1, minor: 8},
   contributors: [["anouk-dekker-cl", 30], ["lena-kraus-cl", 30], ["yuki-sato-cl", 20], ["maren-holt-cl", 20]]},
  {id: 7204, name: "data-pipeline", weight: 12, firstNumber: 655,
   contributors: [["ravi-iyer-cl", 35], ["olga-petrova-cl", 35], ["ilona-varga-cl", 30]]},
  {id: 7205, name: "infrastructure", weight: 10, firstNumber: 973,
   contributors: [["mateo-silva-cl", 40], ["kofi-mensah-cl", 30], ["diego-ferraz-cl", 30]]},
  {id: 7206, name: "design-system", weight: 8, firstNumber: 287,
   contributors: [["sara-lindgren-cl", 50], ["maren-holt-cl", 30], ["anouk-dekker-cl", 20]]}
].map((repository) => Object.assign(repository, {full_name: `${OWNER.login}/${repository.name}`}));

// What a pull request of each kind is about, its label and branch prefix, its size in changed lines, and
// how many days its review takes at the median.
var KINDS = {
  feature: {weight: 38, label: "enhancement", branch: "feature", lines: [40, 900], days: 2.5, verbs: ["Add"],
            topics: ["CSV export of the report table", "dark mode toggle", "saved filters", "bulk edit of projects",
                     "webhook retries", "audit log page", "team invitations", "usage quotas", "search suggestions",
                     "notification settings", "keyboard shortcuts", "two-factor recovery codes",
                     "project templates", "API pagination links", "scheduled report emails"]},
  bug: {weight: 30, label: "bug", branch: "bugfix", lines: [4, 220], days: 1.2, verbs: ["Fix"],
        topics: ["timezone offset in the activity feed", "crash on an empty project list", "stale cache after logout",
                 "duplicate rows in the export", "broken pagination of the members list",
                 "rounding of the invoice totals", "retry loop on a failed upload", "missing translation keys",
                 "overflowing labels in the chart legend", "race condition in the job queue",
                 "slow query of the dashboard widgets", "lost focus after closing a dialog"]},
  refactoring: {weight: 13, label: "refactoring", branch: "refactor", lines: [60, 1400], days: 2.8,
                verbs: ["Refactor", "Simplify", "Extract"],
                topics: ["the session handling", "the permission checks", "the report builder",
                         "the notification service", "the form validation", "the API client"]},
  performance: {weight: 7, label: "performance", branch: "perf", lines: [20, 400], days: 2.2,
                verbs: ["Speed up", "Cache"],
                topics: ["the project overview query", "the search index", "the image thumbnails",
                         "the dashboard load"]},
  documentation: {weight: 7, label: "documentation", branch: "docs", lines: [5, 160], days: 0.8,
                  verbs: ["Document", "Update the docs of"],
                  topics: ["the deployment steps", "the API authentication", "the local setup",
                           "the release process"]},
  security: {weight: 5, label: "security", branch: "security", lines: [10, 240], days: 1.5,
             verbs: ["Harden", "Restrict"],
             topics: ["the password reset tokens", "the file upload types", "the session cookies",
                      "the admin API access"]}
};

var PACKAGES = ["chartkit", "tiny-router", "csv-weaver", "date-lattice", "form-sentry", "http-relay",
  "log-prism", "test-harbor", "style-loom", "icon-crate"];

var REVIEW_BOT_BODIES = ["Summary: the change looks consistent with the surrounding code.",
  "Summary: two suggestions about error handling below.", "Summary: one possible null dereference flagged.",
  "Summary: tests cover the new branches.", "Summary: consider extracting the repeated block."];
var CHANGES_REQUESTED_BODIES = ["Please add a test for the empty case.", "This needs a migration as well.",
  "The error is swallowed here, can we log it?", "Let's keep the old endpoint until the clients are updated."];
var COMMENT_BODIES = ["Looks good overall, a few questions inline.", "Nice cleanup!", "Left some notes."];

// More pull requests in the spring and the autumn, fewer in the summer holidays and in December.
var MONTH_FACTORS = [1.0, 1.05, 1.1, 1.05, 1.0, 0.9, 0.7, 0.75, 1.05, 1.1, 1.05, 0.75];
// When the developers open their pull requests, by hour of the day.
var HOUR_WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 3, 8, 12, 13, 11, 7, 10, 12, 12, 10, 8, 5, 3, 2, 1, 1, 0]
  .map((weight, hour) => [hour, weight]);

function iso(timeMs) {
  return new Date(timeMs).toISOString().replace(/\.\d+Z$/, "Z");
}

function daysAgoOf(timeMs) {
  return (NOW_MS - timeMs) / DAY_MS;
}

function between(fromMs, toMs) {
  return fromMs + sample.random() * (toMs - fromMs);
}

// A value between min and max whose logarithm is evenly spread, so that most values are small and a few
// are large, like the sizes and the durations of pull requests.
function logBetween(min, max) {
  return Math.exp(Math.log(min) + sample.random() * (Math.log(max) - Math.log(min)));
}

function id(prefix) {
  return `${prefix}_${sample.code(16)}`;
}

function activeContributors(repository, createdMs) {
  var daysAgo = daysAgoOf(createdMs);
  return repository.contributors.filter((contributor) => {
    var user = userByLogin(contributor[0]);
    return (!user.joinedDaysAgo || daysAgo < user.joinedDaysAgo) && (!user.leftDaysAgo || daysAgo > user.leftDaysAgo);
  });
}

// The creation time of a pull request: the volume grows by half over the two years and follows the
// months and the working week.
function createdTime() {
  for (;;) {
    let daysAgo = sample.integer(1, HISTORY_DAYS);
    let dayMs = NOW_MS - daysAgo * DAY_MS;
    let day = new Date(dayMs);
    let weekday = day.getUTCDay() === 0 || day.getUTCDay() === 6 ? 0.08 : 1;
    let growth = 0.65 + 0.35 * (1 - daysAgo / HISTORY_DAYS);
    if (sample.random() < growth * MONTH_FACTORS[day.getUTCMonth()] * weekday / 1.1) {
      return dayMs + sample.pickWeighted(HOUR_WEIGHTS) * HOUR_MS + sample.integer(0, 59) * MINUTE_MS;
    }
  }
}

// The share of the pull requests the review bot reviews: none before it arrived, then from a third to
// nearly all of them.
function reviewBotShare(createdMs) {
  var daysAgo = daysAgoOf(createdMs);
  if (daysAgo > REVIEW_BOT_START_DAYS_AGO) return 0;

  return 0.35 + 0.55 * (1 - daysAgo / REVIEW_BOT_START_DAYS_AGO);
}

function milestone(repository, createdMs) {
  if (!repository.release || !sample.chance(0.6)) return null;

  // One release a month, due at the end of the month the pull request is created in.
  var created = new Date(createdMs);
  var monthsAgo = (new Date(NOW_MS).getUTCFullYear() - created.getUTCFullYear()) * 12 +
    new Date(NOW_MS).getUTCMonth() - created.getUTCMonth();
  var minor = repository.release.minor - monthsAgo;
  var major = repository.release.major - (minor < 0 ? 1 : 0);
  var dueOn = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + 1, 0));
  return {
    number: 200 - monthsAgo,
    title: `v${major}.${minor < 0 ? minor + 24 : minor}`,
    dueOn: `${dueOn.toISOString().substring(0, 10)}T00:00:00Z`
  };
}

function mergeable(request, openDays) {
  if (request.state !== "OPEN") return "UNKNOWN";

  return sample.pickWeighted(openDays > 30
    ? [["CONFLICTING", 70], ["MERGEABLE", 30]]
    : [["MERGEABLE", 75], ["CONFLICTING", 20], ["UNKNOWN", 5]]);
}

function review(author, state, submittedMs, options) {
  var commentCount = (options && options.comments) || 0;
  return {
    id: id("PRR"),
    state: state,
    submittedAt: iso(submittedMs),
    body: (options && options.body) || "",
    author: author,
    comments: {
      totalCount: commentCount,
      nodes: commentCount > 0 ? [{replyTo: options.replyTo ? {id: options.replyTo} : null}] : []
    }
  };
}

// The reviews of the human reviewers: a review that requests changes and a later approval, or an
// approval right away, sometimes with a comment first. The author answers a requested change in its
// review thread, which GitHub reports among the reviews as well. A pull request which nobody finished
// waits for its first review or for the changes its reviewer requested.
function humanReviews(pullRequest, reviewers, createdMs, endMs, stale) {
  var reviews = [];
  var span = endMs - createdMs;

  reviewers.forEach((reviewer, index) => {
    let firstReviewer = index === 0;
    if (!firstReviewer && sample.chance(0.35)) return;

    if (stale) {
      if (firstReviewer && sample.chance(0.5)) {
        reviews.push(review(reviewer, "CHANGES_REQUESTED", createdMs + sample.integer(2, 48) * HOUR_MS,
          {body: sample.pick(CHANGES_REQUESTED_BODIES), comments: sample.integer(1, 5)}));
      }
      return;
    }

    if (firstReviewer && sample.chance(0.3)) {
      let requestedMs = createdMs + span * between(0.15, 0.45);
      reviews.push(review(reviewer, "CHANGES_REQUESTED", requestedMs,
        {body: sample.pick(CHANGES_REQUESTED_BODIES), comments: sample.integer(1, 5)}));
      if (pullRequest.author.__typename === "User" && sample.chance(0.5)) {
        let replyMs = requestedMs + span * between(0.02, 0.1);
        reviews.push(review(pullRequest.author, "COMMENTED", replyMs, {comments: 1, replyTo: id("PRRC")}));
      }
    } else if (sample.chance(0.25)) {
      reviews.push(review(reviewer, "COMMENTED", createdMs + span * between(0.1, 0.4),
        {body: sample.pick(COMMENT_BODIES), comments: sample.integer(1, 3)}));
    }

    // A bare approval most of the time — no body and no comment.
    reviews.push(review(reviewer, "APPROVED", createdMs + span * between(0.55, 0.97),
      sample.chance(0.3) ? {body: "LGTM", comments: 0} : {}));
  });

  return reviews;
}

function reviewBotReview(createdMs) {
  return review(REVIEW_BOT, "COMMENTED", createdMs + sample.integer(3, 25) * MINUTE_MS,
    {body: sample.pick(REVIEW_BOT_BODIES), comments: sample.pickWeighted([[0, 20], [1, 30], [2, 25], [3, 15], [5, 10]])});
}

function conversationComments(participants, createdMs, endMs) {
  return sample.times(sample.pickWeighted([[0, 35], [1, 30], [2, 20], [3, 10], [5, 5]]), () => ({
    id: id("IC"),
    createdAt: iso(between(createdMs, endMs)),
    author: sample.pick(participants)
  }));
}

// The commits of a pull request share its line changes. The first one is authored before the pull request
// is opened, the others while it is reviewed.
function commits(commitAuthor, createdMs, endMs, additions, deletions) {
  var count = Math.max(1, Math.min(9, Math.round(logBetween(1, 2 + (additions + deletions) / 120))));
  var additionsLeft = additions;
  var deletionsLeft = deletions;

  return sample.times(count, (index) => {
    let last = index === count - 1;
    let commitAdditions = last ? additionsLeft : Math.round(additionsLeft * between(0.2, 0.7));
    let commitDeletions = last ? deletionsLeft : Math.round(deletionsLeft * between(0.2, 0.7));
    additionsLeft -= commitAdditions;
    deletionsLeft -= commitDeletions;
    let authoredMs = index === 0
      ? createdMs - sample.integer(10, 600) * MINUTE_MS
      : between(createdMs, endMs - MINUTE_MS);
    return {
      id: id("PURC"),
      commit: {
        oid: (sample.uuid() + sample.uuid()).replace(/-/g, "").substring(0, 40),
        additions: commitAdditions,
        deletions: commitDeletions,
        authoredDate: iso(authoredMs),
        // A bot commit is authored with an email that belongs to no user account.
        author: {user: commitAuthor}
      }
    };
  });
}

function stateEvent(typename, actor, timeMs) {
  return {__typename: typename, createdAt: iso(timeMs), actor: actor};
}

// The outcome, the size and the review time of the pull request of a developer or of the dependency bot.
function profile(repository, createdMs) {
  if (sample.chance(0.1)) {
    var packageName = sample.pick(PACKAGES);
    var minor = sample.integer(1, 20);
    var patch = sample.integer(0, 9);
    var lines = sample.integer(2, 40);
    return {
      author: DEPENDENCY_BOT,
      reviewers: [userByLogin(sample.pickWeighted(activeContributors(repository, createdMs)))],
      title: `Bump ${packageName} from 3.${minor}.${patch} to 3.${minor}.${patch + 1}`,
      branch: `dependencies/${packageName}-3.${minor}.${patch + 1}`,
      label: "dependencies",
      additions: lines,
      deletions: lines,
      days: logBetween(0.1, 4),
      outcome: sample.pickWeighted([["merged", 80], ["closed", 18], ["stale", 2]])
    };
  }

  var contributors = activeContributors(repository, createdMs);
  var author = userByLogin(sample.pickWeighted(contributors));
  var others = contributors.filter((contributor) => contributor[0] !== author.login);
  var firstReviewer = userByLogin(sample.pickWeighted(others));
  var reviewers = [firstReviewer];
  var secondReviewers = others.filter((contributor) => contributor[0] !== firstReviewer.login);
  if (secondReviewers.length > 0 && sample.chance(0.45)) {
    reviewers.push(userByLogin(sample.pickWeighted(secondReviewers)));
  }

  var kindName = sample.pickWeighted(Object.keys(KINDS).map((name) => [name, KINDS[name].weight]));
  var kind = KINDS[kindName];
  var changedLines = Math.round(logBetween(kind.lines[0], kind.lines[1]));
  var additions = Math.round(changedLines * between(0.45, 0.9));
  var topic = sample.pick(kind.topics);
  // The review bot catches the simple problems before a human reviewer looks at the change.
  var speedUp = reviewBotShare(createdMs) > 0 ? 0.7 : 1;

  return {
    author: author,
    reviewers: reviewers,
    title: `${sample.pick(kind.verbs)} ${topic}`,
    branch: `${kind.branch}/${topic.replace(/^the /, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: sample.chance(0.85) ? kind.label : null,
    additions: additions,
    deletions: changedLines - additions,
    days: kind.days * speedUp * logBetween(0.08, 8) * (0.7 + changedLines / 1000),
    outcome: sample.pickWeighted([["merged", 85], ["closed", 13.5], ["stale", 1.5]])
  };
}

function pullRequest(repository, createdMs, index) {
  var plan = profile(repository, createdMs);
  var closesMs = createdMs + plan.days * DAY_MS;
  // A pull request which would be closed after today is still open, and so is one nobody finished.
  var open = plan.outcome === "stale" || closesMs >= NOW_MS;
  // A pull request opened in the last hours of yesterday ends after its self-assignment as well.
  var endMs = open ? Math.max(NOW_MS - sample.integer(1, 120) * MINUTE_MS, createdMs + 2 * MINUTE_MS) : closesMs;
  // The reviews of a pull request which is still open stop at today.
  var reviewEndMs = open ? closesMs : endMs;
  var openDays = daysAgoOf(createdMs);
  var author = plan.author;
  var humanAuthor = author.__typename === "User";
  var request = {
    fullDatabaseId: String(1900000000 + index),
    createdAt: iso(createdMs),
    closedAt: open ? null : iso(closesMs),
    state: open ? "OPEN" : plan.outcome === "merged" ? "MERGED" : "CLOSED",
    isDraft: open && humanAuthor && sample.chance(openDays > 30 ? 0.3 : 0.2),
    title: plan.title,
    headRefName: plan.branch,
    changedFiles: Math.max(1, Math.round((plan.additions + plan.deletions) / sample.integer(15, 60))),
    additions: plan.additions,
    deletions: plan.deletions,
    author: author,
    milestone: humanAuthor ? milestone(repository, createdMs) : null,
    labels: {nodes: plan.label ? [{id: `LA_${plan.label}`, name: plan.label}] : []}
  };
  request.mergeable = mergeable(request, openDays);
  request.mergeCommit = request.state === "MERGED"
    ? {oid: (sample.uuid() + sample.uuid()).replace(/-/g, "").substring(0, 40)} : null;

  var reviews = humanReviews(request, plan.reviewers, createdMs, reviewEndMs, plan.outcome === "stale");
  if (sample.chance(reviewBotShare(createdMs) * (humanAuthor ? 1 : 0.5))) reviews.push(reviewBotReview(createdMs));
  reviews = _.sortBy(reviews.filter((node) => Date.parse(node.submittedAt) < endMs), (node) => node.submittedAt);
  var reviewed = reviews.map((node) => node.author.login);
  // A review request is answered by the review, so only the reviewers who have not reviewed are left.
  var reviewRequests = plan.reviewers.filter((reviewer) => reviewed.indexOf(reviewer.login) < 0).
    map((reviewer) => ({requestedReviewer: reviewer}));

  var comments = conversationComments([author].concat(plan.reviewers), createdMs, endMs);
  var commitNodes = commits(humanAuthor ? author : null, createdMs, endMs, plan.additions, plan.deletions);

  var timelineItems = [];
  var selfAssigned = humanAuthor && sample.chance(0.6);
  if (selfAssigned) {
    timelineItems.push(Object.assign(stateEvent("AssignedEvent", author, createdMs + MINUTE_MS),
      {assignee: {login: author.login}}));
  }
  if (request.state === "MERGED") {
    var merger = humanAuthor ? author : plan.reviewers[0];
    timelineItems.push(stateEvent("MergedEvent", merger, closesMs));
    timelineItems.push(stateEvent("ClosedEvent", merger, closesMs));
  } else if (request.state === "CLOSED") {
    timelineItems.push(stateEvent("ClosedEvent", humanAuthor ? author : plan.reviewers[0], closesMs));
  }

  var eventTimes = [createdMs].concat(reviews.map((node) => Date.parse(node.submittedAt))).
    concat(comments.map((node) => Date.parse(node.createdAt))).
    concat(commitNodes.map((node) => Date.parse(node.commit.authoredDate))).
    concat(timelineItems.map((node) => Date.parse(node.createdAt)));

  return Object.assign(request, {
    updatedAt: iso(Math.min(_.max(eventTimes), NOW_MS - MINUTE_MS)),
    assignees: {nodes: selfAssigned ? [author] : []},
    reviewRequests: {nodes: reviewRequests},
    reviews: {totalCount: reviews.length, nodes: reviews},
    comments: {totalCount: comments.length, nodes: _.sortBy(comments, (node) => node.createdAt)},
    commits: {totalCount: commitNodes.length, nodes: commitNodes},
    timelineItems: {filteredCount: timelineItems.length, nodes: timelineItems}
  });
}

var pullRequests = sample.times(PULL_REQUEST_COUNT, () => ({
  repository: sample.pickWeighted(REPOSITORIES.map((repository) => [repository, repository.weight])),
  createdMs: createdTime()
}));
pullRequests = _.sortBy(pullRequests, (item) => item.createdMs).
  map((item, index) => ({repository: item.repository, node: pullRequest(item.repository, item.createdMs, index)}));

mock.sourceParams({api_token: "sample"});
mock.sourceSelection(REPOSITORIES.map((repository) => ({key: String(repository.id), name: repository.full_name})));
mock.extraOptions({import_commits: true, import_changes: true});

mock.get("/user/repos", REPOSITORIES.map((repository) => ({
  id: repository.id, name: repository.name, full_name: repository.full_name, owner: OWNER
})));

var counts = {};
REPOSITORIES.forEach((repository, repositoryIndex) => {
  // The numbers of a repository count up with its creation, with a gap where an issue took the number.
  var number = repository.firstNumber;
  var nodes = pullRequests.filter((item) => item.repository === repository).map((item) => {
    number += sample.pickWeighted([[1, 70], [2, 20], [3, 10]]);
    return Object.assign(item.node, {number: number});
  });
  counts[`repository${repositoryIndex}`] = {pullRequests: {totalCount: nodes.length}};

  // Newest updated first, as the PullRequests query orders them.
  var pages = sample.pages(_.sortBy(nodes, (node) => node.updatedAt).reverse(), PAGE_SIZE);
  pages.forEach((page, pageIndex) => {
    let variables = {owner: OWNER.login, name: repository.name};
    if (pageIndex > 0) variables.after = `${repository.name}-${pageIndex}`;
    let hasNextPage = pageIndex < pages.length - 1;
    mock.graphql({query: "PullRequests", variables: variables, json: {data: {repository: {pullRequests: {
      nodes: page,
      pageInfo: {hasNextPage: hasNextPage, endCursor: hasNextPage ? `${repository.name}-${pageIndex + 1}` : null}
    }}}}});
  });
});

// The import weighs its progress by the pull request count of every repository.
mock.graphql({query: "GithubPullRequestCounts", json: {data: counts}});
