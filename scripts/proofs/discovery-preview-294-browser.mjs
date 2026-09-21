// Prepared only. No network, browser, authentication or database work without --execute.
// Playwright is supplied by root outside the repository; package/lock stay unchanged.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { logoutSession } from "./discovery-preview-294-logout.mjs";
import { assertMailDelta } from "./discovery-preview-294-mail.mjs";
import { validateEvidence } from "./discovery-preview-294-evidence.mjs";
import { resolve, isAbsolute, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const plan = {
  status: "PREPARED_NOT_RUN",
  cases: [
    "signup-all-three-org-types",
    "discovery-accept-decline-leave",
    "owner-sever",
    "home-settings-keyboard",
    "oversight-role-visibility",
    "associated-seat-refusal",
    "empty-profile-seat-accept",
    "plant-transfer-wiki",
  ],
  requirements:
    "Verified capture transport, exact deployment/schema78 evidence, authorized development database and owned fixtures. No execution without --execute.",
  evidence:
    "DOM + per-step read-only SQL + exact captured recipient/idempotency assertions; external accessibility audit remains required.",
};
if (!process.argv.includes("--execute")) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  try {
    await run();
  } catch {
    console.error(
      "Discovery preview run failed. Inspect the private report; credentials and URLs omitted."
    );
    process.exitCode = 1;
  }
}

