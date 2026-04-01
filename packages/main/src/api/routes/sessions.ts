import type { FastifyInstance } from "fastify";
import { SUPPORTED_AGENT_CLIS } from "@kleiber/shared";

import type {
  RemoteApiCreateSessionPayload,
  RemoteApiCreateSessionResolver,
  RemoteApiPackManager,
  RemoteApiSessionManager,
  RemoteApiStore,
} from "../types";

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: {
    store: Pick<RemoteApiStore, "getProject">;
    packManager: Pick<RemoteApiPackManager, "readProjectConfig">;
    sessionManager: Pick<RemoteApiSessionManager, "createSession" | "listSessions">;
    createSessionResolver: RemoteApiCreateSessionResolver;
    mcpRuntime?: {
      wrapperCommand: string;
      wrapperArgs: string[];
    };
  },
): Promise<void> {
  app.get(
    "/projects/:projectId/sessions",
    {
      schema: {
        params: {
          type: "object",
          required: ["projectId"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const project = options.store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: `Project ${projectId} not found.` });
      }

      return options.sessionManager.listSessions(projectId);
    },
  );

  app.post(
    "/projects/:projectId/sessions",
    {
      schema: {
        params: {
          type: "object",
          required: ["projectId"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
          },
        },
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            parentSessionId: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
            name: { type: "string", minLength: 1 },
            type: { type: "string", enum: ["plain", "agent", "agent_role"] },
            cli: { type: "string", enum: [...SUPPORTED_AGENT_CLIS] },
            role: { type: "string", minLength: 1 },
            yolo: { type: "boolean" },
            workingDirectory: { type: "string", minLength: 1 },
            mcpEnabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const project = options.store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: `Project ${projectId} not found.` });
      }

      const body = request.body as Omit<RemoteApiCreateSessionPayload, "projectId">;
      const { createSessionInput } = await options.createSessionResolver(
        {
          ...body,
          projectId,
        },
        {
          storeInstance: options.store,
          packManager: options.packManager,
          ...(options.mcpRuntime ? { mcpRuntime: options.mcpRuntime } : {}),
        },
      );

      const session = await options.sessionManager.createSession(createSessionInput);
      return reply.code(201).send(session);
    },
  );
}
