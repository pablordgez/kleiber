import type { FastifyInstance } from "fastify";

import type { RemoteApiStore } from "../types";

export async function registerProjectRoutes(
  app: FastifyInstance,
  options: {
    store: Pick<RemoteApiStore, "listProjects">;
  },
): Promise<void> {
  app.get(
    "/projects",
    {
      schema: {
        response: {
          200: {
            type: "array",
          },
        },
      },
    },
    async () => options.store.listProjects(),
  );
}
