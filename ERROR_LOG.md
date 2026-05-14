time: 2026-05-13 22:59 +09:00
location: C:\Users\roadsea\Desktop\find
summary: PowerShell npm launcher blocked by execution policy
details: `npm install` initially failed because `npm.ps1` could not run under the current PowerShell policy. Re-ran the same install through `npm.cmd` and completed successfully.
status: resolved

time: 2026-05-14 15:32 +09:00
location: C:\Users\roadsea\Desktop\find
summary: PowerShell npm launcher blocked build verification
details: `npm run build` failed because PowerShell refused to load `npm.ps1` under the current execution policy. This is an environment-only issue; the same command should be retried with `npm.cmd` or `cmd /c npm run build`.
status: open

time: 2026-05-14 15:33 +09:00
location: C:\Users\roadsea\Desktop\find
summary: PowerShell npm launcher blocked build verification
details: The same build verification was completed with `npm.cmd run build`, confirming the code path was fine and the earlier failure was only PowerShell's execution policy blocking `npm.ps1`.
status: resolved

time: 2026-05-14 15:32 +09:00
location: C:\Users\roadsea\Desktop\find
summary: Parallel verification caused dist output race
details: `npm.cmd run build` and `npm.cmd run dev -- --help` were launched in parallel. Both commands invoke `npm run build`, so they raced on `dist/` and produced a transient `ENOTEMPTY` error from Vite while emptying `dist/images`.
status: open

time: 2026-05-14 15:33 +09:00
location: C:\Users\roadsea\Desktop\find
summary: Parallel verification caused dist output race
details: Reran `npm.cmd run dev -- --help` sequentially after the collision, and the Worker-compatible dev flow completed successfully with build, env sync, and Wrangler help output.
status: resolved
