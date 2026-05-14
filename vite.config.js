import { defineConfig } from 'vite';
import { matchApiPlugin } from './server/match-api.js';

export default defineConfig({
  plugins: [matchApiPlugin()],
});
