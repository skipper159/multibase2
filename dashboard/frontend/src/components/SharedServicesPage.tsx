import { useState } from 'react';
import { Activity, AlertTriangle, CircleDot, Cpu, HardDrive, Loader2, RotateCw, Server, X } from 'lucide-react';
import type { SharedServiceStatus } from '../types';
import { useRestartSharedService } from '../hooks/useShared';

interface SharedServicesPageProps {
  services: SharedServiceStatus[];
}

export const serviceLabels: Record<string, string> = {
  db: 'PostgreSQL',
  studio: 'Studio',
  analytics: 'Analytics / Logflare',
  vector: 'Vector Log Collector',
  imgproxy: 'imgproxy',
  meta: 'Postgres Meta',
  pooler: 'Pooler / Supavisor',
  'nginx-gateway': 'Nginx Gateway',
  'docker-proxy': 'Docker Socket Proxy',
  'docker_proxy': 'Docker Socket Proxy',
  'multibase-docker-proxy': 'Docker Socket Proxy',
  dockerproxy: 'Docker Socket Proxy',
};

const serviceDescriptions: Record<string, string> = {
  db: 'Central PostgreSQL cluster for all instance databases and Supabase system data.',
  studio: 'Supabase Studio for managing and monitoring shared projects.',
  analytics: 'Logflare service for centralized Supabase and container logs.',
  vector: 'Collects and processes Docker logs for centralized forwarding.',
  imgproxy: 'Image proxy for transforming and serving Storage images.',
  meta: 'Postgres Meta API for schema, table, and database information in Studio.',
  pooler: 'Supavisor/PgBouncer for connection pooling and efficient database connections.',
  'nginx-gateway': 'Central HTTP gateway for API and Storage requests from instance projects.',
  'docker-proxy': 'Secures access to the host Docker daemon via a restricted TCP proxy on 127.0.0.1:2378.',
  'docker_proxy': 'Secures access to the host Docker daemon via a restricted TCP proxy on 127.0.0.1:2378.',
  'multibase-docker-proxy': 'Secures access to the host Docker daemon via a restricted TCP proxy on 127.0.0.1:2378.',
  dockerproxy: 'Secures access to the host Docker daemon via a restricted TCP proxy on 127.0.0.1:2378.',
};

