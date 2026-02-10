"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { AccountType } from "@/lib/validations/auth";
import Link from "next/link";
import { useActionState, useState } from "react";
import { register, type RegisterState } from "./actions";

const initialState: RegisterState = {};

const ACCOUNT_TYPE_CONFIG: Record<
  AccountType,
  {
    label: string;
    description: string;
    orgLabel: string;
    orgPlaceholder: string;
  }
> = {
  planter: {
    label: "Church Planter",
    description: "I'm planting a new church",
    orgLabel: "Church plant name",
    orgPlaceholder: "e.g., Grace Community Church",
  },
  sending_church: {
    label: "Sending Church",
    description: "I'm a sending church overseeing planters",
    orgLabel: "Sending church name",
    orgPlaceholder: "e.g., First Baptist Church",
  },
  network: {
    label: "Church Planting Network",
    description: "I'm a network overseeing sending churches and planters",
    orgLabel: "Network name",
    orgPlaceholder: "e.g., Send Network",
  },
};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(register, initialState);
  const [accountType, setAccountType] = useState<AccountType>("planter");

  const config = ACCOUNT_TYPE_CONFIG[accountType];

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>
          Get started with EveryField by choosing your role
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <input type="hidden" name="accountType" value={accountType} />
        <CardContent className="space-y-6">
          {state.error && (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              {state.error}
            </div>
          )}

          {/* Account Type Selection */}
          <div className="space-y-3">
            <Label>I am a...</Label>
            <RadioGroup
              value={accountType}
              onValueChange={(v) => setAccountType(v as AccountType)}
              className="gap-3"
            >
              {(
                Object.entries(ACCOUNT_TYPE_CONFIG) as [
                  AccountType,
                  (typeof ACCOUNT_TYPE_CONFIG)[AccountType],
                ][]
              ).map(([type, cfg]) => (
                <label
                  key={type}
                  className="border-input has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                >
                  <RadioGroupItem value={type} className="mt-0.5 cursor-pointer" />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{cfg.label}</div>
                    <div className="text-muted-foreground text-xs">
                      {cfg.description}
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* Organization Name (only for sending church / network) */}
          {accountType !== "planter" && (
            <div className="space-y-2">
              <Label htmlFor="organizationName">{config.orgLabel}</Label>
              <Input
                id="organizationName"
                name="organizationName"
                type="text"
                placeholder={config.orgPlaceholder}
                required
                aria-invalid={!!state.fieldErrors?.organizationName}
              />
              {state.fieldErrors?.organizationName && (
                <p className="text-destructive text-sm">
                  {state.fieldErrors.organizationName}
                </p>
              )}
            </div>
          )}

          {/* Personal Details */}
          <div className="space-y-2">
            <Label htmlFor="name">Your full name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder="John Smith"
              autoComplete="name"
              required
              aria-invalid={!!state.fieldErrors?.name}
            />
            {state.fieldErrors?.name && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              aria-invalid={!!state.fieldErrors?.email}
            />
            {state.fieldErrors?.email && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
              aria-invalid={!!state.fieldErrors?.password}
            />
            {state.fieldErrors?.password && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.password}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Must be at least 8 characters
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full cursor-pointer"
            disabled={pending}
          >
            {pending ? "Creating account..." : "Create account"}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
