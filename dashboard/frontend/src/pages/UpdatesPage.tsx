import { useState, useRef, useEffect } from 'react';
import {
  useUpdateStatus,
  useCheckUpdates,
  useUpdateMultibase,
  useUpdateDocker,
  useUpdateLogs,
} from '../hooks/useUpdates';
import { DockerServiceInfo } from '../lib/api';
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowUpCircle,
  Container,
  GitBranch,
  Terminal,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const SHARED_SERVICES = [
  'multibase-db',
  'multibase-studio',
  'multibase-analytics',
  'multibase-vector',
  'multibase-imgproxy',
  'multibase-meta',
  'multibase-pooler',
  'multibase-nginx-gateway',
] as const;

function ServiceStatusBadge({ status }: { status: DockerServiceInfo['status'] }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-500/15 text-brand-400">
        <CheckCircle2 className="w-3 h-3" />
        Running
      </span>
    );
  }
  if (status === 'stopped') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/15 text-yellow-400">
        <AlertTriangle className="w-3 h-3" />
        Stopped
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400">
      <XCircle className="w-3 h-3" />
      Not found
    </span>
  );
}

// ──────────────────────────────────────────────
// Live log terminal
// ──────────────────────────────────────────────

function UpdateTerminal({
  logs,
  isRunning,
  completed,
  error,
  steps,
  currentStep,
}: {
  logs: { line: string; ts: number }[];
  isRunning: boolean;
  completed: boolean;
  error: string | null;
  steps: string[];
  currentStep: number;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (!isRunning && !completed && !error && logs.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-white/10 overflow-hidden">
      {/* Step progress */}
      {steps.length > 0 && (
        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center gap-3 flex-wrap">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-1.5 text-xs">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                  i < currentStep
                    ? 'bg-brand-500 text-white'
                    : i === currentStep && isRunning
                      ? 'bg-brand-500/30 border border-brand-500 text-brand-400'
                      : completed && i <= currentStep
                        ? 'bg-brand-500 text-white'
                        : 'bg-white/10 text-muted-foreground'
                }`}
              >
                {i < currentStep || (completed && i <= currentStep) ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : i === currentStep && isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span
                className={
                  i === currentStep
                    ? 'text-foreground font-medium'
                    : i < currentStep
                      ? 'text-brand-400'
                      : 'text-muted-foreground'
                }
              >
                {step}
              </span>
              {i < steps.length - 1 && <span className="text-white/20 ml-1">→</span>}
            </div>
          ))}
        </div>
      )}

      {/* Terminal output */}
      <div className="bg-black/50 p-4 h-56 overflow-y-auto font-mono text-xs">
        {logs.map((entry, i) => (
          <div key={i} className="text-green-300/90 leading-relaxed whitespace-pre-wrap">
            {entry.line}
          </div>
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground mt-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Running...</span>
          </div>
        )}
        {completed && (
          <div className="text-brand-400 font-semibold mt-2">✓ Update completed successfully</div>
        )}
        {error && <div className="text-red-400 mt-2">✗ Error: {error}</div>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────

export default function UpdatesPage() {
  const { data: status, isLoading, error: fetchError, refetch } = useUpdateStatus();
  const checkMutation = useCheckUpdates();
  const multibaseMutation = useUpdateMultibase();
  const dockerMutation = useUpdateDocker();
  const liveState = useUpdateLogs();

  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [confirmMultibase, setConfirmMultibase] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

  const isAnyUpdateRunning =
    liveState.isRunning || multibaseMutation.isPending || dockerMutation.isPending;

  const toggleService = (service: string) => {
    setSelectedServices(prev => {
      const next = new Set(prev);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedServices.size === SHARED_SERVICES.length) {
      setSelectedServices(new Set());
    } else {
      setSelectedServices(new Set(SHARED_SERVICES));
    }
  };

  const handleDockerUpdate = () => {
    const services = selectedServices.size > 0 ? [...selectedServices] : undefined;
    dockerMutation.mutate(services);
  };

  const handleMultibaseUpdate = () => {
    if (!confirmMultibase) {
      setConfirmMultibase(true);
      return;
    }
    setConfirmMultibase(false);
    multibaseMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Failed to load update status</h2>
          <p className="text-muted-foreground mb-4">
            {fetchError instanceof Error ? fetchError.message : 'Connection failed'}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const mb = status?.multibase;
  const dockerServices = status?.docker ?? [];

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <header className="border-b border-white/5 bg-card/30 backdrop-blur-sm sticky top-0 z-20">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-brand-500/20 rounded-xl flex items-center justify-center">
                <ArrowUpCircle className="w-6 h-6 text-brand-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Updates</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Multibase Dashboard &amp; Supabase Docker Images
                </p>
              </div>
            </div>

            <button
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || isAnyUpdateRunning}
              className="btn-secondary flex items-center gap-2 px-4 py-2"
            >
              {checkMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Check for Updates
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8 max-w-5xl">
        {/* ── Section 1: Multibase Dashboard ── */}
        <section className="glass-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <GitBranch className="w-5 h-5 text-brand-400 flex-shrink-0" />
              <div>
                <h2 className="text-lg font-semibold">Multibase Dashboard</h2>
                <p className="text-sm text-muted-foreground">Self-hosted dashboard application</p>
              </div>
            </div>

            {mb?.hasUpdate ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                <ArrowUpCircle className="w-4 h-4" />
                Update available
              </span>
            ) : mb?.latest ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-brand-500/15 text-brand-400">
                <CheckCircle2 className="w-4 h-4" />
                Up to date
              </span>
            ) : mb?.checkedAt ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-white/10 text-muted-foreground">
                <AlertTriangle className="w-4 h-4" />
                No releases found
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-white/10 text-muted-foreground">
                <AlertTriangle className="w-4 h-4" />
                Not checked yet
              </span>
            )}
          </div>

          {/* Version info */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">Current Version</div>
              <div className="text-sm font-mono font-semibold">v{mb?.current ?? '—'}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">Latest Version</div>
              <div className="text-sm font-mono font-semibold">
                {mb?.latest ? `v${mb.latest}` : mb?.checkedAt ? 'Not found' : '—'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">Last Checked</div>
              <div className="text-sm">
                {mb?.checkedAt ? new Date(mb.checkedAt).toLocaleTimeString() : '—'}
              </div>
            </div>
          </div>

          {/* Changelog */}
          {mb?.changelog && (
            <div className="mt-4">
              <button
                onClick={() => setChangelogOpen(v => !v)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {changelogOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                {changelogOpen ? 'Hide' : 'Show'} changelog
              </button>
              {changelogOpen && (
                <pre className="mt-2 p-4 bg-black/30 rounded-lg text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                  {mb.changelog}
                </pre>
              )}
            </div>
          )}

          {/* Split-mode info */}
          {status?.frontendServe === 'split' && (
            <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground">
              <GitBranch className="w-4 h-4 flex-shrink-0 mt-0.5 text-brand-400" />
              <div>
                <span className="text-foreground font-medium">Split-server mode: </span>
                The frontend is deployed independently via CI/CD. Clicking &ldquo;Update
                Multibase&rdquo; will update the backend only (git pull → npm install → pm2
                restart). The frontend will update automatically on the next CI push.
              </div>
            </div>
          )}

          {/* Warning banner */}
          {mb?.hasUpdate && (
            <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Before updating:</strong> Make sure you have a recent backup. The server
                will briefly restart — active sessions will reconnect automatically.
              </div>
            </div>
          )}

          {/* Update button */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleMultibaseUpdate}
              disabled={isAnyUpdateRunning || !mb?.hasUpdate}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                confirmMultibase
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                  : 'btn-primary'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {multibaseMutation.isPending ||
              (liveState.isRunning && liveState.type === 'multibase') ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {confirmMultibase ? 'Confirm Update?' : 'Update Multibase'}
            </button>
            {confirmMultibase && (
              <button
                onClick={() => setConfirmMultibase(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Live terminal */}
          {(liveState.type === 'multibase' || (liveState.logs.length > 0 && !liveState.type)) && (
            <UpdateTerminal
              logs={liveState.logs}
              isRunning={liveState.isRunning}
              completed={liveState.completed}
              error={liveState.error}
              steps={liveState.steps}
              currentStep={liveState.currentStep}
            />
          )}
        </section>

        {/* ── Section 2: Docker Images ── */}
        <section className="glass-card p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <Container className="w-5 h-5 text-brand-400 flex-shrink-0" />
              <div>
                <h2 className="text-lg font-semibold">Supabase Docker Images</h2>
                <p className="text-sm text-muted-foreground">
                  Shared infrastructure container images
                </p>
              </div>
            </div>

            <button
              onClick={handleDockerUpdate}
              disabled={isAnyUpdateRunning || dockerServices.length === 0}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {liveState.isRunning && liveState.type === 'docker' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {selectedServices.size > 0
                ? `Pull ${selectedServices.size} Selected`
                : 'Pull All Latest'}
            </button>
          </div>

          {/* Service table */}
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedServices.size === SHARED_SERVICES.length}
                      onChange={toggleAll}
                      className="rounded border-white/20 bg-white/10 text-brand-500 focus:ring-brand-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Service</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Image</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tag</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dockerServices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No shared services found. Start the shared infrastructure first.
                    </td>
                  </tr>
                ) : (
                  dockerServices.map(svc => (
                    <tr
                      key={svc.service}
                      className={`hover:bg-white/5 transition-colors ${
                        selectedServices.has(svc.service) ? 'bg-brand-500/5' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedServices.has(svc.service)}
                          onChange={() => toggleService(svc.service)}
                          className="rounded border-white/20 bg-white/10 text-brand-500 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{svc.service}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-xs truncate">
                        {svc.image !== 'unknown' ? svc.image : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-white/10 px-2 py-0.5 rounded">
                          {svc.tag}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusBadge status={svc.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Pulling images will briefly stop each service. Make sure no critical operations are
            running. Select individual services or pull all at once.
          </p>

          {/* Live terminal for docker updates */}
          {liveState.type === 'docker' && (
            <UpdateTerminal
              logs={liveState.logs}
              isRunning={liveState.isRunning}
              completed={liveState.completed}
              error={liveState.error}
              steps={liveState.steps}
              currentStep={liveState.currentStep}
            />
          )}
        </section>

        {/* Info box */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground">
          <Terminal className="w-4 h-4 flex-shrink-0 mt-0.5 text-brand-400" />
          <div>
            <span className="text-foreground font-medium">Update Requirements: </span>
            Multibase updates require <code className="text-brand-400">git</code> and{' '}
            <code className="text-brand-400">pm2</code> to be installed on the server. Docker
            updates require the shared infrastructure to be running.
          </div>
        </div>
      </main>
    </div>
  );
}
