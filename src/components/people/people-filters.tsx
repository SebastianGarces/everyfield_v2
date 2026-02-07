"use client";

import { Filter, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { personSources, personStatuses, Tag } from "@/lib/people/types";

interface PeopleFiltersProps {
  availableTags?: Tag[];
}

export function PeopleFilters({ availableTags = [] }: PeopleFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get current filters
  const selectedStatuses = searchParams.getAll("status");
  const selectedSources = searchParams.getAll("source");
  const selectedTags = searchParams.getAll("tag");

  // Create a new URLSearchParams object to manipulate
  const createQueryString = useCallback(
    (name: string, value: string, type: "add" | "remove" | "clear") => {
      const params = new URLSearchParams(searchParams.toString());

      if (type === "clear") {
        params.delete(name);
      } else if (type === "add") {
        params.append(name, value);
      } else if (type === "remove") {
        const values = params.getAll(name);
        params.delete(name);
        values
          .filter((v) => v !== value)
          .forEach((v) => params.append(name, v));
      }

      // Reset cursor when filters change
      params.delete("cursor");

      return params.toString();
    },
    [searchParams]
  );

  const toggleFilter = (name: string, value: string) => {
    const currentValues = searchParams.getAll(name);
    const isActive = currentValues.includes(value);

    router.push(
      `?${createQueryString(name, value, isActive ? "remove" : "add")}`
    );
  };

  const clearFilters = () => {
    router.push("?");
  };

  const hasFilters =
    selectedStatuses.length > 0 ||
    selectedSources.length > 0 ||
    selectedTags.length > 0;

  const formatLabel = (value: string) => {
    return value
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const getTagName = (id: string) => {
    return availableTags.find((t) => t.id === id)?.name || "Unknown Tag";
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <Filter className="mr-2 h-4 w-4" />
            Status
            {selectedStatuses.length > 0 && (
              <>
                <Separator orientation="vertical" className="mx-2 h-4" />
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1 font-normal lg:hidden"
                >
                  {selectedStatuses.length}
                </Badge>
                <div className="hidden space-x-1 lg:flex">
                  {selectedStatuses.length > 2 ? (
                    <Badge
                      variant="secondary"
                      className="rounded-sm px-1 font-normal"
                    >
                      {selectedStatuses.length} selected
                    </Badge>
                  ) : (
                    selectedStatuses.map((status) => (
                      <Badge
                        variant="secondary"
                        key={status}
                        className="rounded-sm px-1 font-normal"
                      >
                        {formatLabel(status)}
                      </Badge>
                    ))
                  )}
                </div>
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[200px]">
          <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {personStatuses.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={selectedStatuses.includes(status)}
              onCheckedChange={() => toggleFilter("status", status)}
            >
              {formatLabel(status)}
            </DropdownMenuCheckboxItem>
          ))}
          {selectedStatuses.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                onCheckedChange={() =>
                  router.push(`?${createQueryString("status", "", "clear")}`)
                }
                className="justify-center text-center"
              >
                Clear filters
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <Filter className="mr-2 h-4 w-4" />
            Source
            {selectedSources.length > 0 && (
              <>
                <Separator orientation="vertical" className="mx-2 h-4" />
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1 font-normal lg:hidden"
                >
                  {selectedSources.length}
                </Badge>
                <div className="hidden space-x-1 lg:flex">
                  {selectedSources.length > 2 ? (
                    <Badge
                      variant="secondary"
                      className="rounded-sm px-1 font-normal"
                    >
                      {selectedSources.length} selected
                    </Badge>
                  ) : (
                    selectedSources.map((source) => (
                      <Badge
                        variant="secondary"
                        key={source}
                        className="rounded-sm px-1 font-normal"
                      >
                        {formatLabel(source)}
                      </Badge>
                    ))
                  )}
                </div>
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[200px]">
          <DropdownMenuLabel>Filter by source</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {personSources.map((source) => (
            <DropdownMenuCheckboxItem
              key={source}
              checked={selectedSources.includes(source)}
              onCheckedChange={() => toggleFilter("source", source)}
            >
              {formatLabel(source)}
            </DropdownMenuCheckboxItem>
          ))}
          {selectedSources.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                onCheckedChange={() =>
                  router.push(`?${createQueryString("source", "", "clear")}`)
                }
                className="justify-center text-center"
              >
                Clear filters
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {availableTags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 border-dashed">
              <Filter className="mr-2 h-4 w-4" />
              Tags
              {selectedTags.length > 0 && (
                <>
                  <Separator orientation="vertical" className="mx-2 h-4" />
                  <Badge
                    variant="secondary"
                    className="rounded-sm px-1 font-normal lg:hidden"
                  >
                    {selectedTags.length}
                  </Badge>
                  <div className="hidden space-x-1 lg:flex">
                    {selectedTags.length > 2 ? (
                      <Badge
                        variant="secondary"
                        className="rounded-sm px-1 font-normal"
                      >
                        {selectedTags.length} selected
                      </Badge>
                    ) : (
                      selectedTags.map((tagId) => (
                        <Badge
                          variant="secondary"
                          key={tagId}
                          className="rounded-sm px-1 font-normal"
                        >
                          {getTagName(tagId)}
                        </Badge>
                      ))
                    )}
                  </div>
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[200px]">
            <DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {availableTags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={selectedTags.includes(tag.id)}
                onCheckedChange={() => toggleFilter("tag", tag.id)}
              >
                {tag.name}
              </DropdownMenuCheckboxItem>
            ))}
            {selectedTags.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  onCheckedChange={() =>
                    router.push(`?${createQueryString("tag", "", "clear")}`)
                  }
                  className="justify-center text-center"
                >
                  Clear filters
                </DropdownMenuCheckboxItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {hasFilters && (
        <Button
          variant="ghost"
          onClick={clearFilters}
          className="h-8 px-2 lg:px-3"
        >
          Reset
          <X className="ml-2 h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
