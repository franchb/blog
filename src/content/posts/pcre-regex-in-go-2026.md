---
title: "PCRE in Go in 2026: wasm2go Is Ready, PCRE2 Isn't"
author: franchb
pubDatetime: 2026-10-28T10:00:00Z
featured: true
draft: false
tags:
  - golang
  - regex
  - pcre
  - webassembly
  - supply-chain
description: "wasm2go now carries go-sqlite3 and go-re2 without cgo, so why not PCRE2? Nobody maintains that build, the JIT can't come along, and backtracking on hostile input is a problem no runtime fixes. Until that changes I use regexp2 with limits."
---

Earlier today I wrote about [a WAL-index bug in go-sqlite3](https://franchb.com/posts/mapping-sqlite-wal-index-into-wasm-memory/), the SQLite driver that compiles SQLite to WebAssembly and translates the module into Go with [wasm2go](https://github.com/ncruces/wasm2go). I run it in production. The obvious next question is whether the same trick works for PCRE2. Go's `regexp` package is RE2, so it has no backreferences and no lookaround, and a lot of rule sets in the wild (ModSecurity rules, old Perl tooling) were written with PCRE in mind.

The trick would work. I still wouldn't ship it today, and most of my reasons have nothing to do with wasm2go.

## Table of contents

## I had the wasm2go part wrong

I started drafting this post in April. Back then wasm2go looked like a side project: one maintainer, one serious consumer (his own go-sqlite3), very few tags. The draft said it wasn't production material and recommended running PCRE2 as a `.wasm` blob under [wazero](https://github.com/tetratelabs/wazero) instead, the way [wasilibs/go-re2](https://github.com/wasilibs/go-re2) did.

Six months later the go-re2 history alone undoes that argument:

- [#234](https://github.com/wasilibs/go-re2/pull/234), May 20: adds a wasm2go backend.
- [#251](https://github.com/wasilibs/go-re2/pull/251), July 8: makes wasm2go the default (released in v1.12.0).
- [#276](https://github.com/wasilibs/go-re2/pull/276), September 25: retires the wazero backend.

The current `go.mod` of go-re2 requires only `golang.org/x/sys`. The best-known example of "C library in Go via Wasm and wazero" no longer uses wazero.

wasm2go itself is at v0.4.19, and its [`USERS.md`](https://github.com/ncruces/wasm2go/blob/main/USERS.md) lists 21 libraries, among them bindings for libgit2, tree-sitter, HarfBuzz's subsetter, libavif and MicroPython. It is still one maintainer, which matters, but it is no longer one consumer.

## The sandbox survives the translation

The other argument in my April draft was that translating Wasm to Go throws away the sandbox, so a memory bug in PCRE2 would become a memory bug in your process. That was wrong too, and wasm2go's [`SECURITY.md`](https://github.com/ncruces/wasm2go/blob/main/SECURITY.md) explains why. Linear memory is a single Go slice, and every load and store is bounds-checked against it. An out-of-range access panics. The call stack belongs to the Go runtime and can't be addressed from linear memory, and the code lives outside it. The README adds that even the optional `-unsafe` mode follows the [`unsafe.Pointer` rules](https://pkg.go.dev/unsafe#Pointer) and keeps the bounds checks.

What the sandbox doesn't prevent is a bug in PCRE2 corrupting PCRE2's own heap inside linear memory. That gives you wrong match results or a panic, never a write into Go memory. wazero has exactly the same property, so it isn't a reason to prefer one runtime over the other. The practical difference is that a trap shows up as a Go panic, so a wrapper has to recover at its API boundary and return an error.

The project frames this with Chromium's [Rule of Two](https://chromium.googlesource.com/chromium/src/+/main/docs/security/rule-of-2.md): pick at most two of an unsafe implementation language, untrustworthy input and high privilege. A regex engine in a WAF is C code reading attacker-controlled bytes, so it already has two. Running it inside a bounds-checked slice is the point. One caveat from the README: wasm2go assumes the Wasm module itself is trusted. That's fine here, because you build the module. Patterns and subjects are data.

So on the runtime question, wasm2go is good enough. The costs that remain are about PCRE2.

## What PCRE2 gives you that regexp2 doesn't

[dlclark/regexp2](https://github.com/dlclark/regexp2) is a pure-Go port of the .NET regex engine, now at v2.11.0. Its README has a full comparison table. Next to Go's `regexp` it adds lookahead, lookbehind, backreferences (numbered and named), atomic groups, possessive quantifiers, conditionals, `\R` and `\X`.

Here is what it lacks next to PCRE2. I checked these against the parser source: the group parser in `syntax/parser.go` accepts `:`, `=`, `!`, `>`, `'`, `<`, `(` and `P` after `(?`, and nothing else.

| PCRE2 feature           | Syntax             | regexp2 |
| ----------------------- | ------------------ | ------- |
| Reset match start       | `\K`               | no      |
| Whole-pattern recursion | `(?R)`             | no      |
| Subroutine calls        | `(?1)`, `(?&name)` | no      |
| Callouts                | `(?C1)`            | no      |
| Branch reset            | `(?\|a\|b)`        | no      |

If your patterns don't use any of these five, you don't need PCRE2. Grep your rule set before you decide.

## What it would cost to build

### Nobody maintains the build

There is no `wasilibs/go-pcre2`, and nothing PCRE-shaped in wasm2go's users list (which calls itself incomplete, so the honest statement is that I couldn't find one). The closest prior attempt is [bobby-stripe/go-pcre](https://github.com/bobby-stripe/go-pcre). Its last tag is v1.0.1 from 2021, it bundles PCRE2 10.38 (`PCRE2_DATE 2021-10-01` in its header), and it runs on an older Wasm interpreter called gasm, not wazero or wasm2go.

So you would own the pipeline: PCRE2 C source, a wasi-sdk build with the JIT disabled, a wasm2go run, and a Go API on top that copies subjects in and match offsets out. PCRE2 shipped 10.47 on 2025-10-21, 10.48 on 2026-08-31 and 10.49 on 2026-09-28. Its [`SUPPORT-LIFECYCLE.md`](https://github.com/PCRE2Project/pcre2/blob/main/SUPPORT-LIFECYCLE.md) promises at least five years of security backports per release, published as `release/pcre2-10.xx` branches. Staying current means rebuilding and re-translating on every one of those. That's ordinary work, but it's work you'd do alone.

Use PCRE2, not PCRE1. The PCRE2 README says plainly that "the original PCRE1 library is now obsolete and no longer maintained." One detail helps the Wasm build: since 10.30 (August 2017) the interpreter no longer uses recursive function calls to remember backtracking positions, so deep backtracking costs heap rather than the small Wasm stack.

### The JIT doesn't come along

[`pcre2jit(3)`](https://github.com/PCRE2Project/pcre2/blob/pcre2-10.49/doc/pcre2jit.3) lists the platforms the JIT supports: 32- and 64-bit ARM, IBM s390x, x86 and x86-64, LoongArch, MIPS, PowerPC and RISC-V. WebAssembly isn't on the list, and the same page says configuring with `--enable-jit` on an unsupported platform fails the build. A Wasm module also has no way to generate machine code and jump to it. So the interpreter is all you get.

The docs only say the JIT "can greatly speed up pattern matching". I haven't measured the gap on a realistic rule set, and the figures I've seen quoted vary too much to repeat here. If you're considering this path, measure first with a native build: `pcre2test -t` against `pcre2test -jit -t` on your own patterns and traffic samples. The JIT is a big part of why people pick PCRE2 for WAF-style workloads, so losing it may cancel most of the reason to want PCRE2.

### Backtracking on hostile input

PCRE2 and regexp2 are both backtracking engines, so both can take exponential time on the wrong pattern and input. The runtime doesn't change that. Both offer limits:

- PCRE2: `pcre2_set_match_limit`, `pcre2_set_depth_limit` and `pcre2_set_heap_limit` on the match context.
- regexp2: a backtracking stack capped at 100,000 slots by default (`OptionMaxBacktrackingStackSize`), plus `MatchTimeout`. The README notes that the stack cap bounds memory, not time, so set the timeout as well. It costs a background clock that ticks about every 100 ms, at about 0.15% CPU while any timed match is live.

RE2 has no such problem, because it guarantees time linear in the input. That's the choice [OWASP Coraza](https://github.com/corazawaf/coraza) made. In v3 the `@rx` operator compiles rules with Go's `regexp` (and `rsc.io/binaryregexp` for patterns that match non-UTF-8 bytes), and [coraza-wasilibs](https://github.com/corazawaf/coraza-wasilibs) can swap in go-re2 for speed. The v2-era PCRE plugin, [jptosso/coraza-pcre](https://github.com/jptosso/coraza-pcre), wraps the cgo PCRE1 binding `gijsbers/go-pcre`. Its README says it "is only intended for compatibility", and its last commit is from June 2022. The Go WAF with the most PCRE-shaped rule set chose a linear-time engine.

## What I'd use

Start with the least powerful engine that fits your patterns:

1. Go's `regexp` when RE2 syntax is enough. Reach for go-re2 if you have large inputs or complex patterns; its README warns it is slower than the standard library on small ones.
2. regexp2 when you need lookaround or backreferences. Set both limits:

```go
import (
	"errors"
	"time"

	"github.com/dlclark/regexp2/v2"
)

func compileRule(pattern string) *regexp2.Regexp {
	re := regexp2.MustCompile(pattern,
		regexp2.OptionMaxBacktrackingStackSize(100_000), // the default, made explicit
	)
	re.MatchTimeout = 50 * time.Millisecond
	return re
}

func matches(re *regexp2.Regexp, subject string) (bool, error) {
	ok, err := re.MatchString(subject)
	if errors.Is(err, regexp2.ErrBacktrackingStackLimit) {
		// the pattern hit the stack cap: log it, and decide whether to block
		return false, err
	}
	return ok, err // err is non-nil here only on timeout
}
```

3. PCRE2 through wasm2go only if a pattern you can't rewrite needs one of the five features above, and you're willing to own the build for years.

cgo bindings ([jemmic/go-pcre2](https://github.com/jemmic/go-pcre2) for PCRE2, [GRbit/go-pcre](https://github.com/GRbit/go-pcre) for PCRE1) give you the real library with the JIT, and they cost exactly what made me pick go-sqlite3: a C toolchain in the build and no clean cross-compilation. [modernc.org/libpcre2-8](https://gitlab.com/cznic/libpcre2) uses ccgo to translate PCRE2's C straight to Go. That avoids both cgo and Wasm, but the generated code is per-platform and the API is low-level.

## What would change my mind

A maintained `go-pcre2` on wasm2go, released alongside each PCRE2 version, with honest benchmarks against a native JIT build. The pieces are all there now: wasm2go is proven on larger C codebases than PCRE2, and go-re2 shows how to wrap a regex engine around it. If someone publishes it, option 3 becomes "import it", and I'd use it for the patterns regexp2 can't handle.

## Links

- [ncruces/wasm2go](https://github.com/ncruces/wasm2go): the Wasm-to-Go translator, with its [users list](https://github.com/ncruces/wasm2go/blob/main/USERS.md) and [security notes](https://github.com/ncruces/wasm2go/blob/main/SECURITY.md)
- [wasilibs/go-re2](https://github.com/wasilibs/go-re2): RE2 via wasm2go since v1.12.0
- [dlclark/regexp2](https://github.com/dlclark/regexp2): pure-Go .NET-flavor regex, and [regexp2cg](https://github.com/dlclark/regexp2cg) for code-generated matchers
- [PCRE2](https://github.com/PCRE2Project/pcre2): upstream, with the [JIT docs](https://github.com/PCRE2Project/pcre2/blob/pcre2-10.49/doc/pcre2jit.3) and [support lifecycle](https://github.com/PCRE2Project/pcre2/blob/main/SUPPORT-LIFECYCLE.md)
- [OWASP Coraza](https://github.com/corazawaf/coraza) and [coraza-wasilibs](https://github.com/corazawaf/coraza-wasilibs)
- [bobby-stripe/go-pcre](https://github.com/bobby-stripe/go-pcre): the 2021 PCRE2-in-Wasm experiment
- [Mapping SQLite's WAL-Index into WebAssembly Memory](https://franchb.com/posts/mapping-sqlite-wal-index-into-wasm-memory/): the go-sqlite3 post this one follows
