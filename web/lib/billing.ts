import { PRO_PLAN_SLUG } from "./constants";

interface BillingSubscription {
  plan?: { slug?: string };
  status?: string;
}

/**
 * Returns true when the Clerk user has an active pro subscription (including trial).
 */
export async function userHasProPlan(userId: string): Promise<boolean> {
  if (process.env["SKIP_BILLING_CHECK"] === "1") {
    return true;
  }

  const secret = process.env["CLERK_SECRET_KEY"];
  if (!secret) {
    return false;
  }

  try {
    const response = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/billing/subscription`,
      {
        headers: {
          Authorization: `Bearer ${secret}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      return false;
    }

    const sub = (await response.json()) as BillingSubscription;
    const slug = sub.plan?.slug;
    const status = sub.status;
    return (
      slug === PRO_PLAN_SLUG &&
      (status === "active" || status === "trialing" || status === "past_due")
    );
  } catch {
    return false;
  }
}

/**
 * Resolves plan slug for whoami display.
 */
export async function userPlanSlug(userId: string): Promise<string | undefined> {
  const hasPro = await userHasProPlan(userId);
  return hasPro ? PRO_PLAN_SLUG : undefined;
}
