"use client";
/**
 * First-run (and later, gear-icon) settings: display name + player color.
 */
import { useEffect, useRef, useState } from "react";
import { PLAYER_COLORS } from "@/lib/identity";
import { durations, easings, tween } from "@/lib/motion";
import type { Profile } from "@/protocol";

export function SettingsForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Profile | null;
  onSave: (name: string, color: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? PLAYER_COLORS[0]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelRef.current) {
      tween(panelRef.current, {
        opacity: 1,
        y: 0,
        duration: durations.base,
        ease: easings.pop,
      });
    }
  }, []);

  const valid = name.trim().length > 0;

  return (
    <div className="screen">
      {initial ? (
        <header className="top-header">
          <h1>⚙️ Settings</h1>
        </header>
      ) : (
        <div className="welcome-hero">
          <div className="welcome-dice" aria-hidden>
            <span className="hero-die die-5" />
            <span className="hero-die die-2" />
            <span className="hero-die die-6" />
          </div>
          <h1 className="welcome-title">5 Dice</h1>
          <p className="welcome-tagline">Family dice night, anywhere.</p>
        </div>
      )}
      <div
        ref={panelRef}
        className="setup-container"
        style={{ opacity: 0, transform: "translateY(16px)" }}
      >
        <label htmlFor="player-name">Your display name</label>
        <input
          id="player-name"
          className="capsule-input"
          placeholder="Enter your name"
          maxLength={24}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) onSave(name.trim(), color);
          }}
        />

        <label>Your color</label>
        <div className="color-row" role="radiogroup" aria-label="Player color">
          {PLAYER_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              className={`color-swatch ${color === c ? "selected" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <button
          className={`capsule-button ${valid ? "green" : ""}`}
          disabled={!valid}
          onClick={() => onSave(name.trim(), color)}
        >
          {initial ? "Save & Return" : "Head to the Lobby"}
        </button>
        {onCancel && (
          <button className="capsule-button subtle" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
