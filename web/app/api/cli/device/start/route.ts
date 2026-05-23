import { NextResponse } from "next/server";

import { handleDeviceStartPost } from "@/lib/cli-auth";

export async function POST(): Promise<Response> {
  try {
    return await handleDeviceStartPost();
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
}
