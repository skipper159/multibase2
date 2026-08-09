import { useEffect, useState } from 'react';
import type { SupabaseInstance } from '../types';
import { CheckCircle, XCircle, AlertCircle, RotateCw, Activity, Download, RotateCcw } from 'lucide-react';
import {
  useCheckInstanceImageUpdates,
  useInstanceImageUpdates,
  useRollbackInstanceImages,
  useRestartService,
  useUpdateInstanceImages,
} from '../hooks/useInstances';
import { useUpdateLogs } from '../hooks/useUpdates';
import { UpdateConfirmationModal, UpdateProgressModal } from './UpdateModal';
import { toast } from 'sonner';

interface ServicesTabProps {
  instance: SupabaseInstance;
}

export default function ServicesTab({ instance }: ServicesTabProps) {
  const restartServiceMutation = useRestartService();
  const { data: imageUpdates, isLoading: imageUpdatesLoading } = useInstanceImageUpdates(instance.name);
  const checkImageUpdatesMutation = useCheckInstanceImageUpdates();
  const imageUpdateMutation = useUpdateInstanceImages();
  const imageRollbackMutation = useRollbackInstanceImages();
  const liveState = useUpdateLogs();
  const [selectedImageServices, setSelectedImageServices] = useState<Set<string>>(new Set());
  const [pendingImageUpdates, setPendingImageUpdates] = useState<string[]>([]);
  const [pendingImageMode, setPendingImageMode] = useState<'update' | 'rollback'>('update');
  const [progressOpen, setProgressOpen] = useState(false);

  useEffect(() => {
    if (liveState.completed && liveState.type === 'tenantDocker') {
      checkImageUpdatesMutation.mutate(instance.name);
    }
  // The completion transition is the intended refresh trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveState.completed, liveState.type, instance.name]);

  const availableUpdateServices = imageUpdates?.services
    ?.filter((s) =>
      s.updateAvailable && s.managed && s.updatePolicy !== 'manual' &&
      imageUpdates.securityGate.status === 'ready'
    )
    ?.map((s) => s.service) || [];

  const toggleImageServiceSelect = (serviceName: string) => {
    setSelectedImageServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceName)) next.delete(serviceName);
      else next.add(serviceName);
      return next;
    });
  };

  const handleSingleImageUpdate = (serviceName: string) => {
    setPendingImageMode('update');
    setPendingImageUpdates([serviceName]);
  };

  const handleSingleImageRollback = (serviceName: string) => {
    setPendingImageMode('rollback');
    setPendingImageUpdates([serviceName]);
  };

  const handleBulkImageUpdate = () => {
    const targets = selectedImageServices.size > 0
      ? Array.from(selectedImageServices)
      : availableUpdateServices;
    if (targets.length === 0) return;
    setPendingImageMode('update');
    setPendingImageUpdates(targets);
  };

  const startImageUpdate = async () => {
    if (pendingImageUpdates.length === 0) return;
    const targets = [...pendingImageUpdates];
    setPendingImageUpdates([]);
    const mutation = pendingImageMode === 'rollback' ? imageRollbackMutation : imageUpdateMutation;
    try {
      await mutation.mutateAsync({
        name: instance.name,
        services: targets,
        confirmSafetyGate: true,
        createBackup: true,
      });
      setProgressOpen(true);
      setSelectedImageServices(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the image operation');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-600 bg-green-100';
      case 'unhealthy':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className='w-5 h-5' />;
      case 'unhealthy':
        return <XCircle className='w-5 h-5' />;
      default:
        return <AlertCircle className='w-5 h-5' />;
    }
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const handleRestartService = async (serviceName: string) => {
    if (confirm(`Are you sure you want to restart the ${serviceName} service?`)) {
      await restartServiceMutation.mutateAsync({
        name: instance.name,
        service: serviceName,
      });
    }
  };

  return (
    <div className='space-y-4'>
      {/* Overview */}
      <div className='glass-card p-6'>
        <h2 className='text-lg font-semibold mb-4'>Services Overview</h2>
        <div className='grid grid-cols-3 gap-4'>
          <div>
            <p className='text-sm text-muted-foreground'>Total Services</p>
            <p className='text-2xl font-bold mt-1'>{instance.health.totalServices}</p>
          </div>
          <div>
            <p className='text-sm text-muted-foreground'>Healthy</p>
            <p className='text-2xl font-bold mt-1 text-green-600'>{instance.health.healthyServices}</p>
          </div>
          <div>
            <p className='text-sm text-muted-foreground'>Unhealthy</p>
            <p className='text-2xl font-bold mt-1 text-red-600'>
              {instance.health.totalServices - instance.health.healthyServices}
            </p>
          </div>
        </div>
      </div>

      {/* Services List */}
      <div className='glass-card overflow-hidden'>
        <div className='px-6 py-4 border-b bg-muted/30'>
          <h2 className='text-lg font-semibold'>Services</h2>
        </div>
        <div className='divide-y'>
          {instance.services.map((service) => (
            <div key={service.name} className='p-4 sm:p-6 hover:bg-muted/30 transition-colors'>
              <div className='flex flex-col sm:flex-row sm:items-center gap-4'>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-3'>
                    <Activity className='w-5 h-5 text-primary flex-shrink-0' />
                    <div className='min-w-0'>
                      <h3 className='font-semibold text-lg truncate'>{service.name}</h3>
                      <p className='text-sm text-muted-foreground truncate'>{service.containerName}</p>
                    </div>
                  </div>
                </div>

                <div className='flex items-center gap-4 sm:gap-6 flex-wrap'>
                  {/* Status */}
                  <div>
                    <p className='text-xs text-muted-foreground mb-1'>Status</p>
                    <div
                      className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(service.health)}`}
                    >
                      {getStatusIcon(service.health)}
                      <span className='capitalize'>{service.health}</span>
                    </div>
                  </div>

                  {/* Uptime */}
                  <div>
                    <p className='text-xs text-muted-foreground mb-1'>Uptime</p>
                    <p className='text-sm font-medium'>{formatUptime(service.uptime)}</p>
                  </div>

                  {/* CPU */}
                  <div>
                    <p className='text-xs text-muted-foreground mb-1'>CPU</p>
                    <p className='text-sm font-medium'>{service.cpu.toFixed(1)}%</p>
                  </div>

                  {/* Memory */}
                  <div>
                    <p className='text-xs text-muted-foreground mb-1'>Memory</p>
                    <p className='text-sm font-medium'>{service.memory.toFixed(0)} MB</p>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => handleRestartService(service.name)}
                    disabled={restartServiceMutation.isPending}
                    className='p-2 hover:bg-muted rounded-md transition-colors disabled:opacity-50'
                    title='Restart service'
                  >
                    <RotateCw className={`w-4 h-4 ${restartServiceMutation.isPending ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Instance image updates */}
      <div className='glass-card overflow-hidden'>
        <div className='px-6 py-4 border-b bg-muted/30 flex items-center justify-between gap-4'>
          <div>
            <h2 className='text-lg font-semibold'>Instance Image Updates</h2>
            <p className='text-sm text-muted-foreground mt-1'>
              Manually update Docker images belonging to this instance.
            </p>
          </div>
          <div className='flex items-center gap-3'>
            {availableUpdateServices.length > 0 && (
              <button
                type='button'
                onClick={handleBulkImageUpdate}
                disabled={imageUpdateMutation.isPending || imageRollbackMutation.isPending || imageUpdates?.securityGate.status !== 'ready'}
                className='inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors'
              >
                <Download className='w-4 h-4' />
                {selectedImageServices.size > 0
                  ? `Update ${selectedImageServices.size} Selected`
                  : `Update All Available (${availableUpdateServices.length})`}
              </button>
            )}
            <span className='text-xs text-muted-foreground whitespace-nowrap'>Manual only</span>
            <button
              type='button'
              onClick={() => checkImageUpdatesMutation.mutate(instance.name)}
              disabled={checkImageUpdatesMutation.isPending}
              className='inline-flex items-center gap-2 px-3 py-2 rounded-md bg-muted hover:bg-muted/80 disabled:opacity-50 text-sm'
              title='Check the registry now'
            >
              <RotateCw className={`w-4 h-4 ${checkImageUpdatesMutation.isPending ? 'animate-spin' : ''}`} />
              Check
            </button>
          </div>
        </div>

        {imageUpdates?.securityGate.status === 'blocked' && (
          <div className='px-6 py-3 text-sm text-amber-700 bg-amber-50 border-b border-amber-200'>
            Image updates are disabled until the security gate is approved.
          </div>
        )}

        {imageUpdatesLoading ? (
          <div className='p-6 text-sm text-muted-foreground'>Checking instance images...</div>
        ) : imageUpdates?.services.length ? (
          <div className='divide-y'>
            {imageUpdates.services.map((service) => {
              const canUpdate =
                service.updateAvailable &&
                service.managed &&
                service.updatePolicy !== 'manual' &&
                imageUpdates.securityGate.status === 'ready' &&
                !imageUpdateMutation.isPending &&
                !imageRollbackMutation.isPending;
              const prev = imageUpdates.previousTags?.[service.service];
              const canRollback =
                service.managed &&
                prev &&
                (prev.previousTag !== service.tag ||
                  Boolean(prev.previousDigest && prev.previousDigest !== service.localDigest)) &&
                imageUpdates.securityGate.status === 'ready' &&
                !imageUpdateMutation.isPending &&
                !imageRollbackMutation.isPending;

              const isChecked = selectedImageServices.has(service.service);
              const statusLabel = service.updatePolicy === 'manual'
                ? 'Manual approval required'
                : service.updateStatus === 'registry_unreachable'
                  ? 'Registry unavailable'
                  : !service.managed
                    ? 'Not managed'
                    : service.updateAvailable
                      ? 'Update available'
                      : 'Up to date';
              const statusClass = service.updatePolicy === 'manual' || service.updateAvailable
                ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                : service.updateStatus === 'registry_unreachable' || !service.managed
                  ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                  : 'bg-green-500/10 text-green-500 border border-green-500/20';

              return (
                <div key={service.service} className='p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4'>
                  {canUpdate && (
                    <input
                      type='checkbox'
                      checked={isChecked}
                      onChange={() => toggleImageServiceSelect(service.service)}
                      className='rounded border-border text-primary focus:ring-primary cursor-pointer'
                      title={`Select ${service.service} for update`}
                    />
                  )}
                  <div className='flex-1 min-w-0'>
                    <h3 className='font-semibold truncate'>{service.service}</h3>
                    <p className='text-sm text-muted-foreground truncate'>{service.image}</p>
                    {service.targetTag && service.targetTag !== service.tag && (
                      <p className='text-xs text-amber-600 mt-1'>Target version: {service.targetTag}</p>
                    )}
                  </div>
                  <div className='flex items-center gap-3'>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusClass}`}
                    >
                      {statusLabel}
                    </span>

                    <button
                      type='button'
                      onClick={() => handleSingleImageUpdate(service.service)}
                      disabled={!canUpdate}
                      className='inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium'
                      title={
                        !service.updateAvailable
                          ? 'Latest version is already installed'
                          : service.updatePolicy === 'manual'
                            ? 'This image requires a separate manual approval workflow'
                          : imageUpdates.securityGate.status !== 'ready'
                            ? 'Security gate is blocked'
                            : 'Manually update this image'
                      }
                    >
                      <Download className='w-3.5 h-3.5' />
                      {imageUpdateMutation.isPending && pendingImageUpdates.includes(service.service) ? 'Updating...' : 'Update'}
                    </button>

                    {canRollback && (
                      <button
                        type='button'
                        onClick={() => handleSingleImageRollback(service.service)}
                        className='inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed'
                        title={`Restore ${prev.previousTag}`}
                      >
                        <RotateCcw className='w-3.5 h-3.5' />
                        Rollback ({prev.previousTag})
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className='p-6 text-sm text-muted-foreground'>No instance Docker services found.</div>
        )}
      </div>

      <UpdateConfirmationModal
        open={pendingImageUpdates.length > 0}
        title={
          pendingImageMode === 'rollback'
            ? pendingImageUpdates.length === 1
              ? `Confirm ${pendingImageUpdates[0]} rollback`
              : `Confirm rollback for ${pendingImageUpdates.length} image(s)`
            : pendingImageUpdates.length === 1
              ? `Confirm ${pendingImageUpdates[0]} update`
              : `Confirm update for ${pendingImageUpdates.length} image(s)`
        }
        description={pendingImageMode === 'rollback'
          ? `Restore the recorded previous Docker image for ${instance.name}.`
          : `Update selected Docker image(s) for ${instance.name}.`}
        targets={pendingImageUpdates}
        warning='An instance backup including project files and PostgreSQL dump will be created first. Services may be unavailable briefly.'
        onCancel={() => setPendingImageUpdates([])}
        onConfirm={startImageUpdate}
        isSubmitting={imageUpdateMutation.isPending || imageRollbackMutation.isPending}
      />
      <UpdateProgressModal
        open={progressOpen}
        state={liveState}
        onClose={() => {
          setProgressOpen(false);
          liveState.clearLogs();
        }}
      />
    </div>
  );
}
