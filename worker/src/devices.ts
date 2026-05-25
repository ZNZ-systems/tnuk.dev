import type { Env } from "./env.js";

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

export type DevicePollResult =
  | { status: "pending" | "denied" | "consumed" | "expired" }
  | { status: "authorized"; token: string; expiresAt?: number; account?: string };

/**
 * Hands off an authorized device token exactly once. Marks the device consumed
 * and strips the token from KV before returning credentials to the caller.
 */
export async function consumeAuthorizedDevice(
  env: Env,
  deviceCode: string,
): Promise<DevicePollResult> {
  const state = await getDevice(env, deviceCode);
  if (!state) return { status: "expired" };
  if (state.status === "consumed") return { status: "consumed" };
  if (state.status !== "authorized" || !state.token) {
    return { status: state.status === "denied" ? "denied" : "pending" };
  }

  const { token, expiresAt, account } = state;
  const consumed: DeviceState = {
    userCode: state.userCode,
    status: "consumed",
  };
  if (expiresAt !== undefined) consumed.expiresAt = expiresAt;
  if (account !== undefined) consumed.account = account;
  await setDevice(env, deviceCode, consumed);

  const authorized: Extract<DevicePollResult, { status: "authorized" }> = { status: "authorized", token };
  if (expiresAt !== undefined) authorized.expiresAt = expiresAt;
  if (account !== undefined) authorized.account = account;
  return authorized;
}
