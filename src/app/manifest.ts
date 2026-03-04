import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Peer Assessment",
    short_name: "PeerAssess",
    description: "Anonymous peer accountability for group projects.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5ef",
    theme_color: "#13212f",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
