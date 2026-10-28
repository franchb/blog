/**
 * Satori element tree for per-post Open Graph images (1200×630).
 *
 * Two layouts, chosen by whether the post has a hero image:
 *  - "split":       text panel on the left, photo on the right, soft fade between.
 *  - "typographic": title-only card for posts without images.
 *
 * Sizes are tuned for Telegram, which shows the image at roughly 0.3× in a chat
 * bubble: 62 px titles land near 18 px on screen, 30 px meta near 9 px. Anything
 * under ~26 px here is decoration, not information.
 *
 * Satori subset in use: flexbox only; every element with more than one child
 * sets display:flex; lengths are numbers (px). Satori sizes boxes content-box
 * by default, so every padded fixed-size box sets boxSizing: "border-box".
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_PHOTO_WIDTH = 620;

export const ogTheme = {
  ground: "#212737",
  foreground: "#eaedf3",
  muted: "#afb9ca",
  rule: "#343f60",
  accent: "#ff6b01",
  fontFamily: "Google Sans Code",
} as const;

export type OgPostInput = {
  title: string;
  description: string;
  tags: string[];
  readingMinutes: number;
  host: string;
  hero?: { dataUri: string; credit?: string };
};

type Style = Record<string, string | number>;
type Child = OgNode | string;
export type OgNode = {
  type: string;
  props: { style?: Style; children?: Child | Child[]; [k: string]: unknown };
};

const h = (type: string, style: Style, children?: Child | Child[]): OgNode => ({
  type,
  props: { style, children },
});

/** "Main: Sub" or "Main (Sub)" → { main, sub }. */
export function splitTitle(title: string): { main: string; sub?: string } {
  const m = title.match(/^(.+?)(?::\s+|\s+(?=\())(.+)$/);
  return m ? { main: m[1].trim(), sub: m[2].trim() } : { main: title };
}

/** First two non-placeholder tags, e.g. "CINEMA · TARKOVSKY". */
export function kickerFromTags(tags: string[]): string | undefined {
  const t = tags.filter(x => x && x !== "others").slice(0, 2);
  return t.length ? t.join(" · ") : undefined;
}

function titleSize(len: number, layout: "split" | "typographic"): number {
  if (layout === "split") return len <= 40 ? 60 : len <= 64 ? 50 : 42;
  return len <= 36 ? 76 : len <= 60 ? 66 : 56;
}

function kicker(text: string | undefined): OgNode | undefined {
  if (!text) return undefined;
  return h("div", { display: "flex", alignItems: "center" }, [
    h("div", {
      width: 40,
      height: 6,
      marginRight: 16,
      backgroundColor: ogTheme.accent,
    }),
    h(
      "span",
      {
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: ogTheme.accent,
      },
      text
    ),
  ]);
}

function metaRow(host: string, minutes: number): OgNode {
  return h("div", { display: "flex", alignItems: "baseline", fontSize: 30 }, [
    h("span", { fontWeight: 700, color: ogTheme.foreground }, host),
    h("span", { marginLeft: 18, color: ogTheme.muted }, `${minutes} min read`),
  ]);
}

function titleBlock(
  main: string,
  sub: string | undefined,
  size: number,
  maxWidth: number,
  fallbackSub?: string
): OgNode {
  const subText = sub ?? fallbackSub;
  const children: Child[] = [
    h(
      "div",
      {
        fontSize: size,
        lineHeight: 1.06,
        fontWeight: 700,
        letterSpacing: -1,
        color: ogTheme.foreground,
        maxWidth,
        lineClamp: 4,
      },
      main
    ),
  ];
  if (subText) {
    children.push(
      h(
        "div",
        {
          marginTop: 20,
          fontSize: 32,
          lineHeight: 1.28,
          color: ogTheme.muted,
          maxWidth,
          lineClamp: 2,
        },
        subText
      )
    );
  }
  return h("div", { display: "flex", flexDirection: "column" }, children);
}

function splitLayout(
  p: OgPostInput & { hero: NonNullable<OgPostInput["hero"]> }
): OgNode {
  const { main, sub } = splitTitle(p.title);
  const k = kicker(kickerFromTags(p.tags));
  const textColumn = 600 - 64 - 40;

  const top: Child[] = [];
  if (k) top.push(k);
  top.push(
    h("div", { display: "flex", marginTop: k ? 28 : 0 }, [
      titleBlock(main, sub, titleSize(main.length, "split"), textColumn),
    ])
  );

  const layers: Child[] = [
    h("div", { position: "absolute", top: 0, right: 0, display: "flex" }, [
      {
        type: "img",
        props: {
          src: p.hero.dataUri,
          width: OG_PHOTO_WIDTH,
          height: OG_HEIGHT,
          style: {
            width: OG_PHOTO_WIDTH,
            height: OG_HEIGHT,
            objectFit: "cover",
          },
        },
      },
    ]),
    h("div", {
      position: "absolute",
      top: 0,
      left: OG_WIDTH - OG_PHOTO_WIDTH,
      width: 180,
      height: OG_HEIGHT,
      backgroundImage: `linear-gradient(90deg, ${ogTheme.ground} 0%, rgba(33,39,55,0) 100%)`,
    }),
    h(
      "div",
      {
        position: "absolute",
        top: 0,
        left: 0,
        width: 600,
        height: OG_HEIGHT,
        boxSizing: "border-box",
        padding: "64px 40px 56px 64px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      },
      [
        h("div", { display: "flex", flexDirection: "column" }, top),
        metaRow(p.host, p.readingMinutes),
      ]
    ),
  ];

  if (p.hero.credit) {
    layers.push(
      h(
        "div",
        {
          position: "absolute",
          right: 20,
          bottom: 16,
          padding: "4px 10px",
          backgroundColor: "rgba(20,22,30,0.72)",
          fontSize: 15,
          color: "#d7dbe3",
        },
        p.hero.credit
      )
    );
  }

  return h(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      position: "relative",
      display: "flex",
      backgroundColor: ogTheme.ground,
      fontFamily: ogTheme.fontFamily,
      color: ogTheme.foreground,
    },
    layers
  );
}

function typographicLayout(p: OgPostInput): OgNode {
  const { main, sub } = splitTitle(p.title);
  const k = kicker(kickerFromTags(p.tags));
  const width = OG_WIDTH - 72 * 2;
  const tagLine = p.tags
    .filter(t => t !== "others")
    .slice(0, 3)
    .map(t => `#${t}`)
    .join(" ");

  const top: Child[] = [];
  if (k) top.push(k);
  top.push(
    h("div", { display: "flex", marginTop: k ? 32 : 0 }, [
      titleBlock(
        main,
        sub,
        titleSize(main.length, "typographic"),
        width - 60,
        p.description
      ),
    ])
  );

  return h(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      boxSizing: "border-box",
      padding: "64px 72px 56px 72px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: ogTheme.ground,
      fontFamily: ogTheme.fontFamily,
      color: ogTheme.foreground,
    },
    [
      h("div", { display: "flex", flexDirection: "column" }, top),
      h(
        "div",
        {
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingTop: 28,
          borderTop: `2px solid ${ogTheme.rule}`,
          fontSize: 30,
        },
        [
          metaRow(p.host, p.readingMinutes),
          h("span", { color: ogTheme.accent }, tagLine),
        ]
      ),
    ]
  );
}

export function postOgTemplate(p: OgPostInput): OgNode {
  return p.hero ? splitLayout({ ...p, hero: p.hero }) : typographicLayout(p);
}

/** ~230 wpm over prose; strips front matter, code fences, HTML, link targets. */
export function readingMinutes(markdown: string): number {
  const text = markdown
    .replace(/^---[\s\S]*?\n---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "]");
  const words = text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / 230));
}
