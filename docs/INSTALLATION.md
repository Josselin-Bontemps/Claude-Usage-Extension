# Claude Usage Tracker (local) : compilation et installation sur Brave et Claude Desktop

Ce dépôt est un fork de [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension). Il s'en distingue par les points suivants :

- **aucune demande de don** : ni bouton dans le popup, ni entrée dans le menu du clic droit sur l'icône, ni lien Ko-fi dans la barre latérale, ni carte de palier de jetons ;
- **barre latérale épurée** : pas de liens « Version Claude Desktop », « Claude QoL » ni « Signaler un bug », et pas d'interrupteurs correspondants dans les paramètres. L'espace sous les barres se limite à une marge de 8 px après la dernière barre affichée ;
- **aucune carte flottante** : ni carte « Mise à jour vers la version X » (elle apparaîtrait après chaque compilation du fork), ni carte d'invitation à noter l'extension ;
- **repère de temps écoulé** : un trait blanc sur chaque barre de limite (session de 5 heures et limites hebdomadaires) indique la part de la plage déjà écoulée. Dans la zone de chat, il suit la limite affichée par la barre : la session de 5 heures, ou la limite hebdomadaire la plus avancée sur un forfait sans session ; il disparaît quand la barre affiche la dépense de crédits. L'infobulle de la barre ajoute la ligne « Temps écoulé : X % de la plage ». Si le remplissage bleu dépasse le repère, la consommation va plus vite que le temps ;
- **nom distinct** : « Claude Usage Tracker (local) », pour ne pas confondre avec la version du Chrome Web Store ;
- **variante Claude Desktop** : la compilation publie aussi la variante Electron, que `linux/update-claude-usage-tracker.sh` installe et tient à jour dans Claude Desktop sous Linux.

## Fonctionnement de la compilation

Le workflow `.github/workflows/build-crx.yml` se lance à chaque push sur `main` (sauf si seuls des fichiers `.md`, `docs/`, `windows/` ou `linux/` changent) et peut aussi être lancé à la main depuis l'onglet **Actions**, bouton **Run workflow**.

Il effectue les étapes suivantes :

1. récupère le dépôt et le sous-module `common` ;
2. installe les dépendances (`npm ci`), génère `content-components/ui_dataclasses.js` et vérifie que les fichiers de traduction groupés sont à jour ;
3. prépare `manifest.json` à partir de `manifest_chrome.json`, avec :
   - la version `X.Y.Z.N`, où `N` est le numéro d'exécution du workflow (Brave n'installe une mise à jour que si la version augmente) ;
   - `update_url`, l'adresse du fichier `update.xml` ;
   - `key`, la clé publique, pour que l'extension garde le même ID qu'elle soit installée en `.crx` ou chargée depuis un dossier ;
4. prépare la variante Electron (Claude Desktop) à partir de `manifest_electron.json`, avec la même version `X.Y.Z.N`, le même nom et la même clé publique que la variante Chrome. Grâce à la clé, Electron calcule l'ID de l'extension à partir d'elle et non du chemin du dossier : l'ID, et donc les données enregistrées par l'extension, restent les mêmes d'une version à l'autre ;
5. signe le `.crx` avec Chrome lui-même, à partir du secret `EXTENSION_KEY`, puis vérifie que l'ID inscrit dans le fichier correspond à l'ID calculé ;
6. publie sur la branche `dist` :

| Fichier | Rôle |
|---|---|
| `update.xml` | manifeste de mise à jour (protocole Omaha) lu par Brave |
| `claude-usage-tracker-X.Y.Z.N.crx` | extension signée |
| `claude-usage-tracker.zip` | même contenu, non empaqueté (installation manuelle) |
| `claude-usage-tracker-electron.zip` | variante Electron non empaquetée, pour Claude Desktop |
| `info.json` | ID, version, adresses utiles et empreintes SHA-256 des deux `.zip` (champs `zip_sha256` et `electron_zip_sha256`, `electron_version`, `electron_zip`) |

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

Sous Windows, Chromium (et donc Brave) n'installe par stratégie une extension hébergée hors du Chrome Web Store que si l'ordinateur est joint à un domaine Active Directory, à Entra ID (Azure AD) ou inscrit dans une gestion d'entreprise. Sur un ordinateur personnel, l'extension est donc chargée comme extension non empaquetée, et le script `windows/Update-ClaudeUsageTracker.ps1` la tient à jour.

### Fonctionnement du script

