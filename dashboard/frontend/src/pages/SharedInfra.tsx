import { useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  FileText,
  LayoutDashboard,
  Loader2,
  Play,
  RefreshCw,
  Square,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  useSharedStatus,
  useStartSharedInfra,
  useStopSharedInfra,
} from '../hooks/useShared';
import SharedInfraOverview from '../components/SharedInfraOverview';
import SharedLogsTab from '../components/SharedLogsTab';
import SharedDatabasesPage from '../components/SharedDatabasesPage';

const tabs = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/shared' },
  { key: 'logs', label: 'Logs', icon: FileText, path: '/shared/logs' },
  { key: 'databases', label: 'Databases', icon: Database, path: '/shared/databases' },
] as const;

type SharedSection = (typeof tabs)[number]['key'];

export default function SharedInfra() {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const activeSection: SharedSection = tabs.some((tab) => tab.key === section)
    ? (section as SharedSection)
    : 'overview';
  const { data: status, isLoading, error, refetch } = useSharedStatus();
  const startMutation = useStartSharedInfra();
  const stopMutation = useStopSharedInfra();
  const [confirmStop, setConfirmStop] = useState(false);

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <Loader2 className='w-8 h-8 animate-spin text-primary' />
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-center'>
          <AlertCircle className='w-12 h-12 text-destructive mx-auto mb-4' />
          <h2 className='text-xl font-semibold mb-2'>Shared Infrastructure unreachable</h2>
          <p className='text-muted-foreground mb-4'>{error instanceof Error ? error.message : 'Connection failed'}</p>
          <button
            onClick={() => refetch()}
            className='px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90'
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const statusColor =
    status.status === 'running' ? 'text-brand-400' : status.status === 'degraded' ? 'text-yellow-400' : 'text-red-400';
  const StatusIcon = status.status === 'running' ? CheckCircle2 : status.status === 'degraded' ? AlertTriangle : XCircle;

  return (
    <div className='min-h-screen'>
      <header className='border-b border-white/5 bg-card/30 backdrop-blur-sm sticky top-0 z-20'>
        <div className='px-8 py-6'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div className='w-12 h-12 bg-brand-500/20 rounded-xl flex items-center justify-center'>
                <Cloud className='w-6 h-6 text-brand-400' />
              </div>
              <div>
                <h1 className='text-2xl font-bold text-foreground'>Shared Infrastructure</h1>
                <div className='flex items-center gap-2 mt-1'>
                  <StatusIcon className={`w-4 h-4 ${statusColor}`} />
                  <span className={`text-sm font-medium ${statusColor}`}>
                    {status.status === 'running' ? 'Running' : status.status === 'degraded' ? 'Degraded' : 'Stopped'}
                  </span>
                  <span className='text-muted-foreground text-sm'>
                    — {status.runningServices || 0}/{status.totalServices || 0} Services
                  </span>
                </div>
              </div>
            </div>

            <div className='flex items-center gap-3'>
              <button onClick={() => refetch()} className='btn-secondary flex items-center gap-2 px-4 py-2'>
                <RefreshCw className='w-4 h-4' />
                Refresh
              </button>
              {status.status === 'running' || status.status === 'degraded' ? (
                <button
                  onClick={() => {
                    if (confirmStop) {
                      stopMutation.mutate();
                      setConfirmStop(false);
                    } else {
                      setConfirmStop(true);
                    }
                  }}
                  disabled={stopMutation.isPending}
                  className='flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors'
                >
                  {stopMutation.isPending ? <Loader2 className='w-4 h-4 animate-spin' /> : <Square className='w-4 h-4' />}
                  {confirmStop ? 'Confirm stop?' : 'Stop'}
                </button>
              ) : (
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className='btn-primary flex items-center gap-2 px-4 py-2'
                >
                  {startMutation.isPending ? <Loader2 className='w-4 h-4 animate-spin' /> : <Play className='w-4 h-4' />}
                  Start
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className='container mx-auto px-6 py-8'>
        <nav className='flex items-center gap-1 border-b border-border mb-8 overflow-x-auto' aria-label='Shared Infrastructure sections'>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeSection;
            return (
              <button
                key={tab.key}
                onClick={() => navigate(tab.path)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className='w-4 h-4' />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeSection === 'overview' && <SharedInfraOverview status={status} />}
        {activeSection === 'logs' && <SharedLogsTab services={status.services} />}
        {activeSection === 'databases' && <SharedDatabasesPage />}
      </main>
    </div>
  );
}
