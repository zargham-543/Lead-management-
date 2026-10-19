"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <Link href="/login" className="auth-brand"><span className="auth-mark">L</span><span>Lead Follow-up Tracker</span></Link>
      <span className="auth-eyebrow">{register ? "JOIN YOUR TEAM" : "WELCOME BACK"}</span>
      <h1>{register ? "Create your account" : "Sign in"}</h1>
      <p className="auth-description">{register ? "Create a member account, then ask your manager to grant manager access if needed." : "Sign in to manage your leads and follow-ups."}</p>
      <form className="auth-form" onSubmit={submit}>
        {register && <label className="f">Full name<input name="name" autoComplete="name" required minLength={2} maxLength={100}/></label>}
        <label className="f">Email<input name="email" type="email" autoComplete="email" required/></label>
        <label className="f">Password<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={12}/></label>
        {register && <small className="auth-hint">At least 12 characters, including uppercase, lowercase, and a number.</small>}
        {error && <p role="alert" className="auth-error">{error}</p>}
        <button className="btn primary auth-submit" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
      </form>
      <p className="auth-switch">{register ? "Already have an account?" : "New to the team?"}{" "}
        <button onClick={() => { setRegister(!register); setError(""); }}>{register ? "Sign in" : "Create an account"}</button>
      </p>
      {!register && <p className="auth-footnote">Your manager sets your access level after you register.</p>}
    </section>
  </main>;
}
