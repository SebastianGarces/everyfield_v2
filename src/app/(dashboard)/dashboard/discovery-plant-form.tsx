"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INVITE_ORIGIN_SHARING_CONSENT } from "@/lib/notifications/categories";
import { createDiscoveryPlant } from "./discovery-actions";

export function DiscoveryPlantForm({
  associations,
}: {
  associations: readonly {
    orgType: "sending_church" | "network";
    orgId: string;
    orgName: string;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, action, pending] = useActionState(createDiscoveryPlant, {});
  if (!open)
    return (
      <Button
        className="cursor-pointer"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        Create a plant
      </Button>
    );
  return (
    <form action={action} className="space-y-4 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">Create your church plant</h2>
      <p className="text-muted-foreground text-sm">
        Your saved articles and coaching assignments stay with your account.
      </p>
      <input
        type="hidden"
        name="sendingChurchId"
        value={
          associations.find((org) => org.orgType === "sending_church")?.orgId ??
          ""
        }
      />
      <input
        type="hidden"
        name="sendingNetworkId"
        value={
          associations.find((org) => org.orgType === "network")?.orgId ?? ""
        }
      />
      <div className="space-y-2">
        <Label htmlFor="discovery-plant-name">Church plant name</Label>
        <Input
          id="discovery-plant-name"
          autoFocus
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={255}
          autoComplete="organization"
        />
      </div>
      {associations.length > 0 && (
        <div className="space-y-3 text-sm">
          <p>Your plant will keep these associations:</p>
          <ul className="list-inside list-disc">
            {associations.map((org) => (
              <li key={org.orgType}>{org.orgName}</li>
            ))}
          </ul>
          <details open>
            <summary className="cursor-pointer font-medium">
              Review sharing settings
            </summary>
            <div className="text-muted-foreground mt-3 space-y-2">
              {INVITE_ORIGIN_SHARING_CONSENT.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          </details>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              className="mt-1 cursor-pointer"
              type="checkbox"
              name="sharingConsent"
              required
            />
            <span>I agree to start my plant with these sharing settings.</span>
          </label>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className="cursor-pointer" type="submit" disabled={pending}>
          {pending ? "Creating plant…" : "Create plant"}
        </Button>
        <Button
          className="cursor-pointer"
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
