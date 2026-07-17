/**
 * The motion system. Every animation in the app reads its durations and
 * easings from here so the whole game feels like one designed thing, not a
 * pile of one-off tweens. See AGENTS.md "Visual style & animation".
 */
import gsap from "gsap";

/** Seconds. quick = micro-interactions, base = most transitions, slow/beat = set-pieces. */
export const durations = {
  quick: 0.18,
  base: 0.38,
  beat: 0.6,
  slow: 0.8,
} as const;

export const easings = {
  /** Default: settles with a soft overshoot — our "tactile" signature. */
  pop: "back.out(1.7)",
  /** Smooth in-out for color/position morphs. */
  glide: "power2.inOut",
  /** Snappy exit. */
  out: "power3.out",
  /** Bouncy landing for dice/score moments. */
  bounce: "elastic.out(1, 0.55)",
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Tween wrapper that honors reduced-motion: with it on, the tween completes
 * instantly (state still lands where it should — the game stays identical).
 */
export function tween(
  targets: gsap.TweenTarget,
  vars: gsap.TweenVars,
): gsap.core.Tween {
  if (prefersReducedMotion()) {
    return gsap.set(targets, stripAnimationVars(vars)) as gsap.core.Tween;
  }
  return gsap.to(targets, vars);
}

/** A timeline that collapses to instant sets under reduced motion. */
export function timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
  const tl = gsap.timeline(vars);
  if (prefersReducedMotion()) tl.timeScale(1000);
  return tl;
}

function stripAnimationVars(vars: gsap.TweenVars): gsap.TweenVars {
  const rest = { ...vars };
  delete rest.duration;
  delete rest.ease;
  delete rest.stagger;
  delete rest.delay;
  delete rest.onComplete;
  const onComplete = vars.onComplete;
  if (onComplete) {
    // Still fire completion callbacks so logic doesn't depend on motion.
    queueMicrotask(() => (onComplete as () => void)());
  }
  return rest;
}

export { gsap };
