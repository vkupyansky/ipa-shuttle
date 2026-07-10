import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true
  },
  build: {
    target: "es2022",
    sourcemap: false,
    minify: "esbuild"
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: ["src/main.tsx", "src/app/App.tsx", "src/features/auth/AppleAuthModal.tsx", "src/vite-env.d.ts"],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 65,
        lines: 70
      }
    }
  }
});
