import { useAuth, useOrganization } from "@clerk/clerk-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { AuthLoading } from "../components/AuthLoading.tsx";
import { easeOut, fadeUp, staggerContainer } from "../motion.ts";

const API_URL = import.meta.env.VITE_API_URL as string;

export function ActivatePage() {
  const { getToken } = useAuth();
  const { isLoaded, organization } = useOrganization();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    setMessage("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/auth/device/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userCode: code.trim().toUpperCase() }),
      });
      if (res.ok) {
        setState("done");
        setMessage("Device authorized. Return to your terminal — the CLI is now logged in.");
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState("error");
        setMessage(body.error ?? `Failed (HTTP ${res.status}).`);
      }
    } catch {
      setState("error");
      setMessage("Network error contacting the tnuk API.");
    }
  }

  if (!isLoaded) {
    return <AuthLoading label="Loading" />;
  }

  if (!organization) {
    return (
      <motion.main
        className="app-main app-main--narrow"
        variants={staggerContainer(0.09)}
        initial="hidden"
        animate="show"
      >
        <motion.div className="state-icon" variants={fadeUp} aria-hidden="true">
          <KeyIcon />
        </motion.div>
        <motion.h1 variants={fadeUp}>Select a team</motion.h1>
        <motion.p variants={fadeUp}>
          Use the organization switcher in the header to pick the team whose subscription should grant
          this device a seat.
        </motion.p>
      </motion.main>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {state === "done" ? (
        <motion.main
          key="done"
          className="app-main app-main--narrow"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="deck">
            <div className="activate-success">
              <motion.div
                className="activate-success__ring"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 320, damping: 18 }}
              >
                <CheckDraw />
              </motion.div>
              <motion.h2
                className="activate-success__title"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4, ease: easeOut }}
              >
                Device authorized
              </motion.h2>
              <motion.p
                className="activate-success__msg"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.4, ease: easeOut }}
              >
                Return to your terminal — the CLI is now logged in for{" "}
                <strong>{organization.name}</strong>.
              </motion.p>
              <motion.span
                className="activate-success__hint"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.72, duration: 0.4, ease: easeOut }}
              >
                <span className="prompt" aria-hidden="true">
                  $
                </span>
                tnuk — logged in
              </motion.span>
            </div>
          </div>
        </motion.main>
      ) : (
        <motion.main
          key="form"
          className="app-main app-main--narrow"
          variants={staggerContainer(0.08)}
          initial="hidden"
          animate="show"
          exit={{ opacity: 0 }}
        >
          <motion.span className="app-eyebrow" variants={fadeUp}>
            Device activation
          </motion.span>
          <motion.h1 variants={fadeUp}>Activate the CLI</motion.h1>
          <motion.p variants={fadeUp}>
            Activating for <strong>{organization.name}</strong>. Enter the code shown in your terminal
            after running <code>tnuk login</code>.
          </motion.p>
          <motion.div className="deck" variants={fadeUp}>
            <form className="activate-form" onSubmit={approve}>
              <span className="activate-input">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ABCD-EFGH"
                  autoFocus
                  className="activate-input__field"
                  aria-label="Device code"
                />
                <span className="activate-input__scan" aria-hidden="true" />
              </span>
              <button
                type="submit"
                className="form-btn form-btn--primary"
                disabled={state === "working" || code.length < 8}
              >
                {state === "working" ? "Authorizing…" : "Authorize"}
              </button>
            </form>
            <AnimatePresence>
              {state === "error" && message && (
                <motion.p
                  className="activate-message activate-message--error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {message}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.main>
      )}
    </AnimatePresence>
  );
}

function CheckDraw() {
  return (
    <svg width="46" height="46" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <motion.circle
        cx="22"
        cy="22"
        r="20"
        stroke="rgba(74, 222, 128, 0.55)"
        strokeWidth="1.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: easeOut }}
      />
      <motion.path
        d="M13 22.5 L19.5 29 L31 16"
        stroke="#4ade80"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: easeOut, delay: 0.32 }}
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 7a4 4 0 1 1-3.9 5L4 19m0 0 2.5 2.5M4 19l3-3 2 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  );
}
