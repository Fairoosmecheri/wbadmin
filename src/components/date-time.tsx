"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatWorkspaceDate, type DateDisplayOptions, type WorkspaceDateSettings } from "@/lib/date-time";

const WorkspaceSettingsContext = createContext<WorkspaceDateSettings>({ timezone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY" });

export function WorkspaceSettingsProvider({ settings, children }: { settings: WorkspaceDateSettings; children: ReactNode }) {
  return <WorkspaceSettingsContext.Provider value={settings}>{children}</WorkspaceSettingsContext.Provider>;
}

export function DateText({ value, includeTime, timeOnly, calendarDate }: { value: Date | string | null | undefined } & DateDisplayOptions) {
  const settings = useContext(WorkspaceSettingsContext);
  const formatted = formatWorkspaceDate(value, settings, { includeTime, timeOnly, calendarDate });
  if (formatted === "—") return <>—</>;
  const iso = new Date(value!).toISOString();
  return <time dateTime={calendarDate ? iso.slice(0, 10) : iso} title={calendarDate ? undefined : settings.timezone}>{formatted}</time>;
}
