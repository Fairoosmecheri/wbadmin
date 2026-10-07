"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { humanize } from "@/lib/utils";
import type { Role } from "@/modules/auth/policy";
import type { getCatalog } from "@/modules/catalog/service";
import type { getCustomer } from "./service";
import { customerInputSchema } from "./validation";

type Customer = Awaited<ReturnType<typeof getCustomer>>;
type Props = { customer?: Customer; catalog: Awaited<ReturnType<typeof getCatalog>>; role: Role };

export function CustomerForm({ customer, catalog, role }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(customer?.whatsappOptIn ?? false);
  const [status, setStatus] = useState(customer?.status ?? "ACTIVE");
  const [tagIds, setTagIds] = useState(customer?.tags.map(t => t.tagId) ?? []);
  const [source, setSource] = useState(customer?.whatsappOptInSource ?? "");
  const back = customer ? `/customers/${customer.id}` : "/customers";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setFieldErrors({}); setConflict(false);
    const values = { ...Object.fromEntries(new FormData(event.currentTarget)), whatsappOptIn: consent, whatsappOptInSource: source, tagIds, ...(customer && { expectedUpdatedAt: new Date(customer.updatedAt).toISOString() }) };
    const result = customerInputSchema.safeParse(values);
    if (!result.success) {
      const errors = Object.fromEntries(result.error.issues.map(issue => [String(issue.path[0]), issue.message]));
      setFieldErrors(errors); setError("Please check the highlighted fields.");
      document.getElementById(`customer-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = await apiFetch<{ id: string }>(customer ? `/api/customers/${customer.id}` : "/api/customers", { method: customer ? "PUT" : "POST", body: JSON.stringify(values) });
      router.push(`/customers/${saved.id}`); router.refresh();
    } catch (e) { const message = e instanceof Error ? e.message : "Customer could not be saved."; setError(message); setConflict(message.startsWith("This customer changed")); }
    finally { setBusy(false); }
  }

  function field(name: keyof Customer, label: string, options: { type?: string; required?: boolean; placeholder?: string; maxLength?: number } = {}) {
    const value = customer?.[name];
    const dateValue = value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : "";
    return <label className="field" key={name} htmlFor={`customer-${name}`}><span>{label}{options.required && <span className="text-red-500"> *</span>}</span><input id={`customer-${name}`} name={name} className="input" type={options.type || "text"} required={options.required} maxLength={options.maxLength || 200} placeholder={options.placeholder} defaultValue={options.type === "date" ? dateValue : typeof value === "string" ? value : ""} aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name] ? `${name}-error` : undefined} />{fieldErrors[name] && <span id={`${name}-error`} className="text-xs text-red-600">{fieldErrors[name]}</span>}</label>;
  }
  function select(name: "customerTypeId" | "areaId" | "routeId" | "assignedUserId", label: string, rows: { id: string; name: string; active?: boolean }[]) {
    const current = customer?.[name];
    const options = rows.filter(row => row.active !== false || row.id === current);
    if (current && !options.some(row => row.id === current)) options.push({ id: current, name: `${customer?.assignedUser?.name || "Current selection"} (inactive)` });
    return <label className="field" htmlFor={`customer-${name}`}><span>{label}</span><select id={`customer-${name}`} name={name} className="input" defaultValue={current || ""}><option value="">Unassigned</option>{options.map(row => <option key={row.id} value={row.id}>{row.name}{row.active === false ? " (archived)" : ""}</option>)}</select></label>;
  }
  return <>
    <Link href={back} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-700"><ArrowLeft size={15} /> Back to {customer ? "customer" : "customers"}</Link>
    <div className="page-header"><div><h1>{customer ? "Edit customer" : "New customer"}</h1><p>{customer ? `Update ${customer.businessName} and keep your team in sync.` : "Start a relationship with accurate details and clear contact permission."}</p></div></div>
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="min-w-0 space-y-6">
        <section className="card p-6"><h2 className="mb-5 font-semibold text-slate-900">Business & contact</h2><div className="grid gap-4 sm:grid-cols-2">{field("businessName", "Business name", { required: true })}{field("customerCode", "Customer code", { placeholder: "Generated automatically", maxLength: 60 })}{field("contactPerson", "Contact person")}{field("email", "Email address", { type: "email" })}{field("phone", "Primary phone", { type: "tel", required: true, placeholder: "+91 98765 43210", maxLength: 60 })}{field("alternatePhone", "Alternate phone", { type: "tel", maxLength: 60 })}</div><p className="mt-3 text-xs text-slate-500">Phone numbers are validated and saved in international format. Primary numbers must be unique.</p>{customer && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">Changing the primary number clears its WhatsApp permission and reply window. Save the new number first, then record fresh consent for that number in a separate edit.</p>}</section>
        <section className="card p-6" id="assignment"><h2 className="mb-5 font-semibold text-slate-900">Classification & assignment</h2><div className="grid gap-4 sm:grid-cols-2">{select("customerTypeId", "Customer type", catalog.customerTypes)}{select("areaId", "Area", catalog.areas)}{select("routeId", "Route", catalog.routes)}{select("assignedUserId", "Assigned salesperson", catalog.users)}<label className="field"><span>Status</span><select id="customer-status" name="status" className="input" value={status} onChange={e => { const next = e.target.value as typeof status; setStatus(next); if (["DO_NOT_CONTACT", "ARCHIVED"].includes(next)) setConsent(false); }}>{["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT", ...(role === "ADMIN" ? ["ARCHIVED"] : [])].map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>{field("lastOrderDate", "Last order date", { type: "date" })}</div><fieldset className="mt-5"><legend className="mb-2 text-sm font-medium text-slate-700">Tags</legend><div className="flex flex-wrap gap-2">{catalog.tags.filter(tag => tag.active || tagIds.includes(tag.id)).map(tag => <label key={tag.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tagIds.includes(tag.id) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"}`}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={e => setTagIds(e.target.checked ? [...tagIds, tag.id] : tagIds.filter(id => id !== tag.id))} />{tag.name}{!tag.active && " (archived)"}</label>)}</div>{!catalog.tags.length && <p className="text-sm text-slate-500">No tags have been configured yet.</p>}</fieldset></section>
        <section className="card p-6"><h2 className="mb-5 font-semibold text-slate-900">Address</h2><div className="grid gap-4 sm:grid-cols-2">{field("addressLine1", "Address line 1", { maxLength: 500 })}{field("addressLine2", "Address line 2", { maxLength: 500 })}{field("city", "City")}{field("district", "District")}{field("state", "State")}{field("postalCode", "Postal code", { maxLength: 30 })}{field("country", "Country", { maxLength: 100 })}</div></section>
        <section className="card p-6"><label className="field" htmlFor="customer-notes"><span>Background notes</span><textarea id="customer-notes" name="notes" rows={4} maxLength={10000} className="input" defaultValue={customer?.notes || ""} placeholder="Useful context about this business…" /></label><p className="mt-2 text-xs text-slate-500">Use the customer timeline for dated conversation notes and follow-up updates.</p></section>
      </div>
      <aside className="min-w-0 space-y-5">
        <section className="card p-6"><h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck size={19} className="text-emerald-600" /> WhatsApp permission</h2><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1.5" checked={consent} disabled={["DO_NOT_CONTACT", "ARCHIVED"].includes(status)} onChange={e => setConsent(e.target.checked)} /><span>This customer has explicitly agreed to receive WhatsApp messages.</span></label><p className="mt-3 text-xs leading-5 text-slate-500">Only record permission the customer actually gave. Permission and withdrawals are recorded in the customer history.</p><label className="field mt-4" htmlFor="customer-whatsappOptInSource"><span>How permission was obtained{consent && " *"}</span><input id="customer-whatsappOptInSource" className="input" value={source} onChange={e => setSource(e.target.value)} required={consent} maxLength={300} list="consent-sources" placeholder="e.g. In person, signed form" aria-invalid={!!fieldErrors.whatsappOptInSource} /><datalist id="consent-sources">{["IN_PERSON", "FORM", "WEBSITE", "WHATSAPP", "IMPORT", "MANUAL", "OTHER"].map(value => <option key={value} value={value} />)}</datalist>{fieldErrors.whatsappOptInSource && <span className="text-xs text-red-600">{fieldErrors.whatsappOptInSource}</span>}</label>{!consent && <label className="field mt-4"><span>Opt-out reason</span><input name="whatsappOptOutReason" className="input" maxLength={500} defaultValue={customer?.whatsappOptOutReason || ""} placeholder="Optional reason permission was withdrawn" /></label>}</section>
        <div className="lg:sticky lg:top-6">{error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}{conflict && <button type="button" className="btn btn-secondary mt-3 w-full" onClick={() => window.location.reload()}>Reload latest customer</button>}{conflict && <p className="mt-2 text-xs">Reloading discards the unsaved changes in this form.</p>}</div>}<button type="submit" className="btn btn-primary w-full" disabled={busy || conflict}><Save size={16} />{busy ? "Saving customer…" : customer ? "Save changes" : "Create customer"}</button><Link href={back} className="btn btn-ghost mt-2 w-full">Cancel</Link></div>
      </aside>
    </form>
  </>;
}
