// Projects and their categories. A project holds cards on either board and
// takes its category's colour; categories are named by the user.

import { useState } from 'react';
import { CATEGORY_COLOURS } from '../../../shared/work/schemas.ts';
import type { Category, Project, WorkSnapshot } from '../../../shared/work/types.ts';
import { api } from '../../lib/api.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/toast.tsx';
import { ifConfirmed } from '../../ui/confirm.tsx';
import { workMutate } from '../../work/store.ts';

const run = async (fn: () => Promise<unknown>, done?: string) => {
  try {
    await workMutate(fn);
    if (done) toast(done);
    return true;
  } catch (err) {
    toast((err as Error).message, 'error');
    return false;
  }
};

export function ProjectsSheet({ data, onClose }: { data: WorkSnapshot; onClose: () => void }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [catName, setCatName] = useState('');
  const open = (p: Project) => data.cards.filter((c) => c.projectId === p.id && c.column !== 'done').length;
  const any = (p: Project) => data.cards.some((c) => c.projectId === p.id);
  return (
    <Sheet title="Projects" subtitle="A project groups cards on either board. Its category sets its colour." onClose={onClose}>
      <section className="proj-section" aria-labelledby="proj-title">
        <h3 id="proj-title" className="proj-section-title">
          Projects
        </h3>
        {data.projects.length ? (
          <ul className="proj-list">
            {data.projects.map((p) => (
              <ProjectRow key={p.id} p={p} categories={data.categories} open={open(p)} deletable={!any(p)} />
            ))}
          </ul>
        ) : (
          <p className="faint small">No projects yet.</p>
        )}
        <form
          className="proj-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post('/api/work/projects', { name, categoryId: categoryId ? Number(categoryId) : null }), `Added ${name}`)) setName('');
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" aria-label="New project name" autoFocus={!data.projects.length} />
          <CategorySelect categories={data.categories} value={categoryId} onChange={setCategoryId} label="New project's category" />
          <button className="btn" disabled={!name.trim()}>
            Add project
          </button>
        </form>
      </section>

      <section className="proj-section" aria-labelledby="cat-title">
        <h3 id="cat-title" className="proj-section-title">
          Categories
        </h3>
        {data.categories.length ? (
          <ul className="proj-list">
            {data.categories.map((c) => (
              <CategoryRow key={c.id} c={c} projects={data.projects.filter((p) => p.categoryId === c.id).length} />
            ))}
          </ul>
        ) : (
          <p className="faint small">No categories yet. Name a few, like a client, a product or Personal.</p>
        )}
        <form
          className="proj-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post('/api/work/categories', { name: catName }), `Added ${catName}`)) setCatName('');
          }}
        >
          <input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category name" aria-label="New category name" />
          <button className="btn" disabled={!catName.trim()}>
            Add category
          </button>
        </form>
      </section>
    </Sheet>
  );
}

function CategorySelect({ categories, value, onChange, label }: { categories: Category[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="input proj-cat" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">No category</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function ProjectRow({ p, categories, open, deletable }: { p: Project; categories: Category[]; open: number; deletable: boolean }) {
  const [name, setName] = useState(p.name);
  const save = (patch: Record<string, unknown>) => run(() => api.put(`/api/work/projects/${p.id}`, patch));
  return (
    <li className={`proj ${p.status}`}>
      <span className="proj-dot" style={{ background: p.colour }} aria-hidden="true" />
      <input className="input proj-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && void save({ name })} aria-label="Project name" />
      <CategorySelect categories={categories} value={p.categoryId ? String(p.categoryId) : ''} onChange={(v) => void save({ categoryId: v ? Number(v) : null })} label={`${p.name}'s category`} />
      <span className="proj-meta faint small num">{open} open</span>
      <span className="proj-actions">
        <button className="btn btn-sm btn-quiet" onClick={() => void save({ status: p.status === 'active' ? 'paused' : 'active' })}>
          {p.status === 'active' ? 'Pause' : 'Resume'}
        </button>
        {deletable ? (
          <button className="btn btn-sm btn-danger" onClick={() => ifConfirmed({ title: `Delete ${p.name}?` }, () => run(() => api.del(`/api/work/projects/${p.id}`), `Deleted ${p.name}`))}>
            Delete
          </button>
        ) : null}
      </span>
    </li>
  );
}

function CategoryRow({ c, projects }: { c: Category; projects: number }) {
  const [name, setName] = useState(c.name);
  const save = (patch: Record<string, unknown>) => run(() => api.put(`/api/work/categories/${c.id}`, patch));
  return (
    <li className="proj cat">
      <span className="proj-dot" style={{ background: c.colour }} aria-hidden="true" />
      <input className="input proj-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && void save({ name })} aria-label="Category name" />
      <span className="proj-meta faint small num">
        {projects} project{projects === 1 ? '' : 's'}
      </span>
      <span className="proj-actions">
        <button
          className="btn btn-sm btn-danger"
          onClick={() => ifConfirmed({ title: `Delete ${c.name}?`, body: 'Its projects stay, uncategorised.' }, () => run(() => api.del(`/api/work/categories/${c.id}`), `Deleted ${c.name}`))}
        >
          Delete
        </button>
      </span>
      <div className="proj-colours" role="radiogroup" aria-label={`${c.name} colour`}>
        {CATEGORY_COLOURS.map((col) => (
          <button key={col} className="proj-swatch" role="radio" aria-checked={col === c.colour.toLowerCase()} style={{ background: col }} onClick={() => void save({ colour: col })} aria-label={col} />
        ))}
      </div>
    </li>
  );
}
