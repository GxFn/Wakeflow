import {fileURLToPath, URL} from "node:url";
import {defineConfig} from "vite";

const siteRoot = fileURLToPath(new URL(".", import.meta.url));
const documentationRoot = fileURLToPath(
  new URL("./maps", import.meta.url),
);

export default defineConfig({
  base: "./",
  publicDir: "static",
  server: {
    fs: {
      allow: [siteRoot, documentationRoot],
    },
  },
  build: {
    outDir: "../.build/wakeflow-architecture-atlas",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
