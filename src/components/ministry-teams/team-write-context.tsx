"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useCan } from "@/components/shared/viewer-capabilities";

const TeamWriteContext = createContext<string | null>(null);

/** The server resolves this one team's authority; it never grants a global capability. */
export function TeamWriteProvider({
  writableTeamId,
  children,
}: {
  writableTeamId: string | null;
  children: ReactNode;
}) {
  return (
    <TeamWriteContext.Provider value={writableTeamId}>
      {children}
    </TeamWriteContext.Provider>
  );
}

export function useCanManageTeam(teamId: string): boolean {
  const writableTeamId = useContext(TeamWriteContext);
  const canWriteAllTeams = useCan("teams.write");
  const canWriteOwnTeam = useCan("teams.own");
  return canWriteAllTeams || (canWriteOwnTeam && writableTeamId === teamId);
}
