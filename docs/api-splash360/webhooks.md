# Webhooks Splash360 — guide d'intégration des partenaires click and collect

> Transcription fidèle du document « Webhooks Splash360 — guide d'intégration des partenaires
> click and collect » (PDF de 8 pages reçu de Splash360 le 26/11/2026). Seule la mise en forme
> Markdown a été adaptée. L'implémentation est décrite dans l'ADR 0029 et `docs/plan-lot-23.md`.

Ce guide s'adresse aux plateformes de click and collect connectées à Splash360. Il décrit les notifications que Splash360 vous envoie, comment les recevoir en sécurité et ce qu'il faut répondre.

Splash360 vous prévient de quatre événements, pour chaque station click and collect qui vous est rattachée. Les trois premiers ne concernent que le **catalogue principal** de la station (§8) :

| Événement | Quand | Ce que vous en faites |
|---|---|---|
| **Disponibilité des articles** | le restaurant modifie un article en caisse (hors stock, retour en stock, prix) | mettre à jour la disponibilité sur votre plateforme |
| **Prix de livraison des articles** | le restaurant fixe en caisse un prix de livraison propre à un article | mettre à jour le prix sur votre plateforme |
| **Mise à jour du catalogue** | la caisse a téléchargé et installé une nouvelle version du catalogue principal de la station | recharger le catalogue de la station |
| **Encaissement / annulation de commande** | la caisse encaisse ou annule une commande que vous avez transmise | mettre à jour le statut de la commande |

## 1. Mise en service

### Ce que vous nous transmettez

- **Une URL HTTPS par événement**, par exemple :
  - `https://api.partenaire.example/splash/stock`
  - `https://api.partenaire.example/splash/prices`
  - `https://api.partenaire.example/splash/catalog`
  - `https://api.partenaire.example/splash/orders`

  Les quatre URL peuvent être identiques si vous préférez tout recevoir au même endroit. L'URL déclarée détermine l'événement : le corps ne dit pas de quel événement il s'agit.

- Les URL doivent être :
  - joignables publiquement en **HTTPS sur le port 443** ;
  - servies avec un certificat valide, délivré par une autorité reconnue, en TLS 1.2 ou plus récent ;
  - sans identifiants dans l'URL (`user:password@` est refusé).

### Ce que nous vous transmettons

- **Un secret de signature par URL**, de la forme `whsec_…`, envoyé par un canal sûr. Nous ne pouvons pas vous le renvoyer : conservez-le dans votre coffre de secrets. S'il est perdu ou compromis, nous en générons un nouveau (§7).

### Vérification de vos URL

Avant de vous envoyer quoi que ce soit, nous vérifions que vous contrôlez chaque URL (§5). Tant que cette vérification n'a pas réussi, aucun événement ne part vers l'URL. Nous la refaisons à chaque changement d'URL.

## 2. L'appel

```
POST <votre URL>/<client id de la station>
Content-Type: application/json
User-Agent: Splash360-Webhooks/1.0
webhook-id: 0b6a3d4e-6f2c-4b8e-9b1d-3c7f2a9e5d10
webhook-timestamp: 1792065482
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=

<corps JSON>
```

- **Le dernier segment du chemin est le client id de la station** concernée, encodé pour l'URL. Avec l'URL `https://api.partenaire.example/splash/orders` déclarée, un appel pour la station `123_4abc5def` arrive sur `https://api.partenaire.example/splash/orders/123_4abc5def`. C'est ce segment qui vous dit de quelle station, et donc de quel restaurant, il s'agit.
- Si votre URL porte une query string, elle est conservée après ce segment.
- **Nous ne suivons pas les redirections** : un `3xx` compte comme un échec.
- **Délais** : la connexion doit s'établir en moins de 3 s, et l'appel est abandonné après 10 s sans réponse. Répondez **tout de suite** et traitez ensuite, de façon asynchrone.

## 3. Authentifier l'appel : la signature

