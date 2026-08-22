import { SettingsSurface } from "@/components/settings/settings-surface";
import { DEFAULT_SETTINGS_SECTION } from "@/lib/settings/sections";

// ============================================================================
// `/settings` INTERCEPTED — the overlay half (#615).
//
// `(.)` and not `(..)`: the matcher counts ROUTE SEGMENTS, and neither a slot
// (`@settings`) nor a route group (`(dashboard)`) is one — so this file's target
// normalizes to `/settings`, one segment from the group's root.
//
// It exists for the same reason the cold-load `/settings` page does: the URL is
// in sent mail and in bookmarks, and `redirect("/settings")` is what the section
// bodies bounce an ungated reader with. Without this file that bounce would fall
// through to the real route and take the screen behind the modal with it.
// ============================================================================

export const dynamic = "force-dynamic";

export default function InterceptedSettingsPage() {
  return (
    <SettingsSurface
      sectionId={DEFAULT_SETTINGS_SECTION}
      ownPath="/settings"
      overlaid={true}
    />
  );
}
