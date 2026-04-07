"use client";

import { useState } from "react";
import { Plus, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Location } from "@/db/schema";

interface LocationPickerProps {
  locations: Location[];
  defaultLocationId?: string;
  defaultLocationName?: string;
  defaultLocationAddress?: string;
}

export function LocationPicker({
  locations,
  defaultLocationId,
  defaultLocationName,
  defaultLocationAddress,
}: LocationPickerProps) {
  const [mode, setMode] = useState<"select" | "new">(
    defaultLocationId || !defaultLocationName ? "select" : "new"
  );
  const [locationId, setLocationId] = useState<string>(defaultLocationId ?? "");

  return (
    <div className="space-y-3">
      <Label>Location</Label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("select")}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "select"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <MapPin className="mr-1.5 inline-block h-3.5 w-3.5" />
          Saved Location
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("new");
            setLocationId("");
          }}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "new"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <Plus className="mr-1.5 inline-block h-3.5 w-3.5" />
          New Location
        </button>
      </div>

      {mode === "select" ? (
        <div className="space-y-2">
          <input type="hidden" name="locationId" value={locationId} />
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue placeholder="Select a saved location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((loc) => (
                <SelectItem
                  key={loc.id}
                  value={loc.id}
                  className="cursor-pointer"
                >
                  <span className="truncate">
                    {loc.name} — {loc.address}
                  </span>
                </SelectItem>
              ))}
              {locations.length === 0 && (
                <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                  No saved locations yet
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label htmlFor="locationName">Location Name</Label>
            <Input
              id="locationName"
              name="locationName"
              placeholder="e.g., Community Center"
              defaultValue={defaultLocationName ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="locationAddress">Address</Label>
            <Input
              id="locationAddress"
              name="locationAddress"
              placeholder="e.g., 123 Main St, City, State"
              defaultValue={defaultLocationAddress ?? ""}
            />
          </div>
        </div>
      )}
    </div>
  );
}
