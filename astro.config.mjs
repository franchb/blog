import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config";
import markdoc from "@astrojs/markdoc";

// enable to turn on SSR -- import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://astro-paper.pages.dev/", // replace this with your deployed domain
  site: SITE.website,
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
    redirects: true,
  },
  markdown: {
    remarkPlugins: [
      remarkToc,
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
