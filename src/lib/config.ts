/** Where the PartyKit servers live. Set NEXT_PUBLIC_PARTYKIT_HOST in prod
 * (e.g. "5dice.<user>.partykit.dev"); defaults to the local dev server. */
export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
