describe("app.importers.records", () => {
  var records = app.importers.records;

  test("reads a missing column as null", () => {
    expect(records.text("")).toBeNull();
    expect(records.text("  ")).toBeNull();
    expect(records.text(" Company ")).toBe("Company");
    // "NA" is how the Marketplace writes a column which does not apply to the record.
    expect(records.optional("NA")).toBeNull();
    expect(records.optional("Yes")).toBe("Yes");
  });

  test("makes a display name of a coded value and keeps the ones already written for display", () => {
    expect(records.humanize("OPEN_SOURCE")).toBe("Open source");
    expect(records.humanize("active")).toBe("Active");
    expect(records.humanize("Corporate_reseller")).toBe("Corporate reseller");
    // A value which is already a display name is kept exactly as it is: "Data center" would be a
    // second member next to the "Data Center" this type seeds.
    expect(records.humanize("Data Center")).toBe("Data Center");
    expect(records.humanize("Fully paid")).toBe("Fully paid");
    expect(records.humanize("")).toBeNull();
  });

  test("reads an amount, a refund with its negative sign", () => {
    expect(records.amount("2564.35")).toBe(2564.35);
    expect(records.amount("-305.46")).toBe(-305.46);
    expect(records.amount("118.33333333333333")).toBe(118.33);
    expect(records.amount("0.0")).toBe(0);
    expect(records.amount("")).toBeNull();
    expect(records.amount("n/a")).toBeNull();
  });

  test("reads a date", () => {
    expect(records.date("2026-09-02")).toBe("2026-09-02");
    expect(records.date("2026-09-02T00:00:00Z")).toBe("2026-09-02");
    expect(records.date("")).toBeNull();
    expect(records.date("not a date")).toBeNull();
  });

  test("normalizes the tiers and reads the user count of each of them", () => {
    expect(records.normalizeTier("10 User")).toBe("10 Users");
    expect(records.normalizeTier("10 Users")).toBe("10 Users");
    expect(records.normalizeTier("Per Unit Pricing (68 Users)")).
      toBe("Per Unit Pricing (68 Users)");

    expect(records.tierUsers("250 Users")).toBe(250);
    expect(records.tierUsers("Per Unit Pricing (68 Users)")).toBe(68);
    expect(records.tierUsers("Unlimited Users")).toBe(1000000);
    expect(records.tierUsers("Evaluation")).toBeNull();
  });

  test("groups the tiers into the user ranges", () => {
    expect(records.tierRange("10 Users").name).toBe("1-10 Users");
    expect(records.tierRange("11 Users").name).toBe("11-25 Users");
    expect(records.tierRange("2000 Users").name).toBe("501-2000 Users");
    expect(records.tierRange("50000 Users").name).toBe("10000+ Users");
    expect(records.tierRange("Unlimited Users").name).toBe("Unlimited Users");
    // A tier which names no user count belongs to no range.
    expect(records.tierRange("Demonstration License").name).toBe("Other");
    expect(records.tierRange("").name).toBe("Other");
  });

  test("names the sales without a partner and the records without a customer", () => {
    expect(records.partnerType("")).toBe("Direct");
    expect(records.partnerName("")).toBe("(direct)");
    expect(records.partnerType("Corporate_reseller")).toBe("Corporate reseller");
    expect(records.partnerName("Partner 8")).toBe("Partner 8");
    expect(records.customerName("")).toBe("(unknown customer)");
  });

  // The Marketplace reports the sales of many solution partners under the "Unknown" type.
  test("reads the unknown partner type as the expert type", () => {
    expect(records.partnerType("Unknown")).toBe("Expert");
    expect(records.partnerType("Expert")).toBe("Expert");
  });

  test("groups the subsidiaries of a partner by the trade name left of their legal names", () => {
    ["Adaptavist UK Services Limited", "Adaptavist Germany GmbH", "Adaptavist Sdn. Bhd",
     "ADAPTAVIST CYPRUS LIMITED", "The Adaptavist Group", "Adaptavist d.o.o. | Croatia",
     "Adaptavist Turkey Bilişim Teknolojileri Limited Şirketi"].forEach((name) =>
      expect(records.partnerGroup(name)).toBe("Adaptavist"));
    expect(records.partnerGroup("Praecipio Consulting, LLC")).toBe("Praecipio");
    expect(records.partnerGroup("Cprime, Inc.")).toBe("Cprime");
    expect(records.partnerGroup("Eficode Switzerland AG")).toBe("Eficode");
    expect(records.partnerGroup("Deviniti Sp. z o.o.")).toBe("Deviniti");
    expect(records.partnerGroup("Valiantys SAS")).toBe("Valiantys");
    expect(records.partnerGroup("Valiantys US")).toBe("Valiantys");
    // A qualifier after a dash, a bar or in parentheses is not part of the name.
    expect(records.partnerGroup("Spectrum Groupe | Middle East")).toBe("Spectrum");
    expect(records.partnerGroup("Spectrum ME - KSA")).toBe("Spectrum");
    expect(records.partnerGroup("Carahsoft Technology Corp No Deal Reg")).toBe("Carahsoft");
    expect(records.partnerGroup("Carahsoft Technology Corporation D")).toBe("Carahsoft");
    expect(records.partnerGroup("knowmad mood Ltd (UK)")).toBe("Knowmad Mood");
    expect(records.partnerGroup("S4E-Chile (Terminated)")).toBe("S4e-Chile");
    // A partner doing business under a trade name belongs to that name, one formerly known as
    // another to its current one.
    expect(records.partnerGroup("Runtime Technologies LLC D/B/A Isos Technology")).toBe("Isos");
    expect(records.partnerGroup("Isos Technology")).toBe("Isos");
    expect(records.partnerGroup("MajorKey Technologies LLC fka Column Technologies LLC")).
      toBe("Majorkey");
    expect(records.partnerGroup("Forty8Fifty Labs, a Verinext Company")).toBe("Forty8fifty");
    expect(records.partnerGroup("Empyra.com, Inc")).toBe("Empyra");
  });

  test("names a partner group the same however the record wrote the name", () => {
    expect(records.partnerGroup("Deiser SL")).toBe("Deiser");
    expect(records.partnerGroup("DEISER SL")).toBe("Deiser");
    expect(records.partnerGroup("RMS Consultoría en Informática de México, SA de CV")).
      toBe("RMS");
    expect(records.partnerGroup("RMS Consultoria en Informática de México SA de CV")).toBe("RMS");
    expect(records.partnerGroup("Ecore Soluções em Tecnologia da Informação Ltda")).
      toBe("Ecore");
    // A short word is an abbreviation written in capitals, a hyphenated name capitalizes both
    // parts, and the small words of a name stay in lower case.
    expect(records.partnerGroup("SHI International Corp.")).toBe("SHI");
    expect(records.partnerGroup("NTT DATA Deutschland SE")).toBe("NTT Data");
    expect(records.partnerGroup("e-Core USA")).toBe("E-Core");
    expect(records.partnerGroup("Coast to Coast Computer Products Inc.")).
      toBe("Coast to Coast Computer Products");
    // An exported name with escaped HTML entities is read as its letters.
    expect(records.partnerGroup("MLV PRODUTOS E SERVI&amp;amp;Ccedil;OS EM TECNOLOGIA LTDA")).
      toBe("MLV Produtos");
  });

  test("keeps a partner name which is not a legal name as its own group", () => {
    expect(records.partnerGroup("Partner 8")).toBe("Partner 8");
    expect(records.partnerGroup("AgileSparks")).toBe("Agilesparks");
    expect(records.partnerGroup("填空题科技有限公司")).toBe("填空题科技有限公司");
    expect(records.partnerGroup("")).toBe("(direct)");
  });

  test("reads the parent product edition of the records that have one", () => {
    expect(records.productEdition("Premium")).toBe("Premium");
    expect(records.productEdition("Free Standard")).toBe("Free");
    expect(records.productEdition("NA")).toBeNull();
    expect(records.productEdition("")).toBeNull();
  });

  test("identifies a license by its license ID or by its app entitlement", () => {
    expect(records.licenseKey({addonLicenseId: "L1000009", appEntitlementNumber: ""})).
      toBe("L1000009");
    expect(records.licenseKey({addonLicenseId: "", appEntitlementNumber: "E-001-AAA-BBB-CCC"})).
      toBe("E-001-AAA-BBB-CCC");
    expect(records.licenseKey({addonLicenseId: "", appEntitlementNumber: "",
                               appEntitlementId: "abc-123"})).toBe("abc-123");
    expect(records.licenseKey({addonLicenseId: "", appEntitlementNumber: ""})).toBeNull();
  });

  // A credit note reuses the line item id of the invoice it credits, so the transaction id
  // belongs in the key of the line.
  test("identifies a transaction line by its transaction ID and its line item", () => {
    expect(records.transactionKey({transactionId: "IN-073", transactionLineItemId: "line-1"})).
      toBe("IN-073/line-1");
    expect(records.transactionKey({transactionId: "CN-072-1", transactionLineItemId: "line-1"})).
      toBe("CN-072-1/line-1");
    // A transaction without a line item falls back to the license it was paid for.
    expect(records.transactionKey({transactionId: "IN-073", transactionLineItemId: "",
                                   addonLicenseId: "L1000009"})).toBe("IN-073/L1000009");
    expect(records.transactionKey({transactionId: "", transactionLineItemId: "line-1"})).
      toBeNull();
  });

  test("counts the payment attempts of the dunning status column", () => {
    expect(records.paymentAttempts('[{"attemptCount":1.0,"errorCode":"card_declined"},' +
                                   '{"attemptCount":2.0}]')).toBe(2);
    expect(records.paymentAttempts("[]")).toBeNull();
    expect(records.paymentAttempts("")).toBeNull();
    // A column which is not readable JSON is not worth failing an import for.
    expect(records.paymentAttempts("{not json")).toBeNull();
  });
});
