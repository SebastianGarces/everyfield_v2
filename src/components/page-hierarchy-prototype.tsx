"use client";

import {
  PrototypeSwitcher,
  prototypeInitScript,
} from "@/components/prototype-switcher";

const ATTRIBUTE = "data-auth-page-hierarchy";
const STORAGE_KEY = "auth-page-hierarchy-prototype";

export function PageHierarchyPrototype() {
  return (
    <>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: prototypeInitScript(ATTRIBUTE, STORAGE_KEY, ["a", "b"]),
        }}
      />
      <PrototypeSwitcher
        attribute={ATTRIBUTE}
        storageKey={STORAGE_KEY}
        label="Page hierarchy"
        options={[
          {
            id: "a",
            label: "A · Canvas row",
            hint: "Breadcrumbs sit in a compact unboxed row above sibling surfaces.",
          },
          {
            id: "b",
            label: "B · Surface header",
            hint: "Breadcrumbs become the header of the primary page surface.",
          },
        ]}
      />
    </>
  );
}
