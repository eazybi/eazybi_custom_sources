describe("app.importers.officeHours", () => {
  function officeDay(startTime, endTime) {
    return {open: true, start_time: startTime, end_time: endTime};
  }

  var closedDay = {open: false, start_time: "09:00", end_time: "18:00"};
  var weekDays = [1, 2, 3, 4, 5].map(() => officeDay("09:00", "18:00"));

  function mockOfficeHours(rows) {
    mock.extraOptions({time_dimension_time_zone: "Europe/Riga", office_hours: rows});
  }

  describe("selected", () => {
    test("is null unless the Use office hours option is selected", () => {
      mock.extraOptions({time_dimension_time_zone: "Europe/Riga"});
      expect(app.importers.officeHours.selected()).toBeNull();
    });

    test("reads the schedule of the selected office hours", () => {
      mock.extraOptions({time_dimension_time_zone: "Europe/Riga", use_office_hours: true});
      expect(app.importers.officeHours.selected().schedule[1]).toEqual({startMinute: 540, endMinute: 1080});
    });
  });

  describe("schedule", () => {
    test("reads the default office hours from Monday to Friday", () => {
      mock.extraOptions({time_dimension_time_zone: "Europe/Riga"});
      var schedule = app.importers.officeHours.schedule();

      expect(schedule[0]).toBeNull();
      expect(schedule[1]).toEqual({startMinute: 540, endMinute: 1080});
      expect(schedule[5]).toEqual({startMinute: 540, endMinute: 1080});
      expect(schedule[6]).toBeNull();
    });

    // Help Scout counts every hour as an office hour when no office day is specified.
    test("returns no schedule when no day is open", () => {
      mockOfficeHours([1, 2, 3, 4, 5, 6, 7].map(() => closedDay));
      expect(app.importers.officeHours.schedule()).toBeNull();
    });

    test("fails when an open day ends before it starts", () => {
      mockOfficeHours([officeDay("18:00", "09:00")]);
      expect(() => app.importers.officeHours.schedule()).
        toThrow("The office hours of Monday must end after they start");
    });

    test("fails when an open day has no start or end time", () => {
      mockOfficeHours([closedDay, officeDay(null, "18:00")]);
      expect(() => app.importers.officeHours.schedule()).
        toThrow("The office hours of Tuesday need a start and an end time");
    });

    test("reads the end of the day as 24:00", () => {
      mockOfficeHours([closedDay, closedDay, closedDay, closedDay, closedDay, officeDay("10:00", "24:00")]);
      expect(app.importers.officeHours.schedule()[6]).toEqual({startMinute: 600, endMinute: 1440});
    });
  });

  describe("minutesBetween", () => {
    function officeMinutesBetween(fromTimestamp, toTimestamp) {
      var schedule = app.importers.officeHours.schedule();
      return app.importers.officeHours.minutesBetween(fromTimestamp, toTimestamp, schedule);
    }

    beforeEach(() => {
      mockOfficeHours(weekDays.concat([closedDay, closedDay]));
    });

    // 2026-03-02 is a Monday, and Europe/Riga is UTC+2 in March.
    test("counts the office minutes within one day", () => {
      expect(officeMinutesBetween("2026-03-02T05:00:00Z", "2026-03-02T08:30:00Z")).toBe(90);
    });

    test("does not count the night between two office days", () => {
      expect(officeMinutesBetween("2026-03-02T15:00:00Z", "2026-03-03T08:00:00Z")).toBe(120);
    });

    test("does not count the weekend", () => {
      expect(officeMinutesBetween("2026-03-06T15:00:00Z", "2026-03-09T08:00:00Z")).toBe(120);
    });

    test("counts all minutes when no day is open", () => {
      mockOfficeHours([1, 2, 3, 4, 5, 6, 7].map(() => closedDay));
      expect(officeMinutesBetween("2026-03-07T10:00:00Z", "2026-03-07T11:00:00Z")).toBe(60);
    });

    test("returns null for timestamps out of order", () => {
      expect(officeMinutesBetween("2026-03-02T08:00:00Z", "2026-03-02T07:00:00Z")).toBeNull();
    });
  });

  describe("hoursBetween", () => {
    beforeEach(() => {
      mockOfficeHours(weekDays.concat([closedDay, closedDay]));
    });

    // From 17:00 on Friday to 10:20 on Monday in Riga — one hour on Friday and 1 hour 20 minutes on Monday.
    test("counts the office hours rounded to two decimals", () => {
      var schedule = app.importers.officeHours.schedule();
      expect(app.importers.officeHours.hoursBetween(
        "2026-03-06T15:00:00Z", "2026-03-09T08:20:00Z", schedule)).toBe(2.33);
    });

    test("counts all hours when no day is open", () => {
      expect(app.importers.officeHours.hoursBetween(
        "2026-03-07T10:00:00Z", "2026-03-07T11:30:00Z", null)).toBe(1.5);
    });
  });
});
