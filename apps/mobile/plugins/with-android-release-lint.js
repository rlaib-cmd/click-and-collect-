// Désactive l'analyse lint « vital » lors des builds Android de publication.
//
// Pourquoi : @stripe/stripe-react-native déclare en compileOnly
// com.stripe:stripe-android-issuing-push-provisioning, dont le POM tire
// com.google.android.gms:play-services-tapandpay — artefact non publié sur les dépôts publics.
// Seule la tâche lintVitalAnalyzeRelease résout ce classpath et fait échouer le build
// (EAS, SDK 58). L'application n'utilise pas l'Issuing de Stripe ; le lint reste exécutable
// à la demande en développement. À retirer quand Stripe corrigera la dépendance.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// splash360: lint release désactivé (voir plugins/with-android-release-lint.js)';

module.exports = function withAndroidReleaseLint(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `\n${MARKER}\nandroid {\n    lint {\n        checkReleaseBuilds = false\n        abortOnError = false\n    }\n}\n`;
    }
    return cfg;
  });
};
