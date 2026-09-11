import {fileURLToPath, URL} from "node:url";
import {defineConfig} from "vite";
import {writeFileSync} from "node:fs";

const siteRoot = fileURLToPath(new URL(".", import.meta.url));
const documentationRoot = fileURLToPath(
  new URL("./maps", import.meta.url),
);

export default defineConfig({
  base: "./",
  plugins: [{
    name: "atlas-local-render-receipt",
    configureServer(server) {
      server.middlewares.use("/__atlas-render-receipt", (request, response) => {
        const address = server.httpServer?.address();
        const origin = typeof address === "object" && address !== null
          ? `http://127.0.0.1:${address.port}` : null;
        if (request.method !== "POST" || request.headers.origin !== origin) {
          response.statusCode = 403; response.end("local verification page only"); return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 512 * 1024) request.destroy();
        });
        request.on("end", () => {
          try {
            const receipt = JSON.parse(body);
            if (receipt.renderer !== "mermaid" || !Array.isArray(receipt.results)) throw new Error("invalid receipt");
            // Fixed local artifact only; this endpoint never accepts a destination path.
            writeFileSync(new URL("./plans/evidence/l1-nine-slices-render.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({saved: true}));
          } catch {
            response.statusCode = 400; response.end("invalid render receipt");
          }
        });
      });
    },
  }],
  publicDir: "static",
  server: {
    // Writing the derived receipt must not reload the page that just produced it.
    watch: {ignored: ["**/plans/evidence/l1-nine-slices-render.json"]},
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
