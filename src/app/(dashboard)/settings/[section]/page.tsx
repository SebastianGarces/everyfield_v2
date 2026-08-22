import {
  settingsSectionFromParams,
  settingsSectionMetadata,
  SettingsSurface,
  type SettingsSectionParams,
} from "@/components/settings/settings-surface";

// ============================================================================
// `/settings/<section>` — the COLD-LOAD half (CS-001, #615).
//
// ONE DYNAMIC ROUTE FOR EVERY SECTION, including `/settings/team`,
// `/settings/association` and `/settings/sharing`, whose URLs are unchanged and
// whose sibling pages this route replaced. The registry decides which ids
// resolve, so the set of settings URLs is the section list and not a set of
// folders somebody has to keep level with it.
//
// A reader who pastes this URL gets the modal over the dashboard shell rather
// than a page: same component, `overlaid: false`, so Close goes to their home
// instead of back out of the app.
// ============================================================================

export const dynamic = "force-dynamic";

export function generateMetadata({
  params,
}: {
  params: SettingsSectionParams;
}) {
  return settingsSectionMetadata(params);
}

export default async function SettingsSectionPage({
  params,
}: {
  params: SettingsSectionParams;
}) {
  return (
    <SettingsSurface
      sectionId={await settingsSectionFromParams(params)}
      overlaid={false}
    />
  );
}
