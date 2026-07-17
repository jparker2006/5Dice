"use client";
/**
 * Room route: /room/<id>. `?create=1&name=...&max=N` opens a brand-new room
 * (params are consumed once, then cleaned from the URL).
 */
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { GameRoom } from "@/components/GameRoom";
import { loadProfile } from "@/lib/identity";
import type { Profile } from "@/protocol";

function RoomPageInner() {
  const params = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  // Capture create params once, in a state initializer (runs during first
  // render only) — they're stripped from the URL right after.
  const [create] = useState<{ roomName: string; maxPlayers: number } | undefined>(() =>
    search.get("create") === "1"
      ? {
          roomName: search.get("name") ?? "New game",
          maxPlayers: Math.min(6, Math.max(2, parseInt(search.get("max") ?? "2") || 2)),
        }
      : undefined,
  );

  useEffect(() => {
    const p = loadProfile();
    // Post-mount localStorage read (hydration-safe identity load), not a
    // render-derived cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(p);
    setReady(true);
    if (!p) {
      // No name yet — go set one up first.
      router.replace("/");
      return;
    }
    if (search.get("create") === "1") {
      const guest = search.get("guest");
      const clean = `/room/${params.roomId}${guest ? `?guest=${encodeURIComponent(guest)}` : ""}`;
      window.history.replaceState(null, "", clean);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready || !profile) return null;

  return <GameRoom roomId={params.roomId} profile={profile} create={create} />;
}

export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <RoomPageInner />
    </Suspense>
  );
}
