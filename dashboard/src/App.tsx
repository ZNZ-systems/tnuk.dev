import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";

import { SignInPage } from "./auth/SignInPage.tsx";
import { SignUpPage } from "./auth/SignUpPage.tsx";
import { SsoCallbackPage } from "./auth/SsoCallbackPage.tsx";
import { authHref } from "./auth/redirect.ts";
import { ActivatePage } from "./activate/ActivatePage.tsx";
import { BillingPage } from "./billing/BillingPage.tsx";
import { AppHeader } from "./components/AppHeader.tsx";
import { AuthLoading } from "./components/AuthLoading.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { LandingPage } from "./LandingPage.tsx";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      const redirect = `${window.location.pathname}${window.location.search}`;
      window.location.replace(authHref("/sign-in", redirect));
    }
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return <AuthLoading />;
  }

  if (!isSignedIn) {
    return <AuthLoading />;
  }

  return (
    <div className="app">
      <div className="app__spotlight" aria-hidden="true" />
      <div className="app__aurora" aria-hidden="true" />
      <div className="app__grain" aria-hidden="true" />
      <AppHeader />
      <ErrorBoundary label="app-content">{children}</ErrorBoundary>
    </div>
  );
}

export function App() {
  const path = window.location.pathname;

  if (path === "/" || path === "") {
    return <LandingPage />;
  }

  if (path === "/sign-in") {
    return (
      <ErrorBoundary label="sign-in">
        <SignInPage />
      </ErrorBoundary>
    );
  }

  if (path === "/sign-up") {
    return (
      <ErrorBoundary label="sign-up">
        <SignUpPage />
      </ErrorBoundary>
    );
  }

  if (path === "/sso-callback") {
    return (
      <ErrorBoundary label="sso-callback">
        <SsoCallbackPage />
      </ErrorBoundary>
    );
  }

  if (path === "/billing") {
    return (
      <ErrorBoundary label="billing">
        <AuthGate>
          <BillingPage />
        </AuthGate>
      </ErrorBoundary>
    );
  }

  if (path === "/activate") {
    return (
      <ErrorBoundary label="activate">
        <AuthGate>
          <ActivatePage />
        </AuthGate>
      </ErrorBoundary>
    );
  }

  return <LandingPage />;
}
