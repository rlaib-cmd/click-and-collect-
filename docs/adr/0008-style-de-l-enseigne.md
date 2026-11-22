# 0008 — Style de l'enseigne au-delà des couleurs

## Contexte

Le thème d'une enseigne se limitait à une couleur, un mode clair/sombre, un logo et un slogan.
Les enseignes à forte identité (exemple : Bills Burger, rouge, damier, titres en capitales) ne s'y
reconnaissaient pas. Il faut plus de personnalisation sans écrire de code par enseigne.

## Décision

- Le thème porte un bloc `style` générique, choisi au back-office (page Design) :
  `header` (`plain` | `brand`), `corners` (`rounded` | `pill` | `square`), `uppercaseTitles`,
  `pattern` (`none` | `checker`).
- Stockage : colonnes contrôlées de `tenant_theme` (`header_style`, `corner_style`, `uppercase_titles`,
  `pattern`), valeurs par défaut = rendu historique.
- Contrat : `style` est complété par défaut s'il manque, pour les anciennes versions de l'API.
- Les polices restent celles de l'application : une police d'enseigne exige sa licence et son
  intégration dans le build ; ce sera une décision séparée.

## Conséquences

- Une nouvelle option = une colonne, une valeur de contrat et son rendu ; jamais de cas particulier par enseigne.
- Le contraste reste garanti par la palette (`onPrimary` ≥ 4,5:1).

## Statut

Acceptée.