Tout est rangé dans `%LOCALAPPDATA%\ClaudeUsageTracker` :

| Élément | Rôle |
|---|---|
| `extension\` | dossier chargé par Brave |
| `pending\` | version téléchargée, en attente de la fermeture de Brave |
| `update.log` | journal des vérifications (500 dernières lignes) |
| `Update-ClaudeUsageTracker.ps1` | copie du script utilisée par la tâche planifiée |

Une tâche planifiée, `ClaudeUsageTracker-Update`, lance le script toutes les 30 minutes, sans fenêtre et sans droits administrateur. À chaque passage, le script :

1. lit `info.json` sur la branche `dist` ;
2. si la version publiée est plus récente, télécharge le `.zip`, vérifie son empreinte SHA-256 et sa version, puis le prépare dans `pending\` ;
3. si Brave est fermé, remplace `extension\` par `pending\`. Si Brave est ouvert, le script reste en veille jusqu'à la fermeture de Brave, installe aussitôt, puis vérifie s'il existe une version encore plus récente.

La veille ne consomme pas de processeur : Windows prévient le script quand le dernier processus `brave.exe` se termine. Pendant la veille, la tâche planifiée ne lance pas d'autre exemplaire du script.

Le chemin du dossier ne change jamais, donc Brave n'a rien à reconfigurer : il lit la nouvelle version à son démarrage suivant. L'extension garde le même ID que sous Linux grâce à la clé publique du manifeste.

### Mise en place

Dans `brave://settings/system`, désactiver **Continuer à exécuter les applications en arrière-plan après la fermeture de Brave**. Sinon Brave ne se ferme jamais vraiment et les mises à jour restent en attente.

Dans une fenêtre PowerShell ordinaire (sans droits administrateur) :

```powershell
$dir = "$env:LOCALAPPDATA\ClaudeUsageTracker"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/main/windows/Update-ClaudeUsageTracker.ps1" -OutFile "$dir\Update-ClaudeUsageTracker.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$dir\Update-ClaudeUsageTracker.ps1" -Install
```

Le script crée la tâche planifiée, installe la dernière version et copie le chemin du dossier dans le presse-papiers. Ensuite, dans Brave :

1. ouvrir `brave://extensions` et activer le **mode développeur** ;
2. cliquer sur **Charger l'extension non empaquetée** et coller le chemin `%LOCALAPPDATA%\ClaudeUsageTracker\extension` (développé, par exemple `C:\Users\<nom>\AppData\Local\ClaudeUsageTracker\extension`) ;
3. supprimer la version du Chrome Web Store si elle est installée.

### Utilisation courante

| Besoin | Commande PowerShell |
|---|---|
| Vérifier tout de suite (Brave fermé) | `Start-ScheduledTask -TaskName ClaudeUsageTracker-Update` |
| Lire le journal | `Get-Content "$env:LOCALAPPDATA\ClaudeUsageTracker\update.log" -Tail 20` |
| Mettre à jour le script lui-même | relancer le bloc de la section « Mise en place » |
| Tout désinstaller | `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\ClaudeUsageTracker\Update-ClaudeUsageTracker.ps1" -Uninstall` |

Après une désinstallation, retirer aussi l'extension dans `brave://extensions`.

### Vérifier l'état

Ce bloc ne fait que lire l'état (après un collage, appuyer sur Entrée pour exécuter la dernière ligne) :

```powershell
$dir = "$env:LOCALAPPDATA\ClaudeUsageTracker"
Write-Host "--- Tâche planifiée"; $t = Get-ScheduledTask -TaskName ClaudeUsageTracker-Update; $i = $t | Get-ScheduledTaskInfo
[pscustomobject]@{ Etat = $t.State; DernierPassage = $i.LastRunTime; Resultat = $i.LastTaskResult; ProchainPassage = $i.NextRunTime } | Format-List
Write-Host "--- Version installée"; (Get-Content "$dir\extension\manifest.json" -Raw | ConvertFrom-Json).version
Write-Host "--- Version en attente"; $p = "$dir\pending\manifest.json"; if (Test-Path $p) { (Get-Content $p -Raw | ConvertFrom-Json).version } else { "aucune" }
Write-Host "--- Brave ouvert"; [bool](Get-Process brave -ErrorAction SilentlyContinue)
Write-Host "--- Journal"; Get-Content "$dir\update.log" -Tail 6
```

