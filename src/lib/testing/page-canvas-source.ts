import assert from "node:assert/strict";
import ts from "typescript";

export interface PageCanvasOpening {
  readonly hasAttachedContext: boolean;
  readonly hasContextItems: boolean;
  readonly hasContextNone: boolean;
  readonly hasContentFocusTarget: boolean;
}

function jsxAttribute(
  node: ts.JsxOpeningLikeElement,
  name: string
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  );
}

function hasStringValue(
  attribute: ts.JsxAttribute | undefined,
  value: string
): boolean {
  return attribute?.initializer !== undefined
    ? ts.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === value
    : false;
}

export function pageCanvasOpenings(
  source: string,
  fileName: string
): PageCanvasOpening[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const openings: PageCanvasOpening[] = [];

  function inspect(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "PageCanvas"
    ) {
      openings.push({
        hasAttachedContext: hasStringValue(
          jsxAttribute(node, "contextAttachment"),
          "attached"
        ),
        hasContextItems: jsxAttribute(node, "contextItems") !== undefined,
        hasContextNone: hasStringValue(jsxAttribute(node, "context"), "none"),
        hasContentFocusTarget:
          jsxAttribute(node, "contentFocusTarget") !== undefined,
      });
    }

    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
  return openings;
}

export function assertPageCanvasContext(
  opening: PageCanvasOpening,
  expected: "attached" | "context-free",
  label: string
) {
  assert.equal(
    opening.hasContextNone &&
      (opening.hasAttachedContext || opening.hasContextItems),
    false,
    `${label} cannot declare context="none" with attached context props on one PageCanvas`
  );

  if (expected === "attached") {
    assert.equal(
      opening.hasAttachedContext,
      true,
      `${label} must attach its context to the same PageCanvas`
    );
    assert.equal(
      opening.hasContextItems,
      true,
      `${label} must pass context items to the same PageCanvas`
    );
    assert.equal(
      opening.hasContextNone,
      false,
      `${label} must not suppress context on its attached PageCanvas`
    );
    return;
  }

  assert.equal(
    opening.hasContextNone,
    true,
    `${label} must suppress context on the same PageCanvas`
  );
  assert.equal(
    opening.hasAttachedContext,
    false,
    `${label} must not attach context on its context-free PageCanvas`
  );
  assert.equal(
    opening.hasContextItems,
    false,
    `${label} must not pass context items to its context-free PageCanvas`
  );
}
