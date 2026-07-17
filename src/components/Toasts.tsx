"use client";
/**
 * Tiny toast system: `toast("msg", color)` from anywhere, GSAP in/out.
 */
import { useEffect, useRef, useState } from "react";
import { durations, easings, tween } from "@/lib/motion";

interface ToastItem {
  id: number;
  text: string;
  color?: string;
}

type Listener = (t: ToastItem) => void;
let nextId = 1;
const listeners = new Set<Listener>();

export function toast(text: string, color?: string): void {
  const item = { id: nextId++, text, color };
  for (const l of listeners) l(item);
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    tween(el, {
      y: 0,
      opacity: 1,
      duration: durations.base,
      ease: easings.pop,
    });
    const timer = setTimeout(() => {
      tween(el, {
        y: -12,
        opacity: 0,
        duration: durations.quick,
        ease: easings.out,
        onComplete: onDone,
      });
    }, 2600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="toast"
      style={{
        backgroundColor: item.color ?? "#333",
        opacity: 0,
        transform: "translateY(-16px)",
      }}
    >
      {item.text}
    </div>
  );
}

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (t) =>
      setItems((prev) => [...prev.slice(-3), t]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <Toast
          key={item.id}
          item={item}
          onDone={() =>
            setItems((prev) => prev.filter((i) => i.id !== item.id))
          }
        />
      ))}
    </div>
  );
}
