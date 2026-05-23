import { NextResponse } from "next/server";

import { handleSessionPost } from "@/lib/cli-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleSessionPost(request);
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
}
