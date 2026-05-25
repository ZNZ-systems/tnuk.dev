import type { Env } from "./env.js";

// Org subscription status, kept in KV and fed by Clerk billing webhooks.
// Per the Clerk B2B model, an active org subscription + active membership IS a
// valid seat (Clerk enforces the seat cap at invite time), so no per-seat
// counting is needed here.

export interface OrgSubscription {
  orgId: string;
  plan: string;
  /** Clerk subscription status: active | past_due | canceled | ... */
  status: string;
  seatQuantity?: number;
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
export async function orgHasActiveSeat(env: Env, orgId: string): Promise<boolean> {
  const sub = await getOrgSubscription(env, orgId);
  if (!sub) return false;
  if (!ACTIVE_STATUSES.has(sub.status)) return false;
  return planMatches(sub.plan, env.REQUIRED_PLAN);
}

// ---- Device-code login state ------------------------------------------------

export interface DeviceState {
  userCode: string;
  status: "pending" | "authorized" | "consumed" | "denied";
  token?: string;
  expiresAt?: number;
  account?: string;
}

const deviceKey = (deviceCode: string) => `device:${deviceCode}`;
const userCodeKey = (userCode: string) => `usercode:${userCode}`;
const DEVICE_TTL_SECONDS = 600;

export async function createDevice(
  env: Env,
  deviceCode: string,
  userCode: string,
): Promise<void> {
  const state: DeviceState = { userCode, status: "pending" };
  await env.TNUK_KV.put(deviceKey(deviceCode), JSON.stringify(state), {
    expirationTtl: DEVICE_TTL_SECONDS,
  });
  await env.TNUK_KV.put(userCodeKey(userCode), deviceCode, {
    expirationTtl: DEVICE_TTL_SECONDS,
  });
}

export async function getDevice(env: Env, deviceCode: string): Promise<DeviceState | null> {
  const raw = await env.TNUK_KV.get(deviceKey(deviceCode));
  return raw ? (JSON.parse(raw) as DeviceState) : null;
}

export async function getDeviceByUserCode(
  env: Env,
  userCode: string,
): Promise<{ deviceCode: string; state: DeviceState } | null> {
  const deviceCode = await env.TNUK_KV.get(userCodeKey(userCode));
  if (!deviceCode) return null;
  const state = await getDevice(env, deviceCode);
  return state ? { deviceCode, state } : null;
}

export async function setDevice(
  env: Env,
  deviceCode: string,
  state: DeviceState,
): Promise<void> {
  await env.TNUK_KV.put(deviceKey(deviceCode), JSON.stringify(state), {
    expirationTtl: DEVICE_TTL_SECONDS,
  });
}
