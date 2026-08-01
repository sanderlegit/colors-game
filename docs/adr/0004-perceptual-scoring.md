# 0004 — Score with CIEDE2000 and a stretched-exponential curve

Date: 2026-08-01 · Status: accepted
Research: `docs/research/color-science.md`, `docs/research/test-vectors.md`

## Context

The score is the product. If players feel it is arbitrary, nothing else matters.
That makes two choices load-bearing: how we measure "how different do these look",
and how we turn that number into 0–100.

Candidate metrics were CIE76, CIE94, CIEDE2000, Euclidean OKLab (ΔE_OK), and
CAM16-UCS.

## Decision

**Metric: CIEDE2000 with kL = kC = kH = 1**, computed on D65 CIELAB.

- **CIE94 is disqualified outright.** Its S_C and S_H terms weight the *reference*
  colour's chroma, so ΔE(a, b) ≠ ΔE(b, a). In a game there is no privileged
  reference — target and guess are just two colours — and a scoring function whose
  answer depends on argument order is indefensible.
- **CAM16-UCS matches ΔE00 for accuracy but needs viewing-condition parameters**
  (adapting luminance, surround) that a web page cannot know. Guessing them buys
  no accuracy over ΔE00.
- **ΔE_OK is not an adequate cheap substitute**, which was the surprise. There is
  no single scaling constant: the ratio ΔE00 / (ΔE_OK × 100) ranges from ~2.37
  near neutral to ~0.88 at high chroma — a 2.7× systematic swing, because ΔE00
  divides chroma and hue error by (1 + 0.045·C̄′) and OKLab does not. Using it
  would make the game systematically harsher on saturated targets.
- Cost is irrelevant: ~60 flops, once per round.

**Curve: `score = 100 · exp(−((max(0, ΔE00 − 1) / 16) ^ 1.3))`**

The `max(0, ΔE − 1)` deadband gives a full 100 for differences below the
perceptibility threshold — being scored 97 for a miss no human eye can see reads
as the game being broken, not as precision.

The exponent 1.3 is the tuned parameter and it is doing real work:

| shape | problem |
|-------|---------|
| Gaussian (k = 2) | chance level lands at ΔE ≈ 19, and a **random guess scores > 50 about 12% of the time** — a good score stops meaning anything |
| Exponential (k = 1) | punishes near-imperceptible misses too steeply; near-misses feel unrewarded |
| **k = 1.3** | chance level ΔE ≈ 11, **P(random > 50) = 5.4%**, near-misses still rewarded |

Reference points: ΔE 2 → 97, 5 → 85, 12 → 54, 20 → 29, 45 → 2.

Calibration anchors from the research: perceptibility threshold 0.8, acceptability
threshold 1.8 (Paravina et al. 2015); W3C treats 2 as one JND; > 5 is clearly
different. Black↔white is exactly 100; the sRGB maximum is ≈ 119.5.

## Consequences

- Correctness is verifiable rather than asserted: the implementation is tested
  against all 34 Sharma/Wu/Dalal pairs, which exist specifically to catch the
  hue-wraparound and R_T rotation bugs that naive CIEDE2000 implementations ship.
- **We must use D65 Lab with no chromatic adaptation.** CSS `lab()` is D50; mixing
  them shifts sRGB blue from L\* 32.30 to 29.57 — a silent, large divergence. This
  is the single most likely way for this module to be quietly wrong.
- The random-guess ΔE00 distribution is heavily right-skewed (mean 44.9, but the
  score distribution has median 4.9). Any "average score" surfaced in the UI must
  be a **median**, not a mean.
- Retuning is a one-line change to a pure function with property tests around it,
  so playtest-driven adjustment is cheap and safe.
