/**
 * Cloudflare Worker entry point. Exports the two Durable Object classes and
 * routes every request to the right party via partyserver's routePartykitRequest
 * (the same URL scheme partysocket already speaks: /parties/<party>/<room>).
 * Binding "Main" (kebab "main") is the default room party; "Lobby" is the lobby.
 */
import { routePartykitRequest } from "partyserver";
import type { Env } from "../party/types";

export { RoomServer } from "../party/room";
export { LobbyServer } from "../party/lobby";

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env, { prefix: "parties" })) ??
      new Response("Not Found", { status: 404 })
    );
  },
};

export default handler;
