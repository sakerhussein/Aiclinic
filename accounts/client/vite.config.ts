import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the pages call the Accounts server on port 3003.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { "/api": "http://localhost:3003", "/authorize": "http://localhost:3003" } },
});
