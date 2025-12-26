import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useInstances, useSystemMetrics } from '../hooks/useInstances';
import { useAlertStats } from '../hooks/useAlerts';
import { useAuth } from '../contexts/AuthContext';
import InstanceCard from '../components/InstanceCard';
import CreateInstanceModal from '../components/CreateInstanceModal';
import GaugeChart from '../components/charts/GaugeChart';
import PageHeader from '../components/PageHeader';
import {
  Loader2,
  Plus,
  AlertCircle,
  Bell,
  Activity,
  TrendingUp,
  LogOut,
  Users,
  Database,
  Key,
  Mail,
} from 'lucide-react';

export default function Dashboard() {
  const { data: instances, isLoading, error, refetch } = useInstances();
  const { data: alertStats } = useAlertStats();
  const { data: systemMetrics } = useSystemMetrics();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (location.state?.openCreateModal && location.state?.template) {
      setSelectedTemplate(location.state.template);
      setIsCreateModalOpen(true);
      // Clear state so it doesn't reopen on refresh (optional, but good practice usually involves clearing history state)
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <Loader2 className='w-8 h-8 animate-spin text-primary' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-center'>
          <AlertCircle className='w-12 h-12 text-destructive mx-auto mb-4' />
          <h2 className='text-xl font-semibold mb-2'>Failed to load instances</h2>
          <p className='text-muted-foreground mb-4'>{error instanceof Error ? error.message : 'An error occurred'}</p>
          <button
            onClick={() => refetch()}
            className='px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90'
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-background'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <p className='text-muted-foreground mt-1'>Manage your Supabase instances</p>
          </div>
          <div className='flex items-center gap-3'>
            {/* Alert Badge */}
            <Link
              to='/alerts'
              className='relative flex items-center gap-2 px-4 py-2 bg-secondary border border-border rounded-md hover:bg-muted transition-colors'
            >
              <Bell className='w-4 h-4' />
              Alerts
              {alertStats && alertStats.active > 0 && (
                <span className='absolute -top-2 -right-2 bg-destructive text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center'>
                  {alertStats.active}
                </span>
              )}
            </Link>

            <Link
              to='/templates'
              className='flex items-center gap-2 px-4 py-2 bg-secondary border border-border rounded-md hover:bg-muted transition-colors'
            >
              <Database className='w-4 h-4' />
              Templates
            </Link>

            <button
              className='flex items-center gap-2 px-4 py-2 bg-primary text-white font-medium rounded-md hover:bg-primary/90 transition-colors'
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className='w-4 h-4' />
              Create Instance
            </button>

            {/* User Menu */}
            <div className='relative'>
              <button
                className='flex items-center gap-2 px-4 py-2 bg-secondary border border-border rounded-md hover:bg-muted transition-colors'
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <div className='w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-semibold'>
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
                <span className='text-sm text-foreground'>{user?.username}</span>
              </button>

              {showUserMenu && (
                <div className='absolute right-0 mt-2 w-56 bg-card border border-border rounded-md shadow-lg z-50'>
                  <div className='p-3 border-b border-border'>
                    <p className='text-sm font-medium text-foreground'>{user?.username}</p>
                    <p className='text-xs text-muted-foreground'>{user?.email}</p>
                    <p className='text-xs text-primary mt-1 capitalize'>{user?.role}</p>
                  </div>
                  <div className='py-1'>
                    <Link
                      to='/backups'
                      className='flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted'
                      onClick={() => setShowUserMenu(false)}
                    >
                      <Database className='w-4 h-4' />
                      Backup & Restore
                    </Link>
                    <Link
                      to='/api-keys'
                      className='flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors'
                      onClick={() => setShowUserMenu(false)}
                    >
                      <Key className='w-4 h-4' />
                      API Keys
                    </Link>
                    {user?.role === 'admin' && (
                      <Link
                        to='/activity'
                        className='flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted'
                        onClick={() => setShowUserMenu(false)}
                      >
                        <Activity className='w-4 h-4' />
                        Activity Log
                      </Link>
                    )}
                    {user?.role === 'admin' && (
                      <Link
                        to='/users'
                        className='flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted'
                        onClick={() => setShowUserMenu(false)}
                      >
                        <Users className='w-4 h-4' />
                        User Management
                      </Link>
                    )}
                    {user?.role === 'admin' && (
                      <Link
                        to='/settings/smtp'
                        className='flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted'
                        onClick={() => setShowUserMenu(false)}
                      >
                        <Mail className='w-4 h-4' />
                        SMTP Settings
                      </Link>
                    )}
                    {user?.role === 'admin' && (
                      <Link
                        to='/migrations'
                        className='flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted'
                        onClick={() => setShowUserMenu(false)}
                      >
                        <Database className='w-4 h-4' />
                        Database Migrations
                      </Link>
                    )}
                  </div>
                  <div className='border-t border-border py-1'>
                    <button
                      onClick={() => {
                        logout();
                        setShowUserMenu(false);
                      }}
                      className='flex items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-muted w-full text-left'
                    >
                      <LogOut className='w-4 h-4' />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </PageHeader>

      {/* Main Content */}
      <main className='container mx-auto px-6 py-8'>
        {/* Stats Overview */}
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6 mb-8'>
          <div className='bg-card border border-border rounded-lg p-6'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>Total Instances</p>
                <p className='text-3xl font-bold mt-1 text-foreground'>{instances?.length || 0}</p>
              </div>
              <div className='w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center'>
                <svg className='w-6 h-6 text-primary' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 12h14M12 5l7 7-7 7' />
                </svg>
              </div>
            </div>
          </div>

          <div className='bg-card border border-border rounded-lg p-6'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>Healthy</p>
                <p className='text-3xl font-bold mt-1 text-primary'>
                  {instances?.filter((i) => i.health.overall === 'healthy').length || 0}
                </p>
              </div>
              <div className='w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center'>
                <svg className='w-6 h-6 text-primary' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                </svg>
              </div>
            </div>
          </div>

          <div className='bg-card border border-border rounded-lg p-6'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>Total Services</p>
                <p className='text-3xl font-bold mt-1 text-foreground'>
                  {instances?.reduce((sum, i) => sum + i.services.length, 0) || 0}
                </p>
              </div>
              <div className='w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center'>
                <svg className='w-6 h-6 text-primary' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* System Overview Charts */}
        {systemMetrics && instances && instances.length > 0 && (
          <div className='bg-card border rounded-lg p-6 mb-8'>
            <h2 className='text-xl font-semibold mb-6 flex items-center gap-2'>
              <Activity className='w-6 h-6' />
              System Overview
            </h2>

            <div className='grid grid-cols-1 lg:grid-cols-2 gap-8'>
              {/* Total CPU Gauge */}
              <div className='flex flex-col items-center'>
                <GaugeChart label='Total CPU Usage' value={systemMetrics.totalCpu} icon={Activity} size='lg' />
                <div className='mt-4 text-center'>
                  <p className='text-sm text-muted-foreground'>
                    Across {systemMetrics?.runningCount ?? 0} running instance
                    {(systemMetrics?.runningCount ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Total Memory Gauge */}
              <div className='flex flex-col items-center'>
                <GaugeChart
                  label='Total Memory'
                  value={systemMetrics?.totalMemory ? (systemMetrics.totalMemory / 1024 / 10) * 100 : 0}
                  displayValue={
                    systemMetrics?.totalMemory ? `${(systemMetrics.totalMemory / 1024).toFixed(1)} GB` : '0 GB'
                  }
                  icon={TrendingUp}
                  color='purple'
                  size='lg'
                />
                <div className='mt-4 text-center'>
                  <p className='text-sm text-muted-foreground'>Combined memory usage</p>
                </div>
              </div>
            </div>

            <div className='mt-6 text-center'>
              <p className='text-xs text-muted-foreground'>
                Last updated:{' '}
                {systemMetrics?.timestamp ? new Date(systemMetrics.timestamp).toLocaleTimeString() : 'N/A'}
              </p>
            </div>
          </div>
        )}

        {/* Instance Grid */}
        {!instances || instances.length === 0 ? (
          <div className='text-center py-12 bg-card border rounded-lg'>
            <svg
              className='w-16 h-16 text-muted-foreground mx-auto mb-4'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4'
              />
            </svg>
            <h3 className='text-xl font-semibold mb-2'>No instances yet</h3>
            <p className='text-muted-foreground mb-4'>Get started by creating your first Supabase instance</p>
            <button
              className='px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90'
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className='w-4 h-4 inline mr-2' />
              Create Instance
            </button>
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {instances.map((instance) => (
              <InstanceCard key={instance.id} instance={instance} />
            ))}
          </div>
        )}
      </main>

      {/* Create Instance Modal */}
      <CreateInstanceModal
        open={isCreateModalOpen}
        onOpenChange={(open) => {
          setIsCreateModalOpen(open);
          if (!open) setSelectedTemplate(null);
        }}
        initialTemplate={selectedTemplate}
      />
    </div>
  );
}
