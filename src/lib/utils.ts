import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...values: ClassValue[]) { return twMerge(clsx(values)); }
export function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }
export function formatDate(value: Date | string | null | undefined, timeZone = "Asia/Kolkata") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(new Date(value));
}
