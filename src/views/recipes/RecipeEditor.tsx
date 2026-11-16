import { useEffect, useRef, useState } from 'react';
import type { Recipe, RecipeSave } from '../../../shared/recipes/types.ts';
import { api } from '../../lib/api.ts';
import { navigate, setLeaveGuard } from '../../lib/router.ts';
import { recipeStore } from '../../recipes/store.ts';
import { confirmAction } from '../../ui/confirm.tsx';
import { fromNum, NumberField, TextField, toNum } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/toast.tsx';

export function RecipeEditor({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const [initial] = useState(() => ({
    title: recipe?.title ?? '', description: recipe?.description ?? '',
    servings: fromNum(recipe?.servings), prepMinutes: fromNum(recipe?.prepMinutes), cookMinutes: fromNum(recipe?.cookMinutes),
    ingredients: recipe?.ingredients.join('\n') ?? '', steps: recipe?.steps.join('\n\n') ?? '',
    tags: recipe?.tags.join(', ') ?? '', notes: recipe?.notes ?? '', sourceUrl: recipe?.sourceUrl ?? '',
  }));
  const [form, setForm] = useState(initial);
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearGuard = useRef<() => void>(() => {});
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const dirty = image !== null || JSON.stringify(form) !== JSON.stringify(initial);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (v: string) => setForm((f) => ({ ...f, [key]: v })) });

  useEffect(() => {
    if (error) errorMessage.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    const clear = setLeaveGuard(() => window.confirm('Discard your unsaved recipe changes?'));
    clearGuard.current = clear;
    return () => { clear(); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);

  const close = async () => {
    if (busy) return;
    if (!dirty || await confirmAction({ title: 'Discard your recipe changes?', body: 'Your changes have not been saved.', confirm: 'Discard changes' })) onClose();
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const input = {
      title: form.title, description: form.description || null,
      servings: toNum(form.servings), prepMinutes: toNum(form.prepMinutes), cookMinutes: toNum(form.cookMinutes),
      ingredients: recipe && form.ingredients === initial.ingredients ? recipe.ingredients : form.ingredients.split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
      steps: recipe && form.steps === initial.steps ? recipe.steps : form.steps.split(/\n\s*\n/).map((v) => v.trim()).filter(Boolean),
      tags: recipe && form.tags === initial.tags ? recipe.tags : form.tags.split(',').map((v) => v.trim()).filter(Boolean), notes: form.notes || null, sourceUrl: form.sourceUrl.trim() || null,
      ...(recipe ? { baseRevision: recipe.revision } : {}),
    };
    const body = new FormData();
    body.set('data', JSON.stringify(input));
    if (image) body.set('image', image);
    try {
      const saved = await recipeStore.mutate(async () => recipe
        ? api.put<Recipe>(`/api/recipes/${recipe.id}`, body)
        : (await api.post<RecipeSave>('/api/recipes', body)).recipe);
      // Release this editor's navigation guard before opening the saved recipe.
      clearGuard.current();
      onClose();
      navigate({ area: 'recipes', id: saved.id });
      toast('Recipe saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={recipe ? 'Edit recipe' : 'Save a recipe'} onClose={() => void close()} footer={<>
      <button className="btn" onClick={() => void close()} disabled={busy}>Cancel</button>
      <button className="btn btn-primary" form="recipe-form" disabled={busy}>{busy ? 'Saving…' : 'Save recipe'}</button>
    </>}>
      <form id="recipe-form" className="recipe-form" onSubmit={save}>
        {error ? <p className="form-error" role="alert" ref={errorMessage}>{error}</p> : null}
        <TextField label="Recipe name" {...field('title')} placeholder="What are we making?" />
        <TextField label="Description (optional)" {...field('description')} placeholder="A few words about this recipe" />
        <div className="field-row">
          <NumberField label="Servings" {...field('servings')} />
          <NumberField label="Prep time" unit="min" step="1" {...field('prepMinutes')} />
          <NumberField label="Cook time" unit="min" step="1" {...field('cookMinutes')} />
        </div>
        <label className="field"><span>Ingredients</span>
          <textarea value={form.ingredients} onChange={(e) => field('ingredients').onChange(e.target.value)} rows={6} required placeholder={'200 g pasta\n2 tbsp olive oil\n2 garlic cloves, sliced'} />
          <small>One ingredient per line. Keep quantities and preparation notes together.</small>
        </label>
        <label className="field"><span>Method</span>
          <textarea value={form.steps} onChange={(e) => field('steps').onChange(e.target.value)} rows={8} required placeholder={'Bring a pan of salted water to the boil.\n\nCook the pasta, then drain.'} />
          <small>Leave a blank line between steps. The vault numbers them for you.</small>
        </label>
        <TextField label="Tags (optional)" {...field('tags')} placeholder="Dinner, quick, vegetarian" />
        <TextField label="Notes (optional)" {...field('notes')} multiline placeholder="Substitutions, serving ideas, or what to change next time" />
        <TextField label="Source link (optional)" {...field('sourceUrl')} placeholder="https://…" />
        <label className="field"><span>{recipe?.sourceImage ? 'Replace source image (optional)' : 'Source image (optional)'}</span>
          <input type="file" accept=".jpg,.jpeg,.png,.webp,.heic" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          {recipe?.sourceImage ? <small>The saved image stays unless you choose a replacement.</small> : null}
        </label>
      </form>
    </Sheet>
  );
}
