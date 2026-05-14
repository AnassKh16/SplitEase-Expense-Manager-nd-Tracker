import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { registerUser } from '../lib/supabase';
import { LayoutDashboard, Eye, EyeOff } from 'lucide-react';

const GMAIL_RE = /^[^\s@]+@gmail\.com$/i;

export const Register = () => {
  const navigate = useNavigate();
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleRegister = async () => {
    setNameError('');
    setEmailError('');
    setPasswordError('');
    setConfirmError('');
    setError('');

    if (!name.trim() || name.trim().length < 2) {
      setNameError('Display name is required (min 2 characters).');
      return;
    }
    if (!GMAIL_RE.test(email.trim())) {
      setEmailError('Please use a valid @gmail.com address.');
      return;
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await registerUser(email.trim(), password, name.trim());
      navigate('/login', { state: { message: 'Account created! Please sign in.' } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ff6a00] to-[#ff9e5e] flex items-center justify-center">
            <LayoutDashboard className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tighter">SplitEase</h1>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
          <h2 className="text-3xl font-black text-white">Create Account</h2>

          {error && <p className="text-red-400 text-sm bg-red-500/10 p-3 rounded-xl">{error}</p>}

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Display Name</label>
              <input
                type="text" value={name} onChange={(e) => { setName(e.target.value); setNameError(''); }}
                placeholder="Muhammad Anass"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-3 px-4 text-white focus:outline-none focus:ring-1 focus:ring-[#ff6a00]/50"
              />
              {nameError && <p className="text-red-400 text-xs mt-1">{nameError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Email</label>
              <input
                type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                placeholder="you@gmail.com"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-3 px-4 text-white focus:outline-none focus:ring-1 focus:ring-[#ff6a00]/50"
              />
              {emailError && <p className="text-red-400 text-xs mt-1">{emailError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-3 pl-4 pr-12 text-white focus:outline-none focus:ring-1 focus:ring-[#ff6a00]/50"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff6a00]/50"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {passwordError && <p className="text-red-400 text-xs mt-1">{passwordError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setConfirmError(''); }}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-3 pl-4 pr-12 text-white focus:outline-none focus:ring-1 focus:ring-[#ff6a00]/50"
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff6a00]/50"
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {confirmError && <p className="text-red-400 text-xs mt-1">{confirmError}</p>}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleRegister()} disabled={loading}
            className="w-full bg-[#ff6a00] hover:bg-[#ff6a00]/90 text-white py-4 rounded-2xl font-black uppercase tracking-widest disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="text-center text-zinc-500 text-sm">
            Already registered?{' '}
            <Link to="/login" className="text-[#ff6a00] font-bold hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
};
