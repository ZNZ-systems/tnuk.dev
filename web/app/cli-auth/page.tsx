"use client";

import { SignedIn, SignedOut, SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

function CliAuthInner(): React.ReactNode {
  const params = useSearchParams();
  const port = params.get("port");
  const state = params.get("state");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const completeLogin = useCallback(async () => {
    if (!port || !state) {
      setStatus("error");
      setMessage("Missing port or state query parameters.");
      return;
    }

    setStatus("working");
    try {
      const issue = await fetch("/api/cli/auth/issue", { method: "POST" });
      if (!issue.ok) {
        throw new Error("Could not issue CLI token");
      }
      const body = (await issue.json()) as {
        token: string;
        userId?: string;
        email?: string;
        issuedAt?: string;
      };

      const callback = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          token: body.token,
          userId: body.userId,
          email: body.email,
          issuedAt: body.issuedAt,
        }),
      });

      if (!callback.ok) {
        throw new Error("CLI callback failed — is the terminal still waiting?");
      }

      setStatus("done");
      setMessage("Signed in. Return to your terminal.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [port, state]);

  if (!port || !state) {
    return (
      <section>
        <h1>CLI sign-in</h1>
        <p className="error">Invalid login link. Run tnuk login again from your terminal.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>Authorize tnuk CLI</h1>
      <p className="muted">Complete sign-in to link this machine to your account.</p>
      <SignedOut>
        <SignIn routing="hash" forceRedirectUrl={`/cli-auth?port=${port}&state=${state}`} />
      </SignedOut>
      <SignedIn>
        {status === "idle" && (
          <button type="button" className="primary" onClick={() => void completeLogin()}>
            Authorize CLI
          </button>
        )}
        {status === "working" && <p>Authorizing…</p>}
        {status === "done" && <p className="success">{message}</p>}
        {status === "error" && <p className="error">{message}</p>}
      </SignedIn>
    </section>
  );
}

export default function CliAuthPage(): React.ReactNode {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <CliAuthInner />
    </Suspense>
  );
}
