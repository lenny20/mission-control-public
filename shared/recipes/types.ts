import type { DateStr } from '../dates.ts';
import type { RecipeInput } from './schemas.ts';

export type Recipe = Omit<RecipeInput, 'favourite'> & {
  id: number;
  favourite: boolean;
  sourceImage: string | null;
  source: 'chat' | 'dashboard';
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type RecipeSnapshot = { today: DateStr; recipes: Recipe[] };
export type RecipeSave = { recipe: Recipe; outcome: 'saved' | 'unchanged' | 'replaced' };
