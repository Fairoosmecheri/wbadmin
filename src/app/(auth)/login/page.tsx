"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MessagesSquare, ShieldCheck, Waypoints } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import "@/modules/auth/auth.css";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const result = await authClient.signIn.email({ email: String(fields.get("email")), password: String(fields.get("password")), rememberMe: true });
      if (result.error) { setError(result.error.message || "Sign-in failed. Check your email and password."); return; }
      router.replace("/dashboard"); router.refresh();
    } catch { setError("Could not reach the sign-in service. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <section className="login-story">
      <div className="login-brand"><Waypoints size={30} /> <span>Reach<span className="muted"> CRM</span></span></div>
      <div><span className="eyebrow">A LITTLE MORE PERSONAL.</span><h1>Good business<br />starts with a<br /><em>conversation.</em></h1><p>Your customers, conversations, and next steps.<br />One thoughtful space to bring them together.</p></div>
      <div className="login-story-footer"><MessagesSquare size={20} /><span>Built around relationships.</span></div>
    </section>
    <section className="login-form-panel">
      <form className="login-form" onSubmit={submit}>
        <span className="eyebrow">YOUR WORKSPACE AWAITS</span><h2>Welcome back.</h2><p className="muted">Sign in to pick up where you left off.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <label className="field">Email address<input className="input" name="email" type="email" autoComplete="username" placeholder="you@business.com" required /></label>
        <label className="field">Password<input className="input" name="password" type="password" autoComplete="current-password" required minLength={1} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to workspace"}<ArrowRight size={17} /></button>
        <p className="login-help"><ShieldCheck size={16} /> Private workspace · Access by invitation</p>
        <p className="muted text-small">Need access or a password reset? Contact your administrator.</p>
      </form>
    </section>
  </main>;
}
