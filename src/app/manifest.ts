import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EveryField",
    short_name: "EveryField",
    description:
      "Navigate your church plant from calling to launch — a proven planting methodology put to work on your real progress.",
    start_url: "/",
    display: "browser",
    background_color: "#fbf8ea",
    theme_color: "#181d19",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
  };
}
