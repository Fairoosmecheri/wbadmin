/** Calendar arithmetic uses the business timezone, including daylight-saving changes. */
function localParts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (name: string) => Number(values.find((p) => p.type === name)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

export function localDateTimeInput(date: Date, timezone: string) {
  const p = localParts(date, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function zonedDateTimeToUtc(value: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid date and time.");
  const wanted = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(wanted)) throw new Error("Choose a valid date and time.");
  let guess = wanted;
  for (let iteration = 0; iteration < 4; iteration++) {
    const p = localParts(new Date(guess), timezone);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = wanted - represented;
    guess += delta;
    if (delta === 0) break;
  }
  const result = new Date(guess);
  if (localDateTimeInput(result, timezone) !== value) throw new Error("This local time does not exist because the clock changes. Choose another time.");
  return result;
}

export function calendarBoundaries(now: Date, timezone: string) {
  const local = localParts(now, timezone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const day = (offset: number) => {
    const shifted = new Date(date.getTime() + offset * 86400000);
    return zonedDateTimeToUtc(`${shifted.toISOString().slice(0, 10)}T00:00`, timezone);
  };
  const daysUntilMonday = 7 - ((date.getUTCDay() + 6) % 7);
  return { today: day(0), tomorrow: day(1), afterTomorrow: day(2), nextWeek: day(daysUntilMonday) };
}

export function followUpDateRange(bucket: string, now: Date, timezone: string) {
  const b = calendarBoundaries(now, timezone);
  switch (bucket) {
    case "overdue": return { lt: now };
    case "today": return { gte: b.today, lt: b.tomorrow };
    case "tomorrow": return { gte: b.tomorrow, lt: b.afterTomorrow };
    case "week": return { gte: b.today, lt: b.nextWeek };
    case "upcoming": return { gte: b.afterTomorrow };
    default: return undefined;
  }
}
