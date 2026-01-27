import { cn } from "@/lib/utils";

const PHASES = [
  { number: 0, name: "Discovery" },
  { number: 1, name: "Core Group" },
  { number: 2, name: "Launch Team" },
  { number: 3, name: "Training" },
  { number: 4, name: "Pre-Launch" },
  { number: 5, name: "Launch Sunday" },
  { number: 6, name: "Post-Launch" },
] as const;

interface PhaseTimelineProps {
  currentPhase: number;
  className?: string;
}

export function PhaseTimeline({ currentPhase, className }: PhaseTimelineProps) {
  return (
    <div className={cn("w-full", className)}>
      {/* Desktop view */}
      <div className="hidden sm:block">
        {/* Circles and lines row */}
        <div className="relative flex items-center justify-between">
          {/* Background line spanning full width - behind everything */}
          <div className="absolute inset-x-4 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-muted-foreground/20" />
          
          {/* Progress line - also behind circles */}
          <div
            className="absolute left-4 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-primary/50 transition-all"
            style={{
              width: `calc(${(currentPhase / (PHASES.length - 1)) * 100}% - 32px)`,
            }}
          />

          {/* Phase circles - on top of lines */}
          {PHASES.map((phase) => (
            <div key={phase.number} className="relative z-10 flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium",
                  phase.number === currentPhase
                    ? "border-primary bg-primary text-primary-foreground"
                    : phase.number < currentPhase
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted bg-background text-muted-foreground"
                )}
              >
                {phase.number}
              </div>
            </div>
          ))}
        </div>

        {/* Labels row */}
        <div className="mt-2 flex justify-between">
          {PHASES.map((phase) => (
            <div key={phase.number} className="flex w-8 justify-center">
              <span
                className={cn(
                  "whitespace-nowrap text-[10px] font-medium",
                  phase.number === currentPhase
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                {phase.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile view - simplified */}
      <div className="sm:hidden">
        <div className="relative flex items-center justify-between px-1">
          {/* Background line */}
          <div className="absolute inset-x-1 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-muted-foreground/20" />
          
          {/* Progress line */}
          <div
            className="absolute left-1 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-primary/50"
            style={{
              width: `calc(${(currentPhase / (PHASES.length - 1)) * 100}%)`,
            }}
          />

          {/* Dots - on top */}
          {PHASES.map((phase) => (
            <div
              key={phase.number}
              className={cn(
                "relative z-10 h-3 w-3 rounded-full",
                phase.number === currentPhase
                  ? "bg-primary"
                  : phase.number < currentPhase
                    ? "bg-primary"
                    : "bg-muted"
              )}
            />
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Phase {currentPhase}: {PHASES[currentPhase]?.name}
        </p>
      </div>
    </div>
  );
}
