import { sql, type SQL } from "drizzle-orm";
import { MAX_SECTION_MINUTES } from "@/lib/meetings/agenda";

/** Evidence of stored values, not parseAgenda's editing-time default of zero. */
export function meetingAgendaItemEvidence(entry: SQL): SQL {
  const minutes = sql`${entry} ->> 'minutes'`;
  const duration = sql`case
    when ${entry} -> 'minutes' is null or ${entry} -> 'minutes' = 'null'::jsonb then 'duration not recorded'
    when jsonb_typeof(${entry} -> 'minutes') in ('number','string') and ${minutes} ~ '^[0-9]{1,3}(\\.0+)?$' then
      case when (${minutes})::numeric between 0 and ${MAX_SECTION_MINUTES} then
        (${minutes})::numeric::integer::text || case when (${minutes})::numeric = 1 then ' minute' else ' minutes' end
      else 'duration unavailable' end
    else 'duration unavailable' end`;
  return sql`coalesce(${entry} ->> 'title', ${entry} ->> 'name', ${entry} ->> 'topic', 'Untitled agenda item') || ' (' || ${duration} || ')' || coalesce(': ' || (${entry} ->> 'description'), '')`;
}
