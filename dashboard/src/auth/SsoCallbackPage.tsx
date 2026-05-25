import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";

export function SsoCallbackPage() {
  return (
    <div className="auth-loading">
      <AuthenticateWithRedirectCallback />
      <p>Completing sign-in…</p>
    </div>
  );
}
