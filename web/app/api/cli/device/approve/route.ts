import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { approveDeviceCode } from "@/lib/cli-auth";

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { userCode?: string };
  const userCode = body.userCode?.trim();
  if (!userCode) {
    return NextResponse.json({ error: "missing userCode" }, { status: 400 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const ok = await approveDeviceCode(userCode, userId, email);
  if (!ok) {
    return NextResponse.json({ error: "invalid or expired code" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