Chaque appel est signé selon la spécification [Standard Webhooks](https://www.standardwebhooks.com/). **Vérifiez la signature de chaque appel**, challenge compris (§5), et rejetez ceux qui ne passent pas avec une réponse `401`, sans en donner la raison.

| En-tête | Contenu |
|---|---|
| `webhook-id` | Identifiant unique de l'événement. **Il reste le même à chaque nouvelle tentative du même événement.** |
| `webhook-timestamp` | Horodatage Unix, en secondes, de la tentative. |
| `webhook-signature` | `v1,<signature en base64>`. Pendant un changement de secret, deux signatures séparées par un espace (`v1,AAA… v1,BBB…`). |

**Calcul** :

1. La clé est la partie de votre secret qui suit `whsec_`, **décodée de base64**.
2. Le contenu signé est `webhook-id + "." + webhook-timestamp + "." + corps brut`.
3. La signature attendue est `base64( HMAC-SHA256(clé, contenu signé) )`.

**Règles** :

- Calculez la signature sur les **octets reçus**, tels quels. Ne re-sérialisez jamais le JSON après l'avoir lu : la signature ne correspondrait plus.
- Comparez en **temps constant** à chacune des valeurs `v1,…` de l'en-tête. Une seule doit correspondre.
- Refusez un `webhook-timestamp` à plus de **5 minutes** de votre horloge (rejeu).
- Les bibliothèques officielles Standard Webhooks font tout cela pour vous : `standardwebhooks` sur npm, pip et Packagist, et dans d'autres langages.

**Vecteur de test** : avec ces valeurs, votre code doit trouver exactement cette signature.

| | |
|---|---|
| secret | `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw` |
| `webhook-id` | `msg_p5jXN8AQM9LWM0D4loKWxJek` |
| `webhook-timestamp` | `1614265330` |
| corps | `{"test": 2432232314}` |
| signature attendue | `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=` |

### Exemples

**Node.js (Express)** — lisez le corps brut sur cette route avec `express.raw()` :

```js
const crypto = require('crypto');

app.post('/splash/:event/:clientId', express.raw({ type: 'application/json' }), (req, res) => {
  const id = req.header('webhook-id');
  const ts = Number(req.header('webhook-timestamp'));
  const sigs = (req.header('webhook-signature') || '').split(' ');

  if (!id || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return res.sendStatus(401);

  const key = Buffer.from(process.env.SPLASH_SECRET.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(`${id}.${ts}.`), req.body]))
    .digest();
  const valid = sigs.some(s => {
    if (!s.startsWith('v1,')) return false;
    const received = Buffer.from(s.slice(3), 'base64');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
  if (!valid) return res.sendStatus(401);

  const body = JSON.parse(req.body.toString('utf8'));
  if (body && !Array.isArray(body) && 'challenge' in body) {
    return res.json({ challenge: body.challenge });     // §5
  }
  res.sendStatus(204);
  queue.push({ event: req.params.event, clientId: req.params.clientId, webhookId: id, body });  // traiter après
});
```

**Python** :

```python
import base64, hashlib, hmac, time

def verify(secret: str, headers, raw_body: bytes) -> bool:
    wid, ts = headers.get("webhook-id"), headers.get("webhook-timestamp")
    if not wid or not ts or not ts.isdigit() or abs(time.time() - int(ts)) > 300:
        return False
    key = base64.b64decode(secret.removeprefix("whsec_"))
    expected = base64.b64encode(hmac.new(key, f"{wid}.{ts}.".encode() + raw_body, hashlib.sha256).digest()).deco…
    return any(hmac.compare_digest(expected, s[3:])
               for s in (headers.get("webhook-signature") or "").split(" ") if s.startswith("v1,"))
```

(La ligne `expected = …` est tronquée dans le document reçu ; elle se termine vraisemblablement par `.decode()`.)

**PHP** :

```php
function splashVerify(string $secret, string $id, string $ts, string $sigHeader, string $rawBody): bool {
    if (!ctype_digit($ts) || abs(time() - (int) $ts) > 300) return false;
    $key = base64_decode(substr($secret, strlen('whsec_')));
    $expected = base64_encode(hash_hmac('sha256', "$id.$ts.$rawBody", $key, true));
    foreach (explode(' ', $sigHeader) as $sig) {
        if (str_starts_with($sig, 'v1,') && hash_equals($expected, substr($sig, 3))) return true;
    }
    return false;
}
// $rawBody = file_get_contents('php://input');  — jamais json_encode(json_decode(...))
```

**Java** :

```java
static boolean verify(String secret, String id, String ts, String sigHeader, byte[] rawBody) throws Exception {
    if (Math.abs(Instant.now().getEpochSecond() - Long.parseLong(ts)) > 300) return false;
    var mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(Base64.getDecoder().decode(secret.substring("whsec_".length())), "HmacSHA256"));
    mac.update((id + "." + ts + ".").getBytes(StandardCharsets.UTF_8));
    byte[] expected = mac.doFinal(rawBody);
    return Arrays.stream(sigHeader.split(" "))
            .filter(s -> s.startsWith("v1,"))
            .anyMatch(s -> MessageDigest.isEqual(expected, Base64.getDecoder().decode(s.substring(3))));
}
```

## 4. Ce que vous devez répondre

| Réponse | Effet |
|---|---|
| `2xx`, en moins de 10 s | Reçu. Le corps de la réponse est ignoré, sauf pour le challenge (§5). |
| Toute autre réponse, une erreur réseau ou un délai dépassé | L'appel est retenté (§6). |
| `410 Gone` | L'URL est désactivée immédiatement : plus rien ne vous est envoyé sur cette URL jusqu'à réactivation par Splash360. À réserver à une URL réellement abandonnée. |

**Idempotence** : un même événement peut vous arriver plusieurs fois, par exemple si votre `2xx` ne nous est pas parvenu. Dédoublonnez sur `webhook-id` en gardant les identifiants traités au moins 48 h. Un **rejeu manuel** demandé à Splash360 arrive en revanche avec un nouveau `webhook-id` : pour les commandes, rendez aussi le traitement idempotent sur `order_id` + `status`.

## 5. Vérification de l'URL (challenge)

À la déclaration d'une URL et à chaque changement d'URL, dès qu'une station vous est rattachée, nous envoyons un appel **signé comme les autres**, sur `<votre URL>/<client id d'une station>` :

```json
{"challenge": "dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U"}
```

Répondez `2xx` avec **la même valeur** :

```json
{"challenge": "dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U"}
```

Le challenge se reconnaît à son corps : un objet qui contient la clé `challenge`. Aucun événement n'en a une.

## 6. Relances et désactivation

En cas d'échec, l'événement est retenté avec le **même `webhook-id`**, re-signé avec un horodatage frais. Les délais entre tentatives sont : 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h puis 12 h. Cela fait **9 tentatives sur environ 24 h**, après quoi l'événement est abandonné. Splash360 peut ensuite le rejouer à la demande.

Une URL qui échoue **20 fois de suite sur au moins 24 h** est désactivée, comme après un `410`. Prévenez Splash360 une fois votre service rétabli pour qu'elle soit réactivée.

**Ordre** : les événements d'une station partent dans l'ordre où ils se produisent. Une relance peut toutefois faire arriver un ancien état après un plus récent. Répondre vite et en `2xx` est le meilleur moyen d'éviter les relances, et donc ce désordre.

## 7. Changement de secret

Sur demande, ou si vous pensez qu'un secret a fuité, Splash360 génère un nouveau secret et vous le transmet. **Pendant 24 h**, chaque appel porte deux signatures, une par secret. Cela vous laisse le temps de déployer le nouveau secret sans perdre d'appel. Une seule des deux doit correspondre : acceptez l'un ou l'autre secret pendant la bascule, puis retirez l'ancien.

## 8. Les événements

Les corps sont en JSON, avec des noms de champs en `snake_case`. Le corps ne contient que les données de l'événement : la station est donnée par l'URL, l'événement par l'URL déclarée, l'identifiant et l'heure de la tentative par les en-têtes. Ignorez les champs que vous ne connaissez pas : nous pourrons en ajouter.

**Catalogue principal.** Une station vend depuis son catalogue principal. Les événements de disponibilité, de prix et de catalogue ne portent que sur lui :

| Modification en caisse | Événements envoyés à la station |
|---|---|
| Un article de son catalogue principal | disponibilité, et prix si un prix de livraison propre est fixé |
| Un ingrédient de personnalisation, quel que soit le catalogue | disponibilité, et prix si un prix de livraison propre est fixé |
| Un article d'un autre catalogue de la station | aucun |
| Nouvelle version du catalogue principal, installée en caisse | mise à jour du catalogue |
| Nouvelle version d'un autre catalogue | aucun |

Une même modification en caisse peut donner deux appels, disponibilité et prix, sur deux URL différentes et sans ordre garanti entre eux.

### 8.1 Disponibilité des articles

Un tableau, avec un élément par **identifiant sous lequel l'article est publié** :

```json
[
  {"item_id": "prd22947", "status": "unavailable"},
  {"item_id": "ing22947-typ5626", "status": "unavailable"},
  {"item_id": "ing22947-typ5627", "status": "unavailable"}
]
```

| Champ | Contenu |
|---|---|
| `item_id` | Identifiant de l'article, le même que dans le catalogue de la station (voir ci-dessous) |
| `status` | `available` (commandable) ou `unavailable` (hors stock) |

Identifiants. Un même produit peut apparaître sous plusieurs identifiants :

| Rôle | Sans SKU | Avec SKU |
|---|---|---|
| Produit vendu seul | `prd<id produit>` | `<sku>` |
| Ingrédient d'une personnalisation | `ing<id produit>-typ<id personnalisation>` | `<sku>-typ<id personnalisation>` |

**Ce que contient un appel** :

- Chaque élément est un **état**, pas une variation : appliquez-le tel quel. Vous pouvez recevoir un état identique à celui que vous avez déjà, par exemple quand seul le prix a changé en caisse : c'est normal.
- Le premier élément est l'article modifié en caisse.
- Un produit qui passe hors stock est rendu `unavailable` sous **tous** ses identifiants : produit vendu seul et chacune de ses personnalisations.
- Quand il revient, chaque identifiant reprend sa propre disponibilité : un rôle désactivé séparément reste `unavailable`.
- Un identifiant de produit vendu seul n'est envoyé que si la station vend ce produit dans son catalogue principal.

### 8.2 Prix de livraison des articles

Un tableau d'un élément : l'article modifié en caisse et le prix de livraison que le restaurant lui a fixé.

```json
[
  {"item_id": "ing22947-typ5626", "price": 1.5}
]
```

| Champ | Contenu |
|---|---|
| `item_id` | Identifiant de l'article, le même que pour la disponibilité (§8.1) |
| `price` | Prix de livraison de l'article, TTC, en euros |

**Ce que contient un appel** :

- Il n'est envoyé que lorsque le restaurant a fixé en caisse un **prix de livraison propre** à l'article. Un article qui garde le prix de livraison du catalogue ne donne lieu à aucun appel, même si son prix sur place ou à emporter est modifié.
- Le prix est un **état**, pas une variation : appliquez-le tel quel. Tant que ce prix propre existe, il est renvoyé à chaque modification de l'article en caisse, y compris quand seule sa disponibilité change : vous pouvez donc recevoir un prix identique à celui que vous avez déjà.
- Seul l'identifiant modifié est envoyé : un produit vendu seul et le même produit en ingrédient d'une personnalisation ont chacun leur prix.
- Le retour d'un article au prix de livraison du catalogue (le prix propre est retiré en caisse) ne donne lieu à aucun appel.
- Les changements de prix faits dans le catalogue lui-même vous parviennent par la mise à jour du catalogue (§8.3), pas par cet événement.

### 8.3 Mise à jour du catalogue

```json
{"catalog_id": 12, "revision": 34, "installed_at": "2026-10-15T12:00:03.512+02:00"}
```

| Champ | Contenu |
|---|---|
| `catalog_id` | Catalogue de la station mis à jour |
| `revision` | Nouvelle version de ce catalogue |
| `installed_at` | Date à laquelle la caisse du restaurant a confirmé l'installation de cette version, ISO-8601 avec décalage |

Envoyé quand la caisse du restaurant confirme avoir **téléchargé et installé** une nouvelle version du **catalogue principal** de la station : la station vend alors ce catalogue. Une version publiée mais pas encore installée en caisse, ou une version d'un autre catalogue de la station, ne donne lieu à aucun appel. Chaque version n'est annoncée qu'une fois, même si le restaurant a plusieurs caisses.

Rechargez alors le catalogue de la station, selon les modalités d'accès convenues lors de votre intégration. Ce webhook ne transporte pas le catalogue lui-même.

### 8.4 Encaissement / annulation de commande

```json
{
  "order_id": "6a1f0c2e-8b3d-4f5a-9c7e-1d2b3a4c5d6e",
  "status": "paid",
  "amount": 23.4,
  "occurred_at": "2026-10-15T14:43:58.658843+02:00",
  "reason": null
}
```

| Champ | Contenu |
|---|---|
| `order_id` | Référence Splash360 de la commande : celle que vous a renvoyée Splash360 à sa création (le `splashTicketId` de nos intégrations existantes) |
| `status` | `paid` (encaissée) ou `cancelled` (annulée) |
| `amount` | Montant de la commande, en euros ; peut être `null` |
| `occurred_at` | Date de l'encaissement ou de l'annulation, ISO-8601 avec décalage horaire |
| `reason` | Motif d'annulation saisi en caisse ; `null` sinon |

### 8.5 Appels de test

À la mise en service, Splash360 peut vous envoyer un appel de test par URL, signé comme les autres :

| Événement | Corps de test |
|---|---|
| Disponibilité | `[]` |
| Prix de livraison | `[]` |
| Catalogue | `{"catalog_id": 0, "revision": 0, "installed_at": "…"}` |
| Commande | `{"order_id": "TEST-<uuid>", "status": "paid", "amount": 0, "occurred_at": "…", "reason": "Test call from the Splash360 back office"}` |

Répondez `2xx` sans rien modifier de votre côté : une commande dont `order_id` commence par `TEST-` n'existe pas.

## 9. Récapitulatif

**Réception**

- [ ] URL en HTTPS sur le port 443, certificat valide, TLS 1.2 ou plus, sans redirection.
- [ ] Client id de la station lu dans le dernier segment du chemin.
- [ ] Corps lu **brut**, avant tout décodage JSON.

**Sécurité**

- [ ] Signature vérifiée en temps constant ; une valeur `v1,…` sur deux suffit.
- [ ] `webhook-timestamp` à ± 5 minutes, sinon refusé.
- [ ] Échecs de signature refusés avec `401`, sans en donner la raison.
- [ ] Secrets conservés dans un coffre et jamais journalisés.

**Réponse**

- [ ] Challenge renvoyé à l'identique.
- [ ] `2xx` en moins de 10 s, traitement asynchrone.
- [ ] Dédoublonnage sur `webhook-id` ; commandes idempotentes sur `order_id` + `status`.

**Contenu**

- [ ] Disponibilités appliquées comme des états, pour chaque `item_id`.
- [ ] Prix de livraison appliqués comme des états.
- [ ] Catalogue de la station rechargé à chaque mise à jour du catalogue.
- [ ] Vecteur de test du §3 validé.
