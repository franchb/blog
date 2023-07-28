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
  site: "https://franchb.com/", // replace this with your deployed domain
  build: {
    inlineStylesheets: "auto",
  },
  redirects: {
    "/old": "/new",
  },
  compressHTML: true,
  integrations: [
    tailwind({
      config: {},
      applyBaseStyles: true,
    }),
    react(),
    sitemap(),
    markdoc(),
  ],
  experimental: {
    assets: true,
  },
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
      theme: "one-dark-pro",
      wrap: true,
    },
    extendDefaultPlugins: true,
  },
  vite: {
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
  },
  // In order to enable Cloudflare SSR/Functions see https://github.com/satnaing/astro-paper/issues/44
  // output: "server",
  // TODO: switch to a directory mode for Sentry adapter: cloudflare({ mode: "directory" }),
});
