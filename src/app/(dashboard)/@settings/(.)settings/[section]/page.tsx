import {
  settingsSectionFromParams,
  SettingsSurface,
  type SettingsSectionParams,
} from "@/components/settings/settings-surface";

// ============================================================================
// `/settings/<section>` INTERCEPTED — the overlay half (#615).
//
// THIS FILE IS WHAT MAKES SETTINGS A MODAL. A click on a settings link from any
// dashboard screen resolves here instead of at the real route, so the layout's
// `children` — the screen the reader was on — is never unmounted and never
// re-rendered. Its scroll position, its open dialogs and its client state are
// all still there when `router.back()` closes this slot.
//
// It carries no `generateMetadata`: the document title belongs to the screen
// underneath, which the reader has not left.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function InterceptedSettingsSectionPage({
  params,
}: {
  params: SettingsSectionParams;
}) {
  const sectionId = await settingsSectionFromParams(params);
  return <SettingsSurface sectionId={sectionId} overlaid={true} />;
}
