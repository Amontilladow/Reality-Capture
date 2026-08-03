# Lessons Learned — BIM Viewer Investigation

Not a bug report. `ROOT_CAUSE_REPORT_BIM_VIEWER.md` is the record of *what happened* to this specific model. This document is the record of *what the investigation itself taught us* — technique, process, and a few sharp-edged API/architecture gotchas — generalized so it's useful the next time someone on EngineeringOS is debugging something that doesn't look like this bug at all.

If you're about to start a hard, cross-environment, hard-to-reproduce investigation, read this first. It will save you from at least two of the mistakes made here.

---

## What worked

**Deterministic, instrumented reproduction over reading code and guessing.** The camera bug (Issue 1) was solved in one pass because the very first step was building an isolated harness that could run the exact same input sequence twice and diff the output byte-for-byte. Once `infinityDolly`'s effect on the camera target could be reproduced on demand — same input, same wrong output, every time — the fix was obvious and the verification was trivial. Compare this to the geometry investigation (Issue 2), which took eight rounds partly *because* early hypotheses were tested against a single observation instead of a repeatable harness.

**Minimal Reproducible Examples via dependency-closure extraction.** When a single IFC entity (a weld) appeared to have a representation-specific bug, extracting just that entity's full dependency closure (not the whole 2.5MB file) into a ~6KB test file and running it through the real pipeline in isolation disproved the hypothesis in minutes instead of hours of re-running the full file. This technique — binary-search the input down to the smallest thing that still reproduces the symptom — generalizes to almost any "something in this large input is wrong" investigation, not just IFC.

**Restoring a real production database backup locally, rather than trusting memory or live-querying prod.** Every "how many elements does this model have" or "what does this GUID's representation actually look like" question got answered by `pg_restore`-ing a real backup into a throwaway local Postgres instance and querying it directly. This is slower than remembering or assuming, and that's the point — it converts "I believe X" into "I ran a query and got X," which is the only kind of claim safe to build the next three hypotheses on.

**Hashing everything, as early as possible.** SHA-256 comparison caught the "identical hash, apparently different geometry" observation that seeded the (later disproven) client-side non-determinism hypothesis, and ultimately became the entire mechanism for both diagnosing and closing this investigation. Any time you're asking "is this the same file/data/output as that one," hash both sides before doing anything more clever. It's cheap and it's unambiguous.

---

## Which hypotheses were wrong, and why that's the useful part

Every one of these felt plausible when proposed. None of them survived direct testing. The full evidence for each is in `ROOT_CAUSE_REPORT_BIM_VIEWER.md`; the pattern worth extracting here is *why* a plausible-sounding hypothesis turned out wrong:

1. **"It's the representation type (SweptSolid/Clipping)."** Wrong because it was tested against only two examples that happened to look suspicious, not a systematic sweep. A specific type *looking* structurally unusual is not evidence it behaves unusually — only running it through the real pipeline is.
2. **"It's Brep welds specifically."** Wrong because the one failing example was never isolated and re-tested on its own before the theory was written down. Once actually isolated (the MRE technique above), it rendered fine.
3. **"It's content or file-scale dependent."** Wrong, and this one required real binary-search discipline to fully rule out — a hypothesis like this can't be disproven by one counterexample, it needs a systematic sweep across the size/content space.
4. **"Dependency versions differ between environments."** Only *half* checked — versions matched, but nobody checked whether the *runtime* (Node major version, OS) also matched until directly asked. Verifying one layer of an environment (package versions) is not the same as verifying environment parity. See "Why provenance matters" below.
5 & 6. **Both non-determinism claims** (client-side, then server-side) were not really about IFC or the fragments library at all — they were caused by a bug in the *investigation's own measurement code*. See the sparse-array gotcha, next section. This is the single most important lesson in this document: **the two most dramatic, most-worth-filing-upstream findings of this entire investigation were both artifacts of the measurement tool, not the system under test.**

---

## The sparse-array gotcha (`getItemsGeometry`)

`@thatopen/fragments`' `model.getItemsGeometry(localIds)` can return an array **shorter** than the `localIds` array you passed in — it silently omits an entry for any item with zero geometry rather than padding the result with an empty placeholder.

