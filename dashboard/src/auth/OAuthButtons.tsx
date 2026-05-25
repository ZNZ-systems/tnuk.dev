import { useClerk, useSignIn, useSignUp } from "@clerk/clerk-react";
import type { OAuthStrategy } from "@clerk/types";
import { useEffect, useState } from "react";

import { oauthProviderLabel, oauthStrategiesFromClerk } from "./oauth-providers.ts";

type OAuthMode = "sign-in" | "sign-up";

export function OAuthButtons({
  mode,
  redirectUrl,
  disabled,
}: {
  mode: OAuthMode;
  redirectUrl: string;
  disabled?: boolean;
}) {
  const clerk = useClerk();
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [providers, setProviders] = useState<OAuthStrategy[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clerk.loaded) return;
    setProviders(oauthStrategiesFromClerk(clerk));
  }, [clerk, clerk.loaded]);

  const ready = mode === "sign-in" ? signInLoaded : signUpLoaded;
  if (!ready || providers.length === 0) return null;

  async function startOAuth(strategy: OAuthStrategy) {
    setError("");
    setWorking(strategy);
    try {
      const callback = `${window.location.origin}/sso-callback`;
      if (mode === "sign-in" && signIn) {
        await signIn.authenticateWithRedirect({
          strategy,
          redirectUrl: callback,
          redirectUrlComplete: redirectUrl,
        });
      } else if (signUp) {
        await signUp.authenticateWithRedirect({
          strategy,
          redirectUrl: callback,
          redirectUrlComplete: redirectUrl,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth sign-in failed");
      setWorking(null);
    }
  }

  return (
    <div className="auth-oauth">
      {providers.map((strategy) => (
        <button
          key={strategy}
          type="button"
          className="auth-oauth__btn"
          disabled={disabled || working !== null}
          onClick={() => void startOAuth(strategy)}
        >
          {working === strategy ? "Redirecting…" : `Continue with ${oauthProviderLabel(strategy)}`}
        </button>
      ))}
      {error && <p className="form-message form-message--error">{error}</p>}
    </div>
  );
}
