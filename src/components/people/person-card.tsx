import { format } from "date-fns";
import { Mail, Phone, Rocket, Star, User } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { STATUS_BADGE_CONFIG } from "@/lib/people/status-colors";
import { Person, PersonStatus, Tag } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { TagList } from "./tag-list";

interface PersonCardProps {
  person: Person & { tags?: Tag[] };
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  rocket: <Rocket className="h-3 w-3" />,
  star: <Star className="h-3 w-3" />,
};

export function PersonCard({ person }: PersonCardProps) {
  const config = STATUS_BADGE_CONFIG[person.status as PersonStatus];

  const formatSource = (source: string) => {
    return source
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const initials =
    `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();

  return (
    <Link href={`/people/${person.id}`}>
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
                <Badge
                  variant="outline"
                  className="shrink-0 text-xs font-normal"
                >
                  {formatSource(person.source)}
                </Badge>
              )}
              <span className="truncate text-xs">
                Added {format(new Date(person.createdAt), "MMM d, yyyy")}
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
    </Link>
  );
}
