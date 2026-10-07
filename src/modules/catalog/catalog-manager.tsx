"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowLeft, Pencil, Plus, RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import type { CatalogKind, getCatalog } from "./service";

type Catalog = Awaited<ReturnType<typeof getCatalog>>;
type Row = { id: string; name: string; active: boolean; description?: string | null; assignedUserId?: string | null; color?: string };
const sections: { kind: CatalogKind; label: string; singular: string; help: string }[] = [
  { kind: "customerTypes", label: "Customer types", singular: "customer type", help: "Describe the businesses you serve, from retailers to distributors." },
  { kind: "areas", label: "Areas", singular: "area", help: "Group customers by the locations your team covers." },
  { kind: "routes", label: "Routes", singular: "route", help: "Organize visits and give each route a responsible team member." },
  { kind: "tags", label: "Tags", singular: "tag", help: "Add flexible labels to help your team identify and segment customers." },
];

export function CatalogManager({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [kind, setKind] = useState<CatalogKind>("customerTypes");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const section = sections.find(item => item.kind === kind)!;
  const rows = (catalog[kind] as Row[]).filter(row => showArchived || row.active);
  const existing = editing && editing !== "new" ? editing : null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const body = { ...form, assignedUserId: form.assignedUserId || null, active: existing?.active ?? true };
    try { await apiFetch(`/api/catalog/${kind}${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", body: JSON.stringify(body) }); setEditing(null); setNotice(`${section.label.slice(0, -1)} saved.`); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "This item could not be saved."); } finally { setBusy(false); }
  }
  async function archive(row: Row) {
    if (row.active && !window.confirm(`Archive “${row.name}”? Existing customer history is retained; it will no longer appear as a new assignment option.`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiFetch(`/api/catalog/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify({ name: row.name, active: !row.active }) }); setNotice(`${row.name} ${row.active ? "archived" : "restored"}.`); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "This item could not be updated."); } finally { setBusy(false); }
  }
  return <>
    <Link href="/settings" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft size={15} /> Back to settings</Link>
    <div className="page-header"><div><h1>Customer settings</h1><p>Keep customer classifications consistent across your team.</p></div><button className="btn btn-primary" onClick={() => { setEditing("new"); setError(""); }}><Plus size={16} /> Add {section.singular}</button></div>
    <div className="mb-5 flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Customer settings categories">{sections.map(item => <button role="tab" aria-selected={kind === item.kind} key={item.kind} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${kind === item.kind ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} onClick={() => { setKind(item.kind); setEditing(null); setError(""); setNotice(""); }}>{item.label}</button>)}</div>
    {error && <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}{notice && <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</p>}
    {editing && <form className="card mb-5 p-6" onSubmit={save} key={`${kind}-${existing?.id || "new"}`}><h2 className="mb-4 font-semibold">{existing ? "Edit" : "New"} {section.singular}</h2><div className="grid gap-4 sm:grid-cols-2"><label className="field"><span>Name *</span><input autoFocus required maxLength={100} className="input" name="name" defaultValue={existing?.name || ""} /></label>{kind !== "areas" && <label className="field"><span>Description</span><input maxLength={500} className="input" name="description" defaultValue={existing?.description || ""} /></label>}{kind === "routes" && <label className="field"><span>Assigned salesperson</span><select className="input" name="assignedUserId" defaultValue={existing?.assignedUserId || ""}><option value="">Unassigned</option>{catalog.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}{kind === "tags" && <label className="field"><span>Color</span><select className="input" name="color" defaultValue={existing?.color || "emerald"}>{["emerald", "blue", "amber", "purple", "rose", "slate"].map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}</select></label>}</div><div className="mt-5 flex gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button></div></form>}
    <section className="card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5"><p className="text-sm text-slate-500">{section.help}</p><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived</label></div><div className="table-wrap"><table><thead><tr><th>Name</th>{kind !== "areas" && <th>Description</th>}{kind === "routes" && <th>Assigned salesperson</th>}<th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td className="font-medium">{kind === "tags" && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ({ emerald: "#059669", blue: "#2563eb", amber: "#d97706", purple: "#9333ea", rose: "#e11d48", slate: "#64748b" } as Record<string, string>)[row.color || "emerald"] }} />}{row.name}</td>{kind !== "areas" && <td>{row.description || "—"}</td>}{kind === "routes" && <td>{catalog.users.find(user => user.id === row.assignedUserId)?.name || "Unassigned"}</td>}<td><span className={`badge ${row.active ? "badge-success" : "badge-neutral"}`}>{row.active ? "Active" : "Archived"}</span></td><td><div className="flex justify-end gap-2"><button className="btn btn-ghost !p-2" aria-label={`Edit ${row.name}`} disabled={busy} onClick={() => { setEditing(row); setError(""); }}><Pencil size={15} /></button><button className="btn btn-ghost !p-2" aria-label={`${row.active ? "Archive" : "Restore"} ${row.name}`} disabled={busy} onClick={() => archive(row)}>{row.active ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div></td></tr>)}</tbody></table></div>{!rows.length && <div className="empty-state"><h3>No {section.label.toLowerCase()} yet</h3><p>Add your first {section.singular} to start organizing customers.</p></div>}</section>
  </>;
}
