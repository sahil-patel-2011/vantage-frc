"use client";

import { useState } from "react";

export default function SignInClient({ googleEnabled, nextPath = "/dashboard" }: { googleEnabled: boolean; nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [mode,setMode]=useState<"otp"|"password"|"reset">("otp");
  const [password,setPassword]=useState("");

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    });
    setSent(true);
    setMessage("If the address can receive a Vantage code, it is on the way.");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, otp: code }),
    });
    if (response.ok) window.location.assign(nextPath);
    else setMessage("That code is invalid, expired, or has reached its attempt limit.");
  }

  async function google() {
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: nextPath }),
    });
    const data = await response.json();
    if (data.url) window.location.assign(data.url);
  }
  async function passwordSignIn(event:React.FormEvent){event.preventDefault();const response=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});if(response.ok)window.location.assign(nextPath);else setMessage("Unable to sign in with those credentials.");}
  async function resetPassword(event:React.FormEvent){event.preventDefault();if(!sent){await fetch("/api/auth/email-otp/request-password-reset",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});setSent(true);setMessage("If the account exists, a short-lived reset code is on the way.");return;}const response=await fetch("/api/auth/email-otp/reset-password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,otp:code,password})});setMessage(response.ok?"Password updated. Existing sessions were revoked.":"That reset code is invalid, expired, or has reached its attempt limit.");if(response.ok){setSent(false);setMode("password");}}

  return (
    <main className="auth-page">
      <section className="auth-card">
        <a className="brand" href="/">VANTAGE</a>
        <span className="eyebrow">VANTAGE / SECURE ACCESS</span>
        <h1>Sign in to your team workspace</h1>
        <p>Membership is invite-only. Signing in does not automatically join a team.</p>
        {googleEnabled && <button className="google-button" onClick={google}>Continue with Google</button>}
        <div className="auth-mode" role="tablist" aria-label="Sign-in method"><button role="tab" aria-selected={mode==="otp"} onClick={()=>{setMode("otp");setSent(false);}}>Email code</button><button role="tab" aria-selected={mode==="password"} onClick={()=>{setMode("password");setSent(false);}}>Password</button><button role="tab" aria-selected={mode==="reset"} onClick={()=>{setMode("reset");setSent(false);}}>Reset password</button></div>
        {mode==="password"?<form onSubmit={passwordSignIn}><label>Email address<input type="email" required autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)}/></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.target.value)}/></label><button className="primary-action">Sign in</button></form>:mode==="reset"?<form onSubmit={resetPassword}><label>Email address<input type="email" required autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)}/></label>{sent&&<><label>Reset code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e)=>setCode(e.target.value.replace(/\D/g,""))}/></label><label>New password<input type="password" minLength={12} required autoComplete="new-password" value={password} onChange={(e)=>setPassword(e.target.value)}/></label></>}<button className="primary-action">{sent?"Reset password":"Send reset code"}</button></form>:!sent ? (
          <form onSubmit={requestCode}>
            <label>Email address<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="primary-action">Send numeric code</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <label>6-digit code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            <button className="primary-action">Verify and sign in</button>
            <button type="button" className="text-button" onClick={() => setSent(false)}>Use another email</button>
          </form>
        )}
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  );
}
