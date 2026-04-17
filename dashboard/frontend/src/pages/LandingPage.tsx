import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  Database,
  Shield,
  Activity,
  Github,
  Menu,
  X,
  MessageSquare,
  Server,
  Key,
  Archive,
  LayoutDashboard,
  Layers,
  Zap,
  CheckCircle,
  ArrowRight,
  Bot,
  Puzzle,
  Lock,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from '../components/AuthModal';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Generic Button component to avoid dependency issues if shadcn isn't fully set up or we want custom Supabase style
const SupabaseButton = ({ className, variant = 'primary', children, ...props }: any) => {
  const baseStyles =
    'inline-flex items-center justify-center rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background';
  const variants = {
    primary:
      'bg-brand-500 text-white hover:bg-brand-600 shadow-[0_0_10px_rgba(62,207,142,0.5)] hover:shadow-[0_0_20px_rgba(62,207,142,0.6)]',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline: 'border border-input hover:bg-accent hover:text-accent-foreground',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
  };

  // @ts-ignore
  const variantClasses = variants[variant] || variants.primary;

  return (
    <button className={`${baseStyles} ${variantClasses} h-10 py-2 px-4 ${className}`} {...props}>
      {children}
    </button>
  );
};

const FeatureCard = ({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) => (
  <div className="group p-6 rounded-xl border border-border bg-card/50 hover:bg-card transition-all hover:border-brand-500/50 hover:shadow-[0_0_30px_-10px_rgba(62,207,142,0.3)]">
    <div className="mb-4 inline-flex items-center justify-center w-12 h-12 rounded-lg bg-brand-500/10 text-brand-500 group-hover:bg-brand-500 group-hover:text-white transition-colors">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-xl font-semibold mb-2 text-foreground">{title}</h3>
    <p className="text-muted-foreground">{description}</p>
  </div>
);

const LandingPage = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authView, setAuthView] = useState<'login' | 'register' | 'forgot'>('login');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/settings/public`)
      .then(r => r.json())
      .then(d => setFeedbackEnabled(d.feedbackEnabled ?? true))
      .catch(() => {});
  }, []);

  const openAuth = (view: 'login' | 'register' | 'forgot') => {
    setAuthView(view);
    setAuthModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden relative selection:bg-brand-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-brand-500/10 rounded-full blur-[100px] -translate-y-1/2" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-brand-900/10 rounded-full blur-[100px] translate-y-1/2" />
      </div>

      {/* Navbar */}
      <nav className="z-10 border-b border-white/5 backdrop-blur-md sticky top-0 bg-background/80">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight flex-shrink-0">
            <img src="/logo.png" alt="Multibase" className="w-8 h-8" />
            Multibase
          </div>
          {/* Desktop Nav */}
          <div className="hidden sm:flex items-center gap-4">
            <a
              href="https://supabase.com/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Supabase Docs
            </a>
            <a
              href="/setup"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Setup Guide
            </a>
            {user ? (
              <>
                <SupabaseButton onClick={() => navigate('/workspace')}>Workspace</SupabaseButton>
                {isAdmin && (
                  <SupabaseButton
                    variant="ghost"
                    onClick={() => navigate('/dashboard')}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20"
                  >
                    Dashboard
                  </SupabaseButton>
                )}
              </>
            ) : (
              <>
                <SupabaseButton variant="ghost" onClick={() => openAuth('login')}>
                  Sign In
                </SupabaseButton>
                <SupabaseButton onClick={() => openAuth('login')}>Get Started</SupabaseButton>
              </>
            )}
          </div>
          {/* Mobile Burger Button */}
          <button
            className="sm:hidden p-2 text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menüöffnen"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-white/5 bg-background/95 backdrop-blur-md px-4 py-4 flex flex-col gap-2">
            <a
              href="https://supabase.com/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 px-2 rounded-lg hover:bg-white/5"
              onClick={() => setMobileMenuOpen(false)}
            >
              Supabase Docs
            </a>
            <a
              href="/setup"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 px-2 rounded-lg hover:bg-white/5"
              onClick={() => setMobileMenuOpen(false)}
            >
              Setup Guide
            </a>
            <div className="border-t border-white/5 my-1" />
            {user ? (
              <>
                <SupabaseButton
                  className="w-full justify-center"
                  onClick={() => {
                    navigate('/workspace');
                    setMobileMenuOpen(false);
                  }}
                >
                  Workspace
                </SupabaseButton>
                {isAdmin && (
                  <SupabaseButton
                    variant="ghost"
                    className="w-full justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20"
                    onClick={() => {
                      navigate('/dashboard');
                      setMobileMenuOpen(false);
                    }}
                  >
                    Dashboard
                  </SupabaseButton>
                )}
              </>
            ) : (
              <>
                <SupabaseButton
                  variant="ghost"
                  className="w-full justify-center"
                  onClick={() => {
                    openAuth('login');
                    setMobileMenuOpen(false);
                  }}
                >
                  Sign In
                </SupabaseButton>
                <SupabaseButton
                  className="w-full justify-center"
                  onClick={() => {
                    openAuth('login');
                    setMobileMenuOpen(false);
                  }}
                >
                  Get Started
                </SupabaseButton>
              </>
            )}
          </div>
        )}
      </nav>

      <main className="relative z-10 flex-grow">
        {/* Hero Section */}
        <div className="relative overflow-hidden">
          {/* Hero Background Image */}
          <img
            src="/landing_bg.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none"
            style={{ opacity: 0.12 }}
          />
          {/* Bottom fade so hero blends into the next section */}
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />

          <div className="container mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-20 sm:pb-28 text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-brand-400 mb-8 animate-fade-in-up">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span>
              </span>
              Open Source · Docker-Native · Self-Hosted
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-6 pb-2 animate-fade-in-up [animation-delay:100ms]">
              <span className="bg-clip-text text-transparent bg-gradient-to-br from-white to-white/60">
                Self-host Supabase.
              </span>
              <br />
              <span className="text-brand-500">Keep the cloud experience.</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 animate-fade-in-up [animation-delay:200ms]">
              Multibase runs multiple Supabase projects on your own server — using shared Docker
              infrastructure so every instance gets full Postgres, Auth, Storage, and Realtime
              without the bloat of a full single-stack per project.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up [animation-delay:300ms]">
              {user ? (
                <SupabaseButton
                  className="h-12 px-8 text-base bg-brand-500 hover:bg-brand-600 text-white"
                  onClick={() => navigate('/workspace')}
                >
                  Open Workspace
                </SupabaseButton>
              ) : (
                <SupabaseButton
                  className="h-12 px-8 text-base bg-brand-500 hover:bg-brand-600 text-white"
                  onClick={() => openAuth('login')}
                >
                  Get Started — It's Free
                </SupabaseButton>
              )}
              <SupabaseButton
                variant="secondary"
                className="h-12 px-8 text-base shadow-[0_0_12px_rgba(255,255,255,0.05)] hover:shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:border-white/20 transition-all"
                onClick={() => window.open('https://github.com/skipper159/multibase2', '_blank')}
              >
                <Github className="w-5 h-5 mr-2" />
                Repository
              </SupabaseButton>
              {feedbackEnabled && (
                <SupabaseButton
                  variant="ghost"
                  className="h-12 px-8 text-base text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/30 hover:border-violet-400/50 shadow-[0_0_12px_rgba(139,92,246,0.2)] hover:shadow-[0_0_20px_rgba(139,92,246,0.35)] transition-all"
                  onClick={() => navigate('/feedback')}
                >
                  <MessageSquare className="w-5 h-5 mr-2" />
                  Feedback
                </SupabaseButton>
              )}
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="border-y border-white/5 bg-white/[0.02]">
          <div className="container mx-auto px-4 sm:px-6 py-6">
            <div className="flex flex-wrap justify-center gap-x-12 gap-y-4 text-center">
              {[
                { value: '51+', label: 'Extensions' },
                { value: '9', label: 'Backup Destinations' },
                { value: '30+', label: 'AI Agent Tools' },
                { value: '100%', label: 'Open Source' },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center">
                  <div className="text-2xl sm:text-3xl font-bold text-brand-400">{value}</div>
                  <div className="text-sm text-muted-foreground mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-white/5 bg-background/50 backdrop-blur-sm">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">
              Full Supabase stack — shared, not duplicated
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Each project gets its own isolated Postgres database and API surface, while core
              services are shared across all instances — giving you cloud-grade capabilities at a
              fraction of the resource cost.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={Database}
              title="Isolated Databases"
              description="Every project gets its own dedicated Postgres instance — fully isolated credentials, schemas, and Row Level Security policies."
            />
            <FeatureCard
              icon={Shield}
              title="Auth & Row Level Security"
              description="Per-project GoTrue auth with JWT tokens, OAuth providers, and RLS. Users from one project never bleed into another."
            />
            <FeatureCard
              icon={Activity}
              title="Realtime"
              description="A shared Realtime server streams Postgres changes, broadcast, and presence channels across all your projects — no extra setup required."
            />
            <FeatureCard
              icon={Archive}
              title="Backup Management"
              description="Schedule automated database backups and restore any project to a previous state with a single click from the dashboard."
            />
            <FeatureCard
              icon={Server}
              title="Shared Infrastructure"
              description="One Kong gateway, one storage service, one Realtime node — shared across all projects. Run 5+ instances on hardware that would barely support one full single-stack deployment."
            />
            <FeatureCard
              icon={Key}
              title="API Keys & Access Control"
              description="Scoped API keys, role-based access (admin / user / viewer), and per-organisation permissions keep your team in full control."
            />
            <FeatureCard
              icon={LayoutDashboard}
              title="Single Pane of Glass"
              description="Monitor health, uptime, and resource usage of every Supabase instance from one unified dashboard — no more jumping between terminals or Studio tabs."
            />
            <FeatureCard
              icon={Layers}
              title="Object Storage"
              description="Per-project S3-compatible storage with bucket policies and CDN-ready delivery for all your images, videos, and file uploads."
            />
            <FeatureCard
              icon={Zap}
              title="Supabase Studio"
              description="Full Supabase Studio access for every instance — table editor, SQL editor, API explorer, and logs, all reachable from the dashboard."
            />
          </div>
        </div>

        {/* How It Works */}
        <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-white/5">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Up and running in minutes</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              No complex Kubernetes manifests, no vendor lock-in. Just Docker, a server, and five
              minutes.
            </p>
          </div>
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="hidden md:block absolute top-8 left-[calc(33%+2rem)] right-[calc(33%+2rem)] h-px bg-gradient-to-r from-brand-500/40 via-brand-500/20 to-brand-500/40" />
            {(
              [
                {
                  step: '1',
                  icon: Server,
                  title: 'Deploy on your server',
                  desc: 'Run a single Docker Compose command. Multibase sets up shared infrastructure — Nginx, PostgreSQL, Redis — once for all your projects.',
                },
                {
                  step: '2',
                  icon: Database,
                  title: 'Create projects',
                  desc: 'Spin up isolated Supabase instances from the dashboard. Each gets its own Postgres database, API credentials, and Studio.',
                },
                {
                  step: '3',
                  icon: Zap,
                  title: 'Connect & build',
                  desc: "Use the standard Supabase client SDK — exactly like the cloud version. Your code doesn't know the difference.",
                },
              ] as const
            ).map(({ step, icon: Icon, title, desc }) => (
              <div key={step} className="flex flex-col items-center text-center p-6">
                <div className="relative mb-6">
                  <div className="w-16 h-16 rounded-full bg-brand-500/10 border border-brand-500/30 flex items-center justify-center">
                    <Icon className="w-7 h-7 text-brand-500" />
                  </div>
                  <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">
                    {step}
                  </div>
                </div>
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Comparison Table */}
        <div className="border-t border-white/5 bg-white/[0.015]">
          <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Why Multibase?</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Compare what you get — and what you save — versus the alternatives.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full max-w-3xl mx-auto text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left py-3 pr-6 font-medium w-1/4">Feature</th>
                    <th className="py-3 px-4 font-semibold text-brand-400 text-center">
                      Multibase
                    </th>
                    <th className="py-3 px-4 font-medium text-center">Supabase Cloud</th>
                    <th className="py-3 px-4 font-medium text-center">Single-stack Self-Host</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(
                    [
                      ['Cost', 'Own server', '$25+/mo per project', 'Own server'],
                      ['Projects per server', 'Unlimited', 'Per billing plan', '1'],
                      ['RAM per project', '~200 MB (shared)', 'Cloud-managed', '4–8 GB'],
                      ['Backups', '✅ Multi-destination', '✅ Cloud-managed', '❌ Manual'],
                      ['Monitoring & Alerts', '✅ Built-in', '✅ Built-in', '❌ Manual'],
                      ['Supabase Studio', '✅ Per instance', '✅ Per project', '⚠️ Manual setup'],
                      [
                        'Custom Domains + SSL',
                        "✅ Auto Let's Encrypt",
                        '✅ Cloud-managed',
                        '❌ Manual',
                      ],
                      ['AI Agent', '✅ Multi-provider', '❌', '❌'],
                      ['Extension Marketplace', '✅ 51 extensions', '✅ Limited', '❌'],
                      ['Data sovereignty', '✅ 100%', '❌ Cloud-hosted', '✅ 100%'],
                    ] as const
                  ).map(([feature, multibase, cloud, selfhost]) => (
                    <tr key={feature} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-6 text-muted-foreground">{feature}</td>
                      <td className="py-3 px-4 text-center font-medium text-brand-400">
                        {multibase}
                      </td>
                      <td className="py-3 px-4 text-center text-muted-foreground">{cloud}</td>
                      <td className="py-3 px-4 text-center text-muted-foreground">{selfhost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Security + AI Agent */}
        <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-white/5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Security */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-xs font-medium text-brand-400 mb-6">
                <Lock className="w-3 h-3" />
                Security-first
              </div>
              <h2 className="text-2xl font-bold mb-4">Enterprise-grade security, out of the box</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Every instance is hardened by default — no extra configuration required to be
                production-ready.
              </p>
              <ul className="space-y-3">
                {[
                  '2FA via TOTP (authenticator apps)',
                  'Scoped API keys with expiration dates',
                  'AES-256-GCM credential encryption',
                  'Full audit log — 50+ event types',
                  'Rate limiting on all auth endpoints',
                  'Row Level Security per project',
                  'Helmet security headers on all responses',
                ].map(item => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <CheckCircle className="w-4 h-4 text-brand-500 flex-shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* AI Agent */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs font-medium text-violet-400 mb-6">
                <Bot className="w-3 h-3" />
                AI-powered
              </div>
              <h2 className="text-2xl font-bold mb-4">Your AI database assistant, built in</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Chat with your Supabase instances in natural language — powered by the AI provider
                of your choice.
              </p>
              <ul className="space-y-3">
                {[
                  '30+ tools: query, migrate, manage, monitor',
                  'Supports OpenAI, Anthropic, Gemini, OpenRouter',
                  'Per-user API key — your cost, your control',
                  'Persistent chat history per session',
                  'Execute SQL, inspect schemas, manage backups',
                  'Context-aware across all your instances',
                ].map(item => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <CheckCircle className="w-4 h-4 text-violet-500 flex-shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Extension Marketplace */}
        <div className="border-t border-white/5 bg-white/[0.015]">
          <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <div className="flex flex-col lg:flex-row items-center gap-12">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-muted-foreground mb-6">
                  <Puzzle className="w-3 h-3" />
                  Extension Marketplace
                </div>
                <h2 className="text-3xl font-bold mb-4">51 extensions, one click away</h2>
                <p className="text-muted-foreground mb-6 max-w-lg leading-relaxed">
                  Supercharge any project with Postgres extensions — vector search, message queues,
                  scheduled jobs, full-text search, and more — all installable directly from the
                  dashboard.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'pgvector',
                    'pgmq',
                    'pg_cron',
                    'PostGIS',
                    'TimescaleDB',
                    'pg_trgm',
                    'uuid-ossp',
                    'pg_net',
                    '+43 more',
                  ].map(ext => (
                    <span
                      key={ext}
                      className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-muted-foreground font-mono"
                    >
                      {ext}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 grid grid-cols-3 gap-3 w-full max-w-xs">
                {[
                  { icon: '🔍', name: 'Vector Search', desc: 'pgvector' },
                  { icon: '📬', name: 'Message Queues', desc: 'pgmq' },
                  { icon: '⏰', name: 'Cron Jobs', desc: 'pg_cron' },
                  { icon: '🗺️', name: 'GIS / Maps', desc: 'PostGIS' },
                  { icon: '📈', name: 'Time Series', desc: 'TimescaleDB' },
                  { icon: '🔗', name: 'HTTP Requests', desc: 'pg_net' },
                ].map(({ icon, name, desc }) => (
                  <div
                    key={name}
                    className="p-3 rounded-lg bg-card/50 border border-border text-center hover:border-brand-500/40 hover:bg-card transition-all cursor-default"
                  >
                    <div className="text-2xl mb-1">{icon}</div>
                    <div className="text-xs font-medium text-foreground leading-tight">{name}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="border-t border-white/5">
          <div className="container mx-auto px-4 sm:px-6 py-20 sm:py-28 text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6">
              <span className="bg-clip-text text-transparent bg-gradient-to-br from-white to-white/60">
                Ready to take back control
              </span>
              <br />
              <span className="text-brand-500">of your infrastructure?</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
              Deploy Multibase on any VPS, cloud VM, or bare-metal server. No credit card, no vendor
              lock-in — just Postgres and Docker.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {user ? (
                <SupabaseButton
                  className="h-12 px-10 text-base bg-brand-500 hover:bg-brand-600 text-white"
                  onClick={() => navigate('/workspace')}
                >
                  Open Workspace
                </SupabaseButton>
              ) : (
                <SupabaseButton
                  className="h-12 px-10 text-base bg-brand-500 hover:bg-brand-600 text-white"
                  onClick={() => openAuth('register')}
                >
                  Start for free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </SupabaseButton>
              )}
              <SupabaseButton
                variant="ghost"
                className="h-12 px-10 text-base border border-white/10 hover:border-white/20 transition-all"
                onClick={() => window.open('https://github.com/skipper159/multibase2', '_blank')}
              >
                <Github className="w-5 h-5 mr-2" />
                View on GitHub
              </SupabaseButton>
            </div>

            {/* Tech Stack chips */}
            <div className="mt-16 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="mr-1">Powered by</span>
              {[
                'PostgreSQL',
                'Docker',
                'Kong',
                'GoTrue',
                'Supabase Realtime',
                'Node.js',
                'React',
              ].map(tech => (
                <span
                  key={tech}
                  className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03]"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#111] py-12 relative z-10">
        <div className="container mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 font-bold mb-4">
              <img src="/logo.png" alt="Multibase" className="w-6 h-6" />
              Multibase
            </div>
            <p className="text-sm text-muted-foreground">
              The open source backend for your next application.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://supabase.com/docs/guides/database"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  Database
                </a>
              </li>
              <li>
                <a
                  href="https://supabase.com/docs/guides/auth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  Authentication
                </a>
              </li>
              <li>
                <a
                  href="https://supabase.com/docs/guides/storage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  Storage
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">Resources</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://supabase.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  Documentation
                </a>
              </li>
              <li>
                <a
                  href="https://supabase.com/docs/reference/javascript"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  API Reference
                </a>
              </li>
              <li>
                <a href="/setup" className="hover:text-brand-500 transition-colors">
                  Guides
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://github.com/skipper159/multibase2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/skipper159/multibase2/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  Issues
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/skipper159/multibase2/discussions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-500 transition-colors"
                >
                  Discussions
                </a>
              </li>
              {feedbackEnabled && (
                <li>
                  <a href="/feedback" className="hover:text-brand-500 transition-colors">
                    Feature Requests
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-4 sm:px-6 border-t border-white/5 pt-8 text-center text-sm text-muted-foreground">
          &copy; 2026 Multibase Inc. All rights reserved.
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialView={authView}
      />
    </div>
  );
};

export default LandingPage;
