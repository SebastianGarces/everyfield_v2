export type ShotSource = {
  src: string;
  width: number;
  height: number;
};

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
