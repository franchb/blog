// @ts-check
/**
 * Renders a "lifelines" figure to static HTML: one vertical lane per person,
 * time running down the page, one list item per dated event, and short
 * connectors between lanes for what passed from one life to another.
 *
 * The markup is written into a post by ./render.mjs and styled by
 * src/styles/lifelines.css. It needs no client-side JavaScript.
 *
 * Grid columns: 1 is the date, 2..n+1 are the lanes, the last is the text.
 * Each row of the <ol> is one grid row; the first <li> is a decorative layer
 * (lanes, era bands) that spans every row through a subgrid.
 */

/** @typedef {"birth" | "event" | "hedged" | "death" | "node" | "ghost"} Mark */
/** @typedef {"pass" | "family" | "split" | "join" | "rhyme"} Link */

/**
 * @typedef {object} Person
 * @property {string} id
 * @property {string} name Lane label.
 * @property {string} bio One line shown when the lane is picked (HTML).
 * @property {boolean} [before] The lane is already running at the first row.
 */

/**
 * @typedef {object} EventRow
 * @property {undefined} [type]
 * @property {string} when Date as shown.
 * @property {string} datetime Machine-readable date for <time>.
 * @property {boolean} [repeat] Same date as the row above; shown only to
 *   assistive technology.
 * @property {Record<string, Mark>} marks Person id to marker.
 * @property {{ from: string, to: string, kind: Link }} [link]
 * @property {string} title HTML.
 * @property {string} [pill] Short tag after the title.
 * @property {string} [text] HTML.
 * @property {{ href: string, label: string }} [see] Section of the essay.
 * @property {number[]} [refs] The essay's numbered sources.
 */

/** @typedef {{ type: "era", title: string, thin?: string[] }} EraRow */
/** @typedef {{ type: "end-era" }} EndEraRow */
/** @typedef {{ type: "gap", label: string }} GapRow */
/** @typedef {EventRow | EraRow | EndEraRow | GapRow} Row */

/**
 * @typedef {object} Lifelines
 * @property {string} id Unique on the page; also the radio group's name.
 * @property {string} title
 * @property {string} hint Shown while no lane is picked.
 * @property {Person[]} people Left to right.
 * @property {Row[]} rows Top to bottom.
 * @property {string} caption HTML.
 */

const SOURCES = "#sources-and-further-reading";

/** @param {string} s */
const esc = s =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const HIDDEN = 'aria-hidden="true"';

/**
 * @param {Lifelines} spec
 * @returns {string} HTML with no blank lines, so Markdown keeps it as one
 *   raw HTML block.
 */
