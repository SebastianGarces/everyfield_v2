import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseElements } from "@/lib/testing/rendered-markup";

const requireFromProject = createRequire(
  path.join(process.cwd(), "package.json")
);
const ReactRuntime = requireFromProject("react") as typeof import("react");
const originalStateHook = ReactRuntime.useState;

type AuthState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

let actionState: AuthState = {};
let queuedStates: unknown[] = [];

Object.defineProperties(ReactRuntime, {
  useActionState: {
    configurable: true,
    value: () => [actionState, () => {}, false],
  },
  useState: {
    configurable: true,
    value: <T>(initialState: T) => {
      if (queuedStates.length > 0) {
        return [queuedStates.shift() as T, () => {}] as const;
      }

      return originalStateHook(initialState);
    },
  },
});

// The forms import their action modules, which initialize the database client.
// Rendering never calls an action, so syntactically valid connection values are
// sufficient.
process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/test";
process.env.RESEND_API_KEY ??= "re_test";

const { LoginForm } = requireFromProject(
  path.join(process.cwd(), "src", "app", "(auth)", "login", "login-form")
) as typeof import("./login/login-form");
const { RegisterForm } = requireFromProject(
  path.join(process.cwd(), "src", "app", "(auth)", "register", "register-form")
) as typeof import("./register/register-form");

function renderLogin(
  state: AuthState,
  pickedPassword: string | null = "known"
) {
  actionState = state;
  const previewAccount = {
    email: "preview@example.com",
    password: pickedPassword,
    name: "Preview account",
    note: "For accessibility coverage",
    group: "Plants & teams" as const,
  };
  queuedStates = ["", "", previewAccount];

  return renderToStaticMarkup(
    createElement(LoginForm, {
      redirectTo: "/dashboard",
      previewAccounts: [previewAccount],
    })
  );
}

function renderRegister(state: AuthState, emailLockedToInvitation = false) {
  actionState = state;
  queuedStates = emailLockedToInvitation ? [] : ["sending_church"];

  return renderToStaticMarkup(
    createElement(RegisterForm, {
      betaGateEnabled: false,
      ...(emailLockedToInvitation
        ? {
            seatInvitation: {
              token: "seat-token",
              inviteeEmail: "invitee@example.com",
              orgName: "Grace Church",
              orgType: "church" as const,
              invitedAs: { kind: "seat" as const, seat: "member" as const },
            },
          }
        : {}),
    })
  );
}

function assertFieldError(
  html: string,
  fieldId: string,
  errorId: string,
  describedBy: string
) {
  const elements = parseElements(html);
  const field = elements.find((element) => element.attrs.id === fieldId);
  const error = elements.find((element) => element.attrs.id === errorId);

  assert.equal(field?.attrs["aria-describedby"], describedBy);
  assert.equal(error?.tag, "p", `${errorId} must render as inline error text`);
}

function assertDescriptionsResolve(html: string) {
  const elements = parseElements(html);
  const ids = new Set(
    elements.flatMap((element) =>
      element.attrs.id === undefined ? [] : [element.attrs.id]
    )
  );

  for (const element of elements) {
    for (const descriptionId of element.attrs["aria-describedby"]?.split(
      /\s+/
    ) ?? []) {
      assert.ok(
        ids.has(descriptionId),
        `${element.attrs.id ?? element.tag} describes an element that is not rendered: ${descriptionId}`
      );
    }
  }
}

test("login field errors have stable descriptions and retain the preview-password help", () => {
  const html = renderLogin(
    {
      fieldErrors: {
        email: "Enter a valid email address.",
        password: "Enter your password.",
      },
    },
    null
  );

  assertFieldError(html, "email", "login-email-error", "login-email-error");
  assertFieldError(
    html,
    "password",
    "login-password-error",
    "preview-account-password-hint login-password-error"
  );
  assertDescriptionsResolve(html);
});

test("registration field errors have stable descriptions and retain the invitation help", () => {
  const html = renderRegister({
    fieldErrors: {
      organizationName: "Enter your church name.",
      name: "Enter your name.",
      email: "Enter a valid email address.",
      password: "Choose a password with at least 8 characters.",
    },
  });

  assertFieldError(
    html,
    "organizationName",
    "register-organization-name-error",
    "register-organization-name-error"
  );
  assertFieldError(html, "name", "register-name-error", "register-name-error");
  assertFieldError(
    html,
    "email",
    "register-email-error",
    "register-email-error"
  );
  assertFieldError(
    html,
    "password",
    "register-password-error",
    "register-password-error"
  );
  assertDescriptionsResolve(html);

  const lockedHtml = renderRegister(
    { fieldErrors: { email: "Enter a valid email address." } },
    true
  );
  assertFieldError(
    lockedHtml,
    "email",
    "register-email-error",
    "email-invitation-note register-email-error"
  );
  assertDescriptionsResolve(lockedHtml);
});

test("registration form-level failures render as an alert without changing their copy", () => {
  const html = renderRegister({ error: "Unable to create your account." });
  const alert = parseElements(html).find(
    (element) => element.attrs.role === "alert"
  );

  assert.equal(alert?.tag, "div");
  assert.match(
    html,
    /role="alert"[^>]*>Unable to create your account\.<\/div>/
  );
});
