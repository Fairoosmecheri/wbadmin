export type WorkspaceDateSettings = {
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
};

export type DateDisplayOptions = { includeTime?: boolean; timeOnly?: boolean; calendarDate?: boolean };

/** Display timestamps consistently on the server and in every team member's browser. */
export function formatWorkspaceDate(
  value: Date | string | null | undefined,
  settings: WorkspaceDateSettings,
  { includeTime = false, timeOnly = false, calendarDate = false }: DateDisplayOptions = {},
) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    // Date-only business values are stored at midnight UTC and must retain their day.
    timeZone: calendarDate ? "UTC" : settings.timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  const time = `${part("hour")}:${part("minute")}`;
  if (timeOnly) return time;
  const day = part("day"), month = part("month"), year = part("year");
  const formatted = settings.dateFormat === "YYYY-MM-DD" ? `${year}-${month}-${day}`
    : settings.dateFormat === "MM/DD/YYYY" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
  return includeTime ? `${formatted}, ${time}` : formatted;
}
