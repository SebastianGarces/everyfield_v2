import { readFileSync } from "node:fs";

import ts from "typescript";

export const MEETINGS_PAGE_SOURCES = Object.freeze([
  "src/app/(dashboard)/meetings/page.tsx",
  "src/app/(dashboard)/meetings/new/page.tsx",
  "src/app/(dashboard)/meetings/[id]/layout.tsx",
  "src/app/(dashboard)/meetings/[id]/page.tsx",
  "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
  "src/app/(dashboard)/meetings/[id]/analytics/page.tsx",
  "src/app/(dashboard)/meetings/[id]/evaluation/page.tsx",
  "src/app/(dashboard)/meetings/[id]/invitations/page.tsx",
  "src/app/(dashboard)/meetings/[id]/logistics/page.tsx",
  "src/app/(dashboard)/meetings/[id]/outcomes/page.tsx",
  "src/app/(dashboard)/teams/[teamId]/meetings/page.tsx",
] as const);

const identity = (source: string, imported: string) =>
  `read-operation:${source} → ${imported}`;

const boundaryExclusion = (source: string, imported: string, reason: string) =>
  Object.freeze({ identity: identity(source, imported), reason });

export const MEETINGS_DISCOVERED_READ_EXCLUSIONS = Object.freeze([
  ...MEETINGS_PAGE_SOURCES.map((source) =>
    boundaryExclusion(
      source,
      "verifySession",
      "Shared authentication boundary, not Meetings domain data."
    )
  ),
  boundaryExclusion(
    "src/app/(dashboard)/meetings/page.tsx",
    "getCurrentUserChurch",
    "Shared plant navigation context, not Meetings domain data."
  ),
  boundaryExclusion(
    "src/app/(dashboard)/meetings/[id]/layout.tsx",
    "getCurrentUserChurch",
    "Shared plant navigation context, not Meetings domain data."
  ),
  boundaryExclusion(
    "src/app/(dashboard)/meetings/[id]/page.tsx",
    "eq",
    "Drizzle query construction helper, not a data operation."
  ),
  boundaryExclusion(
    "src/app/(dashboard)/meetings/[id]/page.tsx",
    "churches",
    "Shared plant-name context, not Meetings domain data."
  ),
]);

function isAwaited(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  for (
    let current = node.parent;
    current && current !== sourceFile;
    current = current.parent
  ) {
    if (ts.isAwaitExpression(current)) return true;
  }
  return false;
}

/** Discover every imported call whose result participates in an awaited page read. */
export function discoverMeetingsPageReadOperations(): readonly string[] {
  const discovered = new Set<string>();
  for (const source of MEETINGS_PAGE_SOURCES) {
    const text = readFileSync(source, "utf8");
    const sourceFile = ts.createSourceFile(
      source,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const importedByLocalName = new Map<string, string>();
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      for (const element of statement.importClause.namedBindings.elements) {
        importedByLocalName.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text
        );
      }
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        isAwaited(node, sourceFile)
      ) {
        const imported = importedByLocalName.get(node.expression.text);
        if (imported) discovered.add(identity(source, imported));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    if (/\.from\(churches\)/.test(text)) {
      discovered.add(identity(source, "churches"));
    }
  }
  return Object.freeze([...discovered].toSorted());
}
