import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const compiledDirectory = resolve(root, ".output/server");
const library = resolve(compiledDirectory, "_libs/eve+zod.mjs");
const bootstrap = resolve(root, "scripts/evry-eve-http-bootstrap.mjs");

function run(
  source: string,
  { scoped = true, tsx = true, directory = compiledDirectory } = {}
) {
  const child = spawnSync(
    process.execPath,
    [
      ...(tsx ? ["--import", require.resolve("tsx")] : []),
      ...(scoped ? ["--import", bootstrap] : []),
      "--input-type=module",
      "-e",
      source,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        EVRY_EVE_COMPILED_SERVER_DIRECTORY: directory,
        TSX_TSCONFIG_PATH: resolve(root, "tsconfig.json"),
        DATABASE_URL: "postgres://fixture:fixture@localhost/fixture",
        RESEND_API_KEY: "re_isolated_loader_probe",
      },
      encoding: "utf8",
      timeout: 30_000,
    }
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test("native dynamic-import namespace survives the source loader without a compiled build", () => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "evry-loader-interop-"))
  );
  try {
    writeFileSync(
      join(directory, "functions.mjs"),
      'const api={waitUntil(promise){}};Object.defineProperty(api,"__esModule",{value:true});export default api;'
    );
    writeFileSync(
      join(directory, "runtime.mjs"),
      'export function probe(promise){import("./functions.mjs").then(module=>({...module.default})).then(({waitUntil})=>waitUntil(promise));}'
    );
    const source = `
      globalThis.fetch=async()=>{throw new Error('Network disabled');};
      let rejected=0;process.on('unhandledRejection',()=>{rejected++;});
      const {probe}=await import(${JSON.stringify(pathToFileURL(join(directory, "runtime.mjs")).href)});
      probe(Promise.resolve());await new Promise(resolve=>setTimeout(resolve,150));
      console.log(JSON.stringify({rejected}));
    `;
    assert.equal(
      run(source, { directory, scoped: false, tsx: false }).rejected,
      0
    );
    assert.ok(run(source, { directory, scoped: false }).rejected > 0);
    assert.equal(run(source, { directory }).rejected, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "actual compiled waitUntil fails under global tsx but survives native and bounded loaders",
  { skip: process.env.EVRY_COMPILED_LOADER_PROOF !== "1" },
  () => {
    const bytes = readFileSync(library, "utf8");
    const helper = bytes.match(
      /function ([\w$]+)\(t\) \{\n\timport\("[^\"]+"\)\.then\([\s\S]{0,200}?waitUntil/
    )?.[1];
    assert.ok(
      helper,
      "Locate the real compiled waitUntil helper, not a replacement"
    );
    const source = `
    import {registerHooks} from 'node:module';
    globalThis.fetch = async () => { throw new Error('Network disabled'); };
    const target = ${JSON.stringify(pathToFileURL(library).href)};
    registerHooks({load(url,context,nextLoad) {
      const loaded = nextLoad(url,context);
      // Test-only export. The compiled helper body and imports stay unchanged.
      return url === target ? {...loaded, source: String(loaded.source) + ${JSON.stringify(`\nexport { ${helper} as diagnosticWaitUntil };`)}} : loaded;
    }});
    let rejected = 0;
    process.on('unhandledRejection', () => { rejected++; });
    const module = await import(target);
    module.diagnosticWaitUntil(Promise.resolve());
    await new Promise(resolve => setTimeout(resolve, 150));
    console.log(JSON.stringify({rejected}));
  `;
    assert.equal(run(source, { scoped: false, tsx: false }).rejected, 0);
    assert.ok(run(source, { scoped: false }).rejected > 0);
    assert.equal(run(source).rejected, 0);
  }
);

test("bounded loader leaves source aliases and native attachment dynamic imports working", () => {
  const source = `
    import {createRequire} from 'node:module';
    const require = createRequire(${JSON.stringify(pathToFileURL(resolve(root, "package.json")).href)});
    let blockedFetches = 0;
    globalThis.fetch = async () => { blockedFetches++; throw new Error('Network disabled'); };
    const {bindFixtureUpload} = require('./src/lib/evry/eve/evals/http/attachments.ts');
    let importFailure = false;
    try {
      await bindFixtureUpload({upload:{},sessionId:'fixture',sessionToken:'a'.repeat(64),actor:{userId:'fixture',plantId:'fixture'},origin:'http://127.0.0.1:1'});
    } catch (error) {
      importFailure = error?.code === 'ERR_MODULE_NOT_FOUND';
    }
    console.log(JSON.stringify({importFailure,blockedFetches}));
  `;
  const result = run(source, { directory: resolve(root, "scripts") });
  assert.equal(result.importFailure, false);
  assert.ok(
    result.blockedFetches > 0,
    "Native auth imports reach the blocked database fetch without contacting it"
  );
});

test("loader delegates sibling, source and symlink-escape modules while preserving scoped URL identity", () => {
  const source = `
    import {registerHooks} from 'node:module';
    import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {pathToFileURL} from 'node:url';
    import {registerCompiledEveLoader} from ${JSON.stringify(pathToFileURL(resolve(root, "scripts/evry-eve-compiled-loader.mjs")).href)};
    const base=realpathSync(mkdtempSync(join(tmpdir(),'evry-loader-scope-')));
    const server=join(base,'server'), sibling=join(base,'server-other');
    mkdirSync(server);mkdirSync(sibling);
    writeFileSync(join(server,'inside.mjs'),'export const marker = import.meta.url;');
    writeFileSync(join(sibling,'outside.mjs'),'export const marker = import.meta.url;');
    writeFileSync(join(server,'source.cjs'),'module.exports = {marker: true};');
    symlinkSync(join(sibling,'outside.mjs'),join(server,'escape.mjs'));
    const delegated=[];
    const watch=registerHooks({load(url,context,nextLoad){if(url.startsWith(pathToFileURL(base).href))delegated.push(url);return nextLoad(url,context)}});
    const boundary=registerCompiledEveLoader(server);
    try {
      const insideUrl=pathToFileURL(join(server,'inside.mjs')).href+'?probe=1#identity';
      const inside=await import(insideUrl);
      await import(pathToFileURL(join(sibling,'outside.mjs')).href+'?probe=2');
      await import(pathToFileURL(join(server,'escape.mjs')).href+'?probe=3');
      await import(pathToFileURL(join(server,'source.cjs')).href);
      console.log(JSON.stringify({sameIdentity:inside.marker===insideUrl,insideDelegated:delegated.some(url=>url.includes('/inside.mjs')),outside:delegated.filter(url=>url.includes('/outside.mjs')).length,source:delegated.some(url=>url.includes('/source.cjs'))}));
    } finally { boundary.deregister();watch.deregister();rmSync(base,{recursive:true,force:true}); }
  `;
  const result = run(source, { scoped: false, tsx: false });
  assert.equal(result.sameIdentity, true);
  assert.equal(result.insideDelegated, false);
  assert.equal(result.outside, 2);
  assert.equal(result.source, true);
});
