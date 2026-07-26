"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DocumentMergeValues, DocumentTemplate } from "@/lib/documents";

import { GenerateDialog } from "./generate-dialog";

interface TemplateCardProps {
  template: DocumentTemplate;
  defaults: DocumentMergeValues;
}

export function TemplateCard({ template, defaults }: TemplateCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardHeader>
          <div className="text-muted-foreground mb-2">
            <FileText className="h-6 w-6" />
          </div>
          <CardTitle className="text-base leading-snug">
            {template.name}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {template.formats.map((format) => (
              <Badge
                key={format}
                variant="secondary"
                className="text-xs uppercase"
              >
                {format}
              </Badge>
            ))}
            <Badge variant="outline" className="text-xs">
              {template.pageCount} page{template.pageCount === 1 ? "" : "s"}
            </Badge>
            {typeof template.phase === "number" && (
              <Badge variant="outline" className="text-xs">
                Phase {template.phase}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          <p className="text-muted-foreground text-sm">
            {template.description}
          </p>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full cursor-pointer"
            onClick={() => setOpen(true)}
          >
            Generate
          </Button>
        </CardFooter>
      </Card>

      <GenerateDialog
        template={template}
        defaults={defaults}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
