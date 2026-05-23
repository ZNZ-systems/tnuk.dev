"use client";

import { SignedIn, SignedOut, SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

function DeviceInner(): React.ReactNode {
  const params = useSearchParams();
  const initialCode = params.get("code") ?? "";
  const [userCode, setUserCode] = useState(initialCode);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const approve = useCallback(async () => {
    const code = userCode.trim();
    if (!code) {
      return;
    }
    setStatus("working");
    try {
      const response = await fetch("/api/cli/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: code }),
      });
      if (!response.ok) {
        throw new Error("Invalid or expired code");
      }
      setStatus("done");
      setMessage("CLI authorized. Return to your terminal.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [userCode]);

  return (
    <section>
      <h1>Device login</h1>
      <p className="muted">Enter the code shown in your terminal to authorize the tnuk CLI.</p>
      <SignedOut>
        <SignIn routing="hash" />
      </SignedOut>
      <SignedIn>
        <div className="form-row">
          <input
            type="text"
            value={userCode}
            onChange={(e) => {
              setUserCode(e.target.value);
            }}
            placeholder="XXXX-XXXX"
            aria-label="Device code"
          />
          <button type="button" className="primary" onClick={() => void approve()}>
            Approve
          </button>
        </div>
        {status === "working" && <p>Approving…</p>}
        {status === "done" && <p className="success">{message}</p>}
        {status === "error" && <p className="error">{message}</p>}
      </SignedIn>
    </section>
  );
}

export default function DevicePage(): React.ReactNode {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <DeviceInner />
    </Suspense>
  );
}
