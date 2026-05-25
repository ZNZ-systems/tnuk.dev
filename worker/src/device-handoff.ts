import { DurableObject } from "cloudflare:workers";

import { consumeAuthorizedDevice } from "./devices.js";
import type { Env } from "./env.js";

/** Serializes device poll handoffs so each authorized code is consumed once. */
export class DeviceHandoff extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }

    const deviceCode =
      body && typeof body === "object" ? (body as { deviceCode?: unknown }).deviceCode : undefined;
    if (typeof deviceCode !== "string" || deviceCode.length === 0) {
      return Response.json({ error: "missing deviceCode" }, { status: 400 });
    }

    const result = await consumeAuthorizedDevice(this.env, deviceCode);
    return Response.json(result);
  }
}
