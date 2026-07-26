# Design: "Using PCRE Regex in Go in 2026: A Deep Dive" blog post

**Date:** 2026-04-25
**Status:** Approved (pending implementation plan)
**Owner:** franchb
**Branch:** `blog/pcre-go-2026` (from `main`, no worktree)

## Goal

Package an existing ~4,000-word body of research into a single deep-dive
blog post on whether you can get PCRE-compatible regex behavior in pure
Go in 2026 — specifically whether compiling PCRE2 to WebAssembly and
transpiling it to Go via `ncruces/wasm2go` is a viable production
approach. The verdict is "technically viable, but the wrong tool"; the
post lays out a concrete decision framework.

This is a writing task, not a code task. One new Markdown file.

## Non-goals

- Benchmarks not personally run (cite the OpenResty / GNOME GtkSourceView /
  pg_jitter figures as sourced, not as our own).
- A working `go-pcre2` PoC. Shipping a library is a separate project.
- Site-config, theme, or schema changes.
- Backfilling additional posts to populate the tag taxonomy.
- Verifying the brief's verbatim stats against live sources mid-draft.
  (Separate optional verification pass; flagged as a risk, not blocking.)

## Artifact

- **Path:** `src/data/blog/pcre-regex-in-go-2026.md` (new file, sole change)
- **URL:** `/posts/pcre-regex-in-go-2026/`
- **Schema:** `src/content.config.ts:8-25` (Zod)
- **Length target:** 2,800–3,200 words. House baseline (`fp-go-skill`
  post) is ~2,200; this material warrants the extension.

## Front matter (verbatim, locked)

```yaml
---
title: "Using PCRE Regex in Go in 2026: A Deep Dive"
author: franchb
pubDatetime: 2026-04-25T09:00:00Z
featured: true
draft: false
tags:
  - golang
  - regex
  - pcre
  - wasm
  - supply-chain
description: "Can you use PCRE2 in pure Go via WASM and wasm2go in 2026? The path works — but it is the wrong choice for production. A decision framework, including the supply-chain angle most posts miss."
---
```

Notes:

- `pubDatetime` is **today** (2026-04-25), not the brief's 2026-04-22.
  Same-day publication, no back-dating.
- Tags extend the existing taxonomy (`claude-code`, `golang`, `security`,
  `open-source`, `personal`) with four new ones: `regex`, `pcre`, `wasm`,
  `supply-chain`. The Zod schema permits any string array, so no
  taxonomy migration is needed.
- `featured: true` matches the fp-go-skill post; this is intended as a
  prominent post.

## Voice baseline

The voice baseline is the existing featured post, "Building a Claude Code
Skill Plugin from Scratch" (`/posts/building-claude-code-skill-plugins/`,
~2,200 words). Distinguishing characteristics to mirror:

- **Opening pattern:** narrative hook ("I have been working with…")
  → stake out subject → state thesis. Not "TL;DR first" — the hook
  earns the verdict.
- **First-person, opinionated, direct.** "Here is what I would tell
  someone…" — instructional but personal.
- **Bullets with bold lead-ins:** `**Hidden Unicode detection** — scans
  for…`. Used heavily for enumerations.
- **Em dashes (`—`)** for clauses and asides; freely used.
- **`_italic_`** for emphasis on a single word.
- **`## H2`** for sections, **`### H3`** sparingly for nested topics.
  Never `#` H1 in the body — front-matter `title` becomes the H1.
- **`## Table of contents`** as a bare marker line — `remark-toc` (in
  `package.json`) auto-populates.
- **Code fences with language hints:** `bash`, `json`, `yaml`, `c`,
  `go`. Required for Astro's syntax highlighting.
- **Closing `## Links` section** with `- [Name](URL) — short description`
  format. Curated, not exhaustive.
- **No emojis, no Mermaid, no admonitions, no custom shortcodes.**
  None of those appear elsewhere on this blog.

## Section structure

Thirteen units, in order:

1. **Opening hook (no heading)** — one narrative paragraph. Frame the
   CTO-level question. End with the verdict in one sentence.
2. **`## Table of contents`** — bare marker, no body.
3. **`## The short answer`** — 3–5 sentences. Default to
   `dlclark/regexp2`; fall back to `wasilibs`-style WASM-blob-plus-wazero
   for true PCRE2 semantics; do not promote `wasm2go` to a production
   pattern. Specify PCRE2 10.47, not PCRE 8.x.
4. **`## What wasm2go actually is`** — AOT Wasm→Go transpiler, pure-Go
   output, no wazero at runtime but also no sandbox at runtime.
   Maturity signals: **111 stars, 78 commits, 1 tag, bus factor = 1**.
   `go-sqlite3` (**926 stars, 593 dependents, v0.31.1 March 2026**) as
   the only real consumer.
5. **`## PCRE flavor: PCRE2, not PCRE 8.x`** — definitive. **PCRE 8.45
   (2021) is the final PCRE1 release.** Philip Hazel refused the
   PCRE2Project migration because he doesn't want to encourage PCRE1
   use. **PCRE2 10.47 (21 Oct 2025) is current; 10.48 on master.**
   PCRE2 10.30+ is heap-recursive, which matters on a small Wasm stack.
   License: **BSD-3-Clause WITH PCRE2-exception**.
