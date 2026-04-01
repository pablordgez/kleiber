import type { RemoteApiCredentials } from "@kleiber/shared";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

import {
  parseBasicAuthHeader,
  verifyAuthToken,
  verifyPassword,
  type AuthenticatedPrincipal,
} from "./auth";

declare module "fastify" {
  interface FastifyRequest {
    remoteApiAuth: AuthenticatedPrincipal | null;
  }
}

function stripQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function matchesPublicPath(requestPath: string, publicPathPattern: string): boolean {
  const requestSegments = requestPath.split("/").filter(Boolean);
  const patternSegments = publicPathPattern.split("/").filter(Boolean);

  if (requestSegments.length !== patternSegments.length) {
    return false;
  }

  return patternSegments.every((segment, index) => {
    if (segment.startsWith(":")) {
      return requestSegments[index] !== undefined;
    }

    return requestSegments[index] === segment;
  });
}

async function replyUnauthorized(reply: FastifyReply): Promise<FastifyReply> {
  return reply
    .code(401)
    .header("www-authenticate", 'Basic realm="kleiber", Bearer realm="kleiber"')
    .send({ error: "Authentication required." });
}

export function createAuthPreHandler(options: {
  publicPaths?: string[];
  signingKey: Buffer;
  getCredentials: () => RemoteApiCredentials | null;
  now?: () => number;
}): preHandlerHookHandler {
  const publicPaths = options.publicPaths ?? ["/auth"];
  const now = options.now ?? (() => Date.now());

  return async (request, reply) => {
    const requestPath = stripQuery(request.url);
    if (publicPaths.some((publicPath) => matchesPublicPath(requestPath, publicPath))) {
      return;
    }

    const authorizationHeader = request.headers.authorization;
    if (!authorizationHeader) {
      await replyUnauthorized(reply);
      return;
    }

    if (authorizationHeader.toLowerCase().startsWith("bearer ")) {
      const token = authorizationHeader.slice(7).trim();
      const payload = verifyAuthToken(token, options.signingKey, now);
      if (!payload) {
        request.log.warn({ ip: request.ip }, "remote-api bearer authentication failed");
        await replyUnauthorized(reply);
        return;
      }

      request.remoteApiAuth = {
        username: payload.sub,
        mode: "bearer",
      };
      return;
    }

    const basicAuth = parseBasicAuthHeader(authorizationHeader);
    if (!basicAuth) {
      request.log.warn({ ip: request.ip }, "remote-api authentication header was invalid");
      await replyUnauthorized(reply);
      return;
    }

    const authenticated = await verifyPassword(
      options.getCredentials(),
      basicAuth.username,
      basicAuth.password,
    );
    if (!authenticated) {
      request.log.warn({ ip: request.ip }, "remote-api basic authentication failed");
      await replyUnauthorized(reply);
      return;
    }

    request.remoteApiAuth = {
      username: basicAuth.username,
      mode: "basic",
    };
  };
}
