import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'media/**',
      'node_modules/**',
      '**/*.d.ts',
      'out/**',
      '.vscode-test/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'curly': 'warn',
      'eqeqeq': 'warn',
      'no-throw-literal': 'warn',
      'semi': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    files: ['src/webview/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        acquireVsCodeApi: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      'no-undef': 'off'
    }
  }
];
