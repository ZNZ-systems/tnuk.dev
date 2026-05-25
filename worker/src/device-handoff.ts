import { DurableObject } from "cloudflare:workers";

import { consumeAuthorizedDevice } from "./devices.js";
import type { Env } from "./env.js";

/** Serializes device poll handoffs so each authorized code is consumed once. */
export class DeviceHandoff extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = (await request.json()) as { deviceCode?: string };
    if (!body.deviceCode) {
      return Response.json({ error: "missing deviceCode" }, { status: 400 });
    }

    const result = await consumeAuthorizedDevice(this.env, body.deviceCode);
    return Response.json(result);
  }
}
