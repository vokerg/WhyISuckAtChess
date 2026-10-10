# Phase 7 diagnostic gold corpus v1

**Issue:** #122 (independent Wave 1 foundation for #124 detector audit and #125 calibration)  
**Corpus:** [<code>apps/api/test/fixtures/phase-7-gold-corpus.v1.json</code>](../apps/api/test/fixtures/phase-7-gold-corpus.v1.json)  
**Executable comparison:** [<code>apps/api/test/phase-7-gold-corpus.test.mjs</code>](../apps/api/test/phase-7-gold-corpus.test.mjs)  
**Review status:** **pending independent chess-domain adjudication**; fixture expectations are not expert-verified gold truth.

## 1. What this corpus proves, and what it does not

The v1 corpus provides deterministic, falsifiable **regression expectations** for supported parts of Why's actual Phase 3–5 code. It contains **14 original synthetic cases**:

| Boundary | Cases | Positive and adversarial checks |
| --- | ---: | --- |
| Phase 3 tactical motif detector | 7 | existing missed fork, fork created by best move, newly allowed pin; below-threshold geometry, incidental fork target, missing engine, incomplete after-position analysis |
| Phase 4 TIME-001 exposure aggregate | 5 | bullet crossing 30s/10s, blitz+increment with no pressure, rapid without clocks, partial two-game coverage, exact-control separation and rating-context disclosure |
| Phase 5 TIME-002 projection | 2 | large effect but insufficient evidence versus adequately covered no-effect observation |

The detector fixture engine annotations are **not Stockfish runs**. They intentionally replicate accepted deterministic-double conditions from existing regression tests, with explicit provenance. The same is true of the quality comparisons used to probe Phase 5 candidate states. The corpus is therefore useful as a stable *policy/contract control*, **not** as independent empirical evidence that an engine, detector, or ranked diagnosis is correct on live games.

Game positions and eight-ply PGNs are synthetic and reconstructed by the repository's actual <code>reconstructPgnPlies</code> parser. The harness checks exact UCI transitions and four-field normalized FEN for isolated positions; for PGNs it enforces legal reconstruction and explicit source-clock slot count. Each test reports the case ID and a Node assertion **observed-versus-expected diff** if a regression occurs. No production API/worker routes or diagnostic scoring constants change here.

## 2. Corpus schema and trust boundaries

JSON root: <code>schemaVersion</code> = <code>phase-7-gold-corpus-v1</code>, a rights/provenance statement, domain review state, and a bounded <code>cases</code> array. Every case has a stable kebab-case <code>id</code>, <code>family</code>, <code>caseKind</code>, <code>source</code>, <code>expected</code>, and <code>review</code>. Review records use <code>status: PENDING_DOMAIN_REVIEW</code> and <code>confidence: UNASSESSED</code> until a named authorized reviewer has adjudicated the case; the test intentionally fails if these fields are silently upgraded without revisiting the protocol.

**Provenance/authority contract:**

| Layer | v1 representation | May be interpreted as |
| --- | --- | --- |
| Legal board/move facts | <code>SYNTHETIC_POSITION</code> with four-field before/after FEN, SAN and UCI, verified by chess.js through <code>reconstructPgnPlies</code> | Reproducible geometry and legal transition, **not** an independent Stockfish conclusion |
| Source game facts | <code>SYNTHETIC_GAMES</code>, legal PGN, standard variant, exact seconds + increment, speed, side, rated/result/rating (nullable) | Explicit synthetic scenario context; null means **unknown**, not zero |
| Clock facts | <code>SYNTHETIC_POST_MOVE</code> centiseconds per ply, with <code>COMPLETE</code>, <code>PARTIAL</code>, or <code>ABSENT</code> status | Test input only, **not** an authoritative Lichess sample |
| Before-move timing | Derived only from the previous *same-side* synthetic post-move clock (for post-opening plies); timing derivation version pinned | Reproducible aggregate input; does **not** infer omitted clock facts, external adjustments, or actual move times |
| Phase | Explicit per-ply fixture annotation, otherwise null | Scenario metadata; no phase is inferred solely from move number |
| Engine | <code>DETERMINISTIC_TEST_DOUBLE</code>, <code>test-snapshot-v1</code>, fixed depth/score-loss/best moves, test-only settings identifier | A mocked engine response for deterministic fixture testing, **never** a verified Stockfish evaluation |
| Phase 5 aggregate | <code>SYNTHETIC_AGGREGATE</code> with fixed sample/coverage/effect inputs | Projection contract stimulus, not a measured player cohort |
| Expected labels | Per-family <code>expected</code> object with coverage, reason, required/forbidden motif states; pressure bands/exclusions/control keys; or observation state | Versioned oracle for the accepted deterministic implementation, subject to independent review |
| Reviewer judgement | <code>review.status</code>, <code>confidence</code>, <code>note</code> | Pending subjective/interpretive assessment; **not** algorithmic ground truth |

Use <code>POSITIVE</code>, <code>NEGATIVE</code>, <code>AMBIGUOUS</code>, <code>UNAVAILABLE</code>, <code>INCOMPLETE</code>, and <code>COUNTEREXAMPLE</code> as scenario kinds, **not** as automatic rates or statistically sampled class labels. In particular, a negative test can forbid a specific false-positive motif without certifying the position entirely problem-free.

