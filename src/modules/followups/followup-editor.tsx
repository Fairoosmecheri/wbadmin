"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { Button, Input } from "@/components/ui";
import { localDateTimeInput, zonedDateTimeToUtc } from "./dates";
import { followUpOutcomes, followUpPriorities, followUpTypes } from "./validation";
import { friendly, type CustomerOption, type FollowUpItem, type TeamMember } from "./types";

type Props = { item?: FollowUpItem; customerId?: string; timezone: string; assignees: TeamMember[]; actorId: string; actorRole: string; mode?: "edit" | "complete" | "cancel"; onClose: () => void; onSaved: () => void };
export function FollowUpEditor({ item, customerId, timezone, assignees, actorId, actorRole, mode = "edit", onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(item?.customer ?? null);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [type, setType] = useState(item?.type ?? "CALL");
  const [priority, setPriority] = useState(item?.priority ?? "NORMAL");
  const [assignedUserId, setAssignedUserId] = useState(item?.assignedUserId ?? actorId);
  const [dueAt, setDueAt] = useState(() => localDateTimeInput(item ? new Date(item.dueAt) : new Date(Date.now() + 3600000), timezone));
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (item || !customerId) return;
    let active = true;
    apiFetch<CustomerOption>(`/api/customers/${encodeURIComponent(customerId)}`).then(customer => {
      if (!active) return;
      setSelectedCustomer(customer);
      setAssignedUserId(actorRole === "SALESMAN" ? actorId : customer.assignedUserId ?? actorId);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [customerId, item, actorId, actorRole]);
  useEffect(() => {
    if (item || customerId || selectedCustomer) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<{ customers: CustomerOption[] }>(`/api/customers?search=${encodeURIComponent(search)}&pageSize=15`, { signal: controller.signal })
        .then(response => setOptions(response.customers)).catch(error => { if (error.name !== "AbortError") setError(error.message); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, selectedCustomer, item, customerId]);

  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!selectedCustomer) { setError("Choose a customer before saving."); return; }
    setBusy(true);
    try {
      const data = mode === "cancel" ? { status: "CANCELLED", updatedAt: item?.updatedAt }
        : mode === "complete" ? { status: "COMPLETED", outcome, notes, updatedAt: item?.updatedAt }
        : { ...(item ? { updatedAt: item.updatedAt } : { customerId: selectedCustomer.id }), title, notes, type, priority, assignedUserId, dueAt: zonedDateTimeToUtc(dueAt, timezone).toISOString() };
      await apiFetch(item ? `/api/followups/${item.id}` : "/api/followups", { method: item ? "PATCH" : "POST", body: JSON.stringify(data) });
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the follow-up."); }
    finally { setBusy(false); }
  }
  const heading = mode === "complete" ? "Complete follow-up" : mode === "cancel" ? "Cancel follow-up" : item ? "Edit follow-up" : "Schedule a follow-up";
  return <dialog ref={dialog} aria-labelledby="followup-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-4 mb-5"><h2 id="followup-editor-title">{heading}</h2><button className="icon-btn" aria-label="Close follow-up form" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <form onSubmit={save} className="grid gap-4">
      {error && <p role="alert">{error}</p>}
      {mode === "edit" ? <>
        {selectedCustomer ? <div className="rounded-lg bg-green-50 p-3"><strong>{selectedCustomer.businessName}</strong><p className="text-muted text-xs">{selectedCustomer.contactPerson}</p>{!item && !customerId && <Button type="button" variant="ghost" onClick={() => setSelectedCustomer(null)}>Change customer</Button>}</div>
          : <div className="grid gap-2"><label className="field"><span>Find customer</span><Input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, phone or customer code" /></label><div className="followup-customer-options" aria-label="Matching customers">{options.map(customer => <button key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); setAssignedUserId(actorRole === "SALESMAN" ? actorId : customer.assignedUserId ?? actorId); }}><strong>{customer.businessName}</strong><span>{customer.contactPerson}</span></button>)}{options.length === 0 && <p className="text-muted p-3">No matching customers.</p>}</div></div>}
        <label className="field"><span>Follow-up title</span><Input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Discuss the weekly order" /></label>
        <div className="form-grid"><label className="field"><span>Type</span><select value={type} onChange={event => setType(event.target.value)}>{followUpTypes.map(value => <option key={value} value={value}>{friendly(value)}</option>)}</select></label><label className="field"><span>Priority</span><select value={priority} onChange={event => setPriority(event.target.value)}>{followUpPriorities.map(value => <option key={value} value={value}>{friendly(value)}</option>)}</select></label></div>
        <label className="field"><span>Due date and time · {timezone}</span><Input type="datetime-local" required value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
        <label className="field"><span>Assigned to</span><select required value={assignedUserId} onChange={event => setAssignedUserId(event.target.value)}>{assignees.filter(user => actorRole === "SALESMAN" ? user.id === actorId : user.role !== "SALESMAN" || user.id === selectedCustomer?.assignedUserId).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      </> : <div className="rounded-lg bg-green-50 p-3"><strong>{item?.title}</strong><p className="text-muted text-xs">{item?.customer.businessName}</p></div>}
      {mode === "complete" && <label className="field"><span>Contact outcome</span><select required value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">Choose an outcome</option>{followUpOutcomes.map(value => <option key={value} value={value}>{friendly(value)}</option>)}</select></label>}
      {mode !== "cancel" && <label className="field"><span>{mode === "complete" ? "Completion notes" : "Notes (optional)"}</span><textarea maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add context for the next conversation" /></label>}
      {mode === "cancel" && <p className="text-muted">This will close the follow-up and keep it in the customer&apos;s history. You can schedule a new follow-up later.</p>}
      <div className="flex justify-end gap-2 mt-2"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Keep editing</Button><Button type="submit" variant={mode === "cancel" ? "danger" : "primary"} disabled={busy || !selectedCustomer}>{busy ? "Saving…" : mode === "complete" ? "Save outcome & complete" : mode === "cancel" ? "Cancel follow-up" : "Save follow-up"}</Button></div>
    </form>
  </dialog>;
}
