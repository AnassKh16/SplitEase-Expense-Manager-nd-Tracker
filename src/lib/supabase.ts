import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Storage bucket for avatars (and any other app files). Must exist in Supabase → Storage. */
const STORAGE_BUCKET =
  String(import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ?? '').trim() || 'splitease';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/** Supabase relation embeds can infer as arrays; normalize for UI. */
export function normalizeUserGroups(rows: unknown): { group_id: string; name: string }[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const gid = String(r.group_id ?? '');
    const g = r.group as Record<string, unknown> | Record<string, unknown>[] | undefined | null;
    const inner = Array.isArray(g) ? g[0] : g;
    const name =
      inner && typeof inner === 'object' && inner && 'name' in inner
        ? String((inner as { name?: unknown }).name ?? '')
        : '';
    return { group_id: gid, name: name || 'Group' };
  });
}

export function normalizeGroupMembers(
  rows: unknown
): { user_id: string; display_name: string | null; is_manager: boolean | null; profile_picture: string | null }[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const p = r.profiles as Record<string, unknown> | Record<string, unknown>[] | undefined | null;
      const pr = Array.isArray(p) ? p[0] : p;
      const user_id =
        pr && typeof pr === 'object' && pr && 'user_id' in pr ? String((pr as { user_id: unknown }).user_id) : '';
      const display_name =
        pr && typeof pr === 'object' && pr && 'display_name' in pr
          ? ((pr as { display_name: unknown }).display_name as string | null)
          : null;
      const profile_picture =
        pr && typeof pr === 'object' && pr && 'profile_picture' in pr
          ? ((pr as { profile_picture: unknown }).profile_picture as string | null)
          : null;
      return {
        user_id,
        display_name: display_name ?? null,
        is_manager: (r.is_manager as boolean | null) ?? null,
        profile_picture: profile_picture ?? null,
      };
    })
    .filter((m) => m.user_id);
}

// ── AUTH ──────────────────────────────────────────────────────────
export async function registerUser(email: string, password: string, displayName: string) {
  const { data: authData, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;

  // FIX: Use upsert instead of update so this works whether the DB trigger
  // has already created the profile row or not. update() silently fails
  // if the row doesn't exist yet; upsert() handles both cases atomically.
  if (authData.user?.id) {
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert(
        { user_id: authData.user.id, display_name: displayName },
        { onConflict: 'user_id' }
      );
    if (profileErr) {
      console.warn('profiles upsert after signup:', profileErr.message);
    }
  }
  return authData.user;
}

export async function loginUser(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

/** Starts Google OAuth redirect to `/auth/callback`. */
export async function loginWithGoogle() {
  // FIX: Redirect to /auth/callback (a neutral route) instead of the root.
  // Redirecting to '/' caused a race: ProtectedRoute checked auth before
  // onAuthStateChange fired, found no session, and bounced to /login.
  // The callback route sets loading=true while auth settles, then redirects.
  // If you don't want to add a new route, use window.location.origin + '/?auth=1'
  // and handle it in AuthContext — but a dedicated callback path is cleaner.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
}

export async function logoutUser() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
  if (error) throw error;
  return data;
}

export async function upsertProfile(userId: string, displayName: string | null) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: displayName }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function storageUploadHint(message: string): string {
  const msg = message || '';
  if (/bucket|not found|Bucket not found/i.test(msg)) {
    return ` Create a Storage bucket named "${STORAGE_BUCKET}" (or set VITE_SUPABASE_STORAGE_BUCKET to your bucket id in .env).`;
  }
  if (/row-level security|RLS|policy|new row violates|permission denied|403|401|not authorized/i.test(msg)) {
    return (
      ' In Supabase → Storage → Policies: allow authenticated users to INSERT objects into this bucket ' +
      `(path prefix avatars/). Re-upload uses a new file each time, so INSERT is enough; avoid policies that only allow SELECT.`
    );
  }
  if (/payload too large|413|size/i.test(msg)) {
    return ' Try a smaller image; the app compresses to JPEG before upload.';
  }
  return '';
}

function profileWriteHint(message: string): string {
  if (/row-level security|RLS|policy|permission denied|42501/i.test(message)) {
    return ' Check Supabase → Table editor → profiles: policies must allow users to update their own profile_picture.';
  }
  return '';
}

