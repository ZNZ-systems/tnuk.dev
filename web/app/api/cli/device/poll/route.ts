import { NextResponse } from "next/server";

import { handleDevicePollGet } from "@/lib/cli-auth";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleDevicePollGet(request);
  } catch {
    return NextResponse.json({ status: "expired" }, { status: 503 });
  }
}