```ts
// WRONG — silently undercounts/misses zero-geometry items. If you request
// 500 ids and 3 of them have no geometry, this loop only sees 497 entries
// and never notices the 3 that are missing.
for (const chunks of meshData) { ... }

// RIGHT — always index by what you requested, not by what came back.
for (let j = 0; j < localIds.length; j++) {
  const chunks = meshData[j] ?? [];
  ...
}
```

This single API shape produced two separate incorrect "confirmed" findings in this investigation, one of which was filed to a public GitHub issue before being caught and corrected. It is exactly the kind of bug that doesn't show up in a type checker (the array is still `T[]`, just a shorter one) and doesn't crash anything — it just quietly changes what your scan believes it saw.

**The generalizable lesson**: any API that maps a request array to a response array is a candidate for this bug unless its documentation explicitly guarantees index-alignment or fixed length. Don't assume it. Index by the request.

---

## Why "confirmed" should never be claimed before reproducibility

Both retracted claims in this investigation used the word "confirmed" after a *single* observation or a *single* test script's output. Neither survived being re-run with independent verification:

- The 20-run client-side determinism test used the same buggy counting pattern as the finding it was trying to validate — so "20 runs, zero variance" wasn't independent evidence, it was the same blind spot exercised 20 times.
- The upstream-filed server-side non-determinism claim was based on one comparison across three runs, using code that (per the gotcha above) wasn't correctly counting what it claimed to count.

**The rule this investigation converged on**: a finding is confirmed when it has been reproduced through at least one path that does *not* share the same measurement code as the original observation — ideally a completely different technique (e.g., a raw byte-level hash comparison *and* a semantic item-count comparison, not two runs of the same script). Until then, the correct word is "observed," not "confirmed" — and that's exactly the language correction that turned out to matter when the upstream GitHub issue needed revising.

If reporting a finding to a stakeholder, a teammate, or an external maintainer, and you can't point to two independent ways you checked it, say "observed" and say what would upgrade it to "confirmed."

---

## Why provenance matters, and why hashes should be stored

This investigation spent real time stuck on a single question that turned out to be unanswerable after the fact: **was the local test file actually the same bytes as what production received?** Nobody could say, because nothing in the system recorded a checksum of the uploaded file at the time it was uploaded. By the time the question mattered, the honest answer was "we don't know, and we can't find out without re-fetching the original object from storage" — which itself turned out to be blocked by the app never having exposed a way to read that object back out.

The fix (`f1a9e2a`, `apps/api/src/database/migrations/011_bim_model_provenance.sql`) is now permanent infrastructure: every BIM model records the SHA-256 of its source IFC and generated fragments, plus the exact Node/library/git-commit versions that produced them, at generation time — not reconstructed later under investigation pressure.

**The generalizable lesson**: for any pipeline that transforms an input into a stored output — file conversion, report generation, ML inference, anything — record a checksum of the input and the output, and the environment that did the transforming, *at the moment it happens*. It costs one hash computation and a few extra columns. Reconstructing that information after the fact, once you actually need it, can cost days and sometimes simply can't be done at all.

---

## Why deterministic tests are essential

`tools/bim-debug/fragment_determinism.test.ts` exists specifically because this investigation could not, in the moment, get a fast yes/no answer to "does regenerating this file produce the same result." Every check was a manual, multi-minute, ad hoc script run. A standing regression test — even one that's currently `describe.skip`/`it.todo` and blocked on an upstream fix — means the next time this class of question comes up, the answer is `pnpm test`, not another multi-day investigation.

The generalizable lesson: when an investigation produces a repeatable check ("does X always equal Y"), turn it into a committed test before moving on, even if it has to start out skipped. A skipped test with a clear unblock condition is discoverable. A one-off script in someone's shell history is not.

---

## Summary checklist for the next hard investigation

- [ ] Build a deterministic, instrumented reproduction before forming a second hypothesis.
- [ ] When something looks like it depends on scale/content, binary-search it — don't guess where the boundary is.
- [ ] Hash both sides before claiming two things are "the same."
- [ ] Distrust your own measurement code as much as the system under test. If a finding is dramatic, try to reproduce it through an independent method before writing it down.
- [ ] Never write "confirmed" for a single-path observation. Write "observed," and say what would upgrade it.
- [ ] Check *all* layers of environment parity (runtime version and OS, not just library versions) before ruling environment out.
- [ ] If a pipeline transforms input to output, make sure checksums and environment metadata are captured at transform time — not reconstructed later.
- [ ] Turn a repeatable check into a committed (even if skipped) regression test before moving on.
