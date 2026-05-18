---
title: "Using PCRE Regex in Go in 2026: A Deep Dive"
author: franchb
pubDatetime: 2026-05-18T09:00:00Z
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

A question that keeps coming up in Go infrastructure work: how do you get PCRE-compatible regex behavior in a codebase that wants to stay pure-Go, cross-compile cleanly, and ship in distroless images? The standard library's `regexp` package is fast and safe, but it is RE2 — no lookaround, no backreferences, no `\K`. So engineers reach for cgo bindings to libpcre2, hate the distroless story, then ask whether they can compile PCRE2 to WebAssembly and either run it through `wazero` or, more aggressively, transpile the resulting Wasm to Go using `ncruces/wasm2go`. I spent some time researching that second path. The short version is that it works, and it is the wrong choice. This post walks through the engineering reality and lays out a decision framework that takes supply-chain posture seriously.

## Table of contents

## The short answer

Ship [`dlclark/regexp2`](https://github.com/dlclark/regexp2) by default, with `MatchTimeout` set on every instance. For the ~95% of real-world PCRE patterns that do not depend on `\K`, recursion, or callouts, this is the right answer: pure Go, cross-compilable, distroless-friendly, and battle-tested. If you have hard PCRE2 requirements that `regexp2` cannot meet, build a fresh `go-pcre2` library in the `wasilibs` style — a `.wasm` blob embedded into Go and executed by `wazero` at runtime — not via `wasm2go`. The PCRE flavor question, separately, has one correct answer: **PCRE2 10.47**. PCRE 8.x has been end-of-life since 2021 and its original maintainer explicitly discourages new use.

The rest of this post explains why.

## What wasm2go actually is

[`github.com/ncruces/wasm2go`](https://github.com/ncruces/wasm2go) is an **AOT source-to-source translator**: `wasm2go < input.wasm > output.go` consumes a WebAssembly module and emits a single, self-contained Go source file whose exports are the Wasm module's exports and whose imports are Go interfaces the caller must satisfy. Critically, **the output has no runtime dependency on `wazero` or any other Wasm engine** — it is pure Go, stdlib-only. That is genuinely different from the `wasilibs` / `go-re2` pattern, where a `.wasm` blob is embedded and executed by the `wazero` runtime at runtime.

The maturity picture is sobering. The repository shows **111 stars, 2 forks, 78 commits, exactly 1 tag, 0 open issues, and 2 open PRs** — a single-author project by Nuno Cruces, explicitly scoped to "a useful subset of Wasm produced by `clang`." The README states this plainly: *"Only a subset of the Wasm specification will be supported, as the goal is to translate specific Wasm modules to Go."* Supported Wasm 2.0 features are bulk memory, reference types, non-trapping float-to-int, sign-extension, and multi-values; **SIMD, threads, and exceptions are not supported** (SIMD is deliberately omitted because LLVM can be told not to emit it). There is no built-in WASI layer — preview1 or preview2 imports must be supplied by the caller as Go interfaces.

`wasm2go`'s *only significant downstream user* is [`ncruces/go-sqlite3`](https://github.com/ncruces/go-sqlite3) (926 stars, 593 dependents, v0.31.1 as of March 2026). Even there, the migration appears to be in progress: the README still says "uses wazero as the runtime," but the GitHub description and pkg.go.dev now say "uses wasm2go to translate it to Go" and list only "Go and x/sys" as direct dependencies. **Outside `go-sqlite3`, there is no visible production use of `wasm2go`.** If you adopt it as a build-time dependency for a regex library, you are betting on a tool whose bus factor is one, whose spec coverage is deliberately narrow, and whose validation surface is one specific consumer.

This matters because **the attractive property of the `wasm2go` approach — pure-Go output, no `wazero` at runtime — comes with a matching liability: you also lose the Wasm sandbox at runtime.** A transpiled PCRE2 runs as normal Go code against a linear-memory byte slice; any out-of-bounds or use-after-free bug in the C source that was masked by `wazero`'s sandbox becomes a normal Go bug in your process. The `wasilibs` pattern keeps the sandbox at the cost of a `wazero` dependency. That is not a free trade.

## PCRE flavor: PCRE2, not PCRE 8.x

This part is unambiguous. **PCRE 8.45 (2021) is the final release of the legacy library.** pcre.org states: *"The old libraries (now called PCRE1) are now at end of life, and 8.45 is the final release. New projects are advised to use the new PCRE2 libraries."* Philip Hazel, the original maintainer, refused in 2022 to move PCRE1 under the new `PCRE2Project` GitHub organization because *"I really don't want to encourage the use of PCRE1 in any way."* New maintainers took over PCRE2 in early 2025, released 10.45 (February 2025), 10.46, and **10.47 (21 October 2025)**, with 10.48 in development on `master`. No CVE backports go into 8.x.

Beyond maintenance, PCRE2 is *technically better for a WASM target*: since 10.30, matching uses **heap-allocated match frames rather than stack recursion**, which matters because Wasm stacks are small. The API is cleaner (`pcre2_compile`, `pcre2_match_data`, explicit 8/16/32-bit code-unit width via `PCRE2_CODE_UNIT_WIDTH`), it includes `pcre2_substitute()`, and every existing WASM port of PCRE in the wild — `@stephen-riley/pcre2-wasm`, `@jayay/pcre2-web`, `bobby-stripe/pcre2-wasm` — targets PCRE2. Licensing is **BSD-3-Clause WITH PCRE2-exception**, which relaxes the binary-redistribution clause and is friendlier for commercial use; PCRE1 is plain BSD. For a fresh project in 2026, there is no reason to touch PCRE 8.x.

## The compilation pipeline is a known problem with a non-trivial cost

Compiling PCRE2 to WebAssembly is well-trodden in JavaScript but poorly trodden in Go. The critical engineering facts:

**JIT is off-limits.** PCRE2's JIT is driven by `sljit`, whose supported targets are enumerated by pcre.org as "ARM 32-bit (v7, Thumb2), ARM 64-bit, IBM s390x, Intel x86 32/64, LoongArch 64, MIPS 32/64, PowerPC 32/64, RISC-V 32/64." **WebAssembly is not in that list**, and the Wasm spec forbids RWX executable memory anyway. You must build with `--disable-jit`, unconditionally, and accept the interpreter. Real-world benchmarks — OpenResty's regex bench, GNOME GtkSourceView's 2020 syntax-highlighting measurements, and pg_jitter — converge on a **3–10× slowdown from losing JIT**, with worst cases on backtracking-heavy patterns reaching **15–25×**. For any PCRE2 use case where people currently reach for PCRE2 precisely *because* of the JIT (WAF rule evaluation, log parsing at Gbps, deep-packet inspection), this is the main engineering objection.

**`setjmp`/`longjmp` is a non-issue once JIT is disabled.** PCRE2's core interpreter uses heap-allocated match frames since 10.30, so `setjmp`/`longjmp` is only pulled in by the JIT's stack-protection path. With `--disable-jit`, the dependency effectively disappears. This is fortunate because WASM `setjmp` support is uneven: Emscripten handles it via either a JS-emulated mode or the Wasm EH proposal, while wasi-sdk support is experimental (PR #467 to wasi-libc; requires `-mllvm -wasm-enable-sjlj` and a runtime that provides `env:__c_longjmp`). **pthreads are not required** — PCRE2 is thread-safe without internal threads.

**Toolchain choice: wasi-sdk for new Go work, Emscripten if reusing existing artifacts.** Emscripten emits `.wasm` plus a JS glue file; for a Go/`wazero` host you would have to manually stub the JS-emulated syscalls. wasi-sdk emits a clean `.wasm` with WASI preview1 imports that `wazero` natively serves, at the cost of ~10–30% larger binaries for equivalent C. Every existing PCRE2-WASM artifact in the wild is Emscripten-built, which is why `bobby-stripe/go-pcre` bundles its own Go-based WASM interpreter rather than using `wazero`.

**Binary size is ~400–700 kB of Wasm with Unicode enabled**, of which ~150–250 kB is Unicode property and case-mapping tables. Disabling Unicode (`--disable-unicode`) materially shrinks it but removes `\p{...}` and UTF modes — usually not acceptable. Transpiled through `wasm2go`, the Go source is much larger on disk than the `.wasm` (the HN discussion of `wasm2go` notes SQLite at ~20 MiB of generated Go), though the final compiled Go binary size delta is what matters, and it is significantly smaller than the source file.

**ABI is Go-classic.** You allocate a buffer inside the module's linear memory, copy your input bytes in, call the exported `pcre2_match_8` (or equivalent), and read the ovector and match-data back out:

```go
// rough shape of what the host side looks like
buf := module.AllocBytes(input)
defer module.Free(buf)
rc := module.Call("pcre2_match_8", compiledPattern, buf, len(input), 0, 0, matchData, matchCtx)
ovec := module.ReadOvector(matchData)
```

The Go↔Wasm boundary cost per call is small but non-zero. DoltHub and `wasilibs` have both reported that **naive wrappers incur 50–100× overhead on tiny inputs** and need batching plus exposed-global-stack tricks to amortize. For regex workloads against bytes ≥ 1 KB, the overhead is fine; for per-log-line matching of tiny strings at very high QPS, you will feel it.

## Prior art: one stale experiment, and a telling counter-example

[`github.com/bobby-stripe/go-pcre`](https://github.com/bobby-stripe/go-pcre) is the only project that has actually done what you would be considering. It is a fork of `gijsbers/go-pcre` that swaps the cgo bindings for a Go interpreter of PCRE2 compiled to Wasm, with JIT-related functions stripped. **Latest tag v1.0.1, October 2021. PCRE2 version 10.38 (nine versions behind current 10.47). Zero importers on pkg.go.dev. No HN or r/golang discussion.** It is a personal experiment by a Stripe engineer, not a maintained library, and it uses its own `gasm` interpreter rather than `wazero` — pre-dating `wazero`'s maturity.

The more important data point is **what Coraza did**. The OWASP Coraza WAF — a Go project that arguably needs PCRE more than almost anyone, because OWASP CRS rules are written in PCRE — consciously rejected the PCRE-in-WASM path. v2 offered optional PCRE via a cgo plugin (`coraza-pcre`); **v3 is RE2-only.** Anuraag Agrawal (the author of `wasilibs`) gave a CNCF talk titled *"High performance regular expressions using RE2 and WebAssembly, no cgo required"* justifying the choice: ReDoS-safe linear-time matching matters more than PCRE feature parity when the input is adversarial, and `wasilibs/go-re2` gives them both pure-Go builds and better performance on large payloads. The community that most needed PCRE features in Go **walked away from PCRE** rather than ship it over Wasm. That is a stronger negative signal than any benchmark.

There is also **no `wasilibs/go-pcre2` module**. The `wasilibs` org ships `go-re2`, `go-aho-corasick`, `go-pgquery`, `go-shellcheck`, `go-yamllint`, various protoc plugins, and more — but no PCRE. This is a visible gap: the pattern absolutely works (`go-re2` proves it), but nobody has built it, presumably because Coraza, the main would-be consumer, chose RE2 instead.

## The realistic alternatives

**The de facto pure-Go answer today is [`github.com/dlclark/regexp2`](https://github.com/dlclark/regexp2).** Around 1.2k stars, actively maintained, v2 released requiring Go 1.26, widely vendored (Grafana k6, Mimir, cortex-tools). It is a pure-Go port of .NET's `System.Text.RegularExpressions` — a backtracking NFA, not RE2-style. Its PCRE feature coverage is excellent:

- Positive and negative lookahead and lookbehind (including variable-width)
- Backreferences and named groups (.NET, Python, and PCRE syntaxes)
- Atomic groups `(?>…)`
- Conditionals `(?(expr)yes|no)`
- Inline mode modifiers
- Unicode properties
- `ECMAScript` and `RE2` compatibility modes

Gaps vs PCRE: **no `\K`, no `(?R)` recursion, no subroutine calls `(?1)`, no branch-reset, no callouts, no `*+`/`++` possessive-quantifier suffix syntax** (use atomic groups instead). There is a companion `regexp2cg` that emits AOT-generated Go for hot paths, claiming 3–10× runtime speedups.

The **critical operational caveat**: `regexp2` is backtracking and has **no linear-time guarantee** — catastrophic backtracking on adversarial patterns is a real DoS vector. It exposes `Regexp.MatchTimeout`, implemented via a shared background goroutine that ticks every 100 ms (about 0.15% background CPU while timeouts are active). **If untrusted users supply either the pattern or the input, `MatchTimeout` is not optional.**

```go
re := regexp2.MustCompile(pattern, regexp2.ECMAScript)
re.MatchTimeout = 100 * time.Millisecond  // do not skip this
```

**cgo alternatives** are the fastest path — `github.com/GRbit/go-pcre` (PCRE1 with JIT, ~47 stars, low velocity) and `github.com/jemmic/go-pcre2` (PCRE2 via cgo, niche) — but they violate the pure-Go requirement, break clean cross-compilation, force glibc/musl into distroless images, and pin you to host library versions. `github.com/gijsbers/go-pcre` is effectively abandoned (module last updated 2016); the GRbit fork is the best cgo PCRE option if you go that way.

**Rust-based paths do not help.** `BurntSushi/rure-go` is cgo to Rust's `regex` crate, which is RE2-style — no backreferences, no lookaround — so it does not solve the problem regardless of speed. Rust's `fancy-regex` crate would solve it (it adds lookaround and backreferences to the regex crate via a backtracking VM fallback), but **no Go binding exists today**, cgo or Wasm. Building one is a real engineering project.

**Interesting curiosities worth knowing about:** `go.elara.ws/pcre` (Elara6331) uses `modernc.org/ccgo` to **transpile PCRE2's C source directly to Go** — a different path than Wasm→Go, producing pure-Go PCRE2 without a Wasm interpreter at all. Similarly `modernc.org/libpcre2-8/-16/-32` (v0.0.132, April 2025) publishes ccgo-generated low-level PCRE2 bindings. Both are niche, the generated code must be regenerated per GOOS/GOARCH, and ergonomic wrappers are thin, but they are technically the closest things to "pure-Go PCRE2" that exist. Expect roughly 2–5× slowdown vs native C, no JIT. **Go stdlib `regexp`** (RE2) remains the sensible baseline for patterns that fit within RE2's semantics.

## Decision matrix

| Approach | Pure-Go | Cross-compile | PCRE feature coverage | Perf vs native PCRE2-JIT | Binary size | Build complexity | Maintenance | Supply chain |
|---|---|---|---|---|---|---|---|---|
| **dlclark/regexp2** | Yes | Full | ~95% (no `\K`, `(?R)`, callouts) | ~10–50× slower; +3–10× with `regexp2cg` | Small | Trivial | Low (one maintainer) | **Best** — 1 SBOM line |
| **WASM blob + wazero (wasilibs pattern)** | Yes | Full | 100% PCRE2 | ~3–10× slower (no JIT) | +400–700 kB Wasm | High (emcc/wasi-sdk in CI) | Medium — you maintain the build | Good — sign `.wasm` and binary |
| **wasm2go-transpiled PCRE2** | Yes | Full | 100% PCRE2 | ~3–10× slower + transpile overhead | Large generated .go | Very high | High — bus factor = 1 | Awkward — long provenance chain |
| **cgo → system PCRE2** | **No** | Broken | 100% + JIT | Baseline (fastest) | Small | Medium | Low (upstream handles it) | Fails distroless |
| **modernc.org/libpcre2 (ccgo)** | Yes | Per-arch regen | 100% PCRE2 | ~2–5× slower (no JIT) | Large | High | Medium | Opaque generated Go |
| **Go stdlib regexp (RE2)** | Yes | Full | RE2 only | Fast, linear-time | Zero | None | None | Best |
| **wasilibs/go-re2** | Yes | Full | RE2 only | Fast on large inputs | +re2.wasm | None (just import) | None | Excellent |

## Supply-chain posture under SLSA and distroless

Given the CTO framing — SLSA L3, Cosign signing, distroless images, reproducible builds — the ordering sharpens.

**`dlclark/regexp2` wins on this axis outright.** One Go module, one SBOM entry, one `cosign sign`, one in-toto SLSA provenance. The GitHub SLSA3 Go generator produces attested builds with no special handling. Smallest trusted computing base in absolute terms — you could, in principle, audit the ~15k LoC yourself. Risk concentrations: bus factor (Doug Clark is the primary maintainer) and ReDoS (backtracking engine, compensated by `MatchTimeout`).

**A `wasilibs`-style WASM-blob-plus-`wazero`** approach is the correct second choice *if PCRE2 semantics or adversarial-input performance are genuinely required*. Cosign has first-class Wasm support (`cosign upload wasm`, OCI-backed); you generate SLSA provenance for the `.wasm` artifact independently of the Go binary provenance, attach both, and verify both. You accept a fatter TCB (`wazero` compiler plus PCRE2 C code) but **keep the Wasm sandbox at runtime**, which contains any PCRE2 memory-safety bug within linear memory. This is the productionized pattern the Coraza ecosystem uses. `wazero` itself has roughly 6k stars, a major corporate sponsor (Tetrate), a 10× interpreter-to-compiler speedup, and production adopters including Apache Beam, Envoy, Hugo, and Redpanda Connect.

**`wasm2go` is the option to be most cautious about.** The provenance chain is longer (C source → Wasm → `wasm2go`-generated Go → Go binary), every hop needs its own attestation, and standard SBOM tools (`syft`, `trivy`) will not introspect the generated Go back to its C ingredients without you curating and attaching the metadata yourself. The "source" that gets signed is machine-translated Go that no human will meaningfully review, and you *lose* the Wasm sandbox at runtime — a C bug in PCRE2 becomes a native Go bug in your process. And the tool underpinning it all has a bus factor of one and essentially one production consumer. This is an acceptable bet if you are Nuno Cruces and also maintain SQLite bindings; it is a harder bet to defend at the CTO level.

**cgo-to-system-PCRE2 is disqualified** by distroless and hermetic build requirements regardless of how fast it is.

## Concrete recommendation

Three tiers, in order:

1. **Default: `dlclark/regexp2` with `MatchTimeout` set on every instance.** For ~95% of real-world PCRE patterns this is the right answer. Pure Go, cross-compilable, distroless-friendly, battle-tested in Grafana products, cleanest SLSA and Cosign story, feature-complete enough that the gaps (`\K`, `(?R)`, callouts, possessive-quantifier suffix syntax) rarely bite in practice, and the v2 release with `regexp2cg` codegen covers hot-path performance.

2. **If you have hard PCRE2 requirements that `regexp2` cannot meet** — typically because you are importing rules written in genuine PCRE that use recursion or `\K`, or because you need PCRE2 semantic equivalence for a compatibility test suite — **build a fresh `go-pcre2` in the `wasilibs` style.** Compile PCRE2 10.47 with `--disable-jit` via wasi-sdk, embed the `.wasm`, run it via `wazero`, and model the ergonomics after `wasilibs/go-re2`. This path is shovel-ready; the only reason it does not exist yet is that Coraza, the main would-be consumer, chose RE2 instead. Accept the 3–10× JIT-off penalty, keep the Wasm sandbox, sign the `.wasm` and binary independently with Cosign, and produce SLSA provenance for each.

3. **Reach for `wasm2go` only under narrow conditions:** you have an absolute no-`wazero`-at-runtime constraint (e.g., a highly constrained embedded Go target where even `wazero`'s compiler mode is unacceptable), you are willing to take on `wasm2go` itself as a maintained build-time dependency of your project, and you are comfortable auditing the transpiled Go as part of your security review. For a general-purpose backend microservice stack, these conditions almost never hold.

**The honest verdict on "Wasm blob + `wazero`" vs "`wasm2go` source transpile":** the blob-plus-`wazero` pattern is the better engineering choice for almost every production use case. You give up nothing meaningful in pure-Go-ness (`wazero` is pure Go, zero-dep), you keep a real security sandbox, the artifact boundary makes Cosign and SLSA trivial, and you inherit an actively maintained runtime. The `wasm2go` approach optimizes for a narrow aesthetic — "no runtime engine in the binary" — at the cost of sandbox, maintenance concentration, and SBOM clarity. For a CTO prioritizing supply-chain rigor, those are the wrong trades.

## Conclusion

The most interesting finding is not about `wasm2go` or PCRE2 specifically — it is about the **revealed preference of the Go regex community**. The two groups with the strongest incentive and technical capability to ship PCRE-in-Wasm for Go — `wasilibs`, who has productionized the exact pattern for RE2, and Coraza, whose users explicitly demand PCRE-compatible CRS rules — **both chose not to**. Coraza v3 went RE2-only; `wasilibs` has `go-re2`, `go-aho-corasick`, `go-pgquery`, `go-yamllint`, and a dozen others but no `go-pcre2`. The only person who tried (`bobby-stripe/go-pcre`, 2021) abandoned the project and zero others use it. That consensus is the single most important input to your decision, more than any benchmark or maturity-rating argument.

The practical takeaway is unglamorous: **most Go shops that think they need PCRE actually need `dlclark/regexp2` with a regex timeout, and the ones that genuinely need PCRE2 semantics should build `go-pcre2` over `wazero`, not over `wasm2go`.** The `wasm2go`-based path is a legitimate engineering curiosity and a reasonable solution for Nuno Cruces' specific `go-sqlite3` problem, but promoting it to a production pattern for a regex library in 2026 is choosing the harder, less-supported, less-auditable version of a problem that already has two better-trodden solutions.

## Links

- [`ncruces/wasm2go`](https://github.com/ncruces/wasm2go) — the Wasm-to-Go AOT transpiler discussed throughout
- [`ncruces/go-sqlite3`](https://github.com/ncruces/go-sqlite3) — `wasm2go`'s only significant production consumer
- [`bobby-stripe/go-pcre`](https://github.com/bobby-stripe/go-pcre) — the one prior experiment with PCRE2 in pure Go via Wasm
- [`dlclark/regexp2`](https://github.com/dlclark/regexp2) — the pragmatic default for PCRE-flavored regex in Go
- [`wasilibs/go-re2`](https://github.com/wasilibs/go-re2) — the canonical example of the WASM-blob-plus-`wazero` pattern
- [OWASP Coraza](https://github.com/corazawaf/coraza) — the WAF that walked away from PCRE in v3
- [PCRE2](https://github.com/PCRE2Project/pcre2) — the upstream library, currently at 10.47
- [`wazero`](https://github.com/tetratelabs/wazero) — the pure-Go Wasm runtime
- [`go.elara.ws/pcre`](https://gitea.elara.ws/Elara6331/pcre) and [`modernc.org/libpcre2`](https://gitlab.com/cznic/libpcre2) — the ccgo-transpiled curiosities
- [SLSA](https://slsa.dev) — Supply-chain Levels for Software Artifacts
- [Sigstore Cosign](https://github.com/sigstore/cosign) — artifact signing, with first-class Wasm support
