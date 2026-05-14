import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Filter, Download, Calendar,
  ChevronDown, MoreHorizontal, Paperclip, CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { getAllExpenses } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type ExpenseRow = {
  expense_id: string;
  name: string;
  total_amount: number | string;
  date: string;
  group?: { name?: string } | null;
  profiles?: { display_name?: string | null } | null;
  expense_share?: { user_id: string; share_amount: number; is_settled: boolean }[] | null;
  photo_evidence?: unknown[] | null;
};

type StatusFilter = 'All' | 'Settled' | 'Pending' | 'Action Needed';

function statusFromShares(shares: ExpenseRow['expense_share']): 'Settled' | 'Verified' | 'Pending' | 'Action Needed' {
  const s = shares ?? [];
  if (s.length === 0) return 'Verified';
  const all = s.every((x) => x.is_settled);
  const some = s.some((x) => x.is_settled);
  if (all) return 'Settled';
  if (some) return 'Action Needed';
  return 'Pending';
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(rows: ExpenseRow[]) {
  const headers = ['ID', 'Name', 'Group', 'Paid By', 'Amount (Rs)', 'Date', 'Status'];
  const lines = rows.map((r) => [
    String(r.expense_id).slice(0, 8),
    `"${String(r.name ?? '').replace(/"/g, '""')}"`,
    `"${String(r.group?.name ?? '').replace(/"/g, '""')}"`,
    `"${String(r.profiles?.display_name ?? '').replace(/"/g, '""')}"`,
    Number(r.total_amount).toFixed(2),
    String(r.date ?? '').slice(0, 10),
    statusFromShares(r.expense_share),
  ].join(','));
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `splitease-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────
export const History = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true); setError(null);
    try {
      const data = (await getAllExpenses(user.id)) as ExpenseRow[];
      setRows(data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    let result = rows;

    // Text search
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        const title = String(r.name ?? '').toLowerCase();
        const payer = String(r.profiles?.display_name ?? '').toLowerCase();
        const grp = String(r.group?.name ?? '').toLowerCase();
        return title.includes(q) || payer.includes(q) || grp.includes(q);
      });
    }

    // Status filter
    if (statusFilter !== 'All') {
      result = result.filter((r) => {
        const s = statusFromShares(r.expense_share);
        if (statusFilter === 'Settled') return s === 'Settled' || s === 'Verified';
        if (statusFilter === 'Pending') return s === 'Pending';
        if (statusFilter === 'Action Needed') return s === 'Action Needed';
        return true;
      });
    }

    return result;
  }, [rows, query, statusFilter]);

  // Stats
  const totalAmount = useMemo(() => filtered.reduce((s, r) => s + Number(r.total_amount), 0), [filtered]);
  const settledCount = useMemo(() => filtered.filter((r) => {
    const s = statusFromShares(r.expense_share);
    return s === 'Settled' || s === 'Verified';
  }).length, [filtered]);
  const pendingCount = useMemo(() => filtered.filter((r) => statusFromShares(r.expense_share) === 'Pending').length, [filtered]);

  if (loading) return <div className="flex items-center justify-center min-h-[40vh] text-zinc-500">Loading...</div>;
  if (error) return <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl p-4">{error}</div>;

  return (
    <div className="space-y-10 smooth-enter">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-black text-white leading-none tracking-tighter">Repository</h2>
          <p className="text-zinc-500 mt-2 uppercase text-[10px] font-black tracking-[0.2em]">Immutable transactional history</p>
        </div>
        <button
          type="button"
          onClick={() => exportCSV(filtered)}
          className="bg-zinc-900 border border-border-tonal px-6 py-4 rounded-2xl font-bold text-zinc-400 flex items-center gap-2 hover:text-white hover:border-zinc-600 transition-all"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-2xl p-5">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Total Value</p>
          <h3 className="text-2xl font-black text-white">Rs {totalAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h3>
        </div>
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-2xl p-5">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Settled</p>
          <h3 className="text-2xl font-black text-emerald-400">{settledCount} entries</h3>
        </div>
        <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-2xl p-5">
          <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Pending</p>
          <h3 className="text-2xl font-black text-amber-400">{pendingCount} entries</h3>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-4 flex-wrap items-center">
          {/* Search */}
          <div className="relative group w-80 min-w-[240px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 transition-colors group-focus-within:text-brand-orange" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, payer, or group..."
              className="w-full bg-surface-dim tonal-border rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-brand-orange/50 text-white"
            />
          </div>

          {/* Status filter pills */}
          <div className="flex gap-2">
            {(['All', 'Settled', 'Pending', 'Action Needed'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-bold transition-all border',
                  statusFilter === s
                    ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange'
                    : 'bg-zinc-900 border-border-tonal text-zinc-500 hover:text-zinc-300'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 bg-zinc-900 border border-border-tonal rounded-xl px-4 py-2 text-sm font-bold text-zinc-400 hover:text-white transition-all"
          >
            <Filter className="w-4 h-4" /> More <ChevronDown className={cn('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
          </button>
        </div>

        <div className="text-xs text-zinc-600 font-bold uppercase tracking-widest">
          {filtered.length} of {rows.length} entries
        </div>
      </div>

      {/* Table */}
      <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-[32px] overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-zinc-900/50 border-b border-border-tonal">
              <th className="px-8 py-5 text-[10px] text-zinc-500 uppercase tracking-[0.15em] font-black">ID</th>
              <th className="px-8 py-5 text-[10px] text-zinc-500 uppercase tracking-[0.15em] font-black">Subject</th>
              <th className="px-8 py-5 text-[10px] text-zinc-500 uppercase tracking-[0.15em] font-black">Origin</th>
              <th className="px-8 py-5 text-[10px] text-zinc-500 uppercase tracking-[0.15em] font-black text-right">Value</th>
              <th className="px-8 py-5 text-[10px] text-zinc-500 uppercase tracking-[0.15em] font-black">Status</th>
              <th className="px-8 py-5 text-[10px] text-zinc-500 uppercase tracking-[0.15em] font-black">Receipt</th>
              <th className="px-8 py-5 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-tonal">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-8 py-16 text-center text-zinc-500 text-sm">
                  {query || statusFilter !== 'All' ? 'No results match your filters.' : 'No expenses yet.'}
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                const payer = tx.profiles?.display_name ?? '—';
                const grp = tx.group?.name ?? '—';
                const amount = Number(tx.total_amount);
                const status = statusFromShares(tx.expense_share);
                const when = String(tx.date ?? '').slice(0, 10);
                const hasReceipt = (tx.photo_evidence?.length ?? 0) > 0;

                return (
                  <tr key={tx.expense_id} className="hover:bg-zinc-800/10 transition-colors group cursor-pointer">
                    <td className="px-8 py-6 text-xs font-mono text-zinc-600 group-hover:text-brand-orange transition-colors">
                      {String(tx.expense_id).slice(0, 8)}
                    </td>
                    <td className="px-8 py-6">
                      <p className="font-bold text-zinc-200">{tx.name}</p>
                      <p className="text-[10px] text-zinc-600 font-bold uppercase">{when}</p>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-medium text-zinc-400 block">{payer}</span>
                      <span className="text-[10px] text-zinc-600 font-bold uppercase">{grp}</span>
                    </td>
                    <td className="px-8 py-6 text-right font-black tabular-nums text-zinc-200">
                      Rs {Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        'px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1',
                        status === 'Settled' || status === 'Verified' ? 'bg-emerald-500/10 text-emerald-500' : '',
                        status === 'Pending' ? 'bg-amber-500/10 text-amber-500' : '',
                        status === 'Action Needed' ? 'bg-red-500/10 text-red-500' : '',
                      )}>
                        {(status === 'Settled' || status === 'Verified') && <CheckCircle2 className="w-3 h-3" />}
                        {status}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      {hasReceipt ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-800 px-2 py-1 rounded-md">
                          <Paperclip className="w-2.5 h-2.5" /> attached
                        </span>
                      ) : (
                        <span className="text-zinc-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-8 py-6 text-right">
                      <button type="button" className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-600 hover:text-white">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};