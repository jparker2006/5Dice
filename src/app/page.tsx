"use client";
/**
 * Home: first-run settings gate, then the lobby.
 */
import { useEffect, useState } from "react";
import { Lobby } from "@/components/Lobby";
import { SettingsForm } from "@/components/SettingsForm";
import { Toasts } from "@/components/Toasts";
import { loadProfile, saveProfile } from "@/lib/identity";
import type { Profile } from "@/protocol";

export default function Home() {
  // null = loading (SSR-safe), then either a profile or the settings form.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // Post-mount localStorage read (hydration-safe identity load), not a
    // render-derived cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(loadProfile());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!profile || editing) {
    return (
      <>
        <SettingsForm
          initial={profile}
          onSave={(name, color) => {
            setProfile(saveProfile(name, color));
            setEditing(false);
          }}
          onCancel={profile ? () => setEditing(false) : undefined}
        />
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Lobby profile={profile} onOpenSettings={() => setEditing(true)} />
      <Toasts />
    </>
  );
}
