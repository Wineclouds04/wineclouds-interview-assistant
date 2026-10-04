import { defineConfig, type HttpProxy } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function manualChunks(id: string) {
  if (!id.includes('node_modules')) return

  if (
    id.includes('react-syntax-highlighter')
    || id.includes('/refractor/')
    || id.includes('/prismjs/')
  ) {
    return 'markdown-syntax'
  }

  if (
    id.includes('react-markdown')
    || id.includes('/remark-')
    || id.includes('/rehype-')
    || id.includes('/unified/')
    || id.includes('/mdast-')
    || id.includes('/hast-')
    || id.includes('/micromark')
    || id.includes('/vfile/')
    || id.includes('/property-information/')
    || id.includes('/space-separated-tokens/')
    || id.includes('/comma-separated-tokens/')
    || id.includes('/bail/')
  ) {
    return 'markdown-core'
  }

  if (
    id.includes('@dnd-kit')
    || id.includes('@tanstack/react-table')
  ) {
    return 'workspace-heavy'
  }

  if (id.includes('lucide-react')) {
    return 'icons'
  }
}

// The backend skips token auth only for same-origin loopback requests. Requests
// proxied from the Vite dev server carry `Origin: http://localhost:5173`, so drop
// that header: the proxy itself is the (loopback, non-browser) client.
function stripOrigin(proxy: HttpProxy.Server) {
  proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
  proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'))
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:18080',
        configure: stripOrigin,
      },
      '/ws': {
        target: 'ws://localhost:18080',
        ws: true,
        configure: stripOrigin,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
})
