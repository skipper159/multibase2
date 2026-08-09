import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useInstancesAll, useSystemMetrics } from '../hooks/useInstances';
import { useSharedStatus } from '../hooks/useShared';
import { useAlertStats } from '../hooks/useAlerts';
import { useAuth } from '../contexts/AuthContext';
import { useBulkSelection } from '../hooks/useBulkSelection';
import InstanceCard from '../components/InstanceCard';
import BulkActionBar from '../components/BulkActionBar';
import CreateInstanceModal from '../components/CreateInstanceModal';
import GaugeChart from '../components/charts/GaugeChart';
import {
  Loader2,
  Plus,
  AlertCircle,
  Bell,
  Activity,
  TrendingUp,
  Cloud,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HardDrive,
  Building2,
} from 'lucide-react';

export default function Dashboard() {
  const { data: instances, isLoading, error, refetch } = useInstancesAll();
  const { data: alertStats } = useAlertStats();
  const { data: systemMetrics } = useSystemMetrics();
  const { data: sharedStatus } = useSharedStatus();
  const { user } = useAuth();
  const location = useLocation();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const bulkSelection = useBulkSelection<string>();

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
    <div className='min-h-screen'>
      {/* Page Header */}
      <header className='border-b border-white/5 bg-card/30 backdrop-blur-sm sticky top-0 z-20'>
        <div className='px-4 sm:px-8 py-4 sm:py-6'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <h1 className='text-2xl font-bold text-foreground'>Dashboard</h1>
              <p className='text-muted-foreground mt-1'>Manage your Supabase instances</p>
            </div>
            <div className='flex items-center gap-3'>
              {/* Alert Badge */}
              <Link to='/alerts' className='relative flex items-center gap-2 px-4 py-2 btn-secondary'>
                <Bell className='w-4 h-4' />
                Alerts
                {alertStats && alertStats.active > 0 && (
                  <span className='absolute -top-2 -right-2 bg-destructive text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center'>
                    {alertStats.active}
                  </span>
                )}
              </Link>

              {user?.role !== 'viewer' && (
                <button className='flex items-center gap-2 btn-primary' onClick={() => setIsCreateModalOpen(true)}>
                  <Plus className='w-4 h-4' />
                  Create Instance
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className='container mx-auto px-4 sm:px-6 py-6 sm:py-8'>
        {/* Stats Overview */}
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6 mb-8'>
          <div className='glass-card p-6'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>Total Instances</p>
                <p className='text-3xl font-bold mt-1 text-foreground'>{instances?.length || 0}</p>
              </div>
              <div className='w-12 h-12 bg-brand-500/20 rounded-xl flex items-center justify-center'>
                <svg className='w-6 h-6 text-brand-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 12h14M12 5l7 7-7 7' />
                </svg>
              </div>
            </div>
          </div>

          <div className='glass-card p-6'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>Healthy</p>
                <p className='text-3xl font-bold mt-1 text-brand-400'>
                  {instances?.filter((i) => i.health.overall === 'healthy').length || 0}
                </p>
              </div>
              <div className='w-12 h-12 bg-brand-500/20 rounded-xl flex items-center justify-center'>
                <svg className='w-6 h-6 text-brand-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                </svg>
              </div>
            </div>
          </div>

          <div className='glass-card p-6'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm text-muted-foreground'>Total Services</p>
                <p className='text-3xl font-bold mt-1 text-foreground'>
                  {instances?.reduce((sum, i) => sum + i.services.length, 0) || 0}
                </p>
              </div>
              <div className='w-12 h-12 bg-brand-500/20 rounded-xl flex items-center justify-center'>
                <svg className='w-6 h-6 text-brand-400' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
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

        {/* Shared Infrastructure Card */}
        {sharedStatus && (
          <Link to='/shared' className='block mb-8 glass-card p-4 hover:bg-white/5 transition-colors group'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-4'>
                <div className='w-10 h-10 bg-brand-500/20 rounded-xl flex items-center justify-center'>
                  <Cloud className='w-5 h-5 text-brand-400' />
                </div>
                <div>
                  <p className='font-medium flex items-center gap-2'>
                    Shared Infrastructure
                    {sharedStatus.status === 'running' ? (
                      <CheckCircle2 className='w-4 h-4 text-brand-400' />
                    ) : sharedStatus.status === 'degraded' ? (
                      <AlertTriangle className='w-4 h-4 text-yellow-400' />
                    ) : (
                      <XCircle className='w-4 h-4 text-red-400' />
                    )}
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {sharedStatus.runningServices}/{sharedStatus.totalServices} Services
                    {sharedStatus.status === 'running'
                      ? ' — All services active'
                      : sharedStatus.status === 'degraded'
                        ? ' — Partially degraded'
                        : ' — Stopped'}
                  </p>
                </div>
              </div>
              <span className='text-sm text-muted-foreground group-hover:text-foreground transition-colors'>
                Details →
              </span>
            </div>
          </Link>
        )}

        {/* System Overview Charts */}
        {systemMetrics && instances && instances.length > 0 && (
          <div className='bg-card border rounded-lg p-4 sm:p-6 mb-8'>
            <h2 className='text-xl font-semibold mb-6 flex items-center gap-2'>
              <Activity className='w-6 h-6' />
              System Overview
            </h2>

            <div className='grid grid-cols-1 md:grid-cols-3 gap-8'>
              {/* Total CPU Gauge */}
              <div className='flex flex-col items-center'>
                <GaugeChart
                  label='Total CPU Usage'
                  value={systemMetrics.totalCpu}
                  icon={Activity}
                  color='cyan'
                  size='lg'
                />
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
                  value={
                    systemMetrics?.totalMemory && systemMetrics?.hostTotalMemory
                      ? Math.min((systemMetrics.totalMemory / systemMetrics.hostTotalMemory) * 100, 100)
                      : systemMetrics?.totalMemory
                        ? Math.min((systemMetrics.totalMemory / 1024 / 10) * 100, 100)
                        : 0
                  }
                  displayValue={
                    systemMetrics?.totalMemory && systemMetrics?.hostTotalMemory
                      ? `${(systemMetrics.totalMemory / 1024).toFixed(1)} / ${(systemMetrics.hostTotalMemory / 1024).toFixed(0)} GB`
                      : systemMetrics?.totalMemory
                        ? `${(systemMetrics.totalMemory / 1024).toFixed(1)} GB`
                        : '0 GB'
                  }
                  color='pink'
                  size='lg'
                  icon={TrendingUp}
                />
                <div className='mt-4 text-center'>
                  <p className='text-sm text-muted-foreground'>Container RAM usage</p>
                </div>
              </div>

              {/* Disk Gauge */}
              <div className='flex flex-col items-center'>
                <GaugeChart
                  label='Disk Usage'
                  value={
                    systemMetrics?.hostDiskUsed && systemMetrics?.hostDiskTotal
                      ? Math.min((systemMetrics.hostDiskUsed / systemMetrics.hostDiskTotal) * 100, 100)
                      : 0
                  }
                  displayValue={
                    systemMetrics?.hostDiskUsed && systemMetrics?.hostDiskTotal
                      ? `${(systemMetrics.hostDiskUsed / 1024).toFixed(0)} / ${(systemMetrics.hostDiskTotal / 1024).toFixed(0)} GB`
                      : 'N/A'
                  }
                  icon={HardDrive}
                  color='orange'
                  size='lg'
                />
                <div className='mt-4 text-center'>
                  <p className='text-sm text-muted-foreground'>Host disk capacity</p>
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

        {/* Instance Grid – grouped by organisation */}
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
        ) : (() => {
          // Group instances by org
          const groups = new Map<string, { label: string; instances: typeof instances }>();
          instances.forEach((inst) => {
            const key = inst.orgId ?? '__unassigned__';
            const label = inst.orgName ?? (inst.orgId ? inst.orgId : 'Unassigned');
            if (!groups.has(key)) groups.set(key, { label, instances: [] });
            groups.get(key)!.instances.push(inst);
          });
          // Sort: named orgs first, unassigned last
          const sorted = [...groups.entries()].sort(([a], [b]) => {
            if (a === '__unassigned__') return 1;
            if (b === '__unassigned__') return -1;
            return (groups.get(a)!.label).localeCompare(groups.get(b)!.label);
          });
          const multiOrg = sorted.length > 1;
          return (
            <div className='space-y-10'>
              {sorted.map(([key, group]) => (
                <div key={key}>
                  {multiOrg && (
                    <div className='flex items-center gap-2 mb-4'>
                      <Building2 className='w-4 h-4 text-muted-foreground' />
                      <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
                        {group.label}
                      </h2>
                      <span className='text-xs text-muted-foreground/60'>
                        ({group.instances.length})
                      </span>
                      <div className='flex-1 h-px bg-white/5 ml-2' />
                    </div>
                  )}
                  <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
                    {group.instances.map((instance) => (
                      <InstanceCard
                        key={instance.id}
                        instance={instance}
                        isSelected={bulkSelection.isSelected(instance.name)}
                        onToggleSelect={bulkSelection.toggle}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Bulk Action Bar */}
        <BulkActionBar
          selectedInstances={bulkSelection.selectedArray}
          onClearSelection={bulkSelection.clearSelection}
        />
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
