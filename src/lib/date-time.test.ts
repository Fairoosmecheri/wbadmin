import { describe, expect, it } from "vitest";
import { formatWorkspaceDate, type WorkspaceDateSettings } from "./date-time";

describe("workspace date display", () => {
  const instant = "2026-10-07T23:15:00.000Z";
  const settings: WorkspaceDateSettings = { timezone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY" };

  it.each([
    ["DD/MM/YYYY", "08/10/2026"],
    ["MM/DD/YYYY", "10/08/2026"],
    ["YYYY-MM-DD", "2026-10-08"],
  ] as const)("applies %s after converting to the business timezone", (dateFormat, expected) => {
    expect(formatWorkspaceDate(instant, { ...settings, dateFormat })).toBe(expected);
  });

  it("includes workspace time independently of the browser locale", () => {
    expect(formatWorkspaceDate(new Date(instant), settings, { includeTime: true })).toBe("08/10/2026, 04:45");
    expect(formatWorkspaceDate(instant, settings, { timeOnly: true })).toBe("04:45");
    expect(formatWorkspaceDate(instant, { ...settings, timezone: "America/New_York" }, { includeTime: true })).toBe("07/10/2026, 19:15");
  });

  it("uses daylight-saving offsets for the displayed instant", () => {
    const eastern = { ...settings, timezone: "America/New_York" };
    expect(formatWorkspaceDate("2026-03-08T06:59:00Z", eastern, { includeTime: true })).toBe("08/03/2026, 01:59");
    expect(formatWorkspaceDate("2026-03-08T07:00:00Z", eastern, { includeTime: true })).toBe("08/03/2026, 03:00");
  });

  it("preserves date-only business values in timezones behind UTC", () => {
    expect(formatWorkspaceDate("2026-10-07T00:00:00Z", { timezone: "America/Los_Angeles", dateFormat: "MM/DD/YYYY" }, { calendarDate: true })).toBe("10/07/2026");
  });

  it("shows midnight as 00:00 and handles missing or invalid dates", () => {
    expect(formatWorkspaceDate("2026-10-07T18:30:00Z", settings, { includeTime: true })).toBe("08/10/2026, 00:00");
    for (const value of [null, undefined, "", "invalid", new Date(Number.NaN)]) expect(formatWorkspaceDate(value, settings)).toBe("—");
  });
});
