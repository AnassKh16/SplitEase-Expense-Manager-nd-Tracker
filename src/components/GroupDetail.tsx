import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, MapPin, Calendar, Share2, Filter, Search,
  MoreVertical, MinusCircle, TrendingUp, Receipt,
  Bell, LogOut, Paperclip, ChevronDown, ImagePlus, RotateCcw, X, ArrowLeft,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { ExpenseModal } from './ExpenseModal';
import {
  getGroupBalances, getGroupById, getGroupExpenseTotals,
  getGroupExpenses, getGroupMembers, normalizeGroupMembers,
  supabase, sendNudge, sendNudgesToUserIds,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { BalanceRow, MemberRow } from '../types';
import { Avatar } from './Avatar';
import { clearStoredGroupImage, getValidatedStoredGroupImage, setStoredGroupImage } from '../lib/groupImages';
import { recordLastActiveGroup } from '../lib/lastActiveGroup';
import {
  PROFILE_BC_NAME,
  PROFILE_REFRESH_EVENT,
  requestNotificationsRefresh,
} from '../lib/notificationsBridge';

function getFreelStatus(
  netBalance: number,
  totalGroupSpend: number
): { label: string; badge: string; barColor: string; key: 'fair' | 'low' | 'freeloader' } {
  if (totalGroupSpend === 0 || netBalance >= 0) {
    return { label: '🟢 Fair', badge: 'Fair', barColor: 'bg-emerald-500', key: 'fair' };
  }
  const ratio = Math.abs(netBalance) / (totalGroupSpend || 1);
  if (ratio < 0.2) return { label: '🟡 Low', badge: 'Low', barColor: 'bg-amber-400', key: 'low' };
  return { label: '🔴 Freeloader', badge: 'Freeloader', barColor: 'bg-red-500', key: 'freeloader' };
}

const MemberCard = ({
  name, role, netDisplay, statusBadge, riskKey, barWidth, barColor,
  profilePicture, memberUserId, currentUserId, isCurrentUserManager,
  canNudge,
  menuOpen, onToggleMenu, onCloseMenu, onNudge, onRemove, nudgeBusy, removeBusy,
}: {
  name: string;
  role: string;
  netDisplay: number;
  statusBadge: string;
  riskKey: 'fair' | 'low' | 'freeloader';
  barWidth: number;
  barColor: string;
  profilePicture: string | null;
  memberUserId: string;
  currentUserId: string;
  isCurrentUserManager: boolean;
  canNudge: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onNudge: () => void;
  onRemove: () => void;
  nudgeBusy: boolean;
  removeBusy: boolean;
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuOpen) { setMenuCoords(null); return; }
    const el = triggerRef.current;
    if (!el) return;
    const update = () => {
      const r   = el.getBoundingClientRect();
      const mw  = 192;
      const estH = 120;
      const margin = 8;
      let left = r.right + margin;
      if (left + mw > window.innerWidth - margin) left = Math.max(margin, r.left - mw - margin);
      let top = r.top;
      if (top + estH > window.innerHeight - margin) top = Math.max(margin, r.bottom - estH);
      if (top < margin) top = margin;
      setMenuCoords({ top, left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onCloseMenu();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, onCloseMenu]);

  /** Same rule as “nudge all”: only members with negative net balance owe the group. */
  const owesGroupNet = netDisplay < 0;

  const menuPanel =
    menuOpen &&
    menuCoords &&
    createPortal(
      <div
        ref={panelRef}
        className="fixed z-[10000] w-52 bg-zinc-900 border border-border-tonal rounded-xl shadow-2xl py-1"
        style={{ top: menuCoords.top, left: menuCoords.left }}
      >
        {/* Only show Nudge option if current user has nudge permission */}
        {canNudge && memberUserId !== currentUserId && owesGroupNet && (
          <button
            type="button"
            disabled={nudgeBusy}
            onClick={() => { onNudge(); onCloseMenu(); }}
            className="w-full text-left px-3 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-40"
          >
            {nudgeBusy ? 'Sending…' : 'Nudge member'}
          </button>
        )}
        {canNudge && memberUserId !== currentUserId && !owesGroupNet && (
          <div
            className="px-3 py-2.5 text-xs text-zinc-500 leading-snug cursor-default"
            title="Net balance is even or in their favour — nothing to collect."
          >
            Payment settled — no nudge
          </div>
        )}
        {/* Show message if no nudge permission */}
        {!canNudge && memberUserId !== currentUserId && (
          <div className="px-3 py-2.5 text-xs text-zinc-600 italic">
            Only manager or top creditor can nudge
          </div>
        )}
        {isCurrentUserManager && memberUserId !== currentUserId && (
          <button
            type="button"
            disabled={removeBusy}
            onClick={() => { onRemove(); }}
            className="w-full text-left px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            {removeBusy ? 'Removing…' : 'Remove from group'}
          </button>
        )}
      </div>,
      document.body
    );

  return (
    <>
      {menuPanel}
      <div className="bg-surface-dim tonal-border rounded-2xl p-5 sm:p-6 relative group">
        <div className="flex justify-between items-start gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar displayName={name} profilePicture={profilePicture} size={12} className="shrink-0" />
            <div className="min-w-0">
              <h4 className="font-bold text-white truncate">{name}</h4>
              <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mt-0.5">{role}</p>
            </div>
          </div>
          <div className="relative shrink-0" ref={triggerRef}>
            <button
              type="button"
              onClick={onToggleMenu}
              className="text-zinc-500 hover:text-white transition-colors p-2 rounded-xl border border-transparent hover:border-border-tonal hover:bg-zinc-800/80"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
              <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest shrink-0">Net balance</p>
              <div className={cn(
                'shrink-0 inline-flex items-center max-w-[min(100%,11rem)] px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider',
                riskKey === 'freeloader' ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                  : riskKey === 'low'     ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                  : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
              )}>
                <span className="truncate">{statusBadge}</span>
              </div>
            </div>
            <div className="min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch] scrollbar-none [&::-webkit-scrollbar]:hidden">
              <h3 className={cn(
                'inline-block text-lg sm:text-xl font-black tracking-tight tabular-nums whitespace-nowrap pr-1',
                netDisplay < 0 ? 'text-red-400' : netDisplay > 0 ? 'text-emerald-400' : 'text-zinc-300'
              )}>
                Rs {netDisplay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
            </div>
          </div>

          <div className="h-2 w-full bg-zinc-800/90 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-1000 ease-out', barColor)}
              style={{ width: `${Math.min(Math.max(barWidth, 4), 100)}%` }}
            />
          </div>

          <p className="text-xs text-zinc-500 font-medium leading-relaxed">
            {netDisplay > 0
              ? `Others owe Rs ${netDisplay.toLocaleString(undefined, { maximumFractionDigits: 0 })} to this member`
              : netDisplay < 0
              ? `Owes Rs ${Math.abs(netDisplay).toLocaleString(undefined, { maximumFractionDigits: 0 })} to others`
              : 'Fully settled'}
          </p>
        </div>
      </div>
    </>
  );
};

function formatExpenseDate(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const GroupDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen]   = useState(false);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [copied, setCopied]             = useState(false);
  const [nudgeSent, setNudgeSent]       = useState(false);
  const [search, setSearch]             = useState('');
  const [syncPulse, setSyncPulse]       = useState(false);

  const [groupName, setGroupName]   = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [members, setMembers]       = useState<MemberRow[]>([]);
  const [balances, setBalances]     = useState<BalanceRow[]>([]);
  const [expenses, setExpenses]     = useState<Record<string, unknown>[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [settledPct, setSettledPct] = useState(0);

  const [filterOpen, setFilterOpen]     = useState(false);
  const [roleFilter, setRoleFilter]     = useState<'all' | 'manager' | 'member'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'fair' | 'low' | 'freeloader'>('all');
  const filterRef = useRef<HTMLDivElement>(null);

  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);
  const [nudgeBusyId, setNudgeBusyId]       = useState<string | null>(null);
  const [removeBusyId, setRemoveBusyId]     = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef  = useRef<HTMLDivElement>(null);
  const imageInputRef  = useRef<HTMLInputElement>(null);
  const [groupBgImage, setGroupBgImage] = useState<string | null>(null);
  const [cropSource, setCropSource]     = useState<string | null>(null);
  const [cropOpen, setCropOpen]         = useState(false);
  const [cropZoom, setCropZoom]         = useState(1);
  const [cropX, setCropX]               = useState(0);
  const [cropY, setCropY]               = useState(0);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  useEffect(() => {
    if (!id) return;
    setGroupBgImage(getValidatedStoredGroupImage(id));
  }, [id]);

  useEffect(() => {
    if (!headerMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!headerMenuRef.current?.contains(e.target as Node)) setHeaderMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [headerMenuOpen]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [g, mem, bal, exp, tot] = await Promise.all([
        getGroupById(id),
        getGroupMembers(id),
        getGroupBalances(id),
        getGroupExpenses(id),
        getGroupExpenseTotals(id),
      ]);

      setGroupName((g as { name?: string })?.name ?? 'Group');
      setInviteCode((g as { invite_code?: string })?.invite_code ?? '');

      const cleaned = normalizeGroupMembers(mem);
      setMembers(cleaned as MemberRow[]);
      setBalances((bal as BalanceRow[]) ?? []);

      const exList = (exp as Record<string, unknown>[]) ?? [];
      setExpenses(exList);
      setTotalSpent(tot);

      let shareParts = 0; let settledParts = 0;
      exList.forEach((e) => {
        const shares = (e.expense_share as { is_settled: boolean }[] | undefined) ?? [];
        shares.forEach((s) => { shareParts++; if (s.is_settled) settledParts++; });
      });
      setSettledPct(shareParts ? Math.round((settledParts / shareParts) * 100) : 0);

      if (user?.id) recordLastActiveGroup(user.id, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load group');
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onProfile = () => void load();
    window.addEventListener(PROFILE_REFRESH_EVENT, onProfile);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(PROFILE_BC_NAME);
      bc.onmessage = () => void load();
    } catch { bc = null; }
    return () => {
      window.removeEventListener(PROFILE_REFRESH_EVENT, onProfile);
      bc?.close();
    };
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const reloadBalances = async () => {
      try {
        const bal = await getGroupBalances(id);
        setBalances((bal as BalanceRow[]) ?? []);
        setSyncPulse(true);
        setTimeout(() => setSyncPulse(false), 2000);
      } catch { /* silent */ }
    };

    const expenseShareSub = supabase
      .channel(`group-expense-share-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_share' }, () => { void reloadBalances(); })
      .subscribe();
    const settlementSub = supabase
      .channel(`group-settlement-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'settlement' }, () => { void reloadBalances(); })
      .subscribe();
    const expenseSub = supabase
      .channel(`group-expense-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'expense', filter: `group_id=eq.${id}` }, () => { void load(); })
      .subscribe();

    return () => {
      void supabase.removeChannel(expenseShareSub);
      void supabase.removeChannel(settlementSub);
      void supabase.removeChannel(expenseSub);
    };
  }, [id, load]);

  useEffect(() => {
    if (!id) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) return;
      debounce = setTimeout(() => { debounce = null; void load(); }, 500);
    };
    const sub = supabase
      .channel(`group-profiles-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, schedule)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(sub);
    };
  }, [id, load]);

  const handleCopyInvite = () => {
    if (inviteCode) {
      void navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeaveGroup = async () => {
    if (!user?.id || !id) return;
    if (!window.confirm('Leave this group?')) return;
    await supabase.from('user_group').delete().eq('user_id', user.id).eq('group_id', id);
    navigate('/groups');
  };

  // ── Computed permission values ─────────────────────────────────────────────
  // These depend on balances being loaded so we compute them here (not inside JSX)
  // to keep the logic readable and reusable below.

  const currentIsManager = !!members.find((m) => m.user_id === user?.id)?.is_manager;

  // Build balance map early so canNudge can use it
  const balanceByUser = new Map<string, number>();
  balances.forEach((b) => balanceByUser.set(b.user_id, Number(b.net_balance)));

  const currentUserNet  = balanceByUser.get(user?.id ?? '') ?? 0;
  const maxCreditorNet  = Math.max(0, ...Array.from(balanceByUser.values()));
  // Top creditor = has positive balance AND nobody else has a higher balance
  const isTopCreditor   = currentUserNet > 0 && currentUserNet === maxCreditorNet;
  // canNudge = manager OR the person owed the most money
  const canNudge        = currentIsManager || isTopCreditor;

  // ── Nudge all debtors ──────────────────────────────────────────────────────
  const handleNudgeAll = async () => {
    if (!user?.id || !id) return;

    // Permission gate
    if (!canNudge) {
      window.alert('Only the group manager or the member owed the most can send nudges.');
      return;
    }

    const debtors = members.filter((m) => {
      if (m.user_id === user.id) return false;
      const bal = balances.find((b) => b.user_id === m.user_id);
      return !!bal && Number(bal.net_balance) < 0;
    });

    if (debtors.length === 0) {
      window.alert('No debtors to nudge in this group right now.');
      return;
    }

    setNudgeSent(true);
    requestNotificationsRefresh();
    const bannerTimer = window.setTimeout(() => setNudgeSent(false), 3000);

    void sendNudgesToUserIds(debtors.map((m) => m.user_id), user.id)
      .then((result) => {
        if (result.ok === 0) {
          window.clearTimeout(bannerTimer);
          setNudgeSent(false);
          window.alert('Could not send nudges. Ask each member to open the app once (scorecard may be missing).');
          return;
        }
        requestNotificationsRefresh();
        if (result.fail > 0) {
          window.alert(`Sent ${result.ok} nudge(s). ${result.fail} could not be sent (missing scorecard).`);
        }
      })
      .catch(() => {
        window.clearTimeout(bannerTimer);
        setNudgeSent(false);
        window.alert('Could not send nudges. Check your connection.');
      });
  };

  // ── Nudge single member ───────────────────────────────────────────────────
  const handleNudgeMember = async (memberUserId: string) => {
    if (!user?.id) return;

    // Permission gate
    if (!canNudge) {
      window.alert('Only the group manager or the member owed the most can send nudges.');
      return;
    }

    const targetNet = balanceByUser.get(memberUserId);
    if (targetNet === undefined || targetNet >= 0) {
      window.alert('This member has settled — they do not owe a net balance in this group.');
      return;
    }

    setNudgeBusyId(memberUserId);
    try {
      const { data: sc, error: scErr } = await supabase
        .from('contribution_scorecard')
        .select('scorecard_id')
        .eq('user_id', memberUserId)
        .maybeSingle();
      if (scErr || !sc?.scorecard_id) throw new Error('No scorecard for member');
      await sendNudge(sc.scorecard_id as string, user.id);
      requestNotificationsRefresh();
      setNudgeSent(true);
      setTimeout(() => setNudgeSent(false), 3000);
    } catch {
      window.alert('Could not send nudge.');
    } finally {
      setNudgeBusyId(null);
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!id || !currentIsManager) return;
    if (!window.confirm('Remove this member from the group?')) return;
    setRemoveBusyId(memberUserId);
    try {
      const { error } = await supabase.from('user_group').delete().eq('user_id', memberUserId).eq('group_id', id);
      if (error) throw error;
      setOpenMenuUserId(null);
      await load();
    } catch {
      window.alert('Could not remove member.');
    } finally {
      setRemoveBusyId(null);
    }
  };

  const openCropperForFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : null;
      if (!src) return;
      setCropSource(src);
      setCropZoom(1); setCropX(0); setCropY(0);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handlePickGroupImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    openCropperForFile(file);
    e.target.value = '';
  };

  const handleSaveCroppedImage = () => {
    if (!cropSource || !id) return;
    const img = new Image();
    img.onload = () => {
      const work = document.createElement('canvas');
      work.width = 1600; work.height = 640;
      const wctx = work.getContext('2d');
      if (!wctx) return;
      const baseScale = Math.max(work.width / img.width, work.height / img.height);
      const scale = baseScale * cropZoom;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const x = (work.width - drawW) / 2 + cropX;
      const y = (work.height - drawH) / 2 + cropY;
      wctx.drawImage(img, x, y, drawW, drawH);
      const maxW = 1280;
      const out = document.createElement('canvas');
      const sd = Math.min(1, maxW / work.width);
      out.width = Math.max(1, Math.round(work.width * sd));
      out.height = Math.max(1, Math.round(work.height * sd));
      const octx = out.getContext('2d');
      if (!octx) return;
      octx.drawImage(work, 0, 0, out.width, out.height);
      const dataUrl = out.toDataURL('image/jpeg', 0.82);
      setStoredGroupImage(id, dataUrl);
      setGroupBgImage(dataUrl);
      setCropOpen(false);
      setCropSource(null);
    };
    img.src = cropSource;
  };

  if (!id) return null;
  if (loading) return <div className="flex items-center justify-center min-h-[40vh] text-zinc-500">Loading...</div>;
  if (error) return (
    <div className="space-y-4">
      <p className="text-red-400 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">{error}</p>
      <button type="button" onClick={() => navigate('/groups')} className="text-brand-orange font-bold">Back to groups</button>
    </div>
  );

  const n   = members.length || 1;
  const avg = totalSpent / n;

  const freeloaderCount = members.filter((m) => {
    const net = balanceByUser.get(m.user_id) ?? 0;
    return getFreelStatus(net, totalSpent).key === 'freeloader';
  }).length;

  const maxAbs = Math.max(1, ...members.map((m) => Math.abs(balanceByUser.get(m.user_id) ?? 0)));

  const filteredMembers = members.filter((m) => {
    const nameOk = (m.display_name ?? '').toLowerCase().includes(search.toLowerCase());
    if (!nameOk) return false;
    if (roleFilter === 'manager' && !m.is_manager) return false;
    if (roleFilter === 'member' &&  m.is_manager)  return false;
    const net = balanceByUser.get(m.user_id) ?? 0;
    const st  = getFreelStatus(net, totalSpent);
    if (statusFilter !== 'all' && st.key !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-10">
      <ExpenseModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} groupId={id} onSuccess={load} />
      <input ref={imageInputRef} type="file" accept="image/*" onChange={handlePickGroupImage} className="hidden" />

      <div className="flex justify-end">
        <button type="button" onClick={() => navigate('/groups')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-border-tonal text-zinc-200 hover:text-white hover:bg-zinc-800">
          <ArrowLeft className="w-4 h-4" /> Back to groups
        </button>
      </div>

      {/* Hero banner */}
      <div className="relative min-h-[16rem] rounded-[40px] tonal-border overflow-hidden">
        <div className="absolute inset-0 overflow-hidden rounded-[40px]">
          <img
            src={groupBgImage ?? 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?q=80&w=2070&auto=format&fit=crop'}
            alt="" className="w-full h-full min-h-[16rem] object-cover opacity-40 brightness-50"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg-void via-bg-void/40 to-transparent" />
        </div>
        <div className="relative z-10 flex flex-col gap-6 p-6 sm:p-8 lg:p-10 min-h-[16rem] justify-end">
          <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 min-w-0">
            <div className="space-y-4 min-w-0 flex-1">
              <div className="flex gap-2 flex-wrap">
                <span className="px-3 py-1 bg-brand-orange/20 border border-brand-orange/30 text-brand-orange rounded-full text-[10px] font-black uppercase tracking-widest">
                  Active Operations
                </span>
                <button type="button" onClick={handleCopyInvite}
                  className="px-3 py-1 bg-white/10 text-white rounded-full text-[10px] font-black uppercase tracking-widest backdrop-blur-md hover:bg-white/20 transition-all">
                  {copied ? '✅ Copied!' : `Invite: ${inviteCode || '—'}`}
                </button>
                <span className={cn(
                  'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-500',
                  syncPulse
                    ? 'bg-emerald-500/30 border border-emerald-500/50 text-emerald-400'
                    : 'bg-white/5 border border-white/10 text-zinc-600'
                )}>
                  {syncPulse ? '⚡ Balances updated' : '● Live sync'}
                </span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tighter leading-none break-words">
                {groupName}
              </h1>
              <div className="flex items-center gap-6 text-zinc-400 text-sm font-medium flex-wrap">
                <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-brand-orange shrink-0" /> Hostel group</span>
                <span className="flex items-center gap-2"><Calendar className="w-4 h-4 text-brand-orange shrink-0" /> Shared expenses</span>
                <span className="flex items-center gap-2"><Users className="w-4 h-4 text-brand-orange shrink-0" /> {members.length} Members</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-start xl:justify-end gap-2 sm:gap-3 shrink-0 xl:max-w-[min(100%,36rem)]">
              {/* ⋮ header menu */}
              <div className="relative" ref={headerMenuRef}>
                <button type="button" onClick={() => setHeaderMenuOpen((v) => !v)}
                  className="p-3 bg-zinc-900/95 border border-border-tonal rounded-2xl text-white hover:bg-zinc-800 transition-colors">
                  <MoreVertical className="w-5 h-5" />
                </button>
                {headerMenuOpen && (
                  <div className="absolute right-0 bottom-full mb-2 z-40 w-56 bg-zinc-900 border border-border-tonal rounded-xl shadow-2xl py-1">
                    <button type="button"
                      onClick={() => { setHeaderMenuOpen(false); imageInputRef.current?.click(); }}
                      className="w-full text-left px-3 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800 flex items-center gap-2">
                      <ImagePlus className="w-4 h-4" /> Edit group image
                    </button>
                    <button type="button"
                      onClick={() => { if (!id) return; clearStoredGroupImage(id); setGroupBgImage(null); setHeaderMenuOpen(false); }}
                      className="w-full text-left px-3 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" /> Reset image
                    </button>
                  </div>
                )}
              </div>

              <button type="button" onClick={handleCopyInvite}
                className="p-3 bg-zinc-900/95 border border-border-tonal rounded-2xl text-white hover:bg-zinc-800 transition-colors">
                <Share2 className="w-5 h-5" />
              </button>

              {/* Bell — only visible if canNudge */}
              {canNudge ? (
                <button type="button" onClick={() => void handleNudgeAll()}
                  title="Nudge all debtors"
                  className={cn('p-3 border rounded-2xl text-white transition-colors',
                    nudgeSent
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                      : 'bg-zinc-900/95 border-border-tonal hover:bg-zinc-800')}>
                  <Bell className="w-5 h-5" />
                </button>
              ) : (
                /* Greyed-out bell with tooltip for non-managers/non-creditors */
                <div
                  title="Only the manager or top creditor can send nudges"
                  className="p-3 bg-zinc-900/40 border border-border-tonal/30 rounded-2xl text-zinc-700 cursor-not-allowed"
                >
                  <Bell className="w-5 h-5" />
                </div>
              )}

              <button type="button" onClick={() => navigate(`/settlement?group=${id}`)}
                className="px-4 sm:px-6 py-3 bg-white text-bg-void rounded-2xl text-sm sm:text-base font-black hover:bg-zinc-200 transition-colors whitespace-nowrap">
                Settle Sessions
              </button>

              <button type="button" onClick={() => void handleLeaveGroup()}
                className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 hover:bg-red-500/20 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {nudgeSent && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-2xl px-4 py-3 text-sm">
          ✅ Nudge(s) sent successfully.
        </div>
      )}

      {/* Show who can nudge */}
      {canNudge && (
        <div className="bg-brand-orange/5 border border-brand-orange/20 rounded-2xl px-4 py-3 text-xs text-brand-orange font-bold flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 shrink-0" />
          {currentIsManager
            ? 'You are the group manager — you can nudge any member with dues.'
            : 'You are owed the most in this group — you can nudge members with dues.'}
        </div>
      )}

      {/* Crop modal */}
      {cropOpen && cropSource && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-zinc-900 border border-border-tonal rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-white">Edit Group Image</h3>
              <button type="button" onClick={() => setCropOpen(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative h-72 rounded-2xl overflow-hidden border border-border-tonal bg-black">
              <img src={cropSource} alt="Crop preview" className="w-full h-full object-cover"
                style={{ transform: `translate(${cropX}px, ${cropY}px) scale(${cropZoom})` }} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="text-xs text-zinc-400 font-bold">
                Zoom
                <input type="range" min={1} max={2.2} step={0.01} value={cropZoom} onChange={(e) => setCropZoom(Number(e.target.value))} className="w-full mt-2" />
              </label>
              <label className="text-xs text-zinc-400 font-bold">
                Horizontal
                <input type="range" min={-320} max={320} step={1} value={cropX} onChange={(e) => setCropX(Number(e.target.value))} className="w-full mt-2" />
              </label>
              <label className="text-xs text-zinc-400 font-bold">
                Vertical
                <input type="range" min={-220} max={220} step={1} value={cropY} onChange={(e) => setCropY(Number(e.target.value))} className="w-full mt-2" />
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setCropOpen(false)} className="px-4 py-2 rounded-xl text-zinc-300 hover:text-white">Cancel</button>
              <button type="button" onClick={handleSaveCroppedImage} className="px-6 py-2 rounded-xl bg-brand-orange text-white font-bold hover:bg-brand-orange/90">Save image</button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6">
        {[
          { icon: TrendingUp,  color: 'text-emerald-500', label: 'Total Spent',  value: `Rs ${totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
          { icon: Receipt,     color: 'text-brand-orange', label: 'Avg / Member', value: `Rs ${avg.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
          { icon: MinusCircle, color: 'text-red-500',      label: 'Freeloaders',  value: `${freeloaderCount} Detected` },
          { icon: Users,       color: 'text-zinc-300',     label: 'Settled',      value: `${settledPct}% Sync` },
        ].map(({ icon: Icon, color, label, value }) => (
          <div key={label} className="bg-surface-dim tonal-border rounded-3xl p-6 flex items-center gap-4">
            <div className="p-3 bg-zinc-800 rounded-2xl"><Icon className={`w-6 h-6 ${color}`} /></div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">{label}</p>
              <h4 className="text-xl font-black text-white">{value}</h4>
            </div>
          </div>
        ))}
      </div>

      {/* Members */}
      <div className="space-y-6">
        <div className="flex justify-between items-end flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-black text-white leading-none">Operative Status</h2>
            <p className="text-zinc-500 mt-2">Real-time financial exposure per member</p>
          </div>
          <div className="flex gap-4 flex-wrap" ref={filterRef}>
            <div className="flex items-center gap-2 bg-surface-dim border border-border-tonal rounded-xl px-4 py-2">
              <Search className="w-4 h-4 text-zinc-500" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter members..."
                className="bg-transparent text-sm focus:outline-none w-40 text-white placeholder:text-zinc-600" />
            </div>
            <div className="relative">
              <button type="button" onClick={() => setFilterOpen((v) => !v)}
                className="flex items-center gap-2 bg-surface-dim border border-border-tonal rounded-xl px-4 py-2 text-sm font-bold text-zinc-400 hover:text-white transition-all">
                <Filter className="w-4 h-4" /> Filter
                <ChevronDown className={cn('w-4 h-4 transition-transform', filterOpen && 'rotate-180')} />
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 border border-border-tonal rounded-2xl shadow-2xl p-4 z-30 space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Role</p>
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'manager', 'member'] as const).map((r) => (
                        <button key={r} type="button" onClick={() => setRoleFilter(r)}
                          className={cn('px-2 py-1 rounded-lg text-xs font-bold border',
                            roleFilter === r ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange' : 'border-border-tonal text-zinc-500')}>
                          {r === 'all' ? 'All' : r === 'manager' ? 'Manager' : 'Member'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Status</p>
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'fair', 'low', 'freeloader'] as const).map((s) => (
                        <button key={s} type="button" onClick={() => setStatusFilter(s)}
                          className={cn('px-2 py-1 rounded-lg text-xs font-bold border',
                            statusFilter === s ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange' : 'border-border-tonal text-zinc-500')}>
                          {s === 'all' ? 'All' : s === 'fair' ? 'Fair' : s === 'low' ? 'Low' : 'Freeloader'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-6 text-xs font-bold flex-wrap">
          <span className="flex items-center gap-2 text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />🟢 Fair — paid share or more</span>
          <span className="flex items-center gap-2 text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />🟡 Low — owes a little</span>
          <span className="flex items-center gap-2 text-red-400"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />🔴 Freeloader — owes significantly</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
          {filteredMembers.map((m) => {
            const net = balanceByUser.get(m.user_id) ?? 0;
            const st  = getFreelStatus(net, totalSpent);
            const barWidth  = (Math.abs(net) / maxAbs) * 100;
            const menuOpen  = openMenuUserId === m.user_id;
            return (
              <MemberCard
                key={m.user_id}
                name={m.display_name ?? 'Member'}
                role={m.is_manager ? 'Manager' : 'Member'}
                netDisplay={net}
                statusBadge={st.badge}
                riskKey={st.key}
                profilePicture={
                  m.user_id === user?.id
                    ? profile?.profile_picture ?? m.profile_picture ?? null
                    : m.profile_picture ?? null
                }
                memberUserId={m.user_id}
                currentUserId={user?.id ?? ''}
                isCurrentUserManager={currentIsManager}
                canNudge={canNudge}
                barWidth={barWidth}
                barColor={st.barColor}
                menuOpen={menuOpen}
                onToggleMenu={() => setOpenMenuUserId((prev) => (prev === m.user_id ? null : m.user_id))}
                onCloseMenu={() => setOpenMenuUserId(null)}
                onNudge={() => void handleNudgeMember(m.user_id)}
                onRemove={() => void handleRemoveMember(m.user_id)}
                nudgeBusy={nudgeBusyId === m.user_id}
                removeBusy={removeBusyId === m.user_id}
              />
            );
          })}
        </div>
      </div>

      {/* Expense logs */}
      <div className="bg-surface-dim tonal-border rounded-3xl p-8">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-2xl font-bold text-white">Operational Logs</h3>
          <button type="button" onClick={() => setIsModalOpen(true)}
            className="text-brand-orange text-xs font-black uppercase tracking-widest hover:underline">
            Add Log Entry
          </button>
        </div>
        <div className="space-y-6">
          {expenses.length === 0 ? (
            <p className="text-zinc-500 text-sm">No expenses yet.</p>
          ) : (
            expenses.map((log) => {
              const cat    = (log.category as { name?: string } | null)?.name ?? '—';
              const payer  = (log.profiles as { display_name?: string | null } | null)?.display_name ?? '—';
              const title  = String(log.name ?? '');
              const amount = Number(log.total_amount);
              const dateRaw = String(log.date ?? '');
              const photos  = (log.photo_evidence as unknown[] | null) ?? [];
              return (
                <div key={String(log.expense_id)} className="flex items-center justify-between py-4 border-b border-border-tonal last:border-0 group">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-900 tonal-border flex items-center justify-center font-bold text-zinc-500 group-hover:text-brand-orange transition-colors shrink-0">
                      {cat[0] ?? '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h5 className="font-bold text-white truncate">{title}</h5>
                        {photos.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded-md shrink-0">
                            <Paperclip className="w-2.5 h-2.5" /> receipt
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 truncate">Paid by {payer} • {cat}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-white mb-0.5">
                      Rs {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-[10px] text-zinc-600 uppercase font-bold">{formatExpenseDate(dateRaw)}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};