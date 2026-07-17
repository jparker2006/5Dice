/** Durable Object bindings, declared in wrangler.jsonc. */
export interface Env {
  /** The game-room party (client party name "main"). */
  Main: DurableObjectNamespace;
  /** The singleton lobby party (client party name "lobby", room "main"). */
  Lobby: DurableObjectNamespace;
}
