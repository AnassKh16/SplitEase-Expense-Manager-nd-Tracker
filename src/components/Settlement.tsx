import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ShieldCheck, Smartphone, CreditCard, Banknote, X, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getGroupBalances, getUserGroups, normalizeUserGroups, recordSettlement } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';

type BalanceRow = { user_id: string; display_name: string | null; net_balance: number | string | null };
type Transfer = {
  payer_id: string; receiver_id: string;
  payer_name: string; receiver_name: string;
  amount: number;
};

function computeTransfers(balances: BalanceRow[]): Transfer[] {
  const debtors = balances
    .map((b) => ({ user_id: b.user_id, display_name: b.display_name ?? 'Member', remaining: -Number(b.net_balance) }))
    .filter((b) => b.remaining > 0.01);
  const creditors = balances
    .map((b) => ({ user_id: b.user_id, display_name: b.display_name ?? 'Member', remaining: Number(b.net_balance) }))
    .filter((b) => b.remaining > 0.01);

  const out: Transfer[] = [];
  let i = 0; let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].remaining, creditors[j].remaining);
    if (pay > 0.005) {
      out.push({
        payer_id: debtors[i].user_id,
        receiver_id: creditors[j].user_id,
        payer_name: debtors[i].display_name,
        receiver_name: creditors[j].display_name,
        amount: Math.round(pay * 100) / 100,
      });
    }
    debtors[i].remaining -= pay;
    creditors[j].remaining -= pay;
    if (debtors[i].remaining < 0.01) i++;
    if (creditors[j].remaining < 0.01) j++;
  }
  return out;
}

