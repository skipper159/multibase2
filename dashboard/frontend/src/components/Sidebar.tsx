import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import {
  LayoutDashboard,
  Bell,
  Database,
  Users,
  Key,
  FileText,
  Activity,
  ChevronDown,
  Shield,
  Mail,
  BookOpen,
  HardDrive,
  Cloud,
  Server,
  Bot,
  ArrowUpCircle,
} from 'lucide-react';
import { useState, createContext, useContext } from 'react';
import { useUpdateStatus } from '../hooks/useUpdates';

// Context for onNavigate callback (for mobile menu close)
const SidebarContext = createContext<{ onNavigate?: () => void }>({});

interface SidebarLinkProps {
  to: string;
  icon: React.ElementType;
  children: React.ReactNode;
  end?: boolean;
  badge?: boolean;
}

const SidebarLink = ({ to, icon: Icon, children, end, badge }: SidebarLinkProps) => {
  const { onNavigate } = useContext(SidebarContext);

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-brand-500/15 text-brand-400 shadow-[inset_0_0_0_1px_rgba(62,207,142,0.3)]'
            : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
        )
      }
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{children}</span>
      {badge && (
        <span className="w-2 h-2 rounded-full bg-brand-400 ring-2 ring-brand-400/30 animate-pulse flex-shrink-0" />
      )}
    </NavLink>
  );
};

const SidebarGroup = ({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        {title}
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen ? '' : '-rotate-90')} />
      </button>
      {isOpen && <div className="space-y-0.5 mt-1">{children}</div>}
    </div>
  );
};

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const { data: updateStatus } = useUpdateStatus();
  const hasUpdate = updateStatus?.multibase?.hasUpdate ?? false;

  return (
    <SidebarContext.Provider value={{ onNavigate }}>
      <aside className="glass-panel w-64 h-screen flex flex-col pt-16">
        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <SidebarGroup title="Overview">
            <SidebarLink to="/dashboard" icon={LayoutDashboard} end>
              Dashboard
            </SidebarLink>
            <SidebarLink to="/shared" icon={Cloud}>
              Shared Infra
            </SidebarLink>
            <SidebarLink to="/templates" icon={Database}>
              Templates
            </SidebarLink>
          </SidebarGroup>

          <SidebarGroup title="Monitoring">
            <SidebarLink to="/alerts" icon={Bell}>
              Alerts
            </SidebarLink>
            <SidebarLink to="/alert-rules" icon={Shield}>
              Alert Rules
            </SidebarLink>
            <SidebarLink to="/backups" icon={HardDrive}>
              Backups
            </SidebarLink>
            <SidebarLink to="/backup-destinations" icon={Cloud}>
              Destinations
            </SidebarLink>
          </SidebarGroup>

          <SidebarGroup title="Developer">
            <SidebarLink to="/api-keys" icon={Key}>
              API Keys
            </SidebarLink>
            <SidebarLink to="/api-docs" icon={FileText}>
              API Docs
            </SidebarLink>
            <SidebarLink to="/settings/mcp" icon={Server}>
              MCP Server
            </SidebarLink>
          </SidebarGroup>

          {user?.role === 'admin' && (
            <SidebarGroup title="Admin">
              <SidebarLink to="/users" icon={Users}>
                Users
              </SidebarLink>
              <SidebarLink to="/activity" icon={Activity}>
                Activity Log
              </SidebarLink>
              <SidebarLink to="/migrations" icon={Database}>
                Migrations
              </SidebarLink>
              <SidebarLink to="/settings/smtp" icon={Mail}>
                SMTP Settings
              </SidebarLink>
              <SidebarLink to="/updates" icon={ArrowUpCircle} badge={hasUpdate}>
                Updates
              </SidebarLink>
            </SidebarGroup>
          )}

          <SidebarGroup title="Resources">
            <SidebarLink to="/setup" icon={BookOpen}>
              Setup Guide
            </SidebarLink>
            <SidebarLink to="/setup/ai-assistant/overview" icon={Bot}>
              AI Assistant Docs
            </SidebarLink>
          </SidebarGroup>
        </nav>
      </aside>
    </SidebarContext.Provider>
  );
}
