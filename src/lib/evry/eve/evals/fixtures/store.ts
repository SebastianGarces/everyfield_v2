import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FixtureManifest } from "./manifest";

/** Only the dedicated disposable container is addressable. No shared DATABASE_URL fallback. */
export function createFixtureStore(container: string) {
  if (!/^evry-eve-fixture-[a-f0-9]{12}-pg$/.test(container))
    throw new Error("A dedicated Eve fixture container is required");
  const sql = (statement: string) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "eve_fixture",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atq",
      ],
      { input: statement, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
    ).trim();
  const query = (statement: string) =>
    z
      .array(z.record(z.string(), z.unknown()))
      .parse(
        JSON.parse(
          sql(`select coalesce(json_agg(x), '[]'::json) from (${statement}) x;`)
        )
      );
  return {
    sql,
    query,
    /** Discover all foreign rows after scenario seeding, not just the base manifest. */
    foreignRecordIds(m: FixtureManifest) {
      const plant = z.uuid().parse(m.ids["foreign-plant"]);
      const selects =
        query(`select format('select id::text as id from %I.%I where church_id = %L::uuid', c.table_schema, c.table_name, '${plant}') as statement
        from information_schema.columns c
        where c.table_schema='public' and c.column_name='church_id' and c.udt_name='uuid'
        and exists (select 1 from information_schema.columns i where i.table_schema=c.table_schema and i.table_name=c.table_name and i.column_name='id' and i.udt_name='uuid')`).map(
          (row) => z.string().parse(row.statement)
        );
      return [
        plant,
        ...query(selects.join(" union ")).map((row) => z.uuid().parse(row.id)),
      ].sort();
    },
    seed(m: FixtureManifest) {
      const i = m.ids;
      const task = (
        symbol: keyof typeof i,
        due: string | null,
        status = "not_started",
        actor = i.actor,
        plant = i.plant
      ) =>
        `('${i[symbol]}','${plant}','${symbol}','${status}','high',${due ? `'${due}'` : "null"},'${actor}','${actor}')`;
      sql(`begin;
        insert into churches(id,name,time_zone) values ('${i.plant}','Eve fixture','America/New_York'),('${i["foreign-plant"]}','Foreign fixture','UTC');
        insert into users(id,email,password_hash,name,seat,church_id) values
        ('${i.actor}','${i.actor}@example.test','unusable-fixture-password','Fixture Owner','owner','${i.plant}'),
        ('${i["other-actor"]}','${i["other-actor"]}@example.test','unusable-fixture-password','Other Member','member','${i.plant}'),
        ('${i["foreign-actor"]}','${i["foreign-actor"]}@example.test','unusable-fixture-password','Foreign Owner','owner','${i["foreign-plant"]}');
        insert into sessions(id,user_id,expires_at) values ('${m.sessionId}','${i.actor}',now()+interval '60 days');
        insert into tasks(id,church_id,title,status,priority,due_date,assigned_to_id,created_by_id) values
        ${[task("task-today", "2026-09-20"), task("task-overdue", "2026-09-19"), task("task-tomorrow", "2026-09-21"), task("task-complete", "2026-09-20", "complete"), task("task-undated", null), task("task-other-actor", "2026-09-20", "not_started", i["other-actor"]), task("task-foreign", "2026-09-20", "not_started", i["foreign-actor"], i["foreign-plant"])].join(",")};
        insert into persons(id,church_id,first_name,last_name,email,status,created_by) values
        ${[
          "prospect-followed",
          "prospect-new",
          "prospect-interviewed",
          "prospect-attended",
          "prospect-rsvp-only",
          "core-alex",
          "core-jordan",
          "person-foreign",
        ]
          .map((symbol) => {
            const id = i[symbol as keyof typeof i];
            const foreign = symbol === "person-foreign";
            const status = symbol.startsWith("core-")
              ? "core_group"
              : ["prospect-attended", "prospect-rsvp-only"].includes(symbol)
                ? "attendee"
                : "prospect";
            return `('${id}','${foreign ? i["foreign-plant"] : i.plant}','${symbol}','Fixture','${id}@example.test','${status}','${foreign ? i["foreign-actor"] : i.actor}')`;
          })
          .join(",")};
        insert into tasks(church_id,title,category,status,related_type,related_id,created_by_id) values
        ('${i.plant}','Follow-up completed','follow_up','complete','person','${i["prospect-followed"]}','${i.actor}'),
        ('${i.plant}','Follow-up completed','follow_up','complete','person','${i["prospect-interviewed"]}','${i.actor}');
        insert into interviews(church_id,person_id,interviewed_by,interview_date,maturity_status,gifted_status,chemistry_status,right_reasons_status,season_status,overall_result)
        select '${i.plant}','${i["prospect-interviewed"]}','${i.actor}','2026-09-10','pass','pass','pass','pass','pass','qualified' from generate_series(1,2);
        insert into locations(id,church_id,name,address) values ('${i["church-location"]}','${i.plant}','Church','123 A St., North Ridgeville, OH 44039');
        insert into message_templates(id,church_id,name,category,subject,body,merge_fields) values ('${i["orientation-template"]}','${i.plant}','Orientation Invitation','meeting_invitation','Join us for {{meeting_title}}','Hi {{first_name}}, join us on {{meeting_date}} at {{meeting_location}}.','["first_name","meeting_title","meeting_date","meeting_location"]');
        insert into church_meetings(id,church_id,type,title,datetime,created_by) values
        ('${i["meeting-one"]}','${i.plant}','vision_meeting','Vision One','2026-09-01 14:00','${i.actor}'),
        ('${i["meeting-two"]}','${i.plant}','orientation','Orientation Two','2026-09-10 14:00','${i.actor}'),
        ('${i["meeting-upcoming"]}','${i.plant}','orientation','Next orientation','2026-09-27 14:00','${i.actor}');
        insert into meeting_attendance(church_id,meeting_id,person_id,status,response_status) values
        ('${i.plant}','${i["meeting-one"]}','${i["prospect-attended"]}','attended','confirmed'),
        ('${i.plant}','${i["meeting-two"]}','${i["prospect-attended"]}','attended','confirmed'),
        ('${i.plant}','${i["meeting-one"]}','${i["prospect-rsvp-only"]}','absent','confirmed'),
        ('${i.plant}','${i["meeting-two"]}','${i["prospect-rsvp-only"]}','absent','confirmed');
        insert into launches(id,church_id,target_date,status) values ('${i.launch}','${i.plant}','2026-10-11','scheduled');
        insert into launch_milestones(id,launch_id,church_id,template_key,area,title,completed_at) values
        ('${i["milestone-open"]}','${i.launch}','${i.plant}','operations.fixture_open','operations','Secure equipment',null),
        ('${i["milestone-complete"]}','${i.launch}','${i.plant}','operations.fixture_done','operations','Secure venue','2026-09-10');
        insert into ministry_teams(id,church_id,name,created_by) values ('${i.ministry}','${i.plant}','Hospitality','${i.actor}');
        insert into team_roles(id,church_id,team_id,name,status,created_by) values ('${i["open-role"]}','${i.plant}','${i.ministry}','Welcome lead','open','${i.actor}');
        ${m.caseId === "regression-followup-priority" ? `insert into tasks(id,church_id,title,status,priority,due_date,assigned_to_id,created_by_id) values ('${i["task-today-medium"]}','${i.plant}','Today medium priority','not_started','medium','2026-09-20','${i.actor}','${i.actor}');` : ""}
        commit;`);
    },
    /** Ground truth uses small independent relational queries, never the tool result or answer. */
    truth(m: FixtureManifest) {
      const p = m.ids.plant;
      const ids = (statement: string) =>
        query(statement)
          .map((row) => z.string().parse(row.id))
          .sort();
      return {
        taskIds: ids(
          `select id from tasks where church_id='${p}' and assigned_to_id='${m.ids.actor}' and due_date='2026-09-20' and status <> 'complete' and deleted_at is null`
        ),
        highPriorityTaskIds: ids(
          `select id from tasks where church_id='${p}' and assigned_to_id='${m.ids.actor}' and due_date='2026-09-20' and status <> 'complete' and priority='high' and deleted_at is null`
        ),
        followed: ids(
          `select p.id from persons p where p.church_id='${p}' and p.status='prospect' and p.deleted_at is null and exists(select 1 from tasks t where t.church_id=p.church_id and t.related_type='person' and t.related_id=p.id and t.category='follow_up' and t.status='complete' and t.deleted_at is null) and not exists(select 1 from interviews x where x.church_id=p.church_id and x.person_id=p.id)`
        ),
        notFollowed: ids(
          `select p.id from persons p where p.church_id='${p}' and p.status='prospect' and p.deleted_at is null and not exists(select 1 from tasks t where t.church_id=p.church_id and t.related_type='person' and t.related_id=p.id and t.category='follow_up' and t.status='complete' and t.deleted_at is null)`
        ),
        attended: ids(
          `select p.id from persons p where p.church_id='${p}' and (select count(distinct a.meeting_id) from meeting_attendance a where a.church_id=p.church_id and a.person_id=p.id and a.status='attended') >= 2 and not exists(select 1 from interviews x where x.church_id=p.church_id and x.person_id=p.id)`
        ),
        core: ids(
          `select id from persons where church_id='${p}' and status='core_group' and deleted_at is null`
        ),
        launch: query(
          `select target_date::text, (select count(*)::int from launch_milestones where church_id='${p}' and completed_at is null) open_milestones, (select count(*)::int from team_roles r join ministry_teams t on t.id=r.team_id and t.church_id='${p}' where r.church_id='${p}' and not exists(select 1 from team_memberships s join persons person on person.id=s.person_id and person.church_id='${p}' and person.deleted_at is null where s.church_id='${p}' and s.team_id=r.team_id and s.role_id=r.id and s.status='active')) open_roles from launches where church_id='${p}'`
        )[0],
        openRoleTeams: query(
          `select r.team_id::text as team_id, count(*)::int as amount from team_roles r join ministry_teams t on t.id=r.team_id and t.church_id='${p}' where r.church_id='${p}' and not exists(select 1 from team_memberships s join persons person on person.id=s.person_id and person.church_id='${p}' and person.deleted_at is null where s.church_id='${p}' and s.team_id=r.team_id and s.role_id=r.id and s.status='active') group by r.team_id`
        )
          .map(
            (row) =>
              `${z.uuid().parse(row.team_id)}:${z.number().int().positive().parse(row.amount)}`
          )
          .sort(),
      };
    },
    auditStart() {
      sql(`set client_min_messages=warning; create schema if not exists eve_eval;
        create table if not exists eve_eval.writes(id bigserial, table_name text not null, church_id text, operation text not null);
        create or replace function eve_eval.audit_write() returns trigger language plpgsql as $$ begin
          insert into eve_eval.writes(table_name,church_id,operation) values (TG_TABLE_NAME,coalesce(to_jsonb(new)->>'church_id',to_jsonb(old)->>'church_id'),TG_OP); return null;
        end $$;
        do $$ declare r record; begin for r in select table_name from information_schema.columns where table_schema='public' and column_name='church_id' and table_name not like 'evry_%' loop
          execute format('drop trigger if exists eve_eval_audit on %I',r.table_name);
          execute format('create trigger eve_eval_audit after insert or update or delete on %I for each row execute function eve_eval.audit_write()',r.table_name);
        end loop; end $$;`);
      return Number(sql("select coalesce(max(id),0) from eve_eval.writes"));
    },
    writesSince(after: number, m: FixtureManifest) {
      return query(
        `select table_name,operation,church_id from eve_eval.writes where id>${after} and church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
      );
    },
    revoke(m: FixtureManifest) {
      sql(`delete from sessions where id='${m.sessionId}'`);
    },
    digestRows(m: FixtureManifest) {
      return createHash("sha256")
        .update(JSON.stringify(this.truth(m)))
        .digest("hex");
    },
  };
}
export type FixtureStore = ReturnType<typeof createFixtureStore>;
