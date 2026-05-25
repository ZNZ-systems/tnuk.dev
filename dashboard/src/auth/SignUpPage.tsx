import { useAuth, useSignUp } from "@clerk/clerk-react";
import { useEffect, useState } from "react";

import { AuthLayout } from "./AuthLayout.tsx";
import { clerkErrorMessage } from "./clerk-errors.ts";
import { OAuthButtons } from "./OAuthButtons.tsx";
import { authHref, readRedirectUrl } from "./redirect.ts";

type Step = "register" | "verify";

export function SignUpPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signUp, setActive } = useSignUp();
  const redirectUrl = readRedirectUrl();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("register");
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

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!signUp) return;
    setError("");
    setWorking(true);
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify");
    } catch (err) {
      setError(clerkErrorMessage(err, "Sign up failed"));
    } finally {
      setWorking(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!signUp) return;
    setError("");
    setWorking(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
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

  if (step === "verify") {
    return (
      <AuthLayout title="Verify your email" subtitle={`We sent a code to ${email}.`}>
        <form className="auth-form" onSubmit={handleVerify}>
          <label className="form-field">
            <span className="form-field__label">Verification code</span>
            <input
              className="form-field__input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </label>
          {error && <p className="form-message form-message--error">{error}</p>}
          <button type="submit" className="form-btn form-btn--primary" disabled={working || !code}>
            {working ? "Verifying…" : "Verify email"}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create account" subtitle="Start your team on tnuk.">
      <OAuthButtons mode="sign-up" redirectUrl={redirectUrl} disabled={working} />
      <form className="auth-form" onSubmit={handleRegister}>
        <label className="form-field">
          <span className="form-field__label">Email</span>
          <input
            className="form-field__input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="form-field">
          <span className="form-field__label">Password</span>
          <input
            className="form-field__input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="form-message form-message--error">{error}</p>}
        <button type="submit" className="form-btn form-btn--primary" disabled={working}>
          {working ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="auth-card__footer">
        Already have an account?{" "}
        <a href={authHref("/sign-in", redirectUrl)}>Sign in</a>
      </p>
    </AuthLayout>
  );
}
