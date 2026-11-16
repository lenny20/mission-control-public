import { useState } from 'react';
import { filterRecipes, recipeTime } from '../../../shared/recipes/search.ts';
import type { Recipe } from '../../../shared/recipes/types.ts';
import { api } from '../../lib/api.ts';
import { useRequest } from '../../lib/commands.ts';
import { useKey } from '../../lib/hooks.ts';
import { href, navigate } from '../../lib/router.ts';
import { recipeStore, useRecipes } from '../../recipes/store.ts';
import { confirmAction } from '../../ui/confirm.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { IconChevronLeft, IconClock, IconEdit, IconExternal, IconPlus, IconRecipes, IconSearch, IconStar, IconTrash } from '../../ui/icons.tsx';
import { toast } from '../../ui/toast.tsx';
import { RecipeEditor } from './RecipeEditor.tsx';

export function RecipesPage({ id }: { id?: number }) {
  const { data, error } = useRecipes();
  const [editor, setEditor] = useState<{ recipe: Recipe | null } | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [view, setView] = useState<'all' | 'favourites'>('all');
  const [sort, setSort] = useState('recent');
  const add = () => setEditor({ recipe: null });
  useRequest('recipes', add);
  useKey('n', (e) => {
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    add();
  });
  const selected = data?.recipes.find((r) => r.id === id);
  const tags = [...new Set(data?.recipes.flatMap((r) => r.tags) ?? [])].sort();
  const shown = filterRecipes(data?.recipes ?? [], query, tag, view === 'favourites');
  if (sort === 'name') shown.sort((a, b) => a.title.localeCompare(b.title));
  const clear = () => { setQuery(''); setTag(''); setView('all'); };

  return (
    <div className="page recipes-page">
      <header className="page-head">
        <h1 className="page-title">Recipe vault</h1>
        {!id ? <Segmented label="Recipe collection" value={view} onChange={setView} options={[{ value: 'all', label: 'All recipes' }, { value: 'favourites', label: 'Favourites' }]} /> : null}
        <div className="head-actions"><button className="btn btn-primary" onClick={add} title="Save a recipe (N)"><IconPlus /> Add recipe</button></div>
      </header>
      {error ? <div className="form-error" role="alert">{error} <button className="btn btn-sm" onClick={() => void recipeStore.refresh()}>Try again</button></div> : null}
      {!data ? <div className="loading" aria-busy="true" aria-label="Loading recipes" /> : id ? (
        selected ? <RecipeDetail key={`${selected.id}:${JSON.stringify(selected.ingredients)}`} recipe={selected} onEdit={() => setEditor({ recipe: selected })} /> :
          <div className="empty"><strong>This recipe is no longer in the vault.</strong><a href={href({ area: 'recipes' })}>Back to recipes</a></div>
      ) : <>
        <div className="recipe-collection-head">
          <p>{data.recipes.length ? `${data.recipes.length} recipe${data.recipes.length === 1 ? '' : 's'} to come back to.` : 'A home for the recipes you want to make again.'}</p>
          <p className="recipe-chat-hint">Send a recipe in chat and ask to save it here.</p>
        </div>
        <div className="recipe-filters">
          <label className="recipe-search"><IconSearch /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search recipes" placeholder="Search recipes, ingredients or tags" /></label>
          <select className="input" aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select className="input" aria-label="Sort recipes" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">Newest first</option><option value="name">Name A–Z</option></select>
        </div>
        {!data.recipes.length ? <div className="blank recipe-blank">
          <span className="blank-icon"><IconRecipes /></span>
          <h2 className="blank-title">Keep your first recipe</h2>
          <p className="blank-text">Send a recipe as text, a link or a screenshot in chat. Its ingredients, steps and source will be kept together, ready when you want to cook.</p>
          <button className="btn btn-primary" onClick={add}><IconPlus /> Add recipe</button>
        </div> : !shown.length ? <div className="empty"><strong>{view === 'favourites' && !query && !tag ? 'No favourites yet.' : 'No recipes match these filters.'}</strong>
          <p>{view === 'favourites' ? 'Star a recipe to keep it close at hand.' : 'Try another ingredient, name or tag.'}</p><button className="btn" onClick={clear}>Show all recipes</button>
        </div> : <>
          <p className="recipe-results" role="status">{shown.length} {shown.length === 1 ? 'recipe' : 'recipes'}{view === 'favourites' ? ' in favourites' : ''}</p>
          <ul className="recipe-grid">{shown.map((r) => <li className="recipe-card" key={r.id}>
            <a className="recipe-card-link" href={href({ area: 'recipes', id: r.id })}>
              <span className="recipe-card-mark" aria-hidden="true"><IconRecipes /></span>
              <h2>{r.title}</h2>
              <p className="recipe-card-description">{r.description ?? r.ingredients.slice(0, 3).join(', ')}</p>
              {r.tags.length ? <span className="recipe-tags">{r.tags.slice(0, 3).map((t) => <span key={t}>{t}</span>)}{r.tags.length > 3 ? <span>+{r.tags.length - 3}</span> : null}</span> : null}
              <span className="recipe-card-meta">{recipeTime(r) ? <span><IconClock />{recipeTime(r)}</span> : null}{r.servings != null ? <span>Serves {r.servings}</span> : null}<span>{r.ingredients.length} ingredients</span></span>
            </a>
            <FavouriteButton recipe={r} compact />
          </li>)}</ul>
        </>}
      </>}
      {editor ? <RecipeEditor recipe={editor.recipe} onClose={() => setEditor(null)} /> : null}
    </div>
  );
}

