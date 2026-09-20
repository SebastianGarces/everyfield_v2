---
name: delivery-recovery
description: Inspect communication delivery problems and prepare eligible retries or non-opener follow-up without duplicating successful deliveries.
---

# Delivery recovery

Use `communication.query` to find the intended message and recipient delivery records, then `communication.get_many` for its full content and current resend eligibility. One message may have mixed outcomes. Provider acceptance is not proof of delivery or opening.

Preserve the original audience unless the user asks to change it. A request to retry failures must not resend to successful recipients. Non-openers are a separate workflow with its own eligibility, not a synonym for failed recipients.

If the provider result is unknown, report the uncertainty and let the trusted execution path reconcile it. Do not treat uncertainty as proof that another send is safe. Prepare only the supported eligible retry through `actions.prepare`, and show its audience and content before confirmation.

Report results from delivery or execution receipts. Do not infer "sent" merely because a review was created.
