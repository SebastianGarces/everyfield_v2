import type { EvryPublicPolicyArtifact } from "@/lib/evry/policy/artifacts";
import { SettingsLink } from "@/components/settings/settings-link";
import { resolveSettingsDestination } from "@/lib/settings/sections";

/** A static, transcript-safe rendering of a deterministic policy artifact. */
export function EvryBoundaryMessage({
  artifact,
}: {
  artifact: EvryPublicPolicyArtifact;
}) {
  const settingsSection =
    artifact.kind === "settings_handoff"
      ? resolveSettingsDestination(artifact.destination.sectionId)
      : null;

  return (
    <article className="border-border bg-muted/30 rounded-lg border p-4">
      <h2 className="text-sm font-semibold text-pretty">{artifact.title}</h2>
      <p className="text-muted-foreground mt-1 text-sm text-pretty">
        {artifact.message}
      </p>

      {artifact.kind === "boundary" ? (
        <div className="mt-3 text-sm">
          <p className="font-medium">Try:</p>
          <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5">
            {artifact.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </div>
      ) : settingsSection ? (
        <p className="mt-3 text-sm">
          <SettingsLink
            section={settingsSection.id}
            className="text-primary cursor-pointer font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Open {settingsSection.label} settings
          </SettingsLink>
        </p>
      ) : null}
    </article>
  );
}
