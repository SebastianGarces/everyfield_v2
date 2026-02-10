"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  STATUS_BADGE_CONFIG,
  STATUS_DESCRIPTIONS,
} from "@/lib/people/status-colors";
import type { PersonStatus } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { Info, Rocket, Star } from "lucide-react";

interface PersonStatusCardProps {
  status: PersonStatus;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  rocket: <Rocket className="h-3 w-3" />,
  star: <Star className="h-3 w-3" />,
};

export function PersonStatusCard({ status }: PersonStatusCardProps) {
  const config = STATUS_BADGE_CONFIG[status];
  const description = STATUS_DESCRIPTIONS[status];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Pipeline Status</CardTitle>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="text-muted-foreground h-4 w-4 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-56">
              <p className="text-xs">{description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardHeader>
      <CardContent className="pt-2">
        <Badge variant={config.variant} className={cn(config.className)}>
          {config.icon && STATUS_ICONS[config.icon]}
          {config.label}
        </Badge>
      </CardContent>
    </Card>
  );
}
