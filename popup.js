'use strict';
let CONFIG;
const BLUE_HIGHLIGHT = '#2c84db';
const RED_WARNING = '#de2929';
const SUCCESS_GREEN = '#22c55e';
const WARNING_THRESHOLD = 0.9;

const LIMIT_LABEL_KEYS = {
    session: 'usage.label_session',
    weekly: 'usage.label_weekly',
    sonnetWeekly: 'usage.label_sonnet_weekly',
    opusWeekly: 'usage.label_opus_weekly',
    fableWeekly: 'usage.label_fable_weekly',
    extraUsage: 'usage.label_extra'
};

function getTimeMarkerPct(key, resetsAt) {
    if (!resetsAt) return null;
    const now = Date.now();
    const remaining = resetsAt - now;
    let windowMs = null;
    if (key === 'session') {
        windowMs = 5 * 60 * 60 * 1000;
    } else if (key && key.toLowerCase().includes('weekly')) {
        windowMs = 7 * 24 * 60 * 60 * 1000;
    }
    if (!windowMs || remaining <= 0 || remaining > windowMs) return null;
    const elapsed = windowMs - remaining;
    return Math.min(Math.max((elapsed / windowMs) * 100, 0), 100);
}

function createProgressBar(percentage, key, resetsAt) {
    const container = document.createElement('div');
    container.className = 'ut-progress';

    const track = document.createElement('div');
    track.className = 'ut-progress-track';

    const bar = document.createElement('div');
    bar.className = 'ut-progress-bar';
    bar.style.width = `${Math.min(percentage, 100)}%`;
    bar.style.background = percentage >= WARNING_THRESHOLD * 100 ? RED_WARNING : BLUE_HIGHLIGHT;

    track.appendChild(bar);

    if (key && resetsAt) {
        const markerPct = getTimeMarkerPct(key, resetsAt);
        const marker = document.createElement('div');
        marker.className = 'ut-time-marker';
        marker.dataset.markerKey = key;
        marker.dataset.markerResetsAt = String(resetsAt);
        if (markerPct !== null) {
            marker.style.left = `${markerPct}%`;
            track.title = `Temps écoulé : ${markerPct.toFixed(0)} % de la plage`;
        } else {
            marker.style.display = 'none';
        }
        track.appendChild(marker);
    }

    container.appendChild(track);
    return container;
}

function formatResetTime(timestamp) {
    if (!timestamp) return '';
    const diff = timestamp - Date.now();
    if (diff <= 0) return `<span style="color: ${SUCCESS_GREEN}">${localize('common.resetting')}</span>`;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return localize('time.dh', { d: days, h: remainingHours });
    }
    if (hours === 0) return localize('time.m', { m: minutes });
    return localize('time.hm', { h: hours, m: minutes });
}

function createLimitRow(key, limit) {
    const row = document.createElement('div');
    row.className = 'ut-limit-row ut-mb-2';

    const topLine = document.createElement('div');
    topLine.className = 'ut-row ut-justify-between ut-mb-1 ut-select-none';
    topLine.style.whiteSpace = 'nowrap';

    const leftSide = document.createElement('div');
    leftSide.className = 'ut-row';

    const title = document.createElement('span');
    title.style.cssText = 'font-size: 12px; min-width: 95px; display: inline-block;';
    title.textContent = LIMIT_LABEL_KEYS[key] ? localize(LIMIT_LABEL_KEYS[key]) : key;

    const percentage = document.createElement('span');
    percentage.style.cssText = 'font-size: 12px; min-width: 30px;';
    percentage.textContent = `${limit.percentage.toFixed(0)}%`;
    percentage.style.color = limit.percentage >= WARNING_THRESHOLD * 100 ? RED_WARNING : BLUE_HIGHLIGHT;

    leftSide.appendChild(title);
    leftSide.appendChild(percentage);

    const resetTime = document.createElement('div');
    resetTime.style.cssText = 'font-size: 11px; color: #888;';
    resetTime.dataset.resetsAt = limit.resetsAt || '';
    resetTime.innerHTML = formatResetTime(limit.resetsAt);

    topLine.appendChild(leftSide);
    topLine.appendChild(resetTime);

    row.appendChild(topLine);
    row.appendChild(createProgressBar(limit.percentage, key, limit.resetsAt));

    return row;
}

