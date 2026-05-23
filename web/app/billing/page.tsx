import { auth } from "@clerk/nextjs/server";
import { PricingTable } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { userHasProPlan } from "@/lib/billing";

export default async function BillingPage(): Promise<React.ReactNode> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/pricing");
  }

  const hasPro = await userHasProPlan(userId);

  return (
    <section>
      <h1>Billing</h1>
      {hasPro ? (
        <p className="muted">
          Your Pro subscription is active. Manage payment method and invoices from the
          account menu → Billing, or cancel anytime.
        </p>
      ) : (
        <>
          <p className="muted">Subscribe to run tnuk reviews on every push.</p>
          <div className="card" style={{ marginTop: "1.5rem" }}>
            <PricingTable for="user" />
          </div>
        </>
      )}
    </section>
  );
}
