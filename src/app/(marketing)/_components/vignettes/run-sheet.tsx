/**
 * Launch Sunday moment: the run sheet lighting up hour by hour.
 *
 * Presentational only — the green rule fills top→bottom while the rows come to
 * full, all on CSS keyframes scoped under `.ptabs.pt-seen .ppanel.active`.
 * Times are verbatim from the Launch Sunday meeting notes.
 */

const ROWS: readonly { time: string; label: string }[] = [
  { time: "7:30", label: "Setup crew arrives" },
  { time: "8:00", label: "All teams on site" },
  { time: "8:15", label: "Band call" },
  { time: "9:15", label: "Doors open" },
  { time: "10:00", label: "Service" },
];

export function RunSheet() {
  return (
    <div className="vg-card vg-runsheet">
      <p className="vg-label vg-card-head">Run sheet — Launch Sunday</p>

      <div className="vg-rs-body">
        <span className="vg-rs-rule" aria-hidden="true">
          <span className="vg-rs-rule-fill" />
        </span>
        <ul className="vg-rs-rows">
          {ROWS.map((row, i) => (
            <li
              key={row.time}
              className={
                i === ROWS.length - 1 ? "vg-rs-row is-last" : "vg-rs-row"
              }
              style={{ "--vg-i": i } as React.CSSProperties}
            >
              <span className="vg-rs-t">{row.time}</span>
              <span className="vg-rs-l">{row.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
