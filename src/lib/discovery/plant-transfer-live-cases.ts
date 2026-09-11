import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

export function registerDiscoveryPlantLiveTests(db: NeonHttpDatabase) {
  async function fixture() {
    const userId = randomUUID(),
      senderId = randomUUID(),
      networkId = randomUUID();
    await db.batch([
      db.execute(
        sql`insert into sending_churches (id,name) values (${senderId}::uuid,'Transfer sender')`
      ),
      db.execute(
        sql`insert into sending_networks (id,name) values (${networkId}::uuid,'Transfer network')`
      ),
      db.execute(
        sql`insert into users (id,email,name,password_hash) values (${userId}::uuid,${userId + "@example.test"},'Explorer','scratch')`
      ),
      db.execute(
        sql`insert into discovery_profiles (user_id,sending_church_id,sending_network_id) values (${userId}::uuid,${senderId}::uuid,${networkId}::uuid)`
      ),
      db.execute(
        sql`insert into organization_invitations (type,inviter_user_id,invitee_email,target_user_id,sending_network_id,expires_at) values ('discovery_to_network',${userId}::uuid,${userId + "@example.test"},${userId}::uuid,${networkId}::uuid,now()+interval '1 day')`
      ),
    ]);
    const { discoveryPlantCreationStatements } = await import("./create-plant");
    const write = (churchId = randomUUID()) => ({
      churchId,
      plantedBy: userId,
      plantedByName: "Explorer",
      plantedByEmail: userId + "@example.test",
      name: "Transfer plant",
      city: null,
      stateRegion: null,
      country: null,
    });
    const consent = {
      sendingChurchId: senderId,
      sendingNetworkId: networkId,
      shareActivityWithOversight: true,
    };
    return {
      userId,
      senderId,
      networkId,
      write,
      consent,
      statements: discoveryPlantCreationStatements,
    };
  }
  async function count(table: string, where: ReturnType<typeof sql>) {
    const result = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(table)} where ${where}`
    );
    return result.rows[0].count;
  }
  test("plant conversion preserves both associations, canonical person/privacy and invitation history", async () => {
    const f = await fixture();
    const write = f.write();
    const result = await db.batch(f.statements(write, f.consent));
    assert.equal(result[5].rows.length, 1);
    const [plant] = (
      await db.execute(
        sql`select * from churches where id=${write.churchId}::uuid`
      )
    ).rows;
    assert.equal(plant.sending_church_id, f.senderId);
    assert.equal(plant.sending_network_id, f.networkId);
    assert.equal(
      await count(
        "persons",
        sql`user_id=${f.userId}::uuid and church_id=${write.churchId}::uuid and status='leader'`
      ),
      1
    );
    assert.equal(
      await count(
        "church_privacy_settings",
        sql`church_id=${write.churchId}::uuid and share_people and share_meetings and share_activity_with_oversight`
      ),
      1
    );
    assert.equal(
      await count("association_events", sql`actor_user_id=${f.userId}::uuid`),
      4
    );
    assert.equal(
      await count("discovery_profiles", sql`user_id=${f.userId}::uuid`),
      0
    );
    assert.equal(
      await count(
        "organization_invitations",
        sql`target_user_id is null and target_church_id=${write.churchId}::uuid and type='church_to_network' and status='pending'`
      ),
      1
    );
    const replayWrite = f.write();
    const replay = await db.batch(f.statements(replayWrite, f.consent));
    assert.equal(replay[5].rows.length, 0);
    assert.equal(
      await count("churches", sql`id=${replayWrite.churchId}::uuid`),
      0
    );
  });
  test("failed transfer and stale consent preserve the profile and produce no plant effects", async () => {
    const f = await fixture();
    const write = f.write();
    await assert.rejects(
      db.batch([...f.statements(write, f.consent), db.execute(sql`select 1/0`)])
    );
    assert.equal(
      await count(
        "discovery_profiles",
        sql`user_id=${f.userId}::uuid and sending_church_id=${f.senderId}::uuid`
      ),
      1
    );
    assert.equal(await count("churches", sql`id=${write.churchId}::uuid`), 0);
    assert.equal(
      await count("association_events", sql`actor_user_id=${f.userId}::uuid`),
      0
    );
    const result = await db.batch(
      f.statements(write, { ...f.consent, sendingChurchId: null })
    );
    assert.equal(result[5].rows.length, 0);
    assert.equal(await count("churches", sql`id=${write.churchId}::uuid`), 0);
    assert.equal(await count("persons", sql`user_id=${f.userId}::uuid`), 0);
  });
  test("concurrent plant creation has one plant, owner, person and audit winner", async () => {
    const f = await fixture();
    const writes = [f.write(), f.write()];
    const results = await Promise.all(
      writes.map((write) => db.batch(f.statements(write, f.consent)))
    );
    assert.equal(
      results.reduce((n, r) => n + r[5].rows.length, 0),
      1
    );
    assert.equal(
      await count(
        "churches",
        sql`id in (${writes[0].churchId}::uuid,${writes[1].churchId}::uuid)`
      ),
      1
    );
    assert.equal(await count("persons", sql`user_id=${f.userId}::uuid`), 1);
    assert.equal(
      await count("association_events", sql`actor_user_id=${f.userId}::uuid`),
      4
    );
    assert.equal(
      await count(
        "users",
        sql`id=${f.userId}::uuid and seat='owner' and church_id is not null and sending_church_id is null and sending_network_id is null`
      ),
      1
    );
  });
}
