// The incremental high water mark is stored per repository, keyed by the GitHub repository id — a
// repository whose import failed keeps its previous mark while the healthy ones stay incremental.
var UPDATED_AT_MAX_PARAM = "updated_at";

app.importers.repositories = {
  importMember(repository) {
    var ownerId = this.ownerId(repository.owner);
    var importedRepository = {
      id: dwh.dimensions.repositories.createAndLookupId({external_id: repository.id}, {
        owner_id: ownerId,
        repository_slug: repository.full_name,
        repository_name: repository.name
      }),
      externalId: repository.id,
      ownerId: ownerId,
      slug: repository.full_name,
      name: repository.name
    };

    this.propagateRepositoryRename(importedRepository);
    return importedRepository;
  },

  ownerId(owner) {
    if (!owner) return null;

    return dwh.dimensions.owners.createAndLookupId({external_id: String(owner.id)},
      {login: owner.login, owner_type: owner.type});
  },

  // A renamed repository keeps its GitHub id, so its own member is updated in place — but the Pull Request
  // and the Milestone members store its slug denormalized and have to follow, and a transfer to another
  // account moves the owner the Pull Request members store as well. A stored value can not be read back,
  // so the rename is recognized from the pull requests that do not carry the current slug.
  //
  // The Milestone member *name* is not corrected here: updateDuplicateNames recovers a title by removing
  // the suffix of the slug the row carries now, so a name built from the old slug would no longer be
  // recognized once this update ran. The import of a pull request of that milestone is what corrects it.
  propagateRepositoryRename(repository) {
    var storedCount = dwh.dimensions.pull_requests.selectCount({repository_id: repository.id});
    if (storedCount === 0) return;

    var currentSlugCount = dwh.dimensions.pull_requests.
      selectCount({repository_id: repository.id, repository_slug: repository.slug});
    if (currentSlugCount === storedCount) return;

    logger.info(`propagateRepositoryRename the repository ${repository.externalId} was renamed to` +
      ` ${repository.slug}`);
    dwh.dimensions.pull_requests.update(
      {repository_slug: repository.slug, repository_name: repository.name,
        owner_id: repository.ownerId},
      {repository_id: repository.id}
    );
    dwh.dimensions.milestone.update({repository_slug: repository.slug}, {repository_id: repository.id});
  },

  incrementalMarkKey(externalId) {
    return `${UPDATED_AT_MAX_PARAM}.${externalId}`;
  },

  // The rows of a deselected repository are deleted, so its mark goes with them — otherwise selecting the
  // repository again would stop at the first pull request older than the mark and import nothing.
  clearIncrementalMark(externalId) {
    source.setMaxParam(this.incrementalMarkKey(externalId), "");
  },

  // Returns whether the repository was imported. A failing repository is skipped with its incremental
  // mark where it was, so a failure costs it one import and not its stored data. reportFailure is passed
  // only on the second attempt: a repository that answers when it is read again at the end of the same
  // import is not missing anything and must not leave a warning behind.
  importOne(repository, shared, options) {
    // Keyed by the GitHub repository id, which a rename does not change — the failure of a slug that is
    // gone would never be cleared and counts against the object warning limit of every later import.
    var warningKey = `repository/${repository.externalId}`;
    try {
      this.importPullRequests(repository, shared);
      source.warnings.clearOld(warningKey);
      return true;
    } catch (error) {
      // A canceled import raises the same way a failed request does — reported as a failure of this
      // repository, it would be reported for every one after it as well.
      source.checkCanceling();

      if (options && options.reportFailure) {
        source.warnings.addObjectFailure(warningKey,
          `Import of the repository ${repository.slug} failed: ${error.message}.` +
          " Its pull requests are missing from this account — start a new import to read this repository" +
          " again from its newest pull request, the other repositories continue where they stopped.");
      } else {
        logger.warn(`importOne import of the repository ${repository.slug} failed, reading it again at` +
          ` the end of the import: ${error.message}`);
      }
      return false;
    }
  },

  // The rows an earlier version of the type wrote under a different source id are never replaced and
  // would be counted next to the current ones — a reimport reads every pull request again, so it can
  // start the repository from an empty slate. Per repository, so that a repository whose import fails
  // loses no more than its own rows.
  deletePreviousRows(repository) {
    var sourceNames = app.importers.helpers.MEASURES_SOURCE_NAMES;

    Object.keys(sourceNames).forEach((tableName) => dwh.measures[tableName].
      deleteRows({repository_id: repository.id, _source_name: sourceNames[tableName]}));
  },

  // Newest updated first, so that an incremental import can stop at the first pull request it already
  // has — the pages after it are older.
  importPullRequests(repository, shared) {
    logger.startImport("pull requests", repository.slug);
    var maxParamKey = this.incrementalMarkKey(repository.externalId);
    if (source.isReimport()) {
      // Cleared before the rows it covers are deleted: an import which fails in between leaves no mark
      // claiming rows that are gone, so the next import reads the repository whole instead of stopping at
      // the mark of the reimport that deleted them.
      this.clearIncrementalMark(repository.externalId);
      this.deletePreviousRows(repository);
    }

    var updatedSince = source.isReimport() ? null : source.getMaxParam(maxParamKey);
    var updatedSinceTime = updatedSince ? Date.parse(updatedSince) : null;
    var importedCount = 0;

    app.api.getPullRequests(repository.slug, shared.importOptions, (pullRequests) => {
      var pageCount = 0;
      var reachedImported = false;
      for (let pullRequest of pullRequests) {
        if (updatedSinceTime && Date.parse(pullRequest.updatedAt) < updatedSinceTime) {
          reachedImported = true;
          break;
        }
        app.importers.pullRequests.importOne(pullRequest, repository, shared.importOptions);
        importedCount++;
        pageCount++;
      }
      // Reported for the page that stopped the pagination as well — that page is the whole of an
      // incremental import of a repository that changed a little.
      app.importer.progress.pullRequestsRead(pageCount);

      return reachedImported ? "stop" : null;
    });

    logger.finishImport("pull requests", importedCount);
    // A failure throws before this line and leaves the mark where it stood, so that the next import reads
    // the same window again.
    source.setMaxParam(maxParamKey, shared.importStartedAt);
  }
};
