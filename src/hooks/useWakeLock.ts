"use client";
/**
 * Keeps the phone screen awake during a game (ported from the legacy app —
 * nobody wants their screen to sleep mid-turn). Re-acquires on tab refocus.
 */
import { useEffect } from "react";

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async (): Promise<void> => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not critical — low battery or unsupported. The game plays on.
      }
    };

    const onVisible = (): void => {
      if (document.visibilityState === "visible" && !cancelled) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
