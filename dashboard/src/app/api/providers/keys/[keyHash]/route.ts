import { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { validateOrigin } from "@/lib/auth/origin";
import { removeKey, removeKeyByAdmin, updateKeyPriority } from "@/lib/providers/dual-write";
import { prisma } from "@/lib/db";
import { PROVIDER, type Provider } from "@/lib/providers/constants";
import { AUDIT_ACTION, extractIpAddress, logAuditAsync } from "@/lib/audit";
import { Errors, apiSuccess } from "@/lib/errors";

function isValidProvider(provider: string): provider is Provider {
  return Object.values(PROVIDER).includes(provider as Provider);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> }
) {
  const session = await verifySession();
  if (!session) {
    return Errors.unauthorized();
  }

  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const { keyHash } = await params;
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!keyHash || typeof keyHash !== "string") {
      return Errors.missingFields(["keyHash"]);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { isAdmin: true },
    });

    const isAdmin = user?.isAdmin ?? false;

    const ownership = await prisma.providerKeyOwnership.findUnique({
      where: { keyHash },
    });

    let result: { ok: boolean; error?: string };

    if (!ownership && isAdmin && provider && isValidProvider(provider)) {
      result = await removeKeyByAdmin(keyHash, provider);
    } else {
      result = await removeKey(session.userId, keyHash, isAdmin);
    }

    if (!result.ok) {
      if (result.error?.includes("Access denied")) {
        return Errors.forbidden();
      }
      if (result.error?.includes("not found")) {
        return Errors.notFound("Provider key");
      }
      return Errors.internal("Failed to remove provider key", result.error ? new Error(result.error) : undefined);
    }

    logAuditAsync({
      userId: session.userId,
      action: AUDIT_ACTION.PROVIDER_KEY_REMOVED,
      target: ownership?.provider || provider || "unknown",
      metadata: {
        keyHash,
        removedByAdmin: isAdmin && ownership?.userId !== session.userId,
      },
      ipAddress: extractIpAddress(request),
    });

    return apiSuccess({});
  } catch (error) {
    return Errors.internal("Failed to remove provider key", error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> }
) {
  const session = await verifySession();
  if (!session) {
    return Errors.unauthorized();
  }

  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const { keyHash } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const provider = typeof body?.provider === "string" ? body.provider : "";
    const priority = typeof body?.priority === "number" ? body.priority : Number.NaN;

    if (!keyHash || typeof keyHash !== "string") {
      return Errors.missingFields(["keyHash"]);
    }
    if (!isValidProvider(provider)) {
      return Errors.validation("Invalid provider");
    }
    if (!Number.isFinite(priority)) {
      return Errors.validation("Request body must include 'priority' (number)");
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { isAdmin: true },
    });
    const isAdmin = user?.isAdmin ?? false;
    const result = await updateKeyPriority(session.userId, keyHash, provider, Math.trunc(priority), isAdmin);

    if (!result.ok) {
      if (result.error?.includes("Access denied")) return Errors.forbidden();
      if (result.error?.includes("not found")) return Errors.notFound("Provider key");
      return Errors.internal("Failed to update provider key", result.error ? new Error(result.error) : undefined);
    }

    return apiSuccess({ priority: Math.trunc(priority) });
  } catch (error) {
    return Errors.internal("Failed to update provider key", error);
  }
}
