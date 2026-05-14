import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, X, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  createGroup, getGroupExpenseTotals, getGroupExpenseCount,
  getGroupMembers, getUserGroups, joinGroup, normalizeUserGroups,
} from '../lib/supabase';
import { getValidatedStoredGroupImage } from '../lib/groupImages';
import {
  getLastActiveGroupId,
  lastActiveGroupStorageKey,
  LAST_ACTIVE_GROUP_EVENT,
  recordLastActiveGroup,
} from '../lib/lastActiveGroup';
import { useAuth } from '../context/AuthContext';

const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&h=800&fit=crop&q=80',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop&q=80',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&h=800&fit=crop&q=80',
];

function hashPick<T>(key: string, arr: T[]): T {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length]!;
}

function GroupCardImage({ groupId, primary, fallback }: { groupId: string; primary: string; fallback: string }) {
  const [src, setSrc] = useState(primary);
  useEffect(() => {
    setSrc(primary);
  }, [primary, groupId]);
  return (
    <img
      src={src}
      alt=""
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 bg-zinc-900"
      loading="lazy"
      decoding="async"
      onError={() => setSrc(fallback)}
    />
  );
}

type GroupRow = {
  group_id: string; name: string;
  members: number; total: number;
  logs: number; img?: string;
};

// ── Toast component ───────────────────────────────────────────────────────────
const Toast = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => (
  <motion.div
    initial={{ opacity: 0, y: 40 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 40 }}
    className="fixed bottom-8 right-8 z-[200] bg-zinc-900 border border-emerald-500/30 rounded-2xl px-5 py-4 flex items-center gap-3 shadow-2xl"
  >
    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
    <p className="text-sm font-bold text-white">{message}</p>
    <button type="button" onClick={onDismiss} className="text-zinc-500 hover:text-white transition-colors ml-2">
      <X className="w-4 h-4" />
    </button>
  </motion.div>
);

