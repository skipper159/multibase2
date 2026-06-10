import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Shield,
  Star,
  Download,
  Package,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { instanceExtensionsApi, marketplaceApi, type MarketplaceExtension, type ExtensionReview } from '../../lib/api';
import { instancesApi } from '../../lib/api';

interface ExtensionDetailModalProps {
  extension: MarketplaceExtension;
  onClose: () => void;
  preselectedInstance?: string;
}

type WizardStep = 'details' | 'select-instance' | 'configure' | 'installing' | 'done';

interface ConfigField {
  type: 'string' | 'boolean' | 'select';
  default?: any;
  label: string;
  description?: string;
  placeholder?: string;
  options?: string[];
}
type ConfigSchema = Record<string, ConfigField>;

const INSTALL_TYPE_LABEL: Record<string, string> = {
  sql: 'SQL Migration',
  function: 'Edge Function',
  config: 'Configuration',
  composite: 'SQL + Function + Config',
};

const CATEGORY_LABELS: Record<string, string> = {
  database: 'Database',
  auth: 'Auth & Security',
  functions: 'Edge Functions',
  monitoring: 'Monitoring',
  ai: 'AI & Vectors',
  storage: 'Storage',
};

export default function ExtensionDetailModal({ extension, onClose, preselectedInstance }: ExtensionDetailModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(preselectedInstance ? 'configure' : 'details');
  const [selectedInstance, setSelectedInstance] = useState<string>(preselectedInstance ?? '');
  const [installLog, setInstallLog] = useState<Array<{ text: string; ok: boolean }>>([]);
  const [config, setConfig] = useState<Record<string, any>>(() => {
    if (!extension.configSchema) return {};
    try {
      const schema: ConfigSchema = JSON.parse(extension.configSchema);
      return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default ?? '']));
    } catch {
      return {};
    }
  });

  // Fetch all instances for the instance-selection step
  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: instancesApi.list,
    enabled: step === 'select-instance',
  });

  const installMutation = useMutation({
    mutationFn: () => instanceExtensionsApi.install(selectedInstance, extension.id, config),
    onMutate: () => {
      setInstallLog([{ text: 'Connecting to instance…', ok: true }]);
      setStep('installing');
    },
    onSuccess: () => {
      setInstallLog((prev) => [...prev, { text: `Extension "${extension.name}" successfully installed ✓`, ok: true }]);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['installed-extensions', selectedInstance] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-extensions'] });
      toast.success(`${extension.name} installed`);
    },
    onError: (err: any) => {
      setInstallLog((prev) => [...prev, { text: `Error: ${err.message}`, ok: false }]);
      setStep('installing'); // stay on log screen to show error
      toast.error('Installation failed', { description: err.message });
    },
  });

  // ── Render steps ─────────────────────────────────────────────────────────

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'>
      <div className='glass-card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-white/5 flex-shrink-0'>
          <div className='flex items-center gap-3'>
            <div className='w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center text-lg select-none'>
              🧩
            </div>
            <div>
              <div className='flex items-center gap-1.5'>
                <span className='font-semibold text-sm'>{extension.name}</span>
                {extension.verified && <Shield className='w-3.5 h-3.5 text-brand-400' />}
              </div>
              <span className='text-xs text-muted-foreground'>
                v{extension.version} · {CATEGORY_LABELS[extension.category] ?? extension.category}
              </span>
            </div>
          </div>
          <button onClick={onClose} className='text-muted-foreground hover:text-foreground transition-colors'>
            <X className='w-4 h-4' />
          </button>
        </div>

        {/* Body */}
        <div className='flex-1 overflow-y-auto p-4'>
          {step === 'details' && (
            <DetailsStep
              extension={extension}
              onInstall={() => setStep(preselectedInstance ? 'configure' : 'select-instance')}
            />
          )}

          {step === 'select-instance' && (
            <SelectInstanceStep
              instances={instances ?? []}
              selected={selectedInstance}
              onSelect={setSelectedInstance}
              onBack={() => setStep('details')}
              onNext={() => setStep('configure')}
            />
          )}

          {step === 'configure' && (
            <ConfigureStep
              extension={extension}
              instanceName={selectedInstance}
              config={config}
              onConfigChange={setConfig}
              onBack={() => setStep(preselectedInstance ? 'details' : 'select-instance')}
              onInstall={() => installMutation.mutate()}
            />
          )}

          {step === 'installing' && <InstallingStep log={installLog} isPending={installMutation.isPending} />}

          {step === 'done' && <DoneStep extension={extension} instanceName={selectedInstance} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailsStep({ extension, onInstall }: { extension: MarketplaceExtension; onInstall: () => void }) {
  return (
    <div className='space-y-4'>
      {/* Stats row */}
      <div className='flex gap-4 text-xs text-muted-foreground'>
        {extension.rating && (
          <span className='flex items-center gap-1'>
            <Star className='w-3.5 h-3.5 text-yellow-400 fill-yellow-400' />
            {extension.rating.toFixed(1)}
          </span>
        )}
        <span className='flex items-center gap-1'>
          <Download className='w-3.5 h-3.5' />
          {extension.installCount.toLocaleString()} installs
        </span>
        <span className='capitalize'>{INSTALL_TYPE_LABEL[extension.installType] ?? extension.installType}</span>
      </div>

      {/* Long description */}
      <p className='text-sm text-muted-foreground leading-relaxed'>
        {extension.longDescription || extension.description}
      </p>

      {/* Requirements */}
      {extension.requiresExtensions && (
        <div>
          <p className='text-xs font-medium mb-1.5'>Required Postgres Extensions</p>
          <div className='flex flex-wrap gap-1.5'>
            {extension.requiresExtensions.split(',').map((e) => (
              <code key={e} className='text-xs px-2 py-0.5 rounded bg-white/5 border border-white/5'>
                {e.trim()}
              </code>
            ))}
          </div>
        </div>
      )}

      {/* Author */}
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>by {extension.author}</span>
        {extension.authorUrl && (
          <a
            href={extension.authorUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1 hover:text-foreground transition-colors'
          >
            GitHub <ExternalLink className='w-3 h-3' />
          </a>
        )}
      </div>

      <button
        onClick={onInstall}
        className='w-full py-2 rounded-lg bg-brand-500/20 text-brand-400 border border-brand-500/30 hover:bg-brand-500/30 transition-colors text-sm font-medium flex items-center justify-center gap-2'
      >
        <Package className='w-4 h-4' />
        Install Extension
      </button>

      {/* ── Reviews ──────────────────────────────── */}
      <ReviewsSection extensionId={extension.id} />
    </div>
  );
}

// ── Reviews Section ────────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className='flex items-center gap-0.5'>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type='button'
          onClick={() => onChange?.(n)}
          className={onChange ? 'cursor-pointer' : 'cursor-default'}
        >
          <Star className={`w-3.5 h-3.5 ${n <= value ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'}`} />
        </button>
      ))}
    </div>
  );
}

