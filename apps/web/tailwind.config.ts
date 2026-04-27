import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#6c5ce7', light: '#a29bfe' },
      },
    },
  },
  plugins: [],
};
export default config;
