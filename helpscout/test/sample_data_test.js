// The generated sample data of test/sample_data.js imports without an unmocked request and fills
// every dimension the sample reports group by.
describe("sample data", () => {
  beforeAll(() => {
    mock.sampleData();
    // The Custom fields tab offers the fields of the sample inboxes as well.
    mock.customFields({"201": {property: true, dimension: true}, "206": {measure: true}});
    importRun.run();
  });

  // Leave the schema of the run and the importer without the custom fields for the tests that follow.
  afterAll(() => {
    mock.customFields({});
    app.importers.customFields.reset();
  });

  test("imports the conversations of every inbox without warnings", () => {
    expect(importRun.warnings()).toEqual([]);
    expect(olap.results(`
      SELECT [Inbox].[Inbox].Members ON ROWS,
             {[Measures].[Conversations created]} ON COLUMNS
      FROM [Help Scout]`).map((row) => row[0])).toEqual(["Billing", "Sales", "Support"]);
    var total = olap.results(`
      SELECT {[Measures].[Conversations created]} ON COLUMNS, {[Inbox].DefaultMember} ON ROWS
      FROM [Help Scout]`)[0][1];
    expect(total).toBeGreaterThan(1500);
  });

  test("imports the messages and the ratings of the sample reports", () => {
    expect(dwh.measures.conversations_messages.rows({limit: 1}).length).toBe(1);
    expect(dwh.measures.conversations_ratings.rows({limit: 1000}).length).toBeGreaterThan(300);
  });

  test("spreads the first replies over every first reply interval", () => {
    var intervals = olap.results(`
      SELECT Filter([First reply interval].[First reply interval].Members,
                    NOT IsEmpty([Measures].[Conversations with first reply])) ON ROWS,
             {[Measures].[Conversations with first reply]} ON COLUMNS
      FROM [Help Scout]`);
    expect(intervals.length).toBe(4);
  });

  test("imports the custom fields of the inboxes", () => {
    expect(app.api.getAvailableCustomFields([]).map((field) => `${field.group}: ${field.name}`)).toEqual([
      "Support: Priority", "Support: Product area", "Billing: Plan", "Billing: Invoice amount",
      "Sales: Lead source", "Sales: Seats"
    ]);
    var priorities = olap.results(`
      SELECT Filter([Priority].[Priority].Members, NOT IsEmpty([Measures].[Conversations created])) ON ROWS,
             {[Measures].[Conversations created]} ON COLUMNS
      FROM [Help Scout]`);
    expect(priorities.map((row) => row[0])).toEqual(["(none)", "High", "Medium", "Low"]);
    var seats = olap.results(`
      SELECT {[Measures].[Seats]} ON COLUMNS, {[Inbox].[Sales]} ON ROWS
      FROM [Help Scout]`)[0][1];
    expect(seats).toBeGreaterThan(1000);
  });
});