export function renderLifelines(spec) {
  const lanes = new Map(spec.people.map((p, i) => [p.id, i + 1]));
  /** @param {string} id */
  const lane = id => {
    const n = lanes.get(id);
    if (n === undefined) throw new Error(`${spec.id}: unknown person "${id}"`);
    return n;
  };
  /** @param {string} id */
  const col = id => lane(id) + 1;

  // Pass 1: give every visible row a grid row; find where lanes and eras
  // start and end.
  /** @type {{ row: EventRow | EraRow | GapRow, r: number }[]} */
  const placed = [];
  /** @type {{ era: EraRow, start: number, end: number }[]} */
  const eras = [];
  /** @type {Map<string, number>} */
  const born = new Map();
  /** @type {Map<string, number>} */
  const died = new Map();
  let r = 0;
  for (const row of spec.rows) {
    if (row.type === "end-era") {
      const open = eras.at(-1);
      if (!open || open.end) throw new Error(`${spec.id}: stray end-era`);
      open.end = r;
      continue;
    }
    r++;
    placed.push({ row, r });
    if (row.type === "era") {
      const open = eras.at(-1);
      if (open && !open.end) {
        throw new Error(`${spec.id}: era "${open.era.title}" is not closed`);
      }
      eras.push({ era: row, start: r, end: 0 });
    } else if (row.type !== "gap") {
      for (const [id, mark] of Object.entries(row.marks)) {
        lane(id); // throws on an unknown id
        if (mark === "birth") born.set(id, r);
        if (mark === "death") died.set(id, r);
      }
    }
  }
  const last = eras.at(-1);
  if (last && !last.end) {
    throw new Error(`${spec.id}: era "${last.era.title}" is not closed`);
  }
  const rows = r;

  // The decorative layer: era bands, thin-record hatching, lanes.
  const layer = [];
  for (const { era, start, end } of eras) {
    layer.push(
      `<span class="ll-band" style="grid-row:${start}/${end + 1}"></span>`
    );
    for (const id of era.thin ?? []) {
      layer.push(
        `<span class="ll-thin" data-lane="${lane(id)}" style="grid-column:${col(id)};grid-row:${start}/${end + 1}"></span>`
      );
    }
  }
  for (const p of spec.people) {
    const k = lane(p.id);
    const from = p.before ? 1 : born.get(p.id);
    if (from === undefined) {
      throw new Error(`${spec.id}: "${p.id}" has no birth row and no "before"`);
    }
    const to = died.get(p.id);
    const attrs = `data-lane="${k}"${p.before ? ' data-from="before"' : ""}`;
    if (to === undefined) {
      layer.push(
        `<span class="ll-lane" ${attrs} data-to="after" style="grid-column:${k + 1};grid-row:${from}/${rows + 1}"></span>`
      );
    } else {
      if (to > from) {
        layer.push(
          `<span class="ll-lane" ${attrs} style="grid-column:${k + 1};grid-row:${from}/${to}"></span>`
        );
      }
      layer.push(
        `<span class="ll-tail" data-lane="${k}" style="grid-column:${k + 1};grid-row:${to}"></span>`
      );
    }
  }

  // The rows themselves.
  const items = [`<li class="ll-layer" ${HIDDEN}>${layer.join("")}</li>`];
  for (const { row, r } of placed) {
    if (row.type === "era") {
      items.push(
        `<li class="ll-era" style="grid-row:${r}"><span>${esc(row.title)}</span></li>`
      );
    } else if (row.type === "gap") {
      items.push(
        `<li class="ll-gap" style="grid-row:${r}" ${HIDDEN}><span>⋮</span><span>${esc(row.label)}</span></li>`
      );
    } else {
      items.push(eventItem(row, r));
    }
  }

  /**
   * @param {EventRow} row
   * @param {number} r
   */
  function eventItem(row, r) {
    const involved = new Set(Object.keys(row.marks).map(lane));
    const parts = [
      `<time class="ll-when" datetime="${esc(row.datetime)}">${esc(row.when)}</time>`,
    ];
    if (row.link) {
      const a = lane(row.link.from);
      const b = lane(row.link.to);
      involved.add(a).add(b);
      parts.push(
        `<span class="ll-link" data-k="${row.link.kind}" data-dir="${b > a ? "r" : "l"}" style="grid-column:${Math.min(a, b) + 1}/${Math.max(a, b) + 2}" ${HIDDEN}></span>`
      );
    }
    for (const [id, mark] of Object.entries(row.marks)) {
      parts.push(
        `<span class="ll-mk" data-k="${mark}" data-lane="${lane(id)}" style="grid-column:${col(id)}" ${HIDDEN}></span>`
      );
    }
    const links = [];
    if (row.see) {
      links.push(`<a href="${esc(row.see.href)}">${esc(row.see.label)}</a>`);
    }
    for (const n of row.refs ?? []) {
      links.push(`<a href="${SOURCES}" aria-label="source ${n}">[${n}]</a>`);
    }
    parts.push(
      `<div class="ll-txt"><strong class="ll-h">${row.title}</strong>` +
        (row.pill ? ` <span class="ll-pill">${esc(row.pill)}</span>` : "") +
        (row.text ? ` <span class="ll-p">${row.text}</span>` : "") +
        (links.length
          ? ` <span class="ll-see">${links.join(" · ")}</span>`
          : "") +
        `</div>`
    );
    const lanesAttr = [...involved].sort((x, y) => x - y).join(" ");
    return (
      `<li class="ll-ev" style="grid-row:${r}" data-lanes="${lanesAttr}"${row.repeat ? " data-repeat" : ""}>` +
      parts.join("") +
      `</li>`
    );
  }

  const name = esc(spec.id);
  const pick = [
    `<fieldset class="ll-pick">`,
    `<legend class="ll-sr">Highlight one life</legend>`,
    ...spec.people.map(
      p =>
        `<label class="ll-chip" style="grid-column:${col(p.id)}"><input class="ll-sr" type="radio" name="${name}" value="${lane(p.id)}"><span>${esc(p.name)}</span></label>`
    ),
    `<div class="ll-pick-txt">`,
    `<label class="ll-all"><input class="ll-sr" type="radio" name="${name}" value="0" checked><span>Everyone</span></label>`,
    `<p class="ll-bio" data-lane="0">${esc(spec.hint)}</p>`,
    ...spec.people.map(
      p => `<p class="ll-bio" data-lane="${lane(p.id)}">${p.bio}</p>`
    ),
    `</div>`,
    `</fieldset>`,
  ];

  const legend = [
    `<ul class="ll-legend" aria-label="Legend">`,
    `<li><span class="ll-key" data-k="event" ${HIDDEN}></span>documented in the numbered sources</li>`,
    `<li><span class="ll-key" data-k="hedged" ${HIDDEN}></span>a later retelling</li>`,
    `<li><span class="ll-key" data-k="thin" ${HIDDEN}></span>a thin record</li>`,
    `<li><span class="ll-key" data-k="pass" ${HIDDEN}></span>passed from one life to another</li>`,
    `<li><span class="ll-key" data-k="split" ${HIDDEN}></span>a family separated</li>`,
    `</ul>`,
  ];

  return [
    `<figure class="lifelines not-prose" id="${name}" style="--ll-n:${spec.people.length}">`,
    `<div class="ll-head">`,
    `<p class="ll-title">${esc(spec.title)}</p>`,
    ...legend,
    `</div>`,
    ...pick,
    `<ol class="ll-grid" style="--ll-rows:${rows}">`,
    ...items,
    `</ol>`,
    `<figcaption>${spec.caption}</figcaption>`,
    `</figure>`,
  ].join("\n");
}
