import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, History, Settings, Bell,
  Search, ChevronRight, LogOut, BarChart3, Scale, Loader2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import {
  getFreelooaders,
  searchUserExpenses,
  searchUserGroupsByName,
  searchGroupMateProfiles,
  supabase,
} from '../lib/supabase';
import { Avatar } from './Avatar';

// ── Notification cache ────────────────────────────────────────────────────────
interface NotifCache { items: string[]; fetchedAt: number; }
const notifCacheMap = new Map<string, NotifCache>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface SidebarItemProps { to: string; icon: React.ElementType; label: string; }

const SidebarItem = ({ to, icon: Icon, label }: SidebarItemProps) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group',
        isActive
          ? 'bg-brand-orange/10 text-brand-orange border border-brand-orange/20'
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50'
      )
    }
  >
    <Icon className="w-5 h-5" />
    <span className="font-medium text-sm">{label}</span>
    <ChevronRight className="w-4 h-4 ml-auto opacity-0 -translate-x-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0" />
  </NavLink>
);

export const Sidebar = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleSignOut = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="w-72 h-screen fixed left-0 top-0 border-r border-border-tonal bg-[#0a0a0a] flex flex-col p-6 z-50">
      <div className="flex items-center gap-3 mb-10 px-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-orange to-[#ff9e5e] flex items-center justify-center shadow-lg shadow-brand-orange/20">
          <LayoutDashboard className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-xl font-black text-white tracking-tighter">SplitEase</h1>
      </div>

      <nav className="flex-1 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold mb-4 ml-2">Main Menu</p>
        <SidebarItem to="/" icon={LayoutDashboard} label="Dashboard" />
        <SidebarItem to="/groups" icon={Users} label="Groups" />
        <SidebarItem to="/analytics" icon={BarChart3} label="Analytics" />
        <SidebarItem to="/settlement" icon={Scale} label="Settlement" />
        <SidebarItem to="/history" icon={History} label="History" />
        <SidebarItem to="/settings" icon={Settings} label="Settings" />
      </nav>

      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="mt-auto flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full text-left border border-transparent hover:border-red-500/20"
      >
        <LogOut className="w-5 h-5" />
        <span className="font-medium text-sm">Sign Out</span>
      </button>
    </aside>
  );
};

type SearchExpense = { expense_id: string; name: string; group_id: string };
type SearchGroup   = { group_id: string; name: string };
type SearchMember  = { user_id: string; display_name: string | null; group_id: string };

