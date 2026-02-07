"use client";

import { Check, Plus } from "lucide-react";
import { useState, useTransition } from "react";

import {
  assignTagAction,
  createTagAction,
  removeTagAction,
} from "@/app/(dashboard)/people/actions";
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
import type { Tag } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { TagBadge } from "./tag-badge";

interface TagPickerProps {
  personId: string;
  selectedTags: Tag[];
  availableTags: Tag[];
  onTagsChange?: () => void;
}

export function TagPicker({
  personId,
  selectedTags,
  availableTags,
  onTagsChange,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newTagColor, setNewTagColor] = useState<string>("gray");

  const selectedTagIds = new Set(selectedTags.map((tag) => tag.id));

  const handleSelectTag = (tag: Tag) => {
    startTransition(async () => {
      if (selectedTagIds.has(tag.id)) {
        await removeTagAction(personId, tag.id);
      } else {
        await assignTagAction(personId, tag.id);
      }
      onTagsChange?.();
    });
  };

  const handleCreateTag = () => {
    if (!searchValue.trim()) return;

    startTransition(async () => {
      setIsCreating(true);
      const result = await createTagAction(searchValue, newTagColor);

      if (result.success && result.data) {
        // Automatically assign the new tag
        await assignTagAction(personId, result.data.id);
        setSearchValue("");
        setNewTagColor("gray");
        onTagsChange?.();
      }
      setIsCreating(false);
    });
  };

  const colors = [
    "gray",
    "blue",
    "green",
    "red",
    "yellow",
    "purple",
    "pink",
    "orange",
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {selectedTags.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={() => handleSelectTag(tag)}
          />
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-full border-dashed px-2 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search tags..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty className="p-2">
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-center text-sm">
                      No tags found.
                    </p>
                    <div className="bg-muted/20 flex flex-col gap-2 rounded-md border p-1">
                      <p className="px-1 text-xs font-medium">
                        Create "{searchValue}"
                      </p>
                      <div className="flex flex-wrap gap-1 px-1">
                        {colors.map((color) => (
                          <button
                            key={color}
                            onClick={() => setNewTagColor(color)}
                            className={cn(
                              "h-4 w-4 rounded-full border transition-all",
                              newTagColor === color
                                ? "ring-primary scale-110 ring-2 ring-offset-1"
                                : "hover:scale-110",
                              {
                                "bg-gray-500": color === "gray",
                                "bg-blue-500": color === "blue",
                                "bg-green-500": color === "green",
                                "bg-red-500": color === "red",
                                "bg-yellow-500": color === "yellow",
                                "bg-purple-500": color === "purple",
                                "bg-pink-500": color === "pink",
                                "bg-orange-500": color === "orange",
                              }
                            )}
                            title={color}
                          />
                        ))}
                      </div>
                      <Button
                        size="sm"
                        className="mt-1 h-7 w-full text-xs"
                        onClick={handleCreateTag}
                        disabled={isCreating || !searchValue.trim()}
                      >
                        {isCreating ? "Creating..." : "Create & Add"}
                      </Button>
                    </div>
                  </div>
                </CommandEmpty>
                <CommandGroup heading="Available Tags">
                  {availableTags.map((tag) => (
                    <CommandItem
                      key={tag.id}
                      onSelect={() => handleSelectTag(tag)}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={cn("h-2 w-2 rounded-full", {
                            "bg-gray-500": !tag.color || tag.color === "gray",
                            "bg-blue-500": tag.color === "blue",
                            "bg-green-500": tag.color === "green",
                            "bg-red-500": tag.color === "red",
                            "bg-yellow-500": tag.color === "yellow",
                            "bg-purple-500": tag.color === "purple",
                            "bg-pink-500": tag.color === "pink",
                            "bg-orange-500": tag.color === "orange",
                          })}
                          style={
                            tag.color?.startsWith("#")
                              ? { backgroundColor: tag.color }
                              : {}
                          }
                        />
                        <span>{tag.name}</span>
                      </div>
                      {selectedTagIds.has(tag.id) && (
                        <Check className="h-4 w-4 opacity-100" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
