// @ts-check
/**
 * Data for the four-generation figure in
 * src/data/blog/the-house-the-father-and-the-tree-tarkovsky.md.
 *
 * Rule: the figure must not know more than the essay. Every row restates a
 * fact the essay's text already gives, and `refs` point at the essay's own
 * numbered sources. Add a fact to the text (with its source) before adding
 * it here. After editing, run `pnpm figures` to rewrite the post.
 */

const FATHER = {
  href: "#the-father-arseny-tarkovsky-and-the-revolution",
  label: "The father",
};
const SON = {
  href: "#the-son-a-reunion-in-the-shadow-of-death",
  label: "The son",
};
const MIRROR = {
  href: "#mirror-the-family-becomes-cinematic-time",
  label: "Mirror",
};
const NOSTALGHIA = {
  href: "#nostalghia-leaving-without-planning-to-be-an-exile",
  label: "Nostalghia",
};
const TREE = { href: "#the-tree-the-sacrifice-1986", label: "The tree" };

/** @type {import("./lifelines.mjs").Lifelines} */
export default {
  id: "tarkovsky-lifelines",
  title: "Four generations, one timeline",
  hint: "Pick a name to follow one life; the others fade.",
  people: [
    {
      id: "alexander",
      name: "Alexander K.",
      bio: "<strong>Alexander Karlovich Tarkovsky</strong>, 1862–1924. In the 1880s, a member of a populist circle linked to Narodnaya Volya: three years in prison, five in Siberian exile.",
      before: true,
    },
    {
      id: "arseny",
      name: "Arseny",
      bio: "<strong>Arseny Tarkovsky</strong>, 1907–1989. Poet and translator; seven of his poems are spoken in his son's films.",
    },
    {
      id: "maria",
      name: "Maria",
      bio: "<strong>Maria Vishnyakova</strong>, 1907–1979. Proofreader at a Moscow printing house; raised Andrei and Marina after 1937.",
    },
    {
      id: "andrei",
      name: "Andrei",
      bio: "<strong>Andrei Tarkovsky</strong>, 1932–1986. Filmmaker; stayed in the West from 1984 and died in Paris.",
    },
    {
      id: "andrei-jr",
      name: "Andrei Jr.",
      bio: "<strong>Andrei Andreevich Tarkovsky</strong>, born 1970. Documentary filmmaker and keeper of his father's legacy.",
    },
  ],
  rows: [
    {
      when: "1880s",
      datetime: "1880",
      marks: { alexander: "event" },
      title: "Prison and exile",
      text: "Alexander Karlovich, in a populist circle linked to Narodnaya Volya, the organization that had assassinated Alexander II, serves three years in prison and five in exile in Eastern Siberia.",
      see: FATHER,
      refs: [10],
    },
    { type: "gap", label: "two decades" },
    {
      when: "1907",
      datetime: "1907",
      marks: { arseny: "birth", maria: "birth" },
      title: "Arseny and Maria are born",
      text: "Arseny in Elisavetgrad, in the south of the Russian Empire; Maria Vishnyakova, his future wife, the same year.",
      see: FATHER,
    },
    { type: "gap", label: "ten years" },
    {
      type: "era",
      title: "Revolution and civil war, 1917–1921",
      thin: ["maria"],
    },
    {
      when: "May 1919",
      datetime: "1919-05",
      marks: { arseny: "event" },
      title: "Valery is killed",
      text: "Arseny's elder brother dies in battle against the forces of Nykyfor Hryhoriv. Arseny is eleven.",
      see: FATHER,
      refs: [2],
    },
    {
      when: "1921",
      datetime: "1921",
      marks: { arseny: "hedged" },
      title: "Arrest and escape, as later told",
      text: "An anti-Lenin acrostic in a local newspaper, an arrest, and an escape on the way to trial.",
      see: FATHER,
      refs: [2, 10],
    },
    { type: "end-era" },
    {
      when: "1924",
      datetime: "1924",
      marks: { alexander: "death" },
      title: "Alexander Karlovich dies",
    },
    { type: "gap", label: "eight years" },
    {
      when: "1932",
      datetime: "1932",
      marks: { arseny: "node", maria: "node", andrei: "birth" },
      link: { from: "arseny", to: "andrei", kind: "family" },
      title: "Andrei is born",
      text: "His sister, Marina, follows in 1934.",
      see: FATHER,
    },
    {
      when: "1937",
      datetime: "1937",
      marks: { arseny: "event", maria: "node" },
      link: { from: "arseny", to: "maria", kind: "split" },
      title: "The household divides",
      text: "Arseny leaves the family. Maria, a proofreader at a Moscow printing house, raises the children; <em>Mirror</em> will return to both.",
      see: FATHER,
      refs: [9],
    },
    { type: "era", title: "War, 1941–1945" },
    {
      when: "Dec 1943",
      datetime: "1943-12",
      marks: { arseny: "event" },
      title: "A war correspondent is wounded",
      text: "Arseny is hit at the front; his leg is amputated.",
      see: FATHER,
      refs: [2],
    },
    { type: "end-era" },
    { type: "gap", label: "nineteen years" },
    {
      when: "1962",
      datetime: "1962",
      marks: { arseny: "event", andrei: "event" },
      link: { from: "arseny", to: "andrei", kind: "rhyme" },
      title: "Two debuts in one year",
      text: "Arseny's first collection of his own poems; Andrei's first feature, <em>Ivan's Childhood</em>.",
      see: FATHER,
    },
    {
      when: "1970",
      datetime: "1970",
      marks: { andrei: "node", "andrei-jr": "birth" },
      link: { from: "andrei", to: "andrei-jr", kind: "family" },
      title: "Andrei Andreevich is born",
      text: "The son of Andrei and his second wife, Larisa.",
      see: SON,
    },
    {
      when: "1975",
      datetime: "1975",
      marks: { arseny: "node", andrei: "event" },
      link: { from: "arseny", to: "andrei", kind: "pass" },
      title: "<em>Mirror</em>",
      pill: "4 poems",
      text: "Arseny reads four of his poems, in his own voice, over his son's remembered childhood.",
      see: MIRROR,
      refs: [8],
    },
    {
      when: "1979",
      datetime: "1979",
      marks: { arseny: "node", andrei: "event" },
      link: { from: "arseny", to: "andrei", kind: "pass" },
      title: "<em>Stalker</em>",
      pill: "1 poem",
      text: "The Stalker recites “So Summer Has Passed” in the Zone.",
      see: FATHER,
      refs: [8],
    },
    {
      when: "1979",
      datetime: "1979",
      repeat: true,
      marks: { maria: "death" },
      title: "Maria dies",
    },
    { type: "era", title: "Abroad, 1982–1986" },
    {
      when: "1982",
      datetime: "1982",
      marks: { andrei: "event", "andrei-jr": "node" },
      link: { from: "andrei", to: "andrei-jr", kind: "split" },
      title: "To Italy, without his son",
      text: "Andrei leaves with official permission to make <em>Nostalghia</em>; the Soviet authorities keep the boy at home.",
      see: NOSTALGHIA,
    },
    {
      when: "1983",
      datetime: "1983",
      marks: { arseny: "node", andrei: "event" },
      link: { from: "arseny", to: "andrei", kind: "pass" },
      title: "<em>Nostalghia</em>",
      pill: "2 poems",
      text: "Gorchakov recites one of Arseny's poems from memory; another is heard in Italian.",
      see: FATHER,
      refs: [8],
    },
    {
      when: "10 Jul 1984",
      datetime: "1984-07-10",
      marks: { andrei: "event" },
      title: "Milan: he will not return",
      text: "A press conference announces his decision to stay in the West.",
      see: NOSTALGHIA,
      refs: [4],
    },
    {
      when: "19 Jan 1986",
      datetime: "1986-01-19",
      marks: { andrei: "event", "andrei-jr": "event" },
      link: { from: "andrei-jr", to: "andrei", kind: "join" },
      title: "Reunion in Paris",
      text: "Andrei Jr., fifteen, arrives with his grandmother, Anna Egorkina, eighty-five. Chris Marker films it.",
      see: SON,
      refs: [1],
    },
    {
      when: "1986",
      datetime: "1986",
      marks: { andrei: "node", "andrei-jr": "event" },
      link: { from: "andrei", to: "andrei-jr", kind: "pass" },
      title: "<em>The Sacrifice</em>",
      pill: "dedication",
      text: "The last film is dedicated to his son, with hope and confidence.",
      see: TREE,
    },
    {
      when: "29 Dec 1986",
      datetime: "1986-12-29",
      marks: { andrei: "death" },
      title: "Andrei dies in Paris",
      text: "He is fifty-four. Father and son have had less than a year together.",
      see: SON,
    },
    { type: "end-era" },
    {
      when: "May 1989",
      datetime: "1989-05",
      marks: { arseny: "death" },
      title: "Arseny dies",
      text: "The poet outlives his son by almost two and a half years.",
      see: FATHER,
      refs: [2],
    },
    { type: "gap", label: "thirty years" },
    {
      when: "2019",
      datetime: "2019",
      marks: { "andrei-jr": "event", andrei: "ghost" },
      link: { from: "andrei-jr", to: "andrei", kind: "pass" },
      title: "<em>A Cinema Prayer</em>",
      pill: "archive",
      text: "Andrei Jr. builds a film from archival material and his father's own words.",
      see: SON,
    },
  ],
  caption:
    'The people this essay follows, one lane per life, with time running down the page and long silences marked. Each row links (§) to the section of the essay that tells its story, and to the numbered sources. Tarkovsky also had an elder son, Arseny (born 1962), from his first marriage, to <a href="https://en.wikipedia.org/wiki/Irma_Raush">Irma Raush</a>; this essay follows the younger son, Andrei.',
};
