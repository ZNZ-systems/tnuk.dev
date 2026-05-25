import type { Env } from "./env.js";

export interface DeviceState {
  userCode: string;
  status: "pending" | "authorized" | "consumed" | "denied";
  token?: string;
  expiresAt?: number;
  account?: string;
  deviceExpiresAt?: number;
}

const deviceKey = (deviceCode: string) => `device:${deviceCode}`;
const userCodeKey = (userCode: string) => `usercode:${userCode}`;
const DEVICE_TTL_SECONDS = 600;
const MIN_KV_EXPIRATION_SECONDS = 60;

function deviceExpiration(state: DeviceState): { expiration: number } | { expirationTtl: number } | null {
  if (state.deviceExpiresAt === undefined) {
    return { expirationTtl: DEVICE_TTL_SECONDS };
  }
  const remainingMs = state.deviceExpiresAt - Date.now();
  if (remainingMs <= 0) return null;
  if (remainingMs < MIN_KV_EXPIRATION_SECONDS * 1000) {
    return { expirationTtl: MIN_KV_EXPIRATION_SECONDS };
  }
  return { expiration: Math.ceil(state.deviceExpiresAt / 1000) };
}

export async function createDevice(
  env: Env,
  deviceCode: string,
  userCode: string,
): Promise<void> {
  const deviceExpiresAt = Date.now() + DEVICE_TTL_SECONDS * 1000;
  const state: DeviceState = { userCode, status: "pending", deviceExpiresAt };
  const expiration = Math.ceil(deviceExpiresAt / 1000);
  await env.TNUK_KV.put(deviceKey(deviceCode), JSON.stringify(state), { expiration });
  await env.TNUK_KV.put(userCodeKey(userCode), deviceCode, {
    expiration,
  });
}

export async function getDevice(env: Env, deviceCode: string): Promise<DeviceState | null> {
  const raw = await env.TNUK_KV.get(deviceKey(deviceCode));
  if (!raw) return null;
  const state = JSON.parse(raw) as DeviceState;
  if (state.deviceExpiresAt !== undefined && state.deviceExpiresAt <= Date.now()) {
    await env.TNUK_KV.delete(deviceKey(deviceCode));
    return null;
  }
  return state;
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
  const expiration = deviceExpiration(state);
  if (!expiration) {
    await env.TNUK_KV.delete(deviceKey(deviceCode));
    return;
  }
  await env.TNUK_KV.put(deviceKey(deviceCode), JSON.stringify(state), expiration);
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
  if (state.deviceExpiresAt !== undefined) consumed.deviceExpiresAt = state.deviceExpiresAt;
  await setDevice(env, deviceCode, consumed);

  const authorized: Extract<DevicePollResult, { status: "authorized" }> = { status: "authorized", token };
  if (expiresAt !== undefined) authorized.expiresAt = expiresAt;
  if (account !== undefined) authorized.account = account;
  return authorized;
}