6. **`## The compilation pipeline`** — JIT off-limits on Wasm (not in
   sljit target list; Wasm forbids RWX memory); must build with
   `--disable-jit`. **3–10× typical slowdown, 15–25× worst case** on
   backtracking-heavy patterns. `setjmp`/`longjmp` non-issue once JIT
   is off. wasi-sdk vs Emscripten trade-off. Binary size **~400–700 kB
   Wasm (150–250 kB is Unicode tables)**. Go↔Wasm boundary: **50–100×
   overhead on tiny inputs**, needs batching.
7. **`## Prior art: one stale experiment, and a telling counter-example`**
   — `bobby-stripe/go-pcre` (**v1.0.1, Oct 2021, PCRE2 10.38, zero
   pkg.go.dev importers**); OWASP Coraza v2 had optional cgo PCRE
   (`coraza-pcre`), v3 is RE2-only (Anuraag Agrawal's CNCF talk
   justifies the move); `wasilibs` ships `go-re2`, `go-aho-corasick`,
   `go-pgquery`, `go-yamllint`, and more — but no `go-pcre2`. This is
   the revealed-preference argument.
8. **`## The realistic alternatives`** — narrative comparison:
   - `dlclark/regexp2` (**~1.2k stars, pure-Go .NET-port backtracking
     NFA**, no `\K`/`(?R)`/callouts; **`MatchTimeout` uses a shared
     ticker goroutine, ~100 ms, ~0.15% background CPU**, mandatory on
     untrusted input).
   - cgo paths (`GRbit/go-pcre`, `jemmic/go-pcre2`) — disqualified by
     pure-Go / distroless requirements.
   - Rust paths (`rure-go`, `fancy-regex`) — don't solve the problem.
   - ccgo options (`go.elara.ws/pcre`, `modernc.org/libpcre2-*`) —
     niche but closest thing to "pure-Go PCRE2" today.
9. **`## Decision matrix`** — single Markdown table. Columns: approach
   × **pure-Go / cross-compile / feature coverage / perf / binary size /
   build complexity / maintenance / supply chain**. Rows: each approach
   from §8 plus the `wasm2go` and `wasilibs`-WASM patterns.
10. **`## Supply-chain posture under SLSA and distroless`** — explicit
    bridge to the fp-go-skill post's SLSA L3 thesis. `regexp2` wins on
    this axis (one SBOM line, one Cosign signature, one SLSA
    provenance). `wasilibs` pattern is the right second choice
    (Cosign has first-class Wasm support; sign `.wasm` and binary
    independently, keep the sandbox). `wasm2go` has a longer
    provenance chain; standard SBOM tools (`syft`, `trivy`) won't
    introspect generated Go back to its C ingredients.
11. **`## Concrete recommendation`** — three-tier list:
    - **Default:** `dlclark/regexp2` with `MatchTimeout` on every
      instance.
    - **Fallback (hard PCRE2 needs):** build a fresh `go-pcre2` in the
      `wasilibs` style with PCRE2 10.47, `--disable-jit`, wasi-sdk,
      wazero.
    - **Narrow case (`wasm2go`):** absolute no-wazero-at-runtime
      constraint AND willingness to own the transpiler as a build-time
      dep AND willingness to audit the generated Go.
12. **`## Conclusion`** — revealed-preference closer: the two groups
    with the strongest incentive and capability to ship PCRE-in-Wasm
    for Go (`wasilibs` and Coraza) both chose not to. That is the
    single most important input to the decision, above any benchmark.
13. **`## Links`** — curated external-link list:
    - `ncruces/wasm2go`
    - `bobby-stripe/go-pcre`
    - `dlclark/regexp2`
    - `wasilibs/go-re2`
    - OWASP Coraza
    - PCRE2 home
    - `wazero`
    - `ncruces/go-sqlite3`
    - SLSA
    - Sigstore Cosign

`### H3` subheadings used **only** in §6 (compilation pipeline), §8
(realistic alternatives), and §11 (concrete recommendation) where the
material clusters naturally. All other sections stay flat at `##` to
keep the auto-TOC shallow.

## Facts to preserve verbatim or near-verbatim

These must survive editing — they are the load-bearing evidence of
the post:

- `wasm2go`: 111 stars, 2 forks, 78 commits, 1 tag, bus factor = 1
- `go-sqlite3`: 926 stars, 593 dependents, v0.31.1 (March 2026)
- PCRE 8.45 (2021) is the final PCRE1 release; PCRE2 10.47 (21 Oct
  2025) current; 10.48 on master
- JIT-off penalty: 3–10× typical; 15–25× worst case
- Wasm binary: 400–700 kB with Unicode; 150–250 kB of that is Unicode
  tables
- Go↔Wasm boundary: 50–100× overhead on tiny inputs, needs batching
- `bobby-stripe/go-pcre`: last tag v1.0.1 (Oct 2021), PCRE2 10.38,
  zero pkg.go.dev importers
