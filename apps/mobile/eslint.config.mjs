import base from '@splash360/config/eslint';

export default [
  ...base,
  {
    // Plugins de configuration Expo : modules Node en CommonJS, exécutés au build.
    files: ['plugins/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