async function run() {
  const required = (key) => {
    assert.ok(process.env[key], `Missing root input ${key}`);
    return process.env[key];
  };
  const manifest = JSON.parse(
    readFileSync(required("DISCOVERY_PREVIEW_MANIFEST"), "utf8")
  );
  const approval = JSON.parse(
    readFileSync(required("DISCOVERY_PREVIEW_ROOT_INPUTS"), "utf8")
  );
  assert.equal(manifest.version, 2);
  assert.equal(approval.run, manifest.run);
  assert.equal(approval.rootAuthorized, true);
  assert.equal(
    approval.developmentDatabaseAuthorized,
    true,
    "Root must authorize this exact development database"
  );
  assert.equal(
    approval.schema77Hash,
    "5f637d2c8a79e0f323af645afb8a682fb6d2e8747031bba50c868c1e7196f521"
  );
  assert.equal(approval.schema77When, 1789106379915);
  const reviewedRuntimeCommit = required("DISCOVERY_PREVIEW_RUNTIME_COMMIT");
  assert.ok(
    approval.deploymentEvidence,
    "Root must bind deployment to the reviewed runtime commit"
  );
  assert.equal(approval.backgroundProviderWorkDisabled, true);
  assert.equal(approval.fixtureAppliedAndBaselineOraclePassed, true);
  const origin = new URL(required("DISCOVERY_PREVIEW_ORIGIN"));
  assert.equal(origin.protocol, "https:");
  assert.ok(origin.hostname.endsWith(".vercel.app"));
  assert.equal(origin.pathname, "/");
  assert.equal(origin.search, "");
  assert.equal(origin.origin, approval.origin);
  const password = required("DISCOVERY_PREVIEW_PASSWORD");
  const bypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");
  const modulePath = required("PLAYWRIGHT_MODULE");
  assert.ok(isAbsolute(modulePath));
  const output = resolve(required("DISCOVERY_PREVIEW_OUTPUT"));
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const connection = required("DISCOVERY_PREVIEW_DATABASE_URL");
  const evidence = validateEvidence(
    manifest,
    approval,
    origin,
    connection,
    reviewedRuntimeCommit
  );
  const pgPath = required("PG_MODULE");
  assert.ok(isAbsolute(pgPath));
  const { default: pg } = await import(pathToFileURL(pgPath).href);
  const client = new pg.Client({
    connectionString: connection,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    query_timeout: 15000,
  });
  const captureToken = required("DISCOVERY_CAPTURE_PROOF_TOKEN");
  const oracleDirectory = dirname(
    resolve(required("DISCOVERY_PREVIEW_MANIFEST"))
  );
  const report = {
    ...plan,
    run: manifest.run,
    status: "RUNNING",
    cases: [],
    sqlOracle: [],
    capture: [],
    evidenceSha256: evidence.evidenceSha256,
    accessibilityAudit: "REQUIRED_NOT_RUN",
  };
  let browser;
  let deadline;
  const observed = new Map();
  async function read(query, values = []) {
    await client.query("BEGIN READ ONLY");
    try {
      const result = await client.query(query, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  async function oracle(phase) {
    const name = manifest.oracles[phase];
    assert.match(name, /^\d{2}-[a-z0-9-]+\.sql$/);
    await read(readFileSync(join(oracleDirectory, name), "utf8"));
    report.sqlOracle.push(phase);
  }
  async function capture() {
    const nonce = randomUUID();
    const url = new URL(evidence.captureEvidenceURL);
    url.searchParams.set("nonce", nonce);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${captureToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.ok(raw.length < 2_000_000);
    const result = JSON.parse(raw);
    assert.equal(result.run, manifest.run);
    assert.equal(result.serviceId, evidence.serviceId);
    assert.equal(result.nonce, nonce);
    assert.deepEqual(result.canary, evidence.canary);
    assert.ok(Array.isArray(result.requests) && result.requests.length <= 40);
    const ids = new Set();
    for (const receipt of result.requests) {
      assert.equal(typeof receipt.id, "string");
      assert.ok(!ids.has(receipt.id));
      ids.add(receipt.id);
      assert.equal(receipt.method, "POST");
      assert.equal(receipt.path, "/emails");
      assert.equal(receipt.accepted, true);
      assert.match(receipt.bodySha256, /^[a-f0-9]{64}$/);
      if (observed.has(receipt.id))
        assert.deepEqual(
          receipt,
          observed.get(receipt.id),
          "Capture receipts must be immutable"
        );
    }
    for (const id of observed.keys())
      assert.ok(ids.has(id), "Capture evidence disappeared");
    return result.requests;
  }
  async function mail({ email, orgType, org, owner, event, occurrence }) {
    const account = (
      await read("select id,email from users where email=$1", [email])
    ).rows;
    assert.equal(account.length, 1);
    if (!occurrence) {
      const events = (
        await read(
          "select id from association_events where discovery_user_id=$1 and org_id=$2 and event='disassociated'",
          [account[0].id, org.id]
        )
      ).rows;
      assert.equal(events.length, 1);
      occurrence = events[0].id;
    }
    const subject = {
      accepted: "Discovery association accepted",
      declined: "Discovery association invitation declined",
      left: "Discovery association ended",
      removed: "Discovery association ended",
    }[event];
    const expected = [account[0], owner].map((recipient) => ({
      to: [recipient.email],
      subject,
      idempotencyKey:
        "discovery-association-" +
        createHash("sha256")
          .update(
            JSON.stringify([
              account[0].id,
              orgType,
              org.id,
              event,
              occurrence,
              recipient.id,
            ])
          )
          .digest("hex"),
    }));
    let fresh = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      fresh = (await capture()).filter((item) => !observed.has(item.id));
      if (fresh.length >= expected.length) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assertMailDelta(fresh, expected);
    for (const item of fresh) observed.set(item.id, item);
    report.capture.push({ event, count: fresh.length });
  }
  async function session(name, account, viewport, work) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(45_000);
    const errors = [];
    page.on("pageerror", () => errors.push("uncaught-page-error"));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      // Exempt only the known toolbar resource on Vercel's own origin.
      if (
        /^https:\/\/vercel\.live\//.test(location) &&
        /403/.test(message.text())
      )
        return;
      errors.push("console-error");
    });
    const item = { name, viewport, status: "RUNNING" };
    report.cases.push(item);
    try {
      const entry = new URL("/login", origin);
      entry.searchParams.set("x-vercel-protection-bypass", bypass);
      entry.searchParams.set("x-vercel-set-bypass-cookie", "true");
      await page.goto(entry.href);
      if (account) {
        await page.getByLabel("Email", { exact: true }).fill(account.email);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.waitForURL((url) => url.pathname !== "/login");
      }
      await work(page);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1
        ),
        false,
        "Horizontal overflow"
      );
      assert.deepEqual(
        errors,
        [],
        "Console/page errors; inspect privately before classifying"
      );
      await page.screenshot({
        path: join(output, `${name}.png`),
        fullPage: true,
      });
      item.status = "PASS";
    } catch (error) {
      item.status = "FAIL";
      writeFileSync(
        join(output, `${name}-error-private.txt`),
        String(error?.stack ?? error),
        { mode: 0o600 }
      );
      await page
        .screenshot({
          path: join(output, `${name}-failure.png`),
          fullPage: true,
        })
        .catch(() => {});
      item.reason =
        error instanceof assert.AssertionError
          ? "Assertion failed; inspect this case"
          : "Browser interaction failed; inspect this case";
      throw new Error("Browser case failed; see private report");
    } finally {
      item.logout = { status: "PENDING" };
      try {
        await logoutSession(context, page, origin, item.logout);
      } catch {
        item.logout.failedAt = item.logout.status;
        item.logout.status = "FAIL";
        if (item.status === "PASS") item.status = "FAIL_LOGOUT";
        process.exitCode = 1;
        throw new Error("Session logout failed; see private report");
      } finally {
        await context.close();
      }
    }
  }
  const visible = async (locator) => {
    await locator.waitFor({ state: "visible" });
  };

  const absent = async (locator) => {
    await locator.waitFor({ state: "hidden" });
  };
  const go = (page, path) => page.goto(new URL(path, origin).href);
  async function tabTo(page, locator) {
    await visible(locator);
    for (let count = 0; count < 80; count++) {
      if (await locator.evaluate((el) => document.activeElement === el)) return;
      await page.keyboard.press("Tab");
    }
    assert.fail("Control unreachable by Tab within 80 steps");
  }
  const desktop = { width: 1440, height: 1000 },
    mobile = { width: 390, height: 844 };
  try {
    await client.connect();
    const identity = (
      await read(
        "select current_database() as database, current_user as username"
      )
    ).rows[0];
    assert.equal(identity.database, evidence.database.database);
    assert.equal(identity.username, evidence.database.username);
    const ledger = (
      await read(
        "select hash from drizzle.__drizzle_migrations where hash=$1 and created_at=$2",
        [evidence.database.ledger78.hash, evidence.database.ledger78.when]
      )
    ).rows;
    assert.equal(ledger.length, 1, "Exact migration78 must be applied");
    await oracle("schema");
    await oracle("baseline");
    assert.equal(
      (await capture()).length,
      0,
      "Capture run must be unused after its separate canary"
    );
    const { chromium } = await import(pathToFileURL(modulePath).href);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.DISCOVERY_PREVIEW_BROWSER_EXECUTABLE || undefined,
    });
    deadline = setTimeout(() => {
      void browser.close().catch(() => {});
    }, 15 * 60_000);
    for (const signup of manifest.signup) {
      await session(
        `signup-form-${signup.key}`,
        null,
        desktop,
        async (page) => {
          await go(page, `/register?invitation=${signup.invitationId}`);
          const discovery = page.getByRole("radio", { name: /Discovery/ });
          await discovery.click();
          await page
            .getByRole("radio", { name: /Discovery/, checked: true })
            .waitFor();
          assert.equal(
            await page.getByLabel("Email", { exact: true }).inputValue(),
            signup.email
          );
          assert.equal(
            (await page
              .getByLabel("Email", { exact: true })
              .getAttribute("readonly")) !== null,
            true
          );
          await absent(page.locator('[name="inviteCode"]'));
          await absent(page.locator('[name="organizationName"]'));
          await page.getByLabel("Your full name").fill(signup.name);
          await page.getByLabel("Password", { exact: true }).fill(password);
          await page
            .getByRole("button", { name: "Create account", exact: true })
            .click();
          await page.waitForURL((url) => url.pathname === "/dashboard");
          await visible(
            page.getByRole("heading", { name: "Explore church planting" })
          );
          await page.reload();
          await visible(
            page.getByRole("heading", { name: "Explore church planting" })
          );
          const sending = signup.type === "church_to_sending_church";
          const org = sending
            ? manifest.orgs.sendingChurch
            : manifest.orgs.network;
          await page
            .getByRole("link", { name: "Manage associations", exact: true })
            .click();
          await visible(page.getByText(org.name, { exact: true }));
          await oracle(signup.key);
          await mail({
            email: signup.email,
            orgType: sending ? "sending_church" : "network",
            org,
            owner: sending
              ? manifest.accounts.sendingOwner
              : manifest.accounts.networkOwner,
            event: "accepted",
            occurrence: signup.invitationId,
          });
        }
      );
    }
    for (const [label, viewport] of [
      ["desktop", desktop],
      ["mobile", mobile],
    ]) {
      await session(
        `home-and-leave-dialog-${label}`,
        manifest.accounts.associatedSeat,
        viewport,
        async (page) => {
          await go(page, "/dashboard");
          await visible(
            page.getByRole("heading", { name: "Explore church planting" })
          );
          const create = page.getByRole("button", {
            name: "Create a plant",
            exact: true,
          });
          await tabTo(page, create);
          await page.keyboard.press("Enter");
          const name = page.getByLabel("Church plant name");
          await visible(name);
          assert.equal(
            await name.evaluate((el) => document.activeElement === el),
            true
          );
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          await go(page, "/dashboard#settings/association");
          const leave = page.getByRole("button", {
            name: "Leave network",
            exact: true,
          });
          await tabTo(page, leave);
          await page.keyboard.press("Enter");
          const dialog = page.getByRole("alertdialog");
          await visible(dialog);
          await dialog.getByRole("textbox").fill("wrong confirmation");
          assert.equal(
            await dialog
              .getByRole("button", { name: "Leave network", exact: true })
              .isDisabled(),
            true
          );
          await page.keyboard.press("Escape");
          await absent(dialog);
          assert.equal(
            await leave.evaluate((el) => document.activeElement === el),
            true
          );
        }
      );
    }
    await session(
      "pending-association-answers",
      manifest.accounts.lifecycle,
      desktop,
      async (page) => {
        await go(page, "/dashboard#settings/association");
        for (const org of [
          manifest.orgs.network,
          manifest.orgs.sendingChurch,
        ]) {
          const invitation = page
            .getByRole("listitem")
            .filter({ hasText: `${org.name} invited you` });
          await visible(
            invitation.getByRole("button", { name: "Accept", exact: true })
          );
          await visible(
            invitation.getByRole("button", { name: "Decline", exact: true })
          );
        }
        const networkInvite = page
          .getByRole("listitem")
          .filter({ hasText: `${manifest.orgs.network.name} invited you` });
        await networkInvite
          .getByRole("button", { name: "Accept", exact: true })
          .click();
        await absent(networkInvite);
        await page.reload();
        await visible(
          page.getByRole("button", { name: "Leave network", exact: true })
        );
        await oracle("accept");
        await mail({
          email: manifest.accounts.lifecycle.email,
          orgType: "network",
          org: manifest.orgs.network,
          owner: manifest.accounts.networkOwner,
          event: "accepted",
          occurrence: manifest.invitations.acceptNetwork,
        });
        const sendingInvite = page.getByRole("listitem").filter({
          hasText: `${manifest.orgs.sendingChurch.name} invited you`,
        });
        await sendingInvite
          .getByRole("button", { name: "Decline", exact: true })
          .click();
        await absent(sendingInvite);
        await page.reload();
        await visible(
          page.getByRole("button", { name: "Leave network", exact: true })
        );
        await absent(
          page.getByRole("button", {
            name: "Leave sending church",
            exact: true,
          })
        );
        await oracle("decline");
        await mail({
          email: manifest.accounts.lifecycle.email,
          orgType: "sending_church",
          org: manifest.orgs.sendingChurch,
          owner: manifest.accounts.sendingOwner,
          event: "declined",
          occurrence: manifest.invitations.declineSending,
        });
        await page
          .getByRole("button", { name: "Leave network", exact: true })
          .click();
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("textbox").fill(manifest.orgs.network.name);
        await dialog
          .getByRole("button", { name: "Leave network", exact: true })
          .click();
        await absent(dialog);
        await page.reload();
        await absent(
          page.getByRole("button", { name: "Leave network", exact: true })
        );
        await oracle("leave");
        await mail({
          email: manifest.accounts.lifecycle.email,
          orgType: "network",
          org: manifest.orgs.network,
          owner: manifest.accounts.networkOwner,
          event: "left",
        });
      }
    );
    for (const key of ["networkOwner", "networkMember", "foreignOwner"]) {
      await session(
        `oversight-${key}`,
        manifest.accounts[key],
        desktop,
        async (page) => {
          await go(page, "/oversight");
          const name = manifest.accounts.associatedSeat.name;
          const remove = page.getByRole("button", {
            name: `End association with ${name}`,
            exact: true,
          });
          if (key === "foreignOwner") {
            await absent(
              page.getByText(manifest.accounts.associatedSeat.email, {
                exact: true,
              })
            );
            await absent(remove);
          } else {
            await visible(
              page.getByText(manifest.accounts.associatedSeat.email, {
                exact: true,
              })
            );
            if (key === "networkMember") await absent(remove);
            else {
              await tabTo(page, remove);
              await page.keyboard.press("Enter");
              const dialog = page.getByRole("alertdialog");
              await dialog.getByRole("textbox").fill("wrong confirmation");
              assert.equal(
                await dialog
                  .getByRole("button", { name: "End association", exact: true })
                  .isDisabled(),
                true
              );
              await page.keyboard.press("Escape");
              await absent(dialog);
            }
          }
        }
      );
    }
    await session(
      "owner-sever",
      manifest.accounts.networkOwner,
      desktop,
      async (page) => {
        await go(page, "/oversight");
        const name = manifest.accounts.sever.name;
        await page
          .getByRole("button", {
            name: `End association with ${name}`,
            exact: true,
          })
          .click();
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("textbox").fill(name);
        await dialog
          .getByRole("button", { name: "End association", exact: true })
          .click();
        await absent(dialog);
        await page.reload();
        await absent(
          page.getByText(manifest.accounts.sever.email, { exact: true })
        );
        await oracle("sever");
        await mail({
          email: manifest.accounts.sever.email,
          orgType: "network",
          org: manifest.orgs.network,
          owner: manifest.accounts.networkOwner,
          event: "removed",
        });
      }
    );
    for (const [key, account] of [
      ["associated", "associatedSeat"],
      ["empty", "emptySeat"],
    ]) {
      await session(
        `seat-${key}`,
        manifest.accounts[account],
        desktop,
        async (page) => {
          await go(
            page,
            `/seat-invitation?invitation=${manifest.seat[key].token}`
          );
          await page
            .getByRole("button", { name: "Accept invitation", exact: true })
            .click();
          if (key === "associated") {
            await visible(page.getByRole("alert"));
            await visible(
              page.getByRole("link", { name: "Manage associations and leave" })
            );
          } else {
            await page.waitForURL((url) => url.pathname === "/dashboard");
            await page.reload();
            await absent(
              page.getByRole("heading", { name: "Explore church planting" })
            );
          }
          await oracle(key === "associated" ? "associatedSeat" : "emptySeat");
          assert.equal(
            (await capture()).length,
            observed.size,
            "Seat flow unexpectedly emailed"
          );
        }
      );
    }
    await session(
      "plant-transfer-wiki-mobile",
      manifest.accounts.transfer,
      mobile,
      async (page) => {
        await go(page, `/wiki/${manifest.wiki.slug}`);
        await visible(
          page.getByRole("button", { name: "Remove bookmark", exact: true })
        );
        await go(page, "/dashboard");
        await page
          .getByRole("button", { name: "Create a plant", exact: true })
          .click();
        await page
          .getByLabel("Church plant name")
          .fill(`${manifest.run} Transfer plant`);
        await visible(
          page.getByText(manifest.orgs.network.name, { exact: true })
        );
        await visible(
          page.getByText(manifest.orgs.sendingChurch.name, { exact: true })
        );
        const consent = page.getByRole("checkbox", {
          name: "I agree to start my plant with these sharing settings.",
        });
        await tabTo(page, consent);
        await page.keyboard.press("Space");
        assert.equal(await consent.isChecked(), true);
        await page
          .getByRole("button", { name: "Create plant", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Explore church planting" })
          .waitFor({ state: "detached" });
        await page.reload();
        await absent(
          page.getByRole("heading", { name: "Explore church planting" })
        );
        await go(page, `/wiki/${manifest.wiki.slug}`);
        await visible(
          page.getByRole("button", { name: "Remove bookmark", exact: true })
        );
      }
    );
    await oracle("transfer");
    assert.equal(
      (await capture()).length,
      observed.size,
      "Unexpected email attempts after transfer"
    );
    assert.equal(observed.size, 14);
    report.status = "BROWSER_SQL_CAPTURE_PASSED_ACCESSIBILITY_PENDING";
  } catch (error) {
    report.status = "FAIL";
    writeFileSync(
      join(output, "error-private.txt"),
      String(error?.stack ?? error),
      { mode: 0o600 }
    );
    throw new Error("Browser validation failed; see private report");
  } finally {
    clearTimeout(deadline);
    try {
      await browser?.close();
    } catch {
      report.status = "FAIL_BROWSER_TEARDOWN";
      process.exitCode = 1;
    } finally {
      await client.end().catch(() => {
        report.status = "FAIL_DATABASE_TEARDOWN";
        process.exitCode = 1;
      });
      writeFileSync(
        join(output, "report.json"),
        JSON.stringify(report, null, 2),
        { mode: 0o600 }
      );
    }
  }
}
