import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// 只有 GitHub 仓库页需要 /renewlet/ base；Cloudflare Pages、自定义域和 Docker 静态站都走根路径。
const base = process.env.GITHUB_PAGES === 'true' ? '/renewlet/' : '/'

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      // 中文根路径与英文 /en/ 都是可索引 HTML 入口；不要退回只靠前端按钮切语言。
      input: {
        main: resolve(rootDir, 'index.html'),
        en: resolve(rootDir, 'en/index.html'),
      },
    },
  },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: ['tests/**', 'node_modules/**'],
  },
})
