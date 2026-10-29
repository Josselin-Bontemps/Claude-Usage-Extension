<#
.SYNOPSIS
    Installe et tient à jour Claude Usage Tracker (local) pour Brave sous Windows.

.DESCRIPTION
    Sous Windows, Brave n'installe par stratégie une extension hors Chrome Web Store que sur un
    ordinateur géré par une entreprise. Ce script remplace ce mécanisme : il télécharge la dernière
    compilation publiée sur la branche dist du dépôt et la place dans un dossier que Brave charge
    comme extension non empaquetée.

    Sans paramètre, le script fait une vérification :
      1. lit info.json sur la branche dist ;
      2. si la version publiée est plus récente que celle du dossier de l'extension, télécharge le
         .zip, vérifie son empreinte SHA-256 et le prépare dans le dossier pending ;
      3. installe la version préparée si Brave est fermé (ou si l'extension n'est pas encore
         installée). Sinon, elle attend la prochaine vérification où Brave sera fermé.

    -Install  crée le dossier, copie le script, crée la tâche planifiée (toutes les 30 minutes,
              sans droits administrateur) et fait une première vérification.
    -Uninstall supprime la tâche planifiée et le dossier.

    Tout est rangé dans %LOCALAPPDATA%\ClaudeUsageTracker :
      extension\                    dossier à charger dans brave://extensions
      pending\                      version téléchargée en attente de la fermeture de Brave
      update.log                    journal des vérifications
      Update-ClaudeUsageTracker.ps1 copie de ce script utilisée par la tâche planifiée

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-ClaudeUsageTracker.ps1 -Install
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'ClaudeUsageTracker'),
    [string]$InfoUrl = 'https://raw.githubusercontent.com/Josselin-Bontemps/Claude-Usage-Extension/dist/info.json'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # La barre de progression ralentit beaucoup Invoke-WebRequest.

$TaskName      = 'ClaudeUsageTracker-Update'
$ScriptName    = 'Update-ClaudeUsageTracker.ps1'
$ExtensionDir  = Join-Path $Root 'extension'
$PendingDir    = Join-Path $Root 'pending'
$LogFile       = Join-Path $Root 'update.log'
$LogMaxLines   = 500

# Windows PowerShell 5.1 n'active pas toujours TLS 1.2, exigé par GitHub.
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    if (Test-Path $Root) {
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    }
}

function Limit-Log {
    if (Test-Path $LogFile) {
        $lines = Get-Content -Path $LogFile -Encoding UTF8
        if ($lines.Count -gt $LogMaxLines) {
            $lines | Select-Object -Last $LogMaxLines | Set-Content -Path $LogFile -Encoding UTF8
        }
    }
}

# Version lue dans le manifest.json d'un dossier d'extension, ou $null.
function Get-FolderVersion {
    param([string]$Dir)
    $manifest = Join-Path $Dir 'manifest.json'
    if (-not (Test-Path $manifest)) { return $null }
    try {
        $json = Get-Content -Path $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
        return [version]$json.version
    } catch {
        return $null
    }
}

function Test-BraveRunning {
    return [bool](Get-Process -Name 'brave' -ErrorAction SilentlyContinue)
}

function Remove-Folder {
    param([string]$Dir)
    if (Test-Path $Dir) { Remove-Item -Path $Dir -Recurse -Force }
}

