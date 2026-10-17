import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'uploads/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
];
