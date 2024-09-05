import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import sitemap from "@astrojs/sitemap";
import markdoc from "@astrojs/markdoc";
import { remarkReadingTime } from "./src/utils/remark-reading-time.mjs";

// enable to turn on SSR -- import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://franchb.com/",
  build: {
    inlineStylesheets: "auto",
  },
  redirects: {
    "/old": "/new",
  },
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    react(),
    sitemap(),
    markdoc(),
  ],
  markdown: {
    remarkPlugins: [
      remarkToc,
      remarkReadingTime,
      [
        remarkCollapse,
        {
          test: "Table of contents",
        },
      ],
    ],
    shikiConfig: {
      // For more themes, visit https://shiki.style/themes
      themes: { light: "min-light", dark: "night-owl" },
      wrap: true,
    },
  },
  vite: {
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
  },
  // In order to enable Cloudflare SSR/Functions see https://github.com/satnaing/astro-paper/issues/44
  // output: "server",
  // TODO: switch to a directory mode for Sentry adapter: cloudflare({ mode: "directory" }),
  scopedStyleStrategy: "where",
  experimental: {
    contentLayer: true,
  },
});
