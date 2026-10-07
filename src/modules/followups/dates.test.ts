import { describe, expect, it } from "vitest";
import { calendarBoundaries, followUpDateRange, localDateTimeInput, zonedDateTimeToUtc } from "./dates";

describe("business timezone follow-up dates", () => {
  it("converts India date input without depending on the server timezone", () => {
    expect(zonedDateTimeToUtc("2026-10-07T09:30", "Asia/Kolkata").toISOString()).toBe("2026-10-07T04:00:00.000Z");
    expect(localDateTimeInput(new Date("2026-10-07T04:00:00Z"), "Asia/Kolkata")).toBe("2026-10-07T09:30");
  });
  it("uses the local calendar date across UTC midnight", () => {
    const b = calendarBoundaries(new Date("2026-10-07T21:00:00Z"), "Asia/Kolkata");
    expect(b.today.toISOString()).toBe("2026-10-07T18:30:00.000Z");
    expect(b.tomorrow.toISOString()).toBe("2026-10-08T18:30:00.000Z");
    expect(b.nextWeek.toISOString()).toBe("2026-10-11T18:30:00.000Z");
  });
  it("handles a 23-hour spring-forward day", () => {
    const b = calendarBoundaries(new Date("2026-03-08T16:00:00Z"), "America/New_York");
    expect(b.today.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(b.tomorrow.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(b.tomorrow.getTime() - b.today.getTime()).toBe(23 * 3600000);
  });
  it("handles a 25-hour fall-back day", () => {
    const b = calendarBoundaries(new Date("2026-11-01T16:00:00Z"), "America/New_York");
    expect(b.tomorrow.getTime() - b.today.getTime()).toBe(25 * 3600000);
    expect(localDateTimeInput(zonedDateTimeToUtc("2026-11-01T01:30", "America/New_York"), "America/New_York")).toBe("2026-11-01T01:30");
  });
  it("rejects nonexistent spring-forward times and malformed dates", () => {
    expect(() => zonedDateTimeToUtc("2026-03-08T02:30", "America/New_York")).toThrow("does not exist");
    expect(() => zonedDateTimeToUtc("2026-02-30T10:00", "Asia/Kolkata")).toThrow();
    expect(() => zonedDateTimeToUtc("2026-01-01", "Asia/Kolkata")).toThrow();
  });
  it("returns half-open date windows so midnight belongs to one day", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const b = calendarBoundaries(now, "Asia/Kolkata");
    expect(followUpDateRange("today", now, "Asia/Kolkata")).toEqual({ gte: b.today, lt: b.tomorrow });
    expect(followUpDateRange("tomorrow", now, "Asia/Kolkata")).toEqual({ gte: b.tomorrow, lt: b.afterTomorrow });
    expect(followUpDateRange("overdue", now, "Asia/Kolkata")).toEqual({ lt: now });
    expect(followUpDateRange("week", now, "Asia/Kolkata")).toEqual({ gte: b.today, lt: b.nextWeek });
    expect(followUpDateRange("upcoming", now, "Asia/Kolkata")).toEqual({ gte: b.afterTomorrow });
    expect(followUpDateRange("my", now, "Asia/Kolkata")).toBeUndefined();
  });
  it("starts the next week on Monday including a current Monday", () => {
    expect(calendarBoundaries(new Date("2026-10-05T12:00:00Z"), "UTC").nextWeek.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
