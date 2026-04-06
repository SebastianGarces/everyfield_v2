import type { ZodTypeAny } from "zod";

export const apiSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { cookieAuth: [] },
];

export function jsonContent(schema: ZodTypeAny, description: string) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
    description,
  };
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function getErrorStatus(message: string): 400 | 401 | 403 | 404 {
  const normalized = message.toLowerCase();

  if (normalized.includes("unauthorized")) {
    return 401;
  }

  if (normalized.includes("forbidden") || normalized.includes("read-only")) {
    return 403;
  }

  if (normalized.includes("not found")) {
    return 404;
  }

  return 400;
}
