/// <reference lib="webworker" />
/**
 * Service worker (built by @serwist/turbopack). Precaches the app shell with
 * revisioned entries and uses Serwist's Next.js runtime caching defaults —
 * hashed assets cache-first, documents network-first. skipWaiting+clientsClaim
 * mean a new deploy takes over on the next load instead of serving stale JS
 * forever (the legacy app's cache-v58 problem).
 */
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { defaultCache } from "@serwist/turbopack/worker";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
