// Offline only. This module reads local JSON/schema and writes private review artifacts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
if (process.argv.includes("--help")) {
  console.log(
    "Offline only: node scripts/proofs/discovery-preview-294-fixture.mjs INPUT.json OUTPUT_DIR [CAPTURE.json]\nInput: {run,emailDomain,passwordHash,seatTokens:{associated,empty},seatTokenHashes?:{associated,empty}}. Root owns matching plaintext credentials; this tool does not connect, hash passwords or authenticate. Re-run into a NEW output directory with read-only capture JSON to prepare cleanup."
  );
  process.exit(0);
}
const [inputPath, outputDirectory, capturePath] = process.argv.slice(2);
assert.ok(
  inputPath && outputDirectory,
  "Usage: node scripts/proofs/discovery-preview-294-fixture.mjs INPUT.json OUTPUT_DIR [CAPTURE.json]"
);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
assert.match(input.run, /^[a-z0-9][a-z0-9-]{7,39}$/);
assert.match(input.emailDomain, /^[a-z0-9.-]+\.[a-z]{2,}$/);
assert.match(
  input.passwordHash,
  /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]{16,}={0,2}\$[A-Za-z0-9+/]{32,}={0,2}$/,
  "Supply the existing application-compatible Argon2id PHC hash, never plaintext"
);
assert.ok(input.passwordHash.length <= 255);