/** Decode to something drawImage accepts; HEIC / odd MIME often fail createImageBitmap — fall back to HTMLImageElement. */
async function decodeImageForCanvas(file: File): Promise<ImageBitmap | HTMLImageElement> {
  const t = file.type.toLowerCase();
  if (t && !t.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }
  if (t === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    throw new Error('SVG is not supported. Use JPEG or PNG.');
  }

  try {
    return await createImageBitmap(file);
  } catch {
    // continue to <img> decode (helps some HEIC / WebKit / empty-type cases)
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image. Try JPEG or PNG (HEIC may not work in this browser).'));
    };
    img.src = url;
  });
}

async function resizeImageToJpegAvatar(file: File, maxEdge = 512): Promise<File> {
  const drawable = await decodeImageForCanvas(file);
  const w0 = drawable instanceof ImageBitmap ? drawable.width : drawable.naturalWidth;
  const h0 = drawable instanceof ImageBitmap ? drawable.height : drawable.naturalHeight;
  if (!w0 || !h0) {
    if (drawable instanceof ImageBitmap) drawable.close();
    throw new Error('Invalid image dimensions.');
  }

  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (drawable instanceof ImageBitmap) drawable.close();
    throw new Error('Could not process image in this browser.');
  }

  ctx.drawImage(drawable, 0, 0, w, h);
  if (drawable instanceof ImageBitmap) drawable.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88)
  );
  if (!blob || blob.size < 32) {
    throw new Error('Could not compress image.');
  }
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

export async function uploadProfileAvatar(userId: string, file: File, displayName: string) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw new Error(sessionErr.message || 'Could not read session.');
  if (!sessionData.session) {
    throw new Error('You must be signed in to upload a profile photo. Try signing out and back in.');
  }

  const prepared = await resizeImageToJpegAvatar(file);
  const stamp = Date.now();
  const path = `avatars/${userId}/${stamp}.jpg`;

  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, prepared, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
  });

  if (uploadError) {
    const msg = uploadError.message || 'Storage upload failed';
    const status = (uploadError as { statusCode?: string }).statusCode;
    const extra = status ? ` (${status})` : '';
    throw new Error(`${msg}${extra}${storageUploadHint(msg)}`);
  }

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const base = publicUrlData?.publicUrl;
  if (!base) throw new Error('Failed to generate public URL for avatar');

  const imageUrl = `${base}${base.includes('?') ? '&' : '?'}v=${stamp}`;

  const safeDisplayName = displayName.trim() || 'Member';

  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert(
      { user_id: userId, profile_picture: imageUrl, display_name: safeDisplayName },
      { onConflict: 'user_id' }
    );
  if (profileErr) {
    const pm = profileErr.message || 'Could not save profile URL';
    throw new Error(`${pm}${profileWriteHint(pm)}`);
  }

  return imageUrl;
}

export async function getGroupIdsForUser(userId: string): Promise<string[]> {
  const groups = await getUserGroups(userId);
  return (groups as { group_id: string }[] | null)?.map((g) => g.group_id).filter(Boolean) ?? [];
}

