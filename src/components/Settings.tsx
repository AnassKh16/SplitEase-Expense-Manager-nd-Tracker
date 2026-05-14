import React, { useEffect, useRef, useState } from 'react';
import {
  User, Shield, AlertTriangle, LogOut, Trash2, Save, Camera, Loader2,
  Eye, EyeOff, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { supabase, upsertProfile, uploadProfileAvatar } from '../lib/supabase';
import { requestProfileRefresh } from '../lib/notificationsBridge';
import { Avatar } from './Avatar';

type Tab = 'profile' | 'security' | 'danger';

function isEmailAuthUser(user: { identities?: { provider: string }[] } | null): boolean {
  return !!user?.identities?.some((i) => i.provider === 'email');
}

export const Settings = () => {
  const { user, profile, logout, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');

  const [name, setName] = useState(profile?.display_name ?? '');
  useEffect(() => {
    setName(profile?.display_name ?? '');
  }, [profile?.display_name]);

  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleSaveName = async () => {
    if (!user?.id) return;
    if (!name.trim()) {
      setNameMsg({ type: 'err', text: 'Display name cannot be empty.' });
      return;
    }
    setNameBusy(true);
    setNameMsg(null);
    try {
      await upsertProfile(user.id, name.trim());
      await refreshProfile();
      requestProfileRefresh();
      setNameMsg({ type: 'ok', text: 'Display name saved.' });
    } catch (e: unknown) {
      setNameMsg({ type: 'err', text: e instanceof Error ? e.message : 'Failed to save name.' });
    } finally {
      setNameBusy(false);
    }
  };

  const handleAvatar = async (f: File | null) => {
    if (!user?.id || !f) return;
    setAvatarBusy(true);
    setAvatarMsg(null);
    try {
      const displayName =
        name.trim() ||
        profile?.display_name?.trim() ||
        (user.email?.split('@')[0] ?? '').trim() ||
        'Member';
      await uploadProfileAvatar(user.id, f, displayName);
      await refreshProfile();
      requestProfileRefresh();
      setAvatarMsg({ type: 'ok', text: 'Profile photo updated.' });
    } catch (e: unknown) {
      const text =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Upload failed.';
      setAvatarMsg({ type: 'err', text });
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleChangePassword = async () => {
    setPwMsg(null);
    if (newPw.length < 6) {
      setPwMsg({ type: 'err', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ type: 'err', text: 'Passwords do not match.' });
      return;
    }
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setNewPw('');
      setConfirmPw('');
      setPwMsg({ type: 'ok', text: 'Password updated.' });
    } catch (e: unknown) {
      setPwMsg({ type: 'err', text: e instanceof Error ? e.message : 'Could not update password.' });
    } finally {
      setPwBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.id || deleteConfirm !== 'DELETE') return;
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      const { error: ugErr } = await supabase.from('user_group').delete().eq('user_id', user.id);
      if (ugErr) throw ugErr;
      await supabase.from('profiles').delete().eq('user_id', user.id);
      await logout();
      window.location.href = '/login';
    } catch (e: unknown) {
      setDeleteMsg({ type: 'err', text: e instanceof Error ? e.message : 'Could not delete account.' });
    } finally {
      setDeleteBusy(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'danger', label: 'Danger zone', icon: AlertTriangle },
  ];

  if (!user) return null;

  return (
    <div className="space-y-8 smooth-enter">
      <div>
        <h2 className="text-5xl font-black text-white leading-none tracking-tighter">Settings</h2>
        <p className="text-zinc-500 mt-2 uppercase text-[10px] font-black tracking-[0.2em]">
          Profile, security, and account controls
        </p>
      </div>

      <div className="flex gap-8 items-start flex-col lg:flex-row">
        <aside className="w-full lg:w-56 shrink-0 space-y-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 border',
                tab === t.id
                  ? 'bg-brand-orange/10 text-brand-orange border-brand-orange/20'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
              )}
            >
              <t.icon className="w-4 h-4 shrink-0" />
              <span className="font-bold text-sm">{t.label}</span>
            </button>
          ))}
        </aside>

        <div className="flex-1 min-w-0 space-y-6">
          {tab === 'profile' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="interactive-card glass-panel flex items-center gap-6 p-6 bg-zinc-900/60 rounded-3xl border border-border-tonal">
                <div className="relative shrink-0">
                  <Avatar
                    size={12}
                    displayName={name || profile?.display_name}
                    email={user.email}
                    profilePicture={profile?.profile_picture}
                    className="rounded-2xl border-2 border-border-tonal w-20 h-20 !rounded-2xl"
                  />
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => fileRef.current?.click()}
                    className="absolute -bottom-2 -right-2 w-9 h-9 bg-brand-orange rounded-xl flex items-center justify-center shadow-lg hover:bg-brand-orange/90 transition-colors disabled:opacity-50"
                  >
                    {avatarBusy ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleAvatar(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div>
                  <p className="font-black text-white text-lg">{profile?.display_name ?? 'Member'}</p>
                  <p className="text-zinc-500 text-sm mt-0.5">{user.email}</p>
                </div>
              </div>
              {avatarMsg && (
                <p className={cn('text-sm', avatarMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400')}>{avatarMsg.text}</p>
              )}

              <div className="interactive-card glass-panel bg-zinc-900/40 rounded-3xl border border-border-tonal p-6 space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Display name</label>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-zinc-900 border border-border-tonal rounded-xl px-3 py-2 text-sm text-white flex-1 min-w-[200px] focus:outline-none focus:ring-1 focus:ring-brand-orange/50"
                    />
                    <button
                      type="button"
                      disabled={nameBusy}
                      onClick={() => void handleSaveName()}
                      className="bg-brand-orange text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-brand-orange/90 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      {nameBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save
                    </button>
                  </div>
                  {nameMsg && (
                    <p className={cn('text-sm mt-2', nameMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400')}>{nameMsg.text}</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Email</label>
                  <p className="mt-2 text-sm font-mono text-zinc-400 bg-zinc-900 border border-border-tonal rounded-xl px-3 py-2">{user.email}</p>
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'security' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {isEmailAuthUser(user) ? (
                <div className="interactive-card glass-panel bg-zinc-900/40 rounded-3xl border border-border-tonal p-6 space-y-4">
                  <div>
                    <h3 className="text-lg font-black text-white">Change password</h3>
                    <p className="text-xs text-zinc-500 mt-1">Signed in with email — you can set a new password for this account.</p>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="New password (min 6 characters)"
                      className="w-full bg-zinc-900 border border-border-tonal rounded-xl py-3 pl-10 pr-10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-orange/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full bg-zinc-900 border border-border-tonal rounded-xl py-3 pl-10 pr-10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-orange/50"
                    />
                  </div>
                  {pwMsg && (
                    <p className={cn('text-sm', pwMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400')}>{pwMsg.text}</p>
                  )}
                  <button
                    type="button"
                    disabled={pwBusy}
                    onClick={() => void handleChangePassword()}
                    className="w-full bg-brand-orange text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand-orange/90 disabled:opacity-50"
                  >
                    {pwBusy ? 'Updating…' : 'Update password'}
                  </button>
                </div>
              ) : (
                <div className="interactive-card glass-panel bg-zinc-900/40 rounded-3xl border border-border-tonal p-6 text-sm text-zinc-500">
                  Password changes are not available for Google sign-in. Manage your password from your Google account.
                </div>
              )}
            </motion.div>
          )}

          {tab === 'danger' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="interactive-card glass-panel bg-red-500/5 border border-red-500/20 rounded-3xl p-6 space-y-4">
                <div className="flex justify-between items-center flex-wrap gap-4">
                  <div>
                    <h3 className="text-lg font-black text-white">Sign out</h3>
                    <p className="text-xs text-zinc-500 mt-1">Leave this device. Your data stays in the cloud.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void logout().then(() => { window.location.href = '/login'; })}
                    className="px-4 py-2 bg-zinc-800 border border-border-tonal text-zinc-200 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-700 inline-flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </div>
                <div className="h-px bg-red-500/10" />
                <div className="flex justify-between items-center flex-wrap gap-4">
                  <div>
                    <h3 className="text-lg font-black text-red-400">Delete account</h3>
                    <p className="text-xs text-zinc-500 mt-1">Removes your memberships and profile in this app, then signs you out.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setDeleteOpen(true); setDeleteConfirm(''); setDeleteMsg(null); }}
                    className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-500/20 inline-flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
                {deleteMsg && (
                  <p className={cn('text-sm', deleteMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400')}>{deleteMsg.text}</p>
                )}
              </div>

              <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-500/80 leading-relaxed">
                  Deleting your account removes you from groups you joined and deletes your profile row. Other members keep shared expenses history.
                </p>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {deleteOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deleteBusy && setDeleteOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-zinc-900 border border-red-500/30 rounded-[28px] p-8 space-y-6 shadow-2xl"
            >
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
                <Trash2 className="w-7 h-7 text-red-400" />
              </div>
              <div className="text-center">
                <h3 className="text-xl font-black text-white">Delete account</h3>
                <p className="text-sm text-zinc-500 mt-2">
                  Type <span className="font-mono text-red-400 font-black">DELETE</span> to confirm.
                </p>
              </div>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-zinc-800 border border-border-tonal rounded-xl py-3 px-4 text-white text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-red-500/50"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setDeleteOpen(false)}
                  className="flex-1 bg-zinc-800 text-zinc-300 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteConfirm !== 'DELETE' || deleteBusy}
                  onClick={() => void handleDeleteAccount()}
                  className="flex-[2] bg-red-500 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-red-600 disabled:opacity-30"
                >
                  {deleteBusy ? 'Working…' : 'Permanently delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
