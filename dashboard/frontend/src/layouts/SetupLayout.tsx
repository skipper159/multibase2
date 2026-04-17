import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Book,
  Code,
  Layers,
  FileText,
  Cloud,
  Network,
  Building2,
  Menu,
  X,
  Package,
  Terminal,
  Bot,
  ArrowUpCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';

import Navbar from '../components/Navbar';
import SetupSearch from '../components/SetupSearch';

interface SetupLayoutProps {}

const SidebarLink = ({
  to,
  icon: Icon,
  children,
  onClick,
}: {
  to: string;
  icon: any;
  children: React.ReactNode;
  onClick?: () => void;
}) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
        isActive
          ? 'bg-brand-500/10 text-brand-500'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
      )
    }
  >
    <Icon className="w-4 h-4" />
    {children}
  </NavLink>
);

const SidebarGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-6">
    <h4 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">
      {title}
    </h4>
    <div className="space-y-1">{children}</div>
  </div>
);

export default function SetupLayout({}: SetupLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const close = () => setSidebarOpen(false);

  const sidebarContent = (onClick?: () => void) => (
    <>
      <SetupSearch />
      <SidebarGroup title="Getting Started">
        <SidebarLink to="/setup/getting-started/requirements" icon={Book} onClick={onClick}>
          Requirements
        </SidebarLink>
        <SidebarLink to="/setup/getting-started/installation" icon={Book} onClick={onClick}>
          Installation
        </SidebarLink>
        <SidebarLink to="/setup/getting-started/uninstall" icon={Book} onClick={onClick}>
          Uninstall
        </SidebarLink>
        <SidebarLink to="/setup/getting-started/hosting" icon={Book} onClick={onClick}>
          Choosing a VPS
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Server Setup">
        <SidebarLink to="/setup/server-setup/linux-basics" icon={Code} onClick={onClick}>
          Linux Basics
        </SidebarLink>
        <SidebarLink to="/setup/server-setup/dependencies" icon={Code} onClick={onClick}>
          Dependencies
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Domain & DNS">
        <SidebarLink to="/setup/domain-dns/domain-setup" icon={Layers} onClick={onClick}>
          Domain Setup
        </SidebarLink>
        <SidebarLink to="/setup/domain-dns/dns-settings" icon={Layers} onClick={onClick}>
          DNS Settings
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Deployment">
        <SidebarLink to="/setup/deployment/single-server" icon={FileText} onClick={onClick}>
          Single Server
        </SidebarLink>
        <SidebarLink to="/setup/deployment/split-hosting" icon={FileText} onClick={onClick}>
          Split Hosting
        </SidebarLink>
        <SidebarLink to="/setup/deployment/github-actions" icon={FileText} onClick={onClick}>
          GitHub Actions
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Configuration">
        <SidebarLink to="/setup/configuration/environment" icon={Code} onClick={onClick}>
          Environment
        </SidebarLink>
        <SidebarLink to="/setup/configuration/nginx" icon={Code} onClick={onClick}>
          Nginx
        </SidebarLink>
        <SidebarLink to="/setup/configuration/pm2" icon={Code} onClick={onClick}>
          PM2
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Features">
        <SidebarLink to="/setup/features/marketplace" icon={Package} onClick={onClick}>
          Extension Marketplace
        </SidebarLink>
        <SidebarLink to="/setup/features/updates" icon={ArrowUpCircle} onClick={onClick}>
          Self-Update System
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.7" icon={FileText} onClick={onClick}>
          v1.7 — Scale & Ecosystem
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.6" icon={FileText} onClick={onClick}>
          v1.6 — Functions & Storage
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.5" icon={FileText} onClick={onClick}>
          v1.5 — Monitoring & Auth
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.4" icon={FileText} onClick={onClick}>
          v1.4 — Backups & Deploy
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.3" icon={FileText} onClick={onClick}>
          v1.3 — Templates & API
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.2" icon={FileText} onClick={onClick}>
          v1.2 — Multi-Instance
        </SidebarLink>
        <SidebarLink to="/setup/features/roadmap-1.1" icon={FileText} onClick={onClick}>
          v1.1 — Foundation
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Reference">
        <SidebarLink to="/setup/general/overview" icon={Book} onClick={onClick}>
          Overview
        </SidebarLink>
        <SidebarLink to="/setup/general/versions" icon={Layers} onClick={onClick}>
          Version History
        </SidebarLink>
        <SidebarLink to="/setup/reference/multi-tenancy" icon={Building2} onClick={onClick}>
          Multi-Tenancy
        </SidebarLink>
        <SidebarLink to="/setup/reference/cloud-architecture" icon={Cloud} onClick={onClick}>
          Cloud Architecture
        </SidebarLink>
        <SidebarLink to="/setup/reference/kong-nginx-migration" icon={Network} onClick={onClick}>
          Kong→Nginx Migration
        </SidebarLink>
        <SidebarLink to="/setup/reference/scripts" icon={Code} onClick={onClick}>
          Scripts Guide
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="AI Assistant">
        <SidebarLink to="/setup/ai-assistant/overview" icon={Bot} onClick={onClick}>
          Overview & Setup
        </SidebarLink>
        <SidebarLink to="/setup/ai-assistant/tools-instances" icon={Bot} onClick={onClick}>
          Instance Tools
        </SidebarLink>
        <SidebarLink to="/setup/ai-assistant/tools-database" icon={Bot} onClick={onClick}>
          Database & RLS Tools
        </SidebarLink>
        <SidebarLink to="/setup/ai-assistant/tools-storage" icon={Bot} onClick={onClick}>
          Storage & Auth Tools
        </SidebarLink>
        <SidebarLink to="/setup/ai-assistant/tools-functions" icon={Bot} onClick={onClick}>
          Edge Function Tools
        </SidebarLink>
        <SidebarLink to="/setup/ai-assistant/tools-monitoring" icon={Bot} onClick={onClick}>
          Monitoring Tools
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup title="Development">
        <SidebarLink to="/setup/development/local-setup" icon={Terminal} onClick={onClick}>
          Local Setup
        </SidebarLink>
        <SidebarLink to="/setup/development/nginx-gateway" icon={Network} onClick={onClick}>
          Nginx Gateway
        </SidebarLink>
      </SidebarGroup>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Background gradients for consistency */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-1/4 -left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-1/4 -right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: '1s' }}
        />
      </div>
      <Navbar />

      {/* Mobile Top Bar (below Navbar) */}
      <div className="md:hidden sticky top-16 z-30 border-b border-white/5 bg-background/95 backdrop-blur-md px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Navigation</span>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
          aria-label="Open sidebar"
        >
          {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          {sidebarOpen ? 'Close' : 'Table of Contents'}
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-20 top-28"
          onClick={close}
        />
      )}

      {/* Mobile Slide-in Sidebar */}
      <div
        className={cn(
          'md:hidden fixed left-0 z-30 w-72 bg-background/95 backdrop-blur-md border-r border-white/5 overflow-y-auto py-4 px-4 transition-transform duration-300 ease-in-out',
          'top-28 bottom-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent(close)}
      </div>

      <div className="flex flex-1 pt-16 container mx-auto">
        {/* Desktop Sidebar */}
        <aside className="w-64 glass-panel h-full overflow-y-auto py-6 pr-6 hidden md:block">
          {sidebarContent()}
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 md:px-12">
          <div className="max-w-4xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
