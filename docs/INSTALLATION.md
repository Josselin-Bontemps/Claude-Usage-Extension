# Claude Usage Tracker (local) : compilation et installation sur Brave

Ce dépôt est un fork de [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension) avec deux différences d'interface :

- aucune demande de don (bouton du popup, menu du clic droit sur l'icône, lien en bas de la barre latérale, carte de palier de jetons, bouton Ko-fi de la carte de mise à jour) ;
- un repère blanc sur chaque barre de limite (session de 5 heures et limites hebdomadaires) qui indique la part de la plage déjà écoulée. L'infobulle de la barre ajoute la ligne « Temps écoulé : X % de la plage ». Si le remplissage bleu dépasse le repère, la consommation va plus vite que le temps.

## Fonctionnement de la compilation

Le workflow `.github/workflows/build-crx.yml` se lance à chaque push sur `main` (sauf si seuls des fichiers `.md` ou `docs/` changent) et peut aussi être lancé à la main depuis l'onglet **Actions**, bouton **Run workflow**.

Il effectue les étapes suivantes :

1. récupère le dépôt et le sous-module `common` ;
2. installe les dépendances (`npm ci`), génère `content-components/ui_dataclasses.js` et vérifie que les fichiers de traduction groupés sont à jour ;
3. prépare `manifest.json` à partir de `manifest_chrome.json`, avec :
   - la version `X.Y.Z.N`, où `N` est le numéro d'exécution du workflow (Brave n'installe une mise à jour que si la version augmente) ;
   - `update_url`, l'adresse du fichier `update.xml` ;
   - `key`, la clé publique, pour que l'extension garde le même ID qu'elle soit installée en `.crx` ou chargée depuis un dossier ;
4. signe le `.crx` avec Chrome lui-même, à partir du secret `EXTENSION_KEY`, puis vérifie que l'ID inscrit dans le fichier correspond à l'ID calculé ;
5. publie sur la branche `dist` :

| Fichier | Rôle |
|---|---|
| `update.xml` | manifeste de mise à jour (protocole Omaha) lu par Brave |
| `claude-usage-tracker-X.Y.Z.N.crx` | extension signée |
| `claude-usage-tracker.zip` | même contenu, non empaqueté (installation manuelle) |
| `info.json` | ID, version et adresses utiles |

La branche `dist` est réécrite à chaque compilation et ne contient que la dernière version. Les fichiers binaires n'encombrent donc pas l'historique de `main`, et `main` reste facile à synchroniser avec le dépôt d'origine.

Le résumé de chaque exécution (onglet **Actions**, puis l'exécution) affiche l'ID et la valeur exacte à mettre dans la stratégie.

## Mise en place (une seule fois)

### Clé de signature

L'ID de l'extension découle de la clé privée. Tant que la clé ne change pas, l'ID ne change pas.

Pour créer une clé :

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out claude-usage-tracker.pem
```

Copier tout le contenu du fichier (lignes `-----BEGIN PRIVATE KEY-----` et `-----END PRIVATE KEY-----` comprises) dans le secret `EXTENSION_KEY` : **Settings > Secrets and variables > Actions > New repository secret**. Les formats PKCS#8 (`BEGIN PRIVATE KEY`) et PKCS#1 (`BEGIN RSA PRIVATE KEY`) sont acceptés.

Conserver une copie du fichier `.pem` dans un gestionnaire de mots de passe. Une clé perdue impose une nouvelle clé, donc un nouvel ID, donc la reconfiguration de chaque navigateur.

### Adresses

| Élément | Valeur |
|---|---|
| ID | `lahnmifnmckcjdoaloiamjjdoohmklfb` (aussi dans `info.json` sur la branche `dist`) |
| URL de mise à jour | `https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/dist/update.xml` |
| Valeur de stratégie | `lahnmifnmckcjdoaloiamjjdoohmklfb;https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/dist/update.xml` |

## Installation sur Brave sous Linux (Bazzite)

Brave lit ses stratégies dans `/etc/brave/policies/managed/`, qu'il soit installé en Flatpak (le paquet Flathub a accès au `/etc` de l'hôte pour cette raison) ou en paquet natif. Sur Bazzite, `/etc` reste modifiable malgré le système immuable.

Fermer complètement Brave, puis exécuter :

```bash
ID="lahnmifnmckcjdoaloiamjjdoohmklfb"
URL="https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/dist/update.xml"
sudo mkdir -p /etc/brave/policies/managed
printf '{\n  "ExtensionInstallForcelist": ["%s;%s"]\n}\n' "$ID" "$URL" | sudo tee /etc/brave/policies/managed/claude-usage-tracker.json
```

Vérification après le redémarrage de Brave :

- `brave://policy` affiche `ExtensionInstallForcelist` avec le statut « OK » ;
- `brave://extensions` affiche « Claude Usage Tracker (local) », sans bouton de suppression (installation gérée) ;
- la mention « Géré par votre organisation » apparaît dans le menu de Brave. C'est l'effet normal de toute stratégie.

Brave vérifie les mises à jour au démarrage puis toutes les quelques heures. Pour forcer une vérification : `brave://extensions`, activer le mode développeur, bouton **Mettre à jour**.

Désactiver la version du Chrome Web Store si elle est encore installée, pour éviter deux compteurs en parallèle.

## Installation sur Brave sous Windows

Sous Windows, Chromium (et donc Brave) n'installe par stratégie une extension hébergée hors du Chrome Web Store que si l'ordinateur est joint à un domaine Active Directory, à Entra ID (Azure AD) ou inscrit dans une gestion d'entreprise. Sur un ordinateur personnel, la stratégie `ExtensionInstallForcelist` est acceptée mais l'extension est bloquée.

La méthode qui fonctionne sur un ordinateur personnel est le chargement d'un dossier :

1. télécharger `claude-usage-tracker.zip` depuis la branche `dist` : `https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/dist/claude-usage-tracker.zip` ;
2. le décompresser dans un dossier conservé, par exemple `C:\Extensions\claude-usage-tracker` ;
3. ouvrir `brave://extensions`, activer le **mode développeur**, cliquer sur **Charger l'extension non empaquetée** et choisir ce dossier.

L'extension garde le même ID que sous Linux grâce à la clé publique du manifeste.

Pour une mise à jour : remplacer le contenu du dossier par celui du nouveau `.zip`, puis cliquer sur le bouton de rechargement de l'extension dans `brave://extensions`. Brave relit aussi le dossier à chaque démarrage.

## Synchronisation avec le dépôt d'origine

Quand l'auteur publie une nouvelle version : bouton **Sync fork** sur la page du dépôt. Le push sur `main` relance la compilation, et Brave sous Linux reçoit la mise à jour automatiquement.

Si GitHub signale un conflit, il porte sur l'un des fichiers modifiés par ce fork :

- `background.js`, `popup.html`, `popup.js` ;
- `content-components/content_utils.js`, `content-components/notification_card.js`, `content-components/usage_ui.js` ;
- `shared/dataclasses.js`, `tracker-styles.css`, `manifest_chrome.json` ;
- `i18n/en.js`, `i18n/fr.js` et `i18n/all.js` (régénéré par `node common/scripts/build-i18n.js`).

Le sous-module `common` n'est pas modifié : le bouton Ko-fi de la carte de mise à jour est neutralisé depuis `content-components/notification_card.js`.
