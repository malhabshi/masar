/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  staticPageGenerationTimeout: 180,
  experimental: {
    // pdf-parse (email intake) and pdfjs (the MCP document reader, which pulls text out of
    // offer letters) ship as ESM with their own worker plumbing. Bundling them through
    // webpack breaks that at runtime, so require them from node_modules on the server instead.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
    // pdfjs pulls its worker in through a computed, webpackIgnore'd import, which file
    // tracing cannot follow — so the standalone build shipped without it and every PDF
    // read failed. Name the files so they are copied regardless.
    outputFileTracingIncludes: {
      '/api/mcp': [
        './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
        './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      ],
    },
  },
  // Serve OAuth well-known metadata from normal route handlers (app-router ignores dot-folders).
  async rewrites() {
    return [
      { source: '/.well-known/oauth-protected-resource', destination: '/api/mcp-oauth/protected-resource' },
      { source: '/.well-known/oauth-protected-resource/api/mcp', destination: '/api/mcp-oauth/protected-resource' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/mcp-oauth/authorization-server' },
      { source: '/.well-known/oauth-authorization-server/api/mcp', destination: '/api/mcp-oauth/authorization-server' },
    ];
  },
  // Disable build activity indicator which can cause connection issues in some cloud IDEs
  devIndicators: {
    buildActivity: false,
  },
  // Disable chunk splitting only in dev to avoid port-forwarding issues in cloud IDEs
  webpack: (config, { dev }) => {
    if (dev) {
      config.optimization.splitChunks = {
        cacheGroups: {
          default: false,
        },
      };
    }
    return config;
  },
};

export default nextConfig;
