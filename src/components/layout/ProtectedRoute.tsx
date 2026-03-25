import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Database } from 'lucide-react';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground dot-grid">
        <div className="h-16 w-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-8 animate-pulse shadow-[0_0_30px_rgba(234,179,8,0.2)]">
            <Database className="h-8 w-8 text-primary animate-pulse" />
        </div>
        <p className="text-muted-foreground animate-pulse text-sm font-medium tracking-wide">
          Verifying session...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
