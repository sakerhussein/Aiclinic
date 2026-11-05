import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the pages call the Accounts server on port 3004.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, proxy: { "/api": "http://localhost:3004", "/auth": "http://localhost:3004" } },
});