function renderOrgUsage(orgResult, showLabel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'popup-org-section';

    if (showLabel) {
        const header = document.createElement('div');
        header.className = 'popup-org-header';
        header.textContent = orgResult.orgName || orgResult.orgId.substring(0, 12) + '...';
        wrapper.appendChild(header);
    }

    const usageData = new UsageData(orgResult.usageData);
    const activeLimits = usageData.getActiveLimits();

    if (activeLimits.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'popup-empty';
        empty.textContent = usageData.subscriptionTier === 'claude_free'
            ? localize('usage.free_hint')
            : localize('usage.limits_unavailable');
        wrapper.appendChild(empty);
        return wrapper;
    }

    for (const limit of activeLimits) {
        wrapper.appendChild(createLimitRow(limit.key, limit));
    }

    if (usageData.hasExtraUsageConfigured()) {
        const effectiveTotal = usageData.getExtraUsageEffectiveTotal();
        const used = usageData.extraUsage.usedCredits;
        const pct = effectiveTotal > 0 ? (used / effectiveTotal) * 100 : 0;

        const row = createLimitRow('extraUsage', { percentage: pct, resetsAt: null });
        wrapper.appendChild(row);
    }

    return wrapper;
}

function renderOrgUnavailable(orgResult, showLabel, message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'popup-org-section';

    if (showLabel) {
        const header = document.createElement('div');
        header.className = 'popup-org-header';
        header.textContent = orgResult.orgName || orgResult.orgId.substring(0, 12) + '...';
        wrapper.appendChild(header);
    }

    const msg = document.createElement('div');
    msg.className = 'popup-empty';
    msg.textContent = message;
    wrapper.appendChild(msg);

    return wrapper;
}

function applyStaticLocalization() {
    const loadingEl = document.querySelector('#usage-container .popup-loading');
    if (loadingEl) loadingEl.textContent = localize('popup.loading');
    const helpEl = document.getElementById('popup-help');
    if (helpEl) helpEl.textContent = localize('popup.help');
    const debugEl = document.getElementById('debug');
    if (debugEl) debugEl.textContent = localize('shared.view_debug_logs');
}

async function loadUsageData() {
    const container = document.getElementById('usage-container');

    const stored = await browser.storage.local.get('lastLang');
    pinLocale(stored.lastLang || 'en');
    applyStaticLocalization();

    try {
        CONFIG = await chrome.runtime.sendMessage({ type: 'getConfig' });
        const results = await chrome.runtime.sendMessage({ type: 'getPopupUsageData' });

        if (!results || results.length === 0) {
            container.innerHTML = `<div class="popup-empty">${localize('popup.no_data')}</div>`;
            return;
        }

        container.innerHTML = '';
        const showOrgLabels = results.length > 1;
        const { isBrave } = await browser.storage.local.get('isBrave');
        const unavailableMsg = localize(isBrave ? 'popup.org_no_tab' : 'popup.org_unavailable');

        for (const orgResult of results) {
            container.appendChild(orgResult.error
                ? renderOrgUnavailable(orgResult, showOrgLabels, unavailableMsg)
                : renderOrgUsage(orgResult, showOrgLabels));
        }

        setInterval(() => {
            document.querySelectorAll('.ut-time-marker').forEach(marker => {
                const key = marker.dataset.markerKey;
                const resetsAt = parseInt(marker.dataset.markerResetsAt, 10);
                const pct = getTimeMarkerPct(key, resetsAt);
                if (pct !== null) {
                    marker.style.display = 'block';
                    marker.style.left = `${pct}%`;
                    if (marker.parentElement) {
                        marker.parentElement.title = `Temps écoulé : ${pct.toFixed(0)} % de la plage`;
                    }
                } else {
                    marker.style.display = 'none';
                    if (marker.parentElement) {
                        marker.parentElement.removeAttribute('title');
                    }
                }
            });
        }, 1000);

        setInterval(() => {
            document.querySelectorAll('[data-resets-at]').forEach(el => {
                const resetsAt = parseInt(el.dataset.resetsAt, 10);
                if (resetsAt) el.innerHTML = formatResetTime(resetsAt);
            });
        }, 1000);
    } catch (error) {
        console.error('Error loading usage data in popup:', error);
        container.innerHTML = '<div class="popup-error">Failed to load usage data.</div>';
    }
}

document.getElementById('debug').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('common/log/viewer.html') });
    window.close();
});

loadUsageData();