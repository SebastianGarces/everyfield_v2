import Link from "next/link";
import { RichText } from "@/components/shared/rich-text";
import type { CoachedRecord } from "@/lib/coaching/record-read";
import { formatDate, formatDateTime } from "@/lib/datetime";

const words = (value: string | null) => value?.replaceAll("_", " ") ?? null;
function Fields({ rows }: { rows: [string, string | number | null][] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd className="mt-1 break-words whitespace-pre-wrap">
            {value === null || value === "" ? "Not recorded" : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Section({
  title,
  empty,
  children,
  hasRows,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
  hasRows: boolean;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hasRows ? (
        <ul className="space-y-3">{children}</ul>
      ) : (
        <p className="text-muted-foreground text-sm">{empty}</p>
      )}
    </section>
  );
}
export function recordTitle(record: CoachedRecord): string {
  switch (record.kind) {
    case "people":
      return `${record.person.firstName} ${record.person.lastName}`;
    case "tasks":
      return record.task.title;
    case "meetings":
      return record.meeting.title || `${words(record.meeting.type)} meeting`;
    case "teams":
      return record.team.name;
  }
}
export function RecordContent({ record }: { record: CoachedRecord }) {
  const personHref = (id: string) =>
    `/coaching/${record.plant.churchId}/people/${id}`;
  switch (record.kind) {
    case "people": {
      const p = record.person;
      return (
        <>
          <Fields
            rows={[
              ["Status", words(p.status)],
              ["Email", p.email],
              ["Phone", p.phone],
              [
                "Address",
                [
                  p.addressLine1,
                  p.addressLine2,
                  p.city,
                  p.state,
                  p.postalCode,
                  p.country,
                ]
                  .filter(Boolean)
                  .join(", "),
              ],
              ["Source", words(p.source)],
              ["Source details", p.sourceDetails],
              ["Household", p.householdName],
              ["Household role", words(p.householdRole)],
              ["Background check", words(p.backgroundCheckStatus)],
              ["Notes", p.notes],
            ]}
          />
          <Section
            title="Tags"
            empty="No tags recorded."
            hasRows={record.tags.length > 0}
          >
            {record.tags.map((tag) => (
              <li key={tag.id}>{tag.name}</li>
            ))}
          </Section>
          <Section
            title="Skills"
            empty="No skills recorded."
            hasRows={record.skills.length > 0}
          >
            {record.skills.map((skill) => (
              <li key={skill.id}>
                <p>
                  {skill.name} · {words(skill.proficiency)}
                </p>
                {skill.notes && (
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                    {skill.notes}
                  </p>
                )}
              </li>
            ))}
          </Section>
        </>
      );
    }
    case "tasks": {
      const t = record.task;
      return (
        <>
          <Fields
            rows={[
              ["Status", words(t.status)],
              ["Priority", words(t.priority)],
              [
                "Due date",
                t.dueDate
                  ? formatDate(new Date(`${t.dueDate}T00:00:00Z`), "long")
                  : null,
              ],
              ["Due time", t.dueTime],
              ["Category", words(t.category)],
            ]}
          />
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Description</h2>
            <RichText body={t.description} />
          </section>
          <Section
            title="Steps"
            empty="No steps recorded."
            hasRows={record.steps.length > 0}
          >
            {record.steps.map((step) => (
              <li key={step.id}>
                <p>
                  {step.title} · {words(step.status)}
                </p>
                {step.description && <RichText body={step.description} />}
              </li>
            ))}
          </Section>
        </>
      );
    }
    case "meetings": {
      const m = record.meeting;
      return (
        <>
          <Fields
            rows={[
              ["Type", words(m.type)],
              ["Status", words(m.status)],
              ["Schedule", formatDateTime(m.datetime)],
              [
                "Duration",
                m.durationMinutes === null
                  ? null
                  : `${m.durationMinutes} minutes`,
              ],
              ["Location", m.locationName],
              ["Address", m.locationAddress],
              ["Expected attendance", m.estimatedAttendance],
              ["Recorded attendance", m.actualAttendance],
              ["Notes", m.notes],
              ["Evaluation score", record.evaluation?.totalScore ?? null],
              ["Evaluation notes", record.evaluation?.notes ?? null],
            ]}
          />
          <Section
            title="Attendance"
            empty="No attendance recorded."
            hasRows={record.attendance.length > 0}
          >
            {record.attendance.map((attendee) => (
              <li key={attendee.id}>
                <Link
                  className="underline underline-offset-4"
                  href={personHref(attendee.personId)}
                >
                  {attendee.firstName} {attendee.lastName}
                </Link>
                <p className="text-muted-foreground text-sm">
                  {words(attendee.status)}
                  {attendee.response ? ` · ${words(attendee.response)}` : ""}
                </p>
                {attendee.notes && (
                  <p className="text-sm whitespace-pre-wrap">
                    {attendee.notes}
                  </p>
                )}
              </li>
            ))}
          </Section>
        </>
      );
    }
    case "teams": {
      return (
        <>
          <Fields
            rows={[
              ["Status", words(record.team.status)],
              ["Description", record.team.description],
            ]}
          />
          <Section
            title="Roles"
            empty="No roles recorded."
            hasRows={record.roles.length > 0}
          >
            {record.roles.map((role) => (
              <li key={role.id}>
                <p>
                  {role.name} · {words(role.status)}
                </p>
                {role.description && (
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                    {role.description}
                  </p>
                )}
              </li>
            ))}
          </Section>
          <Section
            title="Roster"
            empty="No team members recorded."
            hasRows={record.roster.length > 0}
          >
            {record.roster.map((member) => (
              <li key={member.id}>
                <Link
                  className="underline underline-offset-4"
                  href={personHref(member.personId)}
                >
                  {member.firstName} {member.lastName}
                </Link>
                <p className="text-muted-foreground text-sm">
                  {member.role ?? "No role assigned"} · {words(member.status)}
                </p>
              </li>
            ))}
          </Section>
        </>
      );
    }
  }
}