export async function searchUserExpenses(userId: string, q: string) {
  const groupIds = await getGroupIdsForUser(userId);
  const term = q.trim();
  if (!groupIds.length || !term) return [];
  const { data, error } = await supabase
    .from('expense')
    .select('expense_id, name, group_id')
    .in('group_id', groupIds)
    .ilike('name', `%${term}%`)
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

export async function searchUserGroupsByName(userId: string, q: string) {
  const groupIds = await getGroupIdsForUser(userId);
  const term = q.trim();
  if (!groupIds.length || !term) return [];
  const { data, error } = await supabase
    .from('group')
    .select('group_id, name')
    .in('group_id', groupIds)
    .ilike('name', `%${term}%`)
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

export async function searchGroupMateProfiles(userId: string, q: string) {
  const groupIds = await getGroupIdsForUser(userId);
  const term = q.trim();
  if (!groupIds.length || !term) return [];

  const { data: ug, error: e1 } = await supabase.from('user_group').select('user_id, group_id').in('group_id', groupIds);
  if (e1) throw e1;

  const matesFirstGroup = new Map<string, string>();
  for (const row of ug ?? []) {
    const uid = String((row as { user_id: string }).user_id);
    const gid = String((row as { group_id: string }).group_id);
    if (uid === userId) continue;
    if (!matesFirstGroup.has(uid)) matesFirstGroup.set(uid, gid);
  }

  const mateIds = [...matesFirstGroup.keys()];
  if (!mateIds.length) return [];

  const { data: profs, error: e2 } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', mateIds)
    .ilike('display_name', `%${term}%`)
    .limit(15);
  if (e2) throw e2;

  return (profs ?? []).map((p) => {
    const uid = String((p as { user_id: string }).user_id);
    return {
      user_id: uid,
      display_name: (p as { display_name: string | null }).display_name,
      group_id: matesFirstGroup.get(uid) ?? '',
    };
  });
}

// ── GROUPS ────────────────────────────────────────────────────────
export async function getUserGroups(userId: string) {
  const { data, error } = await supabase
    .from('user_group')
    .select(`group_id, is_manager, group:group_id (group_id, name, invite_code)`)
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function createGroup(name: string, userId: string) {
  const { data: group, error } = await supabase.from('group').insert({ name }).select().single();
  if (error) throw error;
  await supabase.from('user_group').insert({ user_id: userId, group_id: group.group_id, is_manager: true });
  return group;
}

export async function joinGroup(inviteCode: string, userId: string) {
  const { data: group, error } = await supabase
    .from('group')
    .select('group_id')
    .eq('invite_code', inviteCode.toUpperCase().trim())
    .single();
  if (error) throw new Error('Invalid invite code');
  const { error: insertErr } = await supabase
    .from('user_group')
    .insert({ user_id: userId, group_id: group.group_id });
  if (insertErr) throw insertErr;
  return group;
}

export async function getGroupById(groupId: string) {
  const { data, error } = await supabase.from('group').select('*').eq('group_id', groupId).single();
  if (error) throw error;
  return data;
}

export async function getGroupExpenseTotals(groupId: string) {
  const { data, error } = await supabase.from('expense').select('total_amount').eq('group_id', groupId);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number((r as { total_amount: number }).total_amount), 0);
}

export async function getGroupExpenseCount(groupId: string) {
  const { count, error } = await supabase
    .from('expense')
    .select('expense_id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  if (error) throw error;
  return count ?? 0;
}

export async function getGroupMembers(groupId: string) {
  const { data, error } = await supabase
    .from('user_group')
    .select(`is_manager, profiles:user_id (user_id, display_name, profile_picture)`)
    .eq('group_id', groupId);
  if (error) throw error;
  return data;
}

// ── EXPENSES ──────────────────────────────────────────────────────
export async function getGroupExpenses(groupId: string) {
  const { data, error } = await supabase
    .from('expense')
    .select(`
      expense_id, name, total_amount, split_method, date, is_locked, expense_type,
      profiles:paid_by (display_name),
      category:category_id (name),
      expense_share (user_id, share_amount, is_settled)
    `)
    .eq('group_id', groupId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addExpenseEqual(
  groupId: string,
  paidBy: string,
  categoryId: string,
  name: string,
  totalAmount: number
) {
  const { data, error } = await supabase.rpc('sp_add_expense', {
    p_group_id:     groupId,
    p_paid_by:      paidBy,
    p_category_id:  categoryId,
    p_name:         name,
    p_total:        Number(totalAmount),
    p_split_method: 'equal',
    p_expense_type: 'one_time',
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Custom split: insert expense + one_time + expense_share rows */
export async function addExpenseCustom(
  groupId: string,
  paidBy: string,
  categoryId: string,
  name: string,
  totalAmount: number,
  shares: { user_id: string; share_amount: number }[]
) {
  const sum = shares.reduce((s, x) => s + Number(x.share_amount), 0);
  if (Math.abs(sum - totalAmount) > 0.02) {
    throw new Error(`Custom shares must sum to total (got ${sum.toFixed(2)}, expected ${totalAmount.toFixed(2)})`);
  }
  const { data: exp, error: e1 } = await supabase
    .from('expense')
    .insert({
      group_id:     groupId,
      paid_by:      paidBy,
      category_id:  categoryId,
      name,
      total_amount: totalAmount,
      split_method: 'custom',
      date:         new Date().toISOString().split('T')[0],
      expense_type: 'one_time',
      is_locked:    false,
    })
    .select('expense_id')
    .single();
  if (e1) throw e1;

  const { error: e1b } = await supabase
    .from('one_time_expense')
    .insert({ expense_id: exp.expense_id });
  if (e1b) throw e1b;

  const shareRows = shares.map((s) => ({
    expense_id:   exp.expense_id,
    user_id:      s.user_id,
    share_amount: Number(s.share_amount),
    is_settled:   s.user_id === paidBy,
  }));
  const { error: e2 } = await supabase.from('expense_share').insert(shareRows);
  if (e2) throw e2;

  return exp.expense_id;
}

export async function getCategories() {
  const { data, error } = await supabase.from('category').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function uploadPhoto(expenseId: string, file: File) {
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `evidence/${expenseId}/${Date.now()}_${sanitizedName}`;
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
  });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const imageUrl = publicUrlData?.publicUrl;
  if (!imageUrl) throw new Error('Failed to generate public URL for uploaded photo');

  const { error: insertErr } = await supabase.from('photo_evidence').insert({
    expense_id: expenseId,
    image_file: imageUrl,
  });
  if (insertErr) throw insertErr;

  return imageUrl;
}

export async function getExpensesForUserGroups(userId: string, options?: { since?: string }) {
  const groups = await getUserGroups(userId);
  const groupIds = (groups as { group_id: string }[] | null)?.map((g) => g.group_id).filter(Boolean) ?? [];
  if (groupIds.length === 0) return [];
  let q = supabase
    .from('expense')
    .select('expense_id, name, total_amount, date, group_id, group:group_id(name), expense_share(is_settled)')
    .in('group_id', groupIds);
  if (options?.since) q = q.gte('date', options.since);
  const { data, error } = await q.order('date', { ascending: false });
  if (error) throw error;
  return data;
}

// ── BALANCES ──────────────────────────────────────────────────────
export async function getGroupBalances(groupId: string) {
  const { data, error } = await supabase
    .from('v_user_balances')
    .select('*')
    .eq('group_id', groupId);
  if (error) throw error;
  return data;
}

export async function getBalancesForUserAcrossGroups(userId: string) {
  const groups = await getUserGroups(userId);
  const groupIds = (groups as { group_id: string }[] | null)?.map((g) => g.group_id).filter(Boolean) ?? [];
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('v_user_balances')
    .select('*')
    .eq('user_id', userId)
    .in('group_id', groupIds);
  if (error) throw error;
  return data;
}

/** All member balances across the given groups (for dashboards / freeloader heuristics). */
export async function getBalancesForGroupIds(groupIds: string[]) {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase.from('v_user_balances').select('*').in('group_id', groupIds);
  if (error) throw error;
  return data ?? [];
}

export async function getUserNetBalance(userId: string, groupId: string) {
  const { data, error } = await supabase.rpc('fn_user_net_balance', {
    p_user_id:  userId,
    p_group_id: groupId,
  });
  if (error) throw error;
  return data as number;
}

// ── SETTLEMENTS ───────────────────────────────────────────────────
export async function recordSettlement(
  payerId: string,
  receiverId: string,
  amount: number,
  type: 'cash' | 'digital',
  platform?: string,
  transactionRef?: string
) {
  const { data: payerCheck, error: payerErr } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('user_id', payerId)
    .single();
  if (payerErr || !payerCheck) throw new Error('Payer profile not found');

  const { data: receiverCheck, error: receiverErr } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('user_id', receiverId)
    .single();
  if (receiverErr || !receiverCheck) throw new Error('Receiver profile not found');

  const { data, error } = await supabase.rpc('sp_record_settlement', {
    p_payer_id:        payerId,
    p_receiver_id:     receiverId,
    p_amount:          Number(amount),
    p_type:            type,
    p_transaction_ref: transactionRef ?? null,
    p_platform:        platform        ?? null,
    p_confirmed_by:    null,
  });

  if (error) {
    console.error('sp_record_settlement error:', error);
    throw new Error(error.message);
  }

  return data;
}

export async function getSettlementsForGroup(groupId: string) {
  const { data: members, error: membersErr } = await supabase
    .from('user_group')
    .select('user_id')
    .eq('group_id', groupId);
  if (membersErr) throw membersErr;

  const memberIds = (members ?? []).map((m) => (m as { user_id: string }).user_id);
  if (memberIds.length === 0) return [];

  const { data, error } = await supabase
    .from('settlement')
    .select(`
      settlement_id, amount_paid, settlement_type, date,
      payer:payer_id (display_name),
      receiver:receiver_id (display_name)
    `)
    .in('payer_id', memberIds)
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getUnsettledReport(groupId: string) {
  const { data, error } = await supabase.rpc('fn_unsettled_report', { p_group_id: groupId });
  if (error) throw error;
  return data;
}

// ── SCORECARD ─────────────────────────────────────────────────────
export async function getUserScorecard(userId: string) {
  const { data, error } = await supabase
    .from('contribution_scorecard')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function getContributionScorecardsForUsers(userIds: string[]) {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('contribution_scorecard')
    .select('*')
    .in('user_id', userIds);
  if (error) throw error;
  return data;
}

export async function getFreelooaders() {
  const { data, error } = await supabase.from('v_freeloaders').select('*');
  if (error) throw error;
  return data;
}

export type ManualNudgeInboxItem = {
  nudge_id: string;
  created_at: string | null;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
};

export async function getManualNudgesForUser(userId: string, limit = 10): Promise<ManualNudgeInboxItem[]> {
  const { data: scRows, error: scErr } = await supabase
    .from('contribution_scorecard')
    .select('scorecard_id')
    .eq('user_id', userId);
  if (scErr) {
    console.warn('getManualNudgesForUser scorecard:', scErr.message);
    return [];
  }
  const scorecardIds = (scRows ?? [])
    .map((r) => String((r as { scorecard_id?: string }).scorecard_id ?? ''))
    .filter(Boolean);
  if (!scorecardIds.length) return [];

  const { data: nudges, error: nErr } = await supabase
    .from('nudge')
    .select('nudge_id, created_at, is_resolved, nudge_type')
    .in('scorecard_id', scorecardIds)
    .or('is_resolved.eq.false,is_resolved.is.null')
    .order('created_at', { ascending: false })
    .limit(40);
  if (nErr) {
    console.warn('getManualNudgesForUser nudge:', nErr.message);
    return [];
  }

  const rawRows = (nudges ?? []) as { nudge_id: string; created_at?: string | null; nudge_type?: string | null }[];
  const nudgeRows = rawRows
    .filter((n) => {
      const t = (n.nudge_type ?? '').toLowerCase();
      return !t || t === 'manual';
    })
    .slice(0, limit);

  const nudgeIds = nudgeRows.map((n) => n.nudge_id);
  if (!nudgeIds.length) return [];

  let mn: unknown[] | null = null;
  try {
    const { data, error: mnErr } = await supabase
      .from('manual_nudge')
      .select('nudge_id, sent_by_user_id')
      .in('nudge_id', nudgeIds);
    if (mnErr) throw mnErr;
    mn = data ?? [];
  } catch {
    mn = [];
  }

  const byNudge = new Map<string, string>();
  (mn ?? []).forEach((r) => {
    const row = r as { nudge_id: string; sent_by_user_id: string | null };
    if (row.nudge_id) byNudge.set(row.nudge_id, row.sent_by_user_id ?? '');
  });

  const sentByIds = [...new Set([...byNudge.values()].filter(Boolean))];
  const nameByUserId = new Map<string, string>();
  if (sentByIds.length) {
    try {
      const { data: profs, error: pErr } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', sentByIds);
      if (pErr) throw pErr;
      (profs ?? []).forEach((p) => {
        const row = p as { user_id: string; display_name: string | null };
        nameByUserId.set(row.user_id, row.display_name ?? 'Member');
      });
    } catch {
      // profiles lookup is optional for inbox copy
    }
  }

  return nudgeRows.map((n) => {
    const sentBy = byNudge.get(n.nudge_id) ?? null;
    return {
      nudge_id: n.nudge_id,
      created_at: n.created_at ?? null,
      sent_by_user_id: sentBy,
      sent_by_name: sentBy ? (nameByUserId.get(sentBy) ?? 'Member') : null,
    };
  });
}

export async function sendNudge(scorecardId: string, sentByUserId: string) {
  const { data: nudge, error: nudgeErr } = await supabase
    .from('nudge')
    .insert({
      scorecard_id: scorecardId,
      trigger_type: 'delay',
      nudge_type:   'manual',
      is_resolved:  false,
    })
    .select('nudge_id')
    .single();
  if (nudgeErr) throw nudgeErr;

  const { error: manualErr } = await supabase
    .from('manual_nudge')
    .insert({ nudge_id: nudge.nudge_id, sent_by_user_id: sentByUserId });
  if (manualErr) throw manualErr;

  return nudge.nudge_id;
}

/** One scorecard query + batched inserts (3 round-trips total). Falls back to parallel single sends if batch insert fails. */
export async function sendNudgesToUserIds(debtorUserIds: string[], sentByUserId: string): Promise<{ ok: number; fail: number }> {
  const ids = [...new Set(debtorUserIds.filter(Boolean))];
  if (!ids.length) return { ok: 0, fail: 0 };

  const { data: scRows, error: scErr } = await supabase
    .from('contribution_scorecard')
    .select('user_id, scorecard_id')
    .in('user_id', ids);
  if (scErr) throw scErr;

  const scorecardByUser = new Map<string, string>();
  for (const row of scRows ?? []) {
    const r = row as { user_id?: string; scorecard_id?: string };
    if (r.user_id && r.scorecard_id) scorecardByUser.set(r.user_id, r.scorecard_id);
  }

  const scorecardIds: string[] = [];
  for (const uid of ids) {
    const sid = scorecardByUser.get(uid);
    if (sid) scorecardIds.push(sid);
  }
  const missing = ids.length - scorecardIds.length;
  if (!scorecardIds.length) return { ok: 0, fail: ids.length };

  const nudgePayload = scorecardIds.map((scorecard_id) => ({
    scorecard_id,
    trigger_type: 'delay' as const,
    nudge_type: 'manual' as const,
    is_resolved: false,
  }));

  const { data: insertedNudges, error: batchNudgeErr } = await supabase
    .from('nudge')
    .insert(nudgePayload)
    .select('nudge_id');

  const batchOk =
    !batchNudgeErr
    && Array.isArray(insertedNudges)
    && insertedNudges.length === nudgePayload.length;

  if (batchOk) {
    const manualPayload = (insertedNudges as { nudge_id: string }[]).map((n) => ({
      nudge_id: n.nudge_id,
      sent_by_user_id: sentByUserId,
    }));
    const { error: manualErr } = await supabase.from('manual_nudge').insert(manualPayload);
    if (!manualErr) {
      return { ok: scorecardIds.length, fail: missing };
    }
    // Nudge rows already inserted — do not run sendNudge again (would duplicate).
    throw manualErr;
  }

  const settled = await Promise.allSettled(scorecardIds.map((sid) => sendNudge(sid, sentByUserId)));
  const ok = settled.filter((s) => s.status === 'fulfilled').length;
  return { ok, fail: missing + (scorecardIds.length - ok) };
}

// ── HISTORY & ANALYTICS ───────────────────────────────────────────
export async function getExpensesForAnalytics(userId: string) {
  const groups = await getUserGroups(userId);
  const groupIds = (groups as { group_id: string }[] | null)?.map((g) => g.group_id).filter(Boolean) ?? [];
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('expense')
    .select(
      `expense_id, total_amount, date, paid_by, category_id,
      category:category_id (category_id, name),
      profiles:paid_by (display_name)`
    )
    .in('group_id', groupIds);
  if (error) throw error;
  return data;
}

export async function getAllExpenses(userId: string) {
  const groups = await getUserGroups(userId);
  const groupIds = (groups as { group_id: string }[] | null)?.map((g) => g.group_id).filter(Boolean) ?? [];
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('expense')
    .select(
      `expense_id, name, total_amount, date, group_id,
      group:group_id(name),
      profiles:paid_by(display_name),
      expense_share (user_id, share_amount, is_settled)`
    )
    .in('group_id', groupIds)
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}
