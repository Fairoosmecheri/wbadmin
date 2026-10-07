"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { humanize } from "@/lib/utils";
import type { Role } from "@/modules/auth/policy";

export function CustomerActions({ id, status, role }: { id: string; status: string; role: Role }) {
  const router = useRouter();
  const [value, setValue] = useState(status), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function update(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiFetch(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify({ status: value }) }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Status could not be updated."); } finally { setBusy(false); }
  }
  async function archive() {
    if (!window.confirm("Archive this customer? Their history will remain available and marketing messages will stop.")) return;
    setBusy(true); setError("");
    try { await apiFetch(`/api/customers/${id}`, { method: "DELETE" }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Customer could not be archived."); } finally { setBusy(false); }
  }
  if (status === "ARCHIVED") return <p className="text-sm text-slate-500">This customer is archived.{role === "ADMIN" ? " Edit the customer to restore an active status." : " An administrator can restore them."}</p>;
  return <div><form onSubmit={update} className="flex flex-wrap items-end gap-2"><label className="field flex-1"><span>Customer status</span><select className="input" value={value} onChange={e => setValue(e.target.value)}>{["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT"].map(item => <option key={item} value={item}>{humanize(item)}</option>)}</select></label><button className="btn btn-secondary" disabled={busy || value === status}>{busy ? "Saving…" : "Update status"}</button></form>{role === "ADMIN" && <button className="mt-4 text-sm text-red-600 hover:underline" type="button" disabled={busy} onClick={archive}>Archive customer</button>}{error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}</div>;
}
