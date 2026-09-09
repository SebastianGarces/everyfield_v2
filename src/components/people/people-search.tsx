"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function PeopleSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full md:w-[300px]">
      <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
      <Input
        type="search"
        aria-label="Search people"
        placeholder="Search people..."
        className="bg-background w-full pl-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
