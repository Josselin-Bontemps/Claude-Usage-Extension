#!/usr/bin/env bash
# Installe et tient à jour Claude Usage Tracker (local) dans la copie de Claude Desktop créée par
# Claude-WebExtension-Launcher (https://github.com/lugia19/Claude-WebExtension-Launcher), sous Linux.
#
# Le lanceur installe lui-même la version d'origine de l'extension dans
# ~/.local/share/claude-webext-launcher/web-extensions/usage-tracker et la remplace à chaque
# lancement, sauf si ce dossier est un lien symbolique. Ce script remplace donc ce dossier par un
# lien vers un dossier à lui, qu'il tient à jour à partir de la branche dist de ce dépôt.
#
# Utilisation :
#   update-claude-usage-tracker.sh --install    copie le script, crée le timer systemd utilisateur
#                                               (toutes les 30 minutes et à l'ouverture de session),
#                                               puis fait une première vérification
#   update-claude-usage-tracker.sh              une vérification (ce que lance le timer)
#   update-claude-usage-tracker.sh --status     affiche l'état sans rien changer
#   update-claude-usage-tracker.sh --uninstall  retire le timer, le lien et le dossier ; le lanceur
#                                               réinstalle la version d'origine au lancement suivant
#
# Une vérification :
#   1. lit info.json sur la branche dist ;
#   2. si la variante Electron publiée est plus récente que la version active, la télécharge,
#      vérifie son empreinte SHA-256 et sa version, et l'extrait dans versions/<version> ;
#   3. si aucune instance de la copie modifiée de Claude n'est ouverte, l'active : le lien current
#      est remplacé d'un seul coup (rename) par un lien vers la nouvelle version. Sinon la version
#      reste en attente (lien pending), une notification le signale, et elle est activée à la
#      première vérification qui trouve Claude fermé (au plus 30 minutes après sa fermeture, ou à
#      l'ouverture de session suivante) ;
#   4. s'assure que web-extensions/usage-tracker est un lien vers current.
#
# Claude ne charge ses extensions qu'au démarrage : une nouvelle version sert au lancement suivant.
#
# Tout est rangé dans ${XDG_DATA_HOME:-~/.local/share}/claude-usage-tracker :
#   versions/<version>/              versions extraites (la version active et la précédente)
#   current                          lien vers la version active (cible du lien du lanceur)
#   pending                          lien vers la version en attente de la fermeture de Claude
#   update.log                       journal des vérifications (500 dernières lignes)
#   update-claude-usage-tracker.sh   copie du script lancée par le timer
#
# Dépendances : bash, curl, python3, sha256sum, flock, systemctl (toutes présentes sur Bazzite).

set -euo pipefail
umask 022

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

# Les variables CUT_* servent aux tests ; elles n'ont pas à être définies en temps normal.
ROOT="${CUT_ROOT:-$DATA_HOME/claude-usage-tracker}"
LAUNCHER_DIR="${CUT_LAUNCHER_DIR:-$DATA_HOME/claude-webext-launcher}"
INFO_URL="${CUT_INFO_URL:-https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/dist/info.json}"
UNIT_DIR="${CUT_UNIT_DIR:-$CONFIG_HOME/systemd/user}"

UNIT_NAME="claude-usage-tracker-update"
SCRIPT_NAME="update-claude-usage-tracker.sh"
EXT_FOLDER="usage-tracker"
VERSIONS_DIR="$ROOT/versions"
CURRENT_LINK="$ROOT/current"
PENDING_LINK="$ROOT/pending"
LOG_FILE="$ROOT/update.log"
LOG_MAX_LINES=500
WEB_EXT_DIR="$LAUNCHER_DIR/web-extensions"
EXT_LINK="$WEB_EXT_DIR/$EXT_FOLDER"

log() {
    local level="${2:-INFO}" line
    line="$(date '+%Y-%m-%d %H:%M:%S') [$level] $1"
    printf '%s\n' "$line"
    if [ -d "$ROOT" ]; then
        printf '%s\n' "$line" >> "$LOG_FILE"
    fi
}

