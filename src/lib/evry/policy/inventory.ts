import generatedInventory from "@/lib/evry/capabilities/inventory.generated.json";

/**
 * The policy classifier's application vocabulary comes from EV-001's generated
 * inventory. It must not import the Settings registry: that module also carries
 * icons, visibility predicates, and auth policy that classification neither
 * needs nor has permission to evaluate.
 */
export type EvrySettingsCatalogEntry = Readonly<{
  id: string;
  label: string;
  keywords: readonly string[];
}>;

export const EVRY_SETTINGS_CATALOG: readonly EvrySettingsCatalogEntry[] =
  generatedInventory.registries.settingsSections;

export const EVRY_PLANT_NAVIGATION: readonly string[] =
  generatedInventory.registries.plantNavigation;

export const EVRY_SUPPORTED_CAPABILITIES: readonly string[] =
  generatedInventory.capabilities.flatMap(({ id, classification }) =>
    classification.state === "supported" ? [id] : []
  );
