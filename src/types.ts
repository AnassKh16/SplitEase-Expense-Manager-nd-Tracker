// ── Supabase-aligned types ────────────────────────────────────────────────────
// These match the actual shapes returned by your Supabase queries and views.
// The old User/Expense/Activity types were never used; replaced below.

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  profile_picture: string | null;
  contribution_score?: number | null;
};


export type BalanceRow = {
  user_id: string;
  group_id: string;
  display_name: string | null;
  net_balance: number | string | null; // always cast to Number() before use
};

export type GroupRow = {
  group_id: string;
  name: string;
  invite_code?: string | null;
  cover_image_url?: string | null;
};

export type MemberRow = {
  user_id: string;
  display_name: string | null;
  is_manager: boolean | null;
  profile_picture?: string | null;
};

export type ExpenseRow = {
  expense_id: string;
  name: string;
  total_amount: number;
  split_method: string;
  date: string;
  is_locked: boolean;
  expense_type: string;
  group_id?: string;
  paid_by?: string;
  profiles?: { display_name?: string | null } | null;
  category?: { name?: string | null } | null;
  expense_share?: ExpenseShareRow[];
};

export type ExpenseShareRow = {
  user_id: string;
  share_amount: number;
  is_settled: boolean;
};

export type SettlementRow = {
  settlement_id: string;
  amount_paid: number;
  settlement_type: string;
  date: string;
  payer?: { display_name?: string | null } | null;
  receiver?: { display_name?: string | null } | null;
};

// Computed transfer (frontend only — derived from balances)
export type Transfer = {
  payer_id: string;
  receiver_id: string;
  payer_name: string;
  receiver_name: string;
  amount: number;
};
