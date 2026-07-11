import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // pdfme's Designer pulls in an optional PDF-to-image converter
      // (@pdfme/converter -> clawpdf) with a Node-only fallback branch that
      // references the `module` built-in, even though we never use that
      // converter (only the Designer/generator). Silence the client-bundle
      // resolve error per the Next 16 guide (AGENTS.md / turbopack.resolveAlias).
      module: { browser: "./empty.ts" },
    },
  },
};

export default nextConfig;
