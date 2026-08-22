import { permanentRedirect } from "next/navigation";

import {
  DEFAULT_SETTINGS_SECTION,
  settingsSectionUrl,
} from "@/lib/settings/sections";

// ============================================================================
// `/settings` — A REDIRECT, AND THE ONLY THING LEFT OF THE SETTINGS ROUTES
// (#657, ruled 2026-08-22).
//
// Settings is a fragment over the current screen now (`settings-modal.tsx`), so
// nothing here renders it. This file and its `[section]` sibling exist for the
// URLs that ALREADY SHIPPED — in sent mail, and in whatever readers bookmarked
// while `/settings/*` was real — and for nothing else. No new link in this
// product points at either.
//
// PATH TO PATH-PLUS-FRAGMENT, which a server redirect can do even though it can
// never READ a fragment: the Location header carries `#settings/<id>` and the
// browser applies it after following. That asymmetry is the whole reason these
// two files can retire four routes without stranding anybody.
// ============================================================================

export default function SettingsRedirectPage() {
  permanentRedirect(settingsSectionUrl(DEFAULT_SETTINGS_SECTION));
}