| Valeur | Signification |
|---|---|
| Etat `Running`, Resultat `267009` | le script est en veille et attend la fermeture de Brave pour installer la version en attente |
| Etat `Ready`, Resultat `0` | dernier passage réussi, rien en attente |
| Version en attente différente de « aucune » | une mise à jour est téléchargée et sera installée à la fermeture de Brave |

## Installation dans Claude Desktop sous Linux (Bazzite)

L'application officielle Claude Desktop ne charge pas d'extensions. [Claude-WebExtension-Launcher](https://github.com/lugia19/Claude-WebExtension-Launcher) crée une copie modifiée de Claude Desktop, à partir du paquet `.deb` officiel, qui les charge. Cette copie coexiste avec l'application officielle : leurs données sont séparées (`~/.config/Claude-<instance>` pour la copie, `~/.config/Claude` pour l'officielle).

Le lanceur installe lui-même la version d'origine de l'extension (celle de lugia19) dans `~/.local/share/claude-webext-launcher/web-extensions/usage-tracker` et la met à jour à chaque lancement, sauf si ce dossier est un lien symbolique. Le script `linux/update-claude-usage-tracker.sh` remplace donc ce dossier par un lien vers un dossier à lui, qu'il tient à jour à partir de la branche `dist`.

### Fonctionnement du script

Tout est rangé dans `~/.local/share/claude-usage-tracker` :

| Élément | Rôle |
|---|---|
| `versions/<version>/` | versions extraites (la version active et la précédente) |
| `current` | lien vers la version active ; c'est la cible du lien `web-extensions/usage-tracker` du lanceur |
| `pending` | lien vers la version téléchargée en attente de la fermeture de Claude |
| `update.log` | journal des vérifications (500 dernières lignes) |
| `update-claude-usage-tracker.sh` | copie du script lancée par le timer |

Un timer systemd utilisateur, `claude-usage-tracker-update.timer` (fichiers dans `~/.config/systemd/user`, sans droits root), lance le script une minute après l'ouverture de session, puis toutes les 30 minutes. À chaque passage, le script :

1. lit `info.json` sur la branche `dist` ;
2. si la variante Electron publiée est plus récente que la version active, télécharge `claude-usage-tracker-electron.zip`, vérifie son empreinte SHA-256 et sa version, puis l'extrait dans `versions/<version>` ;
3. si aucune instance de la copie modifiée de Claude n'est ouverte, active la nouvelle version : le lien `current` est remplacé d'un seul coup, il n'existe jamais d'instant sans extension. Si Claude est ouvert, la version reste en attente (lien `pending`), une notification du bureau le signale, et elle est activée au premier passage qui trouve Claude fermé : au plus 30 minutes après sa fermeture, ou à l'ouverture de session suivante ;
4. vérifie que `web-extensions/usage-tracker` est un lien vers `current`. La première fois, il remplace le dossier installé par le lanceur, seulement si Claude est fermé.

Claude ne charge ses extensions qu'au démarrage : une version activée sert au lancement suivant de Claude. Le script détecte une instance ouverte comme le lanceur, par le lien `SingletonLock` de son dossier `~/.config/Claude-<instance>`. L'application officielle n'est pas concernée.

Dépendances : `bash`, `curl`, `python3`, `sha256sum`, `flock` et `systemctl`, toutes présentes sur Bazzite. `notify-send`, s'il est présent, sert aux notifications.

### Mise en place

Les commandes se lancent dans un terminal de l'hôte (Konsole), pas dans le conteneur Distrobox de l'application officielle.

1. Installer le lanceur : télécharger l'archive `linux-amd64` de la [dernière version](https://github.com/lugia19/Claude-WebExtension-Launcher/releases/latest), l'extraire et lancer `Claude_WebExtension_Launcher` :

   ```bash
   cd "$(mktemp -d)"
   URL=$(curl -fsSL https://api.github.com/repos/lugia19/Claude-WebExtension-Launcher/releases/latest | python3 -c 'import json, sys; print(next(a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith("-linux-amd64.zip")))')
   curl -fsSLO "$URL"
   python3 -m zipfile -e ./*-linux-amd64.zip .
   chmod +x Claude_WebExtension_Launcher
   ./Claude_WebExtension_Launcher
   ```

   Au premier lancement, le lanceur s'installe dans `~/.local/share/claude-webext-launcher`, propose une entrée dans le menu des applications, télécharge Claude, crée la copie modifiée et l'ouvre. Se connecter, puis **fermer complètement** cette copie de Claude.

2. Installer le script :

   ```bash
   mkdir -p ~/.local/share/claude-usage-tracker
   curl -fsSL -o ~/.local/share/claude-usage-tracker/update-claude-usage-tracker.sh https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/main/linux/update-claude-usage-tracker.sh
   bash ~/.local/share/claude-usage-tracker/update-claude-usage-tracker.sh --install
   ```

   Le script crée le timer, télécharge la dernière version, l'active et remplace le dossier du lanceur par le lien. Si Claude était encore ouvert, il le signale : fermer Claude, puis relancer la dernière commande.

3. Relancer Claude depuis le menu des applications (entrée du lanceur). Le compteur « Claude Usage Tracker (local) » apparaît dans la barre latérale, avec le trait blanc du temps écoulé sur les barres de limite.

Les réglages de la version d'origine de l'extension (installée par le lanceur) ne sont pas repris, puisque l'ID de l'extension change.

### Utilisation courante

| Besoin | Commande |
|---|---|
| Afficher l'état (versions, lien, Claude ouvert, journal) | `~/.local/share/claude-usage-tracker/update-claude-usage-tracker.sh --status` |
| Vérifier tout de suite | `systemctl --user start claude-usage-tracker-update.service` |
| Lire le journal | `tail -n 20 ~/.local/share/claude-usage-tracker/update.log` |
| Voir le prochain passage du timer | `systemctl --user list-timers claude-usage-tracker-update.timer` |
| Mettre à jour le script lui-même | relancer le bloc de l'étape 2 |

### Désinstallation

Fermer la copie modifiée de Claude, puis :

```bash
~/.local/share/claude-usage-tracker/update-claude-usage-tracker.sh --uninstall
```

Le script retire le timer, le lien `web-extensions/usage-tracker` et le dossier `~/.local/share/claude-usage-tracker`. Au lancement suivant de Claude, le lanceur réinstalle la version d'origine de l'extension. Pour retirer aussi le lanceur et la copie modifiée de Claude : `~/.local/share/claude-webext-launcher/Claude_WebExtension_Launcher --uninstall`.

### Limites

- La copie modifiée de Claude n'est pas prise en charge par Anthropic. En cas de problème, vérifier d'abord avec l'application officielle.
- Le menu des applications affiche deux applications Claude : l'officielle et celle du lanceur. Seule celle du lanceur charge l'extension.
- Une nouvelle version n'est activée que Claude fermé et ne sert qu'au lancement suivant. Si Claude reste ouvert en permanence, elle reste en attente.
- Le lanceur reconstruit la copie modifiée quand Anthropic publie une nouvelle version de Claude Desktop. Une nouvelle version peut casser le chargement des extensions jusqu'à une mise à jour du lanceur.

## Synchronisation avec le dépôt d'origine

Quand l'auteur publie une nouvelle version, deux cas :

- **aucun conflit** : le bouton **Sync fork** de la page du dépôt suffit. Il ne suffit que si GitHub ne signale aucun conflit et que la version d'origine ne touche pas au compteur de la zone de chat ni aux barres de limite (sinon le repère de temps écoulé peut rester câblé sur une autre limite que celle affichée, sans conflit visible) ;
- **sinon** : ouvrir la session Claude Code consacrée à ce fork, ou une nouvelle session sur ce dépôt, et écrire :

  ```text
  Nouvelle version d'origine X.Y.Z : synchronise
  ```

  La procédure suivie est décrite dans `CLAUDE.md`. Elle se termine par une demande de fusion vers `main`, à fusionner soi-même.

Le push sur `main` relance la compilation : Brave sous Linux reçoit la mise à jour automatiquement, Brave sous Windows et Claude Desktop sous Linux par leur script.

Les conflits portent sur les fichiers modifiés par ce fork :

- `background.js`, `popup.html`, `popup.js` ;
- `content-components/content_utils.js`, `content-components/notification_card.js`, `content-components/usage_ui.js` ;
- `shared/dataclasses.js`, `tracker-styles.css`, `manifest_chrome.json` ;
- `i18n/en.js`, `i18n/fr.js` et `i18n/all.js` (régénéré par `node common/scripts/build-i18n.js`).

Le sous-module `common` n'est pas modifié : il pointe sur le commit fixé par la version d'origine, et les cartes flottantes qu'il fournit ne sont simplement plus appelées par `content-components/notification_card.js`.
