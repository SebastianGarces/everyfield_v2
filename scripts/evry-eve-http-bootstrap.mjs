import { registerCompiledEveLoader } from "./evry-eve-compiled-loader.mjs";

// This trusted path comes from the parent fixture, never a chat or model field.
registerCompiledEveLoader(process.env.EVRY_EVE_COMPILED_SERVER_DIRECTORY);
