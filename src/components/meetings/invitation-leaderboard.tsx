import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, AlertTriangle } from "lucide-react";
import type { InvitationLeaderboardEntry } from "@/lib/meetings/types";

interface InvitationLeaderboardProps {
  leaderboard: InvitationLeaderboardEntry[];
  target?: number;
}

export function InvitationLeaderboard({
  leaderboard,
  target = 5,
}: InvitationLeaderboardProps) {
  if (leaderboard.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Invitation Leaderboard
          <span className="text-xs text-muted-foreground font-normal">
            (Target: {target} per member)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {leaderboard.map((entry, index) => {
            const belowTarget = entry.invitedCount < target;
            return (
              <div
                key={entry.person.id}
                className="flex items-center justify-between py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-muted-foreground w-6 text-right">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {entry.person.firstName} {entry.person.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.confirmedCount} confirmed &bull;{" "}
                      {entry.attendedCount} attended
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {belowTarget && (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  )}
                  <span
                    className={`text-lg font-bold ${belowTarget ? "text-yellow-600" : "text-green-600"}`}
                  >
                    {entry.invitedCount}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
