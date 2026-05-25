import { Webhook } from "svix";

import type { Env } from "./env.js";
import { getOrgSubscription, putOrgSubscription } from "./subscriptions.js";

// Clerk billing payloads are nested: the payer is under data.payer, the plan
// under data.items[i].plan.slug, the subscription id is data.id.
interface ClerkBillingEvent {
  type: string;
  data: {
    id: string;
    status?: string;
    payer?: { user_id?: string; organization_id?: string };
    items?: Array<{ plan?: { slug?: string }; status?: string }>;
    plan?: { slug?: string };
  };
}

async function verify(req: Request, secret: string): Promise<ClerkBillingEvent | null> {
  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };
  try {
    return new Webhook(secret).verify(payload, headers) as ClerkBillingEvent;
  } catch {
    return null;
  }
}

export async function handleClerkWebhook(req: Request, env: Env): Promise<Response> {
  const evt = await verify(req, env.CLERK_WEBHOOK_SECRET);
  if (!evt) return new Response("verification failed", { status: 400 });

  const orgId = evt.data.payer?.organization_id;
  if (!orgId) return new Response("ok", { status: 200 }); // not an org subscription

  const plan = evt.data.items?.[0]?.plan?.slug ?? evt.data.plan?.slug;
  const now = Date.now();

  switch (evt.type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.active": {
      await putOrgSubscription(env, {
        orgId,
        plan: plan ?? "",
        status: evt.data.status ?? "active",
        updatedAt: now,
      });
      break;
    }
    case "subscription.pastDue":
    case "subscription.canceled":
    case "subscription.ended":
    case "subscription.expired": {
      await markStatus(env, orgId, evt.data.status ?? "canceled", now);
      break;
    }
    case "subscriptionItem.pastDue": {
      await markStatus(env, orgId, "past_due", now);
      break;
    }
    // Per-seat item teardown must not cancel org-wide access; org status comes from subscription.* only.
    case "subscriptionItem.canceled":
    case "subscriptionItem.ended":
      break;
    default:
      break;
  }

  return new Response("ok", { status: 200 });
}

async function markStatus(env: Env, orgId: string, status: string, now: number): Promise<void> {
  const existing = await getOrgSubscription(env, orgId);
  await putOrgSubscription(env, {
    orgId,
    plan: existing?.plan ?? "",
    status,
    updatedAt: now,
  });
}
