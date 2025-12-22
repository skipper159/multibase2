/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Supabase Studio inspired dark theme
        border: '#333333',
        input: '#2a2a2a',
        ring: '#3ecf8e',
        background: '#1a1a1a',
        foreground: '#e5e5e5',
        primary: {
          DEFAULT: '#3ecf8e',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#242424',
          foreground: '#e5e5e5',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: '#2a2a2a',
          foreground: '#a3a3a3',
        },
        accent: {
          DEFAULT: '#2a2a2a',
          foreground: '#e5e5e5',
        },
        popover: {
          DEFAULT: '#242424',
          foreground: '#e5e5e5',
        },
        card: {
          DEFAULT: '#1f1f1f',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
