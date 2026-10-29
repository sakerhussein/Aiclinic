import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api requests go to the Node.js server on port 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