function ReviewsSection({ extensionId }: { extensionId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [authorName, setAuthorName] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['extension-reviews', extensionId],
    queryFn: () => marketplaceApi.listReviews(extensionId),
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      marketplaceApi.submitReview(extensionId, {
        rating,
        comment: comment || undefined,
        authorName: authorName || undefined,
      }),
    onSuccess: () => {
      toast.success('Review submitted — thank you!');
      queryClient.invalidateQueries({ queryKey: ['extension-reviews', extensionId] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-extensions'] });
      setShowForm(false);
      setComment('');
      setAuthorName('');
      setRating(5);
    },
    onError: (err: any) => toast.error('Could not submit review', { description: err.message }),
  });

  const reviews: ExtensionReview[] = data?.reviews ?? [];

  return (
    <div className='pt-2 border-t border-white/5 space-y-3'>
      <div className='flex items-center justify-between'>
        <h4 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5'>
          <MessageSquare className='w-3.5 h-3.5' />
          Reviews {reviews.length > 0 && `(${reviews.length})`}
        </h4>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className='text-xs text-brand-400 hover:underline'>
            + Write a review
          </button>
        )}
      </div>

      {showForm && (
        <div className='space-y-2 p-3 rounded-lg border border-white/5 bg-white/2'>
          <div className='flex items-center gap-2'>
            <span className='text-xs text-muted-foreground'>Rating:</span>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder='Your name (optional)'
            className='w-full px-2.5 py-1.5 bg-secondary border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500/50'
          />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder='Your comment (optional)'
            rows={3}
            className='w-full px-2.5 py-1.5 bg-secondary border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500/50 resize-none'
          />
          <div className='flex gap-2'>
            <button
              onClick={() => {
                setShowForm(false);
                setComment('');
              }}
              className='flex-1 py-1.5 rounded border border-white/10 text-xs text-muted-foreground hover:text-foreground transition-colors'
            >
              Cancel
            </button>
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className='flex-1 py-1.5 rounded bg-brand-500/15 text-brand-400 border border-brand-500/20 hover:bg-brand-500/25 transition-colors text-xs font-medium flex items-center justify-center gap-1'
            >
              {submitMutation.isPending ? <Loader2 className='w-3 h-3 animate-spin' /> : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className='flex justify-center py-3'>
          <Loader2 className='w-4 h-4 animate-spin text-muted-foreground' />
        </div>
      ) : reviews.length === 0 ? (
        <p className='text-xs text-muted-foreground text-center py-3'>No reviews yet. Be the first!</p>
      ) : (
        <div className='space-y-2 max-h-48 overflow-y-auto pr-1'>
          {reviews.map((r) => (
            <div key={r.id} className='p-2.5 rounded-lg border border-white/5 bg-white/2 space-y-1'>
              <div className='flex items-center justify-between gap-2'>
                <div className='flex items-center gap-2'>
                  <StarRating value={r.rating} />
                  <span className='text-xs font-medium'>{r.authorName ?? 'Anonymous'}</span>
                </div>
                <span className='text-[10px] text-muted-foreground shrink-0'>
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
              {r.comment && <p className='text-xs text-muted-foreground leading-relaxed'>{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectInstanceStep({
  instances,
  selected,
  onSelect,
  onBack,
  onNext,
}: {
  instances: any[];
  selected: string;
  onSelect: (name: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-sm font-semibold mb-1'>Select Instance</h3>
        <p className='text-xs text-muted-foreground'>Choose the project to install the extension on.</p>
      </div>

      <div className='space-y-1.5 max-h-60 overflow-y-auto'>
        {instances.length === 0 && (
          <p className='text-xs text-muted-foreground text-center py-4'>No instances available</p>
        )}
        {instances.map((inst) => (
          <button
            key={inst.name}
            onClick={() => onSelect(inst.name)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left text-sm transition-colors ${
              selected === inst.name
                ? 'bg-brand-500/15 border-brand-500/30 text-brand-400'
                : 'border-white/5 hover:border-white/10 text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className='font-medium'>{inst.name}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                inst.status === 'running' || inst.status === 'healthy'
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-gray-500/10 text-gray-400'
              }`}
            >
              {inst.status}
            </span>
          </button>
        ))}
      </div>

      <div className='flex gap-2 pt-2'>
        <button
          onClick={onBack}
          className='flex-1 py-2 rounded-lg border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors flex items-center justify-center gap-1'
        >
          <ChevronLeft className='w-3.5 h-3.5' /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!selected}
          className='flex-1 py-2 rounded-lg bg-brand-500/15 text-brand-400 border border-brand-500/20 hover:bg-brand-500/25 transition-colors text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed'
        >
          Continue <ChevronRight className='w-3.5 h-3.5' />
        </button>
      </div>
    </div>
  );
}

function ConfigureStep({
  extension,
  instanceName,
  config,
  onConfigChange,
  onBack,
  onInstall,
}: {
  extension: MarketplaceExtension;
  instanceName: string;
  config: Record<string, any>;
  onConfigChange: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  onBack: () => void;
  onInstall: () => void;
}) {
  let configSchema: ConfigSchema = {};
  try {
    if (extension.configSchema) configSchema = JSON.parse(extension.configSchema);
  } catch {
    // invalid JSON schema — fall back to empty config
  }
  const hasConfigFields = Object.keys(configSchema).length > 0;

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-sm font-semibold mb-1'>Review & Install</h3>
        <p className='text-xs text-muted-foreground'>
          Installing <strong>{extension.name}</strong> on{' '}
          <code className='bg-white/5 px-1 py-0.5 rounded'>{instanceName || '(selected instance)'}</code>.
        </p>
      </div>

      {/* Summary */}
      <div className='rounded-lg bg-white/3 border border-white/5 p-3 space-y-2 text-xs'>
        <Row label='Type' value={INSTALL_TYPE_LABEL[extension.installType] ?? extension.installType} />
        <Row label='Version' value={`v${extension.version}`} />
        {extension.requiresExtensions && <Row label='PG Extensions' value={extension.requiresExtensions} />}
      </div>

      {/* Dynamic config fields */}
      {hasConfigFields && (
        <div className='space-y-3'>
          <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>Configuration</p>
          {Object.entries(configSchema).map(([key, field]) => (
            <div key={key}>
              <label className='block text-xs font-medium mb-1'>
                {field.label}
                {field.description && (
                  <span className='ml-1.5 font-normal text-muted-foreground'>{field.description}</span>
                )}
              </label>
              {field.type === 'boolean' ? (
                <label className='flex items-center gap-2 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={!!config[key]}
                    onChange={(e) => onConfigChange((c) => ({ ...c, [key]: e.target.checked }))}
                    className='accent-brand-500 w-3.5 h-3.5'
                  />
                  <span className='text-xs text-muted-foreground'>{config[key] ? 'Enabled' : 'Disabled'}</span>
                </label>
              ) : field.type === 'select' ? (
                <select
                  value={config[key] ?? field.default ?? ''}
                  onChange={(e) => onConfigChange((c) => ({ ...c, [key]: e.target.value }))}
                  className='w-full px-3 py-1.5 bg-secondary border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-brand-500/50'
                >
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type='text'
                  value={config[key] ?? ''}
                  onChange={(e) => onConfigChange((c) => ({ ...c, [key]: e.target.value }))}
                  placeholder={field.placeholder ?? ''}
                  className='w-full px-3 py-1.5 bg-secondary border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-brand-500/50'
                />
              )}
            </div>
          ))}
        </div>
      )}

      {(extension.installType === 'sql' || extension.installType === 'composite') && (
        <div className='flex items-start gap-2 text-xs text-yellow-400/80 bg-yellow-400/5 border border-yellow-400/10 rounded-lg p-3'>
          <AlertTriangle className='w-3.5 h-3.5 mt-0.5 flex-shrink-0' />
          <span>SQL migrations will be executed on the instance database. Make sure you have a recent backup.</span>
        </div>
      )}

      <div className='flex gap-2 pt-2'>
        <button
          onClick={onBack}
          className='flex-1 py-2 rounded-lg border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors flex items-center justify-center gap-1'
        >
          <ChevronLeft className='w-3.5 h-3.5' /> Back
        </button>
        <button
          onClick={onInstall}
          className='flex-1 py-2 rounded-lg bg-brand-500/15 text-brand-400 border border-brand-500/20 hover:bg-brand-500/25 transition-colors text-sm font-medium flex items-center justify-center gap-2'
        >
          <Package className='w-4 h-4' /> Install Now
        </button>
      </div>
    </div>
  );
}

function InstallingStep({ log, isPending }: { log: Array<{ text: string; ok: boolean }>; isPending: boolean }) {
  return (
    <div className='space-y-4'>
      <h3 className='text-sm font-semibold'>{isPending ? 'Installing…' : 'Installation Log'}</h3>
      <div className='rounded-lg bg-black/30 border border-white/5 p-3 space-y-2 text-xs font-mono min-h-[120px]'>
        {log.map((entry, i) => (
          <div key={i} className={`flex items-start gap-2 ${entry.ok ? 'text-green-400' : 'text-red-400'}`}>
            {entry.ok ? (
              <CheckCircle2 className='w-3.5 h-3.5 mt-0.5 flex-shrink-0' />
            ) : (
              <AlertTriangle className='w-3.5 h-3.5 mt-0.5 flex-shrink-0' />
            )}
            <span>{entry.text}</span>
          </div>
        ))}
        {isPending && (
          <div className='flex items-center gap-2 text-brand-400'>
            <Loader2 className='w-3.5 h-3.5 animate-spin' />
            <span>Processing…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DoneStep({
  extension,
  instanceName,
  onClose,
}: {
  extension: MarketplaceExtension;
  instanceName: string;
  onClose: () => void;
}) {
  return (
    <div className='flex flex-col items-center gap-4 py-4 text-center'>
      <div className='w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center'>
        <CheckCircle2 className='w-8 h-8 text-green-400' />
      </div>
      <div>
        <h3 className='font-semibold text-sm'>{extension.name} installed!</h3>
        <p className='text-xs text-muted-foreground mt-1'>
          Successfully installed on <strong>{instanceName}</strong>.
        </p>
      </div>
      <button
        onClick={onClose}
        className='px-6 py-2 rounded-lg bg-brand-500/15 text-brand-400 border border-brand-500/20 hover:bg-brand-500/25 transition-colors text-sm font-medium'
      >
        Done
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-foreground font-medium'>{value}</span>
    </div>
  );
}
