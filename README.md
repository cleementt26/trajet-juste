# Trajet juste

Un simulateur de covoiturage pour calculer un prix par place à partir des frais réels du trajet, de la voiture et du nombre de passagers.

L’interface est conçue pour le téléphone et s’adapte aussi aux ordinateurs : cartes arrondies, navigation entre les étapes et prix accessible en bas de l’écran.

## Fonctionnalités

- Recherche de communes françaises par nom, abréviation ou code postal.
- Calcul de deux itinéraires via l’IGN : le plus rapide et sans autoroute.
- Saisie manuelle des kilomètres si le calcul automatique est indisponible.
- Recherche de voitures dans un catalogue ADEME et ajout d’un véhicule personnalisé.
- Consommation et prix de l’énergie modifiables ; prise en charge des véhicules thermiques, hybrides, électriques et hybrides rechargeables.
- Énergie, péages et usure facultative inclus dans les coûts.
- Trois objectifs : partager les frais, couvrir tous les frais saisis ou simuler un excédent.
- Prix personnalisé, frais conducteur éventuels et tableau selon le nombre de passagers.
- Vérification d’une réservation supplémentaire avec détour.
- Saisie des décimales avec point ou virgule.
- Voitures, trajets, péages et réglages mémorisés sur l’appareil.

## Installer et modifier

Prérequis : Node.js 20 ou plus récent et npm.

```sh
npm ci
npm test
npm run build
```

Le build produit un site statique complet dans `docs/`. Pour l’ouvrir localement avec Python :

```sh
python3 -m http.server 8080 --directory docs
```

Puis ouvrir `http://localhost:8080`. Utiliser un serveur HTTP : ouvrir directement un fichier HTML avec `file://` empêche le chargement normal des données locales.

## Organisation du projet

| Chemin | Contenu |
| --- | --- |
| `src/index.html` | Structure de l’interface |
| `src/styles.css` | Design et adaptation aux tailles d’écran |
| `src/main.mjs` | Interactions, sauvegarde et mise à jour des résultats |
| `src/lib/` | Calculs, recherche, itinéraires et mémorisation des péages |
| `data/` | Catalogues de communes et de voitures utilisés lors du build |
| `docs/` | Site compilé prêt à être hébergé |
| `*.test.mjs` | Tests des calculs, données et règles de péage |
| `build.mjs` | Assemblage du JavaScript et versionnement des ressources |

Après une modification des sources, lancer `npm test` puis `npm run build` et enregistrer aussi les modifications de `docs/` dans Git. Aucun service serveur ni clé API n’est nécessaire.

## Héberger avec GitHub Pages

Les ressources utilisent des chemins relatifs, compatibles avec une adresse de projet comme `/trajet-juste/`.

Le dossier de publication est `docs/`, sur la branche `main`. Si vous souhaitez activer GitHub Pages et que la visibilité et l’offre du dépôt le permettent, sélectionner **Settings → Pages → Deploy from a branch → main → /docs**. Cette préparation ne rend pas automatiquement le site public et n’active pas Pages.

Documentation : [configurer la source de publication GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Règles de calcul

Les frais du trajet correspondent à : **énergie + péages + usure facultative**.

- **Partager les frais** : frais ÷ (places proposées + conducteur), arrondi au demi-euro inférieur.
- **Ne rien payer** : frais ÷ passagers attendus + frais conducteur par place, arrondi au centime supérieur.
- **Excédent** : (frais + objectif d’excédent) ÷ passagers attendus + frais conducteur par place, arrondi au centime supérieur.

Le tableau conserve le même prix dans chaque scénario de remplissage. Avec zéro passager attendu, aucun prix permettant de couvrir des frais positifs n’est calculé.

Le mode excédent est une simulation sur les frais saisis. Il ne constitue pas une recommandation de tarif conforme aux conditions de BlaBlaCar. Le rappel et le lien vers les conditions figurent dans l’interface.

## Données et limites

- [Communes françaises](https://geo.api.gouv.fr/decoupage-administratif/communes) : suggestions locales par nom et code postal.
- [Itinéraires IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/) : distances et durées de centre-ville à centre-ville, sans trafic en direct.
- [Catalogue ADEME](https://data.ademe.fr/datasets/ademe-car-labelling) : suggestions de véhicules. Les consommations restent modifiables et les valeurs absentes doivent être renseignées.

Le calcul d’itinéraire ne renvoie pas le prix des péages. Pour le trajet rapide, le montant est à renseigner. Sans autoroute, **0 € est la valeur par défaut, modifiable**. Les prix saisis sont mémorisés pour le trajet et le véhicule correspondants.

Les prix du carburant ne sont pas actualisés automatiquement. Assurance et financement ne sont pas ajoutés automatiquement. Les calculs ne mesurent pas la demande ni les tarifs concurrents sur BlaBlaCar.

## Sauvegarde et changement d’adresse

Les réglages sont enregistrés dans le navigateur avec la clé `trajet-juste.v1`. Ils ne sont pas stockés dans ce dépôt. Changer de domaine, de navigateur ou d’appareil ne transfère pas automatiquement ces réglages.

Le service IGN reçoit les coordonnées des communes choisies pour calculer l’itinéraire. Les catalogues locaux n’envoient pas les frappes de recherche à une API distante.

---

Projet indépendant de BlaBlaCar. Version importée depuis la refonte publiée le 25 septembre 2026.
