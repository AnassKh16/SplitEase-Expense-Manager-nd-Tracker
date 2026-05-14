import {
  addExpenseCustom, addExpenseEqual, getCategories,
  getGroupMembers, getUserGroups, normalizeGroupMembers,
  normalizeUserGroups, uploadPhoto,
} from '../lib/supabase';
import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Tag, Check, ChevronRight, FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  groupId?: string | null;
}

type CategoryRow = { category_id: string; name: string };
type MemberRow = { user_id: string; display_name: string | null };

// ── Image compression helper ──────────────────────────────────────────────────
async function compressImage(file: File, maxWidthPx = 1200, quality = 0.75): Promise<File> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidthPx / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ExpenseModal = ({ isOpen, onClose, onSuccess, groupId: lockedGroupId }: ExpenseModalProps) => {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [groups, setGroups] = useState<{ group_id: string; name: string }[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [splitMethod, setSplitMethod] = useState<'equal' | 'custom' | 'percentage'>('equal');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [percentShares, setPercentShares] = useState<Record<string, string>>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  // FIX: Keep a ref of the latest amount so the members effect can read it
  // without having `amount` in its dependency array (which caused a DB call
  // on every single keystroke in the amount field).
  const amountRef = useRef(amount);
  useEffect(() => { amountRef.current = amount; }, [amount]);

  const effectiveGroupId = lockedGroupId ?? selectedGroupId;

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setStep(1); setError(null); setName(''); setAmount('');
    setCategoryId(''); setSplitMethod('equal');
    setCustomShares({}); setPercentShares({});
    setPhotoFile(null); setPreviewUrl(null);
  }, [isOpen, lockedGroupId]);

  // Load categories + groups
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancel = false;
    const load = async () => {
      setDataLoading(true); setError(null);
      try {
        const [cats, gr] = await Promise.all([getCategories(), getUserGroups(user.id)]);
        if (cancel) return;
        const catRows = Array.isArray(cats) ? (cats as CategoryRow[]) : [];
        setCategories(catRows);
        const mapped = normalizeUserGroups(gr);
        setGroups(mapped);
        const first = lockedGroupId || mapped[0]?.group_id || '';
        setSelectedGroupId(first);
        if (catRows.length) setCategoryId(catRows[0].category_id);
      } catch (e: unknown) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancel) setDataLoading(false);
      }
    };
    void load();
    return () => { cancel = true; };
  }, [isOpen, user?.id, lockedGroupId]);

  // FIX: Load members only when group or modal-open changes — NOT when `amount`
  // changes. The amount value is read via amountRef at the moment members
  // finish loading, so initial share calculation is still correct.
  // Old deps: [isOpen, effectiveGroupId, amount]  ← DB call on every keystroke!
  // New deps: [isOpen, effectiveGroupId]           ← DB call only when group changes
  useEffect(() => {
    if (!isOpen || !effectiveGroupId) { setMembers([]); return; }
    let cancel = false;
    const loadMembers = async () => {
      try {
        const raw = await getGroupMembers(effectiveGroupId);
        if (cancel) return;
        const cleaned = normalizeGroupMembers(raw).map((m) => ({ user_id: m.user_id, display_name: m.display_name }));
        setMembers(cleaned);

        // Read the current amount via ref — no dependency needed
        const total = parseFloat(amountRef.current) || 0;
        const share = cleaned.length ? (total / cleaned.length).toFixed(2) : '0';
        const pct = cleaned.length ? (100 / cleaned.length).toFixed(1) : '0';
        const initCustom: Record<string, string> = {};
        const initPct: Record<string, string> = {};
        cleaned.forEach((m) => { initCustom[m.user_id] = share; initPct[m.user_id] = pct; });
        setCustomShares(initCustom);
        setPercentShares(initPct);
      } catch { if (!cancel) setMembers([]); }
    };
    void loadMembers();
    return () => { cancel = true; };
  }, [isOpen, effectiveGroupId]); // ← `amount` intentionally removed

  // Recalculate equal/percentage shares when amount changes (client-side only, no DB)
  // This replaces the DB-triggered recalc that the old code did via the effect above.
  useEffect(() => {
    if (members.length === 0) return;
    const total = parseFloat(amount) || 0;
    const share = (total / members.length).toFixed(2);
    const pct = (100 / members.length).toFixed(1);
    setCustomShares((prev) => {
      const next = { ...prev };
      members.forEach((m) => { next[m.user_id] = share; });
      return next;
    });
    setPercentShares((prev) => {
      const next = { ...prev };
      members.forEach((m) => { next[m.user_id] = pct; });
      return next;
    });
  }, [amount, members]); // safe — pure client-side state update, no DB

  const handleFileSelect = async (file: File) => {
    setCompressing(true);
    const compressed = await compressImage(file);
    setPhotoFile(compressed);
    const url = URL.createObjectURL(compressed);
    setPreviewUrl(url);
    setCompressing(false);
  };

  if (!isOpen) return null;

  const totalNum = parseFloat(amount) || 0;

  const sharesValid = () => {
    if (splitMethod === 'equal') return true;
    if (splitMethod === 'custom') {
      const sum = members.reduce((s, m) => s + (parseFloat(customShares[m.user_id] ?? '0') || 0), 0);
      return Math.abs(sum - totalNum) < 0.05;
    }
    if (splitMethod === 'percentage') {
      const sum = members.reduce((s, m) => s + (parseFloat(percentShares[m.user_id] ?? '0') || 0), 0);
      return Math.abs(sum - 100) < 0.5;
    }
    return true;
  };

  const handleConfirm = async () => {
    if (!user?.id) { setError('Not signed in'); return; }
    if (!effectiveGroupId) { setError('Select a group'); return; }
    if (!name.trim() || totalNum <= 0 || !categoryId) { setError('Enter name, amount, and category'); return; }
    if (!sharesValid()) {
      if (splitMethod === 'custom') setError(`Custom shares must sum to Rs ${totalNum.toFixed(2)}`);
      if (splitMethod === 'percentage') setError('Percentages must sum to 100%');
      return;
    }
    setLoading(true); setError(null);
    try {
      let expenseIdRaw: unknown;
      if (splitMethod === 'equal') {
        expenseIdRaw = await addExpenseEqual(effectiveGroupId, user.id, categoryId, name.trim(), totalNum);
      } else {
        let shares: { user_id: string; share_amount: number }[];
        if (splitMethod === 'percentage') {
          shares = members.map((m) => ({
            user_id: m.user_id,
            share_amount: Math.round(((parseFloat(percentShares[m.user_id] ?? '0') || 0) / 100) * totalNum * 100) / 100,
          }));
        } else {
          shares = members.map((m) => ({
            user_id: m.user_id,
            share_amount: parseFloat(customShares[m.user_id] ?? '0') || 0,
          }));
        }
        expenseIdRaw = await addExpenseCustom(effectiveGroupId, user.id, categoryId, name.trim(), totalNum, shares);
      }

      let expenseId = '';
      if (expenseIdRaw != null && typeof expenseIdRaw === 'object' && 'p_expense_id' in (expenseIdRaw as object)) {
        expenseId = String((expenseIdRaw as { p_expense_id: string }).p_expense_id);
      } else {
        expenseId = String(expenseIdRaw ?? '');
      }

      if (photoFile && expenseId) {
        await uploadPhoto(expenseId, photoFile);
      }

      onSuccess?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save expense');
    } finally {
      setLoading(false);
    }
  };

  const percentSum = members.reduce((s, m) => s + (parseFloat(percentShares[m.user_id] ?? '0') || 0), 0);
  const customSum = members.reduce((s, m) => s + (parseFloat(customShares[m.user_id] ?? '0') || 0), 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-xl bg-surface-dim tonal-border rounded-[32px] overflow-hidden shadow-2xl">

          {/* Header */}
          <div className="p-8 border-b border-border-tonal flex justify-between items-center bg-[#0d0f0f]">
            <div>
              <h3 className="text-2xl font-black text-white tracking-tight">Initiate Expense</h3>
              <div className="flex gap-2 mt-2">
                {[1, 2, 3].map((s) => (
                  <div key={s} className={cn('h-1 rounded-full transition-all duration-300', step >= s ? 'w-8 bg-brand-orange' : 'w-4 bg-zinc-800')} />
                ))}
              </div>
            </div>
            <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-500 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="p-8">
            {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">{error}</p>}
            {dataLoading && <p className="text-zinc-500 text-sm mb-4">Loading…</p>}

            {/* Step 1: Details */}
            {step === 1 && (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                {!lockedGroupId && (
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Group</label>
                    <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}
                      className="w-full bg-zinc-900 tonal-border rounded-2xl py-4 px-4 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-orange/50 font-medium">
                      {groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Expense Name</label>
                  <div className="relative group">
                    <Tag className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600 transition-colors group-focus-within:text-brand-orange" />
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groceries, Rent, Utilities..."
                      className="w-full bg-zinc-900 tonal-border rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-1 focus:ring-brand-orange/50 transition-all font-medium" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Amount (PKR)</label>
                    <div className="relative group">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-emerald-500 text-sm font-bold">Rs</span>
                      <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                        className="w-full bg-zinc-900 tonal-border rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all font-bold" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Category</label>
                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full bg-zinc-900 tonal-border rounded-2xl py-4 px-4 text-zinc-400 focus:outline-none focus:ring-1 focus:ring-brand-orange/50 transition-all font-medium appearance-none">
                      {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                <button type="button" onClick={() => setStep(2)}
                  className="w-full bg-brand-orange text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20">
                  Specify Distribution <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* Step 2: Split method */}
            {step === 2 && (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                <div className="space-y-4">
                  <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Split Method</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['equal', 'custom', 'percentage'] as const).map((p) => (
                      <button key={p} type="button" onClick={() => setSplitMethod(p)}
                        className={cn('py-3 rounded-xl border font-bold text-xs transition-all capitalize',
                          splitMethod === p ? 'bg-brand-orange/10 border-brand-orange/40 text-brand-orange' : 'bg-zinc-900/50 border-border-tonal text-zinc-500 hover:text-zinc-300')}>
                        {p === 'percentage' ? '%  Split' : p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-zinc-900/50 rounded-[24px] tonal-border p-6 space-y-4 max-h-[280px] overflow-y-auto">
                  {members.map((m) => (
                    <div key={m.user_id} className="flex items-center justify-between group">
                      <div className="flex items-center gap-3">
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(m.user_id)}`} className="w-8 h-8 rounded-full" alt="" />
                        <span className="text-sm font-bold text-zinc-200">{m.display_name ?? 'Member'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {splitMethod === 'equal' && (
                          <>
                            <span className="text-xs font-bold text-zinc-400">
                              Rs {(totalNum / (members.length || 1)).toFixed(2)}
                            </span>
                            <div className="w-5 h-5 rounded-md bg-brand-orange flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          </>
                        )}
                        {splitMethod === 'custom' && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-zinc-500 font-bold">Rs</span>
                            <input type="number" min="0" step="0.01"
                              value={customShares[m.user_id] ?? ''}
                              onChange={(e) => setCustomShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                              className="w-24 bg-zinc-900 border border-border-tonal rounded-lg py-1 px-2 text-xs text-white text-right" />
                          </div>
                        )}
                        {splitMethod === 'percentage' && (
                          <div className="flex items-center gap-1">
                            <input type="number" min="0" max="100" step="0.1"
                              value={percentShares[m.user_id] ?? ''}
                              onChange={(e) => setPercentShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                              className="w-20 bg-zinc-900 border border-border-tonal rounded-lg py-1 px-2 text-xs text-white text-right" />
                            <span className="text-[10px] text-zinc-500 font-bold">%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {splitMethod === 'custom' && (
                  <p className={cn('text-xs font-bold', Math.abs(customSum - totalNum) < 0.05 ? 'text-emerald-400' : 'text-amber-400')}>
                    Sum: Rs {customSum.toFixed(2)} / Rs {totalNum.toFixed(2)}
                    {Math.abs(customSum - totalNum) < 0.05 ? ' ✅' : ' ⚠️ must match total'}
                  </p>
                )}
                {splitMethod === 'percentage' && (
                  <p className={cn('text-xs font-bold', Math.abs(percentSum - 100) < 0.5 ? 'text-emerald-400' : 'text-amber-400')}>
                    Total: {percentSum.toFixed(1)}% {Math.abs(percentSum - 100) < 0.5 ? '✅' : '⚠️ must equal 100%'}
                  </p>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setStep(1)} className="flex-1 bg-zinc-800 text-zinc-300 py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-zinc-700 transition-all">Back</button>
                  <button type="button" onClick={() => setStep(3)} className="flex-[2] bg-brand-orange text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20">
                    Evidence Capture
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Receipt */}
            {step === 3 && (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Receipt (optional)</label>
                  <label htmlFor="receipt-upload"
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => { e.preventDefault(); setDragActive(false); const f = e.dataTransfer.files?.[0]; if (f) void handleFileSelect(f); }}
                    className={cn('h-48 border-2 border-dashed rounded-[32px] flex flex-col items-center justify-center space-y-4 transition-all duration-300 cursor-pointer group overflow-hidden relative',
                      dragActive ? 'border-brand-orange bg-brand-orange/5' : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/30')}>
                    <input id="receipt-upload" type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileSelect(f); }} />
                    {previewUrl ? (
                      <img src={previewUrl} alt="Receipt preview" className="w-full h-full object-cover opacity-70" />
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-3xl bg-zinc-800 flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:bg-zinc-700">
                          <Upload className="w-8 h-8 text-zinc-400" />
                        </div>
                        <div className="text-center px-4">
                          <p className="text-white font-bold">Upload Receipt</p>
                          <p className="text-zinc-500 text-xs mt-1">{compressing ? 'Compressing…' : 'Drag & drop or click to choose'}</p>
                        </div>
                      </>
                    )}
                  </label>
                </div>

                {photoFile && (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                    <Paperclip className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold text-emerald-400">📎 Receipt attached: {photoFile.name}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-zinc-900 tonal-border rounded-2xl flex items-center gap-3">
                    <FileText className="w-5 h-5 text-zinc-500" />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Auto-compressed</span>
                  </div>
                  <div className="p-4 bg-zinc-900 tonal-border rounded-2xl flex items-center gap-3">
                    <ImageIcon className="w-5 h-5 text-zinc-500" />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Stored securely</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setStep(2)} className="flex-1 bg-zinc-800 text-zinc-300 py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-zinc-700 transition-all">Back</button>
                  <button type="button" disabled={loading || compressing} onClick={() => void handleConfirm()}
                    className="flex-[2] bg-brand-orange text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50">
                    {loading ? 'Saving…' : compressing ? 'Compressing…' : 'Confirm & Sync'}
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};