# Renewable Evry QA account

Use the feature branch's Vercel preview, which reads the shared development database.
The preview login picker includes these three accounts. Their password is `password123`.

| Account | Email | Seat |
| --- | --- | --- |
| Evry Test | evry-test@everyfield.app | Plant owner |
| Morgan Test | evry-test-admin@everyfield.app | Plant admin |
| Jordan Test | evry-test-member@everyfield.app | Plant member |

All belong to **Evry Test Church**, stable ID `ca6fce0d-f382-4d84-a6b8-0a1c54cb727d`.
This is a fictional, pre-launch plant in Albany, with `America/New_York` time.
It is not an oversight organization or a production account.

## Reset and check

Run from this checkout with its development `.env.local` and installed dependencies:

```sh
pnpm evry:seed                          # Read-only plan
pnpm evry:seed --reset                  # Replace this QA plant's operational data
pnpm evry:seed --check                  # Check counts, fresh dates, facts and file bytes
pnpm evry:seed --reset --rollback-test  # Fail after the final insert; prove full rollback
pnpm evry:seed --guard-test             # Rollback-only adversarial safety probes
```

`--as-of=2026-09-08T16:00:00Z` pins the reference clock for reproducible tests. Omit it for fresh data today.
The reset moves tasks, meetings, interviews, check-ins and launch dates relative to the current New York day.
Meetings remain at 6 PM Eastern, with EST or EDT as appropriate. Launch is a Sunday at least four weeks away.

**Reset replaces test edits in this plant.** Finish testing first, then reload the app and start a new Evry conversation.
Running requests, executing plans, unexpired confirmations and unreconciled execution effects block reset.
Complete or recover execution, or let an unconfirmed plan expire. There is no force flag.

The script preserves the church and account IDs, other plants, global Wiki content, and immutable Evry conversations and audit records.
Old conversations therefore remain historical evidence, not the source of truth for the reseeded records.
Three private document objects are reused. Other generated documents remain available to historical download links.
No global `db:seed`, truncation, audit deletion, email delivery or LLM assessment is involved.

Database writes, including Plant Intelligence fixtures, share one advisory-locked transaction.
Document uploads happen first and are conditional creates; a failed transaction can leave at most three reusable private fixture objects.
The guard probes always roll back, including when the guard under test fails to reject their inputs.

## Data and expected answers

- 59 people: 56 recruited contacts, eight in every pipeline stage, plus three linked account people. Twelve households, six tags, 42 skills, 56 activity notes, 24 interviews, 28 Four C's assessments and 24 commitments.
- Ten ministries using the application's templates, 48 roles, 16 assignments, 30 responsibility items, ten training programs and ten completions. Some roles and leadership seats are deliberately open.
- Nine meetings: completed and upcoming Vision Meetings and orientations, a rehearsal today, a future team meeting and a cancelled meeting. There are 104 attendance/guest rows, 40 invitations, 40 response cards, 45 checklist items and four evaluations. Completed attendance rows include post-meeting notes.
- 42 tasks, including follow-up, assigned and unassigned work, a subtask, a dependency, recurring work and launch preparation.
- A scheduled launch, nine canonical milestones, four completed milestones and all 23 linked checklist tasks. This plant is pre-launch, so a completed launch outcome is intentionally absent.
- Three communication templates, draft/sent/failed **fictional history**, eight recipient records, and no pending delivery jobs. Contacts use reserved `.invalid` emails and fictional 555 phone numbers. Do not substitute real recipients when testing a send.
- Three real downloadable documents, one each of PDF, DOCX and XLSX; three church Wiki articles with bookmark/progress/feedback; phase history, six attestations, three private planter check-ins and eight in-app notifications.
- A Plant Intelligence fact snapshot produced by the real signal assembler and verified against production database reads. Its sample insight and feedback are explicitly labeled QA, not model-generated advice.

Ask Evry Test:

1. "Which of my pending tasks are due today?" Expect **2**, not overdue tasks.
2. "Only show my overdue tasks." Expect **2**.
3. "What did I complete today?" Expect **1** task due today.
4. "Who needs follow-up, and who has no assigned owner?" Expect assigned and unassigned examples.
5. "What meetings are coming up?" Open an upcoming meeting to inspect its guest list and checklist.
6. "Which ministry roles are still open?" Compare against the ministry pages.
7. "How far along is launch preparation?" Expect **4 of 9 milestones completed**.
8. Ask for interviews, assessments, skills, notes, templates, documents and Wiki content, then compare the answer with the corresponding app page.

The fixture makes these questions testable; it does not assert that every Evry capability in #758 is complete.
Use Morgan or Jordan to check permissions and "my tasks" filtering. Their tasks due today must not appear as Evry Test's tasks.

## Local regression checks

The fixture compiler makes no database or provider calls. Its imports require a syntactically valid database environment value:

```sh
DATABASE_URL=postgresql://fixture:fixture@localhost/fixture pnpm exec tsx --test scripts/evry-test-fixtures.test.ts 'src/app/(auth)/login/preview-accounts.test.ts'
pnpm typecheck
```
