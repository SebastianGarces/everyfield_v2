"use client";

// ============================================================================
// PREVIEW-ONLY — picks a seeded account and asks the login form to submit.
//
// This component owns no form, no server action, no endpoint and no session. It
// writes the chosen account back to `LoginForm`, which owns both field values,
// and its button calls a callback that presses THAT form's own submit — the
// same POST a hand-typed login sends, with the same password check, the same
// rate limiting and the same session issuance. #684 supersedes the UX half of
// #146 (a plain Select the reader had to leave to press "Sign in"); #146's hard
// half stands, and `preview-accounts.ts` carries the whole safety argument.
//
// An oversight admin has no password in the repo, so it degrades per account:
// the email is filled, the password field takes focus, and no sign-in button is
// offered. The account never drops out of the list.
//
// It imports the roster module for its TYPE ONLY. TypeScript erases that, so no
// seeded address reaches a client chunk — the accounts arrive as a prop of a
// preview render. `preview-accounts.test.ts` holds that rule.
// ============================================================================

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { PreviewAccount, PreviewAccountGroup } from "./preview-accounts";

export function PreviewAccountPicker({
  accounts,
  picked,
  pending,
  onPick,
  onSignIn,
}: {
  accounts: PreviewAccount[];
  picked: PreviewAccount | null;
  pending: boolean;
  onPick: (account: PreviewAccount) => void;
  onSignIn: () => void;
}) {
  const [open, setOpen] = useState(false);

  // A closing popover pulls focus back to its trigger, which would undo the
  // password field `LoginForm` focuses for an account whose password is not in
  // the repo. A ref, not state: the close handler reads it as the event fires.
  const reclaimFocus = useRef(true);

  // Grouped in encounter order — the server list is already in the order the
  // sections should appear, so there is no second ordering to keep in step.
  const grouped = useMemo(() => {
    const sections: {
      group: PreviewAccountGroup;
      items: PreviewAccount[];
    }[] = [];
    for (const account of accounts) {
      const last = sections.at(-1);
      if (last?.group === account.group) last.items.push(account);
      else sections.push({ group: account.group, items: [account] });
    }
    return sections;
  }, [accounts]);

  if (accounts.length === 0) return null;

  return (
    <div
      data-testid="preview-account-picker"
      // The dev account switcher's own block, to the class — the picker sits in
      // the same slot beneath the card and should read as the same kind of
      // scaffolding, not as part of the product.
      className="border-muted-foreground/30 mt-6 w-full max-w-md space-y-3 rounded-lg border border-dashed p-4"
    >
      <div className="flex items-center gap-2">
        <FlaskConical className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Preview QA accounts</p>
          <p className="text-muted-foreground text-xs">
            Picks an account and signs in as it. Oversight admins still need
            their password typed.
          </p>
        </div>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Search seeded accounts"
            className="w-full cursor-pointer justify-between font-normal"
          >
            {picked ? (
              <span className="truncate">
                {picked.name}
                <span className="text-muted-foreground">
                  {" · "}
                  {picked.email}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Search accounts by name, email, or note…
              </span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
          onCloseAutoFocus={(event) => {
            if (!reclaimFocus.current) event.preventDefault();
            reclaimFocus.current = true;
          }}
        >
          <Command
            filter={(value, search) =>
              value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder="Type to filter…" />
            <CommandList>
              <CommandEmpty>No account matches.</CommandEmpty>
              {grouped.map(({ group, items }) => (
                <CommandGroup key={group} heading={group}>
                  {items.map((account) => (
                    <CommandItem
                      key={account.email}
                      // Everything searchable is folded into the value, so a
                      // note matches as readily as an email.
                      value={[account.name, account.email, account.note].join(
                        " "
                      )}
                      onSelect={() => {
                        reclaimFocus.current = account.password !== null;
                        onPick(account);
                        setOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 size-4 shrink-0",
                          account.email === picked?.email
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {account.name}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {account.email} · {account.note}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {picked?.password === null ? (
        <p
          data-testid="preview-account-password-hint"
          className="text-muted-foreground text-xs"
        >
          This account&apos;s password is not in the repo. Read{" "}
          <code className="font-mono">SEED_ADMIN_PASSWORD</code> from{" "}
          <code className="font-mono">.env.local</code> and type it.
        </p>
      ) : (
        picked && (
          // A plain button, not a submit: this block is not a form. It presses
          // the login form's own submit through the callback.
          <Button
            type="button"
            variant="secondary"
            className="w-full cursor-pointer"
            onClick={onSignIn}
            disabled={pending}
          >
            {pending ? "Signing in…" : "Sign in as this account"}
          </Button>
        )
      )}
    </div>
  );
}
