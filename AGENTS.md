# EveryField Knowledge Index

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for ALL project-specific tasks.

## Dev Server Rule

**CRITICAL:** NEVER start a dev server yourself (`pnpm dev`, `npm run dev`, etc.). The developer always has a dev server running on `localhost:3000`. If you need to verify it's running, check the terminals folder first. If you don't find one, ask the developer -- do NOT start one yourself.

That server runs the **main checkout**, so it does not serve your feature branch — pointing a browser at `localhost:3000` proves nothing about a change you have not merged. To see your own branch in a browser, use its Vercel preview deployment: `.claude/skills/browser-validation/SKILL.md`.

## Formatting

Formatting is automatic — **do not run `pnpm format` as a routine step**.

- **Agent edits:** a `PostToolUse` hook in `.claude/settings.json` runs `prettier --write` on every file written or edited.
- **Hand edits:** `.vscode/settings.json` sets format-on-save with the Prettier extension.
- **CI:** `format:check` is one of the five required steps (format:check, lint, typecheck, test, build), so anything that slips through fails the PR.

`.prettierignore` excludes `*.md`, so markdown is deliberately unformatted — that is not a hook failure.

There is no pre-commit hook; it was removed once CI became reliable, and the two paths above replace it.

## UI Components (shadcn/ui)

**CRITICAL:** When you need a new UI component, use the shadcn CLI - do NOT write components manually:

```bash
pnpm dlx shadcn@latest add <component-name>
```

Examples:
- Need a checkbox? Run `pnpm dlx shadcn@latest add checkbox`
- Need a popover? Run `pnpm dlx shadcn@latest add popover`
- Need multiple? Run `pnpm dlx shadcn@latest add checkbox popover tabs`

This ensures:
1. Correct dependencies are installed automatically
2. Components match the project's shadcn configuration (new-york style)
3. Consistent patterns across all UI components

Available components: https://ui.shadcn.com/docs/components

## Database Migrations (Drizzle)

**CRITICAL:** Always use `pnpm db:migrate` (which runs `drizzle-kit migrate`) to apply migrations. NEVER use `pnpm db:push` (`drizzle-kit push`). We use explicit, versioned SQL migration files in `src/db/migrations/` to keep changes auditable and reproducible.

## Cursor Pointer Rule

**CRITICAL:** Every clickable element MUST have `cursor-pointer`. This includes buttons, links, tabs, checkboxes, radio buttons, select triggers, clickable cards, and any element with an `onClick` handler. Never ship an interactive element without `cursor-pointer`.

- Native `<button>` and `<a>` tags get this from `globals.css`
- shadcn components (Button, TabsTrigger, SelectTrigger, etc.) must include it in their className
- Custom clickable elements (`<div onClick={...}>`) must always add `cursor-pointer`

## Knowledge Routing

| Task | Read First |
|------|------------|
| Next.js APIs, components, config | `.next-docs/` |
| Architecture, data flow, contracts | `memory/` |
| Before ANY mutation | `memory/invariants.md` |
| Email/notification features | `.agents/skills/email-best-practices/`, `.agents/skills/resend/` |
| UI/UX implementation | `.agents/skills/ui-ux-pro-max/`, `.agents/skills/web-design-guidelines/` |
| UI polish, accessibility, typography, color, copy | `.agents/skills/better-interface/` (coordinates the `better-*` suite) |
| Proving a UI change works in a browser | `.claude/skills/browser-validation/SKILL.md` |
| A fuzzy ask, before writing a spec | `.claude/skills/grilling/SKILL.md` |
| A merge/rebase conflict (esp. wave branches) | `.claude/skills/resolving-merge-conflicts/SKILL.md` |
| Adding a skill — who may invoke it | `ops/agent-os/invocation.md` |
| React performance patterns | `.agents/skills/vercel-react-best-practices/` |
| Feature requirements | `product-docs/features/{feature-name}/frd.md` |
| What is built vs. still open | The board — `gh issue list --label feature`. **Not a file**; the checklists were deleted 2026-07-26 (`ops/agent-os/labels.md`) |

<!-- EVERYFIELD-MEMORY-START -->[Memory Index]|root:./memory|CRITICAL: Check memory BEFORE opening source files. Contains architecture contracts and invariants.|entrypoints.md,invariants.md,index.md|contracts:{api.md,db.md,config.md,data-patterns.md}|flows:{auth.mmd,wiki-article.mmd,request-lifecycle.mmd,person-status.mmd}<!-- EVERYFIELD-MEMORY-END -->

