# Colour Science for the Colour-Memory Game

Research notes feeding the scoring, colour-conversion, target-generation and
picker implementation. Test vectors live in [`test-vectors.md`](./test-vectors.md).

**Provenance convention.** Claims cited to a source are quoted or paraphrased
from that source. Claims marked *(measured)* were computed for this document by
a reference implementation of the maths in §3, which was validated against all
34 Sharma test pairs to within `5e-5`. Nothing here is estimated from memory.

---

## TL;DR — the six recommendations

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Scoring metric | **CIEDE2000 (ΔE00)**, `kL=kC=kH=1`. ~60 lines, runs once per round. ΔE_OK is *not* an adequate substitute — no single scaling constant exists (measured ratio spans 0.9–2.4). |
| 2 | Score curve | `score = 100 · exp(−((max(0, ΔE00 − 1) / 16)^1.3))`. Chance level ≈ 11/100. |
| 3 | Conversion chain | Use the **CSS Color 4 exact rational matrices** (§3). Not the rounded IEC ones, not Ottosson's 7-digit blog matrices. |
| 4 | Test vectors | See [`test-vectors.md`](./test-vectors.md). All 34 Sharma pairs retrieved and verified. |
| 5 | Target generation | Sample `L` and `h` freely, then `C = t · C_max(L, h)` with `t` setting difficulty. Never uniform-in-sRGB-cube. |
| 6 | Picker | **OKLCh L×C plane** with inert out-of-gamut region + inlaid hue slider. Fallback: OKHSL square. Take-off selection everywhere; loupe on touch. |

---

## 1. Scoring metric

### 1.1 The candidates

| Metric | Year | Cost | Perceptual accuracy | Verdict |
|--------|------|------|--------------------|---------|
| **CIE76** (ΔE*ab) | 1976 | Euclidean in Lab; ~5 flops | Poor. CIELAB is markedly non-uniform — blue/violet errors are heavily over-weighted, saturated-colour errors over-weighted generally. | ❌ Rejected |
| **CIE94** (ΔE*94) | 1994 | ~20 flops | Better; adds `S_C = 1 + K₁·C₁`, `S_H = 1 + K₂·C₁` weighting. But **asymmetric** — it weights by the *reference* colour's chroma, so `ΔE(a,b) ≠ ΔE(b,a)`. | ❌ Rejected (see below) |
| **CIEDE2000** (ΔE00) | 2001 | ~60 flops, ~15 trig calls | Best-validated industry standard. | ✅ **Recommended** |
| **ΔE_OK** | 2020 | Euclidean in OKLab; ~5 flops | Good hue linearity, but no chroma/lightness weighting at all. | ⚠️ Fallback only |
| **CAM16-UCS** | 2017 | Very high | Comparable to ΔE00, but *requires viewing-condition parameters*. | ❌ Rejected |

### 1.2 Why CIE94 is disqualified outright

