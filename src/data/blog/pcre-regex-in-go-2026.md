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

I have been shipping a Go-based WAF lately — pure Go, distroless image, no cgo, the kind of build where every dependency goes through a supply-chain review before it lands in `go.mod`. The trouble is that the rule corpus we inherited is written in PCRE, and Go's `regexp` package is RE2: no backreferences, no lookarounds, no possessive quantifiers, no recursion. So the question that surfaced was specific: can I compile PCRE2 to WebAssembly, transpile that Wasm to pure Go via [`ncruces/wasm2go`](https://github.com/ncruces/wasm2go), and ship a single static binary that speaks _real_ PCRE? I spent a few weekends on the experiment — building it, benchmarking it, reading the generated Go, and chasing down what it actually pulls into your supply chain. This post walks through what I found, why the path is technically viable, and why — for production — it is still the wrong tool.

## Table of contents

## The short answer

If you need PCRE-flavored matching in Go in 2026, default to [`dlclark/regexp2`](https://github.com/dlclark/regexp2). It is pure Go, actively maintained, and gives you the .NET regex flavor — close enough to PCRE for the vast majority of rule corpora, including the PCRE-ish ModSecurity rules most teams actually run. When you genuinely need PCRE2 semantics — recursion, named subroutines, the full Unicode property surface — fall back to the [`wasilibs`](https://github.com/wasilibs)-style pattern: ship the upstream library as a Wasm blob and execute it under [`wazero`](https://github.com/tetratelabs/wazero) at runtime. That stack is the production-grade approach for "C library in pure Go" and it is what `go-re2`, `go-pgquery`, and friends already do. AOT-transpiling the Wasm to Go via `wasm2go` works as a curiosity and as a one-off for `ncruces/go-sqlite3`, but it is not a production pattern, and the rest of this post is largely about why. The library to compile is PCRE2 10.47, not the long-dead PCRE 8.x line.

## What wasm2go actually is

[`wasm2go`](https://github.com/ncruces/wasm2go) is an AOT Wasm-to-Go transpiler. You feed it a `.wasm` module and it emits pure Go source — the linear memory becomes a `[]byte`, every Wasm instruction becomes Go, and the result compiles into your binary like any other dependency. No wazero at runtime, no interpreter, no `os/exec`. It is, structurally, the most "pure Go" you can get while still being driven by a C codebase.

The trade-off is the part that does not survive the transpile. Wasm gives you a sandbox: bounds-checked memory, no syscalls without an explicit import, deterministic traps. After `wasm2go`, that sandbox is gone. The generated Go performs the same memory accesses, but they are now plain slice indexing inside your address space. A bug in PCRE2's matcher is no longer "the Wasm module aborts" — it is a panic, or worse, a silent overrun, in your binary.

The maturity signals are the second half of the picture:

- **Maturity:** 111 stars, 2 forks, 78 commits, 1 tag — and one maintainer. Bus factor = 1.
- **Real-world consumer:** exactly one — `ncruces/go-sqlite3` (926 stars, 593 dependents, v0.31.1, March 2026). That is the project demonstrating wasm2go works.

`go-sqlite3` is a serious project, and it is genuinely the best evidence that the pipeline produces a working binary. But "one author, one consumer" is not a tooling ecosystem — it is a personal project that one other personal project leans on. If `ncruces` stops shipping tomorrow, you own the transpiler.

## PCRE flavor: PCRE2, not PCRE 8.x

A surprising number of Go-and-PCRE posts still link to the old PCRE 8.x line. Do not. **PCRE 8.45 (2021) is the final PCRE1 release** — Philip Hazel has been explicit that he does not want to encourage further PCRE1 use, and he has refused requests to migrate the PCRE2Project organization to host PCRE1 specifically because making it more discoverable would be the wrong signal. PCRE1 is in the "security fixes only, and even those grudgingly" phase. Treat it as deprecated.

The library you actually want is PCRE2. **PCRE2 10.47 (21 Oct 2025) is the current release**, and **10.48 is on master** as of this writing. The API is different from PCRE1 — `pcre2_compile_8`, `pcre2_match_8`, the `_8`/`_16`/`_32` suffix scheme for code-unit width — but it is the line under active development.

One detail matters specifically for the Wasm path: **PCRE2 10.30+ is heap-recursive**. Prior versions used C stack recursion in the matcher, which on a Wasm linear-memory build with a small default stack would blow up on any non-trivial backtracking. Heap recursion makes deep matches a memory-pressure problem instead of a stack-overflow problem, which is the right trade for Wasm.

License-wise: **BSD-3-Clause WITH PCRE2-exception**. The exception clause explicitly permits linking into closed-source software without imposing source-disclosure obligations on the linker. If your legal team has a list of acceptable OSS licenses, PCRE2 lands cleanly on it.

## The compilation pipeline

If you do walk this path — Wasm-blob or AOT-transpiled — the compilation half of the pipeline is the same. Here is what you actually have to decide.

### JIT is off the table on Wasm

PCRE2 ships with an optional JIT backend powered by `sljit`, and on a native build that JIT is the entire reason PCRE2 is fast. On Wasm, you do not get it. `sljit` does not list Wasm as a target — there is no Wasm code generator, and even if there were, the runtime model forbids it: Wasm explicitly does not allow RWX memory pages, and codegen-then-execute is the one thing the sandbox is designed to prevent. So the configure invocation is straightforward:

```bash
./configure --host=wasm32-wasi \
  --disable-jit \
  --disable-shared \
  --enable-static \
  --enable-pcre2-8 \
  --enable-unicode
```

Once you pass `--disable-jit`, several other build-time concerns vanish. PCRE2's JIT path uses `setjmp`/`longjmp` for recoverable matcher errors, and that is the part of the C runtime that Wasm/WASI does not love; with the JIT off, the interpreter path does not need it.

### The performance penalty

Turning the JIT off is not a free choice. The JIT-off slowdown is **3–10× typical, 15–25× worst case** on backtracking-heavy patterns. The bottom of that range is what most simple anchored patterns will see; the top of it is what catastrophic-backtracking patterns will do to you when the JIT is not there to cut early. Those bands come from third-party measurements — OpenResty's nginx-with-PCRE benchmarks, GNOME GtkSourceView's syntax-highlighting benchmarks, and the `pg_jitter` PostgreSQL plugin's regex-extension numbers — not from anything I ran myself. Treat them as the public ranges to plan against.

### Toolchain choice

Two realistic ways to produce the `.wasm`: [`wasi-sdk`](https://github.com/WebAssembly/wasi-sdk) or Emscripten. Pick `wasi-sdk`. It is leaner, it is closer to a normal cross-compiler, and the WASI ABI is the one wazero and `wasm2go` both speak natively. Emscripten will happily produce a working PCRE2 build, but it also wants to give you a JavaScript shim, an HTML harness, and an `EM_ASM` integration story you do not need on the server. The shim alone is dead weight in a Go binary.

### Binary size and boundary cost

A clean `--disable-jit`, `--enable-pcre2-8`, Unicode-enabled PCRE2 build comes out to roughly **400–700 kB of Wasm**, of which **150–250 kB is Unicode tables** — the property tables, case-folding data, script and category metadata. You can claw some of that back by disabling Unicode, but if you are reaching for PCRE2 you almost certainly want `\p{...}`, so plan to pay it.

The cost that bites harder than binary size is the boundary. Going from Go into a Wasm guest — whether under wazero or after `wasm2go` — costs roughly **50–100× the overhead per call versus a pure-Go function call on tiny inputs**. The translation layer, parameter marshaling, and linear-memory copies dominate when the actual match work is microscopic. The mitigation is to batch: send a buffer of lines, get a buffer of results, never call across the boundary one short string at a time. If your workload cannot batch, the boundary cost will eat the entire performance budget before backtracking does.

## Prior art: one stale experiment, and a telling counter-example

Whenever a path "should" exist, the most useful thing you can do is check whether it _already_ exists. For PCRE2-in-pure-Go, it almost does — and the way it almost-does is the most informative signal in the entire analysis.

The closest thing to prior art is [`bobby-stripe/go-pcre`](https://github.com/bobby-stripe/go-pcre). The repo exists, the code compiles, and it bundles a Wasm build of PCRE2. The problems are the dates and the dependents. Last tag: **v1.0.1 (Oct 2021)**. Bundled library: **PCRE2 10.38**. Importers on **pkg.go.dev**: **zero**. That is one experiment, abandoned for over four years, shipping a PCRE2 release that predates several CVEs, with nobody depending on it. It is exactly the kind of "yes, it exists" link that looks reassuring in a search result and falls apart on five seconds of due diligence.

The counter-example is sharper. OWASP Coraza is the most credible Go-native WAF in the ecosystem. Coraza v2 had an optional cgo-backed PCRE plugin called `coraza-pcre`. In v3, that plugin was removed and the engine is RE2-only. Anuraag Agrawal's CNCF talk on the migration lays out the rationale — supply-chain, deployability, performance under realistic rule sets — and it is the most direct statement of "we tried PCRE in production Go and we deliberately walked away from it" that I am aware of.

The third data point is `wasilibs` itself. The project ships [`go-re2`](https://github.com/wasilibs/go-re2), [`go-aho-corasick`](https://github.com/wasilibs/go-aho-corasick), [`go-pgquery`](https://github.com/wasilibs/go-pgquery), [`go-yamllint`](https://github.com/wasilibs/go-yamllint), and a half-dozen others. They have industrialized "C library in pure Go via Wasm" as a pattern. They have not shipped a `go-pcre2`. The team that knows exactly how to do this — has the tooling, the build infrastructure, the release pipeline — has chosen not to do it.

That pattern, more than any benchmark, is the most important data point in this whole analysis: the people best-equipped to ship PCRE2-in-pure-Go have looked at the problem and declined.

## The realistic alternatives

If `wasm2go` is not the answer for production Go in 2026, what is? The honest answer depends on which PCRE features you actually need and how much of your deployment story you are willing to renegotiate. Four families of alternatives are worth considering, in roughly descending order of practicality.

### dlclark/regexp2

[`dlclark/regexp2`](https://github.com/dlclark/regexp2) is the default recommendation for almost every team that thinks they need PCRE in Go. **~1.2k stars, pure-Go .NET-port backtracking NFA**. It is a faithful Go translation of the .NET `System.Text.RegularExpressions` engine, which means lookbehinds, lookaheads, named groups, atomic groups, conditional patterns, balancing groups, and most of the .NET dialect work out of the box. The flavor is not byte-identical to PCRE2 — there is **no `\K`, no `(?R)` recursion, no callouts** — but it covers the vast majority of patterns that real codebases ship.

- **Pure Go**: zero cgo, zero Wasm runtime, one `go.mod` line. Cross-compiles to every Go target without a thought.
- **`MatchTimeout` uses a shared ticker goroutine** that wakes roughly every **~100 ms** to check active matches against their deadline. The ticker burns approximately **0.15% background CPU** while any match is in flight and is **mandatory on untrusted input** — backtracking engines without a timeout are a denial-of-service vector by construction.
- **Performance**: in the same RE2-vs-PCRE2 ballpark for pathological patterns — slower than RE2 on simple patterns, faster than naive backtrackers, occasionally catastrophic on unconstrained alternation. The timeout is what makes this safe, not the engine speed.

If your patterns work in `regexp2` and you can tolerate a deadline-bounded matcher, stop reading. This is the answer.

### cgo paths

The cgo route — [`GRbit/go-pcre`](https://github.com/GRbit/go-pcre), [`jemmic/go-pcre2`](https://github.com/jemmic/go-pcre2), and a handful of older bindings — gives you genuine PCRE/PCRE2 with the JIT, full feature parity, and the same flavor your Perl scripts already use. It also gives you a C toolchain in your build, libpcre2 in your runtime, and a full retreat from distroless and pure-Go cross-compilation. For most of the deployment targets that motivated this whole inquiry — small images, scratch-based containers, `GOOS=linux GOARCH=arm64` from a Mac without Docker — cgo is disqualifying. Worth a mention only because it is what you would reach for if those constraints did not exist.

### Rust paths

The Rust-via-FFI options — [`rure-go`](https://github.com/BurntSushi/rure-go) wrapping the `regex` crate, or [`fancy-regex`](https://github.com/fancy-regex/fancy-regex) which adds backreferences and lookaround on top of it — solve a different problem. The Rust regex flavor is **not PCRE2**: no recursion, no callouts, different escape semantics in several edge cases, and a deliberately RE2-shaped subset for `regex` proper. If your goal was PCRE2 compatibility, switching to Rust regex is a flavor migration, not a flavor preservation. The fact that the FFI surface is also cgo-shaped only adds insult.

### ccgo

The `ccgo`-based path — [`go.elara.ws/pcre`](https://gitea.elara.ws/Elara6331/pcre) and the `modernc.org/libpcre2-*` family — is the closest thing to genuine pure-Go PCRE2 available today. `ccgo` transpiles C source to Go, giving you a real PCRE2 implementation that compiles into a pure-Go binary with no cgo and no Wasm runtime. It is a niche path: maintained largely by one developer, used in modernc's SQLite stack and a few derivatives, and still subject to all the C-to-Go transpilation caveats around build times, generated code size, and the long supply chain from PCRE2 source through `ccgo` through your binary. If you must have PCRE2-the-flavor in pure Go today, this is the most viable path — but "viable" and "production-default" are different categories.

## Decision matrix

The trade-offs collapse to the following table. Verdicts are short by design — this is a triage tool, not a benchmark report.

| Approach                 | Pure-Go | Cross-compile | PCRE coverage                     | Runtime cost                   | Ops                           | Supply chain         |
| ------------------------ | ------- | ------------- | --------------------------------- | ------------------------------ | ----------------------------- | -------------------- |
| `dlclark/regexp2`        | yes     | yes           | partial (no `\K`/`(?R)`/callouts) | timeout-bounded, ~tiny         | trivial; active (1.2k stars)  | 1 SBOM line          |
| `wasilibs` WASM + wazero | yes     | yes           | full PCRE2                        | 3–10× slower, +1–3 MB          | moderate; active              | WASM blob, signed    |
| `wasm2go`                | yes     | yes           | full PCRE2                        | ~PCRE2 JIT-off, +1–3 MB        | heavy transpile; 1 maintainer | C → WASM → Go (long) |
| cgo bindings             | no      | via cgo       | full PCRE2 (with JIT)             | best (native + JIT), +0.5–1 MB | C toolchain; active           | C in your tree       |
| Rust bindings            | no      | via cgo       | Rust flavor — different           | best (RE2-class), +0.5–1 MB    | Rust + cgo; active            | Rust + C in tree     |
| ccgo PCRE2               | yes     | yes           | full PCRE2                        | ~PCRE2 JIT-off, +0.5–1 MB      | heavy transpile; 1 maintainer | C → ccgo → Go (long) |

The matrix shows why the verdict from the short answer holds. Only three rows are simultaneously pure-Go and cross-compile-clean, and of those three, exactly one has both an active maintainer community and a trivial integration story — `dlclark/regexp2`. The two transpilation paths (`wasm2go` and `ccgo`) trade a long, single-maintainer supply chain for full PCRE2 flavor, which is a defensible trade in narrow circumstances and a hard sell as a default. Everything else either gives up pure-Go or gives up PCRE2.

## Supply-chain posture under SLSA and distroless

Long-time readers will know I think SLSA L3 should be table stakes for anything AI-adjacent or security-adjacent in 2026; the same lens applies here. The differences between these approaches under that lens are larger than the runtime benchmarks that usually dominate the conversation.

- **`dlclark/regexp2` wins outright.** One Go module, one SBOM line, one Cosign signature, one SLSA provenance. Distroless has no surprises: no native code, no embedded blob, no second toolchain.
- **The `wasilibs` pattern is the right second choice.** Cosign has first-class Wasm support — sign the `.wasm` and the Go binary independently, verify both at deploy. The wazero sandbox preserves a defense-in-depth layer the cgo and ccgo paths cannot match.
- **`wasm2go` has a longer provenance chain than any of the above.** The artifact is generated Go, but its real ingredients are PCRE2 C source, a wasi-sdk LLVM toolchain, a wasi-libc layer, the wasm2go transpiler, and Go. Standard SBOM tools (`syft`, `trivy`) will not introspect generated Go back to those ingredients — tracking that chain falls on you.

If your security model demands SLSA L3 and distroless, it should also ask hard questions about a six-stage transpilation chain owned by one developer.

## Concrete recommendation

Three operating instructions in order of preference.

### Default: `dlclark/regexp2`

Use it. Set `MatchTimeout` on every compiled instance — non-negotiable on untrusted input, since the engine is backtracking and ReDoS-vulnerable without a cap. If a pattern from an external rule set fails to compile, rewrite it or move that rule to a separate engine.

```bash
go get github.com/dlclark/regexp2
```

### Fallback: a fresh `go-pcre2` in the wasilibs style

If you genuinely need full PCRE2 flavor — typically because you are consuming an external rule corpus — build a wasilibs-style module: PCRE2 10.47 with `--disable-jit`, compiled via wasi-sdk, the resulting `.wasm` embedded with `go:embed`, wazero as the runtime. Nobody has walked this path for PCRE2 yet; you would be the first.

```bash
# rough outline — not a copy-paste recipe
./configure --disable-jit --enable-static CC=$WASI_SDK/bin/clang \
            --host=wasm32-wasi --prefix=$PWD/build
make && make install
# pack build/lib/libpcre2-8.wasm into your Go module via go:embed,
# then load it with wazero at init() time
```

### Narrow case: `wasm2go`

Only consider this if you have all three: a no-wazero-at-runtime constraint, budget to own `wasm2go` as a build-time dependency with its single-maintainer risk, and willingness to audit the generated Go on every regeneration. Otherwise the wasilibs path is strictly better.

```bash
# representative invocation; the real flow is wrapped in a build script
wasm2go transpile pcre2.wasm > internal/pcre2/pcre2.go
go build ./...
```

## Conclusion

The single most important input to this decision is not a benchmark. It is revealed preference. The two groups with the strongest incentive and capability to ship PCRE-in-Wasm for Go — `wasilibs`, who invented the WASM-blob-plus-wazero pattern, and the OWASP Coraza maintainers, who had the most acute PCRE-shaped problem in the Go ecosystem — both looked at this design space and chose not to. `wasilibs` shipped `go-re2` and stopped there. Coraza migrated off PCRE entirely. That is the ecosystem telling you the bench numbers do not justify the operational and supply-chain cost. Use `dlclark/regexp2`, set a timeout, and move on; the calculus changes the moment a `wasilibs/go-pcre2` repo appears with a real maintainer behind it.

## Links

- [ncruces/wasm2go](https://github.com/ncruces/wasm2go) — AOT Wasm-to-Go transpiler, the subject of this post
- [bobby-stripe/go-pcre](https://github.com/bobby-stripe/go-pcre) — the stale Wasm-bundling experiment, last touched 2021
- [dlclark/regexp2](https://github.com/dlclark/regexp2) — pure-Go .NET-port regex engine, the recommended default
- [wasilibs/go-re2](https://github.com/wasilibs/go-re2) — the canonical WASM-blob-plus-wazero pattern
- [OWASP Coraza](https://github.com/corazawaf/coraza) — WAF that walked away from PCRE for RE2
- [PCRE2](https://www.pcre.org/) — the reference C implementation
- [wazero](https://github.com/tetratelabs/wazero) — Tetrate-sponsored Wasm runtime in pure Go
- [ncruces/go-sqlite3](https://github.com/ncruces/go-sqlite3) — wasm2go's flagship consumer
- [SLSA](https://slsa.dev/) — Supply-chain Levels for Software Artifacts
- [Sigstore Cosign](https://github.com/sigstore/cosign) — signing and verification for OCI artifacts and Wasm
