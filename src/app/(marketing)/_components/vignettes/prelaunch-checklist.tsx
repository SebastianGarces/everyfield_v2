/**
 * Pre-launch moment: the Launch Sunday logistics checklist ending at zero.
 *
 * Presentational only — the whole sequence is CSS keyframes scoped under
 * `.ptabs.pt-seen .ppanel.active`, so the first run waits for the section and
 * the display:none→block tab swap restarts it for free. Copy is verbatim from
 * the pt-prelaunch capture this card sits on.
 */

/** `tick` is the item's place in the ticking sequence; -1 = already struck. */
const ITEMS: readonly { label: string; tick: number }[] = [
  { label: "Promo cards mailed", tick: -1 },
  { label: "Signage ordered", tick: -1 },
  { label: "Greeter assignments confirmed", tick: 0 },
  { label: "Print bulletins", tick: 1 },
];

export function PrelaunchChecklist() {
  return (
    <div className="vg-card vg-checklist">
      <div className="vg-card-head">
        <span className="vg-label">Preparation progress</span>
        <span className="vg-count">
          <span className="vg-count-slot">
            <span className="vg-count-a">4/8</span>
            <span className="vg-count-b">6/8</span>
          </span>
          <span className="vg-count-unit">ready</span>
        </span>
      </div>

      <div className="vg-bar">
        <span className="vg-bar-fill" />
      </div>

      <ul className="vg-checks">
        {ITEMS.map((item) => (
          <li
            key={item.label}
            className={item.tick < 0 ? "vg-check is-pre" : "vg-check"}
            style={
              item.tick < 0
                ? undefined
                : ({ "--vg-i": item.tick } as React.CSSProperties)
            }
          >
            <span className="vg-box" aria-hidden="true" />
            <span className="vg-check-t">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
