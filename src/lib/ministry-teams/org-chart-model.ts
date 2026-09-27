import { teamStaffingDisplay } from "./team-display";
import { LEADERSHIP_TEAM_KEY } from "./role-templates";

export interface ChartPerson {
  id: string;
  name: string;
}
export interface ChartRole {
  id: string;
  name: string;
  person: ChartPerson | null;
  leadership: boolean;
}
export interface ChartTeam {
  id: string;
  name: string;
  templateKey: string | null;
  leader: ChartPerson | null;
  roles: ChartRole[];
}
export interface ChartBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string[];
  subtitle: string[];
  href: string | null;
  fill: string;
  kind: "team" | "person" | "vacancy";
}
export interface ChartLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface ChartDrawing {
  width: number;
  height: number;
  boxes: ChartBox[];
  lines: ChartLine[];
}

const WIDTH = 264;
const GAP = 32;
const PADDING = 24;
/** Wrap every character, including long names with no spaces; exports never truncate names. */
export function chartTextLines(text: string, limit = 16): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > limit) {
      lines.push(line);
      line = "";
    }
    let rest = word;
    while (rest.length > limit) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function drawOrgChart(
  teams: ChartTeam[],
  singleTeamId?: string
): ChartDrawing {
  const scope = singleTeamId
    ? teams.filter((team) => team.id === singleTeamId)
    : teams;
  const root = singleTeamId
    ? undefined
    : scope.find((team) => team.templateKey === LEADERSHIP_TEAM_KEY);
  const children = scope.filter((team) => team !== root);
  const width =
    Math.max(1, children.length) * (WIDTH + GAP) - GAP + PADDING * 2;
  const boxes: ChartBox[] = [];
  const lines: ChartLine[] = [];
  const add = (
    key: string,
    x: number,
    y: number,
    title: string,
    subtitle: string,
    href: string | null,
    kind: ChartBox["kind"],
    fill = kind === "vacancy" ? "#f8fafc" : "white"
  ) => {
    const titleLines = chartTextLines(title),
      subtitleLines = chartTextLines(subtitle);
    const height = 26 + titleLines.length * 19 + subtitleLines.length * 17;
    boxes.push({
      key,
      x,
      y,
      width: WIDTH,
      height,
      title: titleLines,
      subtitle: subtitleLines,
      href,
      kind,
      fill,
    });
    return height;
  };
  function teamColumn(team: ChartTeam, x: number, y: number) {
    const start = y;
    const filled = team.roles.filter((role) => role.person !== null).length;
    const staffing = teamStaffingDisplay(filled, team.roles.length);
    const fill =
      staffing.kind === "no_roles"
        ? "#eff6ff"
        : staffing.level === "red"
          ? "#fee2e2"
          : staffing.level === "yellow"
            ? "#fef3c7"
            : staffing.percentage === 100
              ? "#dcfce7"
              : "#eff6ff";
    y +=
      add(
        `team-${team.id}`,
        x,
        y,
        team.name,
        staffing.kind === "no_roles"
          ? staffing.label
          : `${filled}/${team.roles.length} roles`,
        `/teams/${team.id}`,
        "team",
        fill
      ) + 20;
    y +=
      add(
        `leader-${team.id}`,
        x,
        y,
        team.leader?.name ?? "No leader appointed",
        "Team leader",
        team.leader ? `/people/${team.leader.id}` : null,
        team.leader ? "person" : "vacancy"
      ) + 20;
    for (const role of team.roles) {
      y +=
        add(
          `role-${role.id}`,
          x,
          y,
          role.person?.name ?? "Vacant",
          `${role.name}${role.leadership ? " · Leadership role" : ""}`,
          role.person ? `/people/${role.person.id}` : null,
          role.person ? "person" : "vacancy"
        ) + 16;
    }
    const column = boxes.filter(
      (box) => box.x === x && box.y >= start && box.y < y
    );
    const [teamBox, leaderBox, ...roleBoxes] = column;
    lines.push({
      x1: x + WIDTH / 2,
      y1: teamBox.y + teamBox.height,
      x2: x + WIDTH / 2,
      y2: leaderBox.y,
    });
    if (roleBoxes.length) {
      const railX = x - 10,
        branchY = leaderBox.y + leaderBox.height / 2;
      lines.push({ x1: railX, y1: branchY, x2: x, y2: branchY });
      lines.push({
        x1: railX,
        y1: branchY,
        x2: railX,
        y2: roleBoxes.at(-1)!.y + roleBoxes.at(-1)!.height / 2,
      });
      for (const role of roleBoxes)
        lines.push({
          x1: railX,
          y1: role.y + role.height / 2,
          x2: x,
          y2: role.y + role.height / 2,
        });
    }
    return y;
  }
  const rootEnd = root
    ? teamColumn(root, (width - WIDTH) / 2, PADDING)
    : PADDING;
  const childrenY = root ? rootEnd + 40 : PADDING;
  let height = rootEnd;
  for (const [index, team] of children.entries()) {
    const x = PADDING + index * (WIDTH + GAP);
    height = Math.max(height, teamColumn(team, x, childrenY));
    if (root) {
      const branchY = childrenY - 20;
      lines.push({
        x1: width / 2,
        y1: branchY,
        x2: x + WIDTH / 2,
        y2: branchY,
      });
      lines.push({
        x1: x + WIDTH / 2,
        y1: branchY,
        x2: x + WIDTH / 2,
        y2: childrenY,
      });
    }
  }
  if (root && children.length) {
    const rootBox = boxes[0],
      railX = rootBox.x + WIDTH + 12,
      branchY = childrenY - 20;
    lines.push({
      x1: rootBox.x + WIDTH,
      y1: rootBox.y + rootBox.height / 2,
      x2: railX,
      y2: rootBox.y + rootBox.height / 2,
    });
    lines.push({
      x1: railX,
      y1: rootBox.y + rootBox.height / 2,
      x2: railX,
      y2: branchY,
    });
    lines.push({ x1: railX, y1: branchY, x2: width / 2, y2: branchY });
  }
  return { width, height: height + PADDING, boxes, lines };
}
