import { useEffect, useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import type { Category, CategoryKind, CategoryRule, RuleMatchType } from '../types';
import { api } from '../lib/api';

interface RulesViewProps {
  categories: Category[];
  onDataChanged: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function RulesView({ categories, onDataChanged, onNotify }: RulesViewProps) {
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<RuleMatchType>('contains');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [renamePayee, setRenamePayee] = useState('');
  const [priority, setPriority] = useState('150');

  // New Category form
  const [catName, setCatName] = useState('');
  const [catGroup, setCatGroup] = useState('Essential Living');
  const [catKind, setCatKind] = useState<CategoryKind>('expense');
  const [catColor, setCatColor] = useState('#2E6F57');

  async function loadRules() {
    const r = await api.listCategoryRules();
    setRules(r);
  }

  useEffect(() => {
    void loadRules();
  }, []);

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim() || !categoryId) return;
    await api.upsertCategoryRule({
      pattern,
      matchType,
      categoryId,
      renamePayee: renamePayee || null,
      priority: Number(priority) || 150,
    });
    setPattern('');
    setRenamePayee('');
    await loadRules();
    onNotify(`Added rule for '${pattern.trim()}'.`);
  }

  async function handleRunRules(onlyUncategorized: boolean) {
    const updated = await api.applyCategoryRules(onlyUncategorized);
    await onDataChanged();
    onNotify(
      updated > 0
        ? `Updated ${updated} ${updated === 1 ? 'transaction' : 'transactions'} using your categorization rules.`
        : 'No matching transactions needed updates.'
    );
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catName.trim()) return;
    await api.upsertCategory({
      name: catName,
      groupName: catGroup,
      kind: catKind,
      color: catColor,
    });
    setCatName('');
    await onDataChanged();
    onNotify(`Added category '${catName.trim()}'.`);
  }

  return (
    <div className="stack-lg">
      {/* Categorization Rules */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Automatic categorization rules</h2>
            <div className="panel-subtitle">
              Rules run automatically when importing statements and can clean up cryptic bank payee
              text
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => handleRunRules(true)}>
              <Play size={14} />
              <span>Run on uncategorized</span>
            </button>
            <button type="button" className="btn btn-sm" onClick={() => handleRunRules(false)}>
              Re-apply to all
            </button>
          </div>
        </div>

        <form
          onSubmit={handleAddRule}
          style={{
            padding: '14px 20px',
            backgroundColor: 'var(--checkbook-slate)',
            borderBottom: '1px solid var(--rule-line)',
            display: 'grid',
            gridTemplateColumns: '1.2fr 0.85fr 1.1fr 1.1fr 90px auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <div>
            <label className="field-label" htmlFor="rule-pat">
              When bank text matches
            </label>
            <input
              id="rule-pat"
              className="input input-sm"
              placeholder="e.g., TRADER JOE or WATER UTIL"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="rule-match">
              Match type
            </label>
            <select
              id="rule-match"
              className="select select-sm"
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as RuleMatchType)}
            >
              <option value="contains">Contains</option>
              <option value="starts_with">Starts with</option>
              <option value="exact">Exact match</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="rule-cat">
              Assign category
            </label>
            <select
              id="rule-cat"
              className="select select-sm"
              value={categoryId || categories[0]?.id || ''}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="rule-rename">
              Clean payee name (optional)
            </label>
            <input
              id="rule-rename"
              className="input input-sm"
              placeholder="e.g., Trader Joe's"
              value={renamePayee}
              onChange={(e) => setRenamePayee(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="rule-prio">
              Priority
            </label>
            <input
              id="rule-prio"
              type="number"
              className="input input-sm tabular"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-sm btn-primary">
            <Plus size={14} />
            <span>Add rule</span>
          </button>
        </form>

        <div className="ledger-table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Match text</th>
                <th>Condition</th>
                <th>Category</th>
                <th>Rename payee to</th>
                <th className="num">Priority</th>
                <th style={{ width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.pattern}</td>
                  <td style={{ color: 'var(--ink-secondary)' }}>
                    {r.matchType === 'starts_with'
                      ? 'Starts with'
                      : r.matchType === 'exact'
                        ? 'Exact'
                        : 'Contains'}
                  </td>
                  <td>
                    <span className="chip">{r.categoryName ?? 'Unknown category'}</span>
                  </td>
                  <td style={{ color: 'var(--ink-secondary)' }}>{r.renamePayee || '—'}</td>
                  <td className="num">{r.priority}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete rule ${r.pattern}`}
                      onClick={async () => {
                        await api.deleteCategoryRule(r.id);
                        await loadRules();
                        onNotify(`Deleted rule '${r.pattern}'.`);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Household Categories */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Household categories</h2>
            <div className="panel-subtitle">
              Add or customize spending, income, and transfer categories
            </div>
          </div>
        </div>

        <form
          onSubmit={handleAddCategory}
          style={{
            padding: '14px 20px',
            backgroundColor: 'var(--checkbook-slate)',
            borderBottom: '1px solid var(--rule-line)',
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr 0.9fr 74px auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <div>
            <label className="field-label" htmlFor="new-cat-name">
              Category name
            </label>
            <input
              id="new-cat-name"
              className="input input-sm"
              placeholder="e.g., Childcare or Pet Care"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="new-cat-grp">
              Group
            </label>
            <select
              id="new-cat-grp"
              className="select select-sm"
              value={catGroup}
              onChange={(e) => setCatGroup(e.target.value)}
            >
              <option value="Essential Living">Essential Living</option>
              <option value="Lifestyle">Lifestyle</option>
              <option value="Income">Income</option>
              <option value="Transfers">Transfers</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="new-cat-kind">
              Type
            </label>
            <select
              id="new-cat-kind"
              className="select select-sm"
              value={catKind}
              onChange={(e) => setCatKind(e.target.value as CategoryKind)}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="new-cat-color">
              Color
            </label>
            <input
              id="new-cat-color"
              type="color"
              className="input input-sm"
              style={{ padding: 2, height: 32 }}
              value={catColor}
              onChange={(e) => setCatColor(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-sm btn-primary">
            <Plus size={14} />
            <span>Add category</span>
          </button>
        </form>

        <div className="ledger-table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Group</th>
                <th>Type</th>
                <th style={{ width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                      <span className="chip-dot" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-secondary)' }}>{c.groupName}</td>
                  <td>
                    <span className="chip">{c.kind}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete category ${c.name}`}
                      onClick={async () => {
                        if (window.confirm(`Delete category '${c.name}'? Transactions using it will become Uncategorized.`)) {
                          await api.deleteCategory(c.id);
                          await onDataChanged();
                          onNotify(`Deleted category '${c.name}'.`);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
