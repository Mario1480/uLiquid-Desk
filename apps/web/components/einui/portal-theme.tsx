"use client";
import { createContext, useContext, type ReactNode } from "react";
export type EinTheme = "ocean" | "aurora" | "forest";
export const EinThemeContext = createContext<EinTheme>("ocean");
export function EinPortalTheme({ children }: { children: ReactNode }) {
  const theme = useContext(EinThemeContext);
  return <div data-ein-portal="true" data-ein-preview-theme={theme} style={{display: "contents"}}>{children}</div>;
}
