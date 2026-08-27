import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src");
const PRIVACY_PAGE = path.join(SOURCE_ROOT, "app/(marketing)/privacy/page.tsx");

type CookieWriter = {
  file: string;
  purpose:
    | "session authentication"
    | "sidebar preference"
    | "task-import receipt";
  writes: number;
};

const EXPECTED_COOKIE_WRITERS: CookieWriter[] = [
  {
    file: "src/app/(dashboard)/tasks/phase-prompt-actions.ts",
    purpose: "task-import receipt",
    writes: 1,
  },
  {
    file: "src/components/tasks/phase-template-prompt-controls.tsx",
    purpose: "task-import receipt",
    writes: 1,
  },
  {
    file: "src/components/ui/sidebar.tsx",
    purpose: "sidebar preference",
    writes: 1,
  },
  {
    file: "src/lib/auth/cookies.ts",
    purpose: "session authentication",
    writes: 2,
  },
  {
    file: "src/proxy.ts",
    purpose: "session authentication",
    writes: 1,
  },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
      ? [entryPath]
      : [];
  });
}

function isCookiesCall(expression: ts.Expression): boolean {
  const unwrapped = ts.isAwaitExpression(expression)
    ? expression.expression
    : expression;

  return (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === "cookies"
  );
}

function isSetCookieHeader(name: ts.Expression | undefined): boolean {
  return (
    name !== undefined &&
    ts.isStringLiteralLike(name) &&
    name.text.toLowerCase() === "set-cookie"
  );
}

function cookieWriteCount(source: string, fileName = "source.ts"): number {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const cookieStores = new Set<string>();
  let writes = 0;

  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCookiesCall(node.initializer)
    ) {
      cookieStores.add(node.name.text);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === "document" &&
      node.left.name.text === "cookie"
    ) {
      writes += 1;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const { expression: receiver, name } = node.expression;
      const method = name.text;
      const isCookieMethod = method === "set" || method === "delete";
      const isCookieStore =
        ts.isIdentifier(receiver) && cookieStores.has(receiver.text);
      const isCookiesProperty =
        ts.isPropertyAccessExpression(receiver) &&
        receiver.name.text === "cookies";
      const isDirectCookiesCall = isCookiesCall(receiver);
      const isSetCookieHeaderWrite =
        (method === "set" || method === "append") &&
        isSetCookieHeader(node.arguments[0]);

      if (
        (isCookieMethod &&
          (isCookieStore || isCookiesProperty || isDirectCookiesCall)) ||
        isSetCookieHeaderWrite
      ) {
        writes += 1;
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteralLike(node.name) &&
      node.name.text.toLowerCase() === "set-cookie"
    ) {
      writes += 1;
    }

    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return writes;
}

function repositoryCookieWriters(): CookieWriter[] {
  const found = sourceFiles(SOURCE_ROOT).flatMap((file): CookieWriter[] => {
    const source = readFileSync(file, "utf8");
    const relativePath = path.relative(ROOT, file);
    const writes = cookieWriteCount(source, relativePath);

    if (writes === 0) return [];

    const expected = EXPECTED_COOKIE_WRITERS.find(
      ({ file: expectedFile }) => expectedFile === relativePath
    );

    return [
      {
        file: relativePath,
        purpose: expected?.purpose ?? "session authentication",
        writes,
      },
    ];
  });

  assert.deepEqual(
    found.sort((a, b) => a.file.localeCompare(b.file)),
    EXPECTED_COOKIE_WRITERS.toSorted((a, b) => a.file.localeCompare(b.file)),
    "a cookie writer changed; update this inventory and the privacy disclosure together"
  );

  return found;
}

test("the inventory detects every supported cookie-writing syntax", () => {
  assert.equal(
    cookieWriteCount(`
      const savedStore = await cookies();
      savedStore.set("session", "token");
      response.cookies.delete("session");
      cookies().set("session", "token");
      cookies().delete("session");
      document.cookie = "sidebar_state=true";
      headers.set("Set-Cookie", "session=token");
      headers.append("set-cookie", "sidebar_state=true");
      new Response(null, { headers: { "Set-Cookie": "receipt=shown" } });
    `),
    8
  );
});

test("the privacy disclosure names every application cookie purpose", () => {
  const page = readFileSync(PRIVACY_PAGE, "utf8");

  assert.match(page, /keep you signed in/);
  assert.match(page, /sidebar is open or closed/);
  assert.match(page, /task-import\s+receipt/);
  assert.doesNotMatch(page, /only cookie we set/i);
});

test("the no-advertising or tracking-cookie statement is backed by the cookie inventory", () => {
  const page = readFileSync(PRIVACY_PAGE, "utf8");

  assert.match(page, /don&rsquo;t run advertising or tracking\s+cookies/i);
  assert.deepEqual(repositoryCookieWriters(), EXPECTED_COOKIE_WRITERS);
});
