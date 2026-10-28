import type { APIRoute } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { fontData, experimental_getFontFileURL } from "astro:assets";
import satori from "satori";
import sharp from "sharp";
import { getFontPathByWeight } from "@/utils/getFontPathByWeight";
import { getPostSlug } from "@/utils/getPostPaths";
import {
  OG_HEIGHT,
  OG_PHOTO_WIDTH,
  OG_WIDTH,
  ogTheme,
  postOgTemplate,
  readingMinutes,
} from "@/utils/og/postOgTemplate";
import { resolveOgHero } from "@/utils/og/resolveOgHero";
import config from "@/config";

export async function getStaticPaths() {
  if (!config.features.dynamicOgImage) {
    return [];
  }

  const posts = await getCollection("posts").then(p =>
    p.filter(({ data }) => !data.draft && !data.ogImage)
  );

  return posts.map(post => ({
    params: { slug: getPostSlug(post.id, post.filePath) },
    props: post,
  }));
}

export const GET: APIRoute = async ({ props, url }) => {
  if (!config.features.dynamicOgImage) {
    return new Response(null, { status: 404, statusText: "Not found" });
  }

  const post = props as CollectionEntry<"posts">;

  const fonts = fontData["--font-google-sans-code"];
  const regularFontPath = getFontPathByWeight(fonts, 400);
  const boldFontPath = getFontPathByWeight(fonts, 700);

  if (regularFontPath === undefined || boldFontPath === undefined) {
    throw new Error("Cannot find the font path.");
  }

  const [regularData, boldData, hero] = await Promise.all([
    fetch(experimental_getFontFileURL(regularFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
    fetch(experimental_getFontFileURL(boldFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
    resolveOgHero({
      body: post.body,
      filePath: post.filePath,
      ogHero: post.data.ogHero,
      ogHeroCredit: post.data.ogHeroCredit,
      width: OG_PHOTO_WIDTH,
      height: OG_HEIGHT,
    }),
  ]);

  const svg = await satori(
    postOgTemplate({
      title: post.data.title,
      description: post.data.description,
      tags: post.data.tags,
      readingMinutes: readingMinutes(post.body ?? ""),
      host: new URL(config.site.url).hostname,
      hero,
    }) as unknown as Parameters<typeof satori>[0],
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      embedFont: true,
      fonts: [
        {
          name: ogTheme.fontFamily,
          data: regularData,
          weight: 400,
          style: "normal",
        },
        {
          name: ogTheme.fontFamily,
          data: boldData,
          weight: 700,
          style: "normal",
        },
      ],
    }
  );

  // JPEG would be ~3× smaller for photo cards, but the route is index.png and
  // Telegram/X accept PNG fine; keep the URL stable so caches don't split.
  const pngBuffer = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  return new Response(new Uint8Array(pngBuffer), {
    headers: { "Content-Type": "image/png" },
  });
};
