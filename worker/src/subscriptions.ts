import type { Env } from "./env.js";

export interface OrgSubscription {
  orgId: string;
  plan: string;
  /** Clerk subscription status: active | past_due | canceled | ... */
  status: string;
  updatedAt: number;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const subKey = (orgId: string) => `org_sub:${orgId}`;

export async function putOrgSubscription(env: Env, sub: OrgSubscription): Promise<void> {
  await env.TNUK_KV.put(subKey(sub.orgId), JSON.stringify(sub));
}

export async function getOrgSubscription(
  env: Env,
  orgId: string,
): Promise<OrgSubscription | null> {
  const raw = await env.TNUK_KV.get(subKey(orgId));
  return raw ? (JSON.parse(raw) as OrgSubscription) : null;
}

/** Normalize so "team" and "org:team" compare equal (webhook vs has() convention). */
function planMatches(planSlug: string, required: string): boolean {
  const strip = (s: string) => s.replace(/^org:/, "");
  return strip(planSlug) === strip(required);
}

/** True when the org holds an active subscription to the required plan. */
export async function orgHasActiveSubscription(env: Env, orgId: string): Promise<boolean> {
  const sub = await getOrgSubscription(env, orgId);
  if (!sub) return false;
  if (!ACTIVE_STATUSES.has(sub.status)) return false;
  return planMatches(sub.plan, env.REQUIRED_PLAN);
}