function FavouriteButton({ recipe, compact = false }: { recipe: Recipe; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await recipeStore.mutate(() => api.put(`/api/recipes/${recipe.id}`, { favourite: !recipe.favourite })); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return <button className={`btn recipe-favourite ${compact ? 'icon-btn' : ''}`} aria-label={`${recipe.favourite ? 'Remove' : 'Add'} ${recipe.title} ${recipe.favourite ? 'from' : 'to'} favourites`} aria-pressed={recipe.favourite} disabled={busy} onClick={() => void toggle()}>
    <IconStar filled={recipe.favourite} />{compact ? null : recipe.favourite ? 'Favourited' : 'Favourite'}
  </button>;
}

function RecipeDetail({ recipe: r, onEdit }: { recipe: Recipe; onEdit: () => void }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    if (!await confirmAction({ title: `Delete “${r.title}”?`, body: 'This removes the recipe from your vault.', confirm: 'Delete recipe' })) return;
    setDeleting(true);
    try {
      await recipeStore.mutate(() => api.del(`/api/recipes/${r.id}`));
      navigate({ area: 'recipes' });
      toast('Recipe deleted');
    } catch (err) { toast((err as Error).message, 'error'); }
    finally { setDeleting(false); }
  };
  return <article className="recipe-detail">
    <div className="recipe-detail-toolbar">
      <a className="btn btn-quiet" href={href({ area: 'recipes' })}><IconChevronLeft /> All recipes</a>
      <div><FavouriteButton recipe={r} /><button className="btn" onClick={onEdit}><IconEdit /> Edit recipe</button><button className="btn btn-quiet icon-btn" aria-label="Delete recipe" disabled={deleting} onClick={() => void remove()}><IconTrash /></button></div>
    </div>
    <div className="recipe-title-block">
      {r.tags.length ? <div className="recipe-tags">{r.tags.map((t) => <span key={t}>{t}</span>)}</div> : null}
      <h2>{r.title}</h2>
      {r.description ? <p>{r.description}</p> : null}
      {r.servings != null || r.prepMinutes != null || r.cookMinutes != null ? <dl className="recipe-facts">
        {r.servings != null ? <div><dt>Servings</dt><dd>{r.servings}</dd></div> : null}
        {r.prepMinutes != null ? <div><dt>Prep</dt><dd>{r.prepMinutes}<span> min</span></dd></div> : null}
        {r.cookMinutes != null ? <div><dt>Cook</dt><dd>{r.cookMinutes}<span> min</span></dd></div> : null}
      </dl> : null}
    </div>
    <div className="recipe-cooking">
      <section className="recipe-ingredients">
        <h3>Ingredients <span>{r.ingredients.length}</span></h3>
        <p>Tick off as you go.</p>
        <ul>{r.ingredients.map((ingredient, i) => <li key={i}><label><input type="checkbox" checked={checked.has(i)} onChange={() => setChecked((old) => { const next = new Set(old); if (next.has(i)) next.delete(i); else next.add(i); return next; })} /><span>{ingredient}</span></label></li>)}</ul>
        {checked.size ? <button className="btn btn-quiet btn-sm" onClick={() => setChecked(new Set())}>Reset checks</button> : null}
      </section>
      <section className="recipe-method"><h3>Method</h3><ol>{r.steps.map((step, i) => <li key={i}><p>{step}</p></li>)}</ol></section>
    </div>
    {r.notes ? <section className="recipe-notes"><h3>Notes</h3><p>{r.notes}</p></section> : null}
    {r.sourceUrl || r.sourceImage ? <footer className="recipe-source"><h3>Kept with this recipe</h3><div>
      {r.sourceUrl ? <a className="btn" href={r.sourceUrl} target="_blank" rel="noreferrer"><IconExternal /> Original recipe</a> : null}
      {r.sourceImage ? <a className="btn" href={r.sourceImage} target="_blank" rel="noreferrer"><IconExternal /> Source image</a> : null}
    </div></footer> : null}
  </article>;
}
