import { getChurchMergeData } from "@/lib/communication/church-merge";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";

export const EVE_CHURCH_MERGE_READ = defineEvryReadRegistration({
  id: "communication.merge-context",
  capabilityIdentity: "communication.compose.get-church-merge-data",
  inputShape: {},
  async run({ authorization }) {
    const facts = await getChurchMergeData(authorization.actor.plantId);
    const sourceLink = trustedEvryApplicationSourceLink({
      label: "Open message composer",
      href: "/communication/compose",
    });
    return buildEvryReadArtifact({
      title: "Church message fields",
      filters: [],
      exclusions: [],
      items: Object.entries(facts).map(([key, value]) => ({
        id: key,
        label: `{{${key}}}`,
        facts: [{ label: "Value", value }],
        sourceLink,
      })),
      sourceLinks: [sourceLink],
    });
  },
});
