"use client";
import { DateText } from "@/components/date-time";
import { useState, type FormEvent } from "react";
import { Plus, Pencil, X, UserCheck, Users } from "lucide-react";
import type { Role } from "./policy";

type UserRow = { id: string; name: string; email: string; role: Role; phone: string | null; active: boolean; lastLoginAt: string | null; createdAt: string };
const labels: Record<Role, string> = { ADMIN: "Administrator", MANAGER: "Manager", SALESMAN: "Salesperson" };
export function UsersUI({ initialUsers, actorId }: { initialUsers: UserRow[]; actorId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const selected = editing && editing !== "new" ? editing : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const fields = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { name: fields.get("name"), email: fields.get("email"), role: fields.get("role"), phone: fields.get("phone") || null };
    if (fields.get("password")) body.password = fields.get("password");
    if (selected) body.active = fields.get("active") === "on";
    try {
      const response = await fetch(selected ? `/api/users/${selected.id}` : "/api/users", { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this user.");
      setUsers(current => selected ? current.map(user => user.id === result.user.id ? result.user : user) : [...current, result.user]);
      setNotice(selected ? "User access updated." : "User created. Share their temporary password securely."); setEditing(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this user."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-header"><div><span className="eyebrow">WORKSPACE</span><h1>Your team</h1><p className="muted">Give the right people the right access.</p></div><button className="btn btn-primary" onClick={() => { setEditing("new"); setError(""); }}><Plus size={16} /> Add team member</button></div>
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    <div className="stats-grid"><div className="stat-card"><span className="muted">Team members</span><strong>{users.length}</strong><Users size={20} /></div><div className="stat-card"><span className="muted">Active accounts</span><strong>{users.filter(user => user.active).length}</strong><UserCheck size={20} /></div><div className="stat-card"><span className="muted">Salespeople</span><strong>{users.filter(user => user.role === "SALESMAN" && user.active).length}</strong></div></div>
    {editing && <section className="card" aria-labelledby="user-form-title">
      <div className="section-header"><h2 id="user-form-title">{selected ? "Edit team member" : "Add team member"}</h2><button className="btn btn-ghost" aria-label="Close user editor" onClick={() => setEditing(null)}><X size={18} /></button></div>
      <form onSubmit={save} key={selected?.id ?? "new"}>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="form-grid">
          <label className="field">Full name<input className="input" name="name" defaultValue={selected?.name} required minLength={2} maxLength={100} autoFocus /></label>
          <label className="field">Email address<input className="input" name="email" type="email" defaultValue={selected?.email} required /></label>
          <label className="field">Role<select aria-label="Role" className="input" name="role" defaultValue={selected?.role ?? "SALESMAN"}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">Phone <span className="muted">(optional)</span><input className="input" name="phone" type="tel" defaultValue={selected?.phone ?? ""} maxLength={30} /></label>
          <label className="field">{selected ? "New password (leave blank to keep current)" : "Temporary password"}<input className="input" name="password" type="password" autoComplete="new-password" required={!selected} minLength={12} maxLength={128} /><span className="muted text-small">At least 12 characters. Share through a secure channel.</span></label>
          {selected && <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={selected.active} /> Active account</label>}
        </div>
        <p className="muted text-small">Administrators manage all settings. Managers manage CRM workflows. Salespeople access their assigned customers.</p>
        {selected?.id === actorId && <p className="muted text-small">Another administrator must change your own role or deactivate your account.</p>}
        <div className="form-actions"><button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : selected ? "Save changes" : "Create user"}</button></div>
      </form>
    </section>}
    <section className="card"><div className="section-header"><h2>Team directory</h2><label><span className="sr-only">Search team</span><input className="input" placeholder="Search name or email…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="table-wrap"><table><thead><tr><th>Team member</th><th>Role</th><th>Status</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase())).map(user => <tr key={user.id}><td><strong>{user.name}{user.id === actorId ? " (you)" : ""}</strong><div className="muted text-small">{user.email}</div></td><td><span className="badge">{labels[user.role]}</span></td><td><span className={`badge ${user.active ? "badge-success" : "badge-neutral"}`}>{user.active ? "Active" : "Inactive"}</span></td><td className="muted">{user.lastLoginAt ? <DateText value={user.lastLoginAt}/> : "Not yet"}</td><td><button className="btn btn-ghost" onClick={() => { setEditing(user); setError(""); }} aria-label={`Edit ${user.name}`}><Pencil size={15} /> Edit</button></td></tr>)}
      </tbody></table></div>
    </section>
  </>;
}
