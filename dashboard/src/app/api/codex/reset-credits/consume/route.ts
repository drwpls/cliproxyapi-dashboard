import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { validateOrigin } from "@/lib/auth/origin";
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

// POST /api/codex/reset-credits/consume  body: { auth_index, credit_id? }
// Asks CLIProxyAPI to redeem one rate-limit reset credit for the Codex account.
// When credit_id is omitted, the backend redeems the first unused credit.
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  let payload: { auth_index?: string; credit_id?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const authIndex = payload.auth_index?.trim();
  if (!authIndex) {
    return NextResponse.json({ error: "auth_index is required" }, { status: 400 });
  }
  if (!MANAGEMENT_API_KEY) {
    return Errors.internal(
      "consume codex reset credit",
      new Error("MANAGEMENT_API_KEY not configured")
    );
  }

  try {
    const response = await fetch(
      `${CLIPROXYAPI_MANAGEMENT_URL}/codex-reset-credits/consume`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MANAGEMENT_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          auth_index: authIndex,
          ...(payload.credit_id ? { credit_id: payload.credit_id } : {}),
        }),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      logger.warn(
        `codex reset-credit consume failed: auth_index=${authIndex} status=${response.status} body=${text.slice(0, 300)}`
      );
      return NextResponse.json(
        { error: "Failed to redeem reset credit", detail: text.slice(0, 300) },
        { status: response.status }
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { status: "ok" };
    }
    return NextResponse.json(data);
  } catch (error) {
    return Errors.internal("consume codex reset credit", error);
  }
}
