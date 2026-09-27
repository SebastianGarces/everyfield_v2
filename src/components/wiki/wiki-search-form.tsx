"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { wikiContentTypes } from "@/db/schema/wiki";
import type { WikiSearchParams } from "@/lib/wiki/search-params";

export function WikiSearchForm({ params }: { params: WikiSearchParams }) {
  return (
    <form action="/wiki/search" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="wiki-query">Search Wiki</Label>
        <div className="flex gap-2">
          <Input
            id="wiki-query"
            name="q"
            defaultValue={params.q}
            maxLength={200}
            placeholder="Search articles…"
          />
          <Button type="submit">Search</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Select name="type" defaultValue={params.type ?? "all"}>
          <SelectTrigger
            aria-label="Content type"
            className="w-40 cursor-pointer"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="cursor-pointer">
              All types
            </SelectItem>
            {wikiContentTypes.map((type) => (
              <SelectItem
                key={type}
                value={type}
                className="cursor-pointer capitalize"
              >
                {type.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          name="phase"
          defaultValue={
            params.phase === undefined ? "all" : String(params.phase)
          }
        >
          <SelectTrigger aria-label="Phase" className="w-36 cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="cursor-pointer">
              All phases
            </SelectItem>
            {Array.from({ length: 7 }, (_, phase) => (
              <SelectItem
                key={phase}
                value={String(phase)}
                className="cursor-pointer"
              >
                Phase {phase}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select name="sort" defaultValue={params.sort}>
          <SelectTrigger
            aria-label="Sort results"
            className="w-40 cursor-pointer"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance" className="cursor-pointer">
              Relevance
            </SelectItem>
            <SelectItem value="recent" className="cursor-pointer">
              Recently updated
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </form>
  );
}
