// Prepared only. No network, browser, authentication or database work without --execute.
// Playwright is supplied by root outside the repository; package/lock stay unchanged.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const blocked = [
  "signup-submit-all-three-org-types",
  "discovery-accept",
  "discovery-decline",
  "discovery-leave",
  "owner-sever",
];
const plan = {
  status: "PREPARED_NOT_RUN",
  safeCases: [
    "signup-form-bypass",
    "discovery-home-settings",
    "association-dialog-cancel",
    "oversight-role-visibility",
    "associated-seat-refusal",
    "empty-profile-seat-accept",
    "plant-transfer-wiki",
  ],
  blocked,
  reason:
    "Successful discovery relationship writes call the provider directly; no existing preview suppression switch. Browser request interception cannot suppress server email.",
  evidence:
    "DOM assertions + screenshots + console errors; root SQL oracle and accessibility audit are separate required gates.",
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
  assert.equal(manifest.version, 1);
  assert.equal(approval.run, manifest.run);
  assert.equal(approval.rootAuthorized, true);
  assert.equal(
    approval.isolatedDatabase,
    true,
    "Shared schema76 remains held for Evry compatibility"
  );
  assert.equal(
    approval.schema77Hash,
    "5f637d2c8a79e0f323af645afb8a682fb6d2e8747031bba50c868c1e7196f521"
  );
  assert.equal(approval.schema77When, 1789106379915);
  assert.equal(
    approval.runtimeCommit,
    "7af503d5c7a44b173efb53284864c41a47ea8f66"
  );
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
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ headless: true });
  const report = {
    ...plan,
    run: manifest.run,
    status: "RUNNING",
    cases: [],
    sqlOracle: "REQUIRED_NOT_RUN",
    accessibilityAudit: "REQUIRED_NOT_RUN",
  };
  const deadline = setTimeout(() => {
    void browser.close().catch(() => {});
  }, 15 * 60_000);
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
      item.status = "PASS_DOM_ONLY";
    } catch (error) {
      item.status = "FAIL";
      item.reason =
        error instanceof assert.AssertionError
          ? "Assertion failed; inspect this case"
          : "Browser interaction failed; inspect this case";
      throw new Error("Browser case failed; see private report");
    } finally {
      await context.close();
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
    for (const signup of manifest.signup) {
      await session(
        `signup-form-${signup.key}`,
        null,
        desktop,
        async (page) => {
          await go(page, `/register?invitation=${signup.invitationId}`);
          const discovery = page.getByRole("radio", { name: /Discovery/ });
          await tabTo(page, page.getByRole("radio", { checked: true }));
          for (let step = 0; step < 4; step++) {
            if ((await discovery.getAttribute("aria-checked")) === "true")
              break;
            await page.keyboard.press("ArrowDown");
          }
          assert.equal(await discovery.getAttribute("aria-checked"), "true");
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
          // Do not submit: registration redeems the org invitation and sends mail.
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
        // Success buttons remain untouched because each triggers direct email.
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
    report.status = "SAFE_SUBSET_DOM_PASSED_FULL_GATE_BLOCKED";
  } catch (error) {
    report.status = "FAIL";
    throw new Error("Browser validation failed; see private report");
  } finally {
    clearTimeout(deadline);
    try {
      await browser.close();
    } catch {
      report.status = "FAIL_BROWSER_TEARDOWN";
      process.exitCode = 1;
    } finally {
      writeFileSync(
        join(output, "report.json"),
        JSON.stringify(report, null, 2),
        { mode: 0o600 }
      );
    }
  }
}