trim_log() {
    if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt "$LOG_MAX_LINES" ]; then
        tail -n "$LOG_MAX_LINES" "$LOG_FILE" > "$LOG_FILE.tmp" && mv -f "$LOG_FILE.tmp" "$LOG_FILE"
    fi
}

die() {
    log "$1" ERREUR
    exit 1
}

for cmd in curl python3 sha256sum flock; do
    command -v "$cmd" > /dev/null 2>&1 || { echo "Commande introuvable : $cmd" >&2; exit 1; }
done

# python3 -I : mode isolé, n'importe rien du dossier courant ni de l'environnement.
py() { python3 -I "$@"; }

# Valeur d'un champ texte d'un fichier JSON (vide s'il manque).
json_field() {
    py -c 'import json, sys
v = json.load(open(sys.argv[1], encoding="utf-8")).get(sys.argv[2], "")
print(v if isinstance(v, str) else "")' "$1" "$2"
}

# Version du manifest.json d'un dossier d'extension, ou rien.
folder_version() {
    [ -f "$1/manifest.json" ] || return 0
    json_field "$1/manifest.json" version 2> /dev/null || true
}

# Vrai si la version $1 est strictement plus récente que $2 (vide = absente).
version_gt() {
    py -c 'import sys
def parse(v):
    return [int(p) for p in v.split(".")] if v else []
a, b = parse(sys.argv[1]), parse(sys.argv[2])
n = max(len(a), len(b))
sys.exit(0 if a + [0] * (n - len(a)) > b + [0] * (n - len(b)) else 1)' "$1" "$2"
}