CIE94's `S_C` and `S_H` terms depend on `C₁` — the *reference* colour's chroma —
not on the mean. In a game, "reference" vs "sample" is arbitrary: is the
reference the target or the guess? Two defensible readings give two different
scores for the same guess. CIEDE2000 fixes exactly this by weighting on the
**mean** `C̄′`, and Sharma et al. stress that ΔE00 "is symmetric" and that
implementations "should explicitly test this by interchanging the two sets of
data … and verifying that color differences are unchanged"
([Sharma, Wu & Dalal 2005](https://hajim.rochester.edu/ece/sites/gsharma/papers/CIEDE2000CRNAFeb05.pdf)).
For a scoring function, symmetry is non-negotiable.

### 1.3 Why not CAM16-UCS

CAM16-UCS is a genuine peer of CIEDE2000 in accuracy — the literature finds them
"equivalent" and declines to recommend one over the other. But it is a *colour
appearance model*: it needs adapting luminance `L_A`, background luminance factor
`Y_b`, and a surround condition (average/dim/dark). In a browser you know **none
of these** — you cannot query the user's display brightness or ambient light.
You would be inventing the inputs, which throws away the accuracy that motivated
the choice. ΔE00 needs no viewing-condition parameters. Rejected on
practicality, not on merit.

### 1.4 Practical ΔE00 ranges

| ΔE00 | Interpretation | Source |
|------|---------------|--------|
| **< 0.8** | Imperceptible. Below the measured 50:50 perceptibility threshold. | Paravina et al. 2015 measured **PT = 0.8** ([DOI](https://onlinelibrary.wiley.com/doi/abs/10.1111/jerd.12149)) |
| **≈ 1.0** | Threshold of perceptibility — the commonly quoted JND. | Widely cited convention |
| **≈ 1.8** | 50:50 *acceptability* threshold — perceptible but tolerable. | Paravina et al. 2015 measured **AT = 1.8** |
| **2.0** | The threshold W3C adopts as "one JND" for gamut mapping. | [CSS Color 4](https://www.w3.org/TR/css-color-4/#gamut-mapping): *"In CIE Lab color space… using deltaE2000, one JND is 2."* |
| **2–5** | Barely to clearly noticeable side by side. | |
| **> 5** | Clearly different colours at a glance. | |
| **100** | Black ↔ white, **exactly**. *(measured; analytically exact)* | ΔL′=100, C′=0 ⟹ S_L=1 |
| **≈ 119.5** | **Maximum between any two sRGB colours** — `#00006E` vs `#8FFF00`. *(measured; no published source)* | Grid search + hill climbing |

Two more useful reference points *(measured)*: blue↔yellow (`#0000FF`↔`#FFFF00`)
= **103.4**; red↔green (`#FF0000`↔`#00FF00`) = **86.6**. Note that pure
complementary primaries are *not* the extreme — the maximum involves a very dark
blue against a light chartreuse, combining maximal lightness and hue separation.

> ⚠️ **Do not normalise your score by 119.5.** ΔE00's own designers state it is
> "applicable primarily for small color differences." At ΔE00 > 30 the number is
> ordinally sensible but not metrically meaningful. Use it to say "this guess is
> hopeless", not to say "this guess is 1.4× worse than that one."

### 1.5 Is ΔE_OK a good enough cheaper substitute?

**No — and the reason matters.** *(measured)*

There is no single scaling factor. Since OKLab's `L` runs 0..1 while CIELAB's
runs 0..100, the natural comparison is `ΔE_OK × 100` against `ΔE00`. The measured
ratio, over 60,000 small perturbations of random sRGB colours:

| Target OKLCh chroma | Median `ΔE00 / (ΔE_OK × 100)` |
|---------------------|-------------------------------|
| 0.00 – 0.05 (near-grey) | **2.37** |
| 0.05 – 0.10 | 1.70 |
| 0.10 – 0.15 | 1.35 |
| 0.15 – 0.20 | 1.16 |
| 0.20 – 0.25 | 1.03 |
| 0.25 – 0.30 (vivid) | **0.88** |

Overall median 1.25; 5th–95th percentile 0.81–2.50; Pearson r = 0.86.

**The spread is systematic, not noise.** ΔE00 divides chroma and hue errors by
`S_C = 1 + 0.045·C̄′` and `S_H = 1 + 0.015·C̄′·T`, so it *forgives* errors on
saturated colours and *punishes* them on near-neutrals. OKLab, being plain
Euclidean, does neither. A 2.7× swing in effective penalty depending on where
the target sits is a real gameplay difference: with ΔE_OK, guessing near-greys
gets easier and guessing vivid colours gets harder, relative to what a human
would judge.

If you *must* use ΔE_OK (e.g. scoring thousands of colours per frame — you don't
here, it's once per round), the CSS spec's own equivalence is the right anchor:
**one JND ≈ ΔE_OK of 0.02**, i.e. `ΔE00 ≈ 100 × ΔE_OK` as a first approximation
([CSS Color 4](https://www.w3.org/TR/css-color-4/#gamut-mapping)). Expect ±40%
error against true ΔE00.

**Verdict: use ΔE00.** The cost argument is void — you compute this **once per
round**, on a user button press. ~60 floating-point operations is free.

### 1.6 CIEDE2000's known pathologies — and why they don't bite here

Sharma, Wu & Dalal identify **three independent mathematical discontinuities**.
This is real and worth knowing, but it does not disqualify the metric for this
use.

1. **Mean-hue discontinuity (largest).** `h̄′` jumps by 180° when the two hue
   angles pass exactly 180° apart. It propagates into `T`, then `S_H`, then the
   `(ΔH′/S_H)²` term — which the paper identifies as the dominant contributor.
   **Bound: for colour pairs within 5 CIELAB ΔE*ab of each other, the ΔE00
   discontinuity is under 0.2734.**
2. **Hue-difference discontinuity.** The sign of `ΔH′` flips for pairs exactly
   180° apart, reversing the `R_T` rotation term. Localised near h̄′ ≈ 275°.
   **Bound: 0.0309** at chroma R = 3.3. The paper notes it is "dominated by" #1.
3. **Hue rollover at 360°** in the `Δθ` term. The paper computes the break as
   `30(exp(−(85/25)²) − exp(−(275/25)²))`, which is ≈ **2.9e-4 degrees** —
   negligible.

**Why this is fine for the game.** All three discontinuities require the two
colours to be ~180° apart in hue. Sharma et al.: *"the only situation under which
they may lie in opposite quadrants is for the case of colors close to gray. These
have a low value of chroma and therefore the magnitude of the discontinuity will
be small."* A worst case of 0.27 ΔE00 lands inside the score curve's JND dead
zone (§2) and is invisible in a 0–100 score. It would matter for a colour-tolerance
QA system; it does not matter here.

---

## 2. Score curve

### 2.1 Where chance level sits *(measured)*

Monte Carlo, n = 120,000 independent uniform random sRGB8 pairs:

| Statistic | ΔE00 |
|-----------|------|
| Mean | **44.9** |
| Median | 43.0 |
| 5th percentile | 12.8 |
| 95th percentile | 84.3 |

Against targets from the recommended OKLCh generator (§5) rather than uniform
sRGB, the mean drops slightly to **41.5** (n = 25,000). Design around
**ΔE00 ≈ 42–45 as "a wild guess."**

### 2.2 The recommended curve

```
score(ΔE00) = 100 · exp( −( max(0, ΔE00 − d₀) / τ )^k )

d₀ = 1.0   (JND dead zone — below this the player literally cannot do better)
τ  = 16.0  (scale; the main "generosity" knob)
k  = 1.3   (shape; flattens the top, sharpens the bottom-out)
```

```ts
export function scoreFromDeltaE(deltaE00: number): number {
  const D0 = 1.0, TAU = 16.0, K = 1.3;
  const d = Math.max(0, deltaE00 - D0);
  return 100 * Math.exp(-Math.pow(d / TAU, K));
}
```

**Why a stretched exponential (`k = 1.3`) rather than the obvious choices:**

- **Pure exponential (`k = 1`)** decays too fast at the top: a barely-perceptible
  ΔE00 of 2 already loses 6 points, which feels punishing for a guess the player
  can't visually distinguish from correct.
- **Gaussian (`k = 2`)** is too flat at the top and too generous overall
  *(measured)*: chance level rises to **E[score] ≈ 19** with a **12% chance a
  purely random guess scores over 50**. That undermines the whole scoring
  premise.
- **`k = 1.3`** sits between: flat enough near zero that near-misses feel
  rewarded, steep enough through the mid-range that skill shows, and it bottoms
  out hard.

### 2.3 Score table

| ΔE00 | Score | What this feels like |
|------|-------|----------------------|
| 0 | 100.0 | Exact |
| 1 | 100.0 | Imperceptible — full marks, by design |
| 2 | 97.3 | Barely noticeable |
| 3 | 93.5 | Noticeable on close inspection |
| 5 | 84.8 | Clearly a near miss |
| 8 | 71.1 | Right neighbourhood |
| 12 | 54.1 | Recognisably related |
| 20 | 28.6 | Wrong, but not absurd |
| 30 | 11.5 | Bad |
| 45 | 2.4 | **≈ chance** |
| 60 | 0.4 | Bottomed out |
| 100 | 0.0 | Black vs white |
| 119.5 | 0.0 | sRGB maximum |

### 2.4 Chance-level behaviour *(measured, n = 40,000)*

| Statistic | Value |
|-----------|-------|
| **E[score] under random guessing** | **11.0** |
| Median random score | 4.9 |
| P(random guess scores > 50) | **5.4%** |
| P(random guess scores > 75) | ~1.4% |

Note the mean (11.0) is far above the median (4.9): the distribution is heavily
right-skewed. Most random guesses score near zero; occasionally one lands lucky.
That is healthy — it keeps a bad round from feeling deterministic — but if you
show a running average, **report the median or trimmed mean**, not the raw mean,
or lucky flukes will distort it.

### 2.5 Tuning knobs

- **Too harsh?** Raise `τ` to 18 (ΔE00 = 5 → 86.8, ΔE00 = 12 → 66.6; chance rises
  to E ≈ 13.4, P(>50) = 6.8%). *(measured)*
- **Too easy?** Lower `τ` to 14.
- **Difficulty tiers:** vary `τ` per tier rather than changing the curve shape.
- **Keep `d₀ = 1.0`.** It guarantees a perceptually perfect guess scores exactly
  100, which matters more for player trust than any other property of the curve.
- Round for display, but **keep the unrounded value** if you aggregate across rounds.

---

## 3. Colour conversion chain — exact maths

> **Source of truth: the CSS Color 4 reference implementation**
> ([spec](https://www.w3.org/TR/css-color-4/), [conversions.js](https://drafts.csswg.org/css-color-4/conversions.js)).
> Use these constants verbatim. §3.7 explains why the popular alternatives are worse.

### 3.1 sRGB 8-bit → linear-light sRGB

Divide by 255 to get `v ∈ [0,1]`, then apply the piecewise transfer function:

```
lin(v) = v / 12.92                        if v ≤ 0.04045
lin(v) = ((v + 0.055) / 1.055)^2.4        if v >  0.04045
```

Inverse (linear → gamma-encoded):

```
gam(u) = 12.92 · u                        if u ≤ 0.0031308
gam(u) = 1.055 · u^(1/2.4) − 0.055        if u >  0.0031308
```

**Exact thresholds: `0.04045` forward, `0.0031308` inverse.** They are *not* the
same number and are not each other's images — the sRGB standard rounds them
independently. Using 0.04045 in both directions is a common bug.

For robustness with out-of-range values, mirror through the origin (as the CSS
code does): take `sign = v < 0 ? −1 : 1`, operate on `|v|`, reapply the sign.

### 3.2 Linear sRGB → CIEXYZ (D65)

The CSS spec defines this as exact rationals; decimals to 16 s.f. alongside:

```
[ X ]   [ 506752/1228815   87881/245763     12673/70218   ] [ R_lin ]
[ Y ] = [  87098/409605   175762/245763     12673/175545  ] [ G_lin ]
[ Z ]   [   7918/409605    87881/737289   1001167/1053270 ] [ B_lin ]

= [ 0.4123907992659595, 0.3575843393838780, 0.1804807884018343 ]
  [ 0.2126390058715104, 0.7151686787677559, 0.0721923153607337 ]
  [ 0.0193308187155918, 0.1191947797946260, 0.9505321522496606 ]
```

Inverse (XYZ D65 → linear sRGB):

```
[ 12831/3959      −329/214      −1974/3959   ]   [  3.2409699419045213, −1.5373831775700935, −0.4986107602930033 ]
[ −851781/878810  1648619/878810  36519/878810 ] = [ −0.9692436362808798,  1.8759675015077206,  0.0415550574071756 ]
[ 705/12673       −2585/12673     705/667     ]   [  0.0556300796969936, −0.2039769588889766,  1.0569715142428786 ]
```

**No chromatic adaptation** — sRGB's own white *is* D65.

### 3.3 CIEXYZ (D65) → CIELab

White point (from the CSS spec's 4-figure CIE chromaticities `x=0.3127, y=0.3290`):

```
Xn = 0.3127 / 0.3290                   = 0.9504559270516716
Yn = 1.0
Zn = (1 − 0.3127 − 0.3290) / 0.3290    = 1.0890577507598784
```

Constants as exact rationals (the CIE now defines them this way):

```
ε = 216/24389  = 0.0088564516790356    (= 6³/29³)
κ = 24389/27   = 903.2962962962963     (= 29³/3³)
```

Then:

```
xr = X/Xn,  yr = Y/Yn,  zr = Z/Zn

f(t) = t^(1/3)              if t > ε
f(t) = (κ·t + 16) / 116     otherwise

L* = 116 · f(yr) − 16
a* = 500 · (f(xr) − f(yr))
b* = 200 · (f(yr) − f(zr))
```

> ⚠️ **D65 vs D50 — the most likely mistake in this whole document.**
> CSS's `lab()` function is **D50**-referenced (via Bradford adaptation), because
> that is the ICC profile connection space. For scoring sRGB colours you want
> **D65 Lab with no adaptation**, as above. They differ substantially: `#0000FF`
> is `L*=32.30` in D65 Lab but `L*=29.57` in CSS `lab()`. Both are "CIELab."
> Pick D65, and never compare values across the two.

### 3.4 Linear sRGB → OKLab

Two equivalent routes. **Prefer route B.**

**Route A — Ottosson's direct matrices** ([blog post](https://bottosson.github.io/posts/oklab/)):

```
[ l ]   [ 0.4122214708  0.5363325363  0.0514459929 ] [ R_lin ]
[ m ] = [ 0.2119034982  0.6806995451  0.1073969566 ] [ G_lin ]
[ s ]   [ 0.0883024619  0.2817188376  0.6299787005 ] [ B_lin ]

l' = cbrt(l),  m' = cbrt(m),  s' = cbrt(s)

[ L ]   [ 0.2104542553   0.7936177850  −0.0040720468 ] [ l' ]
[ a ] = [ 1.9779984951  −2.4285922050   0.4505937099 ] [ m' ]
[ b ]   [ 0.0259040371   0.7827717662  −0.8086757660 ] [ s' ]
```

**Route B — via XYZ, using CSS's recomputed 64-bit matrices (recommended):**

```
XYZ (D65) → LMS:
[ 0.8190224379967030  0.3619062600528904  −0.1288737815209879 ]
[ 0.0329836539323885  0.9292868615863434   0.0361446663506424 ]
[ 0.0481771893596242  0.2642395317527308   0.6335478284694309 ]

cube root each component (signed!)

LMS' → OKLab:
[ 0.2104542683093140   0.7936177747023054  −0.0040720430116193 ]
[ 1.9779985324311684  −2.4285922420485799   0.4505937096174110 ]
[ 0.0259040424655478   0.7827717124575296  −0.8086757549230774 ]
```

Inverse (OKLab → XYZ D65):

```
OKLab → LMS':
[ 1.0000000000000000   0.3963377773761749   0.2158037573099136 ]
[ 1.0000000000000000  −0.1055613458156586  −0.0638541728258133 ]
[ 1.0000000000000000  −0.0894841775298119  −1.2914855480194092 ]

cube each component

LMS → XYZ:
[  1.2268798758459243  −0.5578149944602171   0.2813910456659647 ]
[ −0.0405757452148008   1.1122868032803170  −0.0717110580655164 ]
[ −0.0763729366746601  −0.4214933324022432   1.5869240198367816 ]
```

**Why route B:** Ottosson's blog matrices carry ~7 significant figures, so a
neutral grey does not come out exactly neutral. *(measured)* residual `|a|,|b|`
for `#FFFFFF`: **~3.7e-8** with Ottosson's matrices vs **~5e-16** with CSS's. The
CSS source comments say its matrices were *"recalculated for consistent reference
white"* and *"recalculated for 64bit precision"* for precisely this reason.

**`L` is in 0..1**, not 0..100. Multiply by 100 for CSS `oklab()` percentages.

> ⚠️ **Use `Math.cbrt`, not `Math.pow(x, 1/3)`.** The CSS source flags this
> explicitly: *"JavaScript Math.cbrt returns a sign-matched cube root — beware if
> porting to other languages, especially if tempted to use a general power
> function."* `Math.pow(-0.5, 1/3)` is `NaN`. Negative LMS values occur for
> out-of-gamut and near-gamut-boundary colours.

### 3.5 OKLab ↔ OKLCh

```
C = sqrt(a² + b²)
h = atan2(b, a) · 180/π,   then  if (h < 0) h += 360      // degrees, [0, 360)

a = C · cos(h · π/180)
b = C · sin(h · π/180)
```

**Hue is undefined when chroma is ~0.** CSS's reference code sets `h = NaN` when
`C ≤ epsilon`, with `epsilon = 0.000004` for OKLCh and `0.0015` for CIE LCh.
*(measured)* Without this guard, `#808080` reports a hue of 180.3° — pure
floating-point noise. Never feed such a hue into the picker or generator.

### 3.6 CIEDE2000, complete

Given `(L₁*, a₁*, b₁*)`, `(L₂*, a₂*, b₂*)` and parametric factors `kL, kC, kH`
(all **1** for this game — they exist to model textiles/viewing conditions).

**Step 1 — chroma-corrected coordinates**

```
C₁,ab = sqrt(a₁*² + b₁*²)          C₂,ab = sqrt(a₂*² + b₂*²)
C̄ab   = (C₁,ab + C₂,ab) / 2

G = 0.5 · (1 − sqrt( C̄ab⁷ / (C̄ab⁷ + 25⁷) ))        // 25⁷ = 6103515625

a'ᵢ = (1 + G) · aᵢ*
C'ᵢ = sqrt(a'ᵢ² + bᵢ*²)

h'ᵢ = 0                              if bᵢ* = 0 and a'ᵢ = 0
h'ᵢ = atan2(bᵢ*, a'ᵢ) in [0°, 360°)  otherwise
```

**Step 2 — differences**

```
ΔL' = L₂* − L₁*
ΔC' = C'₂ − C'₁

Δh' = 0                    if C'₁·C'₂ = 0
Δh' = h'₂ − h'₁            if C'₁·C'₂ ≠ 0 and |h'₂ − h'₁| ≤ 180°
Δh' = (h'₂ − h'₁) − 360°   if C'₁·C'₂ ≠ 0 and  (h'₂ − h'₁) >  180°
Δh' = (h'₂ − h'₁) + 360°   if C'₁·C'₂ ≠ 0 and  (h'₂ − h'₁) < −180°

ΔH' = 2 · sqrt(C'₁·C'₂) · sin(Δh' / 2)
```

**Step 3 — weighting and combination**

```
L̄' = (L₁* + L₂*) / 2
C̄' = (C'₁ + C'₂) / 2

h̄' = h'₁ + h'₂                     if C'₁·C'₂ = 0
h̄' = (h'₁ + h'₂) / 2               if |h'₁ − h'₂| ≤ 180°
h̄' = (h'₁ + h'₂ + 360°) / 2        if |h'₁ − h'₂| > 180° and (h'₁ + h'₂) <  360°
h̄' = (h'₁ + h'₂ − 360°) / 2        if |h'₁ − h'₂| > 180° and (h'₁ + h'₂) ≥ 360°

T = 1 − 0.17·cos(h̄' − 30°)
      + 0.24·cos(2·h̄')
      + 0.32·cos(3·h̄' + 6°)
      − 0.20·cos(4·h̄' − 63°)

Δθ = 30 · exp( −((h̄' − 275°) / 25)² )

R_C = 2 · sqrt( C̄'⁷ / (C̄'⁷ + 25⁷) )

S_L = 1 + (0.015 · (L̄' − 50)²) / sqrt(20 + (L̄' − 50)²)
S_C = 1 + 0.045 · C̄'
S_H = 1 + 0.015 · C̄' · T

R_T = −sin(2 · Δθ) · R_C
```

```
ΔE00 = sqrt(  (ΔL'/(kL·S_L))²
            + (ΔC'/(kC·S_C))²
            + (ΔH'/(kH·S_H))²
            + R_T · (ΔC'/(kC·S_C)) · (ΔH'/(kH·S_H)) )
```

### 3.7 Where naive implementations get CIEDE2000 wrong

Sharma et al. found that "several of the implementations distributed on the
Internet, including some from reputable sources, were erroneous" — and that all
of them **passed** the CIE's own worked examples. These are the specific traps:

1. **Taking `abs()` of ΔC′ or ΔH′.** ⚠️ *The single most common bug.* The
   predecessors (ΔE*ab, ΔE94) only need `|ΔH|²`, so implementers porting old code
   carry the habit over. The sign matters **only** in the `R_T` cross-term, which
   is non-negligible only near hue 275° (blue) — so the bug is nearly invisible
   unless specifically tested. *Detected by pairs 1–6 (ΔH′) and 21–24 (ΔC′).*
   Note: `abs()` on *one* of them makes the formula asymmetric; `abs()` on *both*
   makes it symmetric but still wrong.

2. **Wrong arctangent.** You need a **four-quadrant** `atan2(b*, a')` — note the
   argument order and that it takes `a'`, the *G-corrected* value, not `a*`. Then
   map to `[0°, 360°)` by adding 360 to negatives. Using `atan(b/a)` loses the
   quadrant. *Detected by pairs 7–16.*

3. **Naive mean hue `(h₁' + h₂')/2`.** ⚠️ The four-case rule in Step 3 is
   essential. Sharma et al.: *"Most existing implementations … were seen to have
   an error in the computation of average hue."* Note the CIE Technical Report
   and the Luo-Cui-Rigg paper describe this differently and a verbatim reading of
   either yields angles outside `[0, 360)`; the four-case form above is Sharma's
   disambiguation. *Detected by pairs 9–16.*

4. **Mishandling `C'₁·C'₂ = 0`** (one colour exactly neutral). Both `Δh'` and
   `h̄'` have special cases. Getting this wrong gives `NaN` or a division by
   zero. *Detected by pairs 7 and 8.*

5. **Degrees/radians confusion.** `T`, `Δθ`, `R_T` are written in **degrees**;
   JS trig takes **radians**. `sin(2·Δθ)` needs `Δθ` converted. Mixing units here
   produces plausible-looking but wrong results.

6. **Using `a*` instead of `a'` when computing `h'`** — but `b*` (not a
   `b'`, which doesn't exist). Only the `a` axis is scaled by `(1+G)`.

7. **Computing `G` from `C'` instead of `C*ab`.** `G` is defined from the
   *original* chroma mean, before correction. Circular definition if you get it
   backwards.

8. **`25⁷` overflow.** `25⁷ = 6103515625` exceeds 32-bit int. Fine in JS
   (doubles), a real bug in other languages. Also `C̄'⁷` can overflow for large
   chroma in fixed-point implementations.

> **Test against all 34 pairs in [`test-vectors.md`](./test-vectors.md).** The
> original CIE worked examples (pairs 25–34) do not exercise traps 1–4 at all.

---

## 5. Target colour generation

### 5.1 Why uniform-in-sRGB-cube is a bad default

Sampling `r, g, b ~ U{0..255}` looks neutral but is badly biased. *(measured,
n = 200,000, converted to OKLCh)*:

**Hue bias — a 4.5× spread:**

| Hue band | Share | vs uniform (8.33%) |
|----------|-------|--------------------|
| 120–150° (greens) | **18.6%** | **2.2× over** |
| 300–330° | 10.0% | 1.2× over |
| 0–30° (reds) | 8.6% | ~even |
| 180–210° (cyans) | 5.1% | 1.6× under |
| 210–240° (azures) | **4.1%** | **2.0× under** |
| 60–90° (yellow-greens) | 4.5% | 1.8× under |

The cube's geometry, not perception, decides this: green occupies a
disproportionate share of the cube's volume because the sRGB green primary is the
most luminous and the gamut is fattest there.

**Chroma bias — most of the cube is mud:** median OKLCh chroma **0.147**; only
**7.4%** of samples exceed C = 0.25; 24% fall below C = 0.10. High-chroma colours
live near the cube's edges, which is a vanishing fraction of its volume. A
uniform sampler produces a dreary, muddy game.

**Lightness bias — skewed light:** mean `L* = 57.5`; only 5% of samples fall
below `L* = 23.6`. Very dark colours are rare.

**Verdict: never sample uniformly in the sRGB cube.** You get mostly muddy
mid-greens.

### 5.2 The gamut is *not* a cylinder — measured `C_max(L, h)`

Maximum in-gamut OKLCh chroma for sRGB *(measured by bisection)*:

| L \ h | 0° | 30° | 60° | 90° | 120° | 150° | 180° | 210° | 240° | 270° | 300° | 330° |
|-------|----|----|----|----|------|------|------|------|------|------|------|------|
| 0.15 | 0.062 | 0.063 | 0.037 | 0.032 | 0.037 | 0.043 | 0.028 | 0.027 | 0.036 | 0.100 | 0.082 | 0.070 |
| 0.25 | 0.102 | 0.101 | 0.059 | 0.052 | 0.060 | 0.069 | 0.046 | 0.044 | 0.058 | 0.164 | 0.134 | 0.115 |
| 0.35 | 0.142 | 0.141 | 0.082 | 0.072 | 0.083 | 0.097 | 0.064 | 0.061 | 0.080 | 0.230 | 0.187 | 0.160 |
| 0.45 | 0.183 | 0.181 | 0.106 | 0.092 | 0.107 | 0.124 | 0.082 | 0.078 | 0.103 | 0.295 | 0.240 | 0.205 |
| 0.55 | 0.223 | 0.221 | 0.129 | 0.112 | 0.131 | 0.152 | 0.100 | 0.095 | 0.126 | 0.248 | 0.294 | 0.251 |
| 0.65 | 0.260 | 0.236 | 0.153 | 0.133 | 0.154 | 0.179 | 0.118 | 0.112 | 0.149 | 0.186 | 0.221 | 0.296 |
| 0.75 | 0.165 | 0.151 | 0.176 | 0.153 | 0.178 | 0.207 | 0.136 | 0.130 | 0.144 | 0.128 | 0.152 | 0.247 |
| 0.85 | 0.089 | 0.082 | 0.101 | 0.174 | 0.202 | 0.234 | 0.154 | 0.137 | 0.083 | 0.074 | 0.087 | 0.134 |
| 0.95 | 0.027 | 0.025 | 0.031 | 0.064 | 0.171 | 0.083 | 0.072 | 0.044 | 0.027 | 0.024 | 0.028 | 0.041 |

`C_max` ranges from **0.024 to ~0.32** — a **13× swing**. There is no useful
fixed chroma cap. The cusp (peak chroma) sits at a different lightness for every
hue: blue peaks dark (`L ≈ 0.45`, `C ≈ 0.30`), yellow peaks light (`L ≈ 0.95`
still reaches `C ≈ 0.17` at 120°). Teal/azure (`h ≈ 200°`) is the most
gamut-starved direction at every lightness.

### 5.3 Recommended generator

Sample `L` and `h` freely, then express chroma as a **fraction of what's
available** at that `(L, h)`:

```ts
function generateTarget(tier: Tier): RGB {
  const { lRange, tRange } = TIERS[tier];
  const L = uniform(lRange[0], lRange[1]);
  const h = uniform(0, 360);
  const t = uniform(tRange[0], tRange[1]);   // fraction of max chroma
  const C = t * maxChroma(L, h);             // bisection, ~30 iterations
  return oklchToSrgb8(L, C, h);
}
```

This gives **uniform hue coverage by construction**, full use of the gamut at
every hue, and — crucially — makes `t` a direct, hue-independent difficulty dial.
A `t` of 0.9 is "vivid" whether the hue is yellow or teal, even though the
absolute chroma differs by 2×.

**Difficulty tiers:**

| Tier | `L` range | `t` range | Character |
|------|-----------|-----------|-----------|
| **Easy** | 0.45 – 0.75 | 0.80 – 1.00 | Vivid, mid-lightness. Strong category labels ("red", "teal") — easy to encode verbally. |
| **Medium** | 0.35 – 0.85 | 0.45 – 0.90 | Recognisable but needs modifiers ("dusty rose"). |
| **Hard** | 0.25 – 0.90 | 0.12 – 0.50 | Desaturated, muddy mid-tones. Weak category labels. |
| **Expert** | 0.30 – 0.80 | 0.10 – 0.35 | Near-neutral. Additionally: constrain `h` to a narrow band across a session so successive targets are confusable. |

The tiering rests on real psychology, not vibes: colour memory stores a coarse
**category label** plus a noisy particular, and maintenance in working memory
*amplifies* the category bias (Bae, Olkkonen, Allred & Flombaum 2015,
[PDF](https://www.sas.upenn.edu/~mariaol/files/BaeEtAlJEP2015.pdf)). Colours with
distinct labels are remembered more precisely; colours between categories are
remembered worse. So **low chroma is genuinely harder**, because it weakens the
label. That is the right difficulty axis.

⚠️ **`maxChroma` returns ~0 as `L → 0` or `L → 1`.** Clamp `L` away from the
extremes (the tiers above do) or you will generate near-blacks and near-whites
with no chroma to guess.

### 5.4 Gamut clipping: chroma reduction, not RGB clamping

**Never clamp RGB channels.** The CSS spec's own worked example: linear-light
`(0.5, 1, 3)` has OKLCh hue **265.1°**; clamped to `(0.5, 1, 1)` it becomes
**196.1°** — *"a substantial change of 69°."* Clamping changes the *ratios*
between primaries, which is exactly what hue is.

**Do reduce chroma at constant `L` and `h`.** For target generation the
`C = t · C_max(L, h)` construction means you are always in gamut already, so this
only matters for the picker and for any colour arithmetic.

**Use OKLCh, not CIE LCh, for the reduction.** The CSS spec is explicit that
constant-hue chroma reduction in CIE LCh *"is known to give suboptimal results
with significant hue shifts, for colors in the hue range 270° to 330°"* — CIELAB's
notorious blue-turns-purple curvature. Of OKLCh it says: *"Using OkLCh color space
and the deltaEOK distance metric avoids this issue at all hue angles."*

If you need a general gamut mapper, implement CSS Color 4's **binary search with
local MINDE** ([§14.2](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)):
binary-search chroma downward at fixed `L`, `h`; at each step compare the current
colour to its clipped version using ΔE_OK; accept the clipped version once
`ΔE_OK < JND`. Spec constants: **`JND = 0.02`, `epsilon = 0.0001`**. The local-MINDE
refinement matters because it *"avoids excessive chroma reduction near concave
gamut surfaces"* — a plain chroma search overshoots and desaturates too much.

---

## Picker UX

> **⚠ SUPERSEDED — do not build from this section.**
> Everything below prescribes the ADR 0005 picker: an OKLCh L×C plane at constant
> hue, an inlaid hue slider, and an inert out-of-gamut region. That design was
> built, played, and **reversed in [ADR 0007](../adr/0007-picker-shows-every-hue.md)**
> because a single-hue plane is unsearchable — the player cannot find the colour
> they memorised. The current picker puts hue × chroma in the plane and lightness
> on a bar, and has no out-of-gamut region at all.
>
> Note especially that the ranking below concludes **"OKHSL — best"**. That answers
> "which cylinder is least bad", not "which picker should we ship"; the fairness
> rebuttal is a later subsection, and ADR 0007 supersedes both.
>
> Still valid here: the precision budget, finger-occlusion mitigations (take-off
> selection, the loupe) and minimum touch-target sizes. Those are properties of
> touch input, not of the axis layout, and the current picker keeps them.

*(Item 6. Guideline and HCI claims are cited; the precision figures in the
"Fairness" and "Precision" subsections were computed for this document.)*

### Which picker best serves memory recall

**Ranking: OKHSL > OKHSV > HSL > HSV >> three RGB sliders.**

The argument follows from §5.3: memory stores a **category label** plus noise. So
the picker's axes should be the axes the player's verbal label is built from —
"a muted teal" decomposes into hue (teal) + chroma (muted) + lightness.

- **Three RGB sliders — reject.** No axis corresponds to any word in "muted
  teal"; the player must solve an inverse problem. Koenderink, van Doorn & Ekroll,
  *Color Picking: The Initial 20s* ([ACM TAP](https://dl.acm.org/doi/10.1145/2883613))
  found "a major dichotomy between three-slider interfaces, and those that offer
  some form of 2D selectivity." (Caveat: if you ever do ship sliders, **recolor
  the tracks live** — [dynamic sliders beat static ones on nearly every usability
  measure](https://oaktrust.library.tamu.edu/items/b116d8a7-3700-4e26-a70c-c36594555b0e).)
- **HSV — the classic, but its V axis lies.** The whole top edge is V=1, running
  from white to fully vivid; those differ hugely in lightness. "V" is not the
  player's mental light/dark dimension.
- **HSL — better verbal mapping.** Top edge uniformly white, bottom uniformly
  black, vivid in the middle.
- **OKHSL — best.** Ottosson's stated aim was exactly this: *"to create a color
  space that was better suited for being used in color pickers than the current
  HSL"* ([Two new color spaces for color picking](https://bottosson.github.io/posts/colorpicker/)).
  He names HSL's defects directly — hue has *"quite severe distortions"* and
  HSL's lightness *"does not match the perception of lightness well at all for
  saturated colors."*

### Is it unfair to score in ΔE00 while picking in HSV?

**Yes — and the surprise is that OKHSV/OKHSL barely help.**

Measured local perceptual scale across a 300×300 square, averaged over 12 hues.
"Unfairness" is the p95/p5 ratio of ΔE00-per-pixel² — how much a fixed pixel slip
costs depending on where the target sits:

| Parameterization | Unfairness ratio | % of area with a near-dead axis | Out of gamut |
|------------------|------------------|--------------------------------|--------------|
| HSV (S×V) | **4.0×** | 24% | 0% |
| OKHSV | 3.9× | 26% | 0% |
| OKHSL | 3.5× | 29% | 0% |
| **OKLCh (L×C, C normalized per hue)** | **2.2×** | **2%** | **~50%** |

**The problem is topological, not perceptual.** Any HSV/HSL-like space maps the
gamut to a **cylinder**, and a cylinder must **collapse**: the entire bottom edge
of an HSV square is black regardless of S; the entire S=0 column is achromatic
regardless of hue. Where the space collapses, one screen axis is perceptually
dead — a big pixel error costs ~0 ΔE00 there, while the same error elsewhere costs
several. Ottosson concedes the collapse is the price of the cylinder: *"independent
control of hue, lightness and chroma can not be achieved in a color space that
also maps sRGB to a simple geometrical shape."* OKHSL fixes *which colours sit
where*; it does not remove the degeneracy — hence 24% → 29% dead-axis area, i.e.
**no fairness improvement at all**.

Only a true OKLCh L×C plane flattens the metric (4.0× → 2.2×). Its cost is that
**~50% of the L×C rectangle is out of sRGB gamut at every hue**, because the
in-gamut slice is a non-convex, cusp-shaped region
([Ottosson, sRGB gamut clipping](https://bottosson.github.io/posts/gamutclipping/)).

**A fairness fix that is independent of picker choice:** apply §5.3's generator
and avoid degenerate regions (very low `L`, very low `C`). If you keep HSV, this
is the highest-value change available.

### Precision budget for a 300×300 square

*(measured; ΔE00 per pointer slip, median over 12 hues, HSV square)*

| Slip | Median ΔE00 | p95 |
|------|-------------|-----|
| 1 px | **0.18** | 0.28 |
| 5 px | 0.90 | 1.38 |
| 10 px | 1.80 | 2.76 |
| 30 px | 5.27 | 8.08 |

Three conclusions:

1. **For mouse, 300×300 is already plenty — do not build a fine-tune mode for
   the square.** A 1 px slip costs 0.18 ΔE00, below the JND *and* below the 8-bit
   display's own quantization floor. *(measured independently)* adjacent sRGB
   codes differ by a median of **0.24 ΔE00** (p5 0.06, p95 0.59) for a
   single-channel step, and **0.19–0.39** for a neutral grey step. The square is
   finer than the screen can show.
2. **The hue slider is the real bottleneck — by ~5×.** 300 px over 360° is
   1.2°/px, which at full chroma is *(measured independently)* **mean 0.93 ΔE00
   per pixel, median 0.86, peaking at 2.33** — one pixel of hue can exceed twice
   the JND. This compounds badly, because hue is the
   dimension players remember *best* (it carries the category label). **If you
   build one fine-tune affordance, build it for hue.** Slider *thickness* doesn't
   affect resolution, so WCAG's 24 px minimum is free.
3. **For touch, the square absolutely needs refinement.** A 7–10 mm contact patch
   is ~26–38 CSS px (1 mm ≈ 3.78 CSS px at 96 dpi) — **9–13% of a 300 px axis**,
   giving median error **5.3–6.6 ΔE00**, p95 up to 10. Without mitigation, touch
   players are scored on their finger width rather than their memory.

### Finger occlusion — the standard mitigations

1. **Take-off (lift-off) selection** — Potter, Weldon & Shneiderman, CHI '88.
   Selection commits where the finger *lifts*, not where it lands, so the player
   can land roughly and drag to correct. Enabled targets down to ~1.7×2.2 mm vs
   ~20 mm for land-on. **Cheapest, highest-leverage fix. Implement it everywhere.**
2. **Offset cursor** — Potter et al. 1988; Sears & Shneiderman 1991. A pointer
   sits a fixed distance above the contact point. Vogel & Baudisch's critique:
   users *"cannot aim for the actual target any more"*, a constant offset *"makes
   some display areas unreachable"*, and it measured **1.57× slower than bare
   touch** for targets ≥ 24 px.
3. **Shift (callout/magnifier)** — Vogel & Baudisch, *Shift: A Technique for
   Operating Pen-Based Interfaces Using Touch*, CHI 2007
   ([PDF](https://www.patrickbaudisch.com/publications/2007-Vogel-CHI07-Shift.pdf)).
   On contact a callout shows a copy of the occluded region in a non-occluded
   spot; user refines and commits by lifting. **This is the ancestor of the iOS
   text-selection loupe.** Published parameters: 26 mm callout, 22 mm above
   contact, edge-aware repositioning, CD gain up to 8×. Unaided touch had **81%
   error** on 6 px targets; **zero of 12 participants preferred unaided touch**.

Apple removed the iOS loupe in iOS 13 and **restored it in iOS 15** after
complaints — good evidence the pattern is load-bearing.

Note: Shift escalates conditionally based on target size. A colour plane is a
*continuous surface*, so that heuristic doesn't apply — **escalate
unconditionally on touch**.

### Minimum touch target sizes

| Source | Requirement |
|--------|-------------|
| [Apple HIG](https://developer.apple.com/design/tips/) | **44 × 44 pt** |
| [Material / Android](https://support.google.com/accessibility/android/answer/7101858?hl=en) | **48 × 48 dp**, ≥ 8 dp apart (~9 mm; recommends 7–10 mm) |
| [WCAG 2.2 SC 2.5.8 (AA)](https://www.w3.org/TR/WCAG22/#target-size-minimum) | **24 × 24 CSS px** |
| WCAG 2.2 SC 2.5.5 (AAA) | **44 × 44 CSS px** |
| [NN/g](https://www.nngroup.com/articles/touch-target-size/) | ≥ 1 cm × 1 cm |

**Directly relevant:** [Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
states that *"targets that allow for values to be selected spatially based on
position within the target are considered one target"* and names **colour pickers
displaying a gradient** as the example. So the 300×300 plane is **one target** and
passes trivially. The obligation falls on the chrome: hue slider thickness and the
confirm button.

### Recommendation

**Primary: OKLCh L×C plane filling the swatch footprint, out-of-gamut region
rendered inert, hue slider inlaid along the bottom edge.**

```
┌──────────────────────────────┐   ┌──────────┐
│  OKLCh   L (vertical)        │   │   live   │
│        × C (horizontal)      │   │  preview │
│  out-of-gamut: dimmed,       │   │          │
│  hatched, pointer clamped    │   │ [Confirm]│
│                       268px  │   └──────────┘
├──────────────────────────────┤    (outside footprint)
│  hue slider            32px  │
└──────────────────────────────┘
              300px
```

- **The inlay is nearly free:** 300 → 268 px on the L axis moves median error
  from 0.18 to 0.20 ΔE00/px, still under the 8-bit floor. **Do not shrink the
  square and put hue outside** — the footprint match is the game mechanic.
- **32 px clears WCAG 2.5.8 (AA).** Use 44 px if you can spare it (median only
  reaches 0.21 ΔE00/px — genuinely free) to also satisfy Apple/AAA.
- **Hue on the wide bottom axis**, since hue is the precision bottleneck.
- **Render the out-of-gamut half as inert** rather than hiding it. It becomes a
  legible affordance instead of a trap, and it *teaches* that vivid yellows are
  light and vivid blues are dark — which is true and useful.
- **Take-off selection on all inputs.** Pointer-down never commits.
- **Always-on loupe for touch:** ~26 mm callout, ~22 mm above contact,
  edge-aware, dashed leader line; reduced CD gain (3–4×) during refinement.
- **Fine-tune hue only:** arrows = 1 px, Shift+arrow = 0.1 px.
- **Recolor the hue slider track live** to reflect current L and C.

**Fallback: OKHSL square (S × L) + the same inlaid hue slider.** Ship this if the
out-of-gamut region tests badly or the shifting live area proves disorienting.
Keeps full-rectangle usability and the best verbal-label mapping; gives up metric
fairness (stays ~3.5×, 29% near-dead area). Compensate by biasing target sampling
away from low-L / low-C, and consider normalising the score by the local
perceptual scale at the target.

**Do not ship:** three RGB sliders, or plain HSV.

### One perceptual caution not in the brief

> **⚠ SUPERSEDED as a recommendation.** The afterimage effect described below is
> real and was implemented as a neutral mask
> ([ADR 0006](../adr/0006-afterimage-mask.md)), then **removed on feel in
> [ADR 0008](../adr/0008-dissolve-straight-into-the-picker.md)**. The bias is
> knowingly unmitigated. Read this for the mechanism, not as a thing to build.

A 5 s fixation on a saturated swatch produces a **negative afterimage**, and this
design places the picker at the *exact retinal location* the swatch just
occupied. The player will judge the picker through an afterimage tinted opposite
the target hue — a systematic bias in precisely the direction the scoring is most
sensitive to. Mitigations: lengthen the fade-out, insert a ~500 ms mid-grey mask
between swatch and picker, or avoid the most saturated targets. Worth measuring
early — it could dominate every picker-choice effect above.

---

## Sources

**Primary specifications and papers**
- Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula: Implementation notes, supplementary test data, and mathematical observations", *Color Research & Application* 30(1):21–30 — [PDF](https://hajim.rochester.edu/ece/sites/gsharma/papers/CIEDE2000CRNAFeb05.pdf) · [DOI](https://onlinelibrary.wiley.com/doi/10.1002/col.20070) · [data & code](https://www.hajim.rochester.edu/ece/~gsharma/ciede2000/)
- [CSS Color Module Level 4 (W3C)](https://www.w3.org/TR/css-color-4/) · [reference conversion code](https://drafts.csswg.org/css-color-4/conversions.js) · [gamut mapping §14](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)
- Björn Ottosson — [Oklab](https://bottosson.github.io/posts/oklab/) · [OKHSV/OKHSL colour pickers](https://bottosson.github.io/posts/colorpicker/) · [sRGB gamut clipping](https://bottosson.github.io/posts/gamutclipping/) · [Smashing interview](https://www.smashingmagazine.com/2024/10/interview-bjorn-ottosson-creator-oklab-color-space/)
- Paravina et al. (2015), "Color Difference Thresholds in Dentistry", *J Esthet Restor Dent* — [DOI](https://onlinelibrary.wiley.com/doi/abs/10.1111/jerd.12149)
- Li, Li, Wang, Luo et al. (2017), "Comprehensive color solutions: CAM16, CAT16, and CAM16-UCS", *Color Research & Application* — [DOI](https://onlinelibrary.wiley.com/doi/abs/10.1002/col.22131)

**HCI / UX**
- Vogel & Baudisch (2007), "Shift: A Technique for Operating Pen-Based Interfaces Using Touch", CHI 2007 — [PDF](https://www.patrickbaudisch.com/publications/2007-Vogel-CHI07-Shift.pdf)
- Potter, Weldon & Shneiderman (1988), "Improving the accuracy of touch screens", CHI '88
- Sears & Shneiderman (1991), "High precision touchscreens", *IJMMS* 34(4):593–613
- Bae, Olkkonen, Allred & Flombaum (2015), "Why some colors appear more memorable than others", *JEP: General* — [PDF](https://www.sas.upenn.edu/~mariaol/files/BaeEtAlJEP2015.pdf) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/25985259/)
- Koenderink, van Doorn & Ekroll, "Color Picking: The Initial 20s", *ACM TAP* 13(3) — [DOI](https://dl.acm.org/doi/10.1145/2883613)
- [WCAG 2.2 SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum) · [Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [Apple HIG](https://developer.apple.com/design/tips/) · [Material touch targets](https://support.google.com/accessibility/android/answer/7101858?hl=en) · [NN/g](https://www.nngroup.com/articles/touch-target-size/)
- [ColorAide — colour distance metrics](https://facelessuser.github.io/coloraide/distance/)

**Could not retrieve:** ACM DL returned 403 for the full text of *Color Picking:
The Initial 20s* (claims above come from the indexed abstract) and for
[*Is LCH an Improvement over RGB?*](https://dl.acm.org/doi/10.1145/3696593.3696598),
which looks directly on point for the picker recommendation — the best lead if
you want published user data before committing to the OKLCh plane.
