"use client";

// ============================================================================
// LOCAL DEVELOPMENT ONLY — searchable account switcher.
//
// Rendered beneath the login form when the app is running locally. Selecting an
// account signs straight in as that user (no password). The page decides
// whether to render this at all; the server action independently refuses to run
// outside local development.
// ============================================================================

import { useActionState, useMemo, useState } from "react";
import { Check, ChevronsUpDown, TriangleAlert } from "lucide-react";

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

import {
  DEV_ACCOUNT_GROUP_ORDER,
  type DevAccount,
  type DevAccountGroup,
} from "./dev-account-types";
import { devLoginAs, type DevLoginState } from "./dev-actions";

const initialState: DevLoginState = {};

/** Compact role label — the raw enum reads poorly in a list. */
const ROLE_LABELS: Record<string, string> = {
  planter: "Planter",
  coach: "Coach",
  team_member: "Team member",
  sending_church_admin: "Sending church",
  network_admin: "Network admin",
};

export function DevAccountSwitcher({
  accounts,
  redirectTo,
}: {
  accounts: DevAccount[];
  redirectTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(devLoginAs, initialState);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  const grouped = useMemo(() => {
    const byGroup = new Map<DevAccountGroup, DevAccount[]>();
    for (const account of accounts) {
      const list = byGroup.get(account.group);
      if (list) list.push(account);
      else byGroup.set(account.group, [account]);
    }
    return DEV_ACCOUNT_GROUP_ORDER.flatMap((group) => {
      const items = byGroup.get(group);
      return items?.length ? [{ group, items }] : [];
    });
  }, [accounts]);

  if (accounts.length === 0) return null;

  return (
    <div className="border-muted-foreground/30 mt-6 w-full max-w-md rounded-lg border border-dashed p-4">
      <div className="mb-3 flex items-center gap-2">
        <TriangleAlert className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Dev account switcher</p>
          <p className="text-muted-foreground text-xs">
            Local development only — signs in without a password.
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="userId" value={selectedId ?? ""} />
        <input type="hidden" name="redirect" value={redirectTo} />

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label="Search accounts"
              className="w-full cursor-pointer justify-between font-normal"
            >
              {selected ? (
                <span className="truncate">
                  {selected.name}
                  <span className="text-muted-foreground">
                    {" · "}
                    {selected.email}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Search accounts by name, email, church, or role…
                </span>
              )}
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            className="w-(--radix-popover-trigger-width) p-0"
            align="start"
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
                        key={account.id}
                        // Everything searchable is folded into the value, so a
                        // church name or role matches as readily as an email.
                        value={[
                          account.name,
                          account.email,
                          account.churchName ?? "",
                          ROLE_LABELS[account.role] ?? account.role,
                        ].join(" ")}
                        onSelect={() => {
                          setSelectedId(account.id);
                          setOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4 shrink-0",
                            account.id === selectedId
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {account.name}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {account.email}
                            {account.churchName
                              ? ` · ${account.churchName}`
                              : ""}
                          </span>
                        </span>
                        <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                          {ROLE_LABELS[account.role] ?? account.role}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {state.error && (
          <p className="text-destructive text-sm">{state.error}</p>
        )}

        <Button
          type="submit"
          variant="secondary"
          className="w-full cursor-pointer"
          disabled={!selectedId || pending}
        >
          {pending ? "Signing in…" : "Sign in as this account"}
        </Button>
      </form>
    </div>
  );
}
