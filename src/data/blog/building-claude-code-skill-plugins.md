---
title: "Building a Claude Code Skill Plugin from Scratch"
author: franchb
pubDatetime: 2026-04-15T12:00:00Z
featured: true
draft: false
tags:
  - claude-code
  - golang
  - security
  - open-source
description: "A practical guide to building, structuring, versioning, and securing Claude Code skill plugins — lessons from creating fp-go-skill."
---

I have been working with [fp-go/v2](https://github.com/IBM/fp-go) a lot lately — a functional programming library for Go 1.24+ inspired by fp-ts. It covers 61 packages and roughly 5,262 functions. That is a lot of surface area to keep in your head: which monad do I reach for? How do I compose these pipelines? What does idiomatic fp-go testing even look like?

I wanted Claude Code to just _know_ all of this. So I built [fp-go-skill](https://github.com/franchb/fp-go-skill) — a Claude Code skill plugin that gives the assistant native understanding of functional programming patterns in Go. This post walks through how I built it, and how you can build one yourself.

## Table of contents

## What is a skill plugin?

A skill plugin is a collection of structured Markdown files and a JSON manifest that gives Claude Code domain expertise. When installed, it activates automatically when relevant imports or patterns are detected in the user's project — no manual prompting needed.

fp-go-skill provides four capabilities:

- **Monad Selection Wizard** — an interactive decision tree that guides you to the right type (Option, Result, IOResult, ReaderIOResult, or Effect) based on your requirements
- **Code Review** — catches fp-go anti-patterns like wrong monad choice, imperative style leaking into functional pipelines, and missed composition opportunities
- **Migration Assistance** — converts traditional Go code into functional pipelines step by step
- **Testing Guidance** — property-based testing strategies and algebraic law verification using fptest-go

The key idea is that the plugin turns Claude Code into a domain expert for your specific library or framework, without the user needing to paste documentation into every conversation.

## Plugin directory structure

A marketplace-ready skill plugin follows a specific layout:

```
fp-go-skill/
├── .claude-plugin/
│   └── marketplace.json          # marketplace metadata
├── plugins/
│   └── fp-go/
│       ├── .claude-plugin/
│       │   └── plugin.json       # per-plugin config
│       └── skills/
│           └── fp-go/
│               ├── SKILL.md      # entry point (~340 lines)
│               ├── cookbook.md    # practical recipes
│               ├── core-patterns.md
│               ├── mastery.md
│               ├── testing.md
│               └── full-reference.md
├── .skill-hashes.sha256          # integrity verification
├── CLAUDE.md                     # authoring guidelines
└── SECURITY.md
```

The `plugin.json` is where your plugin's identity lives:

```json
{
  "name": "fp-go",
  "version": "1.0.0",
  "description": "Functional programming guidance for Go with fp-go/v2"
}
```

The `marketplace.json` at the root level wraps your plugins for marketplace distribution, including metadata like version, description, and a list of contained plugins.

The most important rule: **SKILL.md is loaded into context every session**. Supporting files are loaded on demand. This distinction drives the entire documentation architecture.

## Layered documentation architecture

This is the design decision I spent the most time on. The core constraint is prompt budget — you cannot dump 522KB of API documentation into every conversation. But you also cannot leave important guidance out, because Claude will not know what it does not know.

The solution is a layered approach:

**SKILL.md** (~340 lines) is the compact reference that is always in context. It contains the monad selection decision tree, key conventions (data-last curried APIs, `F.Pipe` vs `F.Flow`), and an overview of the most important patterns. I keep this under 300 lines as a hard rule.

The supporting layers are loaded when Claude needs deeper context:

- **core-patterns.md** — type hierarchy, composition patterns, optics, algebraic structures
- **cookbook.md** — practical recipes for common tasks (HTTP handlers, database queries, config loading)
- **testing.md** — property-based testing, algebraic law verification (Functor, Monad, Applicative laws)
- **mastery.md** — advanced techniques, performance optimization, concurrency patterns
- **full-reference.md** (522KB, 6,080 lines) — comprehensive API docs across all 61 packages

SKILL.md also declares `allowed-tools` in its frontmatter, restricting the skill to read-only tools only: `Read`, `Grep`, `Glob`, and `LSP`. A skill plugin should never need to write files or execute commands — it provides guidance, not automation. This is both a security measure and a design principle.

## Versioning: what semver means for skills

Here is a question that tripped me up at first: what does semver mean when there is no compiled artifact?

A skill plugin's "output" is how Claude behaves when following the instructions. A wording change in SKILL.md can change what Claude recommends. That is a behavioral change, even though no "code" changed in the traditional sense. So I defined semver semantics specific to skills:

- **MAJOR** — changes that alter the skill's fundamental behavior. Restructuring the monad selection logic so it recommends different types in the same scenarios. Changing `allowed-tools` restrictions. Removing a capability entirely.
- **MINOR** — new content that expands what the skill can do. Adding a new cookbook recipe, a new monad type to the decision tree, or a new supporting document.
- **PATCH** — fixes that do not change behavior. Typos, corrected code examples, clearer explanations of existing guidance.

Concrete example: if I rewrite the monad selection decision tree so it now recommends `ReaderIOResult` in cases where it previously recommended `IOResult`, that is a **MAJOR** bump — even though all I changed was a few lines of Markdown.

### Automating releases with release-please

I use [release-please](https://github.com/googleapis/release-please) to automate versioning. It watches for conventional commit prefixes and handles everything:

```
feat: add concurrency patterns to cookbook     → MINOR bump
fix: correct Option.Map example in cookbook     → PATCH bump
feat!: restructure monad selection logic       → MAJOR bump
docs: update README with install instructions  → no release
chore: pin actions to SHA                      → no release
```

The release type is `"simple"` — not `"node"` or `"go"`, because this is not traditional software. The `simple` type works on any repo.

The trickiest part was keeping versions in sync. The version appears in both `marketplace.json` and `plugin.json`, so I use `jsonpath` in the release-please config to update all locations atomically when a release PR is created.

Consumers can pin to a specific version:

```bash
claude plugin add github:franchb/fp-go-skill@v1.2.0
```

This gives them a guarantee that the skill content they are using is exactly the version they chose.

## Supply-chain security

This is the section I care most about, and the one most skill repos skip entirely.

### The threat model

A skill plugin's Markdown files are injected directly into Claude's context. A compromised skill file is not like a compromised npm package that runs malicious code — it is a prompt injection vector that manipulates an AI's reasoning. Both are dangerous, but the skill attack surface is less understood.

This means the bar for integrity should be _higher_ than for traditional software, not lower.

### Integrity hashes

Every skill file is tracked in `.skill-hashes.sha256`:

```bash
find skills/ -name "*.md" -exec sha256sum {} \; | sort > .skill-hashes.sha256
```

These hashes are regenerated automatically during every release. CI verifies them on every pull request — if hashes do not match the actual file contents, the build fails. Consumers can re-run the hash commands after installation to verify nothing was tampered with.

### SLSA Level 3 provenance

The release workflow creates a deterministic archive with `git archive`, generates SHA-256 checksums, and produces [SLSA Level 3](https://slsa.dev) provenance attestations. This means:

- The build process is isolated (runs on GitHub-hosted runners, not self-hosted)
- The provenance is non-forgeable (signed by the SLSA framework, not by me)
- The source is auditable (provenance links back to the exact commit)

Consumers can verify with:

```bash
gh attestation verify plugin-v1.2.0.tar.gz -R franchb/fp-go-skill
```

### Skill-specific security scans

I wrote a dedicated `skill-security.yml` workflow that runs checks you would not find in a typical CI pipeline:

- **Hidden Unicode detection** — scans for zero-width characters, bidirectional overrides, and soft hyphens. These could be used to hide malicious instructions in Markdown that are invisible to human reviewers but visible to an LLM.
- **Prompt injection pattern scanning** — detects patterns like "ignore previous instructions", "you are now", `eval()`, `curl | bash`, and `rm -rf`. If any of these appear in a skill file, something is very wrong.
- **Tool restriction enforcement** — verifies that every SKILL.md declares `allowed-tools` in its frontmatter and that those tools are read-only. No Bash, no Write, no Edit, no network access.
- **Secret scanning** — Gitleaks integration to catch accidentally committed credentials.

### Workflow hardening

Every GitHub Action in every workflow is pinned to a full commit SHA — not a version tag. For example:

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
```

Tag-based pinning is vulnerable to tag-hijacking attacks. SHA pinning is not. Every workflow job also starts with `step-security/harden-runner` to monitor and audit egress traffic.

This might feel like overkill for a collection of Markdown files. But the bar should be high precisely _because_ these files influence AI behavior. The principle: treat skill repos with the same rigor you would treat any software dependency in your supply chain.

## The release lifecycle end-to-end

Putting it all together, here is what a release looks like:

1. I commit `feat: add concurrency patterns to cookbook` to `main`
2. release-please creates a PR that bumps the version from 1.1.0 to 1.2.0, updates both JSON manifests, and generates a CHANGELOG entry
3. CI runs on the PR: markdown linting, JSON validation, Unicode scanning, prompt injection scanning, hash verification, secret scanning
4. I review and merge the PR
5. A tag `v1.2.0` is created automatically
6. The release workflow fires: deterministic archive, SLSA attestation, GitHub Release published with checksums
7. A consumer runs `claude plugin add github:franchb/fp-go-skill@v1.2.0` and optionally verifies the attestation

The entire pipeline runs without manual intervention after step 4. From commit to published release, the only human action is merging the PR.

## Lessons learned

After building fp-go-skill, here is what I would tell someone starting their own skill plugin:

**Start with release-please from day one.** The overhead is one config file and one workflow. The payoff is automated changelogs, version consistency, and a professional release process before you even have your first user.

**Define what semver means for your skill before the first release.** The semantics are not obvious and will differ from traditional software. Write it down somewhere — your future self will thank you.

**Pin your GitHub Actions by SHA.** Tag-based pinning is not secure for any repo, but especially not for one whose output directly influences AI behavior.

**Add integrity hashes.** The `.skill-hashes.sha256` pattern is lightweight and gives consumers a verification path that costs you almost nothing to maintain.

**Scan for prompt injection in CI.** The patterns I check for are a starting point, not exhaustive. But catching the obvious ones automatically is better than relying on manual review.

**Use `allowed-tools` restrictions.** A skill should request the minimum set of tools it needs. Read-only is the right default — if your skill needs to write files or run commands, think carefully about whether that is really necessary.

This is still early days for skill plugins as a concept, and I expect the tooling and conventions to evolve. But the principles — version what you ship, secure your supply chain, make it easy for consumers to trust you — are timeless.

## Links

- [fp-go-skill](https://github.com/franchb/fp-go-skill) — the skill plugin discussed in this post
- [fp-go/v2](https://github.com/IBM/fp-go) — functional programming library for Go
- [SLSA](https://slsa.dev) — Supply-chain Levels for Software Artifacts
- [release-please](https://github.com/googleapis/release-please) — automated release management
