Current Task
- Completed: tightened the no-match gate so weak rerank results cannot slip through when only one confidence signal is strong, and made sure the model-selected best candidate is scored before trimming.

Route
- Route B
- Reason: the fix spans both matcher implementations and needs synchronized rerank/no-match behavior across server and worker paths.

Writer Slot
- main: planner-only
- worker_matcher: done
- worker_review: done

Contract Freeze
- Input data: the existing matcher logic in `server/openai-matcher.mjs` and `worker/openai-matcher.js`.
- MVP behavior: keep the current API shape, but suppress low-confidence junk matches and surface an explicit no-match state when the best candidates are too weak.
- Accuracy strategy: preserve the current shortlist/rerank flow, but add a confidence gate based on the final rerank scores and the model-selected best candidate.
- Out of scope for MVP: a new embedding pipeline, database changes, auth, or any frontend changes.
- Implementation approach: make `rerankCandidates()` expose enough information to resolve the model-chosen best candidate score before trimming, then make `shouldSuppressMatch()` gate on `best_match_id` when available and otherwise fall back to the top-scoring returned match.
- Write sets: `server/openai-matcher.mjs` and `worker/openai-matcher.js` own the fix; keep the change set tight to those files unless verification exposes a direct blocker.
- Failure policy: a weak result should be honest, not force a false best match.

Reviewer
- Hubble

Last Update
- 2026-05-14: confirmed the no-match gate now keys off `best_match_id` plus OR-threshold checks, with best-match scoring resolved before truncation; `npm.cmd run build` passed.
