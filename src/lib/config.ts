/** Where the game servers live (Cloudflare Workers / partyserver). Set
 * NEXT_PUBLIC_GAME_HOST in prod (e.g. "5dice.<subdomain>.workers.dev");
 * defaults to the local `wrangler dev` server. */
export const GAME_HOST =
  process.env.NEXT_PUBLIC_GAME_HOST ?? "127.0.0.1:1999";
