import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

import { AuthLayout } from "./AuthLayout.tsx";
import { OAuthButtons } from "./OAuthButtons.tsx";
import { authHref, readRedirectUrl } from "./redirect.ts";

export function SignUpPage() {
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
    <AuthLayout title="Create account" subtitle="Sign up with GitHub to start your team on tnuk.">
      <OAuthButtons mode="sign-up" redirectUrl={redirectUrl} />
      <p className="auth-card__footer">
        Already have an account?{" "}
        <a href={authHref("/sign-in", redirectUrl)}>Sign in</a>
      </p>
    </AuthLayout>
  );
}
