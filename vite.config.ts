import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import devServer from '@hono/vite-dev-server'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devServer({
      entry: 'server/index.ts',
      exclude: [
        /.*\.tsx?($|\?)/,
        /.*\.(s?css|less)($|\?)/,
        /.*\.(svg|png|jpg|jpeg|gif|webp)($|\?)/,
        /.*\.html?($|\?)/,
        /^\/@.+$/,
        /^\/favicon\.ico$/,
        /^\/(public|assets|static)\/.+/,
        /^\/node_modules\/.*/,
        /^\/$/,
        /^\/src\/.*/,
      ],
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['katex'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'vendor-react'
            if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/rehype-') || id.includes('/react-syntax-highlighter/')) return 'vendor-markdown'
            if (id.includes('/framer-motion/') || id.includes('/radix-ui/') || id.includes('/@radix-ui/') || id.includes('/lucide-react/')) return 'vendor-ui'
            if (id.includes('/katex/')) return 'vendor-katex'
            if (id.includes('/zustand/')) return 'vendor-zustand'
          }
        },
      },
    },
  },
})