valid_version() {
    [[ "$1" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]
}

# Vrai si une instance de la copie modifiée de Claude est ouverte. Comme le lanceur : chaque
# instance a son dossier ~/.config/Claude-<nom>, où Electron place un lien SingletonLock vers
# « <machine>-<pid> » tant qu'elle tourne. Un lien laissé par un plantage est écarté en vérifiant
# le processus. L'application officielle (~/.config/Claude, sans tiret) n'est pas concernée.
claude_running() {
    local lock target host pid
    for lock in "$CONFIG_HOME"/Claude-*/SingletonLock; do
        target="$(readlink "$lock" 2> /dev/null)" || continue
        host="${target%-*}"
        pid="${target##*-}"
        [ "$host" != "$target" ] || return 0              # format inconnu : considérée ouverte
        [ "$host" = "$(cat /proc/sys/kernel/hostname)" ] || return 0   # autre machine (dossier partagé)
        [[ "$pid" =~ ^[0-9]+$ ]] || return 0
        [ -d "/proc/$pid" ] && return 0
    done
    return 1
}

link_version() {
    [ -L "$1" ] || return 0
    folder_version "$1"
}

# Remplace le lien $1 par un lien vers $2, d'un seul coup : rename(2) d'un lien sur un lien est
# atomique, il n'existe jamais d'instant sans lien.
# Le lien temporaire est créé à côté du lien final, pour rester sur le même système de fichiers.
swap_link() {
    local link="$1" target="$2" tmp
    tmp="$(dirname "$1")/.$(basename "$1").new.$$"     # caché, et nettoyé si un passage est interrompu
    rm -f "$tmp" && ln -s "$target" "$tmp" && mv -fT "$tmp" "$link"
}

notify() {
    if command -v notify-send > /dev/null 2>&1; then
        notify-send --app-name="Claude Usage Tracker" "Claude Usage Tracker (local)" "$1" 2> /dev/null || true
    fi
}

# Télécharge et extrait la version publiée si elle est plus récente que la version active et que
# la version en attente. Écrit la version à activer (ou rien) sur la sortie standard.
download_if_newer() {
    local tmp info published url sha active pending archive got dest stage extracted
    tmp="$(mktemp -d "$ROOT/download.XXXXXX")"
    # La fonction tourne dans un sous-shell (« $(...) ») : le trap EXIT ne vaut que pour elle.
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" EXIT

    info="$tmp/info.json"
    curl -fsSL --retry 2 --connect-timeout 20 --max-time 120 -o "$info" "$INFO_URL" \
        || { log "Lecture d'info.json impossible ($INFO_URL)." ERREUR >&2; return 1; }
    published="$(json_field "$info" electron_version)"
    url="$(json_field "$info" electron_zip)"
    sha="$(json_field "$info" electron_zip_sha256 | tr 'A-F' 'a-f')"
    if [ -z "$published" ] || [ -z "$url" ] || [ -z "$sha" ]; then
        log "info.json ne décrit pas de variante Electron (champs electron_*)." ERREUR >&2
        return 1
    fi
    valid_version "$published" || { log "Version publiée invalide : $published." ERREUR >&2; return 1; }

    active="$(link_version "$CURRENT_LINK")"
    pending="$(link_version "$PENDING_LINK")"
    if [ -n "$active" ] && ! version_gt "$published" "$active"; then
        log "À jour : version active $active, version publiée $published." >&2
        rm -f "$PENDING_LINK"
        return 0
    fi
    if [ -n "$pending" ] && [ "$pending" = "$published" ]; then
        log "Version $published déjà téléchargée." >&2
        printf '%s\n' "$published"
        return 0
    fi

    dest="$VERSIONS_DIR/$published"
    if [ "$(folder_version "$dest")" != "$published" ]; then
        log "Téléchargement de la version $published." >&2
        archive="$tmp/extension.zip"
        curl -fsSL --retry 2 --connect-timeout 20 --max-time 300 -o "$archive" "$url" \
            || { log "Téléchargement impossible ($url)." ERREUR >&2; return 1; }

        # raw.githubusercontent.com garde chaque fichier en cache jusqu'à 5 minutes : juste après
        # une publication, info.json et le .zip peuvent venir de deux compilations différentes.
        # L'empreinte le détecte, et la vérification suivante réessaie.
        got="$(sha256sum "$archive" | cut -d' ' -f1)"
        if [ "$got" != "$sha" ]; then
            log "Empreinte SHA-256 du .zip différente de celle d'info.json (publication récente encore en cache, ou fichier altéré). Nouvel essai à la prochaine vérification." ERREUR >&2
            return 1
        fi

        stage="$tmp/extension"
        # zipfile écarte les chemins absolus et les « .. » des entrées.
        py -c 'import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$archive" "$stage" \
            || { log "Extraction du .zip impossible." ERREUR >&2; return 1; }
        extracted="$(folder_version "$stage")"
        if [ "$extracted" != "$published" ]; then
            log "Le .zip contient la version ${extracted:-inconnue} au lieu de $published." ERREUR >&2
            return 1
        fi

        if ! { mkdir -p "$VERSIONS_DIR" && rm -rf "$dest" && mv -T "$stage" "$dest"; }; then
            log "Copie de la version $published dans $dest impossible." ERREUR >&2
            return 1
        fi
    fi
    printf '%s\n' "$published"
}

# Fait de web-extensions/usage-tracker un lien vers current. Le dossier installé par le lanceur
# n'est remplacé que si Claude est fermé, puisqu'il est alors en cours d'utilisation.
ensure_launcher_link() {
    local expected="$CURRENT_LINK" target aside
    if [ ! -d "$LAUNCHER_DIR" ]; then
        log "Lanceur introuvable ($LAUNCHER_DIR) : lancer d'abord Claude_WebExtension_Launcher une fois." ERREUR
        return 1
    fi
    if [ -L "$WEB_EXT_DIR" ]; then
        log "$WEB_EXT_DIR est un lien symbolique : le lanceur n'y met plus rien à jour, rien n'est changé." ATTENTION
        return 0
    fi
    mkdir -p "$WEB_EXT_DIR"
    rm -f "$WEB_EXT_DIR/.$EXT_FOLDER".new.*          # reste d'un passage interrompu

    if [ -L "$EXT_LINK" ]; then
        target="$(readlink "$EXT_LINK")"
        [ "$target" = "$expected" ] && return 0
        log "Le lien $EXT_LINK pointait vers $target : il pointe désormais vers $expected."
        swap_link "$EXT_LINK" "$expected"
        return
    fi

    if [ -e "$EXT_LINK" ]; then
        if claude_running; then
            log "Claude est ouvert : le dossier installé par le lanceur sera remplacé à la prochaine vérification, Claude fermé."
            return 0
        fi
        # Un lien ne peut pas remplacer un dossier par rename : le dossier est d'abord écarté (hors
        # de web-extensions, que Claude parcourt), puis le lien prend sa place aussitôt.
        aside="$ROOT/launcher-folder.$$"
        rm -rf "$aside"
        if ! mv -T "$EXT_LINK" "$aside"; then
            log "Impossible d'écarter le dossier $EXT_LINK." ERREUR
            return 1
        fi
        if ! ln -sT "$expected" "$EXT_LINK"; then
            mv -T "$aside" "$EXT_LINK"
            log "Création du lien $EXT_LINK impossible." ERREUR
            return 1
        fi
        rm -rf "$aside"
        log "Dossier installé par le lanceur remplacé par un lien vers $expected."
        return 0
    fi

    ln -sT "$expected" "$EXT_LINK" || return 1
    log "Lien $EXT_LINK créé."
}

# Garde la version active et la précédente, plus la version en attente.
prune_versions() {
    local keep_active keep_pending dir name
    [ -d "$VERSIONS_DIR" ] || return 0
    keep_active="$(basename "$(readlink "$CURRENT_LINK" 2> /dev/null || echo none)")"
    keep_pending="$(basename "$(readlink "$PENDING_LINK" 2> /dev/null || echo none)")"
    local -a others=()
    for dir in "$VERSIONS_DIR"/*/; do
        [ -d "$dir" ] || continue
        name="$(basename "$dir")"
        [ "$name" = "$keep_active" ] || [ "$name" = "$keep_pending" ] || others+=("$name")
    done
    [ "${#others[@]}" -gt 0 ] || return 0
    # Tri par version, la plus récente en dernier : elle est gardée comme version précédente.
    mapfile -t others < <(printf '%s\n' "${others[@]}" | sort -V)
    unset 'others[${#others[@]}-1]'
    for name in "${others[@]}"; do
        rm -rf "${VERSIONS_DIR:?}/$name"
    done
}

check() {
    local version active status=0
    version="$(download_if_newer)" || status=1
    # Vérification impossible (réseau...) : une version déjà en attente peut quand même être activée.
    [ -n "$version" ] || [ "$status" -eq 0 ] || version="$(link_version "$PENDING_LINK")"

    if [ -n "$version" ]; then
        active="$(link_version "$CURRENT_LINK")"
        if [ -n "$active" ] && claude_running; then
            if [ "$(link_version "$PENDING_LINK")" != "$version" ]; then
                swap_link "$PENDING_LINK" "versions/$version"
                log "Claude est ouvert : la version $version sera activée à la prochaine vérification, Claude fermé."
                notify "La version $version est prête. Elle sera activée une fois Claude fermé, puis servira au lancement suivant."
            fi
        else
            swap_link "$CURRENT_LINK" "versions/$version"
            rm -f "$PENDING_LINK"
            if [ -n "$active" ]; then
                log "Version $version activée (remplace $active). Elle sert au prochain lancement de Claude."
            else
                log "Version $version activée."
            fi
        fi
    fi

    if [ -L "$CURRENT_LINK" ]; then
        ensure_launcher_link || status=1
        prune_versions
    fi
    trim_log
    return "$status"
}

write_units() {
    local script="$1"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/$UNIT_NAME.service" <<EOF
[Unit]
Description=Mise à jour de Claude Usage Tracker (local) pour Claude Desktop
After=network-online.target

[Service]
Type=oneshot
ExecStart="$script"
EOF
    cat > "$UNIT_DIR/$UNIT_NAME.timer" <<EOF
[Unit]
Description=Vérifie les mises à jour de Claude Usage Tracker (local) toutes les 30 minutes

[Timer]
OnStartupSec=1min
OnUnitActiveSec=30min
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF
}

do_install() {
    local target="$ROOT/$SCRIPT_NAME" self
    mkdir -p "$ROOT"
    self="$(readlink -f "$0")"
    if [ "$self" != "$(readlink -f "$target" 2> /dev/null || echo "$target")" ]; then
        cp -f "$self" "$target.tmp"
        chmod 755 "$target.tmp"
        mv -f "$target.tmp" "$target"
    fi
    # Le script a pu être téléchargé directement à sa place, sans droit d'exécution : le timer et
    # les commandes de la documentation le lancent sans passer par bash.
    chmod 755 "$target"
    write_units "$target"
    if [ -z "${CUT_NO_SYSTEMD:-}" ]; then
        systemctl --user daemon-reload
        systemctl --user enable --now "$UNIT_NAME.timer" > /dev/null
    fi
    log "Timer systemd « $UNIT_NAME.timer » activé (vérification toutes les 30 minutes et à l'ouverture de session)."
    local status=0
    check || status=$?
    echo
    if [ -L "$EXT_LINK" ]; then
        echo "Installé. Relancer la copie modifiée de Claude pour charger cette version de l'extension."
    elif [ -e "$EXT_LINK" ]; then
        echo "Version téléchargée. Fermer la copie modifiée de Claude, puis relancer : $ROOT/$SCRIPT_NAME"
    fi
    return "$status"
}

do_uninstall() {
    if claude_running; then
        echo "Claude (copie modifiée) est ouvert : le fermer, puis relancer la désinstallation." >&2
        exit 1
    fi
    if [ -z "${CUT_NO_SYSTEMD:-}" ]; then
        systemctl --user disable --now "$UNIT_NAME.timer" > /dev/null 2>&1 || true
    fi
    rm -f "$UNIT_DIR/$UNIT_NAME.timer" "$UNIT_DIR/$UNIT_NAME.service"
    if [ -z "${CUT_NO_SYSTEMD:-}" ]; then
        systemctl --user daemon-reload || true
    fi
    if [ -L "$EXT_LINK" ] && [ "$(readlink "$EXT_LINK")" = "$CURRENT_LINK" ]; then
        rm -f "$EXT_LINK"
    fi
    rm -rf "$ROOT"
    echo "Timer, lien et dossier $ROOT supprimés. Le lanceur réinstallera la version d'origine de l'extension au prochain lancement de Claude."
}

do_status() {
    echo "--- Timer"
    if [ -z "${CUT_NO_SYSTEMD:-}" ]; then
        systemctl --user list-timers "$UNIT_NAME.timer" --all --no-pager 2> /dev/null | head -n 2 || true
        echo "Dernier résultat : $(systemctl --user show -p Result --value "$UNIT_NAME.service" 2> /dev/null || echo inconnu)"
    fi
    echo "--- Version active : $(link_version "$CURRENT_LINK" | grep . || echo aucune)"
    echo "--- Version en attente : $(link_version "$PENDING_LINK" | grep . || echo aucune)"
    if [ -L "$EXT_LINK" ]; then
        echo "--- Lien du lanceur : $EXT_LINK -> $(readlink "$EXT_LINK")"
    elif [ -e "$EXT_LINK" ]; then
        echo "--- Lien du lanceur : pas encore créé (dossier d'origine du lanceur, version $(folder_version "$EXT_LINK"))"
    else
        echo "--- Lien du lanceur : absent"
    fi
    echo "--- Claude (copie modifiée) ouvert : $(claude_running && echo oui || echo non)"
    echo "--- Journal"
    tail -n 6 "$LOG_FILE" 2> /dev/null || echo "vide"
}

case "${1:-}" in
    --install)   mode=install ;;
    --uninstall) mode=uninstall ;;
    --status)    do_status; exit 0 ;;
    "")          mode=check ;;
    -h|--help)   sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *)           echo "Paramètre inconnu : $1 (--install, --uninstall, --status ou rien)" >&2; exit 2 ;;
esac

if [ "$mode" = check ] && [ ! -d "$ROOT" ]; then
    echo "Dossier $ROOT introuvable. Lancer d'abord le script avec --install." >&2
    exit 1
fi
mkdir -p "$ROOT"

# Une seule exécution à la fois (timer et lancement manuel).
exec 9> "$ROOT/.lock"
if ! flock -w 60 9; then
    die "Une autre vérification est en cours."
fi

case "$mode" in
    install)   do_install ;;
    uninstall) exec 9>&-; do_uninstall ;;
    check)     check ;;
esac
