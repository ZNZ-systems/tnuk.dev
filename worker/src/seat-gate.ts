import type { Env } from "./env.js";
import { bearer, verifySeatToken, type SeatClaims } from "./jwt.js";
import { orgHasActiveSeat } from "./subscriptions.js";

export type SeatGateFailure = { ok: false; status: 401 | 402; error: string };
export type SeatGateSuccess = { ok: true; seat: SeatClaims };
export type SeatGateResult = SeatGateFailure | SeatGateSuccess;

/** Validates a seat JWT and confirms the org still has an active subscription. */
export async function requireActiveSeat(req: Request, env: Env): Promise<SeatGateResult> {
  const token = bearer(req);
  const seat = token ? await verifySeatToken(token, env.TNUK_JWT_SECRET) : null;
  if (!seat) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!(await orgHasActiveSeat(env, seat.orgId))) {
    return { ok: false, status: 402, error: "no active seat — ask your org admin to assign one" };
  }
  return { ok: true, seat };
}
