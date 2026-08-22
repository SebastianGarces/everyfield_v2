import { permanentRedirect } from "next/navigation";

import {
  resolveSettingsSection,
  settingsSectionUrl,
} from "@/lib/settings/sections";

// ============================================================================
// `/settings/<section>` — the second and last of the retired routes (#657).
//
// It sends every old section URL to the fragment that replaced it, including the
// ones that never named a live section: `resolveSettingsSection` is the same
// correction the modal applies to a fragment, so `/settings/sharing` lands on
// Church (the section that absorbed it) and a typo lands on Account, with ONE
// spelling of that rule rather than a redirect table beside it.
//
// It covers `/settings/team` and `/settings/association` too, which have sibling
// FOLDERS under `src/app/(dashboard)/settings/`. Those hold `actions.ts` and the
// colocated dialogs and queries and no `page.tsx`, so this dynamic segment is
// what `/settings/team` resolves to — the same arrangement that served them
// while the modal was routed.
// ============================================================================

export default async function SettingsSectionRedirectPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  permanentRedirect(settingsSectionUrl(resolveSettingsSection(section)));
}
