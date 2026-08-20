"use client";

// ============================================================================
// PREVIEW-ONLY — fills the login form. It does NOT sign anyone in.
//
// This component has no action, no form and no submit. It hands the chosen
// account back to `LoginForm`, which owns both field values, and the reader
// presses "Sign in" like anyone else. See `preview-accounts.ts` for why that
// distinction is the whole safety argument.
//
// It imports the roster module for its TYPE ONLY. TypeScript erases that, so no
// seeded address reaches a client chunk — the accounts arrive as a prop of a
// preview render. `preview-accounts.test.ts` holds that rule.
// ============================================================================

import { FlaskConical } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { PreviewAccount, PreviewAccountGroup } from "./preview-accounts";

export function PreviewAccountPicker({
  accounts,
  picked,
  onPick,
}: {
  accounts: PreviewAccount[];
  picked: PreviewAccount | null;
  onPick: (account: PreviewAccount) => void;
}) {
  if (accounts.length === 0) return null;

  // Grouped in encounter order — the server list is already in the order the
  // sections should appear, so there is no second ordering to keep in step.
  const grouped: { group: PreviewAccountGroup; items: PreviewAccount[] }[] = [];
  for (const account of accounts) {
    const last = grouped.at(-1);
    if (last?.group === account.group) last.items.push(account);
    else grouped.push({ group: account.group, items: [account] });
  }

  return (
    <div
      data-testid="preview-account-picker"
      className="border-muted-foreground/30 space-y-3 rounded-lg border border-dashed p-3"
    >
      <div className="flex items-center gap-2">
        <FlaskConical className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Preview QA accounts</p>
          <p className="text-muted-foreground text-xs">
            Fills the form below. You still sign in.
          </p>
        </div>
      </div>

      <Select
        value={picked?.email ?? ""}
        onValueChange={(email) => {
          const account = accounts.find((a) => a.email === email);
          if (account) onPick(account);
        }}
      >
        <SelectTrigger
          aria-label="Fill a seeded account"
          className="w-full cursor-pointer"
        >
          <SelectValue placeholder="Pick a seeded account…" />
        </SelectTrigger>
        <SelectContent>
          {grouped.map(({ group, items }) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {items.map((account) => (
                <SelectItem
                  key={account.email}
                  value={account.email}
                  className="cursor-pointer"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {account.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {account.email} · {account.note}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {picked?.password === null && (
        <p
          data-testid="preview-account-password-hint"
          className="text-muted-foreground text-xs"
        >
          This account&apos;s password is not in the repo. Read{" "}
          <code className="font-mono">SEED_ADMIN_PASSWORD</code> from{" "}
          <code className="font-mono">.env.local</code> and type it.
        </p>
      )}
    </div>
  );
}
