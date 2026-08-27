export type WikiSearchShortcutScope = "desktop" | "mobile";

export function shouldHandleWikiSearchShortcut(
  scope: WikiSearchShortcutScope,
  isDesktopViewport: boolean
) {
  return scope === "desktop" ? isDesktopViewport : !isDesktopViewport;
}

export function shouldCloseWikiMobileNavigation(isDesktopViewport: boolean) {
  return isDesktopViewport;
}
