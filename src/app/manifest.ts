import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "5 Dice",
    short_name: "5 Dice",
    description: "Multiplayer dice with the family — roll, hold, score!",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c1310",
    theme_color: "#13201a",
    icons: [
      {
        src: "/images/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/images/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/images/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
