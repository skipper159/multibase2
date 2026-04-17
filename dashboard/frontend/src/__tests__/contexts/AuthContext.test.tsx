import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Test component to expose context values
const TestConsumer = () => {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.user?.email ?? 'null'}</span>
      <span data-testid="is-admin">{String(auth.isAdmin)}</span>
    </div>
  );
};

const mockUser = {
  id: 'u1',
  email: 'admin@test.com',
  username: 'admin',
  role: 'admin' as const,
  isActive: true,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe('AuthContext', () => {
  it('starts as unauthenticated with no stored token', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('validates stored token on mount and sets user', async () => {
    localStorage.setItem('auth_token', 'valid-token');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockUser,
    } as Response);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('admin@test.com');
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('is-admin').textContent).toBe('true');
  });

  it('clears token when stored token is invalid', async () => {
    localStorage.setItem('auth_token', 'expired-token');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('throws outside of AuthProvider', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow();
    spy.mockRestore();
  });
});
