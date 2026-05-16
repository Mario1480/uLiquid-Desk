import type { Express } from "express";
import { createGridVenueContextResolver } from "../grid/venueContext.js";
import { registerGridRoutes } from "./grid.js";
import { registerVaultRoutes } from "./vaults.js";

type RegisterGridRouteOptions = Omit<
  Parameters<typeof registerGridRoutes>[1],
  "resolveVenueContext"
>;

type RegisterGridVaultRouteGroupOptions = {
  app: Express;
} & Parameters<typeof createGridVenueContextResolver>[0]
  & RegisterGridRouteOptions
  & Parameters<typeof registerVaultRoutes>[1];

export function registerGridVaultRouteGroup(params: RegisterGridVaultRouteGroupOptions): void {
  const resolveGridVenueContext = createGridVenueContextResolver(params);
  registerGridRoutes(params.app, {
    ...params,
    resolveVenueContext: async (contextParams) => resolveGridVenueContext(contextParams)
  });
  registerVaultRoutes(params.app, params);
}
