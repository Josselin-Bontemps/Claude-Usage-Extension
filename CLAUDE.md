# CLAUDE.md

Ce dépôt est un fork de [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension). Ses différences avec l'origine sont décrites en tête de `docs/INSTALLATION.md` : pas de demande de don, barre latérale épurée, pas de carte flottante, repère de temps écoulé, nom « Claude Usage Tracker (local) », variante Claude Desktop.

L'utilisateur est à Montréal (heure de l'Est : America/Toronto). Exprimer les heures dans ce fuseau, par exemple les heures de pointe : 8 h – 14 h en semaine, toute l'année.

Le `.gitignore` vient de l'origine et exclut `CLAUDE.md`. Ce fichier est suivi malgré tout. Après une modification, l'ajouter avec `git add -f CLAUDE.md`.

## Synchroniser avec une nouvelle version d'origine

Demande type : « Nouvelle version d'origine X.Y.Z : synchronise ».

1. Récupérer l'origine sans ajouter de remote permanent :

   ```bash
   git fetch https://github.com/lugia19/Claude-Usage-Extension.git main:refs/remotes/upstream/main --tags
   ```

2. Lire ce qui change : `git log --oneline HEAD..upstream/main` et `git diff $(git merge-base HEAD upstream/main) upstream/main --stat`.
3. Fusionner sur la branche de travail de la session, jamais directement sur `main` : `git merge --no-ff upstream/main`.
4. Résoudre les conflits selon les règles ci-dessous.
5. Initialiser le sous-module si besoin (`git submodule update --init`), puis vérifier :

   ```bash
   npm ci
   node scripts/build-dataclasses.js
   node common/scripts/build-i18n.js --check
   npx eslint .
   ```

6. Relire les points d'attention, même sans conflit.
7. Message de commit en français : « Fusionne la version d'origine X.Y.Z », suivi d'un paragraphe sur les changements et sur la résolution des conflits.
8. Pousser la branche et ouvrir une demande de fusion vers `main`. L'utilisateur la fusionne lui-même.

## Résolution des conflits

- `manifest_chrome.json` : garder le nom « Claude Usage Tracker (local) » (champs `name` et `default_title`) et prendre la version de l'origine.
- `i18n/all.js` : ne pas le fusionner à la main. Résoudre `i18n/*.js`, puis le régénérer avec `node common/scripts/build-i18n.js`.
- Dons (popup, menu du clic droit, lien Ko-fi, carte de palier de jetons) : les laisser supprimés, même si l'origine modifie le code concerné.
- Cartes flottantes (mise à jour, invitation à noter) : `content-components/notification_card.js` ne les appelle plus. Elles doivent rester sans appel.
- Barre latérale : pas de liens « Version Claude Desktop », « Claude QoL » ni « Signaler un bug », ni leurs interrupteurs dans les paramètres. Une marge de 8 px seulement après la dernière barre.
- Sous-module `common` : ne jamais le modifier. Il pointe sur le commit fixé par l'origine.

## Points d'attention

- **Repère de temps écoulé** (`limitElapsedFraction` dans `shared/dataclasses.js`, `setElapsed` et `clearElapsed` dans `content-components/content_utils.js`, `.ut-elapsed-marker` dans `tracker-styles.css`). Quand l'origine touche aux barres de limite ou au compteur de la zone de chat, vérifier que le repère :
  - reste dans la piste de chaque barre (`.ut-progress-track` en `position: relative`) ;
  - suit dans la zone de chat la limite affichée par la barre (session de 5 heures, ou limite hebdomadaire la plus avancée sur un forfait sans session) ;
  - disparaît pendant la dépense de crédits ;
  - reste visible sur le fond de la piste, en thème clair comme sombre.

  Une fusion sans conflit peut casser ces points sans que rien ne le signale.
- **Traductions** : toute clé ajoutée par le fork existe dans `i18n/en.js` et `i18n/fr.js` (par exemple `usage.tooltip_elapsed`).
- **Fichiers propres au fork** : `.github/workflows/build-crx.yml`, `docs/`, `windows/` et `linux/` n'existent pas dans l'origine ou n'y ont pas cet usage. Ne pas les écraser.
- **Paquet publié** : le workflow exclut `scripts/`, `docs/`, `windows/`, `linux/` et `CLAUDE.md`. Un nouveau dossier de développement ajouté par l'origine doit être exclu aussi.

## Style

- Documentation, messages de commit et demandes de fusion en français : phrases courtes, sans jargon inutile.
- Commentaires du code en anglais, comme dans l'origine.
- Code dans le style de l'origine (tabulations, ESLint du dépôt).
