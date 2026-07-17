/**
 * Serves the Serwist-built service worker (and its manifest files) at the
 * site root, e.g. /sw.js — required so the SW can scope to the whole app.
 * Static pages/routes always win over this dynamic segment, so it only
 * handles the generated worker files.
 */
import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
