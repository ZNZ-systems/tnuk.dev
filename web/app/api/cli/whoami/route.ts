import { verifyCliToken } from "@/lib/jwt";
import { userPlanSlug } from "@/lib/billing";

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await verifyCliToken(token);
    const plan = await userPlanSlug(payload.sub);
    return Response.json({
      userId: payload.sub,
      email: payload.email,
      plan: plan ?? "none",
    });
  } catch {
    return Response.json({ error: "session_expired" }, { status: 401 });
  }
}
