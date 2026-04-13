import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API_BASE_URL is set in docker-compose to http://api:3000 (docker hostname).
// Locally it defaults to localhost:3000.
const apiTarget = process.env.API_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
