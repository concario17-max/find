Current Task
- Commit and push complete: the current workspace changes are on `origin/main`.

Route
- Route A
- Reason: this is a narrow git finish-up task with one small ignore-file edit and a single commit/push slice; no implementation fanout is needed.

Writer Slot
- main: write-capable
- worker_workers: n/a
- worker_review: n/a

Contract Freeze
- Input data: the existing matcher logic in `server/openai-matcher.mjs` and `worker/openai-matcher.js`.
- MVP behavior: preserve the current `/api/match` response shape while making rerank failures fail-soft instead of surfacing `OPENAI_API_ERROR`.
- Accuracy strategy: keep shortlist scoring unchanged; only reduce the rerank request size and add retry/fallback handling around OpenAI Responses calls.
- Out of scope for MVP: data model changes, ranking algorithm changes, auth, and unrelated UI redesign.
- Implementation approach: keep the committed scope limited to the existing workspace changes, ignore generated Cloudflare state, and push the current `main` branch to `origin`.
- Write sets: `.gitignore` owns the ignore tweak; git commit/push operations own the remainder of the task.
- Failure policy: do not include generated `.wrangler/` contents in the commit.

Reviewer
- Hubble

Last Update
- 2026-05-14: commit `bb9415c` pushed to `origin/main`; `.wrangler/` stayed ignored.
