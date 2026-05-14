import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart2, PieChart as PieChartIcon, TrendingUp, ChevronDown, Loader2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getExpensesForAnalytics, getCategories } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';

const PIE_COLORS = ['#ff6a00', '#ffffff', '#333333', '#71717a', '#a1a1aa', '#52525b'];

type ExpenseRow = {
  expense_id: string;
  total_amount: number | string;
  date: string;
  paid_by: string;
  category_id?: string | null;
  category: { name?: string | null; category_id?: string } | null;
  profiles: { display_name?: string | null } | null;
};

type CategoryRow = { category_id: string; name: string };

export const Analytics = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'all' | '3m' | '1m'>('all');

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [draftCatIds, setDraftCatIds] = useState<Set<string>>(new Set());
  const [draftPaidBy, setDraftPaidBy] = useState<Set<string>>(new Set());

  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [appliedCatIds, setAppliedCatIds] = useState<Set<string>>(new Set());
  const [appliedPaidBy, setAppliedPaidBy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true); setError(null);
    try {
      const data = await getExpensesForAnalytics(user.id);
      setRows((data as ExpenseRow[]) ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancel = false;
    const loadCats = async () => {
      setCatLoading(true);
      try {
        const c = await getCategories();
        if (!cancel) setCategories((c as CategoryRow[]) ?? []);
      } catch {
        if (!cancel) setCategories([]);
      } finally {
        if (!cancel) setCatLoading(false);
      }
    };
    void loadCats();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  const paidByOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      const id = r.paid_by;
      const name = r.profiles?.display_name ?? 'Member';
      if (id) m.set(id, name);
    });
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = rows;

    if (dateRange !== 'all') {
      const now = new Date();
      const months = dateRange === '3m' ? 3 : 1;
      const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
      list = list.filter((r) => new Date(r.date) >= cutoff);
    }

    if (appliedFrom) {
      list = list.filter((r) => String(r.date).slice(0, 10) >= appliedFrom);
    }
    if (appliedTo) {
      list = list.filter((r) => String(r.date).slice(0, 10) <= appliedTo);
    }

    if (appliedCatIds.size > 0) {
      list = list.filter((r) => {
        const cid =
          r.category_id ??
          (r.category as { category_id?: string } | null)?.category_id;
        return cid != null && cid !== '' && appliedCatIds.has(String(cid));
      });
    }

    if (appliedPaidBy.size > 0) {
      list = list.filter((r) => appliedPaidBy.has(r.paid_by));
    }

    return list;
  }, [rows, dateRange, appliedFrom, appliedTo, appliedCatIds, appliedPaidBy]);

  const areaData = useMemo(() => {
    const byMonth = new Map<string, number>();
    filteredRows.forEach((r) => {
      const d = new Date(r.date);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.total_amount));
    });
    return Array.from(byMonth.keys()).sort().map((k) => {
      const [yStr, mStr] = k.split('-');
      const y = Number(yStr);
      const mo = Number(mStr) - 1;
      const dt = new Date(y, mo, 1);
      const monthLong = dt.toLocaleString(undefined, { month: 'long' });
      const nameShort = dt.toLocaleString(undefined, { month: 'short', year: '2-digit' });
      return {
        key: k,
        name: nameShort,
        monthLong,
        year: y,
        value: byMonth.get(k) ?? 0,
      };
    });
  }, [filteredRows]);

  const peakEntry = useMemo(() => {
    if (!areaData.length) return null;
    return areaData.reduce((best, cur) => (cur.value > best.value ? cur : best), areaData[0]);
  }, [areaData]);

  const pieData = useMemo(() => {
    const byCat = new Map<string, number>();
    filteredRows.forEach((r) => {
      const n = r.category?.name ?? 'Other';
      byCat.set(n, (byCat.get(n) ?? 0) + Number(r.total_amount));
    });
    return Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({
      name, value, color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [filteredRows]);

  const pieTotal = pieData.reduce((s, p) => s + p.value, 0) || 1;

  const memberSpend = useMemo(() => {
    const by = new Map<string, { name: string; total: number }>();
    filteredRows.forEach((r) => {
      const id = r.paid_by;
      const name = r.profiles?.display_name ?? 'Member';
      const cur = by.get(id) ?? { name, total: 0 };
      cur.total += Number(r.total_amount);
      cur.name = name;
      by.set(id, cur);
    });
    const list = Array.from(by.values()).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...list.map((m) => m.total));
    return list.map((m) => ({ ...m, percent: Math.round((m.total / max) * 100) }));
  }, [filteredRows]);

  const totalSpend = filteredRows.reduce((s, r) => s + Number(r.total_amount), 0);

  const openFilter = () => {
    setDraftFrom(appliedFrom);
    setDraftTo(appliedTo);
    setDraftCatIds(new Set(appliedCatIds));
    setDraftPaidBy(new Set(appliedPaidBy));
    setFilterOpen(true);
  };

  const applyFilter = () => {
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
    setAppliedCatIds(new Set(draftCatIds));
    setAppliedPaidBy(new Set(draftPaidBy));
    setFilterOpen(false);
  };

  const toggleDraftCat = (id: string) => {
    setDraftCatIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleDraftPaid = (id: string) => {
    setDraftPaidBy((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  if (loading) return <div className="flex items-center justify-center min-h-[40vh] text-zinc-500">Loading...</div>;
  if (error) return <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl p-4">{error}</div>;

  return (
    <div className="space-y-10 smooth-enter">
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h2 className="text-5xl font-black text-white leading-none tracking-tighter">Directorate Analytics</h2>
          <p className="text-zinc-500 mt-2 uppercase text-[10px] font-black tracking-[0.2em]">Operational Financial Intelligence</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center" ref={filterRef}>
          {(['all', '3m', '1m'] as const).map((r) => (
            <button key={r} type="button" onClick={() => setDateRange(r)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${dateRange === r ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange' : 'bg-zinc-900 border-border-tonal text-zinc-400 hover:text-white'}`}>
              {r === 'all' ? 'All time' : r === '3m' ? '3 months' : '1 month'}
            </button>
          ))}
          <div className="relative">
            <button type="button" onClick={() => (filterOpen ? setFilterOpen(false) : openFilter())}
              className="bg-zinc-900 border border-border-tonal px-4 py-2 rounded-xl text-xs font-bold text-zinc-400 flex items-center gap-2 hover:text-white">
              Filter <ChevronDown className={cn('w-4 h-4 transition-transform', filterOpen && 'rotate-180')} />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto bg-zinc-900 border border-border-tonal rounded-2xl shadow-2xl p-4 z-40 space-y-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Custom range</p>
                  <div className="flex gap-2 flex-wrap">
                    <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)}
                      className="bg-zinc-800 border border-border-tonal rounded-lg px-2 py-1.5 text-xs text-white" />
                    <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)}
                      className="bg-zinc-800 border border-border-tonal rounded-lg px-2 py-1.5 text-xs text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Categories</p>
                  {catLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-brand-orange" />
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                      {categories.map((c) => (
                        <button
                          key={c.category_id}
                          type="button"
                          onClick={() => toggleDraftCat(c.category_id)}
                          className={cn(
                            'px-2 py-1 rounded-lg text-xs font-bold border',
                            draftCatIds.has(c.category_id) ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange' : 'border-border-tonal text-zinc-500'
                          )}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Paid by</p>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {paidByOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleDraftPaid(p.id)}
                        className={cn(
                          'px-2 py-1 rounded-lg text-xs font-bold border',
                          draftPaidBy.has(p.id) ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange' : 'border-border-tonal text-zinc-500'
                        )}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={applyFilter}
                  className="w-full bg-brand-orange text-white py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-brand-orange/90"
                >
                  Apply filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-3xl p-6">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Total Spent</p>
          <h3 className="text-3xl font-black text-white tracking-tighter">Rs {totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
        </div>
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-3xl p-6">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Peak Month</p>
          {!peakEntry || peakEntry.value <= 0 ? (
            <h3 className="text-3xl font-black text-white tracking-tighter">—</h3>
          ) : (
            <>
              <h3 className="text-3xl font-black text-white tracking-tighter">
                {peakEntry.monthLong} {peakEntry.year}
              </h3>
              <p className="text-sm text-zinc-500 mt-1 font-bold tabular-nums">
                Rs {peakEntry.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </>
          )}
        </div>
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-3xl p-6">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Top Category</p>
          <h3 className="text-3xl font-black text-white tracking-tighter">{pieData[0]?.name ?? '—'}</h3>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-[32px] p-8 space-y-8">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-xl font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" /> Monthly spending
              </h4>
              <p className="text-xs text-zinc-500 mt-1">Totals grouped by calendar month</p>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={
                  areaData.length
                    ? areaData
                    : [{ key: '_', name: '—', monthLong: '—', year: 0, value: 0 }]
                }
              >
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff6a00" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ff6a00" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11, fontWeight: 700 }} dy={10} />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => [`Rs ${(Number(v) || 0).toLocaleString()}`, 'Total']}
                  contentStyle={{ backgroundColor: '#121414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                />
                <Area type="monotone" dataKey="value" stroke="#ff6a00" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-[32px] p-8 space-y-8">
          <div>
            <h4 className="text-xl font-bold text-white flex items-center gap-2">
              <PieChartIcon className="w-5 h-5 text-brand-orange" /> Category Allocation
            </h4>
            <p className="text-xs text-zinc-500 mt-1">Distribution by spending category</p>
          </div>
          <div className="flex items-center gap-10">
            <div className="h-[240px] w-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData.length ? pieData : [{ name: '—', value: 1, color: '#333333' }]}
                    cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {(pieData.length ? pieData : [{ name: '—', value: 1, color: '#333333' }]).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-4 flex-1">
              {(pieData.length ? pieData : [{ name: 'No data', value: 0, color: '#333333' }]).map((p, i) => (
                <div key={i} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-sm font-bold text-zinc-300 truncate">{p.name}</span>
                  </div>
                  <span className="text-sm font-black text-white shrink-0">{((p.value / pieTotal) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-[32px] p-8">
        <h4 className="text-xl font-bold text-white mb-8 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-brand-orange" /> Per-Member Spending
        </h4>
        <div className="space-y-6">
          {memberSpend.length === 0 ? (
            <p className="text-zinc-500 text-sm">No expenses yet.</p>
          ) : (
            memberSpend.map((op, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between items-end">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar displayName={op.name} size={8} />
                    <span className="font-bold text-zinc-200 truncate">{op.name}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-black text-white">Rs {op.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="ml-2 text-[10px] text-zinc-600 font-bold uppercase">{op.percent}% share</span>
                  </div>
                </div>
                <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-orange rounded-full transition-all duration-1000" style={{ width: `${op.percent}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
