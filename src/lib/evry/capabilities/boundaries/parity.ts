import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities(
  {
    id: "boundary.settings",
    classification: { state: "excluded", reason: "settings" },
    selectors: [
      { kind: "route", match: "prefix", path: "/settings" },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(dashboard)/settings",
      },
      { kind: "application-capability", capability: "association.answer" },
    ],
  },
  {
    id: "boundary.authentication",
    classification: { state: "excluded", reason: "authentication" },
    selectors: [
      { kind: "route", match: "prefix", path: "/login" },
      { kind: "route", match: "prefix", path: "/register" },
      { kind: "route", match: "prefix", path: "/verify-email" },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(auth)/login",
      },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(auth)/register",
      },
      {
        kind: "action-source",
        match: "exact",
        source: "src/lib/auth/actions.ts",
      },
    ],
  },
  {
    id: "boundary.public-sessionless",
    classification: { state: "excluded", reason: "public_or_sessionless" },
    selectors: [
      { kind: "route", match: "exact", path: "/" },
      { kind: "route", match: "prefix", path: "/privacy" },
      { kind: "route", match: "prefix", path: "/terms" },
      { kind: "route", match: "prefix", path: "/rsvp" },
      { kind: "route", match: "prefix", path: "/unsubscribe" },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(marketing)",
      },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/unsubscribe",
      },
    ],
  },
  {
    id: "boundary.coaching",
    classification: { state: "excluded", reason: "coaching" },
    selectors: [
      { kind: "route", match: "prefix", path: "/coaching" },
      { kind: "route", match: "prefix", path: "/coach-invitation" },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(auth)/coach-invitation",
      },
    ],
  },
  {
    id: "boundary.oversight",
    classification: { state: "excluded", reason: "oversight" },
    selectors: [
      { kind: "route", match: "prefix", path: "/oversight" },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(dashboard)/oversight",
      },
      {
        kind: "application-capability",
        capability: "org.invitation.manage",
      },
    ],
  },
  {
    id: "boundary.pre-tenancy-onboarding",
    classification: {
      state: "excluded",
      reason: "pre_tenancy_onboarding",
    },
    selectors: [
      {
        kind: "action-source",
        match: "exact",
        source: "src/app/(dashboard)/dashboard/actions.ts",
      },
    ],
  },
  {
    id: "boundary.platform-admin",
    classification: {
      state: "unreachable",
      reason: "platform_admin_only",
    },
    selectors: [
      { kind: "route", match: "prefix", path: "/admin" },
      {
        kind: "action-source",
        match: "prefix",
        source: "src/app/(dashboard)/admin",
      },
    ],
  }
);
