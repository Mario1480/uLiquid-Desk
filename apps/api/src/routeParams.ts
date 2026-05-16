import type { Request } from "express";

export function readRouteParam(req: Request, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}
