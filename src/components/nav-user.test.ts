import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.join(process.cwd(), "src", "components", "nav-user.tsx"),
  "utf8"
);

const identity = SOURCE.slice(
  SOURCE.indexOf("export function SidebarIdentity")
);
const identityWrapper = identity.slice(
  identity.indexOf('data-slot="sidebar-identity"'),
  identity.indexOf(">", identity.indexOf('data-slot="sidebar-identity"')) + 1
);
const identityText = identity.slice(
  identity.indexOf('<div className="grid'),
  identity.indexOf("</div>", identity.indexOf('<div className="grid'))
);

test("the passive sidebar identity clips its mounted labels while width collapses", () => {
  assert.match(identityWrapper, /\bw-full\b/);
  assert.match(identityWrapper, /\boverflow-hidden\b/);
  assert.doesNotMatch(
    identityWrapper,
    /group-data-\[collapsible=icon\]:(justify-|p[lrxy]?-|m[lrxy]?-|translate-x-)/,
    "collapsed state must not change the avatar's horizontal geometry"
  );
  assert.doesNotMatch(
    identityWrapper,
    /transition-|duration-|ease-|animate-/,
    "the identity needs no motion when its geometry is invariant"
  );
  assert.doesNotMatch(
    identityText,
    /group-data-\[collapsible=icon\]:(hidden|invisible|opacity-0)/,
    "identity labels must stay mounted and disappear behind the clipping edge"
  );
});

test("the sidebar identity remains passive", () => {
  assert.doesNotMatch(identity, /<(button|a)\b|tabIndex=/);
});
