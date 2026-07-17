/**
 * Player identity, persisted in localStorage. The playerId is the stable key
 * the server uses to re-seat a returning player, so it must survive reloads.
 *
 * Test hook: `?guest=<tag>` in the URL creates a per-tab identity in
 * sessionStorage instead. Two tabs share localStorage (same player!), so the
 * multi-browser sim and manual two-tab testing use guest mode to get distinct
 * players from one browser profile.
 */
import type { Profile } from "@/protocol";

const KEY = "5dice-profile";
const GUEST_KEY = "5dice-guest-profile";

export const PLAYER_COLORS = [
  "#235880",
  "#3F1F74",
  "#6F4F1F",
  "#2E2B53",
  "#264C1C",
  "#533A51",
  "#220066",
  "#4d004d",
  "#663399",
  "#181B59",
  "#006652",
  "#006666",
] as const;

function randomId(): string {
  return `p-${crypto.randomUUID()}`;
}

export function randomColor(): string {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]!;
}

function isGuestTab(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("guest");
}

function storage(): Storage {
  return isGuestTab() ? window.sessionStorage : window.localStorage;
}

function storageKey(): string {
  return isGuestTab() ? GUEST_KEY : KEY;
}

/** The saved profile, or null if the player hasn't picked a name yet. */
export function loadProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = storage().getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (!parsed.playerId || !parsed.name || !parsed.color) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProfile(name: string, color: string): Profile {
  const existing = loadProfile();
  const guestTag = isGuestTab()
    ? new URLSearchParams(window.location.search).get("guest")
    : null;
  const profile: Profile = {
    playerId: existing?.playerId ?? randomId(),
    // Guest tabs get their tag appended so testers can tell them apart fast.
    name: guestTag && !name ? `Guest ${guestTag}` : name,
    color,
  };
  storage().setItem(storageKey(), JSON.stringify(profile));
  return profile;
}
