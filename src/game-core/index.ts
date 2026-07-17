/**
 * The 5 Dice game engine: pure, deterministic, DOM- and network-free.
 *
 * The server routes every player action through `applyAction` and broadcasts
 * the result; the client imports the same rules to preview scores and render
 * state. Nothing in here reaches for `window`, `document`, or a socket.
 */
export * from "./types";
export * from "./rng";
export * from "./scoring";
export * from "./reducer";