- `regexp2`: ~1.2k stars, backtracking NFA, `MatchTimeout` uses a
  shared ticker goroutine (~100 ms, ~0.15% background CPU)
- `wazero`: ~6k stars, Tetrate-sponsored, 10× compiler-vs-interpreter
  speedup
- Coraza v2 had optional PCRE cgo plugin (`coraza-pcre`); v3 is
  RE2-only; Anuraag Agrawal gave the CNCF talk justifying the move
- License: PCRE2 is BSD-3-Clause WITH PCRE2-exception

These come from the brief and are treated as cited research, not
original measurements.

## Verification

Acceptance criteria — all must pass before merging the PR.

1. **Schema:** `pnpm sync` succeeds (runs `astro sync`). The Zod
   schema in `src/content.config.ts` enforces required fields
   (`pubDatetime`, `title`, `description`); a malformed `pubDatetime`
   or a missing required field fails the build. Unknown keys are
   stripped silently by Zod (no `.strict()` call) — they will not
   fail the build, but they also won't reach the page, so a typo
   like `pubDatetiem:` would manifest as a *missing* `pubDatetime`
   error rather than an "unknown key" error.
2. **Build:** `pnpm build` succeeds end-to-end. The script chain is
   `astro check && astro build && pagefind --site dist && cp -r
   dist/pagefind public/`.
3. **Dev preview:** `pnpm dev`, navigate to
   `/posts/pcre-regex-in-go-2026/`, visually confirm:
   - Title renders as H1 from front-matter
   - No stray `#` H1 leaks from the body
   - Auto-TOC populates from `##` headings via remark-toc
   - Decision matrix table renders correctly (no overflow on a
     desktop viewport; mobile-overflow is acceptable but flagged)
   - Code fences render with syntax-highlighted language colors
   - Every external link in `## Links` renders as a live `<a>` tag
4. **Length:** word count ≥ 2,800 and ≤ 3,200 (use `wc -w` against
   the body, excluding front matter).
5. **Voice consistency:** spot-check three sections against the
   fp-go-skill post for tone, bullet style, and opinionated framing.
6. **Stat preservation:** every number in the "Facts to preserve"
   list above appears in the final post.

## Git workflow

1. Branch from `main`: `git checkout -b blog/pcre-go-2026`.
2. Write `src/data/blog/pcre-regex-in-go-2026.md`.
3. Run verification (steps 1–6).
4. Commit: `feat: add deep-dive blog post on PCRE regex in Go`.
   (Conventional-commit style — matches existing repo log: `feat:`,
   `fix:`, `chore:`.)
5. Push: `git push -u origin blog/pcre-go-2026`.
6. Open **draft PR** against `main` via GitHub MCP. Title same as
   commit. Body: 1-paragraph summary, link to this spec, verification
   checklist mirroring §Verification.
7. Do not merge from this session. User reviews, requests changes if
   any, merges manually.

## Risks and mitigations

- **Stat staleness.** The brief's numbers (e.g., wasm2go star count)
  may have shifted since research was completed. *Mitigation:* use
  brief's numbers verbatim. Optional verification pass added to
  implementation plan as a separate, post-draft step if user requests.
- **Voice drift on length expansion.** fp-go-skill is 2,200 words;
  pushing past 3,000 risks diluting tone. *Mitigation:* hard cap at
  3,200; trim aggressively (collapse repeated points like "Coraza
  walked away" — appears three times in raw research) before claiming
  done.
- **Decision-matrix table overflow.** AstroPaper's prose width is
  narrow; an 8-column table may overflow on mobile. *Mitigation:*
  visually preview before claiming done. If unusable, collapse
  related axes (e.g., merge "build complexity" + "maintenance" into
  "ops"; merge "binary size" + "perf" into "runtime cost") to reduce
  to 5–6 columns. Document the choice inline in the implementation
  plan.
- **Auto-TOC depth.** If `### H3` subsections proliferate, the TOC
  becomes noisy. *Mitigation:* use `### H3` only in §6, §8, §11 as
  specified; do not add elsewhere without re-checking the rendered
  TOC.
- **Front-matter typos go silent.** Zod strips unknown keys without
  warning, so a misspelled key (e.g., `pubDatetiem:`) is dropped and
  surfaces only as a "missing required field" error on the *correct*
  key — not as an "unknown key" error. *Mitigation:* the locked
  front-matter block above is the source of truth; copy it verbatim,
  do not retype keys.

## Out-of-scope (explicit)

- Benchmarks not personally run.
- A working `go-pcre2` PoC.
- Site-config, theme, schema, or build changes.
- Other blog posts.
- Stat verification pass (separate optional step).
- Tag-page polishing or taxonomy housekeeping.

## References

- Style baseline: existing post at `/posts/building-claude-code-skill-plugins/`
  (filed at `src/data/blog/building-claude-code-skill-plugins.md` in the
  deployed branch; not present locally on `main` at time of writing).
- Schema: `src/content.config.ts:8-25`.
- Package manager: pnpm 10.29.3 (`package.json:packageManager`).
- Astro: 6.1.5. AstroPaper v5.5.1.
- TOC plugin: `remark-toc` 9.x (`package.json:dependencies`).