# Télécharge la version publiée dans pending\ si elle est plus récente que ce qui est installé ou
# déjà préparé.
function Update-Pending {
    $info = Invoke-RestMethod -Uri $InfoUrl -UseBasicParsing
    $published = [version]$info.version
    $installed = Get-FolderVersion $ExtensionDir
    $pending   = Get-FolderVersion $PendingDir

    if ($installed -and $published -le $installed) {
        Write-Log "À jour : version installée $installed, version publiée $published."
        Remove-Folder $PendingDir
        return
    }
    if ($pending -and $pending -eq $published) {
        Write-Log "Version $published déjà téléchargée."
        return
    }

    $tempZip = Join-Path $Root 'download.zip'
    $tempDir = Join-Path $Root 'pending.new'
    try {
        Write-Log "Téléchargement de la version $published."
        Invoke-WebRequest -Uri $info.zip -OutFile $tempZip -UseBasicParsing

        # raw.githubusercontent.com garde chaque fichier en cache jusqu'à 5 minutes : juste après une
        # publication, info.json et le .zip peuvent venir de deux compilations différentes. L'empreinte
        # le détecte, et le passage suivant réessaie.
        if ($info.zip_sha256) {
            $hash = (Get-FileHash -Path $tempZip -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne $info.zip_sha256.ToLowerInvariant()) {
                throw "Empreinte SHA-256 du .zip différente de celle d'info.json (publication récente encore en cache, ou fichier altéré). Nouvel essai au prochain passage."
            }
        }

        Remove-Folder $tempDir
        Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force
        $extracted = Get-FolderVersion $tempDir
        if ($extracted -ne $published) {
            throw "Le .zip contient la version $extracted au lieu de $published."
        }

        Remove-Folder $PendingDir
        Move-Item -Path $tempDir -Destination $PendingDir
        Write-Log "Version $published prête à être installée."
    } finally {
        if (Test-Path $tempZip) { Remove-Item -Path $tempZip -Force }
        Remove-Folder $tempDir
    }
}

# Remplace extension\ par pending\. Le dossier garde le même chemin, donc Brave n'a rien à
# reconfigurer : il lit la nouvelle version à son prochain démarrage.
function Install-Pending {
    $pending = Get-FolderVersion $PendingDir
    if (-not $pending) { return }

    $installed = Get-FolderVersion $ExtensionDir
    if ($installed -and (Test-BraveRunning)) {
        Write-Log "Brave est ouvert : la version $pending sera installée à la prochaine vérification où Brave sera fermé."
        return
    }

    $oldDir = Join-Path $Root 'extension.old'
    Remove-Folder $oldDir
    if (Test-Path $ExtensionDir) { Move-Item -Path $ExtensionDir -Destination $oldDir }
    try {
        Move-Item -Path $PendingDir -Destination $ExtensionDir
    } catch {
        if (Test-Path $oldDir) { Move-Item -Path $oldDir -Destination $ExtensionDir }
        throw
    }
    Remove-Folder $oldDir

    if ($installed) {
        Write-Log "Version $pending installée (remplace $installed)."
    } else {
        Write-Log "Version $pending installée dans $ExtensionDir."
    }
}

function Invoke-Check {
    try {
        Update-Pending
    } catch {
        Write-Log "Vérification impossible : $($_.Exception.Message)" 'ERREUR'
    }
    try {
        Install-Pending
    } catch {
        Write-Log "Installation impossible : $($_.Exception.Message)" 'ERREUR'
    }
    Limit-Log
}

function Register-UpdateTask {
    $scriptPath = Join-Path $Root $ScriptName
    # conhost --headless lance PowerShell sans ouvrir de fenêtre.
    $arguments = '--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath
    $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arguments -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description 'Installe les nouvelles versions de Claude Usage Tracker (local) pour Brave.' -Force | Out-Null
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Folder $Root
    Write-Host "Tâche planifiée et dossier $Root supprimés. Retire aussi l'extension dans brave://extensions."
    return
}

if ($Install) {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    $target = Join-Path $Root $ScriptName
    if ($PSCommandPath -and ((Resolve-Path $PSCommandPath).Path -ne $target)) {
        Copy-Item -Path $PSCommandPath -Destination $target -Force
    }
    Register-UpdateTask
    Write-Log "Tâche planifiée « $TaskName » créée (vérification toutes les 30 minutes)."
    Invoke-Check

    if (Get-FolderVersion $ExtensionDir) {
        try { Set-Clipboard -Value $ExtensionDir } catch { }
        Write-Host ''
        Write-Host 'Dernière étape dans Brave :'
        Write-Host '  1. Ouvrir brave://extensions et activer le mode développeur.'
        Write-Host '  2. Cliquer sur « Charger l''extension non empaquetée » et choisir ce dossier (déjà copié dans le presse-papiers) :'
        Write-Host "     $ExtensionDir"
    }
    return
}

if (-not (Test-Path $Root)) {
    Write-Host "Dossier $Root introuvable. Lancer d'abord le script avec -Install."
    exit 1
}
Invoke-Check
