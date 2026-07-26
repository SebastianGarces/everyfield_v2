# Ministry Team Management – Implementation Checklist

## Must Have

- [x] MT-001: Ministry team list (10 core teams)
- [x] MT-002: Team detail view (members, roles, status)
- [x] MT-003: Team leader assignment
- [x] MT-004: Role definition within teams
- [x] MT-005: Member assignment to team roles
- [x] MT-006: Staffing status tracking (filled vs open roles)
- [x] MT-007: Role templates (pre-built per team)
- [x] MT-008: Team dashboard with health indicators
- [x] MT-009: Basic metrics (staffing percentage)
- [ ] MT-010: Person-team linking (show on person profile) — backend exists (`getPersonTeams`), but the person-profile Teams tab is still a placeholder
- [x] MT-019: Custom team creation (beyond 10 core)

## Should Have

- [ ] MT-011: Training tracking (required training per role) — diverged: shipped model tracks required training at team level, not per role; pending decision on which model is canon
- [x] MT-012: Training completion matrix (team members vs training)
- [x] MT-013: Team meeting scheduling
- [x] MT-014: Meeting attendance recording
- [ ] MT-015: Team communication via Communication Hub (F9) — F9 exists but has no ministry-team recipient targeting yet
- [x] MT-016: Health scoring (staffing, training, attendance)
- [x] MT-017: Alert thresholds for understaffed teams — staffing yellow/red + attendance thresholds implemented; training/phase warning not in the alert logic
- [x] MT-018: Org chart view (hierarchical visualization)
- [x] MT-020: Role assignment warnings (multiple teams)

## Nice to Have

- [ ] MT-021: Service scheduling (volunteer rotation)
- [ ] MT-022: Availability tracking
- [ ] MT-023: Automated scheduling based on availability
- [ ] MT-024: Team performance analytics
- [ ] MT-025: Mobile check-in for team meetings
- [ ] MT-026: Team chat integration
