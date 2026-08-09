import { useState, useRef, useEffect, useCallback } from 'react';
import {
  useUpdateStatus,
  useCheckUpdates,
  useUpdateMultibase,
  useUpdateDocker,
  useUpdatePostgres,
  useUpdateLogs,
} from '../hooks/useUpdates';
import { DockerServiceInfo } from '../lib/api';
import { UpdateConfirmationModal, UpdateProgressModal } from '../components/UpdateModal';
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
  Tag,
} from 'lucide-react';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

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

function ImageUpdateBadge({ service }: { service: DockerServiceInfo }) {
  const labels: Record<DockerServiceInfo['updateStatus'], string> = {
    current: 'Up to date',
    update_available: 'Update available',
    tag_outdated: 'Tag outdated',
    digest_mismatch: 'Digest mismatch',
    registry_unreachable: 'Registry unavailable',
    not_managed: 'Not managed',
    manual_approval_required: 'Manual approval required',
    missing: 'Not found',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        service.updateStatus === 'current'
          ? 'bg-brand-500/15 text-brand-400'
          : service.risk === 'high'
            ? 'bg-red-500/15 text-red-400'
            : 'bg-yellow-500/15 text-yellow-400'
      }`}
    >
      {labels[service.updateStatus]}
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
  const postgresMutation = useUpdatePostgres();
  const liveState = useUpdateLogs();

  useEffect(() => {
    if (liveState.completed && (liveState.type === 'docker' || liveState.type === 'tenantDocker')) {
      refetch();
    }
  }, [liveState.completed, liveState.type, refetch]);

  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null); // null = latest
  const [releasePickerOpen, setReleasePickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<{
    type: 'multibase' | 'docker' | 'postgres';
    title: string;
    description: string;
    targets: string[];
    targetVersion?: string;
    warning?: string;
    requiresText?: string;
  } | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);

  const openReleasePicker = useCallback(() => {
    if (pickerBtnRef.current) {
      const rect = pickerBtnRef.current.getBoundingClientRect();
      setPickerAnchor({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    setReleasePickerOpen(true);
  }, []);

  const closeReleasePicker = useCallback(() => {
    setReleasePickerOpen(false);
    setPickerAnchor(null);
  }, []);

  const toggleReleasePicker = useCallback(() => {
    if (releasePickerOpen) {
      closeReleasePicker();
    } else {
      openReleasePicker();
    }
  }, [releasePickerOpen, openReleasePicker, closeReleasePicker]);

  const isAnyUpdateRunning =
    liveState.isRunning || multibaseMutation.isPending || dockerMutation.isPending || postgresMutation.isPending;
  const dockerServices = (status?.docker ?? []).filter(service => service.category === 'shared');
  const selectableServices = dockerServices
    .filter(service =>
      service.service !== 'multibase-db' && service.managed &&
      service.updatePolicy !== 'manual' && service.updateAvailable
    )
    .map(service => service.service);
  const postgresService = dockerServices.find(service => service.service === 'multibase-db');

  const toggleService = (service: string) => {
    setSelectedServices(prev => {
      const next = new Set(prev);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedServices.size === selectableServices.length) {
      setSelectedServices(new Set());
    } else {
      setSelectedServices(new Set(selectableServices));
    }
  };

  const handleDockerUpdate = () => {
    const services = selectedServices.size > 0 ? [...selectedServices] : undefined;
    const targetServices = services ?? selectableServices;
    if (targetServices.length === 0) return;
    setConfirmation({
      type: 'docker',
      title: 'Confirm shared image update',
      description: `Update ${targetServices.length} shared Docker image(s) manually.`,
      targets: targetServices,
    });
  };

  const handleSingleDockerUpdate = (service: DockerServiceInfo) => {
    if (!selectableServices.includes(service.service as (typeof selectableServices)[number])) return;
    setConfirmation({
      type: 'docker',
      title: `Confirm ${service.service} update`,
      description: 'Update this shared Docker image manually.',
      targets: [service.service],
    });
  };

  const handleMultibaseUpdate = (versionOverride?: string) => {
    const ver = versionOverride ?? selectedVersion ?? undefined;
    setConfirmation({
      type: 'multibase',
      title: ver ? `Switch to Multibase v${ver}` : 'Confirm Multibase update',
      description: ver
        ? `Install release v${ver}. The backend will restart after the update.`
        : 'Update the Multibase dashboard to the latest release.',
      targets: ['Multibase Dashboard'],
      targetVersion: ver,
      warning: 'The backend may restart and the connection can briefly drop. No Docker image backup is created for this application update.',
    });
  };

  const handlePostgresUpdate = () => {
    if (!postgresService) return;
    setConfirmation({
      type: 'postgres',
      title: 'Manual PostgreSQL image update',
      description: 'This is a high-risk infrastructure update and requires explicit confirmation.',
      targets: ['multibase-db'],
      warning: 'A full backup will be created first. PostgreSQL will be stopped briefly, and shared services may be affected if rollback is required.',
      requiresText: 'UPDATE POSTGRESQL',
    });
  };

  const startConfirmedUpdate = () => {
    if (!confirmation) return;
    const action = confirmation.type;
    const targets = confirmation.targets;
    const targetVersion = confirmation.targetVersion;
    setConfirmation(null);
    setProgressOpen(true);
    if (action === 'multibase') {
      multibaseMutation.mutate(targetVersion);
    } else if (action === 'postgres') {
      postgresMutation.mutate({ confirmSafetyGate: true, confirmPostgres: true, createBackup: true });
    } else {
      dockerMutation.mutate({ services: targets, confirmSafetyGate: true, createBackup: true });
    }
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
                {status?.frontendRsync
                  ? 'Frontend will be built and deployed to the frontend server automatically as part of this update.'
                  : 'No frontend server configured — frontend updates via CI/CD only. Set VPS1_HOST, VPS1_USER, VPS1_KEY and VPS1_FRONTEND_PATH to enable automatic frontend deploy.'}
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

          {/* Version picker + Update button */}
          {(() => {
            const releases = mb?.availableReleases ?? [];
            const isRunningMultibase = multibaseMutation.isPending || (liveState.isRunning && liveState.type === 'multibase');
            const effectiveVersion = selectedVersion ?? releases.find(r => r.isLatest)?.version ?? mb?.latest;
            return (
              <div className="mt-4 flex flex-col gap-3">
                {/* Release picker row */}
                {releases.length > 0 && (
                  <div className="flex items-center gap-3">
                    <button
                      ref={pickerBtnRef}
                      type="button"
                      id="release-picker-btn"
                      disabled={isRunningMultibase || isAnyUpdateRunning}
                      onClick={toggleReleasePicker}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Tag className="w-4 h-4 text-muted-foreground" />
                      <span className="font-mono">
                        {effectiveVersion ? `v${effectiveVersion}` : 'Select version'}
                      </span>
                      {releases.find(r => r.version === effectiveVersion)?.isLatest && (
                        <span className="text-xs text-brand-400 bg-brand-500/15 px-1.5 py-0.5 rounded-full">Latest</span>
                      )}
                      {!selectedVersion && <span className="text-xs text-muted-foreground">(auto)</span>}
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>

                    {/* Fixed-position dropdown – escapes backdrop-blur stacking context */}
                    {releasePickerOpen && pickerAnchor && (
                      <>
                        {/* Invisible backdrop to close picker */}
                        <div
                          className="fixed inset-0 z-[9998]"
                          onClick={closeReleasePicker}
                        />
                        <div
                          className="fixed z-[9999] w-72 rounded-xl border border-white/10 bg-[#111] shadow-2xl overflow-hidden"
                          style={{ top: pickerAnchor.top, left: pickerAnchor.left }}
                        >
                          {/* Latest option */}
                          <button
                            type="button"
                            onClick={() => { setSelectedVersion(null); closeReleasePicker(); }}
                            className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors ${
                              !selectedVersion ? 'text-brand-400' : 'text-foreground'
                            }`}
                          >
                            <span className="font-mono font-semibold">Latest (auto)</span>
                            <span className="text-xs text-muted-foreground">always newest</span>
                          </button>
                          <div className="h-px bg-white/10 mx-2" />
                          {releases.map(rel => (
                            <button
                              key={rel.version}
                              type="button"
                              onClick={() => { setSelectedVersion(rel.version); closeReleasePicker(); }}
                              className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors ${
                                selectedVersion === rel.version ? 'text-brand-400' : 'text-foreground'
                              }`}
                            >
                              <span className="font-mono font-semibold">v{rel.version}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                {rel.isLatest && (
                                  <span className="text-xs text-brand-400 bg-brand-500/15 px-1.5 py-0.5 rounded-full">Latest</span>
                                )}
                                {rel.version === mb?.current && (
                                  <span className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full">Installed</span>
                                )}
                                {rel.publishedAt && (
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(rel.publishedAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Main action button */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleMultibaseUpdate()}
                    disabled={isAnyUpdateRunning || (
                      !selectedVersion && !mb?.hasUpdate
                    )}
                    className='btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
                  >
                    {isRunningMultibase ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {selectedVersion
                      ? `Install v${selectedVersion}`
                      : 'Update to Latest'}
                  </button>
                </div>
              </div>
            );
          })()}

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
              disabled={
                isAnyUpdateRunning ||
                selectableServices.length === 0 ||
                status?.securityGate.status !== 'ready'
              }
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {liveState.isRunning && liveState.type === 'docker' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {selectedServices.size > 0
                ? `Update ${selectedServices.size} Selected`
                : `Update All Available (${selectableServices.length})`}
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
                      checked={selectableServices.length > 0 && selectedServices.size === selectableServices.length}
                      onChange={toggleAll}
                      className="rounded border-white/20 bg-white/10 text-brand-500 focus:ring-brand-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Service</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Image / Tag</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Digests</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dockerServices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
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
                          disabled={!selectableServices.includes(svc.service as (typeof selectableServices)[number])}
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
                        <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                          local: {svc.localDigest?.slice(0, 19) || '—'}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          registry: {svc.registryDigest?.slice(0, 19) || '—'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Target: {svc.targetTag || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusBadge status={svc.status} />
                        <div className="mt-1">
                          <ImageUpdateBadge service={svc} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSingleDockerUpdate(svc)}
                          disabled={
                            isAnyUpdateRunning ||
                            status?.securityGate.status !== 'ready' ||
                            !svc.updateAvailable ||
                            !selectableServices.includes(svc.service as (typeof selectableServices)[number])
                          }
                          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            !svc.managed
                              ? 'This image is not managed by the shared update workflow'
                              : svc.updateAvailable
                                ? 'Manually update this image'
                                : 'No update is available'
                          }
                        >
                          {dockerMutation.isPending && liveState.type === 'docker' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          Update
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Registry check: {status?.registry.checkedAt ? new Date(status.registry.checkedAt).toLocaleString() : 'unavailable'}
            {' · '}Manual checks bypass the cache. PostgreSQL requires the dedicated confirmation workflow below.
          </p>
          {status?.securityGate.status === 'blocked' && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
              <strong>Security gate blocked:</strong> {status.securityGate.reason}
            </div>
          )}

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

        {/* PostgreSQL requires its own explicit approval */}
        <section className='glass-card p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <h2 className='text-lg font-semibold'>PostgreSQL Image</h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                PostgreSQL is excluded from bulk image updates and can only be updated through this dedicated workflow.
              </p>
            </div>
            <span className='rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300'>High risk</span>
          </div>

          <div className='mt-4 flex flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <p className='font-mono text-sm'>multibase-db</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {postgresService?.image || 'Image status unavailable'}
                {' · '}
                {postgresService?.updateStatus === 'manual_approval_required'
                  ? 'Manual approval required'
                  : postgresService?.updateAvailable
                    ? 'Update available'
                    : 'No update available'}
              </p>
            </div>
            <button
              type='button'
              onClick={handlePostgresUpdate}
              disabled={
                isAnyUpdateRunning ||
                !postgresService?.updateAvailable ||
                status?.securityGate.status !== 'ready'
              }
              className='rounded-md border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40'
              title={
                status?.securityGate.status !== 'ready'
                  ? 'Security gate is blocked'
                  : !postgresService?.updateAvailable
                    ? 'No PostgreSQL image update is available'
                    : 'Open the manual PostgreSQL update confirmation'
              }
            >
              Update PostgreSQL
            </button>
          </div>
          <p className='mt-3 text-xs text-muted-foreground'>
            The update creates a full backup first. You can restore it later from Backup &amp; Restore.
          </p>
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

      <UpdateConfirmationModal
        open={confirmation !== null}
        title={confirmation?.title || ''}
        description={confirmation?.description || ''}
        targets={confirmation?.targets || []}
        warning={confirmation?.warning}
        requiresText={confirmation?.requiresText}
        onCancel={() => setConfirmation(null)}
        onConfirm={startConfirmedUpdate}
        isSubmitting={multibaseMutation.isPending || dockerMutation.isPending || postgresMutation.isPending}
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