// ── Helper: fetch nudges for current user directly (no external function) ─────
async function fetchNudgesForUser(userId: string): Promise<string[]> {
  // Step 1: get this user's scorecard_id
  const { data: sc, error: scErr } = await supabase
    .from('contribution_scorecard')
    .select('scorecard_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (scErr || !sc?.scorecard_id) return [];

  // Step 2: get unresolved nudges for that scorecard
  // Using date_issued (the actual column name — NOT created_at)
  const { data: nudges, error: nudgeErr } = await supabase
    .from('nudge')
    .select('nudge_id, date_issued, trigger_type, nudge_type')
    .eq('scorecard_id', sc.scorecard_id)
    .eq('is_resolved', false)
    .order('date_issued', { ascending: false })
    .limit(10);

  if (nudgeErr || !nudges?.length) return [];

  // Step 3: for each nudge, check manual_nudge to get sender name
  const items: string[] = [];
  for (const nudge of nudges) {
    const { data: mn } = await supabase
      .from('manual_nudge')
      .select('sent_by_user_id')
      .eq('nudge_id', nudge.nudge_id)
      .maybeSingle();

    let senderName = 'a group member';
    if (mn?.sent_by_user_id) {
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', mn.sent_by_user_id)
        .maybeSingle();
      senderName = senderProfile?.display_name ?? 'a group member';
    }

    const date = new Date(nudge.date_issued).toLocaleDateString();
    items.push(`🔔 ${senderName} nudged you to settle dues (${date})`);
  }

  return items;
}

// ── Mark nudges as resolved for user ─────────────────────────────────────────
async function resolveNudgesForUser(userId: string): Promise<void> {
  const { data: sc } = await supabase
    .from('contribution_scorecard')
    .select('scorecard_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!sc?.scorecard_id) return;

  await supabase
    .from('nudge')
    .update({ is_resolved: true })
    .eq('scorecard_id', sc.scorecard_id)
    .eq('is_resolved', false);
}

// ── Navbar ────────────────────────────────────────────────────────────────────
export const Navbar = () => {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [notifCount, setNotifCount]   = useState(0);
  const [showNotifs, setShowNotifs]   = useState(false);
  const [notifItems, setNotifItems]   = useState<string[]>([]);
  const fetchingRef = useRef(false);

  const [searchValue, setSearchValue]     = useState('');
  const [debounced, setDebounced]         = useState('');
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [expenseHits, setExpenseHits]     = useState<SearchExpense[]>([]);
  const [groupHits, setGroupHits]         = useState<SearchGroup[]>([]);
  const [memberHits, setMemberHits]       = useState<SearchMember[]>([]);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const displayName =
    profile?.display_name?.trim()
    || String(meta?.['full_name'] ?? meta?.['name'] ?? '').trim()
    || user?.email?.split('@')[0]
    || 'Member';
  const subtitle = user?.email ?? '';

  // ── Search debounce ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(searchValue.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchValue]);

  const runSearch = useCallback(async (q: string) => {
    if (!user?.id || !q) {
      setExpenseHits([]); setGroupHits([]); setMemberHits([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    try {
      const [expenses, groups, members] = await Promise.all([
        searchUserExpenses(user.id, q),
        searchUserGroupsByName(user.id, q),
        searchGroupMateProfiles(user.id, q),
      ]);
      setExpenseHits(expenses as SearchExpense[]);
      setGroupHits(groups as SearchGroup[]);
      setMemberHits(members as SearchMember[]);
    } catch {
      setExpenseHits([]); setGroupHits([]); setMemberHits([]);
    } finally {
      setSearchLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!searchOpen) return;
    void runSearch(debounced);
  }, [debounced, searchOpen, runSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ── Notification loader ───────────────────────────────────────────────────
  const loadNotifications = useCallback(async (userId: string) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [fl, nudgeItems] = await Promise.all([
        getFreelooaders(),
        fetchNudgesForUser(userId),
      ]);

      const items: string[] = [];

      // Freeloader alerts
      const flList = (fl as { display_name: string | null }[]) ?? [];
      flList.slice(0, 3).forEach((f) => {
        items.push(`🚨 ${f.display_name ?? 'A member'} flagged as freeloader`);
      });

      // Nudge notifications (already formatted strings)
      nudgeItems.forEach((n) => items.push(n));

      notifCacheMap.set(userId, { items, fetchedAt: Date.now() });
      setNotifItems(items);
      setNotifCount(items.length);
    } catch {
      // non-critical — silently fail
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  // ── Initial load + realtime subscription ─────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    const cached = notifCacheMap.get(userId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setNotifItems(cached.items);
      setNotifCount(cached.items.length);
    } else {
      void loadNotifications(userId);
    }

    const refresh = () => {
      notifCacheMap.delete(userId);
      void loadNotifications(userId);
    };

    // Listen for new nudge inserts — realtime
    const nudgeSub = supabase
      .channel(`nav-nudges-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'nudge',
      }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(nudgeSub);
    };
  }, [loadNotifications, user?.id]);

  const handleClearAll = async () => {
    setShowNotifs(false);
    setNotifCount(0);
    setNotifItems([]);
    if (user?.id) {
      notifCacheMap.delete(user.id);
      // Mark all nudges as resolved in DB
      await resolveNudgesForUser(user.id);
    }
  };

  const totalHits = expenseHits.length + groupHits.length + memberHits.length;
  const showDropdown = searchOpen && searchValue.trim().length > 0;

  return (
    <header className="h-20 fixed top-0 right-0 left-72 border-b border-border-tonal bg-[#0a0a0a]/80 backdrop-blur-xl z-40 px-10 flex items-center justify-between">

      {/* Search */}
      <div ref={searchWrapRef} className="relative group w-96">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 transition-colors group-focus-within:text-brand-orange" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => { setSearchValue(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search expenses, groups, or members..."
          className="w-full bg-zinc-900/50 border border-border-tonal rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-brand-orange/50 transition-all text-white"
        />

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-zinc-900 border border-border-tonal rounded-2xl shadow-2xl max-h-80 overflow-y-auto z-50">
            {searchLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-zinc-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin text-brand-orange" /> Searching…
              </div>
            ) : totalHits === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No results for "{searchValue}"</p>
            ) : (
              <div className="py-2">
                {expenseHits.length > 0 && (
                  <div className="px-3 pt-2 pb-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1">Expenses</p>
                    {expenseHits.map((e) => (
                      <button key={e.expense_id} type="button"
                        onClick={() => { navigate(`/groups/${e.group_id}`); setSearchOpen(false); }}
                        className="w-full text-left px-3 py-2 rounded-xl text-sm text-zinc-200 hover:bg-zinc-800/80 transition-colors">
                        {e.name}
                      </button>
                    ))}
                  </div>
                )}
                {groupHits.length > 0 && (
                  <div className="px-3 pt-2 pb-1 border-t border-border-tonal">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1">Groups</p>
                    {groupHits.map((g) => (
                      <button key={g.group_id} type="button"
                        onClick={() => { navigate(`/groups/${g.group_id}`); setSearchOpen(false); }}
                        className="w-full text-left px-3 py-2 rounded-xl text-sm text-zinc-200 hover:bg-zinc-800/80 transition-colors">
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}
                {memberHits.length > 0 && (
                  <div className="px-3 pt-2 pb-2 border-t border-border-tonal">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1">Members</p>
                    {memberHits.map((m) => (
                      <button key={m.user_id} type="button"
                        onClick={() => { navigate(`/groups/${m.group_id}`); setSearchOpen(false); }}
                        className="w-full text-left px-3 py-2 rounded-xl text-sm text-zinc-200 hover:bg-zinc-800/80 transition-colors">
                        {m.display_name ?? 'Member'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Bell */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const next = !showNotifs;
              setShowNotifs(next);
              if (next && user?.id) {
                notifCacheMap.delete(user.id);
                void loadNotifications(user.id);
              }
            }}
            className="relative p-2 text-zinc-400 hover:text-brand-orange transition-colors"
          >
            <Bell className="w-5 h-5" />
            {notifCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-brand-orange rounded-full border-2 border-[#0a0a0a] flex items-center justify-center text-[8px] font-black text-white">
                {notifCount > 9 ? '9+' : notifCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-12 w-80 bg-zinc-900 border border-border-tonal rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border-tonal flex justify-between items-center">
                <p className="text-xs font-black text-white uppercase tracking-widest">Notifications</p>
                <button type="button" onClick={() => void handleClearAll()}
                  className="text-[10px] text-zinc-500 hover:text-brand-orange font-bold uppercase tracking-widest">
                  Clear all
                </button>
              </div>
              {notifItems.length === 0 ? (
                <p className="px-4 py-6 text-sm text-zinc-500 text-center">No new notifications</p>
              ) : (
                <div className="divide-y divide-border-tonal max-h-72 overflow-y-auto">
                  {notifItems.map((item, i) => (
                    <div key={i} className="px-4 py-3 hover:bg-zinc-800/50 transition-colors">
                      <p className="text-sm text-zinc-300">{item}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-8 w-px bg-border-tonal" />

        {/* User info */}
        <div className="flex items-center gap-3 p-1 pr-3 rounded-full border border-transparent">
          <Avatar
            size={8}
            displayName={displayName}
            email={user?.email ?? null}
            profilePicture={profile?.profile_picture}
            className="border border-border-tonal"
          />
          <div className="text-left">
            <p className="text-xs font-bold leading-none mb-0.5 text-white">{displayName}</p>
            <p className="text-[10px] text-zinc-500 leading-none max-w-[180px] truncate">{subtitle}</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-bg-void pl-72 pt-20">
      <Sidebar />
      <Navbar />
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="p-10 max-w-7xl mx-auto"
      >
        {children}
      </motion.main>
    </div>
  );
};