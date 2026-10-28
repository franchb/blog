// @ts-check
/**
 * Writes generated figures into blog posts.
 *
 *   pnpm figures          rewrite every figure block in src/data/blog
 *   pnpm figures --check  exit 1 if any block is out of date (used in CI)
 *
 * A block is everything between `<!-- figure:NAME -->` and
 * `<!-- /figure:NAME -->`, each on its own line. NAME must be a key of
 * FIGURES. The generated HTML is committed with the post, so the site build
 * never runs this script and what is reviewed is what is deployed.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderLifelines } from "./lifelines.mjs";
import tarkovskyLifelines from "./tarkovsky-lifelines.mjs";

/** @type {Record<string, () => string>} */
const FIGURES = {
  "tarkovsky-lifelines": () => renderLifelines(tarkovskyLifelines),
};

const BLOG = fileURLToPath(new URL("../data/blog/", import.meta.url));
const BLOCK = /^(<!-- figure:([\w-]+) -->\n)[\s\S]*?(^<!-- \/figure:\2 -->)$/gm;

const check = process.argv.includes("--check");
let stale = 0;

for (const file of (await readdir(BLOG)).filter(f => f.endsWith(".md"))) {
  const full = path.join(BLOG, file);
  const before = await readFile(full, "utf8");
  const after = before.replace(BLOCK, (_, open, name, close) => {
    const render = FIGURES[name];
    if (!render) throw new Error(`${file}: unknown figure "${name}"`);
    return `${open}${render()}\n${close}`;
  });
  if (after === before) continue;
  stale++;
  if (check) {
    process.stderr.write(`${file}: figure out of date; run pnpm figures\n`);
  } else {
    await writeFile(full, after);
    process.stdout.write(`${file}: figure updated\n`);
  }
}

if (check && stale > 0) process.exitCode = 1;
