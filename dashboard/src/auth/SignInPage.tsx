import { useAuth, useSignIn } from "@clerk/clerk-react";
import { useEffect, useState } from "react";

import { AuthLayout } from "./AuthLayout.tsx";
import { clerkErrorMessage } from "./clerk-errors.ts";
import { OAuthButtons } from "./OAuthButtons.tsx";
import { authHref, readRedirectUrl } from "./redirect.ts";

type Step = "credentials" | "mfa";

export function SignInPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const redirectUrl = readRedirectUrl();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      window.location.replace(redirectUrl);
    }
  }, [authLoaded, isSignedIn, redirectUrl]);

  if (!isLoaded || !authLoaded) {
    return (
      <div className="auth-loading">
        <p>Loading…</p>
      </div>
    );
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    setError("");
    setWorking(true);
    try {
      const result = await signIn.create({ identifier, password });
      if (result.status === "needs_second_factor") {
        setStep("mfa");
        return;
      }
      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        window.location.replace(redirectUrl);
      }
    } catch (err) {
      setError(clerkErrorMessage(err, "Sign in failed"));
    } finally {
      setWorking(false);
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    setError("");
    setWorking(true);
    try {
      const result = await signIn.attemptSecondFactor({ strategy: "totp", code: mfaCode });
      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        window.location.replace(redirectUrl);
      }
    } catch (err) {
      setError(clerkErrorMessage(err, "Verification failed"));
    } finally {
      setWorking(false);
    }
  }

  if (step === "mfa") {
    return (
      <AuthLayout title="Two-factor authentication" subtitle="Enter the code from your authenticator app.">
        <form className="auth-form" onSubmit={handleMfa}>
          <label className="form-field">
            <span className="form-field__label">Authentication code</span>
            <input
              className="form-field__input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="form-message form-message--error">{error}</p>}
          <button type="submit" className="form-btn form-btn--primary" disabled={working || !mfaCode}>
            {working ? "Verifying…" : "Verify"}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" subtitle="Access your team dashboard and billing.">
      <OAuthButtons mode="sign-in" redirectUrl={redirectUrl} disabled={working} />
      <form className="auth-form" onSubmit={handleCredentials}>
        <label className="form-field">
          <span className="form-field__label">Email</span>
          <input
            className="form-field__input"
            type="email"
            autoComplete="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
        </label>
        <label className="form-field">
          <span className="form-field__label">Password</span>
          <input
            className="form-field__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="form-message form-message--error">{error}</p>}
        <button type="submit" className="form-btn form-btn--primary" disabled={working}>
          {working ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-card__footer">
        No account?{" "}
        <a href={authHref("/sign-up", redirectUrl)}>Create one</a>
      </p>
    </AuthLayout>
  );
}
