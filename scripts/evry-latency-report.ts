import {
  buildEvryLatencyReport,
  renderEvryLatencyReportMarkdown,
} from "@/lib/evry/observability/latency";
import { CONTROLLED_EVRY_LATENCY_FIXTURE } from "@/lib/evry/observability/latency-fixture";

const report = buildEvryLatencyReport(CONTROLLED_EVRY_LATENCY_FIXTURE);
const failed = [
  ...report.capabilities.flatMap(({ milestones }) => [
    milestones.acknowledgement,
    milestones.useful_output,
  ]),
  ...report.recipes.flatMap(({ milestones }) => [
    milestones.acknowledgement,
    milestones.useful_output,
    milestones.confirmation_artifact,
  ]),
].some(({ withinBudget }) => !withinBudget);

process.stdout.write(renderEvryLatencyReportMarkdown(report));
if (failed) process.exitCode = 1;
