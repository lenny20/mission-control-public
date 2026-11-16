import { recipeInput, recipePatch, recipeTitleKey, type RecipeInput } from '../../shared/recipes/schemas.ts';
import type { Recipe, RecipeSave } from '../../shared/recipes/types.ts';
import { transaction, type Db } from '../db.ts';
import { ConflictError, UserError } from '../errors.ts';
import { fileUrl, storeImage } from '../files.ts';

type Row = {
  id: number; title: string; description: string | null; servings: number | null;
  prep_minutes: number | null; cook_minutes: number | null; ingredients: string; steps: string; tags: string;
  notes: string | null; source_url: string | null; source_image: string | null; favourite: number;
  source: Recipe['source']; created_at: string; updated_at: string; revision: number;
};

function fromRow(r: Row): Recipe {
  return {
    id: r.id, title: r.title, description: r.description, servings: r.servings,
    prepMinutes: r.prep_minutes, cookMinutes: r.cook_minutes,
    ingredients: JSON.parse(r.ingredients), steps: JSON.parse(r.steps), tags: JSON.parse(r.tags),
    notes: r.notes, sourceUrl: r.source_url, sourceImage: fileUrl(r.source_image), favourite: !!r.favourite,
    source: r.source, createdAt: r.created_at, updatedAt: r.updated_at, revision: r.revision,
  };
}

export function listRecipes(db: Db): Recipe[] {
  return (db.prepare('SELECT * FROM recipes ORDER BY created_at DESC, id DESC').all() as Row[]).map(fromRow);
}

export function getRecipe(db: Db, id: number): Recipe {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new UserError(`There is no recipe with id ${id}.`, 404);
  return fromRow(row);
}

function titleClash(db: Db, title: string, except?: number): Recipe | null {
  const row = db.prepare('SELECT * FROM recipes WHERE title_key = ?').get(recipeTitleKey(title)) as Row | undefined;
  return row && row.id !== except ? fromRow(row) : null;
}

function values(r: RecipeInput) {
  return [r.title, recipeTitleKey(r.title), r.description, r.servings, r.prepMinutes, r.cookMinutes,
    JSON.stringify(r.ingredients), JSON.stringify(r.steps), JSON.stringify(r.tags), r.notes, r.sourceUrl];
}

const clash = (r: Recipe) => new ConflictError(`Recipe ${r.id}, "${r.title}", is already saved with different details. Open it to edit, or choose a different name for a variation.`, r);

export function addRecipe(db: Db, raw: unknown, options: { source: Recipe['source']; image?: string | null; replace?: boolean }): RecipeSave {
  const input = recipeInput.parse(raw);
  return transaction(db, () => {
    const before = titleClash(db, input.title);
    // Sending the same recipe twice is a no-op. Case or spacing in its name
    // doesn't make a second recipe, and omitted favourites keep their state.
    const equal = before && JSON.stringify(values({ ...before, title: recipeTitleKey(before.title) })) ===
      JSON.stringify(values({ ...input, title: recipeTitleKey(input.title) })) &&
      (input.favourite === undefined || input.favourite === before.favourite);
    if (before && !equal && !options.replace) throw clash(before);
    const image = options.image ? storeImage(options.image, 'sources') : null;
    if (before && equal && (!image || fileUrl(image) === before.sourceImage)) return { recipe: before, outcome: 'unchanged' };
    if (before && image && before.sourceImage && fileUrl(image) !== before.sourceImage && !options.replace) throw clash(before);
    if (before) {
      const recipe = updateRecipe(db, before.id, input, options.image);
      return { recipe, outcome: 'replaced' };
    }
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO recipes
      (title, title_key, description, servings, prep_minutes, cook_minutes, ingredients, steps, tags, notes, source_url,
       source_image, favourite, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...values(input), image, input.favourite ? 1 : 0, options.source, now, now);
    return { recipe: getRecipe(db, Number(result.lastInsertRowid)), outcome: 'saved' };
  });
}

export function updateRecipe(db: Db, id: number, raw: unknown, image?: string | null): Recipe {
  const patch = recipePatch.parse(raw);
  return transaction(db, () => {
    const before = getRecipe(db, id);
    if (patch.baseRevision !== undefined && patch.baseRevision !== before.revision) {
      throw new UserError('This recipe changed since you opened it. Copy your changes, reopen it and try again.', 409);
    }
    const next = { ...before, ...patch, favourite: patch.favourite ?? before.favourite };
    const duplicate = titleClash(db, next.title, id);
    if (duplicate) throw new UserError(`Recipe ${duplicate.id} already uses that name. Choose a different name for this variation.`, 409);
    const storedImage = image ? storeImage(image, 'sources') : null;
    db.prepare(`UPDATE recipes SET title = ?, title_key = ?, description = ?, servings = ?, prep_minutes = ?, cook_minutes = ?,
      ingredients = ?, steps = ?, tags = ?, notes = ?, source_url = ?, favourite = ?, source_image = COALESCE(?, source_image),
      updated_at = ?, revision = revision + 1 WHERE id = ?`)
      .run(...values(next), next.favourite ? 1 : 0, storedImage, new Date().toISOString(), id);
    return getRecipe(db, id);
  });
}

export function deleteRecipe(db: Db, id: number): Recipe {
  return transaction(db, () => {
    const recipe = getRecipe(db, id);
    db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
    return recipe;
  });
}
