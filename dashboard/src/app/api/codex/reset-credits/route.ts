import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

const CLIPROXYAPI_MANAGEMENT_URL =
  process.env.CLIPROXYAPI_MANAGEMENT_URL ||
  "http://cliproxyapi:8317/v0/management";
const MANAGEMENT_API_KEY = process.env.MANAGEMENT_API_KEY;

async function requireAdmin(): Promise<
  { userId: string; username: string } | NextResponse
> {
  const session = await verifySession();
  if (!session) {
    return Errors.unauthorized();
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) {
    return Errors.forbidden();
  }
  return { userId: session.userId, username: session.username };
}

// GET /api/codex/reset-credits?auth_index=<index>
// Proxies to CLIProxyAPI which calls ChatGPT's rate-limit-reset-credits API
// using the selected Codex account's token.
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const authIndex = request.nextUrl.searchParams.get("auth_index")?.trim();
  if (!authIndex) {
    return NextResponse.json({ error: "auth_index is required" }, { status: 400 });
  }
  if (!MANAGEMENT_API_KEY) {
    return Errors.internal(
      "fetch codex reset credits",
      new Error("MANAGEMENT_API_KEY not configured")
    );
  }

  try {
    const response = await fetch(
      `${CLIPROXYAPI_MANAGEMENT_URL}/codex-reset-credits?auth_index=${encodeURIComponent(authIndex)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${MANAGEMENT_API_KEY}` },
        signal: AbortSignal.timeout(30_000),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      logger.warn(
        `codex reset-credits fetch failed: status=${response.status} body=${text.slice(0, 300)}`
      );
      return NextResponse.json(
        { error: "Failed to fetch reset credits", detail: text.slice(0, 300) },
        { status: response.status }
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Invalid response from backend" },
        { status: 502 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return Errors.internal("fetch codex reset credits", error);
  }
}
