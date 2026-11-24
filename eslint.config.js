import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist', '.vercel', 'public/godaddy-event-feed.js'] },
  {
    files: [
      'api/**/*.js',
      'scripts/**/*.mjs',
      'tests/*.test.js',
      'tests/rules/**/*.js',
      // Build configs run in node, not the browser - vite.config.js reads
      // process.env to stamp the commit into the footer.
      'vite.config.js',
      'vitest.config.js'
    ],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        // Replaced at build time by vite.config.js's `define`. Declared here
        // so the one file that reads it is not an error, and so a typo in the
        // name still is.
        __APP_COMMIT_SHA__: 'readonly'
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module'
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true }
      ]
    }
  }
];
