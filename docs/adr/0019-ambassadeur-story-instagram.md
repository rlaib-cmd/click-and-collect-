# ADR 0019 — Ambassadeur : story Instagram taguée, bonus de points une fois par ticket

Date : 2026-11-25 · Statut : acceptée

## Contexte

Maquette fournie le 25 novembre (« Deviens ambassadeur Bill's Burger ») : le client vérifie son
achat (QR du ticket), photographie son burger avec le cadre de l'enseigne, publie la photo en story
Instagram en taguant le compte de l'enseigne, et reçoit un bonus de points une fois la mention reçue,
une seule fois par ticket. La maquette est entièrement simulée.

Retours du testeur Bills Burger : le bouton « Copier » ne doit pas copier le « @ » (collé dans le
sticker @Mention, il empêche de trouver le compte) ; libellé dans Avantages : « Tag en Story Bills
Burger et gagne 50 points ;) ».

Décisions de l'utilisateur : bonus de **50 points** par story, une fois par ticket ; vérification
**automatique plus tard** (mention Instagram et ticket Splash360), le parcours étant construit dès
maintenant.

## Décision

1. **Réglages par enseigne** (`ambassador_settings`) : activé, compte Instagram à taguer (sans « @ »,
   contrôlé), bonus (50 par défaut). Réglés au back-office, page Fidélité (permission `loyalty`).
2. **Participations** (`ambassador_entries`, RLS sans règle : accès serveur seulement) : membre du club,
   numéro de ticket normalisé, compte Instagram du client, statut `pending` → `confirmed` ou `rejected`.
   **Une participation par ticket et par enseigne** (contrainte d'unicité).
3. **Aucun point n'est crédité à l'envoi.** Seule `confirmAmbassadorEntry` crédite le bonus, après le
   passage atomique `pending` → `confirmed` : un seul crédit, même appelée deux fois. Elle n'a encore
   aucun appelant ; elle sera branchée sur la vérification automatique.
4. **La photo reste sur l'appareil** : rien n'est envoyé au serveur (vie privée, pas de stockage).
   Sur le web, le cadre est dessiné sur un canvas (bandeau aux couleurs et au nom de l'enseigne,
   damier), puis partagé par la feuille de partage du navigateur ou téléchargé. Le logo n'est pas
   dessiné dans l'image : hébergé sur un autre domaine, il bloquerait l'export du canvas.
5. **Application installée** : photo et cadre exigent un module natif (appareil photo, composition)
   absent du build actuel ; en attendant, l'app installée propose le partage d'un texte et le compte se
   sélectionne pour être copié. Un nouveau build EAS sera nécessaire.
6. Numéro de ticket saisi à la main en attendant le format du QR des tickets Splash360.

## Conséquences

- Les participations s'accumulent « en attente » jusqu'au branchement de la vérification ; le
  back-office les liste (lecture seule).
- Branchement futur : webhook Instagram des mentions (compte Meta Business, application validée par
  Meta) pour confirmer une participation dont le compte client a mentionné l'enseigne ; lecture du
  QR du ticket et contrôle auprès de Splash360. Questions ouvertes : `questions-en-attente.md`, n° 17.
