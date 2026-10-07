"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bookmark, Check, Copy, Eye, Filter, Layers3, Pencil, Plus, RefreshCw, Trash2, Users, X } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { humanize } from "@/lib/utils";
import type { Role } from "@/modules/auth/policy";
import type { getCatalog } from "@/modules/catalog/service";
import type { CustomerFilter } from "@/modules/customers/filters";
import { cleanCustomerFilter, clearSegmentConditions, customerFilterUrl } from "./validation";
import type { listSavedViews, listSegments, previewSegment } from "./service";

type Segment = Awaited<ReturnType<typeof listSegments>>[number];
type SavedView = Awaited<ReturnType<typeof listSavedViews>>[number];
type Catalog = Awaited<ReturnType<typeof getCatalog>>;
type Preview = Awaited<ReturnType<typeof previewSegment>>;
type Editor = { kind: "segment" | "view"; id?: string; name: string; description: string; filter: CustomerFilter };
type Props = { segments: Segment[]; views: SavedView[]; catalog: Catalog; role: Role; initialFilter: CustomerFilter; openEditor: boolean; initialTab?: "segments" | "views" };

function describeFilter(filter: CustomerFilter, catalog: Catalog) {
  const descriptions: string[] = [];
  if (filter.customerIds) descriptions.push(`Within ${filter.customerIds.length} selected customers`);
  const lookups = [["customerTypeId", "Type", catalog.customerTypes], ["areaId", "Area", catalog.areas], ["routeId", "Route", catalog.routes], ["assignedUserId", "Salesperson", catalog.users]] as const;
  for (const [key, label, values] of lookups) {
    if (filter[key]) descriptions.push(`${label}: ${filter[key] === "unassigned" ? "unassigned" : values.find(value => value.id === filter[key])?.name || "unavailable option"}`);
  }
  if (filter.search) descriptions.push(`Search: ${filter.search}`);
  if (filter.status) descriptions.push(humanize(filter.status));
  if (filter.whatsappOptIn !== undefined) descriptions.push(filter.whatsappOptIn ? "WhatsApp opted in" : "WhatsApp not opted in");
  for (const id of filter.tagIds || []) descriptions.push(`Tag: ${catalog.tags.find(tag => tag.id === id)?.name || "unavailable tag"}`);
  if (filter.neverContacted) descriptions.push("Never contacted");
  if (filter.notContactedDays) descriptions.push(`No contact in ${filter.notContactedDays} days`);
  for (const [after, before, label] of [["lastContactedAfter", "lastContactedBefore", "Last contact"], ["lastOrderAfter", "lastOrderBefore", "Last order"], ["createdAfter", "createdBefore", "Created"]] as const) {
    if (filter[after]) descriptions.push(`${label} from ${filter[after]!.slice(0, 10)}`);
    if (filter[before]) descriptions.push(`${label} until ${filter[before]!.slice(0, 10)}`);
  }
  if (filter.includeArchived) descriptions.push("Includes archived customers");
  return descriptions.length ? descriptions : ["All accessible, unarchived customers"];
}

