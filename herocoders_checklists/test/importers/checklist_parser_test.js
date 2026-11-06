describe("app.importers.checklistParser", () => {
  var parser = app.importers.checklistParser;
  var adf = (text) => ({type: "doc", version: 1, content: [{type: "paragraph", content: [{type: "text", text: text}]}]});

  describe("parse", () => {
    test("splits the text into named checklists, reads the headers and skips the descriptions", () => {
      var checklists = parser.parse(
        "# Checklist #1\n---Header text\n* [done] Select\n--- Header\n* [open] test1\n\n\n# Security\n* [done] XSS\n>> a note\n* [open] CSRF\n");

      expect(checklists.map((checklist) => checklist.name)).toEqual(["Checklist #1", "Security"]);
      expect(checklists[0].items).toEqual([
        {text: "Select", status: "Done", completed: true, header: "Header text"},
        {text: "test1", status: "Open", completed: false, header: "Header"}
      ]);
      expect(checklists[1].items.map((item) => [item.text, item.header])).toEqual([["XSS", null], ["CSRF", null]]);
    });

    test("reads the checklists of DA-608 without the headers as items", () => {
      var checklists = parser.parse("# Checklist #1\n---Header text\n* [done] [Select something](eazybi.com)\n---Header\n" +
        "* [done] DB-8\n* [open] DA-387\n\n# Checklist #2\n---Security review\n* [done] XSS protected\n" +
        "* [done] CSRF protected\n* [done] SSRF protected\n* [open] SQL injection protected\n* [done] Access control tested");

      expect(checklists.map((checklist) => [checklist.name, parser.summary([checklist])])).toEqual([
        ["Checklist #1", {total: 3, completed: 2, progress: 2 / 3}],
        ["Checklist #2", {total: 5, completed: 4, progress: 0.8}]
      ]);
      expect(checklists[0].items.map((item) => [item.header, item.text])).toEqual([
        ["Header text", "[Select something](eazybi.com)"], ["Header", "DB-8"], ["Header", "DA-387"]
      ]);
      expect(_.uniq(checklists[1].items.map((item) => item.header))).toEqual(["Security review"]);
    });

    test("ends a header with a header without a text", () => {
      var items = parser.parse("--- A\n* [] One\n---\n* [] Two")[0].items;

      expect(items.map((item) => item.header)).toEqual(["A", null]);
    });

    test("reads a link as the text of an item without a status", () => {
      var items = parser.parse("* [eazyBI](eazybi.com)\n- [x] [Docs](https://docs.eazybi.com) and more")[0].items;

      expect(items).toEqual([
        {text: "[eazyBI](eazybi.com)", status: "Open", completed: false, header: null},
        {text: "[Docs](https://docs.eazybi.com) and more", status: "Done", completed: true, header: null}
      ]);
    });

    test("reads the statuses, the checked and the optional items", () => {
      var items = parser.parse("* [x] One\n- [] Two\n[in progress] Three\n* [skipped] Four\n* []? Five\n* Six")[0].items;

      expect(items.map((item) => _.pick(item, "text", "status", "completed"))).toEqual([
        {text: "One", status: "Done", completed: true},
        {text: "Two", status: "Open", completed: false},
        {text: "Three", status: "In progress", completed: false},
        {text: "Four", status: "Skipped", completed: true},
        {text: "Five", status: "Open", completed: false},
        {text: "Six", status: "Open", completed: false}
      ]);
    });

    test("counts the given statuses as completed", () => {
      var items = parser.parse("* [Verified] One\n* [skipped] Two\n* [x] Three", ["verified"])[0].items;

      expect(items.map((item) => [item.status, item.completed])).
        toEqual([["Verified", true], ["Skipped", false], ["Done", true]]);
    });

    test("counts the items without a status as Open items", () => {
      var items = parser.parse("* [open] One\n* [] Two\n* []? Three\n* Four\n* [x] Five", ["open"])[0].items;

      expect(items.map((item) => [item.status, item.completed])).
        toEqual([["Open", true], ["Open", true], ["Open", true], ["Open", true], ["Done", true]]);
    });

    test("reads an ADF document with a heading and lists", () => {
      var doc = {type: "doc", content: [
        {type: "heading", content: [{type: "text", text: "Default checklist"}]},
        {type: "bulletList", content: [{type: "listItem", content: [{type: "paragraph", content: [{type: "text", text: "[done] One"}]}]}]},
        {type: "orderedList", content: [{type: "listItem", content: [{type: "paragraph", content: [{type: "text", text: "Second"}]}]}]},
        {type: "paragraph", content: [{type: "text", text: "[open] Two"}, {type: "hardBreak"}, {type: "text", text: "[x] Three"}]}
      ]};
      var checklists = parser.parse(doc);

      expect(checklists.map((checklist) => checklist.name)).toEqual(["Default checklist", "Second"]);
      expect(checklists[0].items.map((item) => item.text)).toEqual(["One"]);
      expect(checklists[1].items.map((item) => item.text)).toEqual(["Two", "Three"]);
    });

    test("puts the items without a title into the default checklist", () => {
      var checklists = parser.parse(adf("* [open] First\r\n* [done] Second"));

      expect(checklists.length).toBe(1);
      expect(checklists[0].name).toBe("Checklist");
      expect(checklists[0].items.length).toBe(2);
    });

    test("has no checklists for an empty value or a title without items", () => {
      expect(parser.parse(null)).toEqual([]);
      expect(parser.parse("")).toEqual([]);
      expect(parser.parse("# Default checklist\n")).toEqual([]);
    });
  });

  describe("completedStatuses", () => {
    test("are done and skipped by default", () => {
      expect(parser.completedStatuses()).toEqual(["done", "skipped"]);
    });

    test("are read from the import option", () => {
      mock.extraOptions({completed_statuses: ["done", "Verified"]});

      expect(parser.completedStatuses()).toEqual(["done", "verified"]);
    });

    test("are none when no status is selected", () => {
      mock.extraOptions({completed_statuses: []});

      expect(parser.completedStatuses()).toEqual([]);
    });

    test("are read from the comma separated text saved by version 1.0.0", () => {
      mock.extraOptions({completed_statuses: "Done, Verified ,"});

      expect(parser.completedStatuses()).toEqual(["done", "verified"]);
    });
  });

  test("summary counts the items of all checklists", () => {
    var checklists = parser.parse("# A\n* [x] One\n* [] Two\n# B\n* [skipped] Three\n* [open] Four");

    expect(parser.summary(checklists)).toEqual({total: 4, completed: 2, progress: 0.5});
    expect(parser.summary([])).toEqual({total: 0, completed: 0, progress: null});
  });

  test("toMarkdown lists the checklists with their progress and the other statuses", () => {
    var checklists = parser.parse("# UI\n* [x] Chrome\n* [in progress] Edge\n# API\n* [skipped] Docs");

    expect(parser.toMarkdown(checklists)).toBe(
      "**UI** (1/2)\n- ✅ Chrome\n- ⬜ Edge *(In progress)*\n\n**API** (1/1)\n- ✅ Docs *(Skipped)*");
  });

  test("toMarkdown shows the headers and the links", () => {
    var checklists = parser.parse("# Checklist #1\n---Header text\n* [done] [Select something](eazybi.com)\n" +
      "---Header\n* [done] DB-8\n* [open] [Mail](mailto:a@b.c)\n---\n* [open] Last");

    expect(parser.toMarkdown(checklists)).toBe("**Checklist #1** (2/4)\n\n*Header text*\n" +
      "- ✅ [Select something](https://eazybi.com)\n\n*Header*\n- ✅ DB-8\n- ⬜ [Mail](mailto:a@b.c)\n\n- ⬜ Last");
  });

  test("plainText removes the link URLs", () => {
    expect(parser.plainText("[Select something](eazybi.com) and [docs](https://docs.eazybi.com)")).
      toBe("Select something and docs");
    expect(parser.plainText("[done] not a link")).toBe("[done] not a link");
  });

  test("markdownText keeps the links with a scheme or a path", () => {
    expect(parser.markdownText("[a](http://x.org) [b](/browse/DA-1) [c](#top) [d](www.x.org)")).
      toBe("[a](http://x.org) [b](/browse/DA-1) [c](#top) [d](https://www.x.org)");
  });

  test("truncate shortens long names", () => {
    var name = parser.truncate("x".repeat(300));

    expect(name.length).toBe(200);
    expect(name.charAt(199)).toBe("…");
    expect(parser.truncate("  Short  ")).toBe("Short");
  });
});
