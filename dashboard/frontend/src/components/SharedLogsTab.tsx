import { useEffect, useRef, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { useSharedLogs } from '../hooks/useShared';
import { useWebSocket } from '../hooks/useWebSocket';
import type { SharedServiceStatus } from '../types';

interface SharedLogsTabProps {
  services: SharedServiceStatus[];
}

export default function SharedLogsTab({ services }: SharedLogsTabProps) {
  const [selectedService, setSelectedService] = useState('');
  const [logsEnabled, setLogsEnabled] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const { data: fetchedLogs, isFetching, refetch } = useSharedLogs(selectedService || undefined, 500, logsEnabled);
  const { subscribeLogs, unsubscribeLogs, onLogs, offLogs } = useWebSocket();

  useEffect(() => {
    if (logsEnabled && fetchedLogs?.logs) {
      setLogs(fetchedLogs.logs.slice(-500));
    }
  }, [fetchedLogs, logsEnabled]);

  useEffect(() => {
    if (!logsEnabled) return;

    subscribeLogs('shared-infrastructure', selectedService || undefined);

    const handleLogData = (data: any) => {
      if (data.instanceName !== 'shared-infrastructure') return;
      const payload = data.data ?? data.logs ?? '';
      if (typeof payload === 'string') {
        setLogs((previous) => [...previous, ...payload.split('\n').filter(Boolean)].slice(-500));
      }
    };

    onLogs(handleLogData);
    return () => {
      offLogs(handleLogData);
      unsubscribeLogs();
    };
  }, [selectedService, logsEnabled]);

  useEffect(() => {
    if (autoScroll) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoScroll]);

  const handleFetchLogs = () => {
    setLogsEnabled(true);
    refetch();
  };

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shared-${selectedService || 'all'}-logs.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className='space-y-4'>
      <div className='glass-card p-4'>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex items-center gap-4 flex-1'>
            <select
              value={selectedService}
              onChange={(event) => {
                const val = event.target.value;
                setSelectedService(val);
                setLogs([]);
                if (val) {
                  setLogsEnabled(true);
                }
              }}
              className='px-4 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary'
            >
              <option value=''>Select Service (or All)</option>
              {services.map((service) => (
                <option key={service.name} value={service.name}>
                  {service.name}
                </option>
              ))}
            </select>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
                className='rounded border-gray-300'
              />
              Auto-scroll
            </label>
          </div>
          <div className='flex items-center gap-2'>
            {!logsEnabled ? (
              <button
                onClick={handleFetchLogs}
                className='flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors'
              >
                <FileText className='w-4 h-4' />
                Load Logs
              </button>
            ) : (
              <button
                onClick={handleFetchLogs}
                disabled={isFetching}
                className='flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50'
              >
                <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            <button onClick={() => setLogs([])} className='px-4 py-2 bg-muted hover:bg-muted/80 rounded-md transition-colors'>
              Clear
            </button>
            <button
              onClick={handleDownload}
              disabled={logs.length === 0}
              className='flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50'
            >
              <Download className='w-4 h-4' />
              Download
            </button>
          </div>
        </div>
      </div>

      <div className='glass-card overflow-hidden'>
        <div className='px-4 py-3 border-b bg-muted/30 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <FileText className='w-4 h-4' />
            <span className='font-medium'>{selectedService || 'All Shared Services'} Logs</span>
            <span className='text-sm text-muted-foreground'>({logs.length} lines)</span>
          </div>
          {logsEnabled && (
            <button
              onClick={() => setLogsEnabled(false)}
              className='text-xs text-muted-foreground hover:text-foreground underline'
            >
              Pause Stream
            </button>
          )}
        </div>
        <div className='h-[600px] overflow-y-auto bg-black/95 text-green-400 font-mono text-sm'>
          <div className='p-4'>
            {!logsEnabled && logs.length === 0 ? (
              <div className='text-muted-foreground text-center py-16 space-y-3'>
                <p>Logs are paused to prevent unnecessary background traffic.</p>
                <button
                  onClick={handleFetchLogs}
                  className='px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors'
                >
                  Load Logs On-Demand
                </button>
              </div>
            ) : logs.length === 0 ? (
              <div className='text-muted-foreground text-center py-12'>
                No logs available for this selection.
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={`${index}-${log}`} className='hover:bg-white/5 px-2 py-1'>
                  <span className='text-gray-500 mr-4'>{index + 1}</span>
                  {log}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
