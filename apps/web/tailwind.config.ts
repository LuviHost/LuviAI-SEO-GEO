import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx,mdx}',
    './src/components/**/*.{ts,tsx,mdx}',
    './src/**/*.{ts,tsx,mdx}',
  ],
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
