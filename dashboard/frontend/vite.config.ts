import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

function getVersion(): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const map: Record<string, string> = {
      'Feature_Roadmap': '3.0.0',
      'cloud-version':   '2.0.0',
      'main':            '1.0.0',
    };
    return map[branch] ?? pkg.version;
  } catch {
    return pkg.version;
  }
}

// Read dynamic port configuration from environment
// These are set by launch.sh in frontend/.env
const FRONTEND_PORT = parseInt(process.env.VITE_PORT || '5174', 10);
const BACKEND_URL = process.env.VITE_API_URL || 'http://localhost:3001';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'charts-vendor': ['recharts'],
          'ui-vendor': ['lucide-react', 'sonner', 'date-fns'],
          'socket-vendor': ['socket.io-client'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: '0.0.0.0',
    port: FRONTEND_PORT,
    cors: true,
    allowedHosts: ['mission.smartpi.ai', 'localhost', '192.168.1.3', 'host.docker.internal'],
    // HMR configuration for nginx reverse proxy (only in production)
    // Disabled for local development
    ...(process.env.NODE_ENV === 'production' && {
      hmr: {
        protocol: 'wss',
        clientPort: 443,
      },
    }),
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/socket.io': {
        target: BACKEND_URL,
        ws: true,
      },
    },
  },
});
