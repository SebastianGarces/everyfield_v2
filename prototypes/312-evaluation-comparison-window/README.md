# 312 / VM-016c — what does a planter see when their earlier meetings are outside the comparison window?

`compareEvaluationToHistory` filters its trend for points EARLIER than the meeting being viewed.
The trend it is handed is `getEvaluationTrend(churchId, 50)` — the 50 **most recent** evaluated
meetings church-wide. For a church with more than 50 evaluated meetings, opening an early one hands
the function a window containing only LATER meetings, `earlier` is empty, it returns `null`, and the
card renders the first-ever empty state: _"this is the first meeting you have evaluated."_

No church has 50+ evaluated meetings today (the largest has 4), so nothing is wrong on screen right
now. This is latent, not live — and no AC in #312 covers the state, which is why it is a ruling and
not a fix an implementer picks.

`cli.ts` runs four directions over the same churches. The comparison arithmetic is copied verbatim
from the shipped service, so only the **history each direction is given** and the **copy it renders**
differ. Scenario 4 is the one worth sitting with: the same meeting reads −0.6 under the shipped
window and −0.1 under a per-meeting history, because the shipped baseline covers 1 of the 11
meetings that actually preceded it.

Run it:

```
pnpm tsx prototypes/312-evaluation-comparison-window/cli.ts
```

`[a/b/c/d]` flips the direction · `[1-5]` flips the church/meeting · `[s]` shows all four at once ·
`[q]` quits. `--dump` prints everything non-interactively.

Throwaway: nothing here merges. Applying the ruling means implementing the chosen direction in
`src/lib/meetings/service.ts` + the evaluation card and deleting this directory.
