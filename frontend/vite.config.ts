import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (normalizedId.includes('/node_modules/react') || normalizedId.includes('/node_modules/react-dom') || normalizedId.includes('/node_modules/react-router-dom')) {
            return 'react';
          }
          if (normalizedId.includes('/node_modules/@ant-design/icons') || normalizedId.includes('/node_modules/antd')) {
            return 'antd';
          }
          if (normalizedId.includes('/node_modules/lightweight-charts')) {
            return 'charts';
          }
          if (normalizedId.includes('/node_modules/@monaco-editor/react') || normalizedId.includes('/node_modules/@monaco-editor/loader')) {
            return 'monacoReact';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/base/')) {
            return 'monacoBase';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/platform/')) {
            return 'monacoPlatform';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/editor/contrib/')) {
            return 'monacoContrib';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/editor/browser/')) {
            return 'monacoEditorBrowser';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/editor/common/')) {
            return 'monacoEditorCommon';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/editor/standalone/')) {
            return 'monacoStandalone';
          }
          if (normalizedId.includes('/node_modules/monaco-editor/esm/vs/editor/')) {
            return 'monacoEditor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 3100,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
