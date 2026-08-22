import type { Metadata } from "next";

import { SettingsSurface } from "@/components/settings/settings-surface";
import { DEFAULT_SETTINGS_SECTION } from "@/lib/settings/sections";

// ============================================================================
// `/settings` with no section — the COLD-LOAD half (CS-001, #615).
//
// It renders rather than redirects to `/settings/account`, because this URL is
// in sent mail, in bookmarks and in `OVERSIGHT_CONSENT_SURFACES`: a bounce would
// put a redirect in front of every one of them to save a file three lines long.
//
// `overlaid: false` — nothing is behind a URL somebody pasted, so closing goes
// to the account's home instead of into the browser's history. The intercepting
// twin of this route (`../@settings/(.)settings/page.tsx`) is the other half and
// passes `true`.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <SettingsSurface
      sectionId={DEFAULT_SETTINGS_SECTION}
      ownPath="/settings"
      overlaid={false}
    />
  );
}
