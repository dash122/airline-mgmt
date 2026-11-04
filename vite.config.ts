import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The demand model builds about 700,000 markets the first time it is used.
  test: { testTimeout: 60_000 },
  base: './',
  plugins: [react()],
});