<!-- EVERYFIELD-SKILLS-START -->[Skills Index]|root:./.agents/skills|Read SKILL.md first for each skill, then reference files as needed.|better-accessibility:{SKILL.md,focus-and-keyboard.md,forms.md,hit-areas.md,motion-and-zoom.md,screen-readers.md,semantics-and-aria.md}|better-colors:{SKILL.md,accessibility-contrast.md,color-conversion.md,color-usage.md,gamut-and-tailwind.md,palette-generation.md}|better-interface:SKILL.md|better-layout:{SKILL.md,grouping-and-alignment.md,spacing-and-adaptivity.md}|better-typography:{SKILL.md,choosing-fonts.md,css-cheat-sheet.md,details-and-accessibility.md,spacing-and-sizing.md,variable-fonts-and-opentype.md,wrapping-and-punctuation.md}|better-ui:{SKILL.md,animations.md,icons.md,performance.md,surfaces.md}|better-writing:SKILL.md|email-best-practices:{SKILL.md,resources/*}|next-best-practices:{SKILL.md,async-patterns.md,bundling.md,data-patterns.md,debug-tricks.md,directives.md,error-handling.md,file-conventions.md,font.md,functions.md,hydration-error.md,image.md,metadata.md,parallel-routes.md,route-handlers.md,rsc-boundaries.md,runtime-selection.md,scripts.md,self-hosting.md,suspense-boundaries.md}|react-email:{SKILL.md,references/COMPONENTS.md,references/I18N.md,references/PATTERNS.md,references/SENDING.md,references/STYLING.md}|resend:{SKILL.md,send-email/SKILL.md,resend-inbound/SKILL.md,agent-email-inbox/SKILL.md}|ui-ux-pro-max:SKILL.md|vercel-react-best-practices:{SKILL.md,AGENTS.md,rules/*}|web-design-guidelines:SKILL.md<!-- EVERYFIELD-SKILLS-END -->

<!-- EVERYFIELD-PRODUCT-START -->[Product Docs Index]|root:./product-docs|FRDs define requirements; implementation status lives on the GitHub board (gh issue list --label feature), NOT in any file.|prd.md,product-brief.md,system-architecture.md,core-data-contracts.md,board-design-2026-07.md,docs-audit-2026-07.md|features/wiki:{frd.md}|features/people-crm:{frd.md}|features/communication-hub:{frd.md}|features/task-project-management:{frd.md}|features/meetings:{frd.md}|features/ministry-team-management:{frd.md}|features/financial-tracking:{frd.md}|features/facility-management:{frd.md}|features/document-templates:{frd.md}|features/progress-dashboard:{frd.md}|features/notifications:{frd.md}|features/phase-engine:{frd.md,rubric-v0.md,data-posture.md}|features/church-plant-agent:{vision.md}<!-- EVERYFIELD-PRODUCT-END -->

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root:./.next-docs|STOP. What you remember about Next.js is WRONG for this project. Always search docs and read before any task.|If docs missing, run: npx @next/codemod agents-md|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx,03-layouts-and-pages.mdx,04-linking-and-navigating.mdx,05-server-and-client-components.mdx,06-cache-components.mdx,07-fetching-data.mdx,08-updating-data.mdx,09-caching-and-revalidating.mdx,10-error-handling.mdx,11-css.mdx,12-images.mdx,13-fonts.mdx,14-metadata-and-og-images.mdx,15-route-handlers.mdx,16-proxy.mdx,17-deploying.mdx,18-upgrading.mdx}|01-app/02-guides:{analytics.mdx,authentication.mdx,backend-for-frontend.mdx,caching.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,data-security.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,json-ld.mdx,lazy-loading.mdx,local-development.mdx,mcp.mdx,mdx.mdx,memory-usage.mdx,multi-tenant.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,prefetching.mdx,production-checklist.mdx,progressive-web-apps.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,single-page-applications.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx,videos.mdx}|01-app/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|01-app/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|01-app/02-guides/upgrading:{codemods.mdx,version-14.mdx,version-15.mdx,version-16.mdx}|01-app/03-api-reference:{07-edge.mdx,08-turbopack.mdx}|01-app/03-api-reference/01-directives:{use-cache-private.mdx,use-cache-remote.mdx,use-cache.mdx,use-client.mdx,use-server.mdx}|01-app/03-api-reference/02-components:{font.mdx,form.mdx,image.mdx,link.mdx,script.mdx}|01-app/03-api-reference/03-file-conventions/01-metadata:{app-icons.mdx,manifest.mdx,opengraph-image.mdx,robots.mdx,sitemap.mdx}|01-app/03-api-reference/03-file-conventions:{default.mdx,dynamic-routes.mdx,error.mdx,forbidden.mdx,instrumentation-client.mdx,instrumentation.mdx,intercepting-routes.mdx,layout.mdx,loading.mdx,mdx-components.mdx,not-found.mdx,page.mdx,parallel-routes.mdx,proxy.mdx,public-folder.mdx,route-groups.mdx,route-segment-config.mdx,route.mdx,src-folder.mdx,template.mdx,unauthorized.mdx}|01-app/03-api-reference/04-functions:{after.mdx,cacheLife.mdx,cacheTag.mdx,connection.mdx,cookies.mdx,draft-mode.mdx,fetch.mdx,forbidden.mdx,generate-image-metadata.mdx,generate-metadata.mdx,generate-sitemaps.mdx,generate-static-params.mdx,generate-viewport.mdx,headers.mdx,image-response.mdx,next-request.mdx,next-response.mdx,not-found.mdx,permanentRedirect.mdx,redirect.mdx,refresh.mdx,revalidatePath.mdx,revalidateTag.mdx,unauthorized.mdx,unstable_cache.mdx,unstable_noStore.mdx,unstable_rethrow.mdx,updateTag.mdx,use-link-status.mdx,use-params.mdx,use-pathname.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,use-selected-layout-segment.mdx,use-selected-layout-segments.mdx,userAgent.mdx}|01-app/03-api-reference/05-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,appDir.mdx,assetPrefix.mdx,authInterrupts.mdx,basePath.mdx,browserDebugInfoInTerminal.mdx,cacheComponents.mdx,cacheHandlers.mdx,cacheLife.mdx,compress.mdx,crossOrigin.mdx,cssChunking.mdx,devIndicators.mdx,distDir.mdx,env.mdx,expireTime.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,htmlLimitedBots.mdx,httpAgentOptions.mdx,images.mdx,incrementalCacheHandlerPath.mdx,inlineCss.mdx,isolatedDevBuild.mdx,logging.mdx,mdxRs.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactCompiler.mdx,reactMaxHeadersLength.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,sassOptions.mdx,serverActions.mdx,serverComponentsHmrCache.mdx,serverExternalPackages.mdx,staleTimes.mdx,staticGeneration.mdx,taint.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,turbopackFileSystemCache.mdx,typedRoutes.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,viewTransition.mdx,webVitalsAttribution.mdx,webpack.mdx}|01-app/03-api-reference/05-config:{02-typescript.mdx,03-eslint.mdx}|01-app/03-api-reference/06-cli:{create-next-app.mdx,next.mdx}|02-pages/01-getting-started:{01-installation.mdx,02-project-structure.mdx,04-images.mdx,05-fonts.mdx,06-css.mdx,11-deploying.mdx}|02-pages/02-guides:{analytics.mdx,authentication.mdx,babel.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,lazy-loading.mdx,mdx.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,post-css.mdx,preview-mode.mdx,production-checklist.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx}|02-pages/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|02-pages/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|02-pages/02-guides/upgrading:{codemods.mdx,version-10.mdx,version-11.mdx,version-12.mdx,version-13.mdx,version-14.mdx,version-9.mdx}|02-pages/03-building-your-application/01-routing:{01-pages-and-layouts.mdx,02-dynamic-routes.mdx,03-linking-and-navigating.mdx,05-custom-app.mdx,06-custom-document.mdx,07-api-routes.mdx,08-custom-error.mdx}|02-pages/03-building-your-application/02-rendering:{01-server-side-rendering.mdx,02-static-site-generation.mdx,04-automatic-static-optimization.mdx,05-client-side-rendering.mdx}|02-pages/03-building-your-application/03-data-fetching:{01-get-static-props.mdx,02-get-static-paths.mdx,03-forms-and-mutations.mdx,03-get-server-side-props.mdx,05-client-side.mdx}|02-pages/03-building-your-application/06-configuring:{12-error-handling.mdx}|02-pages/04-api-reference:{06-edge.mdx,08-turbopack.mdx}|02-pages/04-api-reference/01-components:{font.mdx,form.mdx,head.mdx,image-legacy.mdx,image.mdx,link.mdx,script.mdx}|02-pages/04-api-reference/02-file-conventions:{instrumentation.mdx,proxy.mdx,public-folder.mdx,src-folder.mdx}|02-pages/04-api-reference/03-functions:{get-initial-props.mdx,get-server-side-props.mdx,get-static-paths.mdx,get-static-props.mdx,next-request.mdx,next-response.mdx,use-report-web-vitals.mdx,use-router.mdx,userAgent.mdx}|02-pages/04-api-reference/04-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,assetPrefix.mdx,basePath.mdx,bundlePagesRouterDependencies.mdx,compress.mdx,crossOrigin.mdx,devIndicators.mdx,distDir.mdx,env.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,httpAgentOptions.mdx,images.mdx,isolatedDevBuild.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,serverExternalPackages.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,webVitalsAttribution.mdx,webpack.mdx}|02-pages/04-api-reference/04-config:{01-typescript.mdx,02-eslint.mdx}|02-pages/04-api-reference/05-cli:{create-next-app.mdx,next.mdx}|03-architecture:{accessibility.mdx,fast-refresh.mdx,nextjs-compiler.mdx,supported-browsers.mdx}|04-community:{01-contribution-guide.mdx,02-rspack.mdx}<!-- NEXT-AGENTS-MD-END -->
