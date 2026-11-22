import { defineConfig } from 'vitest/config';

// Les tests d'intégration partagent une même base : on les exécute un fichier après l'autre.
export default defineConfig({ test: { fileParallelism: false } });