const run = input.run,
  prefix = `D294 ${run}`,
  q = (value) =>
    value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const id = (label) => {
  const h = createHash("sha256")
    .update(`discovery294:${run}:${label}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const named = (key, label) => ({ id: id(key), name: `${prefix} ${label}` });
const account = (key, label) => ({
  ...named(key, label),
  email: `d294+${run}.${key.toLowerCase()}@${input.emailDomain}`,
});
const accounts = Object.fromEntries(
  Object.entries({
    sendingOwner: "Sending owner",
    networkOwner: "Network owner",
    networkMember: "Network member",
    foreignOwner: "Foreign owner",
    lifecycle: "Lifecycle explorer",
    sever: "Sever explorer",
    transfer: "Transfer explorer",
    associatedSeat: "Associated seat explorer",
    emptySeat: "Empty seat explorer",
    plantOwner: "Fixture plant owner",
  }).map(([key, label]) => [key, account(key, label)])
);
const orgs = {
  network: named("network", "Network"),
  sendingChurch: named("sendingChurch", "Sending church"),
  foreignNetwork: named("foreignNetwork", "Foreign network"),
};
const church = named("church", "Coached plant");
const signup = [
  "church_to_sending_church",
  "church_to_network",
  "sending_church_to_network",
].map((type, index) => ({
  key: `signup${index + 1}`,
  name: `${prefix} Signup ${index + 1}`,
  email: `d294+${run}.signup${index + 1}@${input.emailDomain}`,
  invitationId: id(`signup-invitation-${index}`),
  type,
}));
const seat = Object.fromEntries(
  ["associated", "empty"].map((key) => {
    const token = input.seatTokens?.[key];
    assert.match(
      token,
      /^[a-f0-9]{64}$/i,
      "Provide root-owned random 32-byte hex seat tokens"
    );
    const tokenHash = createHash("sha256").update(token).digest("hex");
    if (input.seatTokenHashes?.[key])
      assert.equal(input.seatTokenHashes[key], tokenHash);
    return [key, { invitationId: id(`seat-${key}`), token, tokenHash }];
  })
);
assert.notEqual(
  seat.associated.token,
  seat.empty.token,
  "Use distinct seat tokens"
);
const wiki = {
  slug: "getting-started/welcome-to-the-launch-playbook",
  title: "Welcome to the Launch Playbook",
};
const invitations = {
  acceptNetwork: id("accept-network"),
  declineSending: id("decline-sending"),
  severNetwork: id("sever-network"),
  transferPending: id("transfer-pending"),
};
const manifest = {
  version: 1,
  run,
  accounts,
  orgs,
  church,
  signup,
  wiki,
  seat,
  invitations,
  transferPlantName: `${run} Transfer plant`,
  restrictions:
    "Root applies only to an approved dedicated preview target after migration77. No sessions are seeded. Successful signup and association responses/leave/sever send mail and remain blocked until an actual inert transport is established. Provider calls are not authorized; no approval flag bypasses this restriction.",
};
const sql = [
  "-- ROOT ONLY. Generated offline. Review manifest and target before applying. No session/auth bypass rows.",
  "BEGIN;",
  "SET LOCAL lock_timeout = '5s';",
  "SET LOCAL statement_timeout = '30s';",
  `DO $$ BEGIN IF to_regclass('public.discovery_profiles') IS NULL THEN RAISE EXCEPTION 'migration77 required'; END IF; END $$;`,
];
sql.push(
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM wiki_articles WHERE church_id IS NULL AND slug=${q(wiki.slug)} AND status='published') THEN RAISE EXCEPTION 'Required existing global wiki article is absent'; END IF; IF EXISTS(SELECT 1 FROM users WHERE email IN (${signup.map((x) => q(x.email)).join(",")})) THEN RAISE EXCEPTION 'Signup address already exists'; END IF; END $$;`
);
const insert = (table, values) =>
  sql.push(
    `INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.values(values).map(q).join(",")});`
  );
insert("sending_networks", orgs.network);
insert("sending_networks", orgs.foreignNetwork);
insert("sending_churches", orgs.sendingChurch);
insert("churches", {
  ...church,
  onboarding_completed_at: new Date().toISOString(),
});
for (const [key, a] of Object.entries(accounts)) {
  const tenancy =
    key === "sendingOwner"
      ? { seat: "owner", sending_church_id: orgs.sendingChurch.id }
      : key === "networkOwner"
        ? { seat: "owner", sending_network_id: orgs.network.id }
        : key === "networkMember"
          ? { seat: "member", sending_network_id: orgs.network.id }
          : key === "foreignOwner"
            ? { seat: "owner", sending_network_id: orgs.foreignNetwork.id }
            : key === "plantOwner"
              ? { seat: "owner", church_id: church.id }
              : {};
  insert("users", { ...a, password_hash: input.passwordHash, ...tenancy });
}
for (const key of [
  "lifecycle",
  "sever",
  "transfer",
  "associatedSeat",
  "emptySeat",
]) {
  const p = { user_id: accounts[key].id };
  if (["sever", "transfer", "associatedSeat"].includes(key))
    p.sending_network_id = orgs.network.id;
  if (key === "transfer") p.sending_church_id = orgs.sendingChurch.id;
  insert("discovery_profiles", p);
  for (const [column, type] of [
    ["sending_network_id", "network"],
    ["sending_church_id", "sending_church"],
  ])
    if (p[column])
      insert("association_events", {
        id: id(`initial-audit-${key}-${type}`),
        subject_type: "discovery",
        discovery_user_id: p.user_id,
        org_type: type,
        org_id: p[column],
        event: "associated",
        actor_user_id: p.user_id,
      });
}
const expiry = new Date(Date.now() + 7 * 86400000).toISOString();
for (const entry of signup) {
  const sending = entry.type === "church_to_sending_church";
  insert("organization_invitations", {
    id: entry.invitationId,
    type: entry.type,
    inviter_user_id: sending
      ? accounts.sendingOwner.id
      : accounts.networkOwner.id,
    invitee_email: entry.email,
    ...(sending
      ? { sending_church_id: orgs.sendingChurch.id }
      : { sending_network_id: orgs.network.id }),
    expires_at: expiry,
  });
}
for (const [key, subject, type, org, owner] of [
  [
    "acceptNetwork",
    "lifecycle",
    "discovery_to_network",
    orgs.network,
    accounts.networkOwner,
  ],
  [
    "declineSending",
    "lifecycle",
    "discovery_to_sending_church",
    orgs.sendingChurch,
    accounts.sendingOwner,
  ],
  [
    "transferPending",
    "transfer",
    "discovery_to_network",
    orgs.foreignNetwork,
    accounts.foreignOwner,
  ],
])
  insert("organization_invitations", {
    id: invitations[key],
    type,
    inviter_user_id: owner.id,
    invitee_email: accounts[subject].email,
    target_user_id: accounts[subject].id,
    ...(type === "discovery_to_network"
      ? { sending_network_id: org.id }
      : { sending_church_id: org.id }),
    expires_at: expiry,
  });
insert("organization_invitations", {
  id: invitations.severNetwork,
  type: "discovery_to_network",
  inviter_user_id: accounts.networkOwner.id,
  invitee_email: accounts.sever.email,
  target_user_id: accounts.sever.id,
  sending_network_id: orgs.network.id,
  status: "accepted",
  responded_by: accounts.sever.id,
  responded_at: new Date().toISOString(),
  expires_at: expiry,
});
for (const key of ["associated", "empty"])
  insert("user_invitations", {
    id: seat[key].invitationId,
    kind: "seat",
    seat: "member",
    invitee_email:
      accounts[key === "associated" ? "associatedSeat" : "emptySeat"].email,
    church_id: church.id,
    token_hash: seat[key].tokenHash,
    inviter_user_id: accounts.plantOwner.id,
    expires_at: expiry,
  });

for (const key of ["transfer", "associatedSeat", "emptySeat"]) {
  insert("wiki_progress", {
    id: id(`wiki-progress-${key}`),
    user_id: accounts[key].id,
    article_slug: wiki.slug,
    status: "completed",
    scroll_position: 0.75,
    completed_at: new Date().toISOString(),
  });
  insert("wiki_bookmarks", {
    id: id(`wiki-bookmark-${key}`),
    user_id: accounts[key].id,
    article_slug: wiki.slug,
  });
}
insert("coach_assignments", {
  id: id("coach-transfer"),
  coach_user_id: accounts.transfer.id,
  church_id: church.id,
  status: "active",
});
sql.push("COMMIT;");
const captureSql = `-- READ ONLY. Root runs after browser stops. Save its one JSON value as capture.json.\nSELECT jsonb_build_object('run',${q(run)},'signupUsers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'email',email,'name',name)) FROM users WHERE email IN (${signup.map((x) => q(x.email)).join(",")})),'[]'::jsonb),'createdPlants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'plantedBy',u.id,'name',c.name)) FROM users u JOIN churches c ON c.id=u.church_id WHERE u.id=${q(accounts.transfer.id)}::uuid AND c.name=${q(manifest.transferPlantName)}),'[]'::jsonb));\n`;
const captured = capturePath
  ? JSON.parse(readFileSync(capturePath, "utf8"))
  : { run, signupUsers: [], createdPlants: [] };
assert.equal(captured.run, run);
for (const u of captured.signupUsers) {
  assert.match(u.id, /^[a-f0-9-]{36}$/i);
  assert.ok(
    signup.some((x) => x.email === u.email && x.name === u.name),
    "Unknown signup capture"
  );
}
for (const c of captured.createdPlants) {
  assert.match(c.id, /^[a-f0-9-]{36}$/i);
  assert.equal(c.plantedBy, accounts.transfer.id);
  assert.equal(c.name, manifest.transferPlantName);
}
const cleanupRoots = [
  ...Object.values(accounts).map((x) => ({
    table: "users",
    id: x.id,
    name: x.name,
    email: x.email,
  })),
  ...captured.signupUsers.map((x) => ({ table: "users", ...x })),
  ...Object.entries(orgs).map(([key, x]) => ({
    table: key === "sendingChurch" ? "sending_churches" : "sending_networks",
    ...x,
  })),
  { table: "churches", ...church },
  ...captured.createdPlants.map((x) => ({
    table: "churches",
    id: x.id,
    name: x.name,
  })),
];
const cleanup = `-- ROOT ONLY: stop the browser first. Serializable, bounded, fail-closed owned-ID cleanup.\n-- Re-generate with capture.json after signup/transfer; uncaptured roots abort the transaction.\nBEGIN;\nSET TRANSACTION ISOLATION LEVEL SERIALIZABLE;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\nCREATE TEMP TABLE d294_roots(table_name text,id text,expected jsonb,PRIMARY KEY(table_name,id)) ON COMMIT DROP;\nINSERT INTO d294_roots SELECT x->>'table',x->>'id',x-'table' FROM jsonb_array_elements(${q(JSON.stringify(cleanupRoots))}::jsonb) x;\nCREATE TEMP TABLE d294_rows(table_oid oid,row_data jsonb,PRIMARY KEY(table_oid,row_data)) ON COMMIT DROP;\nDO $cleanup$\nDECLARE r record; changed int; total int; pk text; predicate text; source_value jsonb; remaining int; removed int;\nBEGIN\n  -- Every root is exact-ID + namespace identity checked. No email-prefix deletes.\n  FOR r IN SELECT * FROM d294_roots LOOP\n    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id::text=$1 FOR UPDATE',r.table_name) INTO source_value USING r.id;\n    IF source_value IS NOT NULL THEN\n      IF NOT source_value @> r.expected THEN RAISE EXCEPTION 'Root identity mismatch: % %',r.table_name,r.id; END IF;\n      INSERT INTO d294_rows VALUES (to_regclass('public.'||r.table_name),source_value) ON CONFLICT DO NOTHING;\n    END IF;\n  END LOOP;\n  -- Follow actual FKs only. Stop if a browser-created/foreign root was not explicitly captured.\n  FOR total IN 1..40 LOOP\n    changed:=0;\n    FOR r IN SELECT c.*,cl.relname AS child FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE c.contype='f' AND ns.nspname='public' LOOP\n      SELECT string_agg(format('to_jsonb(t)->>%L IS NOT NULL AND to_jsonb(t)->%L = p.row_data->%L',a.attname,a.attname,b.attname),' AND ') INTO predicate FROM unnest(r.conkey,r.confkey) k(ck,pk) JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=k.ck JOIN pg_attribute b ON b.attrelid=r.confrelid AND b.attnum=k.pk;\n      EXECUTE format('INSERT INTO d294_rows SELECT %s,to_jsonb(t) FROM public.%I t WHERE EXISTS(SELECT 1 FROM d294_rows p WHERE p.table_oid=%s AND %s) ON CONFLICT DO NOTHING',r.conrelid,r.child,r.confrelid,predicate);\n      GET DIAGNOSTICS removed=ROW_COUNT; changed:=changed+removed;\n    END LOOP;\n    IF (SELECT count(*) FROM d294_rows)>5000 THEN RAISE EXCEPTION 'Cleanup exceeds fixture bound'; END IF;\n    EXIT WHEN changed=0;\n    IF total=40 THEN RAISE EXCEPTION 'Cleanup dependency depth exceeds bound'; END IF;\n  END LOOP;\n  IF EXISTS(SELECT 1 FROM d294_rows d JOIN pg_class c ON c.oid=d.table_oid WHERE c.relname IN ('users','churches','sending_churches','sending_networks','wiki_articles') AND NOT EXISTS(SELECT 1 FROM d294_roots r WHERE r.table_name=c.relname AND r.id=d.row_data->>'id')) THEN RAISE EXCEPTION 'Uncaptured or foreign root dependency; capture exact IDs before cleanup'; END IF;\n  IF EXISTS(SELECT 1 FROM d294_rows d WHERE d.row_data->>'church_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM d294_roots r WHERE r.table_name='churches' AND r.id=d.row_data->>'church_id')) THEN RAISE EXCEPTION 'Foreign tenant dependency'; END IF;\n  -- Break nullable cycles only inside selected owned rows (e.g. users/churches/persons).\n  FOR r IN SELECT c.*,cl.relname AS child FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE c.contype='f' AND ns.nspname='public' AND cardinality(c.conkey)=1 LOOP\n    SELECT quote_ident(attname) INTO pk FROM pg_attribute WHERE attrelid=r.conrelid AND attnum=r.conkey[1] AND NOT attnotnull;\n    IF pk IS NOT NULL THEN\n      -- Only known user tenancy cycle needs breaking; other tables delete child-first below.\n      IF r.child='users' AND pk IN ('church_id','sending_church_id','sending_network_id') THEN\n        EXECUTE format('UPDATE public.users t SET %s=null,seat=null WHERE EXISTS(SELECT 1 FROM d294_roots z WHERE z.table_name=''users'' AND z.id=t.id::text)',pk);\n      END IF;\n    END IF;\n  END LOOP;\n  -- FK errors defer a table until its owned dependants are gone; unexpected references roll everything back.\n  FOR total IN 1..40 LOOP\n    changed:=0;\n    FOR r IN SELECT DISTINCT d.table_oid,c.relname FROM d294_rows d JOIN pg_class c ON c.oid=d.table_oid LOOP\n      SELECT string_agg(format('to_jsonb(t)->%L = selected.row_data->%L',a.attname,a.attname),' AND ') INTO predicate FROM pg_constraint p CROSS JOIN LATERAL unnest(p.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=p.conrelid AND a.attnum=k.attnum WHERE p.conrelid=r.table_oid AND p.contype='p';\n      IF predicate IS NULL THEN RAISE EXCEPTION 'Unsupported table without primary key: %',r.relname; END IF;\n      BEGIN\n        EXECUTE format('DELETE FROM public.%I t WHERE EXISTS(SELECT 1 FROM d294_rows selected WHERE selected.table_oid=%s AND %s)',r.relname,r.table_oid,predicate);\n        GET DIAGNOSTICS removed=ROW_COUNT; changed:=changed+removed;\n        DELETE FROM d294_rows WHERE table_oid=r.table_oid;\n      EXCEPTION WHEN foreign_key_violation THEN NULL; END;\n    END LOOP;\n    SELECT count(*) INTO remaining FROM d294_rows;\n    EXIT WHEN remaining=0;\n    IF changed=0 OR total=40 THEN RAISE EXCEPTION 'Remaining FK dependency; cleanup rolled back (% rows)',remaining; END IF;\n  END LOOP;\nEND $cleanup$;\nDELETE FROM auth_attempts WHERE identifier IN (${[...Object.values(accounts).map((x) => x.email), ...signup.map((x) => x.email)].map(q).join(",")});\nCOMMIT;\n`;
const oracle = `-- ROOT READ ONLY. Compare before/after-safe actions. Never prints password hashes or session tokens.\nSELECT u.id,u.email,u.seat,u.church_id,u.sending_church_id,u.sending_network_id,p.user_id IS NOT NULL AS discovery,p.sending_church_id AS associated_sending_church,p.sending_network_id AS associated_network FROM users u LEFT JOIN discovery_profiles p ON p.user_id=u.id WHERE u.id IN (${Object.values(
  accounts
)
  .map((x) => q(x.id))
  .join(
    ","
  )}) ORDER BY u.email;\nSELECT user_id,article_slug,status,scroll_position,completed_at FROM wiki_progress WHERE user_id IN (${["transfer", "associatedSeat", "emptySeat"].map((k) => q(accounts[k].id)).join(",")});\nSELECT user_id,article_slug FROM wiki_bookmarks WHERE user_id IN (${["transfer", "associatedSeat", "emptySeat"].map((k) => q(accounts[k].id)).join(",")});\nSELECT id,status,responded_by,church_id FROM user_invitations WHERE id IN (${Object.values(
  seat
)
  .map((x) => q(x.invitationId))
  .join(
    ","
  )});\nSELECT coach_user_id,church_id,status FROM coach_assignments WHERE coach_user_id=${q(accounts.transfer.id)};\n-- Before: transfer profile both orgs, emptySeat/associatedSeat profiles; all seat tokens pending.\n-- After safe transfer: transfer owns exactly one ${manifest.transferPlantName}, profile absent, both church association IDs preserved, coaching/wiki rows unchanged.\n-- After associated seat refusal: token pending and profile association unchanged. After empty seat accept: profile absent, member in fixture church; wiki rows unchanged.\n`;
const assertion = (condition, message) =>
  `DO $$ BEGIN IF (${condition}) IS NOT TRUE THEN RAISE EXCEPTION ${q(message)}; END IF; END $$;`;
const u = (key) => `${q(accounts[key].id)}::uuid`;
const wikiChecks = ["transfer", "associatedSeat", "emptySeat"].flatMap(
  (key) => [
    assertion(
      `(SELECT count(*) FROM wiki_progress WHERE user_id=${u(key)} AND article_slug=${q(wiki.slug)} AND status='completed' AND scroll_position=0.75 AND completed_at IS NOT NULL)=1`,
      `${key}: completed wiki row preserved`
    ),
    assertion(
      `(SELECT count(*) FROM wiki_bookmarks WHERE user_id=${u(key)} AND article_slug=${q(wiki.slug)})=1`,
      `${key}: bookmark preserved`
    ),
  ]
);
const baselineOracle =
  [
    "-- ROOT READ ONLY. Every failed expectation raises; apply immediately after fixture SQL.",
    assertion(
      `(SELECT count(*) FROM discovery_profiles p JOIN users u ON u.id=p.user_id WHERE u.id IN (${["lifecycle", "sever", "transfer", "associatedSeat", "emptySeat"].map(u).join(",")}) AND u.seat IS NULL AND u.church_id IS NULL AND u.sending_church_id IS NULL AND u.sending_network_id IS NULL)=5`,
      "baseline: five explicit discovery profiles with no tenancy"
    ),
    assertion(
      `EXISTS(SELECT 1 FROM discovery_profiles WHERE user_id=${u("transfer")} AND sending_church_id=${q(orgs.sendingChurch.id)}::uuid AND sending_network_id=${q(orgs.network.id)}::uuid)`,
      "baseline: both transfer associations"
    ),
    assertion(
      `(SELECT count(*) FROM user_invitations WHERE id IN (${Object.values(seat)
        .map((x) => q(x.invitationId))
        .join(",")}) AND status='pending')=2`,
      "baseline: both seat invitations pending"
    ),
    assertion(
      `(SELECT count(*) FROM organization_invitations WHERE id IN (${signup.map((x) => q(x.invitationId)).join(",")}) AND target_user_id IS NULL AND target_church_id IS NULL AND target_sending_church_id IS NULL AND status='pending')=3`,
      "baseline: three signup invitation types are open"
    ),
    ...wikiChecks,
  ].join("\n") + "\n";
const plantScope = `SELECT church_id FROM users WHERE id=${u("transfer")} AND seat='owner' AND sending_church_id IS NULL AND sending_network_id IS NULL`;
const postSafeOracle =
  [
    "-- ROOT READ ONLY. Run after transfer (sharing consent ON), associated-seat refusal, empty-seat acceptance; provider-emitting association actions remain unrun.",
    assertion(
      `(SELECT count(*) FROM churches WHERE id IN (${plantScope}) AND name=${q(manifest.transferPlantName)} AND sending_church_id=${q(orgs.sendingChurch.id)}::uuid AND sending_network_id=${q(orgs.network.id)}::uuid)=1`,
      "transfer: one owned plant with both associations"
    ),
    assertion(
      `NOT EXISTS(SELECT 1 FROM discovery_profiles WHERE user_id=${u("transfer")})`,
      "transfer: discovery profile retired"
    ),
    assertion(
      `(SELECT count(*) FROM church_privacy_settings WHERE church_id IN (${plantScope}) AND ${["share_people", "share_meetings", "share_tasks", "share_financials", "share_ministry_teams", "share_facilities", "share_wiki", "share_activity_with_oversight"].join(" AND ")})=1`,
      "transfer: all eight consent toggles ON"
    ),
    assertion(
      `(SELECT count(*) FROM persons WHERE church_id IN (${plantScope}) AND user_id=${u("transfer")})=1`,
      "transfer: exactly one canonical person link"
    ),
    assertion(
      `(SELECT count(*) FROM association_events WHERE actor_user_id=${u("transfer")} AND ((subject_type='discovery' AND discovery_user_id=${u("transfer")} AND event='disassociated') OR (subject_type='church' AND church_id IN (${plantScope}) AND event='associated')))=4`,
      "transfer: exactly four handoff audit rows"
    ),
    assertion(
      `EXISTS(SELECT 1 FROM organization_invitations WHERE id=${q(invitations.transferPending)}::uuid AND target_user_id IS NULL AND target_church_id IN (${plantScope}) AND type='church_to_network' AND status='pending' AND sending_network_id=${q(orgs.foreignNetwork.id)}::uuid)`,
      "transfer: pending invitation follows plant"
    ),
    assertion(
      `EXISTS(SELECT 1 FROM coach_assignments WHERE coach_user_id=${u("transfer")} AND church_id=${q(church.id)}::uuid AND status='active')`,
      "transfer: coaching assignment retained"
    ),
    assertion(
      `EXISTS(SELECT 1 FROM user_invitations WHERE id=${q(seat.associated.invitationId)}::uuid AND status='pending' AND responded_by IS NULL) AND EXISTS(SELECT 1 FROM discovery_profiles p JOIN users u ON u.id=p.user_id WHERE u.id=${u("associatedSeat")} AND u.seat IS NULL AND u.church_id IS NULL AND p.sending_network_id=${q(orgs.network.id)}::uuid)`,
      "associated seat refusal: invitation and profile unchanged"
    ),
    assertion(
      `EXISTS(SELECT 1 FROM user_invitations WHERE id=${q(seat.empty.invitationId)}::uuid AND status='accepted' AND responded_by=${u("emptySeat")}) AND EXISTS(SELECT 1 FROM users WHERE id=${u("emptySeat")} AND seat='member' AND church_id=${q(church.id)}::uuid AND sending_church_id IS NULL AND sending_network_id IS NULL) AND NOT EXISTS(SELECT 1 FROM discovery_profiles WHERE user_id=${u("emptySeat")})`,
      "empty seat: accepted once and profile retired"
    ),
    assertion(
      `(SELECT count(*) FROM persons WHERE user_id=${u("emptySeat")} AND church_id=${q(church.id)}::uuid)=1`,
      "empty seat: one canonical person link"
    ),
    ...wikiChecks,
  ].join("\n") + "\n";
mkdirSync(resolve(outputDirectory), { recursive: true, mode: 0o700 });
for (const [name, contents] of Object.entries({
  "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  "fixture.sql": sql.join("\n") + "\n",
  "capture.sql": captureSql,
  "cleanup.sql": cleanup,
  "oracle.sql": oracle,
  "baseline-oracle.sql": baselineOracle,
  "post-safe-oracle.sql": postSafeOracle,
}))
  writeFileSync(join(resolve(outputDirectory), name), contents, {
    mode: 0o600,
    flag: "wx",
  });
console.log(
  `Prepared 7 private offline artifacts for ${run}; no database, authentication or provider calls.`
);
