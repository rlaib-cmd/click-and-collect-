/**
 * Seul point d'accès à la carte (règle non négociable n° 5).
 *
 * L'adaptateur vers l'API menu Splash360 sera ajouté ici dès que sa documentation
 * sera fournie (docs/api-splash360/). Il implémentera `MenuProvider` et traduira
 * la réponse vers les types de `@splash360/core`.
 */
export * from './cache';
export * from './demo';
export * from './provider';
