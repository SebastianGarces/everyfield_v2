import { Mail, Phone, Rocket, Star, User } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDateWithoutWeekday } from "@/lib/datetime";
import { STATUS_BADGE_CONFIG } from "@/lib/people/status-colors";
import { Person, PersonStatus, Tag } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { TagList } from "./tag-list";

interface PersonCardProps {
  person: Person & { tags?: Tag[] };
  /** Render the card as inert markup instead of a link — for presentational
   *  embeds (the marketing page), where nothing may be clickable, focusable or
   *  prefetchable. Absent, as in the app, this card is unchanged. */
  linkStatic?: boolean;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  rocket: <Rocket className="h-3 w-3" />,
  star: <Star className="h-3 w-3" />,
};

export function PersonCard({ person, linkStatic }: PersonCardProps) {
  const config = STATUS_BADGE_CONFIG[person.status as PersonStatus];

  const formatSource = (source: string) => {
    return source
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const initials =
    `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();

  const card = (
    <Card className="flex h-full cursor-pointer flex-col gap-0 py-0 shadow-sm transition-all duration-200 hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-3 p-3 pb-1">
        <Avatar className="h-10 w-10">
          <AvatarImage
            src={person.photoUrl || undefined}
            alt={`${person.firstName} ${person.lastName}`}
          />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm leading-none font-semibold tracking-tight">
              {person.firstName} {person.lastName}
            </h3>
            <Badge
              variant={config?.variant ?? "secondary"}
              className={cn("shrink-0", config?.className)}
            >
              {config?.icon && STATUS_ICONS[config.icon]}
              {config?.label ?? person.status}
            </Badge>
          </div>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            {person.source && (
              <Badge variant="outline" className="shrink-0 text-xs font-normal">
                {formatSource(person.source)}
              </Badge>
            )}
            <span className="truncate text-xs">
              Added{" "}
              {formatDateWithoutWeekday(new Date(person.createdAt), "short")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 px-3 pt-1 pb-3">
        <div className="text-muted-foreground grid gap-1.5 text-sm">
          {person.email && (
            <div className="flex min-w-0 items-center gap-2">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{person.email}</span>
            </div>
          )}
          {person.phone && (
            <div className="flex min-w-0 items-center gap-2">
              <Phone className="h-3 w-3 shrink-0" />
              <span className="truncate">{person.phone}</span>
            </div>
          )}
          {!person.email && !person.phone && (
            <div className="flex items-center gap-2 italic">
              <User className="h-3 w-3 shrink-0" />
              <span>No contact info</span>
            </div>
          )}
        </div>

        {person.tags && person.tags.length > 0 && (
          <div className="mt-auto pt-2">
            <TagList tags={person.tags} />
          </div>
        )}
      </CardContent>
    </Card>
  );

  // A span, not an href-less anchor: a presentational embed should carry no app
  // URL at all, so there is nothing left to prefetch by construction. Both are
  // inline elements with no styles of their own at this level, so the box the
  // card sits in is identical either way.
  return linkStatic ? (
    <span>{card}</span>
  ) : (
    <Link href={`/people/${person.id}`}>{card}</Link>
  );
}
