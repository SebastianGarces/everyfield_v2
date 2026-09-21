---
name: delivery-recovery
description: Inspect communication delivery problems and prepare eligible retries or non-opener follow-up without duplicating successful deliveries.
---

# Delivery recovery

Use `communication.query` to find the intended message and recipient delivery records, then `communication.get_many` for its full content and current resend eligibility. One message may have mixed outcomes. Provider acceptance is not proof of delivery or opening.

Preserve the original audience unless the user asks to change it. A request to retry failures must not resend to successful recipients. Non-openers are a separate workflow with its own eligibility, not a synonym for failed recipients.

If the provider result is unknown, report the uncertainty and let the trusted execution path reconcile it. Do not treat uncertainty as proof that another send is safe. Prepare only the supported eligible retry through `actions.prepare`, and show its audience and content before confirmation.

For failed deliveries, prepare `communication.retry_failed` with the original message ID. The server selects confirmed delivery failures, excludes successful, suppressed, uncertain, or already-retried deliveries, and preserves the original content. Optional `recipientIds` are delivery-row IDs, not person IDs. Never replace this operation with an ordinary send to a copied list of people. If no retry is eligible, explain the restriction briefly. An uncertain existing send retains its original provider key and frozen payload; after the safe recovery window, it stays unresolved rather than risking another email.

Report results from delivery or execution receipts. Do not infer "sent" merely because a review was created.
