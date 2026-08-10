# #319 — attributing an insight to an attested exit criterion

**Disposable.** Nothing here merges. Applying the ruling includes deleting this directory.

```
pnpm tsx prototypes/319-attested-criterion-attribution/cli.ts
```

`[A-D]` flips the attribution rule · `[1-4]` swaps the citation scenario · `[l]` shows which
manual paths the judge may cite under that rule · `[q]` quits. Piping the output (no TTY)
prints every direction against every scenario as a grid.

## The question

`values_documented`, `financial_base` and `systems_tested` each declare one `factPath`
(`manual.byKey.<signal>`) and no categories, so `addressesCriterion` attributes an insight to
them by prefix match on that single form. But `build-fact-snapshot.ts` writes the manual block
twice — `manual.byKey` **and** `manual.attestations[]` — and `flattenFacts` walks arrays, so
`manual.attestations.2.value` is an equally legal citation. An insight citing it lands on no
criterion and the row reads "Not addressed" for a gate the judge did speak to.

## The directions

| | Direction | Change |
|---|---|---|
| A | Leave it — declared path only (today) | none |
| B | Widen the three definitions to the `manual` prefix | 3 lines |
| C | Attribute by signal: resolve any manual citation to its `signalKey` | ~15 lines + tests |
| D | Narrow the ledger: drop `manual.attestations[]` from `flattenFacts` | a filter + its test |

The standings (`met` / `not met` / `unknown`) are identical under all four — only the
"what the engine said" column moves.
