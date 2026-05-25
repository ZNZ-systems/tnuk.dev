import { ClerkProvider } from "@clerk/clerk-react";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./app.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/billing"
      signUpFallbackRedirectUrl="/billing"
    >
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ClerkProvider>
  </StrictMode>,
);
