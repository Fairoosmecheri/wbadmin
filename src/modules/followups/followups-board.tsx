"use client";
import { DateText } from "@/components/date-time";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Check, Clock3, Pencil, Plus, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { apiFetch } from "@/lib/client-api";
import { FollowUpEditor } from "./followup-editor";
import { friendly, type FollowUpItem, type FollowUpList } from "./types";
import "./followups.css";
const buckets = [{ value: "all", label: "All follow-ups" }, { value: "my", label: "My follow-ups" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }, { value: "week", label: "This week" }, { value: "upcoming", label: "Upcoming" }];
export function FollowUpsBoard({ customerId, embedded = false, openCreate = false, initialBucket = "all" }: { customerId?: string; embedded?: boolean; openCreate?: boolean; initialBucket?: string }) {
  const [data, setData] = useState<FollowUpList | null>(null);
  const [bucket, setBucket] = useState(buckets.some(b => b.value === initialBucket) ? initialBucket : "all");
  const [status, setStatus] = useState("PENDING");
  const [assignee, setAssignee] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ item?: FollowUpItem; mode?: "edit" | "complete" | "cancel" } | null>(openCreate ? {} : null);
  const [revision, setRevision] = useState(0);
  const load = useCallback((signal: AbortSignal) => {
    const query = new URLSearchParams({ bucket, status, page: String(page), ...(assignee ? { assignedUserId: assignee } : {}), ...(customerId ? { customerId } : {}) });
    return apiFetch<FollowUpList>(`/api/followups?${query}`, { signal }).then(setData).catch(error => { if (error.name !== "AbortError") setError(error.message); }).finally(() => { if (!signal.aborted) setLoading(false); });
  }, [bucket, status, page, assignee, customerId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);
  function filter(fn: () => void) { fn(); setPage(1); setLoading(true); setError(""); }
  const actions = <Button onClick={() => setEditor({})} disabled={!data}><Plus size={16} /> Add follow-up</Button>;
  return <div className="followups-board">
    {embedded ? <div className="flex items-center justify-between gap-3 mb-4"><div><h2>Customer follow-ups</h2><p className="text-muted text-xs">Keep the next action clear.</p></div>{actions}</div> : <PageHeader title="Follow-ups" description="A clear next step for every customer. Plan, connect, and keep the conversation moving.">{actions}</PageHeader>}
    {error && <div role="alert" className="mb-4">{error}<Button variant="ghost" onClick={() => { setError(""); setLoading(true); setRevision(value => value + 1); }}>Retry</Button></div>}
    {notice && <p role="status" className="success-message mb-4">{notice}</p>}
    {!embedded && data && <div className="followup-summary">{buckets.slice(2).map(item => <button key={item.value} className={`followup-summary-card ${bucket === item.value ? "selected" : ""}`} onClick={() => filter(() => setBucket(item.value))}><span>{item.label}{item.value === "overdue" ? <Clock3 size={16} /> : <CalendarCheck2 size={16} />}</span><strong>{data.counts[item.value] ?? 0}</strong><small>Pending follow-ups</small></button>)}</div>}
    {customerId && !embedded && <p className="text-muted mb-4 text-sm">Showing this customer&apos;s follow-ups. <Link className="text-brand underline" href="/followups">View all customers</Link></p>}
    <Card>
      <div className="followup-toolbar"><div className="followup-tabs" aria-label="Follow-up period">{buckets.map(item => <button key={item.value} aria-pressed={bucket === item.value} className={bucket === item.value ? "selected" : ""} onClick={() => filter(() => setBucket(item.value))}>{item.label}</button>)}</div><div className="flex gap-2 flex-wrap"><label className="field"><span className="sr-only">Follow-up status</span><select aria-label="Follow-up status" value={status} onChange={event => filter(() => setStatus(event.target.value))}><option value="PENDING">Pending</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option><option value="ALL">All statuses</option></select></label>{data?.actorRole !== "SALESMAN" && bucket !== "my" && <label className="field"><span className="sr-only">Filter by teammate</span><select aria-label="Filter by teammate" value={assignee} onChange={event => filter(() => setAssignee(event.target.value))}><option value="">Everyone</option>{data?.assignees.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}</div></div>
      {loading ? <div className="p-8 text-muted" role="status">Loading follow-ups…</div> : !data?.items.length ? <EmptyState title="You’re all caught up" description="No follow-ups match this view. Schedule the next conversation or choose another period." /> : <div className="followup-items">{data.items.map(item => <article key={item.id} className="followup-item"><div className={`followup-type ${item.priority === "URGENT" ? "urgent" : ""}`}><CalendarCheck2 size={20} /></div><div className="followup-item-main"><div className="flex items-center flex-wrap gap-2"><h3>{item.title}</h3><Badge tone={item.priority === "URGENT" ? "danger" : item.priority === "HIGH" ? "warning" : "neutral"}>{friendly(item.priority)}</Badge>{item.status !== "PENDING" && <Badge tone={item.status === "COMPLETED" ? "success" : "neutral"}>{friendly(item.status)}</Badge>}</div><Link className="followup-customer-name" href={`/customers/${item.customer.id}`}>{item.customer.businessName}</Link><p className="followup-meta"><span><DateText value={item.dueAt} includeTime/></span><span>{friendly(item.type)}</span><span>{item.assignedUser.name}</span></p>{item.notes && <p className="followup-notes">{item.notes}</p>}{item.outcome && <p className="text-brand text-xs mt-2">Outcome: {friendly(item.outcome)}</p>}</div>{item.status === "PENDING" && <div className="followup-item-actions"><Button variant="secondary" onClick={() => setEditor({ item, mode: "complete" })}><Check size={14} /> Complete</Button><button className="icon-btn" title="Edit follow-up" aria-label={`Edit ${item.title}`} onClick={() => setEditor({ item })}><Pencil size={15} /></button><button className="icon-btn" title="Cancel follow-up" aria-label={`Cancel ${item.title}`} onClick={() => setEditor({ item, mode: "cancel" })}><X size={15} /></button></div>}</article>)}</div>}
      <div className="pagination"><span>{data?.total ?? 0} follow-ups{data ? ` · ${data.timezone}` : ""}</span><div className="flex items-center gap-2"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => { setPage(value => value - 1); setLoading(true); }}>Previous</Button><span>Page {page} of {data?.pages ?? 1}</span><Button variant="secondary" disabled={!data || page >= data.pages || loading} onClick={() => { setPage(value => value + 1); setLoading(true); }}>Next</Button></div></div>
    </Card>
    {editor && data && <FollowUpEditor {...editor} customerId={customerId} timezone={data.timezone} assignees={data.assignees} actorId={data.actorId} actorRole={data.actorRole} onClose={() => setEditor(null)} onSaved={() => { setNotice(editor.mode === "complete" ? "Outcome recorded and follow-up completed." : editor.mode === "cancel" ? "Follow-up cancelled. Its history has been preserved." : "Follow-up saved."); setEditor(null); setLoading(true); setRevision(value => value + 1); }} />}
  </div>;
}
