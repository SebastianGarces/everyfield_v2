export type ShotSource = {
  src: string;
  width: number;
  height: number;
};

const BLANK_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/**
 * A small complete card floated over a primary crop. Rendered only inside
 * the desktop tab panes, which are display:none on mobile — Chromium still
 * fetches lazy images in hidden subtrees, so the mobile source resolves to
 * an inline blank pixel instead of the real crop. display:contents keeps
 * the picture out of the pane's flex layout (the img positions itself).
 */
export function ShotOverlay({
  overlay,
}: {
  overlay: ShotSource & { alt: string; style: React.CSSProperties };
}) {
  return (
    <picture style={{ display: "contents" }}>
      <source media="(max-width: 899px)" srcSet={BLANK_PIXEL} />
      <img
        className="shot-img shot-overlay"
        src={overlay.src}
        alt={overlay.alt}
        width={overlay.width}
        height={overlay.height}
        loading="lazy"
        style={overlay.style}
      />
    </picture>
  );
}

/**
 * Art-directed product crop: desktop composition by default, a tighter
 * recomposed crop under 900px. Crops are pre-sized WebP files in
 * public/marketing/shots/ (regenerate with crops.mjs in the masters repo),
 * so no Next image optimization is involved.
 */
export function Shot({
  desktop,
  mobile,
  alt,
  priority = false,
}: {
  desktop: ShotSource;
  mobile?: ShotSource;
  alt: string;
  priority?: boolean;
}) {
  return (
    <picture>
      {mobile ? (
        <source
          media="(max-width: 899px)"
          srcSet={mobile.src}
          width={mobile.width}
          height={mobile.height}
        />
      ) : null}
      <img
        className="shot-img"
        src={desktop.src}
        alt={alt}
        width={desktop.width}
        height={desktop.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding={priority ? "sync" : "async"}
      />
    </picture>
  );
}
