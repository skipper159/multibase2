import { Activity, Database, HardDrive, Server, TrendingUp } from 'lucide-react';
import GaugeChart from './charts/GaugeChart';
import type { SharedInfraStatus } from '../types';
import { useSystemMetrics } from '../hooks/useInstances';
import SharedServicesPage from './SharedServicesPage';

interface SharedInfraOverviewProps {
  status: SharedInfraStatus;
}

export default function SharedInfraOverview({ status }: SharedInfraOverviewProps) {
  const { data: systemMetrics } = useSystemMetrics();
  const runningServices = status.services.filter((service) => service.status === 'running');
  const sharedTotalCpu = runningServices.reduce((sum, service) => sum + (service.cpu ?? 0), 0);
  const sharedTotalMemoryMB = runningServices.reduce((sum, service) => sum + (service.memory ?? 0), 0);
  const hostTotalMemoryMB = systemMetrics?.hostTotalMemory ?? 0;
  const memoryPercent = hostTotalMemoryMB > 0 ? Math.min((sharedTotalMemoryMB / hostTotalMemoryMB) * 100, 100) : 0;

  return (
    <div className='space-y-8'>
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6'>
        <SummaryCard label='Services' value={`${status.runningServices}/${status.totalServices}`} icon={Server} />
        <SummaryCard label='Databases' value='Shared cluster' icon={Database} />
        <SummaryCard label='PostgreSQL' value={`:${status.ports?.postgres || '-'}`} icon={HardDrive} />
        <SummaryCard label='Pooler' value={`:${status.ports?.pooler || '-'}`} icon={Activity} />
        <SummaryCard label='HTTP Gateway' value={`:${status.ports?.gateway || '-'}`} icon={Server} />
      </div>

      {runningServices.length > 0 && (
        <div className='bg-card border rounded-lg p-6'>
          <h2 className='text-xl font-semibold mb-6'>Shared Stack Resources</h2>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-8'>
            <GaugeChart
              label='Stack CPU'
              value={Math.min(sharedTotalCpu, 100)}
              displayValue={`${sharedTotalCpu.toFixed(1)}%`}
              icon={Activity}
              color='cyan'
              size='lg'
            />
            <GaugeChart
              label='Stack Memory'
              value={memoryPercent}
              displayValue={
                hostTotalMemoryMB > 0
                  ? `${(sharedTotalMemoryMB / 1024).toFixed(1)} / ${(hostTotalMemoryMB / 1024).toFixed(0)} GB`
                  : `${(sharedTotalMemoryMB / 1024).toFixed(1)} GB`
              }
              icon={TrendingUp}
              color='pink'
              size='lg'
            />
            <GaugeChart
              label='Stack Disk'
              value={
                status.diskUsedMB && systemMetrics?.hostDiskTotal
                  ? Math.min((status.diskUsedMB / systemMetrics.hostDiskTotal) * 100, 100)
                  : status.diskUsedMB
                    ? Math.min((status.diskUsedMB / (200 * 1024)) * 100, 100)
                    : 0
              }
              displayValue={
                status.diskUsedMB != null
                  ? status.diskUsedMB >= 1024
                    ? `${(status.diskUsedMB / 1024).toFixed(1)} GB`
                    : `${status.diskUsedMB} MB`
                  : '—'
              }
              icon={HardDrive}
              color='yellow'
              size='lg'
            />
          </div>
        </div>
      )}

      <SharedServicesPage services={status.services} />
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Server }) {
  return (
    <div className='glass-card p-6'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <p className='text-sm text-muted-foreground'>{label}</p>
          <p className='text-xl font-bold mt-1 text-foreground font-mono'>{value}</p>
        </div>
        <div className='w-12 h-12 bg-brand-500/20 rounded-xl flex items-center justify-center'>
          <Icon className='w-6 h-6 text-brand-400' />
        </div>
      </div>
    </div>
  );
}
