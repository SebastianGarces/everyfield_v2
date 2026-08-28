const TRUSTED_EVRY_SOURCE_LINK: unique symbol = Symbol(
  "TrustedEvryApplicationSourceLink"
);
const APPLICATION_ORIGIN = "https://application.everyfield.invalid";

/** An in-application destination built by trusted product code, never a model. */
export type TrustedEvryApplicationSourceLink = Readonly<{
  label: string;
  href: string;
  [TRUSTED_EVRY_SOURCE_LINK]: true;
}>;

/**
 * Mint an application-only link at the trusted domain-adapter boundary.
 *
 * The brand prevents model output from being passed straight into an artifact.
 * The runtime check also refuses protocol-relative and external destinations.
 */
export function trustedEvryApplicationSourceLink({
  label,
  href,
}: {
  label: string;
  href: string;
}): TrustedEvryApplicationSourceLink {
  const parsed = new URL(href, APPLICATION_ORIGIN);
  if (
    label.trim().length === 0 ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    parsed.origin !== APPLICATION_ORIGIN
  ) {
    throw new Error("Evry source links must be labeled application paths");
  }

  return Object.freeze({
    label,
    href,
    [TRUSTED_EVRY_SOURCE_LINK]: true as const,
  });
}

export type EvryArtifactFact = Readonly<{
  label: string;
  value: string;
}>;

export type EvryReadFilter = Readonly<{
  label: string;
  value: string;
}>;

export type EvryReadExclusion = Readonly<{
  reason: string;
  count: number;
}>;

export type EvryReadItem = Readonly<{
  id: string;
  label: string;
  facts: readonly EvryArtifactFact[];
  sourceLink: TrustedEvryApplicationSourceLink;
}>;

export type EvryReadArtifact = Readonly<{
  kind: "read";
  title: string;
  filters: readonly EvryReadFilter[];
  counts: Readonly<{
    matched: number;
    returned: number;
    excluded: number;
  }>;
  exclusions: readonly EvryReadExclusion[];
  items: readonly EvryReadItem[];
  sourceLinks: readonly TrustedEvryApplicationSourceLink[];
}>;

export type EvryEntityChoice = Readonly<{
  entityType: string;
  id: string;
  label: string;
  distinguishingFacts: readonly EvryArtifactFact[];
  sourceLink: TrustedEvryApplicationSourceLink;
}>;

export type EvryClarificationArtifact =
  | Readonly<{
      kind: "clarification";
      mode: "missing";
      entityType: string;
      prompt: string;
    }>
  | Readonly<{
      kind: "clarification";
      mode: "choice";
      entityType: string;
      prompt: string;
      choices: readonly [
        EvryEntityChoice,
        EvryEntityChoice,
        ...EvryEntityChoice[],
      ];
      defaultChoiceId: null;
    }>;

export type EvryReadContinuationArtifact =
  | EvryReadArtifact
  | EvryClarificationArtifact;
