import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { GroupDetail } from './components/GroupDetail';
import { GroupsList } from './components/GroupsList';
import { History } from './components/History';
import { Analytics } from './components/Analytics';
import { Settlement } from './components/Settlement';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { Settings } from './components/Settings';

// FIX: New callback component that handles the Google OAuth redirect.
// After Google redirects back to /auth/callback, AuthContext picks up
// the session from the URL hash. This component just waits for loading
// to finish, then routes the user to the right place — no flash of the
// register page, no race condition.
function AuthCallback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!loading) {
      navigate(session ? '/' : '/login', { replace: true });
    }
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-zinc-500">
      Signing you in...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Router>
      <Routes>
        {/* FIX: Dedicated callback route for Google OAuth redirect */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <Register />
            </PublicRoute>
          }
        />

        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/groups" element={<GroupsList />} />
                  <Route path="/groups/:id" element={<GroupDetail />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/settlement" element={<Settlement />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}