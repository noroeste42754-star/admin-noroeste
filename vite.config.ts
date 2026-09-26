import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  build: {
    target:    'es2020',
    outDir:    'dist',
    sourcemap: false,
    rollupOptions: {
      input: ['index.html', 'agenda/index.html',
        'modulos/mestre/index.html', 'modulos/tarefas/index.html', 'modulos/oradores/index.html',
        'modulos/limpeza/index.html', 'modulos/escala/index.html', 'modulos/servicoCampo/index.html'],
      output: {
        manualChunks(id) {
          if (id.includes('pdf-lib') || id.includes('public-pdf-layout')) return 'pdf-engine'
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/.netlify/functions/': {
        target: 'https://noroeste-testes.netlify.app',
        changeOrigin: true,
      },
      '/api/import-jw-program': {
        target: 'https://southamerica-east1-reunioes-6c437.cloudfunctions.net',
        changeOrigin: true,
        rewrite: () => '/importJwProgram',
      },
    },
  },
})
