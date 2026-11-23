/**
 * Seul point d'accès à Splash360 (règle non négociable n° 5, ADR 0018) : la carte,
 * et le client de l'API Click & Collect utilisé par la caisse du serveur.
 */
export * from './cache';
export * from './demo';
export * from './provider';
export * from './splash360/client';
export * from './splash360/menu';
export * from './splash360/status';