const DigitalModal = ({
  transfer, onConfirm, onCancel, busy,
}: {
  transfer: Transfer;
  onConfirm: (platform: string, ref: string) => void;
  onCancel: () => void;
  busy: boolean;
}) => {
  const [platform, setPlatform] = useState('EasyPaisa');
  const [ref, setRef] = useState('');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-sm bg-zinc-900 border border-border-tonal rounded-[28px] p-8 space-y-6 shadow-2xl"
      >
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xl font-black text-white">Digital Payment</h3>
            <p className="text-xs text-zinc-500 mt-1">{transfer.payer_name} → {transfer.receiver_name}</p>
          </div>
          <button type="button" onClick={onCancel} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-3xl font-black text-brand-orange">
          Rs {transfer.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </p>
        <div className="space-y-2">
          <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Platform</label>
          <div className="grid grid-cols-3 gap-2">
            {['EasyPaisa', 'JazzCash', 'Bank'].map((p) => (
              <button key={p} type="button" onClick={() => setPlatform(p)}
                className={cn('py-2 rounded-xl border text-xs font-bold transition-all',
                  platform === p
                    ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange'
                    : 'bg-zinc-800 border-border-tonal text-zinc-400 hover:text-zinc-200')}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Transaction Reference (optional)</label>
          <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. TXN123456"
            className="w-full bg-zinc-800 border border-border-tonal rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-orange/50" />
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 bg-zinc-800 text-zinc-300 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-zinc-700 transition-all">Cancel</button>
          <button type="button" disabled={busy} onClick={() => onConfirm(platform, ref)}
            className="flex-[2] bg-brand-orange text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand-orange/90 transition-all disabled:opacity-50">
            {busy ? 'Recording…' : 'Confirm Payment'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const SettlementRow = ({
  t, isCurrentUserPayer, onExecute, busy, feedback,
}: {
  t: Transfer;
  isCurrentUserPayer: boolean;
  onExecute: (type: 'cash' | 'digital') => void;
  busy: boolean;
  feedback: string | null;
}) => (
  <div className="space-y-2 smooth-enter">
    <div className={cn(
      'interactive-card glass-panel bg-surface-dim tonal-border rounded-[32px] p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 transition-all',
      isCurrentUserPayer ? 'group hover:border-brand-orange/40' : 'opacity-75'
    )}>
      <div className="flex items-center gap-6 flex-1 min-w-0">
        <div className="text-center shrink-0">
          <Avatar displayName={t.payer_name} size={12} className={cn('mx-auto mb-2 border-2', isCurrentUserPayer ? 'border-brand-orange/40' : 'border-zinc-800')} />
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest truncate max-w-[120px]">{t.payer_name}</p>
          {isCurrentUserPayer && (
            <span className="text-[9px] font-black text-brand-orange uppercase tracking-widest">You</span>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <p className="text-2xl font-black text-white tracking-tighter">
            Rs {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className="w-full flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-800 to-zinc-800" />
            <ArrowRight className={cn('w-5 h-5 shrink-0 transition-colors', isCurrentUserPayer ? 'text-zinc-700 group-hover:text-brand-orange' : 'text-zinc-800')} />
            <div className="h-px flex-1 bg-gradient-to-l from-transparent via-zinc-800 to-zinc-800" />
          </div>
          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Settlement</p>
        </div>

        <div className="text-center shrink-0">
          <Avatar displayName={t.receiver_name} size={12} className="mx-auto mb-2 border-2 border-zinc-800" />
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest truncate max-w-[120px]">{t.receiver_name}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 lg:ml-6 lg:shrink-0">
        {isCurrentUserPayer ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onExecute('cash')}
              className="bg-white text-bg-void px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Banknote className="w-4 h-4" /> Cash
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onExecute('digital')}
              className="bg-brand-orange text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand-orange/90 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Smartphone className="w-4 h-4" /> Digital
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 px-5 py-3 rounded-xl bg-zinc-900/60 border border-border-tonal text-zinc-600">
            <Lock className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest">
              {t.payer_name}'s payment
            </span>
          </div>
        )}
      </div>
    </div>

    {feedback && (
      <p className="text-sm text-emerald-400 px-2 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4" /> {feedback}
      </p>
    )}
  </div>
);

export const Settlement = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupOptions, setGroupOptions] = useState<{ group_id: string; name: string }[]>([]);
  const [groupId, setGroupId] = useState('');
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [digitalTarget, setDigitalTarget] = useState<Transfer | null>(null);

  const selectedGroupId = searchParams.get('group') || groupId;

  const loadGroups = useCallback(async () => {
    if (!user?.id) return;
    const ug = await getUserGroups(user.id);
    const mapped = normalizeUserGroups(ug);
    setGroupOptions(mapped);
    const fromUrl = new URLSearchParams(window.location.search).get('group');
    const initial = (fromUrl && mapped.some((g) => g.group_id === fromUrl) && fromUrl) || mapped[0]?.group_id || '';
    setGroupId(initial);
    if (initial && !fromUrl) setSearchParams({ group: initial }, { replace: true });
  }, [user?.id, setSearchParams]);

  const loadBalances = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const gid = searchParams.get('group') || groupId;
    if (!gid) { setBalances([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const b = await getGroupBalances(gid);
      setBalances((b as BalanceRow[]) ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load balances');
    } finally {
      setLoading(false);
    }
  }, [user?.id, groupId, searchParams]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => { void loadBalances(); }, [loadBalances]);

  const transfers = useMemo(() => computeTransfers(balances), [balances]);

  const handleExecute = async (
    t: Transfer,
    type: 'cash' | 'digital',
    platform?: string,
    ref?: string,
  ) => {
    if (t.payer_id !== user?.id) {
      setError("You can only settle your own debts.");
      return;
    }

    const key = `${t.payer_id}-${t.receiver_id}-${t.amount}`;
    setBusyKey(key); setError(null);
    try {
      await recordSettlement(t.payer_id, t.receiver_id, t.amount, type, platform, ref);
      setMessages((m) => ({
        ...m,
        [key]: `✅ Rs ${t.amount.toFixed(2)} recorded as ${type}${platform ? ` via ${platform}` : ''}`,
      }));
      await loadBalances();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Settlement failed');
    } finally {
      setBusyKey(null);
      setDigitalTarget(null);
    }
  };

  if (loading && !groupOptions.length) return (
    <div className="flex items-center justify-center min-h-[40vh] text-zinc-500">Loading...</div>
  );

  return (
    <div className="space-y-10 smooth-enter">
      <AnimatePresence>
        {digitalTarget && (
          <DigitalModal
            transfer={digitalTarget}
            busy={busyKey !== null}
            onCancel={() => setDigitalTarget(null)}
            onConfirm={(platform, ref) => void handleExecute(digitalTarget, 'digital', platform, ref)}
          />
        )}
      </AnimatePresence>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl px-4 py-3 text-sm">{error}</div>
      )}

      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-6">
        <div>
          <h2 className="text-5xl font-black text-white leading-none tracking-tighter">Settlement Protocol</h2>
          <p className="text-zinc-500 mt-2 uppercase text-[10px] font-black tracking-[0.2em]">Minimum transfers to clear all debts</p>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <label className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Group</label>
          <select
            value={selectedGroupId}
            onChange={(e) => {
              const v = e.target.value;
              setGroupId(v);
              setSearchParams(v ? { group: v } : {});
              setMessages({});
            }}
            className="bg-surface-dim border border-border-tonal rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-orange/50 min-w-[200px]"
          >
            {groupOptions.length === 0 ? <option value="">No groups</option> : null}
            {groupOptions.map((g) => <option key={g.group_id} value={g.group_id}>{g.name}</option>)}
          </select>
          <div className="bg-zinc-900 border border-border-tonal rounded-2xl p-4 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <div className="text-left">
              <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest leading-none mb-1">Verify Mode</p>
              <p className="text-xs font-bold text-white leading-none">Review before paying</p>
            </div>
          </div>
        </div>
      </div>

      <div className="interactive-card glow-on-hover bg-brand-orange/5 border border-brand-orange/20 rounded-[32px] p-8 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-[24px] bg-brand-orange flex items-center justify-center shadow-lg shadow-brand-orange/20">
            <CheckCircle2 className="w-8 h-8 text-white" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-white tracking-tight">Financial Equilibrium</h3>
            <p className="text-zinc-400 text-sm mt-1">
              {transfers.length === 0
                ? 'All balances are settled — no transfers needed!'
                : `${transfers.length} transfer${transfers.length === 1 ? '' : 's'} needed to clear all debts`}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Total to settle</p>
          <p className="text-3xl font-black text-brand-orange">
            Rs {transfers.reduce((s, t) => s + t.amount, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-xs font-black text-zinc-600 uppercase tracking-[0.3em] ml-2">Recommended Transfers</h4>
        {loading ? (
          <p className="text-zinc-500">Loading balances…</p>
        ) : transfers.length === 0 ? (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-emerald-400 font-bold">All settled up! No transfers needed.</p>
          </div>
        ) : (
          transfers.map((t) => {
            const key = `${t.payer_id}-${t.receiver_id}-${t.amount}`;
            const isCurrentUserPayer = t.payer_id === user?.id;
            return (
              <SettlementRow
                key={key}
                t={t}
                isCurrentUserPayer={isCurrentUserPayer}
                busy={busyKey === key}
                feedback={messages[key] ?? null}
                onExecute={(type) => {
                  if (type === 'digital') { setDigitalTarget(t); }
                  else void handleExecute(t, 'cash');
                }}
              />
            );
          })
        )}
      </div>

      {transfers.some((t) => t.payer_id !== user?.id) && (
        <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900/40 border border-border-tonal rounded-2xl text-xs text-zinc-500 font-medium">
          <Lock className="w-4 h-4 shrink-0 text-zinc-600" />
          Transfers showing a lock are other members' debts — only they can settle those.
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 pt-4">
        {[
          { icon: Smartphone, title: 'EasyPaisa / JazzCash', desc: 'Record as digital with ref + platform.' },
          { icon: CreditCard, title: 'Bank Transfer', desc: 'Use digital settlement and paste your bank ref.' },
          { icon: CheckCircle2, title: 'Cash', desc: 'Hand-to-hand in hostel. Record as cash.' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="interactive-card glass-panel bg-surface-dim tonal-border rounded-3xl p-8 space-y-4 text-center group hover:bg-zinc-800/30 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 mx-auto flex items-center justify-center group-hover:scale-110 transition-transform">
              <Icon className="w-6 h-6 text-zinc-400" />
            </div>
            <h5 className="font-bold text-white">{title}</h5>
            <p className="text-xs text-zinc-500">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
