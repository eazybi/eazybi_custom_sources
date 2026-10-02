describe("app.importers.ratings", () => {
  function rating(attributes) {
    return app.importers.rows.merge({
      number: 50, threadid: 1002, threadCreatedAt: "2026-03-01T10:00:00Z", id: 500,
      type: "email", ratingId: 1, ratingCustomerId: 5, ratingCustomerName: "Vernon Bear",
      ratingCreatedAt: "2026-03-02T09:00:00Z", ratingUserId: 99, ratingUserName: "Mr Robot"
    }, attributes || {});
  }

  function prepareImport() {
    mock.extraOptions({time_dimension_time_zone: "UTC"});
    importRun.prepare();
    app.importers.ratings.reset();
  }

  describe("fetchAll", () => {
    beforeEach(() => app.importers.ratings.reset());

    test("groups the ratings of the report by conversation", () => {
      mock.get("/v2/reports/happiness/ratings", {params: {page: 1}, json: {
        results: [rating(), rating({threadid: 1003, id: 501})], page: 1, count: 2, pages: 1
      }});
      mock.get("/v2/reports/happiness/ratings", {params: {page: 2}, json: {
        results: [], page: 2, count: 0, pages: 1
      }});

      expect(app.importers.ratings.fetchAll(["13"], null, "2026-04-01T00:00:00Z")).toBe(2);
      expect(Object.keys(app.importers.ratings.byConversationId).sort()).toEqual(["500", "501"]);
    });

    test("requests the whole history when there is no lower bound", () => {
      mock.get("/v2/reports/happiness/ratings", {json: {results: [], page: 1, pages: 1}});

      app.importers.ratings.fetchAll([], null, "2026-04-01T00:00:00Z");

      expect(mock.requests()[0].params.start).toBe(app.importers.ratings.EARLIEST_START);
    });
  });

  describe("importAllOf", () => {
    beforeEach(prepareImport);

    test("writes one row per rating, keyed by the thread it rates", () => {
      app.importers.ratings.byConversationId["500"] = [rating()];

      expect(app.importers.ratings.importAllOf({id: 500}, {})).toBe(1);

      expect(dwh.measures.conversations_ratings.rows({
        columns: ["_source_id", "_source_name", "ratings", "great_ratings", "okay_ratings",
                  "not_good_ratings"]})).toEqual([
        {_source_id: "1002", _source_name: "custom_helpscout rating", ratings: 1,
         great_ratings: 1, okay_ratings: 0, not_good_ratings: 0}
      ]);
    });

    test("counts a not good rating and names the rated agent", () => {
      app.importers.ratings.byConversationId["500"] = [rating({ratingId: 3})];

      app.importers.ratings.importAllOf({id: 500}, {});

      expect(dwh.measures.conversations_ratings.rows({
        columns: ["great_ratings", "okay_ratings", "not_good_ratings"]})).
        toEqual([{great_ratings: 0, okay_ratings: 0, not_good_ratings: 1}]);
      expect(dwh.dimensions.agents.rows({columns: ["agent_key", "display_name"]})).
        toEqual([{agent_key: "user-99", display_name: "Mr Robot"}]);
    });

    test("takes the ratings of a conversation out of the remaining ones", () => {
      app.importers.ratings.byConversationId["500"] = [rating()];

      app.importers.ratings.importAllOf({id: 500}, {});

      expect(app.importers.ratings.importRemaining()).toBe(0);
    });
  });

  describe("importRemaining", () => {
    beforeEach(prepareImport);

    test("writes the ratings whose conversation was not part of this import", () => {
      app.importers.ratings.byConversationId["500"] = [rating()];

      expect(app.importers.ratings.importRemaining()).toBe(1);

      expect(dwh.measures.conversations_ratings.rows({columns: ["_source_id", "ratings"]})).
        toEqual([{_source_id: "1002", ratings: 1}]);
    });

    test("leaves out a skipped conversation absent from this import", () => {
      app.importers.ratings.byConversationId["500"] = [rating()];

      expect(app.importers.ratings.importRemaining([50])).toBe(0);

      expect(dwh.measures.conversations_ratings.rows()).toEqual([]);
    });
  });
});
