/**
 * Web app manifest — gives the browser the Nayroz name and icons instead of a
 * derived favicon and a page-title guess when the console is pinned or
 * installed. Icons come straight from the brand kit in `public/brand`.
 */
export default function manifest() {
  return {
    name: "Nayroz Studio",
    short_name: "Nayroz",
    description: "Design templates, fonts, and mobile app operations in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f5", // brand Paper
    theme_color: "#22828c", // brand Teal
    icons: [
      { src: "/brand/icon/nayroz-icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/brand/icon/nayroz-icon-256.png", type: "image/png", sizes: "256x256" },
      {
        src: "/brand/icon/nayroz-icon-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "any",
      },
    ],
  };
}
