import { SignedIn, useAuth, useOrganization } from "@clerk/clerk-react";
import {
  CheckoutButton,
  SubscriptionDetailsButton,
  useSubscription,
} from "@clerk/clerk-react/experimental";
import { motion } from "motion/react";

import { easeOut } from "../motion.ts";

const SEAT_PRICE = 40;
const TEAM_PLAN_ID = import.meta.env.VITE_CLERK_TEAM_PLAN_ID as string | undefined;
const TEAM_PLAN_SLUG = "org:team";

function billingEnabled(): boolean {
  return Boolean(TEAM_PLAN_ID?.trim());
}

export function PlanSection() {
  const { isLoaded, has } = useAuth();
  const { membership } = useOrganization();
  const { data: subscription, isLoading, error } = useSubscription({ for: "organization" });

  const isAdmin = membership?.role === "org:admin";
  const active = Boolean(has?.({ plan: TEAM_PLAN_SLUG }));

  if (!isLoaded || isLoading) {
    return (
      <section className="section">
        <p className="muted">Loading plan…</p>
      </section>
    );
  }

  if (!billingEnabled()) {
    return (
      <section className="setup">
        <h2 className="section__title">Enable Clerk billing</h2>
        <p className="muted">
          Set <code>VITE_CLERK_TEAM_PLAN_ID</code> in <code>dashboard/.env</code> to your
          organization plan ID from Clerk Dashboard → Billing → Plans → Team. Also enable org
          billing and webhooks per <code>clerk/README.md</code>.
        </p>
        <pre className="setup__cmd">{`clerk enable billing --for org
clerk config patch --file clerk/billing.json
# Dashboard → Billing → Plans → Team → copy plan ID
VITE_CLERK_TEAM_PLAN_ID=cplan_...`}</pre>
      </section>
    );
  }

  if (error) {
    return <p className="form-message form-message--error">{error.message}</p>;
  }

  const displayStatus = subscription?.status ?? (active ? "active" : "none");
  const pill = statusPill(displayStatus, active);

  return (
    <section className="section">
      <motion.div
        className="plan"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: easeOut, delay: 0.1 }}
      >
        <div className="plan__top">
          <div>
            <p className="plan__label">Team plan</p>
            <motion.div
              className="plan__price"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 24, delay: 0.22 }}
            >
              ${SEAT_PRICE}
              <small>per seat / month</small>
            </motion.div>
          </div>
          <span className={`status ${pill.cls}`}>
            <span className="status__dot" aria-hidden="true" />
            {pill.label}
          </span>
        </div>

        {isAdmin ? (
          <SignedIn>
            <div className="plan__actions">
              {!active ? (
                <CheckoutButton
                  planId={TEAM_PLAN_ID!}
                  planPeriod="month"
                  for="organization"
                  newSubscriptionRedirectUrl="/billing"
                  onSubscriptionComplete={() => window.location.reload()}
                >
                  <button type="button" className="form-btn form-btn--primary">
                    Subscribe to Team
                  </button>
                </CheckoutButton>
              ) : (
                <SubscriptionDetailsButton
                  for="organization"
                  onSubscriptionCancel={() => window.location.reload()}
                >
                  <button type="button" className="form-btn form-btn--secondary">
                    Manage billing
                  </button>
                </SubscriptionDetailsButton>
              )}
            </div>
          </SignedIn>
        ) : (
          <p className="plan__note">Only organization admins can manage the Team plan.</p>
        )}
      </motion.div>
    </section>
  );
}

function statusPill(status: string, active: boolean): { cls: string; label: string } {
  if (active || status === "active") return { cls: "status--active", label: "Active" };
  if (status === "past_due") return { cls: "status--warn", label: "Past due" };
  if (status === "trialing") return { cls: "status--trial", label: "Trialing" };
  if (status === "canceled") return { cls: "status--warn", label: "Canceled" };
  return { cls: "status--none", label: "Not subscribed" };
}
