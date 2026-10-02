// Every pull request is its own import scope in every measures table, so an incremental import rewrites
// only the pull requests it read.

// The GitHub ids of the repositories that the previous import imported, so that the rows of a repository
// which is no longer selected can be deleted. Stored in numbered max params because one value holds 1000
// characters, and there is no other way to read back which repositories the account contains. The GitHub
// id and not the Repository dimension id, because the incremental mark of a deselected repository is
// keyed by it and has to be cleared together with its rows.
var IMPORTED_REPOSITORIES_MAX_PARAM = "imported_repositories";
var IMPORTED_REPOSITORIES_CHUNKS = 10;
var MAX_PARAM_VALUE_LENGTH = 1000;
var ALL_REPOSITORIES_KEY = "all";
var OWNER_KEY_PREFIX = "owner/";

// The progress weight of a repository which keeps its incremental mark — not its whole history, and not
// nothing either. Never a limit of what is imported.
var MARKED_REPOSITORY_WEIGHT = 25;
// Pull requests of one repository between two progress lines, so that a repository which takes an hour
// says so in the import log too.
var PULL_REQUESTS_PER_PROGRESS_LOG = 500;

app.importer = {
  importAll() {
    source.setStatusMessage("Importing GitHub repositories");
    // Captured before anything is fetched, so that the next incremental import does not miss a pull
    // request that was updated while this import was running. Truncated to the whole second, because
    // GitHub answers updatedAt at second precision — a pull request updated in this same second would
    // round below a mark that keeps its milliseconds and would never be read again.
    var importStartedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    var importOptions = {
      importCommits: source.getExtraOption("import_commits") === true,
      importChanges: source.getExtraOption("import_changes") === true
    };

    app.api.resetPullRequestsPageSizes();

    var fetchedRepositories = app.api.getRepositories();
    var selectedRepositories = this.selectedRepositories(fetchedRepositories);
    if (selectedRepositories.length === 0) {
      throw new Error("No GitHub repositories selected for import." +
        " Check the permissions of the user whose API token authorized the import.");
    }

    logger.startImport("repositories");
    var importedRepositories = selectedRepositories.
      map((repository) => app.importers.repositories.importMember(repository));
    logger.finishImport("repositories", importedRepositories.length);

    this.deleteDeselectedRepositories(fetchedRepositories, importedRepositories);

    var shared = {importStartedAt: importStartedAt, importOptions: importOptions};
    var failedRepositories = [];
    this.progress.prepare(importedRepositories);
    importedRepositories.forEach((repository) => {
      this.progress.repositoryStarted(repository);
      if (!app.importers.repositories.importOne(repository, shared)) failedRepositories.push(repository);
      this.progress.repositoryFinished(repository);
    });
    this.retryFailedRepositories(failedRepositories, importedRepositories, shared);

    app.importers.users.updateDuplicateDisplayNames(importOptions);
    app.importers.pullRequests.updateDuplicateMilestoneNames();
    this.storeImportedExternalIds(importedRepositories);
  },

  // What failed a repository — an outage, a throttled connection, a page too heavy — is usually over by
  // the end of the import, and its pull requests are missing until an import reads them. Only what is
  // still missing after this second attempt is reported. The import itself is not failed: eazyBI stores
  // the incremental marks only after an import finished, so failing here would throw away the marks of
  // every repository that did import.
  retryFailedRepositories(failedRepositories, importedRepositories, shared) {
    if (failedRepositories.length === 0) return;

    var missingSlugs = [];
    failedRepositories.forEach((repository) => {
      this.progress.repositoryStarted(repository, {readAgain: true});
      logger.info(`retryFailedRepositories reading the repository ${repository.slug} again`);
      if (!app.importers.repositories.importOne(repository, shared, {reportFailure: true})) {
        missingSlugs.push(repository.slug);
      }
      this.progress.repositoryFinished(repository);
    });
    if (missingSlugs.length === 0) return;

    // The line that says the account is missing data it is supposed to have.
    logger.error(`importAll ${missingSlugs.length} of ${importedRepositories.length} selected` +
      ` repositories were not imported: ${missingSlugs.join(', ')}.` +
      " Their pull requests are missing and their incremental marks were not advanced, so a new import" +
      " reads exactly these repositories again while the others continue where they stopped.");
  },

  // The progress is counted in pull requests and not in repositories: one repository can hold more pull
  // requests than every other one together, and counting repositories then reports the same percentage
  // for the hour it takes to read that one.
  progress: {
    // The counts are worth a request only for the repositories that are read whole: one that keeps its
    // incremental mark reads what changed since it, which is a page or nothing.
    prepare(repositories) {
      this.done = 0;
      this.current = null;
      var wholeSlugs = repositories.filter((repository) => this.readsWholeRepository(repository)).
        map((repository) => repository.slug);
      this.counts = wholeSlugs.length > 0 ? app.api.getPullRequestCounts(wholeSlugs) : {};

      this.weights = {};
      repositories.forEach((repository) => {
        var count = this.counts[repository.slug];
        // A repository with no pull requests still weighs one, or an account whose repositories are all
        // empty would weigh nothing and stand at 0% after the last one.
        this.weights[repository.slug] = count === undefined ? MARKED_REPOSITORY_WEIGHT : count || 1;
      });
      this.total = repositories.
        reduce((total, repository) => total + this.weights[repository.slug], 0);
    },

    readsWholeRepository(repository) {
      if (source.isReimport()) return true;

      return !source.getMaxParam(app.importers.repositories.incrementalMarkKey(repository.externalId));
    },

    // A repository read again gives its weight back first, so that reading it moves the percentage a
    // second time instead of standing at what the first attempt already counted.
    repositoryStarted(repository, options) {
      if (options && options.readAgain) this.done -= this.weights[repository.slug] || 0;

      this.current = {
        slug: repository.slug,
        count: this.counts[repository.slug],
        weight: this.weights[repository.slug] || 0,
        readCount: 0,
        loggedCount: 0,
        readAgain: Boolean(options && options.readAgain)
      };
      this.report();
    },

    pullRequestsRead(readCount) {
      if (!this.current) return;

      this.current.readCount += readCount;
      this.report();
      if (this.current.readCount - this.current.loggedCount < PULL_REQUESTS_PER_PROGRESS_LOG) return;

      this.current.loggedCount = this.current.readCount;
      logger.info(`progress read ${this.current.readCount} pull requests of ${this.current.slug}`);
    },

    // The whole weight is credited when the import is done with the repository, however much it turned
    // out to read. Reported once more while the repository is still the one named, so that the percentage
    // stands at 100% after the last one.
    repositoryFinished(repository) {
      this.done += this.weights[repository.slug] || 0;
      // Its weight is counted in done now, so the pull requests it read must not be counted again.
      if (this.current) this.current.weight = 0;
      this.report();
      this.current = null;
    },

    report() {
      if (!this.current) return;

      source.setStatusMessage(this.message(), {percentage: this.percentage()});
    },

    percentage() {
      if (!(this.total > 0)) return 0;

      // A repository with more pull requests than its count said must not push past its weight.
      var read = this.current ? Math.min(this.current.readCount, this.current.weight) : 0;
      return (this.done + read) * 100 / this.total;
    },

    // The count of the repository is named only when it is a count and not a weight, so that the message
    // does not promise 5395 pull requests to an incremental import which is about to read four.
    message() {
      var message = `Importing the pull requests of ${this.current.slug}`;
      if (this.current.readAgain) message += ' again';
      if (this.current.readCount === 0) return message;

      return this.current.count === undefined
        ? `${message} (${this.current.readCount} read)`
        : `${message} (${this.current.readCount} of ${this.current.count})`;
    }
  },

  // Nothing selected imports everything the token user can read.
  selectedRepositories(repositories) {
    var selectedKeys = source.getSourceSelection();
    if (selectedKeys.length === 0 || selectedKeys.indexOf(ALL_REPOSITORIES_KEY) >= 0) return repositories;

    var selected = {};
    selectedKeys.forEach((selectedKey) => { selected[selectedKey] = true; });

    return repositories.filter((repository) =>
      selected[String(repository.id)] === true ||
      (repository.owner ? selected[OWNER_KEY_PREFIX + repository.owner.id] === true : false));
  },

  // Deleted from two kinds of evidence, because neither covers the other: GitHub returned the repository
  // and the selection does not name it — the one kind that survives eazyBI wiping every max param when a
  // source is added to the selection (base_application.rb:899), which empties the stored list exactly
  // when a repository was deselected — or the stored list names a repository GitHub did not return at all
  // (see deselectedAbsentRepository). Both are checked on every import, so that a selection change which
  // cleaned up nothing heals itself.
  deleteDeselectedRepositories(fetchedRepositories, importedRepositories) {
    var importedExternalIds = {};
    importedRepositories.forEach((repository) => { importedExternalIds[repository.externalId] = true; });
    var fetchedExternalIds = {};
    fetchedRepositories.forEach((repository) => { fetchedExternalIds[repository.id] = true; });

    var deselectedExternalIds = fetchedRepositories.map((repository) => repository.id).
      filter((externalId) => importedExternalIds[externalId] !== true);

    this.previouslyImportedExternalIds().forEach((externalId) => {
      if (importedExternalIds[externalId] === true) return;
      // The evidence above already decided every repository of the fetched list.
      if (fetchedExternalIds[externalId] === true) return;
      if (!this.deselectedAbsentRepository(externalId)) return;

      deselectedExternalIds.push(externalId);
    });

    deselectedExternalIds.forEach((externalId) => this.deleteRepositoryData(externalId));
  },

  // The selection alone cannot decide a repository the fetched list does not contain — an owner key is
  // matched on the owner, which only the repository itself carries — so the repository is asked for on
  // its own. One GitHub does not answer for is kept: a permission change, an archived repository and an
  // outage are indistinguishable there, and deleting on that loses data the account still wants.
  deselectedAbsentRepository(externalId) {
    var repository;
    try {
      repository = app.api.getRepository(externalId);
    } catch (error) {
      // A failed read answers nothing about the selection either; a canceled import raises the same way
      // and still has to stop.
      source.checkCanceling();
      logger.warn(`deselectedAbsentRepository GitHub did not answer for the repository ${externalId},` +
        ` its data is kept: ${error.message}`);
      return false;
    }
    if (!repository) return false;

    return this.selectedRepositories([repository]).length === 0;
  },

  // No import scope of this import writes the rows of this repository, so they are deleted by its
  // repository foreign key in the fact tables and in the Pull Request dimension.
  deleteRepositoryData(externalId) {
    // The mark goes even when there is nothing left to delete, or selecting the repository again would
    // stop at it and import nothing. Read first, so that a repository which never had one is not given an
    // empty mark — every repository the token can read passes through here.
    if (source.getMaxParam(app.importers.repositories.incrementalMarkKey(externalId))) {
      app.importers.repositories.clearIncrementalMark(externalId);
    }

    var repositoryId = dwh.dimensions.repositories.lookupId({external_id: externalId});
    if (!repositoryId) return;

    logger.info(`deleteRepositoryData deleting the data of the repository ${externalId}`);
    var sourceNames = app.importers.helpers.MEASURES_SOURCE_NAMES;
    Object.keys(sourceNames).forEach((tableName) => dwh.measures[tableName].
      deleteRows({repository_id: repositoryId, _source_name: sourceNames[tableName]}));
    dwh.dimensions.pull_requests.deleteRows({repository_id: repositoryId});
    dwh.dimensions.repositories.deleteRows({id: repositoryId});
  },

  previouslyImportedExternalIds() {
    var externalIds = [];
    for (let index = 0; index < IMPORTED_REPOSITORIES_CHUNKS; index++) {
      let chunk = source.getMaxParam(`${IMPORTED_REPOSITORIES_MAX_PARAM}.${index}`);
      if (chunk) String(chunk).split(",").forEach((externalId) => externalIds.push(Number(externalId)));
    }
    return externalIds;
  },

  storeImportedExternalIds(importedRepositories) {
    var externalIds = importedRepositories.map((repository) => String(repository.externalId));
    // A repository whose data was not deleted still has rows in the account, so it stays on the list even
    // when this import did not read it — dropping it would leave its rows behind for good when it is
    // deselected later. deleteRepositoryData removed the ones that are gone.
    this.previouslyImportedExternalIds().
      filter((externalId) => externalIds.indexOf(String(externalId)) < 0).
      filter((externalId) => dwh.dimensions.repositories.lookupId({external_id: externalId})).
      forEach((externalId) => externalIds.push(String(externalId)));

    var chunks = this.externalIdChunks(externalIds);
    if (chunks.length > IMPORTED_REPOSITORIES_CHUNKS) {
      logger.error(`storeImportedExternalIds ${importedRepositories.length} repositories do not fit into` +
        ` ${IMPORTED_REPOSITORIES_CHUNKS} max params — the rows of a deselected repository will stay`);
      chunks = [];
    }

    for (let index = 0; index < IMPORTED_REPOSITORIES_CHUNKS; index++) {
      source.setMaxParam(`${IMPORTED_REPOSITORIES_MAX_PARAM}.${index}`, chunks[index] || "");
    }
  },

  externalIdChunks(externalIds) {
    var chunks = [];
    var currentChunk = "";
    externalIds.forEach((externalId) => {
      var extendedChunk = currentChunk ? `${currentChunk},${externalId}` : externalId;
      if (extendedChunk.length > MAX_PARAM_VALUE_LENGTH) {
        chunks.push(currentChunk);
        currentChunk = externalId;
      } else {
        currentChunk = extendedChunk;
      }
    });
    if (currentChunk) chunks.push(currentChunk);

    return chunks;
  }
};
