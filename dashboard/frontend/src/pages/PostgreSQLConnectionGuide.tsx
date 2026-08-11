import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CircleHelp,
  Copy,
  Database,
  ExternalLink,
  Globe2,
  Info,
  ListChecks,
  LockKeyhole,
  Network,
  Settings2,
  Terminal,
} from 'lucide-react';

function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be unavailable in local or insecure browser contexts.
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">{value}</code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="h-4 w-4 text-brand-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-brand-300">{children}</code>;
}

export default function PostgreSQLConnectionGuide() {
  const poolerUri =
    'postgresql://postgres.[POOLER_TENANT_ID]:[YOUR-PASSWORD]@[POOLER_PUBLIC_HOST]:[POOLER_PORT]/[PROJECT_DB]?sslmode=require';
  const psqlCommand = `psql "${poolerUri}"`;

  return (
    <div className="min-h-screen px-6 py-8 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-500/15">
              <Database className="h-6 w-6 text-brand-400" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-400">
                Resources
              </p>
              <h1 className="text-2xl font-bold text-foreground">PostgreSQL Connection Guide</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Connect applications and development tools to a project database through the
                Supavisor pooler.
              </p>
            </div>
          </div>
          <a
            href="https://www.postgresql.org/docs/current/libpq-connect.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300"
          >
            PostgreSQL documentation <ExternalLink className="h-4 w-4" />
          </a>
        </header>

        <section className="glass-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-brand-400" />
            <h2 className="font-semibold text-foreground">Getting started</h2>
          </div>
          <ol className="grid gap-3 text-sm leading-6 text-muted-foreground md:grid-cols-2">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">
                1
              </span>
              <span>
                Identify the project database name from the instance configuration, usually the
                <Code>PROJECT_DB</Code> value.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">
                2
              </span>
              <span>
                Read the pooler host, port, and tenant ID from the shared infrastructure
                configuration. Do not copy values from a Studio URL.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">
                3
              </span>
              <span>
                Replace every placeholder in the example below. Keep passwords out of source
                control, tickets, and chat messages.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">
                4
              </span>
              <span>
                Test the connection with TLS enabled before configuring an application or ORM.
              </span>
            </li>
          </ol>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="glass-card space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Network className="h-5 w-5 text-brand-400" />
              <h2 className="font-semibold text-foreground">Which endpoint should I use?</h2>
            </div>
            <div className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Pooler endpoint:</span> use the
                externally published pooler host and the configured transaction port for
                applications and normal queries.
              </p>
              <p>
                <span className="font-medium text-foreground">Studio URL:</span> this is an HTTP web
                address for the dashboard only. It is not a PostgreSQL hostname.
              </p>
              <p>
                <span className="font-medium text-foreground">Direct PostgreSQL:</span> the database
                port is normally internal-only and must not be exposed publicly just to make a
                connection string work.
              </p>
            </div>
          </section>

          <section className="glass-card space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-brand-400" />
              <h2 className="font-semibold text-foreground">Configuration reference</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Value</th>
                    <th className="pb-2 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-muted-foreground">
                  <tr>
                    <td className="py-2 pr-3 font-mono text-foreground">PROJECT_DB</td>
                    <td className="py-2">Target project database</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-mono text-foreground">SHARED_POOLER_PORT</td>
                    <td className="py-2">Host-side pooler port</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-mono text-foreground">SHARED_POOLER_TENANT_ID</td>
                    <td className="py-2">Pooler tenant suffix for the username</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-mono text-foreground">POSTGRES_PORT</td>
                    <td className="py-2">
                      Internal database/session port; not automatically public
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="glass-card space-y-5 p-5">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-brand-400" />
            <h2 className="font-semibold text-foreground">Connection examples</h2>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Replace <Code>[POOLER_TENANT_ID]</Code>, <Code>[POOLER_PUBLIC_HOST]</Code>,{' '}
            <Code>[POOLER_PORT]</Code>,<Code>[PROJECT_DB]</Code>, and <Code>[YOUR-PASSWORD]</Code>{' '}
            with values from your deployment.
          </p>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Connection URI
            </p>
            <CopyableCode value={poolerUri} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              psql
            </p>
            <CopyableCode value={psqlCommand} />
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              The transaction pooler is suitable for most application queries. Long-lived sessions,
              migrations, and session-dependent features may require a separately configured session
              or direct connection.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/15">
              <Globe2 className="h-5 w-5 text-brand-300" />
            </div>
            <div className="space-y-3">
              <div>
                <h2 className="font-semibold text-brand-100">Important: Supabase client URL</h2>
                <p className="mt-1 text-sm leading-6 text-brand-100/75">
                  The Supabase client uses the instance API URL. Do not use the Studio URL, the
                  pooler host, or the PostgreSQL connection URI here.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-brand-200/70">
                  Frontend environment variable
                </p>
                <CopyableCode value="VITE_SUPABASE_URL=https://[INSTANCE_ID]-api.[YOUR_DOMAIN]" />
              </div>
              <p className="text-sm leading-6 text-brand-100/75">
                In many deployments the URL follows the pattern{' '}
                <Code>https://[INSTANCE_ID]-api.[YOUR_DOMAIN]</Code>. Always use the actual public
                API URL configured for that instance, because custom domains and local deployments
                may use a different format.
              </p>
              <div className="rounded-lg border border-brand-400/20 bg-black/10 p-3 text-sm text-brand-100/80">
                <span className="font-medium text-brand-100">Example:</span>{' '}
                <code>VITE_SUPABASE_URL=https://[INSTANCE_ID]-api.[YOUR_DOMAIN]</code>
                <br />
                <span className="text-xs text-brand-100/60">
                  Use the matching public API endpoint for <code>createClient()</code>; keep
                  database passwords and service-role keys out of frontend variables.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-yellow-300" />
            <h2 className="font-semibold text-yellow-100">Developer note: pooler hardening</h2>
          </div>
          <p className="text-sm leading-6 text-yellow-100/80">
            Do not weaken hardening globally just to make a URI reachable. External access should be
            provided through an explicit, authenticated TCP/TLS proxy or stream route that forwards
            only the configured pooler port.
          </p>
          <ul className="grid gap-2 text-sm text-yellow-100/80 sm:grid-cols-2">
            <li>• Expose only the pooler port; never bind the direct database port publicly.</li>
            <li>• Enforce TLS, certificate validation, and connection/rate limits.</li>
            <li>• Keep Supavisor authentication and the tenant ID enabled.</li>
            <li>• Validate the route with an external TLS and `psql` test first.</li>
          </ul>
          <div className="flex items-start gap-3 border-t border-yellow-500/20 pt-4 text-sm text-yellow-100/80">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
            <p>
              If the pooler is bound to localhost only, external clients cannot connect yet. This is
              the safe default, not an error. Configure and test the dedicated TCP/TLS forwarding
              layer before publishing a connection string.
            </p>
          </div>
        </section>

        <section className="glass-card flex items-start gap-3 p-5 text-sm text-muted-foreground">
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" />
          <p>
            The Studio Connect dialog may show a different database host because the current
            self-hosted Studio image derives its display values from the public API URL and the
            internal PostgreSQL port. Do not change those values blindly: the public API URL must
            remain an HTTP endpoint. Use the deployment-specific pooler values documented above for
            PostgreSQL clients.
          </p>
        </section>
      </div>
    </div>
  );
}
