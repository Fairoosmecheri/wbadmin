"use client";
import { DateText } from "@/components/date-time";
import { useEffect, useState, type FormEvent } from "react";
import { CalendarCheck2, Check, Clock3, FileText, MessageCircle, Pencil, Plus, Send, UserRound } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { Button, Card, EmptyState } from "@/components/ui";
import { FollowUpsBoard } from "@/modules/followups/followups-board";
import "./timeline.css";

type TimelineEntry = { id: string; kind: string; title: string; description: string; actorName: string | null; occurredAt: string };
type TimelinePage = { items: TimelineEntry[]; total: number; pages: number; timezone: string };
type Note = { id: string; content: string; createdAt: string; updatedAt: string; createdByUser: { name: string }; canEdit: boolean };
type NotesPage = { items: Note[]; total: number; pages: number; timezone: string };
type Tab = "activity" | "notes" | "followups";
function TimelineIcon({ kind }: { kind: string }) {
  if (kind.includes("READ") || kind.includes("DELIVERED")) return <Check size={16} />;
  if (kind.includes("NOTE")) return <FileText size={16} />;
  if (kind.includes("FOLLOWUP")) return <CalendarCheck2 size={16} />;
  if (kind.includes("CAMPAIGN")) return <Send size={16} />;
  if (kind.includes("MESSAGE") || kind.includes("REPLY")) return <MessageCircle size={16} />;
  return <UserRound size={16} />;
}
function ActivityTimeline({ customerId }: { customerId: string }) {
  const [data, setData] = useState<TimelinePage | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TimelinePage>(`/api/customers/${customerId}/timeline?page=${page}`, { signal: controller.signal }).then(setData)
      .catch(error => { if (error.name !== "AbortError") setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [customerId, page, revision]);
  return <Card><div className="card-header"><div><h2>Customer activity</h2><p>Conversations, notes, campaigns, and follow-ups in one place.</p></div><Clock3 size={18} className="text-muted" /></div>
    {error && <p role="alert" className="m-4">{error}<Button variant="ghost" onClick={() => { setError(""); setLoading(true); setRevision(value => value + 1); }}>Retry</Button></p>}
    {loading ? <p className="p-6 text-muted" role="status">Loading activity…</p> : !data?.items.length ? <EmptyState title="The conversation starts here" description="Add a note or schedule a follow-up to record the next step." /> : <ol className="customer-timeline">{data.items.map(entry => <li key={entry.id}><span className="timeline-marker"><TimelineIcon kind={entry.kind} /></span><div className="timeline-content"><div className="timeline-heading"><h3>{entry.title}</h3><DateText value={entry.occurredAt} includeTime/></div><p>{entry.description}</p>{entry.actorName && <small>{entry.actorName}</small>}</div></li>)}</ol>}
    <div className="pagination"><span>{data?.total ?? 0} activities · Newest first{data ? ` · ${data.timezone}` : ""}</span><div className="flex items-center gap-2"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => { setPage(value => value - 1); setLoading(true); }}>Newer</Button><span>{page} / {data?.pages ?? 1}</span><Button variant="secondary" disabled={!data || page >= data.pages || loading} onClick={() => { setPage(value => value + 1); setLoading(true); }}>Older</Button></div></div>
  </Card>;
}
function CustomerNotes({ customerId }: { customerId: string }) {
  const [data, setData] = useState<NotesPage | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [editContent, setEditContent] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<NotesPage>(`/api/customers/${customerId}/notes?page=${page}`, { signal: controller.signal }).then(setData)
      .catch(error => { if (error.name !== "AbortError") setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [customerId, page, revision]);
  async function save(event: FormEvent, note?: Note) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/api/customers/${customerId}/notes${note ? `/${note.id}` : ""}`, { method: note ? "PATCH" : "POST", body: JSON.stringify({ content: note ? editContent : content, ...(note ? { updatedAt: note.updatedAt } : {}) }) });
      if (note) setEditing(null); else { setContent(""); setPage(1); }
      setNotice(note ? "Note updated. The edit is recorded in the activity timeline." : "Note added to the customer timeline."); setLoading(true); setRevision(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the note."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-4" id="customer-notes">
    <Card><div className="card-header"><div><h2>Add a customer note</h2><p>Capture useful context for the next conversation.</p></div><FileText size={18} className="text-muted" /></div><form className="card-body grid gap-3" onSubmit={event => save(event)}><label className="field"><span>Note</span><textarea id="new-customer-note" placeholder="What should the team know about this customer?" required maxLength={10000} value={content} onChange={event => setContent(event.target.value)} /></label><div className="flex justify-end"><Button disabled={busy || !content.trim()} type="submit"><Plus size={15} />{busy && !editing ? "Saving…" : "Add note"}</Button></div></form></Card>
    {error && <p role="alert">{error}<Button variant="ghost" onClick={() => { setError(""); setLoading(true); setRevision(value => value + 1); }}>Refresh notes</Button></p>}{notice && <p role="status" className="success-message">{notice}</p>}
    <Card><div className="card-header"><div><h2>Notes</h2><p>Authors and administrators can edit notes. Notes stay in the customer history.</p></div><span className="badge">{data?.total ?? 0}</span></div>
      {loading ? <p className="p-6 text-muted" role="status">Loading notes…</p> : !data?.items.length ? <EmptyState title="Make the next conversation personal" description="Keep preferences, visit details and important context in a note." /> : <div>{data.items.map(note => <article key={note.id} className="customer-note"><div className="flex items-start justify-between gap-3"><div><strong>{note.createdByUser.name}</strong><small><DateText value={note.createdAt} includeTime/>{note.updatedAt !== note.createdAt && <> · Edited <DateText value={note.updatedAt} includeTime/></>}</small></div>{note.canEdit && editing?.id !== note.id && <button className="icon-btn" aria-label={`Edit note by ${note.createdByUser.name}`} onClick={() => { setEditing(note); setEditContent(note.content); }}><Pencil size={15} /></button>}</div>{editing?.id === note.id ? <form onSubmit={event => save(event, note)} className="grid gap-3 mt-3"><label className="field"><span>Edit note</span><textarea required maxLength={10000} value={editContent} onChange={event => setEditContent(event.target.value)} /></label><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel edit</Button><Button type="submit" disabled={busy || !editContent.trim()}>{busy ? "Saving…" : "Save changes"}</Button></div></form> : <p>{note.content}</p>}</article>)}</div>}
      <div className="pagination"><span>Page {page} of {data?.pages ?? 1}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => { setPage(value => value - 1); setLoading(true); }}>Previous</Button><Button variant="secondary" disabled={!data || page >= data.pages || loading} onClick={() => { setPage(value => value + 1); setLoading(true); }}>Next</Button></div></div>
    </Card>
  </div>;
}
export function CustomerWorkspace({ customerId }: { customerId: string }) {
  const [tab, setTab] = useState<Tab>("activity");
  useEffect(() => {
    const update = () => { if (window.location.hash === "#customer-notes") setTab("notes"); else if (window.location.hash === "#customer-followups") setTab("followups"); };
    const timer = setTimeout(update, 0);
    window.addEventListener("hashchange", update);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", update); };
  }, []);
  return <section id="customer-workspace" className="customer-workspace"><nav className="tabs" aria-label="Customer workspace">{([{ id: "activity", title: "Activity", icon: Clock3 }, { id: "notes", title: "Notes", icon: FileText }, { id: "followups", title: "Follow-ups", icon: CalendarCheck2 }] as const).map(item => <button key={item.id} className={`flex items-center gap-2 ${tab === item.id ? "active" : ""}`} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); window.history.replaceState(null, "", `#customer-${item.id}`); }}><item.icon size={15} />{item.title}</button>)}</nav>
    {tab === "activity" && <ActivityTimeline customerId={customerId} />}{tab === "notes" && <CustomerNotes customerId={customerId} />}{tab === "followups" && <div id="customer-followups"><FollowUpsBoard customerId={customerId} embedded /></div>}
  </section>;
}
