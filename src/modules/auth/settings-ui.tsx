"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ArrowUpRight, Globe2, Users, MessageCircle, Tags } from "lucide-react";
import type { GeneralSettings } from "./validation";

export function SettingsUI({ settings, editable }: { settings: GeneralSettings; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save settings.");
      setNotice("Business settings saved.");
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-header"><div><span className="eyebrow">MAKE IT YOURS</span><h1>Workspace settings</h1><p className="muted">The details that keep your team in sync.</p></div></div>
    <section className="card"><div className="section-header"><div><h2><Building2 size={19} /> Business preferences</h2><p className="muted">Set your workspace identity and regional defaults.</p></div><Globe2 size={22} className="muted" /></div>
      <form onSubmit={save}>
        {error && <div className="alert alert-error" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
        <fieldset disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0 }}><div className="form-grid">
          <label className="field">Business name<input className="input" name="businessName" defaultValue={settings.businessName} required maxLength={120} /></label>
          <label className="field">Timezone<input className="input" name="timezone" list="timezones" defaultValue={settings.timezone} required /><datalist id="timezones"><option>Asia/Kolkata</option><option>Asia/Dubai</option><option>Asia/Singapore</option><option>Europe/London</option><option>America/New_York</option><option>UTC</option></datalist><span className="muted text-small">Use an IANA timezone, such as Asia/Kolkata.</span></label>
          <label className="field">Default phone country<input className="input" name="defaultPhoneCountry" defaultValue={settings.defaultPhoneCountry} minLength={2} maxLength={2} pattern="[A-Za-z]{2}" required /><span className="muted text-small">Two-letter country code: IN, AE, GB, US.</span></label>
          <label className="field">Date format<select className="input" name="dateFormat" defaultValue={settings.dateFormat}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></label>
        </div>{editable && <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button></div>}</fieldset>
        {!editable && <p className="muted text-small">An administrator can update these settings.</p>}
      </form>
    </section>
    {editable && <div className="settings-links"><Link className="card" href="/settings/whatsapp"><MessageCircle size={23} /><h3>WhatsApp connection</h3><p className="muted">Check connection health, test your integration, and review webhook status.</p><span className="text-link">Manage WhatsApp <ArrowUpRight size={15} /></span></Link><Link className="card" href="/settings/customers"><Tags size={23} /><h3>Customer classifications</h3><p className="muted">Organize your customers with types, areas, sales routes, and tags.</p><span className="text-link">Manage classifications <ArrowUpRight size={15} /></span></Link><Link className="card" href="/users"><Users size={23} /><h3>Team and permissions</h3><p className="muted">Invite your team and control access to your customer workspace.</p><span className="text-link">Manage team <ArrowUpRight size={15} /></span></Link></div>}
  </>;
}
