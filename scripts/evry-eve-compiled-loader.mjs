import { readFileSync, realpathSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Keep generated ESM native; tsx still handles the source worker and its aliases. */
export function registerCompiledEveLoader(directory) {
  if (
    !directory ||
    !isAbsolute(directory) ||
    !statSync(directory).isDirectory()
  )
    throw new Error(
      "Compiled Eve loader requires an absolute server directory"
    );
  const root = realpathSync(directory);
  return registerHooks({
    load(url, context, nextLoad) {
      const parsed = new URL(url);
      if (parsed.protocol === "file:" && parsed.pathname.endsWith(".mjs")) {
        const file = realpathSync(fileURLToPath(parsed));
        const path = relative(root, file);
        if (
          path &&
          path !== ".." &&
          !path.startsWith(`..${sep}`) &&
          !isAbsolute(path)
        )
          return {
            format: "module",
            source: readFileSync(file),
            shortCircuit: true,
          };
      }
      return nextLoad(url, context);
    },
  });
}