A null result/rating/clock must stay null. A missing/stale engine snapshot must stay <code>UNAVAILABLE</code> or <code>INCOMPLETE</code>. An insufficiently evidenced high effect must not become <code>PROBLEM_DETECTED</code>; an adequately covered zero effect may be <code>NOT_DETECTED_WITH_ADEQUATE_COVERAGE</code>. Phase 5 labels are not evidence that a Phase 6 current finding set was published: the #129 production materialization blocker remains separate.

## 3. Reproduction and validation

From a clean checkout, using the repository's documented Node/npm versions and installed workspace dependencies:

\`\`\`sh
npm ci
npm run build:domain
npm run build:contracts
npm run build:api
node --test apps/api/test/phase-7-gold-corpus.test.mjs
npm run typecheck
npm run lint
npm test
\`\`\`

The focused test is part of the existing <code>apps/api/test/*.test.mjs</code> test glob, and therefore runs during the normal API test suite/CI path. It requires no database, credentials, live provider, or real Stockfish process.

The test validates stable IDs, version pins, synthetic provenance, legal PGN/FEN move transitions, clock alignment slots, and the accepted module outputs. Outputs are deterministic and independently rerunnable. On failure, the assertion prints an actual-versus-expected object diff within a named subtest; **do not** make the discrepancy disappear by editing expectations without documenting why the review or implementation changed.

**Execution record:** Created by a GitHub-connected implementation session without an accessible local repository checkout; npm, database, and browser execution are **not claimed**. CI status and exact run/commit must be recorded on the PR after the run. No real binary test is claimed (#123 owns it).

## 4. Reviewer protocol for #124 and #125

1. **Freeze inputs and versions.** Record fixture ID and SHA, detector/aggregate/projection policy version, engine binary identity and settings *if real* (otherwise explicitly mark double), and any Lichess/clock provenance. Reject unlabeled imported clocks or credentials.
2. **Adjudicate evidence in separate columns.** Inspect legality, board geometry, engine continuation, phase label, source clock integrity, motif/mechanism label, and diagnostic interpretation independently. An engine suggested move or simulated score loss alone is not expert validation of a claim.
3. **Assign one judgment per assertion:** <code>SUPPORTED</code>, <code>REFUTED</code>, <code>AMBIGUOUS</code>, or <code>NOT_ASSESSABLE</code>, with an evidence URL/line or FEN/ply, optional alternate label, reason, review date and reviewer identity. Use a confidence grade only for the human adjudication, not as a product evidence grade.
4. **Separate errors:** detector false positive, detector false negative, coverage classification failure, incorrect source/clock fact, phase classification failure, and subjective over-interpretation. A missing engine or timing modality is a coverage failure/unknown, **not** a true negative.
5. **Reconcile two reviews where possible.** Preserve both verdicts and contested cases, document disagreements; do not replace reviewer findings with AI-generated labels or quietly edit immutable source facts.
6. **Compare after changes.** Keep old policy fixture outputs reproducible; when legitimate calibration changes a fixture expectation, version the corpus and record the old/new prediction, human rationale, and versioned policy migration. Do not claim improvement from a newly relabeled test alone.

Suggested review-record structure (stored outside the runtime fixture, e.g. in the #124 audit artifact) is <code>{caseId, corpusVersion, assertion, verdict, reviewer, reviewDate, confidence, sourceEvidence, notes, alternateLabel}</code>. V1 deliberately leaves reviewers unassigned rather than inventing independent expert sign-off.

## 5. Coverage and sampling gaps

The present v1 is a **small deterministic bootstrap**, not a sampled validation set. It has no real third-party PGNs, external clocks, real Stockfish evaluations, independently annotated expert games, statistical calibration, or production persisted current diagnoses. It does **not** yet contain real conversion/throw/save, rook-endgame, opening recurrence, opponent threat/missed mate, session streak/late-session, or mechanism-to-root ranking adjudications. Bullet/blitz/rapid appear as *synthetic timing controls*, not representative populations; increments and rating context are not balanced sampled arms.

Follow-ups for #122/#124/#125: add legally sourced and redistributable anonymized opt-in cases or freely licensed games; obtain explicit source rights and privacy permission; capture recorded original Lichess clock states and alignment status without exposing identities/tokens; pin and execute real Stockfish v/settings/config (#123); expand supported offense/defense/endgame/opening/context controls; curate independent reviewer labels and balanced hard negatives; report confusion matrices **only** on a declared eligible, reviewed and stratified dataset. Record source selection bias, duplicate games, precise denominators, and unknown fields.

**Rights/privacy:** These 14 fixtures were composed synthetically from positions and assertions in the repository's existing tests. No private personal accounts, external game identifiers, Lichess credentials, or unlicensed third-party PGNs are committed. Any subsequent third-party fixture must retain a rights/provenance record and remove or obtain permission to publish potentially identifying metadata.

## 6. CRT reference and Why-specific delta

The pattern reused here is the project's accepted Phase 3/4/5 fixture-driven and versioned deterministic checks (see <code>apps/api/test/tactical-motif-evidence.test.mjs</code>, <code>time-pressure-exposure.test.mjs</code>, and <code>phase-5-acceptance.test.mjs</code>), themselves adapted from the CRT chess-analysis/engine-test design. Unlike a profile-only regression, Why's corpus distinguishes source clocks, legal board facts, artificial engine snapshots, supported diagnosis states, and human-review uncertainty as separately reviewable evidence layers. It intentionally adds **no production classifier, scheduler, policy tweak, synthetic clocks to imports, or AI-provided truth**.