export function SegmentsUI({ segments, views, catalog, role, initialFilter, openEditor, initialTab }: Props) {
  const router = useRouter();
  const manageable = role !== "SALESMAN";
  const [tab, setTab] = useState<"segments" | "views">(initialTab ?? (manageable ? "segments" : "views"));
  const [editor, setEditor] = useState<Editor | null>(openEditor ? { kind: manageable ? "segment" : "view", name: "", description: "", filter: initialFilter } : null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function open(kind: Editor["kind"], row?: Segment | SavedView) {
    setEditor({ kind, id: row?.id, name: row?.name || "", description: row && "description" in row ? row.description || "" : "", filter: row ? cleanCustomerFilter(row.filterDefinition) : {} });
    setPreview(null); setError(""); setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function setFilter(key: keyof CustomerFilter, value: string | boolean | string[]) {
    if (!editor) return;
    setEditor({ ...editor, filter: { ...editor.filter, [key]: value === "" ? undefined : key === "notContactedDays" ? Number(value) : value } });
    setPreview(null);
  }
  function removeSelectionLimit() {
    if (!editor || !window.confirm("Remove the selected-customer limit? This group will include every customer matching its remaining conditions.")) return;
    setEditor({ ...editor, filter: { ...editor.filter, customerIds: undefined } });
    setPreview(null);
  }
  async function previewFilter(filter: unknown, title: string) {
    setBusy(true); setError(""); setPreview(null); setPreviewTitle(title);
    try { setPreview(await apiFetch<Preview>("/api/segments/preview", { method: "POST", body: JSON.stringify({ filterDefinition: filter }) })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not preview customers."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = editor.kind === "segment" ? "/api/segments" : "/api/saved-views";
      await apiFetch(`${path}${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PATCH" : "POST", body: JSON.stringify({ name: editor.name, ...(editor.kind === "segment" && { description: editor.description }), filterDefinition: editor.filter }) });
      setNotice(`${editor.kind === "segment" ? "Segment" : "Personal view"} ${editor.id ? "updated" : "saved"}. Its customer count will stay up to date.`);
      setTab(editor.kind === "segment" ? "segments" : "views"); setEditor(null); setPreview(null); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save your filters."); }
    finally { setBusy(false); }
  }
  async function duplicate(row: Segment) {
    setBusy(true); setError(""); setNotice("");
    try { await apiFetch(`/api/segments/${row.id}/duplicate`, { method: "POST" }); setNotice(`Created a copy of ${row.name}.`); router.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not duplicate segment."); }
    finally { setBusy(false); }
  }
  async function remove(kind: Editor["kind"], row: Segment | SavedView) {
    if (!window.confirm(`Delete ${kind === "segment" ? "segment" : "personal view"} “${row.name}”? Customer records and campaign history will be retained.`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiFetch(`/api/${kind === "segment" ? "segments" : "saved-views"}/${row.id}`, { method: "DELETE" }); setNotice(`${row.name} deleted.`); if (editor?.id === row.id) setEditor(null); setPreview(null); router.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete filters."); }
    finally { setBusy(false); }
  }

  const select = (key: keyof CustomerFilter, label: string, values: { id: string; name: string; active?: boolean }[], unassigned = false) => <label className="field" key={key}><span>{label}</span><select className="input" value={String(editor?.filter[key] ?? "")} onChange={event => setFilter(key, event.target.value)}><option value="">Any {label.toLowerCase()}</option>{unassigned && <option value="unassigned">Unassigned</option>}{values.map(value => <option key={value.id} value={value.id}>{value.name}{value.active === false ? " (inactive)" : ""}</option>)}</select></label>;
  const items = tab === "segments" ? segments : views;

  return <>
    <div className="page-header"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-700"><Layers3 size={14} /> The right customers, together</div><h1>Segments &amp; views</h1><p>Reusable customer groups that update as your relationships change.</p></div><div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => open("view")} disabled={busy}><Bookmark size={15} /> New personal view</button>{manageable && <button className="btn btn-primary" onClick={() => open("segment")} disabled={busy}><Plus size={16} /> Create segment</button>}</div></div>
    {error && <div className="mb-4" role="alert">{error}</div>}
    {notice && <div className="success-message mb-4 flex items-center gap-2" role="status"><Check size={16} />{notice}</div>}

    {editor && <section className="card mb-6">
      <div className="card-header"><div><h2>{editor.id ? "Edit" : "Create"} {editor.kind === "segment" ? "dynamic segment" : "personal view"}</h2><p>{editor.kind === "segment" ? "Share this group with your team and use it when building a campaign." : "Only you can see and manage this saved customer view."}</p></div><button type="button" className="icon-btn" aria-label="Close filter editor" disabled={busy} onClick={() => { setEditor(null); setPreview(null); }}><X size={18} /></button></div>
      <form className="card-body" onSubmit={save}>
        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
          <div className="grid gap-4 sm:grid-cols-2"><label className="field"><span>Name</span><input className="input" required maxLength={100} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} placeholder={editor.kind === "segment" ? "e.g. Manjeri HoReCa" : "e.g. My customers to revisit"} /></label>{editor.kind === "segment" && <label className="field"><span>Description <span className="font-normal text-slate-400">(optional)</span></span><input className="input" maxLength={1000} value={editor.description} onChange={event => setEditor({ ...editor, description: event.target.value })} placeholder="What makes this group useful?" /></label>}</div>
          {editor.filter.customerIds && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"><div><strong className="text-sm text-amber-900">Limited to {editor.filter.customerIds.length} selected customers</strong><p className="mt-1 text-xs text-amber-800">The conditions below narrow this selection. Editing or clearing conditions keeps this limit.</p></div><button type="button" className="btn btn-secondary" onClick={removeSelectionLimit}>Remove selection limit</button></div>}
          <div className="my-5 flex items-center gap-2 border-t border-slate-100 pt-5"><Filter size={15} className="text-emerald-700" /><h3>Match all selected conditions</h3></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="field"><span>Name, phone, code or email</span><input className="input" maxLength={200} value={editor.filter.search || ""} onChange={event => setFilter("search", event.target.value)} placeholder="Any customer" /></label>
            {select("customerTypeId", "Customer type", catalog.customerTypes, true)}{select("areaId", "Area", catalog.areas, true)}{select("routeId", "Route", catalog.routes, true)}{manageable && select("assignedUserId", "Salesperson", catalog.users, true)}
            {select("status", "Status", ["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT", "ARCHIVED"].map(id => ({ id, name: humanize(id) })))}
            <label className="field"><span>WhatsApp permission</span><select className="input" value={editor.filter.whatsappOptIn === undefined ? "" : String(editor.filter.whatsappOptIn)} onChange={event => setFilter("whatsappOptIn", event.target.value === "" ? "" : event.target.value === "true")}><option value="">Any permission</option><option value="true">Opted in</option><option value="false">Not opted in</option></select></label>
            <label className="field"><span>No contact in the last (days)</span><input className="input" type="number" min={1} max={36500} value={editor.filter.notContactedDays || ""} onChange={event => setFilter("notContactedDays", event.target.value)} placeholder="e.g. 45" /><small className="text-muted">Also includes customers never contacted.</small></label>
            {[["lastContactedAfter", "Last contacted from"], ["lastContactedBefore", "Last contacted until"], ["lastOrderAfter", "Last order from"], ["lastOrderBefore", "Last order until"], ["createdAfter", "Created from"], ["createdBefore", "Created until"]].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input className="input" type="date" value={String(editor.filter[key as keyof CustomerFilter] || "").slice(0, 10)} onChange={event => setFilter(key as keyof CustomerFilter, event.target.value)} /></label>)}
          </div>
          {!!catalog.tags.length && <fieldset className="mt-5 rounded-lg border border-slate-100 px-4 py-3"><legend className="px-1 text-xs font-semibold">Must have all selected tags</legend><div className="flex flex-wrap gap-x-5 gap-y-3">{catalog.tags.map(tag => <label className="flex items-center gap-2" key={tag.id}><input type="checkbox" checked={editor.filter.tagIds?.includes(tag.id) || false} onChange={event => setFilter("tagIds", event.target.checked ? [...editor.filter.tagIds || [], tag.id] : (editor.filter.tagIds || []).filter(id => id !== tag.id))} />{tag.name}{!tag.active && " (inactive)"}</label>)}</div></fieldset>}
          <div className="my-5 flex flex-wrap gap-5"><label className="flex items-center gap-2"><input type="checkbox" checked={editor.filter.neverContacted || false} onChange={event => setFilter("neverContacted", event.target.checked)} />Never contacted only</label><label className="flex items-center gap-2"><input type="checkbox" checked={editor.filter.includeArchived || false} onChange={event => setFilter("includeArchived", event.target.checked)} />Include archived customers</label></div>
          <div className="rounded-lg bg-emerald-50/70 p-3 text-xs leading-relaxed text-emerald-900"><strong>Dynamic membership.</strong> {editor.filter.customerIds ? "The selected customers are rechecked against these conditions each time. New customers do not join this selection automatically." : "Customers join or leave automatically when their information matches these conditions."} Counts always respect your customer access. Campaigns check messaging eligibility separately.</div>
          <div className="mt-5 flex flex-wrap items-center gap-2"><button type="button" className="btn btn-secondary" onClick={() => previewFilter(editor.filter, editor.name || "Unsaved filters")}><Eye size={15} /> Preview customers</button><button type="submit" className="btn btn-primary"><Check size={15} /> {editor.id ? "Save changes" : editor.kind === "segment" ? "Save segment" : "Save personal view"}</button><button type="button" className="btn btn-ghost" onClick={() => { setEditor({ ...editor, filter: clearSegmentConditions(editor.filter) }); setPreview(null); }}>Clear conditions</button></div>
        </fieldset>
      </form>
    </section>}

    {busy && <div className="mb-4 flex items-center gap-2 text-sm text-muted" role="status"><RefreshCw className="animate-spin" size={15} />Updating customer groups…</div>}
    {preview && <section className="card mb-6" aria-label="Segment preview"><div className="card-header"><div><h2>{previewTitle}</h2><p><strong>{preview.total.toLocaleString()}</strong> matching customers right now. Showing up to {preview.customers.length}.</p></div><div className="flex items-center gap-2"><Link className="btn btn-secondary" href={customerFilterUrl(preview.filterDefinition)}>View all <ArrowUpRight size={14} /></Link><button type="button" className="icon-btn" aria-label="Close preview" onClick={() => setPreview(null)}><X size={17} /></button></div></div>{preview.customers.length ? <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Type &amp; area</th><th>Salesperson</th><th>WhatsApp</th></tr></thead><tbody>{preview.customers.map(customer => <tr key={customer.id}><td><Link className="font-semibold text-emerald-800" href={`/customers/${customer.id}`}>{customer.businessName}</Link><small>{customer.customerCode} · {customer.phoneNormalized}</small></td><td>{customer.customerType?.name || "No type"}<small>{customer.area?.name || "No area"}</small></td><td>{customer.assignedUser?.name || "Unassigned"}</td><td><span className={`badge ${customer.whatsappOptIn ? "badge-success" : "badge-warning"}`}>{customer.whatsappOptIn ? "Opted in" : "Not opted in"}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>No matching customers yet</h3><p>Try broader conditions. This group will fill as customers match your filters.</p></div>}</section>}

    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1" role="tablist" aria-label="Customer group type">{manageable && <button role="tab" id="segments-tab" aria-selected={tab === "segments"} aria-controls="groups-panel" className={`btn border-0 ${tab === "segments" ? "bg-emerald-50 text-emerald-800" : "btn-ghost"}`} onClick={() => setTab("segments")}><Layers3 size={14} /> Team segments <span className="badge">{segments.length}</span></button>}<button role="tab" id="views-tab" aria-selected={tab === "views"} aria-controls="groups-panel" className={`btn border-0 ${tab === "views" ? "bg-emerald-50 text-emerald-800" : "btn-ghost"}`} onClick={() => setTab("views")}><Bookmark size={14} /> My views <span className="badge">{views.length}</span></button></div><span className="flex items-center gap-1.5 text-xs text-muted"><RefreshCw size={12} /> Live customer counts</span></div>
    <div id="groups-panel" role="tabpanel" aria-labelledby={tab === "segments" ? "segments-tab" : "views-tab"}>
      {items.length ? <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{items.map(row => <article className="card flex flex-col" key={row.id}>
        <div className="flex-1 p-5"><div className="mb-4 flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">{tab === "segments" ? <Layers3 size={19} /> : <Bookmark size={18} />}</span><span className="badge badge-success">{tab === "segments" ? "Dynamic" : "Only you"}</span></div><h2 className="break-words">{row.name}</h2>{"description" in row && row.description && <p className="mt-2 break-words text-xs leading-relaxed text-muted">{row.description}</p>}<div className="my-4 flex items-baseline gap-2"><strong className="text-3xl tracking-tight text-slate-800">{row.count.toLocaleString()}</strong><span className="flex items-center gap-1 text-xs text-muted"><Users size={12} /> customers</span></div><div className="flex flex-wrap gap-1.5">{describeFilter(cleanCustomerFilter(row.filterDefinition), catalog).map((description, index) => <span key={index} className="rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-600">{description}</span>)}</div>{"createdByUser" in row && <p className="mt-4 text-[10px] text-muted">Created by {row.createdByUser.name}</p>}</div>
        <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 p-3"><Link className="btn btn-ghost" href={`/customers?${tab === "segments" ? "segmentId" : "viewId"}=${encodeURIComponent(row.id)}`}>Open customers <ArrowUpRight size={13} /></Link><button className="icon-btn" aria-label={`Preview ${row.name}`} title="Preview customers" disabled={busy} onClick={() => { setEditor(null); void previewFilter(row.filterDefinition, row.name); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Eye size={16} /></button>{(manageable || tab === "views") && <><button className="icon-btn" aria-label={`Edit ${row.name}`} title="Edit" disabled={busy} onClick={() => open(tab === "segments" ? "segment" : "view", row)}><Pencil size={15} /></button>{tab === "segments" && <button className="icon-btn" aria-label={`Duplicate ${row.name}`} title="Duplicate" disabled={busy} onClick={() => duplicate(row as Segment)}><Copy size={15} /></button>}<button className="icon-btn" aria-label={`Delete ${row.name}`} title="Delete" disabled={busy} onClick={() => remove(tab === "segments" ? "segment" : "view", row)}><Trash2 size={15} /></button></>}</div>
      </article>)}</div> : <section className="card empty-state"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">{tab === "segments" ? <Layers3 size={26} /> : <Bookmark size={25} />}</div><h3>{tab === "segments" ? "Your next great customer group starts here" : "Keep your favorite filters close"}</h3><p>{tab === "segments" ? "Combine location, customer type, tags and contact history into a reusable group." : "Save the customer filters you use most often. These views are personal to you."}</p>{(manageable || tab === "views") && <button className="btn btn-primary" onClick={() => open(tab === "segments" ? "segment" : "view")}><Plus size={15} />{tab === "segments" ? "Create your first segment" : "Create a personal view"}</button>}</section>}
    </div>
  </>;
}
