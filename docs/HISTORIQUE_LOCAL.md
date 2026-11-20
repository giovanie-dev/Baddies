# Historique uniquement local

L’API est limitée à l’authentification, aux sessions et au profil utilisateur.
Les routes, contrôleur, modèle et contrat OpenAPI de l’historique ont été retirés.
Le front conserve les dates, évaluations et solutions dans IndexedDB, sans transfert,
avec ou sans connexion. La migration de l’ancien localStorage reste disponible.
Le filtrage local par compte reste en place pour ne pas dévoiler les épisodes
d’un autre compte dans l’interface du même navigateur ; ce n’est pas du chiffrement.

## Déploiement

Déployer le backend sans routes d’historique puis le nouveau front.
Les anciennes versions du front peuvent conserver leur ancien fonctionnement jusqu’à
actualisation (notamment PWA) ; le retrait des routes empêche leur transfert vers la nouvelle API.

## Données déjà en base

Cette modification du code n’efface aucune donnée de Supabase ni ses sauvegardes.
La migration dates-seules non exécutée a été retirée : ne pas l’appliquer.
Avant de supprimer l’ancienne table History, vérifier le schéma et ses dépendances.
Ne pas utiliser CASCADE aveuglément. Les sauvegardes et anciennes instances déployées
nécessitent aussi un traitement distinct si elles contiennent de vraies données.
