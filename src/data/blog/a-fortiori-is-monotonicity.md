---
title: "A Fortiori Is Just Monotonicity (Wearing a Latin Name)"
author: franchb
pubDatetime: 2026-06-11T08:00:00Z
featured: true
draft: false
tags:
  - logic
  - math
  - lean
  - reasoning
description: "An a-fortiori argument is exactly a claim that some predicate is monotone along an order — and 'my a-fortiori reasoning was wrong' means one of three precise assumptions failed."
ogImage: ../../assets/images/a-fortiori.png
---

I ran into this phrase in a Claude Code session. We were planning a feature with genuinely high cognitive complexity, and at one point Claude said "my a-fortiori reasoning was wrong" — and it bothered me, because I couldn't immediately say what had actually been claimed. "A fortiori" is one of those phrases you deploy by feel — it _sounds_ like the conclusion is now beyond dispute. So I went back and made the structure precise, and the precise version turns out to be a single, familiar property: monotonicity. A fortiori is monotonicity reasoning wearing a Latin name.

![A toga-clad teacher at a blackboard points to steps labelled A, B, C with φ(A), φ(B), φ(C) rising under "a ≤ b" and "Monotone φ", a Lean snippet ending in "exact hφ h", and a "Careful!" panel showing the inference failing without the right order or monotonicity — with candle, forge, 50 kg ≤ 100 kg, and seedling ≤ plant examples below.](../../assets/images/a-fortiori.png)

## Table of contents

## What the phrase actually says

_A fortiori_ is Latin — literally "from the stronger," elliptical for _a fortiori ratione_, "by the stronger reason." An a-fortiori argument says: the conclusion already holds in some case, and the case you actually care about is _more_ of whatever made it hold, so it holds **all the more**. English glosses it as "even more so" or "how much more."

The structure has a fixed shape: an ordering of cases by "strength" along some dimension, plus a claim that the property in question tracks that ordering. There are two canonical directions.

- _A maiori ad minus_ (greater → lesser): if the stronger case has the property, the weaker does too. "He carried 100 kg up the stairs, so a fortiori he can carry 50." Capacity is monotone, so meeting the harder demand entails meeting the easier one.
- _A minori ad maius_ (lesser → greater): if even the weak case has the property, the strong case does all the more. "If lighting a single candle is forbidden, a fortiori running a forge is."

## The formalization: monotonicity

The cleanest formalization — and the one that makes "was wrong" precise — is **monotonicity**. Take a poset of cases $(S, \le)$ and a predicate $\varphi : S \to \mathrm{Prop}$. The upward a-fortiori step is exactly the assertion that $\varphi$ is monotone (an up-set):

$$
a \le b \ \wedge\ \varphi(a) \implies \varphi(b)
$$

The downward version asserts $\varphi$ is down-closed:

$$
a \le b \ \wedge\ \varphi(b) \implies \varphi(a)
$$

In Lean terms the inference step _is_ an application of `Monotone φ` — that is, `a ≤ b → φ a → φ b`. Once you see it written this way, the rhetorical move stops being a rhetorical move: it's the elimination rule for an order-preserving predicate.

## So what does "my a-fortiori reasoning was wrong" mean?

It means: I argued that since case $B$ is a _stronger_ instance than $A$, and the conclusion held for $A$, it must hold even harder for $B$ — and that inference doesn't go through. Concretely, one of three assumptions failed.

1. **The predicate isn't monotone.** $\varphi$ isn't actually an up-set along this order — there's a threshold, saturation, a U-shape, or a trade-off, so "more" stops implying "more." This is the most common failure. "More fertilizer grew a bigger plant, so a fortiori twice as much grows a bigger one" — false past the toxicity threshold.
2. **Wrong order.** $B$ isn't really $\ge A$ on the axis that governs $\varphi$; you ranked them by the wrong dimension. This is often an equivocation on what "greater" means.
3. **Over-reach in the conclusion.** You inferred _more_ than the premise licenses. The rabbinic tradition names this guardrail explicitly: the _dayyo_ ("it is sufficient") principle in _qal vaḥomer_, that the inferred case can't come out stronger than its source.

Almost every botched a-fortiori argument I've traced collapses into case 1: the order is fine, but the predicate just isn't monotone along it, and "all the more" was doing the work of an assumption I never checked.

## Where the move comes from

The reasoning is ancient and well-attested. Aristotle catalogues it as a _topos_ "from the more and the less" (_ek tou mallon kai hēttōn_) in _Rhetoric_ II.23 (~1397b). In the Talmudic tradition it's _qal vaḥomer_ (קל וחומר, "light and heavy") — the first of Hillel's seven _middot_ and among R. Ishmael's thirteen, with its constraints worked out in _Bava Kamma_ 25a. There's also a modern book-length formal treatment (Avi Sion, _A Fortiori Logic_, 2013), though I haven't verified its arguments closely enough to vouch for them.

## One honesty note

The monotonicity reading is the standard _logical_ reconstruction, and I'd stand behind it — but it's my framing of the structure, not a citation. The historical sources describe the move rhetorically, not as a theorem about order-preserving maps. What the formalization buys you isn't authority; it's a checklist. Next time you reach for "a fortiori," you know exactly which three things to check before the conclusion is allowed to hold all the more.
