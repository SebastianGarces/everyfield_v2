# UI prototype — variants behind the switcher, ruled on the preview

For direction questions about **what the interface should be**: layout, hierarchy, density,
affordances, interaction model. The reviewer flips between 3–4 live candidates in the real app and
rules. First used for the W-014 wiki TOC layout ruling (PR #138) — three layouts shipped together
on one branch, the winner picked by flipping between them on the preview.

## The pattern

All candidates are built into the **same branch**, all present in the DOM, selected purely by CSS
keyed off an attribute on `<html>`. Switching is instant — no reload, no re-render, scroll
position kept — which is what makes A/B/C comparison honest.

The reusable harness is `src/components/prototype-switcher.tsx` (`PrototypeSwitcher` +
`prototypeInitScript`). **Read its docblock before wiring** — it is the full pattern. In brief:

1. **Variant styling via Tailwind ancestor arbitrary variants** — static classes, no JS branching:

   ```tsx
   className="hidden [[data-my-proto=b]_&]:block"
   className="max-w-3xl [[data-my-proto=a]_&]:lg:max-w-5xl"
   ```

   Structural variants (different component trees, not just different classes) render all trees
   and show/hide the same way.

2. **Mount the switcher** in the layout that owns the page under evaluation:

   ```tsx
   <PrototypeSwitcher
     attribute="data-my-proto"
     storageKey="my-proto"
     options={[
       { id: "a", label: "A · Wide", hint: "one line on what A does" },
       { id: "b", label: "B · Sidebar", hint: "one line on what B does" },
     ]}
   />
   ```

3. **Render the init script** in the same layout so reloads don't flash the default:

   ```tsx
   <script
     dangerouslySetInnerHTML={{
       __html: prototypeInitScript("data-my-proto", "my-proto", ["a", "b"]),
     }}
   />
   ```

## Rules

- **Diverge on structure, not styling.** Options must differ in layout, hierarchy, or affordances.
  If a screenshot of A could be mistaken for B at a glance, they are one option, not two.
- **Real data.** Evaluate against a seeded account with actual content (the eval planters in
  `.claude/skills/browser-validation/SKILL.md` have ~100 people). An empty state proves nothing
  about a layout.
- **Read-only variants.** If a variant's interaction would mutate data, stub the mutation. The
  preview writes to the shared development database.
- **Every option fully works.** Half-built options bias the ruling toward whichever one you
  finished.

## Where it runs

- **Hold case:** build into the held PR's branch and push. CI re-runs — prototype code must keep
  typecheck/lint green, which it will if it's real (if temporarily imperfect) component code.
- **Intake case:** branch `proto/<issue>-<slug>`, open a **draft PR** titled
  `proto: <question> (#<issue>)` — the push is what creates the preview deployment.

Then get the reviewable URL:

```bash
./scripts/preview-url.sh --wait --bypass <pr-number>
```

Flip through every option yourself on the preview (see `browser-validation` for login accounts and
the bypass-cookie dance) before posting the DECISION comment with that URL.

## After the ruling

Delete the losing variants, collapse the winner's variant classes into plain ones, unmount the
switcher and the init script. The harness's fallback means a reviewer's stale `localStorage` value
can never select nothing — but the evaluation scaffolding itself never merges as live UI.
