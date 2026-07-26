# Communication Hub – Implementation Checklist

## Must Have

- [x] COM-001: Message composition
- [x] COM-002: Email delivery via integrated service (Resend)
- [x] COM-003: Recipient selection (individuals or groups)
- [x] COM-004: Message templates (pre-built for common communications)
- [x] COM-005: Merge fields (personalize with recipient data) — note: `{{pastor_name}}` and `{{launch_date}}` currently render empty (church profile fields not yet sourced)
- [x] COM-006: Message history view
- [x] COM-007: Person communication log (messages sent to specific person)
- [x] COM-008: Basic delivery tracking (sent/delivered status)
- [x] COM-009: Quick select groups (Core Group, Prospects, Launch Team, Leaders) — note: ministry-team quick select not implemented
- [x] COM-010: Template categorization by purpose

## Should Have

- [ ] COM-011: SMS delivery via integrated service (Twilio)
- [x] COM-012: Open tracking (email opens)
- [x] COM-013: Click tracking (link clicks in emails)
- [ ] COM-014: Scheduled sending
- [x] COM-015: Message preview with sample merge data
- [x] COM-016: Custom templates (church-specific)
- [ ] COM-017: Rich text editor (bold, italic, links)
- [ ] COM-018: Resend to non-openers
- [ ] COM-019: Delivery stats dashboard — partial: per-message delivered/opened/clicked stats exist on the message detail view; no aggregate performance overview
- [ ] COM-020: Task integration (log communication on task completion)

## Nice to Have

- [ ] COM-021: Reply handling (route replies to sender's email)
- [ ] COM-022: Unsubscribe management
- [ ] COM-023: A/B testing (subject lines/content)
- [ ] COM-024: Drip campaigns (automated sequences)
- [ ] COM-025: In-app messaging (message center for team members)
- [ ] COM-026: Push notifications (mobile push for urgent messages)
