import { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { validateOrigin } from "@/lib/auth/origin";
import { removeOAuthAccountByIdOrName, toggleOAuthAccountByIdOrName, updateOAuthAccountFieldsByIdOrName } from "@/lib/providers/dual-write";
import { prisma } from "@/lib/db";
import { Errors, apiSuccess } from "@/lib/errors";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;

    if (!id || typeof id !== "string") {
      return Errors.missingFields(["id"]);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { isAdmin: true },
    });

    const isAdmin = user?.isAdmin ?? false;

    const result = await removeOAuthAccountByIdOrName(session.userId, id, isAdmin);

    if (!result.ok) {
      if (result.error?.includes("Access denied")) {
        return Errors.forbidden();
      }
      if (result.error?.includes("not found")) {
        return Errors.notFound("OAuth account");
      }
      return Errors.internal("Failed to remove OAuth account", result.error ? new Error(result.error) : undefined);
    }

    return apiSuccess({});
  } catch (error) {
    return Errors.internal("Failed to remove OAuth account", error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;

    if (!id || typeof id !== "string") {
      return Errors.missingFields(["id"]);
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || (typeof body.disabled !== "boolean" && typeof body.priority !== "number" && typeof body.websockets !== "boolean")) {
      return Errors.validation("Request body must include 'disabled' (boolean), 'priority' (number), or 'websockets' (boolean)");
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { isAdmin: true },
    });

    const isAdmin = user?.isAdmin ?? false;

    const result = typeof body.priority === "number" || typeof body.websockets === "boolean"
      ? await updateOAuthAccountFieldsByIdOrName(session.userId, id, {
          ...(typeof body.priority === "number" ? { priority: Math.trunc(body.priority) } : {}),
          ...(typeof body.websockets === "boolean" ? { websockets: body.websockets } : {}),
        }, isAdmin)
      : await toggleOAuthAccountByIdOrName(session.userId, id, body.disabled as boolean, isAdmin);

    if (!result.ok) {
      if (result.error?.includes("Access denied")) {
        return Errors.forbidden();
      }
      if (result.error?.includes("not found")) {
        return Errors.notFound("OAuth account");
      }
      return Errors.internal("Failed to toggle OAuth account", result.error ? new Error(result.error) : undefined);
    }

    return apiSuccess(
      typeof body.priority === "number" || typeof body.websockets === "boolean"
        ? {
            ...(typeof body.priority === "number" ? { priority: Math.trunc(body.priority) } : {}),
            ...(typeof body.websockets === "boolean" ? { websockets: body.websockets } : {}),
          }
        : { disabled: result.disabled }
    );
  } catch (error) {
    return Errors.internal("Failed to toggle OAuth account", error);
  }
}
