var TIMESHEETS = "Harvest Timesheets";
var INVOICES = "Harvest Invoices";

// The cubes are answered in the order they were created, which is not the order of an assertion.
function sorted(names) {
  return names.slice().sort();
}

describe("app.defineSchema", () => {
  describe("the Harvest Timesheets cube", () => {
    test("defines the dimensions of the built-in Harvest application, the managers, the working time and " +
      "the external items", () => {
      expect(schema.cube(TIMESHEETS).dimensions()).toEqual([
        "Approval Status", "Currency", "Expense Category", "External Item", "Person", "Project Manager",
        "Project Status", "Project Task", "Role", "Task", "Time", "Working Time"
      ]);
    });

    test("defines the services and the items of other tools a time entry is linked to", () => {
      var externalItem = schema.cube(TIMESHEETS).dimension("External Item");
      expect(externalItem.levels()).toEqual(["Service", "Item"]);
      ["Item ID", "Group ID", "Account ID", "Service", "Issue key", "URL"].
        forEach((name) => expect(externalItem.level("Item").properties()).toContain(name));
    });

    test("groups the people by employees and contractors", () => {
      expect(schema.cube(TIMESHEETS).dimension("Person").levels()).toEqual(["Type", "Person"]);
      expect(schema.cube(TIMESHEETS).dimension("Person").hierarchies()).toEqual(["Person"]);
    });

    test("keeps the level properties the built-in Harvest application stores", () => {
      var timesheets = schema.cube(TIMESHEETS);
      var clientProperties = timesheets.dimension("Project Task").level("Client").properties();
      expect(clientProperties).toContain("Currency");

      var projectProperties = timesheets.dimension("Project Task").level("Project").properties();
      ["Code", "Status", "Billable", "Budget by", "Bill by", "Hourly rate", "Created date",
       "Updated date", "Start date", "End date", "Budget includes expenses", "Project manager",
       "Notes"].forEach((name) => expect(projectProperties).toContain(name));

      var taskProperties = timesheets.dimension("Project Task").level("Task").properties();
      ["Deactivated", "Billable", "Hourly rate"].forEach((name) =>
        expect(taskProperties).toContain(name));

      var personProperties = timesheets.dimension("Person").level("Person").properties();
      ["Person type", "Active", "Contractor", "Weekly capacity", "Default hourly rate", "Cost rate",
       "Created date", "First tracked date", "Last tracked date"].
        forEach((name) => expect(personProperties).toContain(name));

      expect(timesheets.dimension("Task").level("Task").properties()).
        toContain("Billable by default");
      expect(timesheets.dimension("Currency").level("Currency").properties()).toContain("EUR rate");
      expect(timesheets.dimension("Currency").level("Currency").properties()).
        toContain("Account currency");
    });

    // Cost amount, Capacity hours, Hours with notes and Linked hours are the ones the built-in application
    // does not have.
    test("defines the stored measures with their Harvest names", () => {
      expect(schema.cube(TIMESHEETS).measures()).toEqual([
        "Hours", "Rounded hours", "Billable hours", "Invoiced hours", "Budgeted hours", "Budgeted cost",
        "Billable amount", "Invoiced amount", "Expenses amount", "Billable expenses", "Invoiced expenses",
        "Cost amount", "Capacity hours", "Notes", "Hours with notes", "Linked hours"
      ]);
    });

    test("converts every amount of the cube into euro and into US dollars", () => {
      var calculatedMembers = schema.cube(TIMESHEETS).calculatedMembers();
      ["Billable amount", "Invoiced amount", "Expenses amount", "Billable expenses", "Invoiced expenses",
       "Cost amount", "Budgeted cost", "Uninvoiced amount", "Uninvoiced expenses",
       "Uninvoiced amount with expenses"].forEach((name) => {
        expect(calculatedMembers).toContain(`[Measures].[${name} EUR]`);
        expect(calculatedMembers).toContain(`[Measures].[${name} USD]`);
      });
    });

    test("defines a property measure of every project, task and person property", () => {
      var calculatedMembers = schema.cube(TIMESHEETS).calculatedMembers();
      ["Project currency", "Project status", "Project manager", "Project notes", "Project billable?",
       "Project budget by", "Project budget includes expenses?", "Project bill by",
       "Project hourly rate", "Project start date", "Project end date",
       "Project task billable?", "Project task hourly rate",
       "Person type", "Task hourly rate", "Person weekly capacity", "Person default hourly rate",
       "Person cost rate", "Person created date", "Person first tracked date",
       "Person last tracked date"].forEach((name) =>
        expect(calculatedMembers).toContain(`[Measures].[${name}]`));
    });
  });

  describe("the Harvest Invoices cube", () => {
    test("defines the dimensions of the built-in Harvest application and the managers of a project", () => {
      expect(schema.cube(INVOICES).dimensions()).toEqual([
        "Client Project", "Currency", "Invoice", "Invoice Item Category", "Invoice Status", "Project Manager",
        "Time"
      ]);
    });

    test("reports by the same Currency and Time dimensions as the timesheets cube", () => {
      expect(schema.cube(INVOICES).dimension("Currency").level("Currency").properties()).
        toEqual(schema.cube(TIMESHEETS).dimension("Currency").level("Currency").properties());
      expect(schema.cube(INVOICES).dimension("Time").levels()).
        toEqual(schema.cube(TIMESHEETS).dimension("Time").levels());
    });

    test("keeps the level properties the built-in Harvest application stores", () => {
      var invoices = schema.cube(INVOICES);
      var invoiceProperties = invoices.dimension("Invoice").level("Invoice").properties();
      ["Issued date", "Due date", "Period start date", "Period end date", "Currency", "Client",
       "Status", "Created by", "PO number"].forEach((name) =>
        expect(invoiceProperties).toContain(name));

      var itemProperties = invoices.dimension("Invoice").level("Invoice Item").properties();
      ["Category", "Project"].forEach((name) => expect(itemProperties).toContain(name));

      var clientProperties = invoices.dimension("Client Project").level("Client").properties();
      expect(clientProperties).toContain("Currency");

      var projectProperties = invoices.dimension("Client Project").level("Project").properties();
      ["Code", "Status", "Project manager", "Notes", "Start date", "End date"].forEach((name) =>
        expect(projectProperties).toContain(name));
    });

    test("stores the invoice and line item fields of the v2 API as further properties", () => {
      var invoices = schema.cube(INVOICES);
      var invoiceProperties = invoices.dimension("Invoice").level("Invoice").properties();
      ["Number", "Subject", "Sent date", "Paid date", "Closed date", "Payment term", "Retainer ID",
       "Estimate ID", "Notes"].forEach((name) => expect(invoiceProperties).toContain(name));

      var itemProperties = invoices.dimension("Invoice").level("Invoice Item").properties();
      ["Quantity", "Unit price", "Taxed", "Taxed by the second tax"].forEach((name) =>
        expect(itemProperties).toContain(name));
    });

    test("defines the stored measures with their Harvest names", () => {
      expect(schema.cube(INVOICES).measures()).toEqual([
        "Invoice amount", "Item amount", "Discount amount", "Tax amount", "Second tax amount",
        "Due amount"
      ]);
    });

    test("converts every amount of the cube into euro and into US dollars", () => {
      var calculatedMembers = schema.cube(INVOICES).calculatedMembers();
      schema.cube(INVOICES).measures().forEach((name) => {
        expect(calculatedMembers).toContain(`[Measures].[${name} EUR]`);
        expect(calculatedMembers).toContain(`[Measures].[${name} USD]`);
      });
    });

    test("defines a property measure of every invoice and project property", () => {
      var calculatedMembers = schema.cube(INVOICES).calculatedMembers();
      ["Project currency", "Project status", "Project manager", "Project notes", "Project start date",
       "Project end date", "Invoice issued date", "Invoice due date", "Invoice period start date",
       "Invoice period end date", "Invoice currency", "Invoice client", "Invoice status",
       "Invoice created by", "Invoice item category", "Invoice item project", "Invoice PO number"].
        forEach((name) => expect(calculatedMembers).toContain(`[Measures].[${name}]`));
    });
  });

  test("loads both cubes in Mondrian", () => {
    expect(sorted(olap.cubes())).toEqual([INVOICES, TIMESHEETS]);
  });
});