export default function SharedServicesPage({ services }: SharedServicesPageProps) {
  const restartMutation = useRestartSharedService();
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [restartTarget, setRestartTarget] = useState<string | null>(null);

  const handleConfirmRestart = async () => {
    if (!restartTarget) return;

    setRestartingService(restartTarget);
    try {
      await restartMutation.mutateAsync(restartTarget);
      setRestartTarget(null);
    } finally {
      setRestartingService(null);
    }
  };

  const targetService = services.find((service) => service.name === restartTarget);

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-xl font-semibold'>Shared Services</h2>
        <p className='text-sm text-muted-foreground mt-1'>Health, resource usage and network endpoints for the shared stack.</p>
      </div>

      <div className='grid grid-cols-1 xl:grid-cols-2 gap-5'>
        {services.map((service) => {
          const isRunning = service.status === 'running';
          const isHealthy = service.health === 'healthy';
          return (
            <article key={service.name} className='bg-card border rounded-lg p-5'>
              <div className='flex items-start justify-between gap-4 mb-4'>
                <div className='flex items-center gap-3'>
                  <div className='w-10 h-10 rounded-lg bg-brand-500/15 flex items-center justify-center'>
                    <Server className='w-5 h-5 text-brand-400' />
                  </div>
                  <div>
                    <h3 className='font-semibold'>{serviceLabels[service.name] || service.name}</h3>
                    <p className='text-xs text-muted-foreground font-mono'>{service.containerName || `multibase-${service.name}`}</p>
                    <p className='text-sm text-muted-foreground mt-2 max-w-xl'>
                      {serviceDescriptions[service.name] || 'Shared service of the central infrastructure.'}
                    </p>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      isRunning
                        ? isHealthy
                          ? 'bg-brand-500/20 text-brand-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    <CircleDot className='w-3 h-3' />
                    {isRunning ? (isHealthy ? 'Healthy' : 'Running') : 'Stopped'}
                  </span>
                  <button
                    onClick={() => setRestartTarget(service.name)}
                    disabled={restartingService !== null}
                    className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-yellow-500/30 bg-yellow-500/15 text-xs text-yellow-300 hover:bg-yellow-500/25 hover:text-yellow-200 transition-colors disabled:opacity-50'
                    title='Restart shared container'
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${restartingService === service.name ? 'animate-spin' : ''}`} />
                    Restart
                  </button>
                </div>
              </div>

              <div className='grid grid-cols-2 gap-3 mb-5'>
                <Metric icon={Cpu} label='CPU' value={`${(service.cpu ?? 0).toFixed(1)}%`} />
                <Metric icon={HardDrive} label='Memory' value={`${(service.memory ?? 0).toFixed(0)} MB`} />
              </div>

              <div className='border-t border-border pt-4'>
                <div className='flex items-center gap-2 mb-3'>
                  <Activity className='w-4 h-4 text-muted-foreground' />
                  <h4 className='text-sm font-medium'>Ports</h4>
                </div>
                {service.ports && service.ports.length > 0 ? (
                  <div className='space-y-2'>
                    {service.ports.map((port) => (
                      <div key={`${port.label}-${port.container}`} className='flex items-center justify-between gap-3 text-sm'>
                        <span className='text-muted-foreground'>{port.label}</span>
                        <span className='font-mono text-right'>
                          {port.public && port.host ? `localhost:${port.host}` : `internal:${port.container}`}
                          <span className='ml-2 text-xs text-muted-foreground uppercase'>{port.protocol}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground'>No exposed port configured.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {targetService && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4'
          role='presentation'
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !restartingService) setRestartTarget(null);
          }}
        >
          <div
            className='w-full max-w-md rounded-xl border border-white/10 bg-card shadow-2xl'
            role='dialog'
            aria-modal='true'
            aria-labelledby='restart-shared-service-title'
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className='flex items-start justify-between gap-4 border-b border-border px-6 py-5'>
              <div className='flex items-start gap-3'>
                <div className='mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15'>
                  <AlertTriangle className='h-5 w-5 text-yellow-400' />
                </div>
                <div>
                  <h3 id='restart-shared-service-title' className='text-lg font-semibold'>
                    Restart shared service?
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    The service will be briefly unavailable while its container restarts.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRestartTarget(null)}
                disabled={restartingService !== null}
                className='rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50'
                aria-label='Close restart dialog'
              >
                <X className='h-5 w-5' />
              </button>
            </div>

            <div className='px-6 py-5'>
              <div className='rounded-lg border border-border bg-muted/30 px-4 py-3'>
                <p className='font-medium'>{serviceLabels[targetService.name] || targetService.name}</p>
                <p className='mt-1 text-xs text-muted-foreground font-mono'>
                  {targetService.containerName || `multibase-${targetService.name}`}
                </p>
              </div>
              <p className='mt-4 text-sm text-muted-foreground'>
                Existing connections to this container may be interrupted. Other Shared Services remain untouched.
              </p>
            </div>

            <div className='flex justify-end gap-3 border-t border-border px-6 py-4'>
              <button
                onClick={() => setRestartTarget(null)}
                disabled={restartingService !== null}
                className='rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50'
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestart}
                disabled={restartingService !== null}
                className='inline-flex items-center gap-2 rounded-md bg-yellow-500/20 px-4 py-2 text-sm font-medium text-yellow-300 hover:bg-yellow-500/30 disabled:opacity-50'
              >
                {restartingService === targetService.name ? <Loader2 className='h-4 w-4 animate-spin' /> : <RotateCw className='h-4 w-4' />}
                {restartingService === targetService.name ? 'Restarting…' : 'Restart container'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className='rounded-md bg-muted/30 px-3 py-2'>
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <Icon className='w-3.5 h-3.5' />
        {label}
      </div>
      <p className='font-mono text-sm mt-1'>{value}</p>
    </div>
  );
}
