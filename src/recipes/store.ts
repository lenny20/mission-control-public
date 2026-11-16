import type { RecipeSnapshot } from '../../shared/recipes/types.ts';
import { createSnapshot } from '../lib/snapshot.ts';

export const recipeStore = createSnapshot<RecipeSnapshot>('/api/recipes');
export const useRecipes = () => recipeStore.use();
