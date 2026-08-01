# Colour Test Vectors

Ground-truth data for unit-testing the colour pipeline. Every number below is
tagged **VERIFIED** or **UNVERIFIED**.

- **VERIFIED** = retrieved verbatim from a primary/authoritative source (cited),
  or independently cross-checked against a value published by such a source.
- **UNVERIFIED (computed)** = produced by the reference implementation described
  in `color-science.md` and self-consistent, but **not** compared against an
  external published table. Trustworthy as a regression baseline (it locks in
  current behaviour), *not* as proof of correctness.

Nothing here is invented. Where a canonical value could not be retrieved, that
is stated explicitly rather than filled in.

---

## 1. CIEDE2000 — Sharma, Wu & Dalal 34-pair test set

**Status: VERIFIED.** Downloaded verbatim from the first author's site:
<https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt>

Accompanying paper: G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 color-difference
formula: Implementation notes, supplementary test data, and mathematical
observations", *Color Research & Application*, **30**(1), 21–30, 2005.
[PDF](https://hajim.rochester.edu/ece/sites/gsharma/papers/CIEDE2000CRNAFeb05.pdf) ·
[DOI 10.1002/col.20070](https://onlinelibrary.wiley.com/doi/10.1002/col.20070)

All 34 pairs use `kL = kC = kH = 1`. Inputs are CIELAB; the white point is
irrelevant here because the formula consumes Lab directly.

### Tolerance

The published ΔE00 column is rounded to 4 decimals, so the tightest meaningful
assertion is **`|actual − expected| < 5e-5`**. A correct implementation hits every
row at that bound (the reference implementation's worst-case error over all 34
rows is `4.95e-5`, i.e. exactly the rounding limit). Do not loosen this to `1e-2`
— Sharma et al. explicitly warn that *"even discrepancies in the fourth place
should not be ignored because they may be indicative of implementation errors
that may manifest themselves as larger errors for a different choice of colour
samples."*

Also assert **symmetry**: `dE00(lab1, lab2) === dE00(lab2, lab1)` exactly. This
is the single cheapest test that catches the most common bug (taking `abs()` of
ΔC′ or ΔH′). Note that taking `abs()` of *both* yields a symmetric but still
*wrong* formula, so symmetry alone is necessary, not sufficient.

### Data

| # | L1 | a1 | b1 | L2 | a2 | b2 | expected dE00 |
|---|----|----|----|----|----|----|---------------|
| 1 | 50.0000 | 2.6772 | -79.7751 | 50.0000 | 0.0000 | -82.7485 | **2.0425** |
| 2 | 50.0000 | 3.1571 | -77.2803 | 50.0000 | 0.0000 | -82.7485 | **2.8615** |
| 3 | 50.0000 | 2.8361 | -74.0200 | 50.0000 | 0.0000 | -82.7485 | **3.4412** |
| 4 | 50.0000 | -1.3802 | -84.2814 | 50.0000 | 0.0000 | -82.7485 | **1.0000** |
| 5 | 50.0000 | -1.1848 | -84.8006 | 50.0000 | 0.0000 | -82.7485 | **1.0000** |
| 6 | 50.0000 | -0.9009 | -85.5211 | 50.0000 | 0.0000 | -82.7485 | **1.0000** |
| 7 | 50.0000 | 0.0000 | 0.0000 | 50.0000 | -1.0000 | 2.0000 | **2.3669** |
| 8 | 50.0000 | -1.0000 | 2.0000 | 50.0000 | 0.0000 | 0.0000 | **2.3669** |
| 9 | 50.0000 | 2.4900 | -0.0010 | 50.0000 | -2.4900 | 0.0009 | **7.1792** |
| 10 | 50.0000 | 2.4900 | -0.0010 | 50.0000 | -2.4900 | 0.0010 | **7.1792** |
| 11 | 50.0000 | 2.4900 | -0.0010 | 50.0000 | -2.4900 | 0.0011 | **7.2195** |
| 12 | 50.0000 | 2.4900 | -0.0010 | 50.0000 | -2.4900 | 0.0012 | **7.2195** |
| 13 | 50.0000 | -0.0010 | 2.4900 | 50.0000 | 0.0009 | -2.4900 | **4.8045** |
| 14 | 50.0000 | -0.0010 | 2.4900 | 50.0000 | 0.0010 | -2.4900 | **4.8045** |
| 15 | 50.0000 | -0.0010 | 2.4900 | 50.0000 | 0.0011 | -2.4900 | **4.7461** |
| 16 | 50.0000 | 2.5000 | 0.0000 | 50.0000 | 0.0000 | -2.5000 | **4.3065** |
| 17 | 50.0000 | 2.5000 | 0.0000 | 73.0000 | 25.0000 | -18.0000 | **27.1492** |
| 18 | 50.0000 | 2.5000 | 0.0000 | 61.0000 | -5.0000 | 29.0000 | **22.8977** |
| 19 | 50.0000 | 2.5000 | 0.0000 | 56.0000 | -27.0000 | -3.0000 | **31.9030** |
| 20 | 50.0000 | 2.5000 | 0.0000 | 58.0000 | 24.0000 | 15.0000 | **19.4535** |
| 21 | 50.0000 | 2.5000 | 0.0000 | 50.0000 | 3.1736 | 0.5854 | **1.0000** |
| 22 | 50.0000 | 2.5000 | 0.0000 | 50.0000 | 3.2972 | 0.0000 | **1.0000** |
| 23 | 50.0000 | 2.5000 | 0.0000 | 50.0000 | 1.8634 | 0.5757 | **1.0000** |
| 24 | 50.0000 | 2.5000 | 0.0000 | 50.0000 | 3.2592 | 0.3350 | **1.0000** |
| 25 | 60.2574 | -34.0099 | 36.2677 | 60.4626 | -34.1751 | 39.4387 | **1.2644** |
| 26 | 63.0109 | -31.0961 | -5.8663 | 62.8187 | -29.7946 | -4.0864 | **1.2630** |
| 27 | 61.2901 | 3.7196 | -5.3901 | 61.4292 | 2.2480 | -4.9620 | **1.8731** |
| 28 | 35.0831 | -44.1164 | 3.7933 | 35.0232 | -40.0716 | 1.5901 | **1.8645** |
| 29 | 22.7233 | 20.0904 | -46.6940 | 23.0331 | 14.9730 | -42.5619 | **2.0373** |
| 30 | 36.4612 | 47.8580 | 18.3852 | 36.2715 | 50.5065 | 21.2231 | **1.4146** |
| 31 | 90.8027 | -2.0831 | 1.4410 | 91.1528 | -1.6435 | 0.0447 | **1.4441** |
| 32 | 90.9257 | -0.5406 | -0.9208 | 88.6381 | -0.8985 | -0.7239 | **1.5381** |
| 33 | 6.7747 | -0.2908 | -2.4247 | 5.8714 | -0.0985 | -2.2286 | **0.6377** |
| 34 | 2.0776 | 0.0795 | -1.1350 | 0.9033 | -0.0636 | -0.5514 | **0.9082** |

### What each block tests

Per Sharma et al. §"Supplemental test data" — this tells you *which* bug you have
when a row fails:

| Pairs | Exercises | Failure means |
|-------|-----------|---------------|
| 1–3 | Signed ΔH′ (not `abs`) | You used `abs(ΔH′)`. Only detectable via the `RT` cross-term, which is non-negligible only near hue 275° (blue) — hence these deep-blue pairs. |
| 4–6 | Signed ΔH′, designed to give exactly 1.0000 | Same as above. |
| 7–16 | Four-quadrant `atan2` for h′, and mean-hue h̄′ | Wrong arctangent quadrant, or naive `(h1+h2)/2` averaging. Pairs 9–16 straddle the 0°/360° wrap and the ±180° boundary. |
| 7, 8 | `C1'·C2' = 0` special case (one colour is exactly neutral) | You divided by zero, or returned `NaN`, or failed to set Δh′ = 0 / h̄′ = h1′+h2′. Also a symmetry check (7 and 8 are the same pair swapped). |
| 17–20 | Large colour differences | Numerically obvious errors; small-ΔE pairs can mask them inside rounding noise. |
| 21–24 | Signed ΔC′ (not `abs`), designed to give exactly 1.0000 | You used `abs(ΔC′)`. |
| 25–34 | The original CIE Technical Report / Luo-Cui-Rigg worked examples | These are the *only* pairs most buggy implementations pass — passing 25–34 alone proves nothing. |

> **Critical:** Sharma et al.'s core finding is that pairs 25–34 (the original CIE
> worked examples) *do not test* items 1–4 above. Several published
> implementations "from reputable sources" passed the CIE examples and were still
> wrong. If your test suite only has the CIE examples, it is not testing anything.

### TypeScript fixture

```ts
// [L1, a1, b1, L2, a2, b2, expectedDeltaE00]
// Source: Sharma, Wu & Dalal (2005), ciede2000testdata.txt
// kL = kC = kH = 1. Assert |actual - expected| < 5e-5.
export const CIEDE2000_TEST_DATA: readonly (readonly [
  number, number, number, number, number, number, number
])[] = [
  [50.0000,   2.6772, -79.7751, 50.0000,   0.0000, -82.7485,  2.0425],
  [50.0000,   3.1571, -77.2803, 50.0000,   0.0000, -82.7485,  2.8615],
  [50.0000,   2.8361, -74.0200, 50.0000,   0.0000, -82.7485,  3.4412],
  [50.0000,  -1.3802, -84.2814, 50.0000,   0.0000, -82.7485,  1.0000],
  [50.0000,  -1.1848, -84.8006, 50.0000,   0.0000, -82.7485,  1.0000],
  [50.0000,  -0.9009, -85.5211, 50.0000,   0.0000, -82.7485,  1.0000],
  [50.0000,   0.0000,   0.0000, 50.0000,  -1.0000,   2.0000,  2.3669],
  [50.0000,  -1.0000,   2.0000, 50.0000,   0.0000,   0.0000,  2.3669],
  [50.0000,   2.4900,  -0.0010, 50.0000,  -2.4900,   0.0009,  7.1792],
  [50.0000,   2.4900,  -0.0010, 50.0000,  -2.4900,   0.0010,  7.1792],
  [50.0000,   2.4900,  -0.0010, 50.0000,  -2.4900,   0.0011,  7.2195],
  [50.0000,   2.4900,  -0.0010, 50.0000,  -2.4900,   0.0012,  7.2195],
  [50.0000,  -0.0010,   2.4900, 50.0000,   0.0009,  -2.4900,  4.8045],
  [50.0000,  -0.0010,   2.4900, 50.0000,   0.0010,  -2.4900,  4.8045],
  [50.0000,  -0.0010,   2.4900, 50.0000,   0.0011,  -2.4900,  4.7461],
  [50.0000,   2.5000,   0.0000, 50.0000,   0.0000,  -2.5000,  4.3065],
  [50.0000,   2.5000,   0.0000, 73.0000,  25.0000, -18.0000, 27.1492],
  [50.0000,   2.5000,   0.0000, 61.0000,  -5.0000,  29.0000, 22.8977],
  [50.0000,   2.5000,   0.0000, 56.0000, -27.0000,  -3.0000, 31.9030],
  [50.0000,   2.5000,   0.0000, 58.0000,  24.0000,  15.0000, 19.4535],
  [50.0000,   2.5000,   0.0000, 50.0000,   3.1736,   0.5854,  1.0000],
  [50.0000,   2.5000,   0.0000, 50.0000,   3.2972,   0.0000,  1.0000],
  [50.0000,   2.5000,   0.0000, 50.0000,   1.8634,   0.5757,  1.0000],
  [50.0000,   2.5000,   0.0000, 50.0000,   3.2592,   0.3350,  1.0000],
  [60.2574, -34.0099,  36.2677, 60.4626, -34.1751,  39.4387,  1.2644],
  [63.0109, -31.0961,  -5.8663, 62.8187, -29.7946,  -4.0864,  1.2630],
  [61.2901,   3.7196,  -5.3901, 61.4292,   2.2480,  -4.9620,  1.8731],
  [35.0831, -44.1164,   3.7933, 35.0232, -40.0716,   1.5901,  1.8645],
  [22.7233,  20.0904, -46.6940, 23.0331,  14.9730, -42.5619,  2.0373],
  [36.4612,  47.8580,  18.3852, 36.2715,  50.5065,  21.2231,  1.4146],
  [90.8027,  -2.0831,   1.4410, 91.1528,  -1.6435,   0.0447,  1.4441],
  [90.9257,  -0.5406,  -0.9208, 88.6381,  -0.8985,  -0.7239,  1.5381],
  [ 6.7747,  -0.2908,  -2.4247,  5.8714,  -0.0985,  -2.2286,  0.6377],
  [ 2.0776,   0.0795,  -1.1350,  0.9033,  -0.0636,  -0.5514,  0.9082],
] as const;
```

---

## 2. CIEDE2000 intermediate values (debugging aid)

**Status: VERIFIED.** Transcribed from Table I of the Sharma, Wu & Dalal paper.

Use these only when a ΔE00 row fails and you need to bisect *which term* is
wrong. Values are for the pair numbers in §1. `a1p`/`a2p` = a′, `C1p`/`C2p` = C′,
`h1p`/`h2p` = h′ (degrees), `h_bar` = h̄′ (degrees).

⚠️ **Tolerance for this table is `1e-3`, not `5e-5`.** The published Lab inputs
are themselves rounded to 4 decimals, so a few intermediate cells are internally
inconsistent at the ±0.0005 level (verified: rows 21–24 show ~5e-4 disagreement
in `h2p`/`h_bar`/`C2p` when recomputed from the rounded inputs). The **final
ΔE00 column in §1 is unaffected** and still matches to 5e-5.

| # | a1p | C1p | h1p | a2p | C2p | h2p | h_bar | G | T | S_L | S_C | S_H | R_T |
|---|-----|-----|-----|-----|-----|-----|-------|---|---|-----|-----|-----|-----|
| 1 | 2.6774 | 79.8200 | 271.9222 | 0.0000 | 82.7485 | 270.0000 | 270.9611 | 0.0001 | 0.6907 | 1.0000 | 4.6578 | 1.8421 | -1.7042 |
| 2 | 3.1573 | 77.3448 | 272.3395 | 0.0000 | 82.7485 | 270.0000 | 271.1698 | 0.0001 | 0.6843 | 1.0000 | 4.6021 | 1.8216 | -1.7070 |
| 3 | 2.8363 | 74.0743 | 272.1944 | 0.0000 | 82.7485 | 270.0000 | 271.0972 | 0.0001 | 0.6865 | 1.0000 | 4.5285 | 1.8074 | -1.7060 |
| 4 | -1.3803 | 84.2927 | 269.0618 | 0.0000 | 82.7485 | 270.0000 | 269.5309 | 0.0001 | 0.7357 | 1.0000 | 4.7584 | 1.9217 | -1.6809 |
| 5 | -1.1849 | 84.8089 | 269.1995 | 0.0000 | 82.7485 | 270.0000 | 269.5997 | 0.0001 | 0.7335 | 1.0000 | 4.7700 | 1.9218 | -1.6822 |
| 6 | -0.9009 | 85.5258 | 269.3964 | 0.0000 | 82.7485 | 270.0000 | 269.6982 | 0.0001 | 0.7303 | 1.0000 | 4.7862 | 1.9217 | -1.6840 |
| 7 | 0.0000 | 0.0000 | 0.0000 | -1.5000 | 2.5000 | 126.8697 | 126.8697 | 0.5000 | 1.2200 | 1.0000 | 1.0562 | 1.0229 | 0.0000 |
| 8 | -1.5000 | 2.5000 | 126.8697 | 0.0000 | 0.0000 | 0.0000 | 126.8697 | 0.5000 | 1.2200 | 1.0000 | 1.0562 | 1.0229 | 0.0000 |
| 9 | 3.7346 | 3.7346 | 359.9847 | -3.7346 | 3.7346 | 179.9862 | 269.9854 | 0.4998 | 0.7212 | 1.0000 | 1.1681 | 1.0404 | -0.0022 |
| 10 | 3.7346 | 3.7346 | 359.9847 | -3.7346 | 3.7346 | 179.9847 | 269.9847 | 0.4998 | 0.7212 | 1.0000 | 1.1681 | 1.0404 | -0.0022 |
| 11 | 3.7346 | 3.7346 | 359.9847 | -3.7346 | 3.7346 | 179.9831 | 89.9839 | 0.4998 | 0.6175 | 1.0000 | 1.1681 | 1.0346 | 0.0000 |
| 12 | 3.7346 | 3.7346 | 359.9847 | -3.7346 | 3.7346 | 179.9816 | 89.9831 | 0.4998 | 0.6175 | 1.0000 | 1.1681 | 1.0346 | 0.0000 |
| 13 | -0.0015 | 2.4900 | 90.0345 | 0.0013 | 2.4900 | 270.0311 | 180.0328 | 0.4998 | 0.9779 | 1.0000 | 1.1121 | 1.0365 | 0.0000 |
| 14 | -0.0015 | 2.4900 | 90.0345 | 0.0015 | 2.4900 | 270.0345 | 180.0345 | 0.4998 | 0.9779 | 1.0000 | 1.1121 | 1.0365 | 0.0000 |
| 15 | -0.0015 | 2.4900 | 90.0345 | 0.0016 | 2.4900 | 270.0380 | 0.0362 | 0.4998 | 1.3197 | 1.0000 | 1.1121 | 1.0493 | 0.0000 |
| 16 | 3.7496 | 3.7496 | 0.0000 | 0.0000 | 2.5000 | 270.0000 | 315.0000 | 0.4998 | 0.8454 | 1.0000 | 1.1406 | 1.0396 | -0.0001 |
| 17 | 3.4569 | 3.4569 | 0.0000 | 34.5687 | 38.9743 | 332.4939 | 346.2470 | 0.3827 | 1.4453 | 1.1608 | 1.9547 | 1.4599 | -0.0003 |
| 18 | 3.4954 | 3.4954 | 0.0000 | -6.9907 | 29.8307 | 103.5532 | 51.7766 | 0.3981 | 0.6447 | 1.0640 | 1.7498 | 1.1612 | 0.0000 |
| 19 | 3.5514 | 3.5514 | 0.0000 | -38.3556 | 38.4728 | 184.4723 | 272.2362 | 0.4206 | 0.6521 | 1.0251 | 1.9455 | 1.2055 | -0.8219 |
| 20 | 3.5244 | 3.5244 | 0.0000 | 33.8342 | 37.0102 | 23.9095 | 11.9548 | 0.4098 | 1.1031 | 1.0400 | 1.9120 | 1.3353 | 0.0000 |
| 21 | 3.7494 | 3.7494 | 0.0000 | 4.7596 | 4.7954 | 7.0113 | 3.5056 | 0.4997 | 1.2616 | 1.0000 | 1.1923 | 1.0808 | 0.0000 |
| 22 | 3.7493 | 3.7493 | 0.0000 | 4.9450 | 4.9450 | 0.0000 | 0.0000 | 0.4997 | 1.3202 | 1.0000 | 1.1956 | 1.0861 | 0.0000 |
| 23 | 3.7497 | 3.7497 | 0.0000 | 2.7949 | 2.8536 | 11.6380 | 5.8190 | 0.4999 | 1.2197 | 1.0000 | 1.1486 | 1.0604 | 0.0000 |
| 24 | 3.7493 | 3.7493 | 0.0000 | 4.8879 | 4.8994 | 3.9206 | 1.9603 | 0.4997 | 1.2883 | 1.0000 | 1.1946 | 1.0836 | 0.0000 |
| 25 | -34.0678 | 49.7590 | 133.2085 | -34.2333 | 52.2238 | 130.9584 | 132.0835 | 0.0017 | 1.3010 | 1.1427 | 3.2946 | 1.9951 | 0.0000 |
| 26 | -32.6194 | 33.1427 | 190.1951 | -31.2542 | 31.5202 | 187.4490 | 188.8221 | 0.0490 | 0.9402 | 1.1831 | 2.4549 | 1.4560 | 0.0000 |
| 27 | 5.5668 | 7.7487 | 315.9240 | 3.3644 | 5.9950 | 304.1385 | 310.0313 | 0.4966 | 0.6952 | 1.1586 | 1.3092 | 1.0717 | -0.0032 |
| 28 | -44.3939 | 44.5557 | 175.1161 | -40.3237 | 40.3550 | 177.7418 | 176.4290 | 0.0063 | 1.0168 | 1.2148 | 2.9105 | 1.6476 | 0.0000 |
| 29 | 20.1424 | 50.8532 | 293.3339 | 15.0118 | 45.1317 | 289.4279 | 291.3809 | 0.0026 | 0.3636 | 1.4014 | 3.1597 | 1.2617 | -1.2537 |
| 30 | 47.9197 | 51.3256 | 20.9901 | 50.5716 | 54.8444 | 22.7660 | 21.8781 | 0.0013 | 0.9239 | 1.1943 | 3.3888 | 1.7357 | 0.0000 |
| 31 | -3.1245 | 3.4408 | 155.2410 | -2.4651 | 2.4655 | 178.9612 | 167.1011 | 0.4999 | 1.1546 | 1.6110 | 1.1329 | 1.0511 | 0.0000 |
| 32 | -0.8109 | 1.2270 | 228.6315 | -1.3477 | 1.5298 | 208.2412 | 218.4363 | 0.5000 | 1.3916 | 1.5930 | 1.0620 | 1.0288 | 0.0000 |
| 33 | -0.4362 | 2.4636 | 259.8025 | -0.1477 | 2.2335 | 266.2073 | 263.0049 | 0.4999 | 0.9556 | 1.6517 | 1.1057 | 1.0337 | -0.0004 |
| 34 | 0.1192 | 1.1412 | 275.9978 | -0.0954 | 0.5596 | 260.1842 | 268.0910 | 0.5000 | 0.7826 | 1.7246 | 1.0383 | 1.0100 | 0.0000 |

Useful sanity reads from this table:
- `G ≈ 0.5` whenever both colours have low chroma; `G → 0` at high chroma (rows 25–30).
- `R_T` is non-zero **only** near h̄′ ≈ 275° (rows 1–6, 9, 10, 19, 27, 29, 33). If your `R_T` is non-zero elsewhere, your Δθ is wrong.
- Row 19 has the largest `R_T` (−0.8219) of any row with a large ΔE — a good single-row regression guard.

---

## 3. OKLab reference values — XYZ (D65) input

**Status: VERIFIED.** Table published by Björn Ottosson in
["A perceptual color space for image processing"](https://bottosson.github.io/posts/oklab/)
(the section giving numerical examples). Published to 3 decimals.

| X | Y | Z | L | a | b |
|---|---|---|---|---|---|
| 0.950 | 1.000 | 1.089 | 1.000 | 0.000 | 0.000 |
| 1.000 | 0.000 | 0.000 | 0.450 | 1.236 | -0.019 |
| 0.000 | 1.000 | 0.000 | 0.922 | -0.671 | 0.263 |
| 0.000 | 0.000 | 1.000 | 0.153 | -1.415 | -0.449 |

Cross-check performed: the reference implementation (CSS Color 4 matrices)
reproduces all four rows to the printed 3 decimals — computed values are
`(1.0000, -0.0002, 0.0000)`, `(0.4499, 1.2358, -0.0190)`, `(0.9218, -0.6712,
0.2634)`, `(0.1526, -1.4151, -0.4488)`.

Assert with tolerance `1e-3` (that is all the published precision supports).
Rows 2–4 are non-physical XYZ values — that is intentional, they exercise the
signed cube root. **Use `Math.cbrt`, not `Math.pow(x, 1/3)`** — the latter
returns `NaN` for negative inputs and these rows will catch it.

---

## 4. sRGB → OKLCh hue angles cross-checked against W3C

**Status: VERIFIED** (against values stated in the CSS Color Module Level 4 spec text).

The spec states in its gamut-mapping discussion that sRGB primary blue sits at
OKLCh hue **264.06°** and at CIE LCh hue **301.37°**
([§14.1.6 Deviations from Perceptual Uniformity: Hue Curvature](https://www.w3.org/TR/css-color-4/#gamut-mapping)).
The spec also contains the worked colour literals `oklch(0.452 0.313 264.1)` and
`oklch(0.968 0.211 109.8)`.

| Colour | Quantity | W3C published | Reference impl. | Match |
|--------|----------|---------------|-----------------|-------|
| `#0000FF` | OKLCh hue | 264.06° / `264.1` | 264.052023° | ✅ |
| `#0000FF` | OKLCh L, C | `0.452`, `0.313` | 0.45201372, 0.31321439 | ✅ |
| `#FFFF00` | OKLCh L, C, h | `0.968`, `0.211`, `109.8` | 0.96798273, 0.21100587, 109.769236° | ✅ |
| `#0000FF` | CIE LCh hue (D50) | 301.37° | 301.36° | ✅ |

This independently validates the **entire** chain: sRGB 8-bit → linear → XYZ →
{Lab, OKLab} → polar. Both the Lab branch and the OKLab branch are confirmed
against a W3C-published number.

---

## 5. sRGB 8-bit → linear sRGB → XYZ (D65)

**Status: UNVERIFIED (computed)** by the reference implementation, using the
exact rational matrix from the CSS Color 4 sample code. Self-consistent and
validated end-to-end via §4, but these specific intermediate rows were not
compared cell-by-cell against a published table.

Note white (`#FFFFFF`) → XYZ `(0.95045593, 1.00000000, 1.08905775)` **is**
verified indirectly: it must equal the D65 white point
`[0.3127/0.3290, 1, (1−0.3127−0.3290)/0.3290]` defined in the CSS spec, and it does.

| Colour | R,G,B | linear R | linear G | linear B | X | Y | Z |
|--------|-------|----------|----------|----------|---|---|---|
| black | 0,0,0 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| white | 255,255,255 | 1.00000000 | 1.00000000 | 1.00000000 | 0.95045593 | 1.00000000 | 1.08905775 |
| red | 255,0,0 | 1.00000000 | 0.00000000 | 0.00000000 | 0.41239080 | 0.21263901 | 0.01933082 |
| lime | 0,255,0 | 0.00000000 | 1.00000000 | 0.00000000 | 0.35758434 | 0.71516868 | 0.11919478 |
| blue | 0,0,255 | 0.00000000 | 0.00000000 | 1.00000000 | 0.18048079 | 0.07219232 | 0.95053215 |
| yellow | 255,255,0 | 1.00000000 | 1.00000000 | 0.00000000 | 0.76997514 | 0.92780768 | 0.13852560 |
| cyan | 0,255,255 | 0.00000000 | 1.00000000 | 1.00000000 | 0.53806513 | 0.78736099 | 1.06972693 |
| magenta | 255,0,255 | 1.00000000 | 0.00000000 | 1.00000000 | 0.59287159 | 0.28483132 | 0.96986297 |
| gray 50% | 128,128,128 | 0.21586050 | 0.21586050 | 0.21586050 | 0.20516589 | 0.21586050 | 0.23508455 |
| silver | 192,192,192 | 0.52711513 | 0.52711513 | 0.52711513 | 0.50099970 | 0.52711513 | 0.57405881 |
| dimgray | 105,105,105 | 0.14126329 | 0.14126329 | 0.14126329 | 0.13426453 | 0.14126329 | 0.15384388 |
| rebeccapurple | 102,51,153 | 0.13286832 | 0.03310477 | 0.31854678 | 0.12412299 | 0.07492511 | 0.30930332 |
| tomato | 255,99,71 | 1.00000000 | 0.12477182 | 0.06301002 | 0.46837934 | 0.30642074 | 0.09409602 |
| teal | 0,128,128 | 0.00000000 | 0.21586050 | 0.21586050 | 0.11614701 | 0.16996014 | 0.23091179 |
| olive | 128,128,0 | 0.21586050 | 0.21586050 | 0.00000000 | 0.16620722 | 0.20027703 | 0.02990220 |

**Useful independent checks embedded above:**
- `128 → 0.21586050` linear is the standard sRGB mid-grey linear value.
- For any neutral `(v,v,v)`, `Y` must equal the linear value exactly, and
  `X/Y/Z` must equal the D65 white point scaled by it. Rows gray/silver/dimgray
  confirm this.
- Red's `Y = 0.21263901` is the sRGB luminance coefficient for red.

> ⚠️ **Matrix-variant warning.** These values use the CSS Color 4 *exact rational*
> matrix. If you instead use the widely-copied rounded IEC 61966-2-1 matrix
> (`0.4124564, 0.3575761, 0.1804375; …`), red's `L*` comes out as **53.2408**
> instead of **53.2371** — a ΔE00 of about 0.003. Harmless for gameplay, fatal
> for a test suite that mixes the two. Pick one and be consistent. See
> `color-science.md` for the exact rational matrix.

---

## 6. sRGB 8-bit → CIELab (D65, no chromatic adaptation)

**Status: UNVERIFIED (computed)**, except the blue CIE LCh hue which is verified
in §4. Uses white point D65 = `(0.9504559270516716, 1, 1.0890577507598784)`.

⚠️ This is **D65 Lab**, which is what you want for scoring an sRGB game. It is
*not* the same as CSS `lab()`, which is **D50**-referenced via Bradford
adaptation and will give different numbers (e.g. blue is `L=32.30` here vs
`L=29.57` in CSS `lab()`). Do not mix them.

| Colour | Hex | L* | a* | b* | C* | h° |
|--------|-----|----|----|----|----|-----|
| black | #000000 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | — |
| white | #FFFFFF | 100.000000 | 0.000000 | 0.000000 | 0.000000 | — |
| red | #FF0000 | 53.237116 | 80.090114 | 67.203264 | 104.550012 | 39.999865 |
| lime | #00FF00 | 87.735519 | -86.181597 | 83.186620 | 119.780138 | 136.013069 |
| blue | #0000FF | 32.300873 | 79.195270 | -107.855466 | 133.808416 | 306.288803 |
| yellow | #FFFF00 | 97.138559 | -21.559971 | 94.483840 | 96.912478 | 102.854060 |
| cyan | #00FFFF | 91.114752 | -48.078888 | -14.128985 | 50.111952 | 196.376526 |
| magenta | #FF00FF | 60.322731 | 98.237444 | -60.828910 | 115.545453 | 328.234088 |
| gray 50% | #808080 | 53.585013 | 0.000000 | 0.000000 | 0.000000 | — |
| silver | #C0C0C0 | 77.704364 | 0.000000 | 0.000000 | 0.000000 | — |
| dimgray | #696969 | 44.413560 | 0.000000 | 0.000000 | 0.000000 | — |
| rebeccapurple | #663399 | 32.902807 | 42.886507 | -47.149133 | 63.736122 | 312.289427 |
| tomato | #FF6347 | 62.204314 | 57.847106 | 46.417821 | 74.168064 | 38.744343 |
| teal | #008080 | 48.255013 | -28.841122 | -8.475566 | 30.060697 | 196.376526 |
| olive | #808000 | 51.868519 | -12.933197 | 56.678097 | 58.134966 | 102.854060 |

Structural invariants worth asserting (these hold by construction, so they are
real tests, not just baselines):
- `#FFFFFF` → exactly `L*=100, a*=0, b*=0`; `#000000` → exactly `(0,0,0)`.
- Any neutral `(v,v,v)` → `a* = b* = 0` exactly.
- `teal (#008080)` and `cyan (#00FFFF)` share hue `196.376526°` exactly; likewise
  `olive` and `yellow` share `102.854060°`. Halving all three channels' *linear*
  light preserves chromaticity, hence hue. A good test that your matrix is linear.

---

## 7. sRGB 8-bit → OKLab / OKLCh

**Status: UNVERIFIED (computed)**, except `#0000FF` and `#FFFF00` which are
verified against W3C-published literals in §4.

Uses the CSS Color 4 recomputed matrices (`XYZ_to_LMS` / `LMS_to_OKLab`), which
are the 64-bit-precision variant. `L` is in **0..1**.

| Colour | Hex | OKLab L | OKLab a | OKLab b | OKLCh C | OKLCh h° |
|--------|-----|---------|---------|---------|---------|----------|
| black | #000000 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 | — |
| white | #FFFFFF | 1.00000000 | -0.00000000 | 0.00000000 | 0.00000000 | — |
| red | #FF0000 | 0.62795536 | 0.22486307 | 0.12584628 | 0.25768330 | 29.233880 |
| lime | #00FF00 | 0.86643962 | -0.23388758 | 0.17949845 | 0.29482722 | 142.495345 |
| blue | #0000FF | 0.45201372 | -0.03245698 | -0.31152817 | 0.31321439 | 264.052023 |
| yellow | #FFFF00 | 0.96798273 | -0.07136908 | 0.19856972 | 0.21100587 | 109.769236 |
| cyan | #00FFFF | 0.90539924 | -0.14944394 | -0.03939819 | 0.15455002 | 194.768960 |
| magenta | #FF00FF | 0.70167386 | 0.27456631 | -0.16915608 | 0.32249099 | 328.363415 |
| gray 50% | #808080 | 0.59987081 | -0.00000000 | -0.00000000 | 0.00000000 | — |
| silver | #C0C0C0 | 0.80779624 | -0.00000000 | -0.00000000 | 0.00000000 | — |
| dimgray | #696969 | 0.52080655 | -0.00000000 | -0.00000000 | 0.00000000 | — |
| rebeccapurple | #663399 | 0.44027180 | 0.08817676 | -0.13386436 | 0.16029600 | 303.372988 |
| tomato | #FF6347 | 0.69621935 | 0.16523040 | 0.10454086 | 0.19552462 | 32.321434 |
| teal | #008080 | 0.54312257 | -0.08964706 | -0.02363383 | 0.09271005 | 194.768960 |
| olive | #808000 | 0.58066458 | -0.04281223 | 0.11911618 | 0.12657626 | 109.769236 |

### Grey neutrality — a real gotcha, worth a dedicated test

**Status: VERIFIED by measurement** of both published matrix sets.

For a neutral `(v,v,v)`, OKLab `a` and `b` should be zero. Whether they *are*
depends on which matrices you use:

| Matrix set | Residual `|a|,|b|` for `#FFFFFF` | Residual for `#808080` |
|------------|----------------------------------|------------------------|
| CSS Color 4 (recomputed, 64-bit) | ~5e-16 | ~3e-16 |
| Ottosson's original blog matrices | ~3.7e-8 | ~2.2e-8 |

Ottosson's original published matrices are only ~7 significant figures, so greys
come out very slightly non-neutral. The CSS spec notes its matrices were
*"recalculated for consistent reference white"* and *"recalculated for 64bit
precision"* precisely to fix this.

**Consequence:** `OKLCh` hue for a grey is meaningless in either case (the
computed values above — 178.01°, 180.30°, 186.42° — are pure floating-point
noise). Treat hue as undefined below a chroma epsilon. CSS Color 4's reference
code uses `epsilon = 0.000004` for OKLCh and `0.0015` for CIE LCh. **Never feed
a noise hue into the picker or the generator.**

Recommendation: use the **CSS Color 4 matrices** (given in `color-science.md`),
not the blog ones, so greys are exactly neutral to double precision.

---

## 8. Round-trip invariants (no external source needed)

**Status: structural** — these are properties, not retrieved data, so they are
valid tests regardless of sourcing.

| Test | Assertion |
|------|-----------|
| sRGB8 round trip | For all 256 values `v`: `round(255 * gam(lin(v/255))) === v` |
| Lab round trip | `lab → XYZ → lab` recovers input within `1e-10` |
| OKLab round trip | `oklab → XYZ → oklab` recovers input within `1e-10` |
| OKLCh round trip | `oklab → oklch → oklab` within `1e-12` (for C > epsilon) |
| ΔE identity | `dE00(lab, lab) === 0` for every colour in §6 |
| ΔE symmetry | `dE00(a,b) === dE00(b,a)` exactly, for all §1 pairs and random pairs |
| ΔE non-negativity | `dE00(a,b) >= 0` over random fuzzing |
| Transfer fn continuity | `lin()` and `gam()` are continuous at their breakpoints: `lin(0.04045)` from both branches agree to ~1e-8 |

---

## 9. Values I could NOT verify — stated explicitly

These are used in `color-science.md` and are honestly labelled there. Listing
them here so nobody mistakes them for retrieved ground truth:

| Quantity | Value | Status |
|----------|-------|--------|
| Max ΔE00 between any two sRGB colours | **≈ 119.47** (`#00006E` vs `#8FFF00`) | **Computed by me** via grid search + hill climbing over the 8-bit cube. No published source found. Treat as a tight lower bound on the true maximum; the search was thorough but not exhaustive (2^48 pairs cannot be enumerated). |
| ΔE00(black, white) | **exactly 100.0000** | Computed, but analytically certain: ΔL′=100, C′=0 ⟹ S_L=1, so ΔE00 = 100 by construction. Safe to assert. |
| E[ΔE00] for two independent uniform random sRGB8 colours | **≈ 44.9** (median ≈ 43.0) | Computed by Monte Carlo, n = 120,000. No published source. |
| ΔE00 / (ΔE_OK × 100) scaling ratio | median ≈ **1.25**, ranging ≈ 0.9 (saturated) to ≈ 2.4 (near-neutral) | Computed by Monte Carlo. No published source gives a single scaling constant — and per the measured spread, no single constant exists. |
| sRGB gamut C_max(L, h) table in OKLCh | see `color-science.md` | Computed by bisection against the sRGB gamut boundary. No published source. |
| "One JND = ΔE00 of 2" | — | **VERIFIED as a W3C statement**, but note it is the threshold the CSS spec adopts for gamut mapping, not a psychophysical measurement. The measured psychophysical value is Paravina et al.'s PT = 0.8 (also verified). |

**Not retrieved at all:** I could not find a published canonical sRGB-hex →
OKLab reference table analogous to Sharma's CIEDE2000 set. None appears to
exist. §7 is therefore a regression baseline anchored by the two W3C-verified
rows in §4, not an independent ground truth.

---

## Sources

- Sharma, Wu & Dalal (2005), *Color Research & Application* 30(1):21–30 — [paper PDF](https://hajim.rochester.edu/ece/sites/gsharma/papers/CIEDE2000CRNAFeb05.pdf), [test data](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt), [project page](https://www.hajim.rochester.edu/ece/~gsharma/ciede2000/)
- [CSS Color Module Level 4 (W3C)](https://www.w3.org/TR/css-color-4/) and its [reference conversion code](https://drafts.csswg.org/css-color-4/conversions.js)
- [Björn Ottosson — "A perceptual color space for image processing" (Oklab)](https://bottosson.github.io/posts/oklab/)
- Paravina et al. (2015), "Color Difference Thresholds in Dentistry", *J Esthet Restor Dent* — [DOI 10.1111/jerd.12149](https://onlinelibrary.wiley.com/doi/abs/10.1111/jerd.12149)
