import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, ArrowDownLeft, Zap, Plus, Wallet,
  TrendingUp, Receipt, AlertCircle, Brain, CheckCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { ExpenseModal } from './ExpenseModal';
import {
  getBalancesForUserAcrossGroups,
  getExpensesForUserGroups,
  getFreelooaders,
  getBalancesForGroupIds,
  getGroupIdsForUser,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type BalanceRow = { net_balance: number | string | null; user_id?: string; group_id?: string; display_name?: string | null };

function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function expenseDateKey(raw: unknown): string {
  const s = String(raw ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toLocalYMD(d);
  return s.slice(0, 10);
}

export type ChartDayPoint = {
  name: string;
  value: number;
  idx: number;
  dateKey: string;
  dateCaption: string;
};

function buildLast7DaysChart(expenses: { date: string; total_amount: number | string }[]): ChartDayPoint[] {
  const dayKeys: string[] = [];
  const dayLabels: string[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    dayKeys.push(toLocalYMD(d));
    dayLabels.push(dayNames[d.getDay()]);
  }
  const totals: Record<string, number> = {};
  dayKeys.forEach((k) => { totals[k] = 0; });
  for (const e of expenses) {
    const key = expenseDateKey(e.date);
    if (totals[key] !== undefined) totals[key] += Number(e.total_amount);
  }
  return dayKeys.map((k, i) => {
    const [yy, mm, dd] = k.split('-').map(Number);
    const cal = new Date(yy, mm - 1, dd);
    const dateCaption = cal.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      name: dayLabels[i],
      value: totals[k] ?? 0,
      idx: i,
      dateKey: k,
      dateCaption,
    };
  });
}

function formatCompactRs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function SpendingTooltip(props: { active?: boolean; payload?: readonly { payload: ChartDayPoint }[] }) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const v = Number(row.value) || 0;
  return (
    <div
      className="rounded-xl border border-border-tonal px-3 py-2 shadow-xl"
      style={{ backgroundColor: '#121414', fontSize: 12, fontWeight: 700, color: '#fff' }}
    >
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">{row.dateCaption}</p>
      <p className="text-base font-black text-white tabular-nums">
        Rs {v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </p>
      <p className="text-[10px] text-zinc-500 mt-1 font-medium leading-snug max-w-[220px]">
        Sum of every expense total in your groups with this date (whole group, not only your share).
      </p>
    </div>
  );
}

type InsightRow = { icon: string; text: string; color: string };

type FreeloaderLine = { name: string; owes: number; subtitle?: string };

function pickViewFreeloaderOwes(row: Record<string, unknown>): number {
  const keys = ['amount_owed', 'total_owed', 'owed', 'balance', 'net_balance', 'debt'];
  for (const k of keys) {
    if (k in row && row[k] != null && !Number.isNaN(Number(row[k]))) {
      const n = Number(row[k]);
      if (n !== 0) return Math.abs(n);
    }
  }
  return 0;
}

const SummaryCard = ({
  title, amount, trend, isPositive, icon: Icon,
}: {
  title: string; amount: number; trend: string; isPositive: boolean; icon: React.ElementType;
}) => (
  <div className="interactive-card glow-on-hover bg-surface-dim tonal-border rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden group">
    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
      <Icon className="w-24 h-24" />
    </div>
    <div className="flex justify-between items-start mb-6">
      <div className="p-3 bg-zinc-800/50 rounded-2xl tonal-border">
        <Icon className="w-6 h-6 text-brand-orange" />
      </div>
      <div className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider',
        isPositive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
      )}>
        {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
        {trend}
      </div>
    </div>
    <div>
      <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-1">{title}</p>
      <h3 className="text-3xl font-black text-white tracking-tighter">
        Rs {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </h3>
    </div>
  </div>
);

export const Dashboard = () => {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [owed, setOwed] = useState(0);
  const [owing, setOwing] = useState(0);
  const [chartData, setChartData] = useState<ChartDayPoint[]>([]);
  const [activity, setActivity] = useState<{
    title: string; cat: string; status: string;
    date: string; amount: number; color: string; hasReceipt?: boolean;
  }[]>([]);
  const [freeloaderLines, setFreeloaderLines] = useState<FreeloaderLine[]>([]);
  const [allExpenses, setAllExpenses] = useState<{ total_amount: number | string; category?: { name?: string | null } | null }[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const groupIds = await getGroupIdsForUser(user.id);
      const [balances, allExpensesRaw, fl, allGroupBalances] = await Promise.all([
        getBalancesForUserAcrossGroups(user.id),
        getExpensesForUserGroups(user.id),
        getFreelooaders(),
        getBalancesForGroupIds(groupIds),
      ]);

      let o = 0; let w = 0;
      (balances as BalanceRow[] | null)?.forEach((b) => {
        const n = Number(b.net_balance);
        if (n > 0) o += n;
        if (n < 0) w += -n;
      });
      setOwed(o);
      setOwing(w);

      const expenseList = (allExpensesRaw ?? []) as Record<string, unknown>[];

      const sinceD = new Date();
      sinceD.setHours(0, 0, 0, 0);
      sinceD.setDate(sinceD.getDate() - 7);
      const sinceStr = toLocalYMD(sinceD);
      const last7 = expenseList.filter((e) => expenseDateKey(e.date) >= sinceStr);

      setChartData(buildLast7DaysChart(last7 as { date: string; total_amount: number }[]));

      setAllExpenses(expenseList as { total_amount: number | string; category?: { name?: string | null } | null }[]);

      const rows = expenseList.slice(0, 12).map((e) => {
        const groupName = (e.group as { name?: string } | null)?.name ?? 'Group';
        const shares = (e.expense_share as { is_settled: boolean }[] | null) ?? [];
        const settled = shares.length > 0 && shares.every((s) => s.is_settled);
        const photoEvidence = (e.photo_evidence as unknown[] | null) ?? [];
        return {
          title: String(e.name ?? ''),
          cat: groupName,
          status: settled ? 'Verified' : 'Pending',
          date: expenseDateKey(e.date),
          amount: Math.abs(Number(e.total_amount)),
          color: 'text-zinc-100',
          hasReceipt: photoEvidence.length > 0,
        };
      });
      setActivity(rows);

      const spendByGroup = new Map<string, number>();
      expenseList.forEach((e) => {
        const gid = String(e.group_id ?? '');
        if (!gid) return;
        spendByGroup.set(gid, (spendByGroup.get(gid) ?? 0) + Number(e.total_amount ?? 0));
      });

      const flRows = (fl as Record<string, unknown>[]) ?? [];
      let lines: FreeloaderLine[] = [];

      if (flRows.length > 0) {
        lines = flRows.slice(0, 8).map((r) => {
          const name = String(r.display_name ?? r.name ?? 'Member');
          const owes = pickViewFreeloaderOwes(r);
          const delay = r.delay_days != null ? Number(r.delay_days) : null;
          return {
            name,
            owes,
            subtitle: delay != null && !Number.isNaN(delay) ? `${delay}d delay` : undefined,
          };
        });
      } else {
        const byUser = new Map<string, { name: string; owes: number }>();
        (allGroupBalances as BalanceRow[]).forEach((b) => {
          const gid = String(b.group_id ?? '');
          const totalSpend = spendByGroup.get(gid) ?? 0;
          const nb = Number(b.net_balance);
          if (totalSpend <= 0) return;
          if (nb >= -totalSpend * 0.15) return;
          const uid = String(b.user_id ?? '');
          if (!uid) return;
          const name = String(b.display_name ?? 'Member');
          const owes = Math.abs(nb);
          const cur = byUser.get(uid);
          if (!cur || owes > cur.owes) byUser.set(uid, { name, owes });
        });
        lines = [...byUser.values()].sort((a, b) => b.owes - a.owes).slice(0, 8);
      }

      setFreeloaderLines(lines);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const insights = useMemo((): InsightRow[] => {
    const out: InsightRow[] = [];
    const total = allExpenses.reduce((s, e) => s + Number(e.total_amount), 0);

    const catTotals = new Map<string, number>();
    allExpenses.forEach((e) => {
      const cat = (e.category as { name?: string | null } | null)?.name ?? 'Other';
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + Number(e.total_amount));
    });
    const sortedCats = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
    const top = sortedCats[0];
    if (top && total > 0) {
      const pct = Math.round((top[1] / total) * 100);
      out.push({
        icon: '📊',
        text: `Spending is Rs ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} total; largest share is ${top[0]} at ${pct}% (Rs ${top[1].toLocaleString(undefined, { maximumFractionDigits: 0 })}).`,
        color: 'text-zinc-300',
      });
    } else if (total === 0) {
      out.push({ icon: '📭', text: 'No expenses recorded yet across your groups.', color: 'text-zinc-400' });
    }

    out.push({
      icon: owing > 0 ? '⏳' : '✅',
      text:
        owing > 0
          ? `You owe about Rs ${owing.toLocaleString(undefined, { maximumFractionDigits: 0 })} across groups — settle when you can.`
          : `You have no aggregate amount owed across your groups in the balance view.`,
      color: owing > 0 ? 'text-red-400' : 'text-emerald-400',
    });

    if (owed > 0) {
      out.push({
        icon: '💰',
        text: `Others currently owe you about Rs ${owed.toLocaleString(undefined, { maximumFractionDigits: 0 })} in aggregate across groups.`,
        color: 'text-emerald-400',
      });
    }

    const flCount = freeloaderLines.length;
    if (flCount > 0) {
      const sample = freeloaderLines.slice(0, 2).map((l) => l.name).join(', ');
      out.push({
        icon: '🚨',
        text: `${flCount} member${flCount === 1 ? '' : 's'} stand out on contribution (${sample}${flCount > 2 ? '…' : ''}).`,
        color: 'text-amber-400',
      });
    }

    const net = owed - owing;
    out.push({
      icon: '⚖️',
      text: `Net position: Rs ${net.toLocaleString(undefined, { maximumFractionDigits: 0 })} (owed Rs ${owed.toLocaleString(undefined, { maximumFractionDigits: 0 })} − you owe Rs ${owing.toLocaleString(undefined, { maximumFractionDigits: 0 })}).`,
      color: net >= 0 ? 'text-emerald-400' : 'text-red-400',
    });

    return out.slice(0, 4);
  }, [owed, owing, allExpenses, freeloaderLines]);

  const delta = owed - owing;
  const emptyWeekBaseline = useMemo(() => buildLast7DaysChart([]), []);
  const data = chartData.length ? chartData : emptyWeekBaseline;
  const sevenDayTotal = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  if (loading) return <div className="flex items-center justify-center min-h-[40vh] text-zinc-500">Loading...</div>;
  if (error) return <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-3xl p-6">{error}</div>;

  return (
    <div className="space-y-10 smooth-enter">
      <ExpenseModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={load} />

      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-black text-white mb-2 leading-none">Intelligence</h2>
          <p className="text-zinc-500 flex items-center gap-2">
            <Zap className="w-4 h-4 text-brand-orange" />
            Performance insights across your groups
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-orange hover:bg-brand-orange/90 text-white px-6 py-4 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-brand-orange/20 active:scale-95"
        >
          <Plus className="w-5 h-5" /> Add Expense
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <SummaryCard title="You're Owed" amount={owed} trend="Across groups" isPositive={true} icon={Wallet} />
        <SummaryCard title="You Owe" amount={owing} trend="Across groups" isPositive={owing === 0} icon={Receipt} />
        <SummaryCard title="Net Position" amount={delta} trend="Owed − owing" isPositive={delta >= 0} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="interactive-card glass-panel col-span-2 bg-surface-dim tonal-border rounded-3xl p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
              <h4 className="text-xl font-bold text-white mb-1">Spending Intelligence</h4>
              <p className="text-xs text-zinc-500 max-w-xl leading-relaxed">
                Each bar is the <span className="text-zinc-400 font-bold">sum of all expense totals</span> in groups you belong to,
                for that calendar day (everyone in those groups combined — not split by who paid).
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">7-day total</p>
              <p className="text-lg font-black text-brand-orange tabular-nums">
                Rs {sevenDayTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
          <div className="h-[300px] w-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 28, right: 12, left: 4, bottom: 8 }}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#71717a', fontSize: 11, fontWeight: 600 }} dy={10} />
                <YAxis
                  width={44}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#71717a', fontSize: 10, fontWeight: 600 }}
                  tickFormatter={(v) => `Rs ${formatCompactRs(Number(v))}`}
                />
                <Tooltip content={<SpendingTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="value" radius={[6, 6, 6, 6]} barSize={40} isAnimationActive={false}>
                  <LabelList
                    dataKey="value"
                    position="top"
                    fill="#a1a1aa"
                    fontSize={10}
                    fontWeight={700}
                    formatter={(v: number | string) => {
                      const n = Number(v) || 0;
                      if (n <= 0) return '';
                      return `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                    }}
                  />
                  {data.map((entry, index) => (
                    <Cell key={`cell-${entry.dateKey}-${index}`} fill={index === data.length - 1 ? '#ff6a00' : 'rgba(255,255,255,0.08)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="interactive-card glow-on-hover bg-brand-orange rounded-3xl p-8 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-3xl rounded-full -mr-32 -mt-32" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
              <Zap className="w-6 h-6 fill-white" />
            </div>
            <h4 className="text-2xl font-black mb-4 leading-tight">Freeloader watch</h4>
            <div className="space-y-4 text-orange-100/80 text-sm font-medium leading-relaxed">
              {freeloaderLines.length === 0 ? (
                <p className="flex gap-2"><span className="shrink-0 w-1.5 h-1.5 rounded-full bg-white mt-1.5" />No freeloader flags right now.</p>
              ) : (
                freeloaderLines.map((f, i) => (
                  <p key={`${f.name}-${i}`} className="flex gap-2">
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-white mt-1.5" />
                    <span>
                      {f.name}
                      {f.owes > 0 ? ` — owes Rs ${f.owes.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ''}
                      {f.subtitle ? ` (${f.subtitle})` : ''}
                    </span>
                  </p>
                ))
              )}
            </div>
          </div>
          <Link to="/settlement" className="bg-white text-brand-orange py-4 rounded-2xl font-black text-sm uppercase tracking-wider hover:bg-orange-50 transition-colors relative z-10 text-center">
            Open settlement
          </Link>
        </div>
      </div>

      <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-3xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-zinc-800 flex items-center justify-center">
            <Brain className="w-5 h-5 text-brand-orange" />
          </div>
          <div>
            <h4 className="text-xl font-bold text-white">AI Insights</h4>
            <p className="text-xs text-zinc-500">Computed live from your balances and expenses</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {insights.map((insight, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-start gap-3 bg-zinc-900/60 rounded-2xl p-4 border border-border-tonal"
            >
              <span className="text-xl shrink-0">{insight.icon}</span>
              <p className={cn('text-sm font-medium leading-snug', insight.color)}>{insight.text}</p>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="interactive-card glass-panel bg-surface-dim tonal-border rounded-3xl overflow-hidden">
        <div className="p-8 border-b border-border-tonal flex justify-between items-center">
          <h4 className="text-xl font-bold text-white">Critical Activity</h4>
          <Link to="/history" className="text-xs font-bold text-zinc-500 hover:text-brand-orange transition-colors">
            View All History
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-tonal">
                <th className="px-8 py-5 text-xs text-zinc-500 uppercase tracking-widest font-bold">Entity</th>
                <th className="px-8 py-5 text-xs text-zinc-500 uppercase tracking-widest font-bold">Group</th>
                <th className="px-8 py-5 text-xs text-zinc-500 uppercase tracking-widest font-bold">Status</th>
                <th className="px-8 py-5 text-xs text-zinc-500 uppercase tracking-widest font-bold">Date</th>
                <th className="px-8 py-5 text-xs text-zinc-500 uppercase tracking-widest font-bold text-right">Magnitude</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-tonal">
              {activity.length === 0 ? (
                <tr><td colSpan={5} className="px-8 py-10 text-zinc-500 text-sm text-center">No recent activity.</td></tr>
              ) : activity.map((row, i) => (
                <tr key={i} className="hover:bg-zinc-800/20 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 group-hover:bg-brand-orange group-hover:text-white transition-all">
                        {row.title[0] ?? '?'}
                      </div>
                      <div>
                        <span className="font-bold text-white">{row.title}</span>
                        {row.hasReceipt && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded-md">
                            📎 receipt
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-sm text-zinc-400 font-medium">{row.cat}</td>
                  <td className="px-8 py-6">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider',
                      row.status === 'Verified' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                    )}>
                      {row.status === 'Verified' ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {row.status}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-sm text-zinc-500">{row.date}</td>
                  <td className={cn('px-8 py-6 text-right font-bold tabular-nums', row.color)}>
                    Rs {row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
