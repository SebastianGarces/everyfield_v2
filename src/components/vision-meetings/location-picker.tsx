"use client";

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
import { MapPin, Plus } from "lucide-react";
import { useState } from "react";

interface LocationPickerProps {
  locations: Location[];
  selectedLocationId?: string;
  onLocationChange: (locationId: string | undefined) => void;
  defaultLocationName?: string;
  defaultLocationAddress?: string;
}

export function LocationPicker({
  locations,
  selectedLocationId,
  onLocationChange,
  defaultLocationName,
  defaultLocationAddress,
}: LocationPickerProps) {
  const [mode, setMode] = useState<"select" | "new">(
    selectedLocationId || !defaultLocationName ? "select" : "new"
  );

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
            onLocationChange(undefined);
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
          <input
            type="hidden"
            name="locationId"
            value={selectedLocationId ?? ""}
          />
          <Select
            value={selectedLocationId ?? ""}
            onValueChange={(value) => onLocationChange(value || undefined)}
          >
            <SelectTrigger className="cursor-pointer">
              <SelectValue placeholder="Select a saved location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((loc) => (
                <SelectItem
                  key={loc.id}
                  value={loc.id}
                  className="cursor-pointer"
                >
                  {loc.name} - {loc.address}
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
