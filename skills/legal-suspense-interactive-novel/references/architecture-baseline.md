# Architecture Baseline

Use this baseline when the user does not provide a stronger alternative.

## 1. Core Positioning

- Genre: legal suspense interactive fiction.
- Player role: defense lawyer and investigator.
- Main loop: incident -> evidence collection -> witness confrontation -> courtroom argument -> judgment.
- Multiple endings: truth revealed, wrongful conviction, misled verdict, power interference.

## 2. System Layers

- Frontend: rendering, interaction, progress, state panel, replay viewer.
- Backend: session lifecycle, orchestration, rule evaluation, persistence, logging, token metering.
- Model gateway: unified call entry with usage statistics.

## 3. Agent Set (Recommended)

- Orchestrator: control sequence and merge turn output package.
- Case Planner: plan chapter/scene advancement points.
- Evidence Analyst: score evidence reliability and contradiction risk.
- Narrative Writer: stream narrative text with style constraints.
- Choice Designer: generate 3-4 structured player choices.
- State Referee: propose state patch from action + rules.
- Consistency Auditor: detect contradictions/repetition/scope violations.
- Recovery Agent: repair failed outputs or return safe fallback turn.
- Memory Curator: maintain short/mid/long memory bundles.

## 4. Turn Pipeline

1. Receive player action.
2. Load session state and memory bundles.
3. Plan narrative skeleton and evidence updates.
4. Compute draft state patch.
5. Generate narrative stream and next choices.
6. Audit consistency.
7. Recover on failure.
8. Validate with rule engine.
9. Persist replay and token metrics.
10. Push SSE events to client.

## 5. State Design

Track at least:

- Progress: turn, chapter, scene.
- Core stats: truth_score, judge_trust, jury_bias, public_pressure, evidence_integrity.
- Boolean flags: key twists and corruption/interference markers.
- Evidence pool and NPC relations.
- Three-layer memory: short window, mid summary, long anchors.

## 6. Stability Constraints

- Every turn must produce observable progression.
- Detect and rewrite repetitive narrative or repeated options.
- Enforce schema-based structured output.
- Retry and degrade safely on parser/model failures.
- Reject persistence when consistency audit fails.
