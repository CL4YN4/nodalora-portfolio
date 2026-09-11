import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hostProvidedDependencies = [
  "@wealthfolio/addon-sdk",
  "@wealthfolio/addon-sdk/host-api",
  "@wealthfolio/addon-sdk/types",
  "react",
  "react-dom",
  "react/jsx-runtime",
];

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    lib: { entry: "src/addon.tsx", fileName: () => "addon.js", formats: ["es"] },
    outDir: "dist",
    minify: true,
    sourcemap: false,
    rollupOptions: { external: hostProvidedDependencies },
  },
});
