"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  drawOrgChart,
  type ChartTeam,
} from "@/lib/ministry-teams/org-chart-model";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OrgChartView({ teams }: { teams: ChartTeam[] }) {
  const id = useId();
  const [scope, setScope] = useState("all");
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const drawing = drawOrgChart(teams, scope === "all" ? undefined : scope);
  const selectedTeams =
    scope === "all" ? teams : teams.filter((team) => team.id === scope);
  function fit() {
    if (!viewport.current) return;
    setZoom(
      Math.min(
        1,
        viewport.current.clientWidth / drawing.width,
        viewport.current.clientHeight / drawing.height
      )
    );
    viewport.current.scrollTo(0, 0);
  }
  function pan(x: number, y: number) {
    viewport.current?.scrollBy({ left: x, top: y });
  }
  function exportImage() {
    if (!svg.current) return;
    const copy = svg.current.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("width", String(drawing.width));
    copy.setAttribute("height", String(drawing.height));
    copy.removeAttribute("style");
    download(
      new Blob([new XMLSerializer().serializeToString(copy)], {
        type: "image/svg+xml;charset=utf-8",
      }),
      "team-org-chart.svg"
    );
  }
  async function exportPdf() {
    setError(null);
    setExporting(true);
    try {
      const { orgChartPdf } = await import("./org-chart-pdf");
      download(
        await orgChartPdf(selectedTeams, scope === "all"),
        "team-org-chart.pdf"
      );
    } catch {
      setError("Could not export the PDF. Try again.");
    } finally {
      setExporting(false);
    }
  }
  if (!teams.length)
    return <p className="text-muted-foreground">No teams to display yet.</p>;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3"
      aria-label="Team organization chart"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-scope`}>Chart scope</Label>
          <Select
            value={scope}
            onValueChange={(value) => {
              setScope(value);
              setZoom(1);
              viewport.current?.scrollTo(0, 0);
            }}
          >
            <SelectTrigger id={`${id}-scope`} className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Chart controls">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((value) => Math.max(0.1, value / 1.25))}
          >
            Zoom out
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((value) => Math.min(2, value * 1.25))}
          >
            Zoom in
          </Button>
          <Button variant="outline" size="sm" onClick={fit}>
            Fit chart
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setZoom(1);
              viewport.current?.scrollTo(0, 0);
            }}
          >
            Reset
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportImage}>
            Export image
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportPdf}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
      </div>
      <p id={`${id}-help`} className="text-muted-foreground text-xs">
        {selectedTeams.length === 1
          ? "1 team"
          : `${selectedTeams.length} teams`}{" "}
        · {Math.round(zoom * 100)}% · Drag empty chart space, scroll, or focus
        the chart and use arrow keys to pan. Select a name to open its details.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Scrollable organization chart"
        aria-describedby={`${id}-help`}
        className="focus-visible:outline-ring min-h-64 flex-1 touch-pan-x touch-pan-y overflow-auto rounded-lg border bg-white focus-visible:outline-2 focus-visible:outline-offset-2"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-80, 0],
            ArrowRight: [80, 0],
            ArrowUp: [0, -80],
            ArrowDown: [0, 80],
          };
          if (delta[event.key]) {
            event.preventDefault();
            pan(...delta[event.key]);
          }
        }}
        onPointerDown={(event) => {
          if (
            event.pointerType !== "mouse" ||
            event.button !== 0 ||
            (event.target as Element).closest("a")
          )
            return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            event.currentTarget.scrollTo(
              drag.current.left - event.clientX + drag.current.x,
              drag.current.top - event.clientY + drag.current.y
            );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <svg
          ref={svg}
          xmlns="http://www.w3.org/2000/svg"
          width={drawing.width * zoom}
          height={drawing.height * zoom}
          viewBox={`0 0 ${drawing.width} ${drawing.height}`}
          style={{ maxWidth: "none" }}
          role="group"
          aria-label={
            scope === "all"
              ? "All Teams organization chart"
              : `${selectedTeams[0]?.name} organization chart`
          }
        >
          <rect width={drawing.width} height={drawing.height} fill="white" />
          {drawing.lines.map((line, index) => (
            <line key={index} {...line} stroke="#94a3b8" strokeWidth={1.5} />
          ))}
          {drawing.boxes.map((box) => {
            const content = (
              <g>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={8}
                  fill={box.fill}
                  stroke="#64748b"
                  strokeDasharray={box.kind === "vacancy" ? "4 3" : undefined}
                />
                <text
                  x={box.x + 14}
                  y={box.y + 23}
                  fill="#0f172a"
                  fontFamily="monospace"
                  fontSize={14}
                  fontWeight={600}
                >
                  {box.title.map((line, index) => (
                    <tspan x={box.x + 14} dy={index ? 19 : 0} key={index}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text
                  x={box.x + 14}
                  y={box.y + 27 + box.title.length * 19}
                  fill="#475569"
                  fontFamily="monospace"
                  fontSize={12}
                >
                  {box.subtitle.map((line, index) => (
                    <tspan x={box.x + 14} dy={index ? 17 : 0} key={index}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
            return box.href ? (
              <a
                key={box.key}
                href={box.href}
                aria-label={`${box.title.join(" ")}, ${box.subtitle.join(" ")}`}
                className="cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700"
              >
                {content}
              </a>
            ) : (
              <g key={box.key}>{content}</g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
