import { defineConfig } from 'vite';
import { matchApiPlugin } from './server/match-api.js';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [matchApiPlugin(), cloudflare()],
});