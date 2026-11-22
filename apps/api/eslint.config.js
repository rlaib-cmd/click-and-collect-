import base from '@splash360/config/eslint';

export default [
  ...base,
  {
    // L'API tourne aussi sous Deno (fonction Supabase, ADR 0007) : pas de globales propres à Node.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Buffer', message: "Importer Buffer depuis 'node:buffer' (runtime Deno)." },
      ],
    },
  },
];
