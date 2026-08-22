import {
  settingsSectionFromParams,
  settingsSectionMetadata,
  SettingsSurface,
  type SettingsSectionParams,
} from "@/components/settings/settings-surface";

// ============================================================================
// `/settings/<section>` COLD — the same slot, not intercepted (#640, #646).
//
// An intercepting route is bypassed on a full page load, so a pasted or mailed
// `/settings/church` needs a second route to draw the modal. It lives HERE,
// beside the interceptor, rather than under the layout's `children`.
//
// That placement is the whole point. The `@settings` slot holds at most one
// match, so the cold-load half and the intercepted half can never be on screen
// together — where a `children` copy could, and did (#646): `children` stays
// pinned at the URL the document booted on, so returning to that section made
// its copy match again and a second dialog appeared beside the slot's.
//
// `intercepted: false` — nothing is behind a URL somebody pasted, so Close goes to
// the account's home instead of out of the app.
//
// AN ID THE REGISTRY NO LONGER KNOWS STILL LANDS SOMEWHERE SENSIBLE. This is the
// half a pasted or bookmarked URL reaches, so it is where a RETIRED section id
// matters: `/settings/sharing` was the consent panel's own address until #619
// folded the panel into Church, and `settingsSectionFromParams` redirects it
// there rather than bouncing its reader to the default section.
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
  const sectionId = await settingsSectionFromParams(params);
  return <SettingsSurface sectionId={sectionId} intercepted={false} />;
}
