import { TASK_QUERY_READS } from "./operations-tasks";
import { MEETING_QUERY_READS } from "./operations-meetings";
import { TEAM_QUERY_READS } from "./operations-teams";

export const OPERATIONS_QUERY_READS = [
  ...TASK_QUERY_READS,
  ...MEETING_QUERY_READS,
  ...TEAM_QUERY_READS,
] as const;
