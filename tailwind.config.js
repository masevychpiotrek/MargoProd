/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#e8ecf4', 100: '#c5cfe4', 200: '#9fafd2',
          300: '#7990c0', 400: '#5c77b3', 500: '#3f5ea6',
          600: '#37569e', 700: '#2d4c94', 800: '#1a2d4a',
          900: '#0f1a2e', 950: '#070d1a'
        },
        brand: {
          DEFAULT: '#c9a84c',
          dark: '#9a7a2e',
          glow: 'rgba(201,168,76,0.12)'
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'monospace']
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'fade-in': 'fadeIn 0.2s ease'
      },
      keyframes: {
        slideIn: {
          from: { transform: 'translateX(110%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' }
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
