import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type OgHero = { dataUri: string; credit?: string };

type Options = {
  /** Raw markdown body of the post (`post.body`). */
  body: string | undefined;
  /** `post.filePath`, relative to the project root. */
  filePath: string | undefined;
  /** Front-matter override: path relative to the post file, or "none". */
  ogHero?: string;
  /** Front-matter override for the credit line. */
  ogHeroCredit?: string;
  width: number;
  height: number;
};

// First Markdown image: ![alt](path) or ![alt](<path with spaces>)
const IMAGE_RE = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/;
// "Photo: Boris Baldin, CC BY-SA 4.0." inside the figure that holds the image
const CREDIT_RE = /(?:^|\s)(?:Photo|Image|Фото)\s*:\s*(.+?)\.?$/i;

// Plain text for a satori text node (never parsed as HTML). Dropping every
// leftover angle bracket keeps "<scr<script>ipt>"-style input inert too.
function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Picks the post's hero image for the OG card:
 *   1. front-matter `ogHero` (relative to the .md file), "none" disables;
 *   2. otherwise the first local Markdown image in the body.
 * Remote images are ignored on purpose: the build stays offline and
 * reproducible. Returns a JPEG data URI cropped to width×height with
 * libvips' attention strategy (keeps the salient region, e.g. a face).
 */
export async function resolveOgHero(o: Options): Promise<OgHero | undefined> {
  if (o.ogHero === "none" || !o.filePath) return undefined;

  let rel = o.ogHero;
  let credit = o.ogHeroCredit;

  if (!rel && o.body) {
    const m = IMAGE_RE.exec(o.body);
    if (m) {
      rel = m[1] ?? m[2];
      if (!credit) {
        const after = o.body.slice(m.index + m[0].length);
        const figureEnd = after.search(/<\/figure>/i);
        const scope =
          figureEnd >= 0 ? after.slice(0, figureEnd) : after.slice(0, 600);
        const c = CREDIT_RE.exec(stripTags(scope));
        if (c) credit = `Photo: ${c[1].trim()}`;
      }
    }
  }

  if (!rel || /^[a-z]+:\/\//i.test(rel)) return undefined;

  const abs = path.resolve(process.cwd(), path.dirname(o.filePath), rel);
  let input: Buffer;
  try {
    input = await readFile(abs);
  } catch {
    return undefined;
  }

  const jpeg = await sharp(input)
    .resize(o.width, o.height, {
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return {
    dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    credit,
  };
}
