import type { GridTemplate } from "../../components/grid/types";

export type GridCatalogQueryState = {
  search: string;
  category: string;
  tag: string;
  difficulty: string;
  risk: string;
  favoritesOnly: boolean;
};

export function buildGridCatalogQuery(input: GridCatalogQueryState): string {
  const params = new URLSearchParams();
  if (input.search.trim()) params.set("search", input.search.trim());
  if (input.category !== "ALL") params.set("category", input.category);
  if (input.tag !== "ALL") params.set("tag", input.tag);
  if (input.difficulty !== "ALL") params.set("difficulty", input.difficulty);
  if (input.risk !== "ALL") params.set("risk", input.risk);
  if (input.favoritesOnly) params.set("favoritesOnly", "true");
  return params.toString();
}

export function updateGridCatalogFavoriteState(
  templates: GridTemplate[],
  templateId: string,
  nextIsFavorite: boolean,
  favoritesOnly: boolean
): GridTemplate[] {
  const updated = templates.map((template) => (
    template.id === templateId ? { ...template, isFavorite: nextIsFavorite } : template
  ));
  if (favoritesOnly && !nextIsFavorite) {
    return updated.filter((template) => template.id !== templateId);
  }
  return updated;
}
