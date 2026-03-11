import type { Express } from "express";
import { z } from "zod";
import { createSession, getUserFromLocals, requireAuth } from "../auth.js";
import { logger } from "../logger.js";
import {
  SIWE_NONCE_COOKIE,
  SiweServiceError,
  type SiweService
} from "../auth/siwe.service.js";

const siweVerifySchema = z.object({
  message: z.string().trim().min(1),
  signature: z.string().trim().min(1),
  address: z.string().trim().optional()
});

function mapSiweError(error: unknown): { status: number; code: string } {
  if (error instanceof SiweServiceError) {
    const code = error.code;
    if (code === "invalid_payload") return { status: 400, code };
    return { status: 401, code };
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) {
      return { status: code === "invalid_payload" ? 400 : 401, code };
    }
  }
  return {
    status: 500,
    code: "siwe_unexpected_error"
  };
}

export function registerSiweAuthRoutes(
  app: Express,
  deps: {
    db: any;
    siweService: SiweService;
    vaultService?: {
      syncMasterVaultFromOnchainForUser?: (input: { userId: string }) => Promise<unknown>;
    } | null;
  }
) {
  app.get("/auth/siwe/nonce", async (_req, res) => {
    try {
      const issued = await deps.siweService.issueNonce();
      res.cookie(SIWE_NONCE_COOKIE, issued.token, deps.siweService.buildNonceCookieOptions(issued.ttlMs));
      return res.json({
        nonce: issued.nonce,
        expiresAt: issued.expiresAt.toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        error: "siwe_nonce_issue_failed",
        reason: String(error)
      });
    }
  });

  app.post("/auth/siwe/verify", async (req, res) => {
    const parsed = siweVerifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }

    try {
      const verified = await deps.siweService.verify({
        message: parsed.data.message,
        signature: parsed.data.signature,
        nonceToken: req.cookies?.[SIWE_NONCE_COOKIE],
        requestHost: req.get("host") ?? null,
        expectedAddress: parsed.data.address ?? null
      });

      const user = await deps.db.user.findUnique({
        where: {
          walletAddress: verified.address
        },
        select: {
          id: true,
          email: true,
          walletAddress: true
        }
      });

      if (!user) {
        deps.siweService.clearNonceCookie(res);
        return res.status(401).json({
          error: "wallet_not_linked"
        });
      }

      await createSession(res, user.id);
      deps.siweService.clearNonceCookie(res);
      return res.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          walletAddress: user.walletAddress
        }
      });
    } catch (error) {
      deps.siweService.clearNonceCookie(res);
      const mapped = mapSiweError(error);
      logger.warn("siwe_verify_failed", {
        code: mapped.code,
        requestHost: req.get("host") ?? null,
        expectedAddress: parsed.data.address ?? null
      });
      return res.status(mapped.status).json({
        error: mapped.code
      });
    }
  });

  app.post("/auth/siwe/link", requireAuth, async (req, res) => {
    const parsed = siweVerifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }

    const authUser = getUserFromLocals(res);

    try {
      const verified = await deps.siweService.verify({
        message: parsed.data.message,
        signature: parsed.data.signature,
        nonceToken: req.cookies?.[SIWE_NONCE_COOKIE],
        requestHost: req.get("host") ?? null,
        expectedAddress: parsed.data.address ?? null
      });

      const existing = await deps.db.user.findUnique({
        where: {
          walletAddress: verified.address
        },
        select: {
          id: true
        }
      });

      if (existing && existing.id !== authUser.id) {
        deps.siweService.clearNonceCookie(res);
        return res.status(409).json({
          error: "wallet_already_linked"
        });
      }

      await deps.db.user.update({
        where: {
          id: authUser.id
        },
        data: {
          walletAddress: verified.address
        }
      });

      await deps.vaultService?.syncMasterVaultFromOnchainForUser?.({
        userId: authUser.id
      });

      deps.siweService.clearNonceCookie(res);
      return res.json({
        ok: true,
        walletAddress: verified.address
      });
    } catch (error) {
      deps.siweService.clearNonceCookie(res);
      const mapped = mapSiweError(error);
      logger.warn("siwe_link_failed", {
        userId: authUser.id,
        code: mapped.code,
        requestHost: req.get("host") ?? null,
        expectedAddress: parsed.data.address ?? null
      });
      return res.status(mapped.status).json({
        error: mapped.code
      });
    }
  });

  app.delete("/auth/siwe/link", requireAuth, async (_req, res) => {
    const authUser = getUserFromLocals(res);

    await deps.db.user.update({
      where: {
        id: authUser.id
      },
      data: {
        walletAddress: null
      }
    });

    return res.json({
      ok: true,
      walletAddress: null
    });
  });
}
