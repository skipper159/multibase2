import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { realtimeApi } from '../../lib/api';
import { toast } from 'sonner';
import { Radio, Copy, Check, RefreshCw } from 'lucide-react';

interface RealtimePanelProps {
  instanceName: string;
}

export default function RealtimePanel({ instanceName }: RealtimePanelProps) {
  const queryClient = useQueryClient();
  const [maxUsers, setMaxUsers] = useState<number>(200);
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['realtime-config', instanceName],
    queryFn: () => realtimeApi.getConfig(instanceName),
    refetchInterval: 15000,
  });

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['realtime-stats', instanceName],
    queryFn: () => realtimeApi.getStats(instanceName),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (config) {
      setMaxUsers(config.maxConcurrentUsers);
      setDirty(false);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () => realtimeApi.updateConfig(instanceName, { maxConcurrentUsers: maxUsers }),
    onSuccess: () => {
      toast.success('Realtime config saved — container restarting (~5s)');
      setDirty(false);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['realtime-config', instanceName] });
        queryClient.invalidateQueries({ queryKey: ['realtime-stats', instanceName] });
      }, 6000);
    },
    onError: (err: any) => toast.error('Save failed', { description: err.message }),
  });

  const snippet =
    config?.apiUrl && config?.anonKey
      ? `import { createClient } from '@supabase/supabase-js'

const supabase = createClient('${config.apiUrl}', '${config.anonKey}')

const channel = supabase.channel('my-channel')
channel
  .on('broadcast', { event: 'test' }, (payload) => console.log(payload))
  .subscribe()

// Send a message
channel.send({ type: 'broadcast', event: 'test', payload: { hello: 'world' } })`
      : `// Load instance first to get API URL and Anon Key`;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColor =
    stats?.status === 'running'
      ? 'bg-green-500'
      : 'bg-gray-500';

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='p-2 rounded-lg bg-brand-500/10'>
          <Radio className='w-5 h-5 text-brand-400' />
        </div>
        <div>
          <h2 className='text-lg font-semibold'>Realtime</h2>
          <p className='text-sm text-muted-foreground'>
            Broadcast, Presence &amp; DB Change events (Elixir/Phoenix)
          </p>
        </div>
      </div>

      {/* Status + Config row */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        {/* Service Status */}
        <div className='glass-card p-4 space-y-3'>
          <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            Service Status
          </h3>
          {loadingConfig ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <RefreshCw className='w-4 h-4 animate-spin' /> Loading…
            </div>
          ) : (
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
                <span className='text-sm font-medium'>
                  {stats?.status === 'running' ? 'Running' : 'Stopped'}
                </span>
              </div>
              <div className='text-sm text-muted-foreground'>
                Instance ID:{' '}
                <span className='font-mono text-foreground'>
                  {config?.tenantId ?? '—'}
                </span>
              </div>
              <div className='text-sm text-muted-foreground'>
                JWT Secret:{' '}
                <span className={config?.jwtSecretSet ? 'text-green-400' : 'text-red-400'}>
                  {config?.jwtSecretSet ? 'Configured' : 'Not set'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Configuration */}
        <div className='glass-card p-4 space-y-3'>
          <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            Configuration
          </h3>
          <div className='space-y-1'>
            <label className='text-sm font-medium'>Max Concurrent Users</label>
            <input
              type='number'
              min={10}
              max={10000}
              value={maxUsers}
              onChange={(e) => {
                setMaxUsers(parseInt(e.target.value, 10) || 200);
                setDirty(true);
              }}
              className='w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'
            />
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
            className='w-full px-3 py-1.5 bg-brand-500 text-white rounded-md text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors'
          >
            {saveMutation.isPending ? 'Saving…' : 'Save & Restart Container'}
          </button>
          <p className='text-xs text-muted-foreground'>
            ⚠ Changing this setting restarts the Realtime container (~5s downtime)
          </p>
        </div>
      </div>

      {/* Live Stats */}
      <div className='glass-card p-4'>
        <div className='flex items-center justify-between mb-3'>
          <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            Live Stats
          </h3>
          {loadingStats && <RefreshCw className='w-3.5 h-3.5 animate-spin text-muted-foreground' />}
        </div>
        <div className='grid grid-cols-3 gap-4'>
          <div className='text-center'>
            <p className='text-2xl font-bold text-brand-400'>
              {stats?.channelCount ?? '—'}
            </p>
            <p className='text-xs text-muted-foreground mt-0.5'>Active Channels</p>
          </div>
          <div className='text-center'>
            <p className='text-2xl font-bold text-blue-400'>
              {stats?.cpu != null ? `${stats.cpu.toFixed(1)}%` : '—'}
            </p>
            <p className='text-xs text-muted-foreground mt-0.5'>CPU</p>
          </div>
          <div className='text-center'>
            <p className='text-2xl font-bold text-purple-400'>
              {stats?.memory != null ? `${stats.memory.toFixed(0)} MB` : '—'}
            </p>
            <p className='text-xs text-muted-foreground mt-0.5'>Memory</p>
          </div>
        </div>
      </div>

      {/* Quick Connect */}
      <div className='glass-card p-4'>
        <div className='flex items-center justify-between mb-3'>
          <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            Quick Connect (JavaScript)
          </h3>
          <button
            onClick={handleCopy}
            className='flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors'
          >
            {copied ? (
              <Check className='w-3.5 h-3.5 text-green-400' />
            ) : (
              <Copy className='w-3.5 h-3.5' />
            )}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className='text-xs font-mono bg-black/30 rounded-md p-3 overflow-x-auto text-green-300 whitespace-pre-wrap'>
          {snippet}
        </pre>
        <p className='text-xs text-muted-foreground mt-2'>
          Install:{' '}
          <span className='font-mono'>npm install @supabase/supabase-js</span>
        </p>
      </div>
    </div>
  );
}
