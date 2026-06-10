import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, ProtectedRoute } from './contexts/AuthContext';
import { OrgProvider } from './contexts/OrgContext';
import DashboardLayout from './layouts/DashboardLayout';
import WorkspaceLayout from './layouts/WorkspaceLayout';
import Dashboard from './pages/Dashboard';
import WorkspacePage from './pages/WorkspacePage';
import WorkspaceOrgsPage from './pages/WorkspaceOrgsPage';
import WorkspaceProjectsPage from './pages/WorkspaceProjectsPage';
import WorkspaceProjectPage from './pages/WorkspaceProjectPage';
import InstanceDetail from './pages/InstanceDetail';
import SupabaseManager from './pages/SupabaseManager';
import Alerts from './pages/Alerts';
import AlertRules from './pages/AlertRules';
import ResetPassword from './pages/ResetPassword';
import UserManagement from './pages/UserManagement';
import BackupManagement from './pages/BackupManagement';
import BackupDestinations from './pages/BackupDestinations';
import UserProfile from './pages/UserProfile';
import NotificationSettings from './pages/NotificationSettings';
import ActivityLog from './pages/ActivityLog';
import ApiKeys from './pages/ApiKeys';
import ApiDocs from './pages/ApiDocs';
import Templates from './pages/Templates';
import Migrations from './pages/Migrations';
import GlobalSmtpSettings from './pages/GlobalSmtpSettings';
import SharedInfra from './pages/SharedInfra';
import OrgMembers from './pages/OrgMembers';
import OrgSettings from './pages/OrgSettings';
import SetupLayout from './layouts/SetupLayout';
import SetupPage from './pages/SetupPage';
import McpSettingsPage from './pages/McpSettingsPage';
import MarketplacePage from './pages/MarketplacePage';
import UpdatesPage from './pages/UpdatesPage';
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

import LandingPage from './pages/LandingPage';
import FeedbackPage from './pages/FeedbackPage';
import VerifyEmail from './pages/VerifyEmail';

function AppContent() {
  // Initialize WebSocket connection for real-time updates
  useWebSocket();

  return (
    <div className='min-h-screen bg-background text-foreground font-sans'>
      <Toaster position='top-right' richColors />
      <Routes>
        {/* Public Routes */}
        <Route path='/' element={<LandingPage />} />
        <Route path='/reset-password' element={<ResetPassword />} />
        <Route path='/feedback' element={<FeedbackPage />} />
        {/* Redirect old auth routes to landing page */}
        <Route path='/login' element={<Navigate to='/' replace />} />
        <Route path='/register' element={<Navigate to='/' replace />} />
        <Route path='/forgot-password' element={<Navigate to='/' replace />} />
        <Route path='/verify-email' element={<VerifyEmail />} />

        {/* Workspace Routes (slim layout) */}
        <Route
          element={
            <ProtectedRoute>
              <WorkspaceLayout />
            </ProtectedRoute>
          }
        >
          <Route path='/workspace' element={<WorkspaceOrgsPage />} />
          <Route path='/workspace/projects' element={<WorkspaceProjectsPage />} />
          <Route path='/workspace/projects/:project' element={<WorkspaceProjectPage />} />
          <Route path='/workspace/projects/:project/:tab' element={<WorkspaceProjectPage />} />
          <Route path='/marketplace' element={<MarketplacePage />} />
          <Route path='/profile' element={<UserProfile />} />
          {/* Legacy workspace route kept as alias */}
          <Route path='/workspace/legacy' element={<WorkspacePage />} />
        </Route>

        {/* Protected Routes with Dashboard Layout */}
        <Route
          element={
            <ProtectedRoute requireAdmin>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path='/dashboard' element={<Dashboard />} />
          <Route path='/instances/:name' element={<InstanceDetail />} />
          <Route path='/instances/:name/supabase' element={<SupabaseManager />} />
          <Route path='/alerts' element={<Alerts />} />
          <Route path='/alert-rules' element={<AlertRules />} />
          <Route path='/backups' element={<BackupManagement />} />
          <Route path='/backup-destinations' element={<BackupDestinations />} />
          <Route path='/notifications' element={<NotificationSettings />} />
          <Route path='/api-keys' element={<ApiKeys />} />
          <Route path='/api-docs' element={<ApiDocs />} />
          <Route path='/templates' element={<Templates />} />
          <Route path='/shared' element={<SharedInfra />} />
          <Route path='/settings/mcp' element={<McpSettingsPage />} />
          <Route path='/orgs/new' element={<OrgSettings />} />
          <Route path='/orgs/:slug/members' element={<OrgMembers />} />
          <Route path='/orgs/:slug/settings' element={<OrgSettings />} />
        </Route>

        {/* Admin Routes with Dashboard Layout */}
        <Route
          element={
            <ProtectedRoute requireAdmin>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path='/users' element={<UserManagement />} />
          <Route path='/migrations' element={<Migrations />} />
          <Route path='/activity' element={<ActivityLog />} />
          <Route path='/settings/smtp' element={<GlobalSmtpSettings />} />
          <Route path='/updates' element={<UpdatesPage />} />
        </Route>
        {/* Setup Routes */}
        <Route path='/setup' element={<SetupLayout />}>
          <Route index element={<Navigate to='/setup/getting-started/requirements' replace />} />
          <Route path=':category/:slug' element={<SetupPage />} />
        </Route>
        {/* Fallback to Landing Page */}
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
          <OrgProvider>
            <AppContent />
          </OrgProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
