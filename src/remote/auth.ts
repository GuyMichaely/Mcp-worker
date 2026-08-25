import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "../config.js";
import { verifySecret } from "../shared/security.js";

function bearer(req: Request): string | undefined {
  const value = req.header("authorization");
  if (!value?.startsWith("Bearer ")) return undefined;
  return value.slice(7);
}

export function requireWorker(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = bearer(req);
    if (!token || !verifySecret(token, config.WORKER_TOKEN_SHA256)) {
      res.status(401).json({ error: "UNAUTHORIZED_WORKER" });
      return;
    }
    next();
  };
}

export function requireMcp(config: AppConfig) {
  const jwks = createRemoteJWKSet(new URL(config.OAUTH_JWKS_URI));
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearer(req);
    const challenge = `Bearer resource_metadata="${config.PUBLIC_BASE_URL}/.well-known/oauth-protected-resource"`;
    if (!token) {
      res.setHeader("WWW-Authenticate", challenge);
      res.status(401).json({ error: "MISSING_ACCESS_TOKEN" });
      return;
    }
    if (config.MCP_DEV_TOKEN_SHA256 && verifySecret(token, config.MCP_DEV_TOKEN_SHA256)) {
      next();
      return;
    }
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer: config.OAUTH_ISSUER,
        audience: config.OAUTH_AUDIENCE
      });
      const scope = typeof verified.payload.scope === "string" ? verified.payload.scope.split(" ") : [];
      if (!scope.includes(config.OAUTH_REQUIRED_SCOPE)) throw new Error("missing scope");
      next();
    } catch {
      res.setHeader("WWW-Authenticate", `${challenge}, error="invalid_token"`);
      res.status(401).json({ error: "INVALID_ACCESS_TOKEN" });
    }
  };
}
