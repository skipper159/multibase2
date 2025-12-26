import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, ProtectedRoute } from './contexts/AuthContext';
import Dashboard from './pages/Dashboard';
import InstanceDetail from './pages/InstanceDetail';
import Alerts from './pages/Alerts';
import AlertRules from './pages/AlertRules';
import Login from './pages/Login';
import UserManagement from './pages/UserManagement';
import BackupManagement from './pages/BackupManagement';
import UserProfile from './pages/UserProfile';
import NotificationSettings from './pages/NotificationSettings';
import ActivityLog from './pages/ActivityLog';
import ApiKeys from './pages/ApiKeys';
import ApiDocs from './pages/ApiDocs';
import Templates from './pages/Templates';
import Migrations from './pages/Migrations';
import GlobalSmtpSettings from './pages/GlobalSmtpSettings';
import { useWebSocket } from './hooks/useWebSocket';

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function AppContent() {
  // Initialize WebSocket connection for real-time updates
  useWebSocket();

  return (
    <div className='min-h-screen bg-background'>
      <Toaster position='top-right' richColors />
      <Routes>
        <Route path='/login' element={<Login />} />
        <Route
          path='/'
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path='/instances/:name'
          element={
            <ProtectedRoute>
              <InstanceDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path='/alerts'
          element={
            <ProtectedRoute>
              <Alerts />
            </ProtectedRoute>
          }
        />
        <Route
          path='/alert-rules'
          element={
            <ProtectedRoute>
              <AlertRules />
            </ProtectedRoute>
          }
        />
        <Route
          path='/users'
          element={
            <ProtectedRoute requireAdmin>
              <UserManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path='/backups'
          element={
            <ProtectedRoute>
              <BackupManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path='/profile'
          element={
            <ProtectedRoute>
              <UserProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path='/notifications'
          element={
            <ProtectedRoute>
              <NotificationSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path='/api-keys'
          element={
            <ProtectedRoute>
              <ApiKeys />
            </ProtectedRoute>
          }
        />
        <Route
          path='/api-docs'
          element={
            <ProtectedRoute>
              <ApiDocs />
            </ProtectedRoute>
          }
        />
        <Route
          path='/templates'
          element={
            <ProtectedRoute>
              <Templates />
            </ProtectedRoute>
          }
        />
        <Route
          path='/migrations'
          element={
            <ProtectedRoute requireAdmin>
              <Migrations />
            </ProtectedRoute>
          }
        />
        <Route
          path='/activity'
          element={
            <ProtectedRoute requireAdmin>
              <ActivityLog />
            </ProtectedRoute>
          }
        />
        <Route
          path='/settings/smtp'
          element={
            <ProtectedRoute requireAdmin>
              <GlobalSmtpSettings />
            </ProtectedRoute>
          }
        />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