// ── Create Group Modal ────────────────────────────────────────────────────────
const CreateModal = ({
  open, onClose, onCreate,
}: { open: boolean; onClose: () => void; onCreate: (name: string) => Promise<void> }) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setErr('Enter a group name'); return; }
    setBusy(true); setErr('');
    try { await onCreate(name.trim()); setName(''); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-dim tonal-border rounded-3xl p-8 max-w-md w-full space-y-4 shadow-2xl"
      >
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-black text-white">New Group</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {err && <p className="text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">{err}</p>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
          placeholder="e.g. Block C Hostel, Roommates 2025..."
          autoFocus
          className="w-full bg-zinc-900 border border-border-tonal rounded-2xl py-3 px-4 text-white focus:outline-none focus:ring-1 focus:ring-brand-orange/50"
        />
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-zinc-400 font-bold hover:text-white transition-colors">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSubmit()}
            className="bg-brand-orange text-white px-6 py-2 rounded-xl font-black disabled:opacity-50 hover:bg-brand-orange/90 transition-all"
          >
            {busy ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export const GroupsList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<GroupRow[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [lastActiveGroupId, setLastActiveGroupId] = useState<string | null>(() =>
    getLastActiveGroupId(user?.id)
  );

  useEffect(() => {
    setLastActiveGroupId(getLastActiveGroupId(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const sync = () => setLastActiveGroupId(getLastActiveGroupId(user.id));
    const onCustom = (e: Event) => {
      const d = (e as CustomEvent<{ userId?: string }>).detail;
      if (d?.userId === user.id) sync();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === lastActiveGroupStorageKey(user.id)) sync();
    };
    window.addEventListener(LAST_ACTIVE_GROUP_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(LAST_ACTIVE_GROUP_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', sync);
    };
  }, [user?.id]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true); setError(null);
    try {
      const ug = await getUserGroups(user.id);
      const mapped = normalizeUserGroups(ug);

      // FIX: Fire ALL sub-queries for ALL groups at the same time in ONE
      // Promise.all, instead of sequentially awaiting each group's 3 queries.
      // Old: mapped.map(async g => { await q1; await q2; await q3 })  ← sequential per group
      // New: one flat Promise.all over (N groups × 3 queries) = single batch round-trip
      const allGroupIds = mapped.map((g) => g.group_id);

      const [membersResults, totalsResults, countsResults] = await Promise.all([
        Promise.all(allGroupIds.map((id) => getGroupMembers(id))),
        Promise.all(allGroupIds.map((id) => getGroupExpenseTotals(id))),
        Promise.all(allGroupIds.map((id) => getGroupExpenseCount(id))),
      ]);

      const enriched: GroupRow[] = mapped.map((g, idx) => {
        const fb = hashPick(g.group_id, FALLBACK_IMAGES);
        const stored = getValidatedStoredGroupImage(g.group_id);
        return {
          group_id: g.group_id,
          name: g.name,
          members: Array.isArray(membersResults[idx]) ? (membersResults[idx] as unknown[]).length : 0,
          total: totalsResults[idx] as number,
          logs: countsResults[idx] as number,
          img: stored ?? fb,
        };
      });

      setRows(enriched);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (name: string) => {
    if (!user?.id) return;
    const group = await createGroup(name, user.id);
    recordLastActiveGroup(user.id, String((group as { group_id: string }).group_id));
    setModalOpen(false);
    await load();
    showToast(`✅ Group "${name}" created!`);
  };

  const handleJoin = async () => {
    if (!user?.id || !inviteCode.trim()) { setJoinError('Enter an invite code'); return; }
    setJoinBusy(true); setJoinError('');
    try {
      const group = await joinGroup(inviteCode.trim(), user.id);
      recordLastActiveGroup(user.id, String((group as { group_id: string }).group_id));
      setInviteCode('');
      await load();
      showToast('✅ Joined group successfully!');
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : 'Invalid invite code');
    } finally {
      setJoinBusy(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[40vh] text-zinc-500">Loading...</div>;

  return (
    <div className="space-y-10">
      <AnimatePresence>
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </AnimatePresence>

      <CreateModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={handleCreate} />

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-6">
        <div>
          <h2 className="text-5xl font-black text-white leading-none tracking-tighter">Directorates</h2>
          <p className="text-zinc-500 mt-2 uppercase text-[10px] font-black tracking-[0.2em]">
            {rows.length} active group{rows.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {/* Join group */}
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => { setInviteCode(e.target.value); setJoinError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
                placeholder="Invite code"
                className="bg-surface-dim border border-border-tonal rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-orange/50 min-w-[160px]"
              />
              <button
                type="button"
                disabled={joinBusy}
                onClick={() => void handleJoin()}
                className="bg-zinc-800 text-white px-6 py-3 rounded-2xl font-black text-sm hover:bg-zinc-700 disabled:opacity-50 transition-all"
              >
                {joinBusy ? '…' : 'Join'}
              </button>
            </div>
            {joinError && <p className="text-red-400 text-xs font-bold px-1">{joinError}</p>}
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="bg-white text-bg-void px-6 py-4 rounded-2xl font-black transition-all hover:bg-zinc-200 active:scale-95 shadow-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Group
          </button>
        </div>
      </div>

      {/* Group cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {rows.map((g) => (
          <motion.div
            key={g.group_id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate(`/groups/${g.group_id}`)}
            className="interactive-card smooth-enter cursor-pointer bg-surface-dim tonal-border rounded-[32px] p-8 space-y-7 group hover:border-brand-orange/40"
          >
            <div className="h-48 rounded-2xl overflow-hidden mb-8 relative bg-zinc-900">
              <GroupCardImage
                groupId={g.group_id}
                primary={g.img ?? FALLBACK_IMAGES[0]}
                fallback={FALLBACK_IMAGES[0]}
              />
              <div
                className={cn(
                  'absolute top-4 right-4 px-3 py-1 text-[10px] font-black uppercase rounded-full shadow-lg border',
                  g.group_id === lastActiveGroupId
                    ? 'bg-brand-orange text-white border-brand-orange/40'
                    : 'bg-zinc-900/85 text-zinc-500 border-zinc-700/80'
                )}
              >
                Active
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            </div>

            <div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-2xl font-black text-white tracking-tight">{g.name}</h3>
                <span className="text-brand-orange font-bold text-sm">
                  Rs {g.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex items-center gap-4 text-zinc-500 text-xs font-bold uppercase tracking-widest">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> {g.members} Members
                </span>
                <span className="w-1 h-1 bg-zinc-700 rounded-full" />
                <span>{g.logs} Logs</span>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Create new card */}
        <div
          onClick={() => setModalOpen(true)}
          className="interactive-card smooth-enter bg-zinc-900/20 tonal-border border-dashed border-zinc-800 rounded-[32px] p-8 flex flex-col items-center justify-center text-center space-y-4 group cursor-pointer hover:bg-zinc-800/30 min-h-[350px]"
        >
          <div className="w-16 h-16 rounded-full border-2 border-dashed border-zinc-700 flex items-center justify-center group-hover:border-brand-orange transition-colors">
            <Plus className="w-6 h-6 text-zinc-700 group-hover:text-brand-orange transition-colors" />
          </div>
          <div>
            <p className="text-zinc-200 font-bold text-lg">New Operation</p>
            <p className="text-zinc-600 text-sm">Deploy a new group instance</p>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="text-center py-20 space-y-4">
          <div className="w-20 h-20 rounded-full bg-zinc-900 border border-border-tonal flex items-center justify-center mx-auto">
            <Users className="w-8 h-8 text-zinc-600" />
          </div>
          <h3 className="text-2xl font-black text-white">No groups yet</h3>
          <p className="text-zinc-500 text-sm max-w-sm mx-auto">Create a new group or join one with an invite code to start tracking shared expenses.</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="bg-brand-orange text-white px-8 py-4 rounded-2xl font-black hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
          >
            Create Your First Group
          </button>
        </div>
      )}
    </div>
  );
};