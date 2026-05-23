import { PricingTable } from "@clerk/nextjs";

export default function PricingPage(): React.ReactNode {
  return (
    <section>
      <h1>Pricing</h1>
      <p className="muted">One plan. Unlimited reviews. 7-day free trial.</p>
      <div className="card" style={{ marginTop: "2rem" }}>
        <PricingTable for="user" />
      </div>
      <p className="muted" style={{ marginTop: "1.5rem" }}>
        Enable Clerk Billing and create a User plan with slug <code>pro</code> at $40/mo
        before this table populates in production. See <code>web/billing.json</code>.
      </p>
    </section>
  );
}
