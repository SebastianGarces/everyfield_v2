import type { z } from "zod";

/**
 * Extracts field errors from a Zod error object into a flat record.
 * Takes the first error message for each field.
 */
export function extractFieldErrors<T extends Record<string, string | undefined>>(
  error: z.core.$ZodError
): T {
  const fieldErrors = {} as T;

  for (const issue of error.issues) {
    const field = issue.path[0] as keyof T;
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = issue.message as T[keyof T];
    }
  }

  return fieldErrors;
}
