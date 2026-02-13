/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        'space-black': '#0a0a0f',
        'space-dark': '#12121a',
        'space-panel': '#1a1a2e',
        'space-border': '#2a2a3e',
        'neon-blue': '#00d4ff',
        'neon-purple': '#a855f7',
        'neon-green': '#00ff88',
        'neon-pink': '#ff006e',
        'neon-orange': '#ff8800',
        'glass': 'rgba(255,255,255,0.05)',
        'glass-light': 'rgba(255,255,255,0.1)',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-neon': 'pulseNeon 2s ease-in-out infinite',
        'scanline': 'scanline 8s linear infinite',
        'typing': 'typing 1s steps(20) infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        pulseNeon: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        typing: {
          '0%, 100%': { borderColor: 'transparent' },
          '50%': { borderColor: '#00d4ff' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0,212,255,0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(0,212,255,0.6)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
