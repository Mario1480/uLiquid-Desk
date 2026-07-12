"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { extractLocaleFromPathname } from "../../i18n/config";
import AuthHeader from "./AuthHeader";
import AppBreadcrumbs from "./AppBreadcrumbs";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import SystemBanner from "./SystemBanner";

const CHROMELESS_ROUTES = new Set([
  "/login",
  "/register",
  "/reset-password",
  "/maintenance",
  "/terms",
  "/privacy",
  "/risk-disclosure"
]);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tSidebar = useTranslations("nav.sidebar");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSidebarMode, setMobileSidebarMode] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  const hideChrome = CHROMELESS_ROUTES.has(pathnameWithoutLocale);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 999px)");
    const syncViewportMode = () => setMobileSidebarMode(mediaQuery.matches);
    syncViewportMode();
    mediaQuery.addEventListener("change", syncViewportMode);
    return () => mediaQuery.removeEventListener("change", syncViewportMode);
  }, []);

  useEffect(() => {
    const sidebar = document.getElementById("appSidebar");
    if (!sidebar) return;

    const shouldBeInert = mobileSidebarMode && !sidebarOpen;
    sidebar.toggleAttribute("inert", shouldBeInert);
    if (shouldBeInert) {
      sidebar.setAttribute("aria-hidden", "true");
    } else {
      sidebar.removeAttribute("aria-hidden");
    }
  }, [mobileSidebarMode, sidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarMode || !sidebarOpen) return;

    const sidebar = document.getElementById("appSidebar");
    if (!sidebar) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    const getFocusableElements = () => Array.from(
      sidebar.querySelectorAll<HTMLElement>(focusableSelector)
    ).filter((element) => element.getClientRects().length > 0);
    const focusFrame = window.requestAnimationFrame(() => {
      sidebar.querySelector<HTMLElement>(".appSidebarClose")?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstElement || !sidebar.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !sidebar.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [mobileSidebarMode, sidebarOpen]);

  if (hideChrome) {
    return (
      <>
        <SystemBanner />
        <AuthHeader />
        <main className="container appMain">{children}</main>
      </>
    );
  }

  return (
    <div className="appShell appShellWithSidebar">
      <AppSidebar
        isOpen={sidebarOpen}
        mobileMode={mobileSidebarMode}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="appShellContent">
        <AppHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
        <AppBreadcrumbs />
        <SystemBanner />
        <main className="container appMain">{children}</main>
      </div>

      {mobileSidebarMode && sidebarOpen ? (
        <button
          type="button"
          className="appSidebarBackdrop appSidebarBackdropOpen"
          onClick={() => setSidebarOpen(false)}
          aria-label={tSidebar("close")}
        />
      ) : null}
    </div>
  );
}
