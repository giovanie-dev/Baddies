# Tests unitaires du backend

## Lancer les vérifications

```sh
npm run test:unit
npm run test:coverage:unit
```

La seconde commande impose au moins **80 %** de couverture pour les lignes,
les branches et les fonctions. Elle renvoie un code d'échec si un seuil n'est
pas atteint ou si un test échoue. Les commandes utilisent le lanceur natif
`node:test` (vérification effectuée avec Node.js 25.6.1).

## Résultat du 20 novembre 2026

154 tests réussis, aucun échec et aucun test ignoré.

| Indicateur | Avant | Après |
| --- | ---: | ---: |
| Lignes | 47,27 % | 99,55 % |
| Branches | 70,00 % | 97,13 % |
| Fonctions | 34,15 % | 95,12 % |

Les contrôleurs, modèles, middlewares et l'envoi d'e-mails atteignent 100 %
de couverture des lignes. La couverture globale inclut aussi les routes,
la configuration de la base, le démarrage de l'application et la configuration
Swagger ; aucun fichier applicatif n'a été exclu pour améliorer le résultat.
Le démarrage réel du serveur et certaines branches Swagger ne sont pas exécutés.

## Périmètre

- Inscription et connexion, réponses sans mot de passe ni détails internes.
- Demande de réinitialisation sans révéler l'existence du compte.
- Réinitialisation et rotation des sessions, jetons invalides ou réutilisés.
- Profil : formats, avatars locaux, doublons, modifications partielles.
- Suppression du compte : confirmation, mot de passe, modification concurrente.
- JWT : signature, expiration, activation différée, limites des identifiants BIGINT.
- Modèles : paramètres SQL séparés, transactions, rollback, libération du client
  et révocation des sessions lors d'un changement de mot de passe.
- Préparation de l'e-mail et propagation des erreurs du fournisseur.
- Routes publiques, validation Zod et maintien de la suppression de l'API historique.

Les tests remplacent PostgreSQL et Brevo par des simulations : ils ne créent
pas de vrais comptes et n'envoient pas d'e-mails. Les mots de passe et secrets
utilisés sont fictifs. Les tests de routes démarrent seulement un serveur local
sur un port disponible.

`npm test` inclut également les anciens tests d'intégration présents à la racine
de `test/`, dont certains accèdent à PostgreSQL. Cette commande n'est donc pas
équivalente à la suite unitaire isolée ci-dessus. Une forte couverture ne remplace
pas les tests d'intégration avec une base dédiée ni les tests fonctionnels.
