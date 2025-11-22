import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/webview/**',
        'dist/**',
        'media/**',
        'node_modules/**',
      ],
    },
  },
  resolve: {
    alias: {
      vscode: 'node_modules/@types/vscode/index.d.ts',
    },
  },
});
