import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

import { AuthLayout } from "./AuthLayout.tsx";
import { OAuthButtons } from "./OAuthButtons.tsx";
import { authHref, readRedirectUrl } from "./redirect.ts";

export function SignInPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const redirectUrl = readRedirectUrl();

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      window.location.replace(redirectUrl);
    }
  }, [authLoaded, isSignedIn, redirectUrl]);

  if (!authLoaded) {
    return (
      <div className="auth-loading">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <AuthLayout title="Sign in" subtitle="Sign in with GitHub to access your team dashboard and billing.">
      <OAuthButtons mode="sign-in" redirectUrl={redirectUrl} />
      <p className="auth-card__footer">
        No account?{" "}
        <a href={authHref("/sign-up", redirectUrl)}>Create one</a>
      </p>
    </AuthLayout>
  );
}
