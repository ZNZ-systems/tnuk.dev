import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { signCliToken } from "@/lib/cli-auth";

export async function POST(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const token = await signCliToken(userId, email);
  return NextResponse.json({
    token,
    userId,
    email,
    issuedAt: new Date().toISOString(),
  });
}
