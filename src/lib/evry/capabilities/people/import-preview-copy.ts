import type { ImportRow } from "@/lib/people/types";

const fieldLabels: Readonly<Record<string, string>> = {
  firstName: "first name",
  lastName: "last name",
  email: "email address",
  phone: "phone number",
  source: "source",
  addressLine1: "street address",
  addressLine2: "address details",
  city: "city",
  state: "state or region",
  postalCode: "postal code",
  country: "country",
  notes: "notes",
};

/** Validation stays with the importer; the chat never displays its parser diagnostics. */
export function importPreviewIssues(row: Pick<ImportRow, "data" | "errors">) {
  return [
    ...new Set(
      row.errors.map((error) => {
        const field = error.slice(0, error.indexOf(":"));
        if (field === "firstName" && !row.data.firstName?.trim())
          return "Add a first name.";
        if (field === "lastName" && !row.data.lastName?.trim())
          return "Add a last name.";
        const label = Object.hasOwn(fieldLabels, field)
          ? fieldLabels[field]
          : undefined;
        return label ? `Check the ${label}.` : "Review the values in this row.";
      })
    ),
  ];
}
