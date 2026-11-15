import type { FastifyReply } from "fastify";

/** Placeholder handler: honest 501, never fake data. TODO(Dev 3): implement and document DTOs. */
export function notImplemented(reply: FastifyReply, route: string) {
  return reply.code(501).send({ error: "not_implemented", route });
}
