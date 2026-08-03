/**
 * Beyond moment: Trinity Grove's Sunday gathering, week over week.
 *
 * Presentational only — rows appear in sequence on CSS keyframes scoped under
 * `.ptabs.pt-seen .ppanel.active`. Week 6 lands last and carries the claim,
 * which is why the phase's desktop chip goes away (one claim per visual).
 *
 * Bar widths normalise 95–115 attendees across the row, so a seven-person
 * difference is actually visible instead of six bars of the same length.
 */

const WEEKS: readonly number[] = [108, 101, 105, 103, 109, 112];

const FLOOR = 95;
const CEILING = 115;
const width = (n: number) =>
  `${Math.round(((n - FLOOR) / (CEILING - FLOOR)) * 100)}%`;

export function WeeklyTicker() {
  return (
    <div className="vg-card vg-ticker">
      <p className="vg-label vg-card-head">Sunday gathering</p>

      <ul className="vg-wk-rows">
        {WEEKS.map((count, i) => (
          <li
            key={count.toString() + i}
            className={
              i === WEEKS.length - 1 ? "vg-wk-row is-now" : "vg-wk-row"
            }
            style={
              { "--vg-i": i, "--vg-w": width(count) } as React.CSSProperties
            }
          >
            <span className="vg-wk-n">Week {i + 1}</span>
            <span className="vg-wk-bar" aria-hidden="true">
              <span className="vg-wk-fill" />
            </span>
            <span className="vg-wk-c">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
