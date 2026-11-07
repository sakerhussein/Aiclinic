import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The online booking page (book.limitsiz.si): its own small build, so the public site never serves the staff app's code.
// In development it calls the public server on port 3005.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist-public", emptyOutDir: true, rollupOptions: { input: "book.html" } },
  server: { port: 5176, open: "/book.html", proxy: { "/api": "http://localhost:3005" } },
});
