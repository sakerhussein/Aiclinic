import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the pages call the Records server on port 3006.
export default defineConfig({
  plugins: [react()],
  server: { port: 5176, proxy: { "/api": "http://localhost:3006", "/auth": "http://localhost:3006" } },
});
