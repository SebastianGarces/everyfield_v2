import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

function withProofDirectory<T>(work: (directory: string) => T): T {
  const directory = mkdtempSync(resolve(".history-bound-proof-"));
  try {
    return work(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function childFailure(child: SpawnSyncReturns<string>) {
  return JSON.stringify({
    status: child.status,
    signal: child.signal,
    error: child.error
      ? {
          name: child.error.name,
          message: child.error.message,
          code: "code" in child.error ? child.error.code : undefined,
        }
      : null,
    stderr: child.stderr,
  });
}

test("bound production registry retains authoritative artifacts while direct and code-mode callers receive continuation", () => {
  // Run the production registry and native Eve state. Only read execution and
  // session authorization are doubled; this is not database/authentication proof.
  withProofDirectory((directory) => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {readFileSync,writeFileSync} from 'node:fs';
    import {pathToFileURL} from 'node:url';
    import {resolve,dirname,join} from 'node:path';
    const file=p=>pathToFileURL(resolve(p)).href;
    const require=createRequire(file('package.json'));
    const {build}=createRequire(require.resolve('tsx'))('esbuild');
    const load=async p=>{const m=await import(file(p));return m.default??m;};
    // No network access is possible even if a boundary double stops applying.
    globalThis.fetch=async()=>{throw new Error('Network forbidden in pure proof');};
    const {peopleHistoryQuerySchema}=await load('src/lib/evry/capabilities/queries/people-query-sql.ts');
    const {peopleQueryArtifact}=await load('src/lib/evry/capabilities/queries/people.ts');
    const built=await build({stdin:{contents:
      "export {createBoundEveRegistry,describeEveRuntimeTools} from './src/lib/evry/eve/runtime/registry'; export {evryResultState,withResultPresentation} from './src/lib/evry/eve/runtime/results'; export {defineEvryReadRegistration} from './src/lib/evry/reads/contract';",
      resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',packages:'external',
      plugins:[{name:'isolated-boundaries',setup(build){
        build.onLoad({filter:/eve\\/runtime\\/registry\\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8')
          .replace('"@/lib/evry/eligibility/capabilities"','"history-test-auth"')
          .replace('"../capabilities/registry"','"history-test-registry"')}));
        build.onResolve({filter:/^history-test-/},args=>({path:args.path,namespace:'history-test'}));
        build.onLoad({filter:/.*/,namespace:'history-test'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path==='history-test-auth'
          ? 'export const authorizeEvryReadCapabilityForSession=async(name,session)=>{globalThis.fixture.auth.push([name,session]);return globalThis.fixture.authorization;};'
          : "import {createEveToolRegistry as actual} from './src/lib/evry/eve/capabilities/registry'; export const createEveToolRegistry=options=>actual({...options,reads:globalThis.fixture.reads});"}));
      }}]});
    const directory=${JSON.stringify(directory)};
    const entry=join(directory,'entry.mjs');writeFileSync(entry,built.outputFiles[0].text);
    const {createBoundEveRegistry,describeEveRuntimeTools,evryResultState,withResultPresentation,defineEvryReadRegistration}=await import(pathToFileURL(entry).href);
    const {createCompositionBudget,runEvryComposition}=await load('src/lib/evry/eve/composition/runner.ts');
    const actor={userId:'actor',plantId:'plant',seat:'owner'};
    const identity={...actor,appSessionId:'session'};
    const scope={actor,appSessionId:'session',eveSessionId:'eve-session',conversationId:'00000000-0000-4000-8000-000000000099',turnId:'turn'};
    const query={resource:{kind:'assessments'},result:{mode:'list',limit:50}};
    const original=JSON.parse(JSON.stringify(peopleQueryArtifact('Recorded history',{
      total:1,people:1,households:0,without_household:1,groups:[],group_total:0,has_more:false,
      rows:[{id:'00000000-0000-4000-8000-000000000001',label:'Person',content:'Recorded.',content_length:9,content_offset:0,content_next_offset:null}]
    },'list','people',query,new Date('2026-09-20T12:00:00Z'),'America/New_York')));
    let executed=0;
    const read=defineEvryReadRegistration({id:'people.history.query',capabilityIdentity:'fixture.history.read',inputShape:peopleHistoryQuerySchema.shape,
      run:async()=>{executed++;return original;}});
    globalThis.fixture={reads:[read],auth:[],authorization:{actor,registration:{identity:read.capabilityIdentity}}};
    const captured=[];const authorized=[];
    globalThis.__everyfieldIsolatedEveFixtureHost={run:given=>{
      assert.equal(given.userId,identity.userId);assert.equal(given.plantId,identity.plantId);
      return {now:new Date('2026-09-20T12:00:00Z'),authorize:allowed=>authorized.push(allowed),call:call=>captured.push(call)};
    }};
    const contextEntry=createRequire(file('package.json')).resolve('eve/context');
    const {ContextContainer,contextStorage}=await import(pathToFileURL(join(dirname(contextEntry),'../../context/container.js')).href);
    await contextStorage.run(new ContextContainer(),async()=>{
      const registry=createBoundEveRegistry(scope);
      const description=registry.describe().find(t=>t.name===read.id);
      assert.ok(description.description.includes('nextAfterId'));
      assert.equal(describeEveRuntimeTools(identity).find(t=>t.name===read.id).description,description.description);
      const output=await registry.invoke(read.id,query,{callId:'direct-history'});
      assert.equal(output.resultReference,'direct-history');
      assert.equal(output.continuation.status,'available');
      assert.equal(output.continuation.nextAfterId,null);
      assert.deepEqual(captured[0].output,original);
      assert.deepEqual(evryResultState.get()[0].artifacts,[original]);
      const envelope=withResultPresentation(output,'turn',['direct-history']);
      assert.equal(envelope.data.continuation.status,'available');
      assert.equal(envelope.presentation.results[0].reference,'direct-history');
      assert.equal('continuation' in envelope.presentation.results[0].artifacts[0],false);
      const composed=await runEvryComposition({registry,callId:'composed-history',budget:createCompositionBudget(),
        js:'const r=await tools["people.history.query"]('+JSON.stringify(query)+');return {reference:r.resultReference,continuation:r.continuation};'});
      assert.equal(composed.status,'completed');assert.equal(composed.calls,1);
      assert.deepEqual(composed.output.continuation,output.continuation);
      assert.equal(captured.length,2);assert.deepEqual(captured[1].output,original);
      assert.equal(composed.output.reference,captured[1].id);
      assert.deepEqual(authorized,[true,true]);assert.equal(executed,2);
      globalThis.fixture.authorization=null;
      assert.deepEqual(await registry.invoke(read.id,query,{callId:'refused'}),{status:'unavailable',reason:'not_authorized'});
      assert.equal(executed,2);assert.deepEqual(authorized,[true,true,false]);
      assert.deepEqual(globalThis.fixture.auth,Array(3).fill([read.capabilityIdentity,'session']));
      const invalid=await registry.invoke(read.id,{resource:{kind:'assessments'}},{callId:'invalid'});
      assert.equal(invalid.status,'invalid_input');assert.equal('continuation' in invalid,false);
      assert.equal(globalThis.fixture.auth.length,3);
      assert.equal(evryResultState.get().length,2);
      const selectionInput={selections:[{resultReference:'direct-history',itemIds:original.items.map(item=>item.id)}]};
      for(const authorization of [null,
        {actor:{...actor,userId:'other'},registration:{identity:read.capabilityIdentity}},
        {actor:{...actor,plantId:'other'},registration:{identity:read.capabilityIdentity}},
        {actor,registration:{identity:'wrong.read'}}]) {
        globalThis.fixture.authorization=authorization;
        assert.deepEqual(await registry.invoke('results.select',selectionInput,{callId:'refused-selection'}),{status:'unavailable',reason:'not_authorized'});
        assert.equal(evryResultState.get().some(row=>row.reference==='refused-selection'),false);
      }
      globalThis.fixture.authorization={actor,registration:{identity:read.capabilityIdentity}};
      const selected=await registry.invoke('results.select',selectionInput,{callId:'selected-direct'});
      assert.equal(selected.resultReference,'selected-direct');
      assert.equal(selected.selection.sources[0].reference,'direct-history');
      assert.deepEqual(selected.items,original.items);
      assert.equal(describeEveRuntimeTools(identity).some(tool=>tool.name==='results.select'),true);
      const subset=await runEvryComposition({registry,callId:'selected-composed',budget:createCompositionBudget(),
        js:'return await tools["results.select"]('+JSON.stringify(selectionInput)+');'});
      assert.equal(subset.status,'completed');
      assert.equal(subset.output.resultReference,'selected-composed:tool-1');
      assert.equal(executed,2,'Selecting cached rows must not run another database read');
      const selectedEnvelope=withResultPresentation(subset.output,'turn',[subset.output.resultReference]);
      assert.equal(selectedEnvelope.presentation.results[0].artifacts[0].selection.sources[0].reference,'direct-history');
      assert.deepEqual(evryResultState.get().find(row=>row.reference==='direct-history').artifacts,[original]);
      globalThis.fixture.authorization=null;
      assert.deepEqual(await registry.invoke('results.select',{selections:[{resultReference:'selected-direct',itemIds:original.items.map(item=>item.id)}]},{callId:'revoked-selection'}),{status:'unavailable',reason:'not_authorized'});
    });
    console.log('bound history continuation proof passed');
  `,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
          RESEND_API_KEY: "re_isolated_no_send",
        },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 128 * 1024,
      }
    );
    assert.equal(child.status, 0, childFailure(child));
    assert.match(child.stdout, /bound history continuation proof passed/);
  });
});

test("parent cleanup survives a killed child and reports its timeout and signal", () => {
  let directory = "";
  assert.throws(
    () =>
      withProofDirectory((created) => {
        directory = created;
        writeFileSync(`${created}/entry.mjs`, "fixture");
        const child = spawnSync(
          process.execPath,
          [
            "--eval",
            `
      setInterval(() => {}, 1000);
    `,
          ],
          { encoding: "utf8", timeout: 1_000 }
        );
        assert.equal(existsSync(`${created}/entry.mjs`), true);
        assert.equal(child.status, 0, childFailure(child));
      }),
    (error: unknown) => {
      assert.ok(error instanceof assert.AssertionError);
      assert.match(error.message, /ETIMEDOUT/);
      assert.match(error.message, /"signal":"SIGTERM"/);
      return true;
    }
  );
  assert.notEqual(directory, "");
  assert.equal(existsSync(directory), false);
});
