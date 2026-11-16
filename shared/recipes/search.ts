import type { Recipe } from './types.ts';

export function recipeSearchText(r: Recipe): string {
  return [r.title, r.description, ...r.ingredients, ...r.steps, ...r.tags, r.notes, r.sourceUrl].filter(Boolean).join(' ');
}

export function filterRecipes(recipes: Recipe[], query = '', tag = '', favouritesOnly = false): Recipe[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return recipes.filter((r) => (!favouritesOnly || r.favourite) && (!tag || r.tags.includes(tag)) &&
    words.every((word) => recipeSearchText(r).toLocaleLowerCase().includes(word)));
}

/** Unknown time stays unknown: a prep-only recipe isn't labelled with a total. */
export function recipeTime(r: Pick<Recipe, 'prepMinutes' | 'cookMinutes'>): string | null {
  if (r.prepMinutes != null && r.cookMinutes != null) return `${r.prepMinutes + r.cookMinutes} min`;
  if (r.prepMinutes != null) return `${r.prepMinutes} min prep`;
  if (r.cookMinutes != null) return `${r.cookMinutes} min cook`;
  return null;
}
