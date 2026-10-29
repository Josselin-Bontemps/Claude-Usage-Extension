'use strict';

const EXPIRY_GRACE_MS = 60 * 1000;
const EXPIRY_RETRY_BASE_MS = 30 * 1000;
const EXPIRY_RETRY_MAX_MS = 5 * 60 * 1000;

class UsageSection {
    constructor() {
        this.elements = this.createElement();
        this.limitBars = new Map();
        this.hiddenKeys = new Set();
        this.notice = null;
    }

    createElement() {
        const container = document.createElement('div');
        container.className = 'ut-container';

        const barsContainer = document.createElement('div');
        barsContainer.className = 'ut-bars-container';

        container.appendChild(barsContainer);
        return { container, barsContainer };
    }

    createLimitBar(limitKey) {
        const row = document.createElement('div');
        row.className = 'ut-limit-row ut-mb-2';

        const topLine = document.createElement('div');
        topLine.className = 'text-text-000 ut-row ut-justify-between ut-mb-1 ut-select-none';
        topLine.style.whiteSpace = 'nowrap';

        const leftSide = document.createElement('div');
        leftSide.className = 'ut-row';

        const title = document.createElement('span');
        title.className = 'text-xs';
        title.textContent = this.getLimitLabel(limitKey);
        title.style.minWidth = '95px';
        title.style.display = 'inline-block';

        const percentage = document.createElement('span');
        percentage.className = 'text-xs';
        percentage.style.minWidth = '30px';

        leftSide.appendChild(title);
        leftSide.appendChild(percentage);

        const resetTime = document.createElement('div');
        resetTime.className = 'text-text-400 text-xs';

        topLine.appendChild(leftSide);
        topLine.appendChild(resetTime);

        const progressBar = new ProgressBar();

        row.appendChild(topLine);
        row.appendChild(progressBar.container);

        return { row, percentage, resetTime, progressBar };
    }

    getLimitLabel(limitKey) {
        const labelKeys = {
            session: 'usage.label_session',
            weekly: 'usage.label_weekly',
            sonnetWeekly: 'usage.label_sonnet_weekly',
            opusWeekly: 'usage.label_opus_weekly',
            fableWeekly: 'usage.label_fable_weekly',
            extraUsage: 'usage.label_extra'
        };
        return labelKeys[limitKey] ? localize(labelKeys[limitKey]) : limitKey;
    }

    getTimeMarkerPct(key, resetsAt) {
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

    render(usageData) {
        if (!usageData) return;

        const activeLimits = usageData.getActiveLimits();
        const { barsContainer } = this.elements;
        const seenKeys = new Set();

        for (const limit of activeLimits) {
            if (this.hiddenKeys.has(limit.key)) continue;

            seenKeys.add(limit.key);
            let barElements = this.limitBars.get(limit.key);

            if (!barElements) {
                barElements = this.createLimitBar(limit.key);
                this.limitBars.set(limit.key, barElements);
                barsContainer.appendChild(barElements.row);
            }

            const { percentage, resetTime, progressBar } = barElements;

            progressBar.updateProgress(limit.percentage, 100);

            let cap = CONFIG.ESTIMATED_CAPS?.[usageData.subscriptionTier]?.[limit.key];
            if (limit.key === 'session' && isPeakHours()) cap = cap / CONFIG.PEAK_SESSION_MULTIPLIER;
            
            const timePct = this.getTimeMarkerPct(limit.key, limit.resetsAt);
            if (timePct !== null) {
                progressBar.setTimeMarker(timePct);
            } else {
                progressBar.setTimeMarker(null);
            }

            const timeText = timePct !== null ? `\nTemps écoulé : ${timePct.toFixed(0)} % de la plage` : '';

            if (cap) {
                const used = Math.round((limit.percentage / 100) * cap);
                const tokensText = localize('usage.tooltip_tokens', { used: fmtNum(used), cap: fmtNum(cap), pct: limit.percentage.toFixed(0) });
                progressBar.tooltip.updateText(tokensText + timeText);
            } else {
                const pctText = localize('usage.tooltip_pct_used', { pct: limit.percentage.toFixed(0) });
                progressBar.tooltip.updateText(pctText + timeText);
            }

            const color = limit.percentage >= CONFIG.WARNING_THRESHOLD * 100 ? RED_WARNING : BLUE_HIGHLIGHT;
            percentage.textContent = `${limit.percentage.toFixed(0)}%`;
            percentage.style.color = color;

            resetTime.innerHTML = this.formatResetTime(limit.resetsAt);
        }

        if (usageData.hasExtraUsageConfigured() && !this.hiddenKeys.has('extraUsage')) {
            seenKeys.add('extraUsage');
            let barElements = this.limitBars.get('extraUsage');

            if (!barElements) {
                barElements = this.createLimitBar('extraUsage');
                this.limitBars.set('extraUsage', barElements);
                barsContainer.appendChild(barElements.row);
            }

            const { percentage, resetTime, progressBar } = barElements;
            const effectiveTotal = usageData.getExtraUsageEffectiveTotal();
            const used = usageData.extraUsage.usedCredits;
            const pct = effectiveTotal > 0 ? (used / effectiveTotal) * 100 : 0;

            progressBar.updateProgress(pct, 100);

            const usedDollars = (used / 100).toFixed(2);
            const totalDollars = (effectiveTotal / 100).toFixed(2);
            progressBar.tooltip.updateText(localize('usage.tooltip_dollars', { used: usedDollars, total: totalDollars }));

            const color = pct >= CONFIG.WARNING_THRESHOLD * 100 ? RED_WARNING : BLUE_HIGHLIGHT;
            percentage.textContent = `${pct.toFixed(0)}%`;
            percentage.style.color = color;

            resetTime.innerHTML = '';
        }

        for (const [key, barElements] of this.limitBars) {
            if (!seenKeys.has(key)) {
                barElements.row.remove();
                this.limitBars.delete(key);
            }
        }

        for (const key of seenKeys) {
            barsContainer.appendChild(this.limitBars.get(key).row);
        }

        this.renderNotice(usageData);
    }

    renderNotice(usageData) {
        if (!usageData.hasNoReportedUsage()) {
            if (this.notice) {
                this.notice.remove();
                this.notice = null;
            }
            return;
        }

        if (!this.notice) {
            this.notice = document.createElement('div');
            this.notice.className = 'ut-usage-notice text-text-400 text-xs';
            this.elements.barsContainer.appendChild(this.notice);
        }

        this.notice.replaceChildren();

        if (usageData.subscriptionTier !== 'claude_free') {
            this.notice.textContent = localize('usage.limits_unavailable');
            return;
        }

        const hint = document.createElement('div');
        hint.textContent = localize('usage.free_hint');

        const caveat = document.createElement('div');
        caveat.className = 'ut-usage-notice-caveat';
        caveat.textContent = localize('usage.free_caveat');

        this.notice.append(hint, caveat);
    }

    formatResetTime(timestamp) {
        if (!timestamp) return '';
        const diff = timestamp - Date.now();
        if (diff <= 0) return `<span style="color: ${SUCCESS_GREEN}">${localize('common.resetting')}</span>`;

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return `⏱ ${localize('time.dh', { d: days, h: remainingHours })}`;
        }
        if (hours === 0) {
            return `⏱ ${localize('time.m', { m: minutes })}`;
        }
        return `⏱ ${localize('time.hm', { h: hours, m: minutes })}`;
    }

    renderResetTimes(usageData) {
        if (!usageData) return;

        for (const limit of usageData.getActiveLimits()) {
            const barElements = this.limitBars.get(limit.key);
            if (barElements) {
                barElements.resetTime.innerHTML = this.formatResetTime(limit.resetsAt);
                const timePct = this.getTimeMarkerPct(limit.key, limit.resetsAt);
                if (timePct !== null) {
                    barElements.progressBar.setTimeMarker(timePct);
                } else {
                    barElements.progressBar.setTimeMarker(null);
                }
            }
        }
    }
}

class UsageUI {
    constructor() {
        this.state = {
            usageData: null,
            currentModel: null,
            expiryRefreshes: new Map(),
            collapsed: false,
            sidebarDisplay: {},
        };

        this.elements = {
            sidebar: null,
            chat: null,
            tooltips: null,
        };

        this.usageSection = null;
        this.uiReady = false;
        this.pendingUpdate = null;
        this.lastUpdateTime = 0;
        this.updateInterval = 1000;
        this.wasPeakHours = isPeakHours();

        this.setupMessageListener();
        this.init();
    }

    setupMessageListener() {
        browser.runtime.onMessage.addListener((message) => {
            if (message.type === 'updateUsage') {
                const msgOrgId = message.data.usageData?.orgId;
                const myOrgId = getActiveOrgId();
                if (msgOrgId && myOrgId && msgOrgId !== myOrgId) return;
                this.handleUsageUpdate(message.data.usageData);
            }
        });

        onSsePartialUsage((update) => this.handleSsePartialUsage(update));

        browser.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;

            if (changes.usageSectionCollapsed) {
                const collapsed = changes.usageSectionCollapsed.newValue === true;
                if (this.uiReady && collapsed !== this.state.collapsed) {
                    this.setCollapsed(collapsed, false);
                }
            }

            if (changes[SIDEBAR_DISPLAY_KEY] && this.uiReady) {
                this.state.sidebarDisplay = changes[SIDEBAR_DISPLAY_KEY].newValue || {};
                this.applySidebarDisplay();
            }
        });
    }

    async init() {
        await Log('UsageUI: Initializing...');

        while (!CONFIG) {
            await sleep(100);
        }

        const stored = await browser.storage.local.get('usageSectionCollapsed');
        this.state.collapsed = stored.usageSectionCollapsed === true;
        this.state.sidebarDisplay = await getSidebarDisplayPrefs();

        this.usageSection = new UsageSection();
        this.elements.sidebar = await this.createSidebarElements();
        this.elements.chat = this.createChatElements();
        this.elements.tooltips = this.createTooltips();
        this.setCollapsed(this.state.collapsed, false);
        this.applySidebarDisplay();

        this.uiReady = true;
        await Log('UsageUI: Ready');

        if (this.pendingUpdate) {
            this.state.usageData = UsageData.fromJSON(this.pendingUpdate);
            this.pendingUpdate = null;
            this.renderAll();
        }

        this.startUpdateLoop();
    }

    async createSidebarElements() {
        const container = document.createElement('div');
        container.className = 'ut-usage-sidebar flex flex-col mb-6';

        const { header, toggle } = this.createHeader();
        const content = document.createElement('div');
        content.className = 'flex min-h-0 flex-col pl-2';
        content.style.paddingRight = '0.25rem';

        const sectionsContainer = document.createElement('ul');
        sectionsContainer.className = '-mx-1.5 flex flex-1 flex-col px-1.5 gap-px';
        sectionsContainer.appendChild(this.usageSection.elements.container);
        content.appendChild(sectionsContainer);

        let desktopFooter = null;
        let qolFooter = null;
        const isElectron = await sendBackgroundMessage({ type: 'isElectron' });
        if (!isElectron) {
            desktopFooter = this.createDesktopFooter();
            content.appendChild(desktopFooter);

            qolFooter = this.createQoLFooter();
            if (qolFooter) {
                content.appendChild(qolFooter);
            }
        }

        const bugFooter = this.createBugFooter();
        content.appendChild(bugFooter);

        container.appendChild(header);
        container.appendChild(content);

        const elements = { container, content, toggle, desktopFooter, qolFooter, bugFooter };
        toggle.addEventListener('click', () => this.setCollapsed(!this.state.collapsed));

        return elements;
    }

    createHeader() {
        const header = document.createElement('div');
        header.className = 'ut-row ut-justify-between';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ut-usage-toggle';
        toggle.setAttribute('aria-expanded', String(!this.state.collapsed));

        const title = document.createElement('h3');
        title.textContent = localize('usage.header');
        title.className = 'text-text-500 text-xs select-none';

        const chevron = document.createElement('span');
        chevron.className = 'ut-collapse-chevron text-text-500';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18l6-6-6-6"/>
            </svg>
        `;

        toggle.appendChild(title);
        toggle.appendChild(chevron);

        const settingsButton = document.createElement('button');
        settingsButton.className = 'ut-button ut-button-icon hover:bg-bg-400 hover:text-text-100';
        settingsButton.style.color = BLUE_HIGHLIGHT;
        settingsButton.style.padding = '0';
        settingsButton.style.width = '1rem';
        settingsButton.style.height = '1rem';
        settingsButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
            </svg>
        `;

        settingsButton.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('ut:toggleSettings'));
        });

        header.appendChild(toggle);
        header.appendChild(settingsButton);
        return { header, toggle };
    }

    applySidebarDisplay() {
        const prefs = this.state.sidebarDisplay;

        this.usageSection.hiddenKeys = new Set(
            Object.keys(prefs).filter(key => !SIDEBAR_LINK_KEYS.includes(key) && !isSidebarItemVisible(prefs, key))
        );

        const desktopFooter = this.elements.sidebar?.desktopFooter;
        if (desktopFooter) {
            desktopFooter.style.display = isSidebarItemVisible(prefs, 'desktopLink') ? '' : 'none';
        }

        const qolFooter = this.elements.sidebar?.qolFooter;
        if (qolFooter) {
            qolFooter.style.display = isSidebarItemVisible(prefs, 'qolLink') ? '' : 'none';
        }

        const bugFooter = this.elements.sidebar?.bugFooter;
        if (bugFooter) {
            bugFooter.style.display = isSidebarItemVisible(prefs, 'bugLink') ? '' : 'none';
        }

        if (this.state.usageData) this.renderAll();
    }

    availableLimitKeys() {
        const usageData = this.state.usageData;
        const keys = usageData ? usageData.getActiveLimits().map(limit => limit.key) : [];
        keys.push('extraUsage');
        return keys;
    }

    setCollapsed(collapsed, persist = true) {
        this.state.collapsed = collapsed;

        const { container, content, toggle } = this.elements.sidebar;
        content.style.display = collapsed ? 'none' : '';
        container.style.marginBottom = collapsed ? '0.5rem' : '';
        container.classList.toggle('ut-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));

        if (persist) browser.storage.local.set({ usageSectionCollapsed: collapsed });
    }

    createDesktopFooter() {
        const footer = document.createElement('div');
        footer.className = 'ut-desktop-footer ut-sidebar-footer mt-1';

        const link = document.createElement('a');
        link.href = 'https://github.com/lugia19/claude-webext-patcher';
        link.target = '_blank';
        link.className = 'ut-link hover:text-text-200';
        link.style.color = BLUE_HIGHLIGHT;
        link.textContent = '💻 ' + localize('usage.footer_desktop');

        footer.appendChild(link);
        return footer;
    }

    createQoLFooter() {
        const footer = document.createElement('div');
        footer.className = 'ut-desktop-footer ut-sidebar-footer mt-1 ut-qol-footer';

        const isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime);
        const link = document.createElement('a');
        link.href = isChrome
            ? 'https://chromewebstore.google.com/detail/claude-qol/dkdnancajokhfclpjpplkhlkbhaeejob'
            : 'https://addons.mozilla.org/en-US/firefox/addon/claude-qol/';
        link.target = '_blank';
        link.className = 'ut-link hover:text-text-200';
        link.style.color = BLUE_HIGHLIGHT;
        link.textContent = '⚡ ' + localize('usage.footer_qol');

        footer.appendChild(link);
        return footer;
    }

    createBugFooter() {
        const footer = document.createElement('div');
        footer.className = 'ut-desktop-footer ut-sidebar-footer mt-1';

        const link = document.createElement('a');
        link.href = 'https://github.com/lugia19/Claude-Usage-Extension/issues';
        link.target = '_blank';
        link.className = 'ut-link hover:text-text-200';
        link.style.color = BLUE_HIGHLIGHT;
        link.textContent = '🐛 ' + localize('usage.footer_bug');

        footer.appendChild(link);
        return footer;
    }

    createChatElements() {
        const statLine = document.createElement('div');
        statLine.id = 'ut-chat-stat-line';
        statLine.className = 'ut-row';
        statLine.style.paddingLeft = '6px';

        const leftContainer = document.createElement('div');
        leftContainer.id = 'ut-stat-left';
        leftContainer.className = 'ut-row ut-statline-left';

        const usageDisplay = document.createElement('div');
        usageDisplay.className = 'text-text-400 text-xs';
        usageDisplay.style.whiteSpace = 'nowrap';
        if (!isMobileLayout()) usageDisplay.style.marginRight = '8px';
        usageDisplay.textContent = localize('usage.session_inline');

        leftContainer.appendChild(usageDisplay);

        let progressBar = null;
        if (!isMobileLayout()) {
            progressBar = new ProgressBar({ width: '100%' });
            progressBar.track.classList.remove('bg-bg-500');
            progressBar.track.classList.add('bg-bg-200');
            leftContainer.appendChild(progressBar.container);
        }

        const spacer = document.createElement('div');
        spacer.className = 'ut-flex-1';

        const rightContainer = document.createElement('div');
        rightContainer.id = 'ut-stat-right';
        rightContainer.className = 'ut-row';

        const peakIndicator = document.createElement('div');
        peakIndicator.className = 'text-text-400 text-xs';
        peakIndicator.style.cssText = `color: ${RED_WARNING}; font-weight: bold; margin-right: 8px; display: none; user-select: none;`;
        peakIndicator.textContent = localize('usage.peak');

        const resetDisplay = document.createElement('div');
        resetDisplay.className = 'text-text-400 text-xs';
        if (!isMobileLayout()) resetDisplay.style.marginRight = '8px';

        rightContainer.appendChild(peakIndicator);
        rightContainer.appendChild(resetDisplay);

        statLine.appendChild(leftContainer);
        statLine.appendChild(spacer);
        statLine.appendChild(rightContainer);

        return { statLine, usageDisplay, progressBar, peakIndicator, resetDisplay };
    }

    createTooltips() {
        const formatLocal = (utcHour) => {
            const d = new Date();
            d.setUTCHours(utcHour, 0, 0, 0);
            return d.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit' });
        };
        const peakStart = formatLocal(12);
        const peakEnd = formatLocal(18);

        const { chat } = this.elements;
        for (const el of [chat.usageDisplay, chat.resetDisplay, chat.peakIndicator]) el.style.cursor = 'help';
        return {
            usage: createClaudeTooltip(chat.usageDisplay, localize('usage.tooltip_usage')),
            timer: createClaudeTooltip(chat.resetDisplay, localize('usage.tooltip_timer')),
            peak: createClaudeTooltip(chat.peakIndicator, localize('usage.tooltip_peak', { start: peakStart, end: peakEnd })),
        };
    }

    mountSidebar() {
        const anchor = LayoutManager.getAnchor('sidebar');
        if (!anchor) return false;
        return mountToAnchor(this.elements.sidebar.container, anchor);
    }

    mountChatArea() {
        const anchor = LayoutManager.getAnchor('chatArea');
        if (!anchor) return false;
        return mountToAnchor(this.elements.chat.statLine, anchor);
    }

    renderAll() {
        this.renderSidebar();
        this.renderChatArea();
    }

    renderSidebar() {
        const { usageData } = this.state;
        if (!usageData) return;
        this.usageSection.render(usageData);
    }

    setChatUsageVisible(visible) {
        const { usageDisplay, progressBar, peakIndicator, resetDisplay } = this.elements.chat;
        const display = visible ? '' : 'none';

        usageDisplay.style.display = display;
        if (progressBar) progressBar.container.style.display = display;

        const session = this.state.usageData?.limits.session;
        resetDisplay.style.display = visible && session ? '' : 'none';

        if (!visible) peakIndicator.style.display = 'none';
    }

    renderChatArea() {
        const { usageData } = this.state;
        const { usageDisplay, progressBar, peakIndicator, resetDisplay } = this.elements.chat;

        if (!usageData) return;

        const modelSelector = document.querySelector(SELECTORS.MODEL_SELECTOR);
        const modelName = modelSelector?.textContent?.trim() || null;

        const session = usageData.limits.session;
        const hasUsage = !!session || usageData.isSpendingCredits(modelName);
        this.setChatUsageVisible(hasUsage);
        if (!hasUsage) return;

        if (usageData.isSpendingCredits(modelName)) {
            const effectiveTotal = usageData.getExtraUsageEffectiveTotal();
            const used = usageData.extraUsage.usedCredits;
            const pct = effectiveTotal > 0 ? (used / effectiveTotal) * 100 : 0;

            const color = pct >= CONFIG.WARNING_THRESHOLD * 100 ? RED_WARNING : BLUE_HIGHLIGHT;
            usageDisplay.innerHTML = `${localize('usage.extra_inline')} <span class="ut-statline-pct" style="color: ${color}">${pct.toFixed(0)}%</span>`;
            peakIndicator.style.display = 'none';

            if (!isMobileLayout() && progressBar) {
                progressBar.updateProgress(pct, 100);

                const usedDollars = (used / 100).toFixed(2);
                const totalDollars = (effectiveTotal / 100).toFixed(2);
                progressBar.tooltip.updateText(localize('usage.tooltip_dollars', { used: usedDollars, total: totalDollars }));
                progressBar.clearMarker();
                progressBar.setTimeMarker(null);
            }

            const resetInfo = usageData.getSessionResetInfo();
            resetDisplay.innerHTML = getResetTimeHTML(resetInfo);
            return;
        }

        const color = session.percentage >= CONFIG.WARNING_THRESHOLD * 100 ? RED_WARNING : BLUE_HIGHLIGHT;
        usageDisplay.innerHTML = `${localize('usage.session_inline')} <span class="ut-statline-pct" style="color: ${color}">${session.percentage.toFixed(0)}%</span>`;
        peakIndicator.style.display = isPeakHours() ? '' : 'none';

        if (!isMobileLayout() && progressBar) {
            progressBar.updateProgress(session.percentage, 100);

            let cap = CONFIG.ESTIMATED_CAPS?.[usageData.subscriptionTier]?.session;
            if (isPeakHours()) cap = cap / CONFIG.PEAK_SESSION_MULTIPLIER;
            
            const timePct = this.usageSection.getTimeMarkerPct('session', session.resetsAt);
            if (timePct !== null) {
                progressBar.setTimeMarker(timePct);
            } else {
                progressBar.setTimeMarker(null);
            }
            
            const timeText = timePct !== null ? `\nTemps écoulé : ${timePct.toFixed(0)} % de la plage` : '';

            if (cap) {
                const used = Math.round((session.percentage / 100) * cap);
                const tokensText = localize('usage.tooltip_tokens', { used: fmtNum(used), cap: fmtNum(cap), pct: session.percentage.toFixed(0) });
                progressBar.tooltip.updateText(tokensText + timeText);
            } else {
                const pctText = localize('usage.tooltip_pct_used', { pct: session.percentage.toFixed(0) });
                progressBar.tooltip.updateText(pctText + timeText);
            }

            const weeklyLimit = usageData.getBindingWeeklyLimit(modelName);
            if (weeklyLimit) {
                const markerKeys = { weekly: 'usage.marker_all', sonnetWeekly: 'usage.marker_sonnet', opusWeekly: 'usage.marker_opus', fableWeekly: 'usage.marker_fable' };
                const markerName = markerKeys[weeklyLimit.key] ? localize(markerKeys[weeklyLimit.key]) : localize('usage.marker_fallback');
                const markerLabel = `${markerName}: ${weeklyLimit.percentage.toFixed(0)}%`;
                progressBar.setMarker(weeklyLimit.percentage, markerLabel);
            } else {
                progressBar.clearMarker();
            }
        }

        const resetInfo = usageData.getSessionResetInfo();
        resetDisplay.innerHTML = getResetTimeHTML(resetInfo);
    }

    renderResetTimes() {
        const { usageData } = this.state;
        if (!usageData) return;

        this.usageSection.renderResetTimes(usageData);

        if (!usageData.limits.session) return;
        const resetInfo = usageData.getSessionResetInfo();
        this.elements.chat.resetDisplay.innerHTML = getResetTimeHTML(resetInfo);
        
        if (!isMobileLayout() && this.elements.chat.progressBar) {
            const timePct = this.usageSection.getTimeMarkerPct('session', usageData.limits.session.resetsAt);
            if (timePct !== null) {
                this.elements.chat.progressBar.setTimeMarker(timePct);
            } else {
                this.elements.chat.progressBar.setTimeMarker(null);
            }
        }
    }

    handleUsageUpdate(usageDataJSON) {
        if (!this.uiReady) {
            Log('UsageUI: Not ready, queueing update');
            this.pendingUpdate = usageDataJSON;
            return;
        }

        this.state.usageData = UsageData.fromJSON(usageDataJSON);
        this.renderAll();
    }

    handleSsePartialUsage({ session }) {
        if (!this.uiReady || !this.state.usageData) return;
        if (!shouldApplySseSession(this.state.usageData.limits.session, session)) return;

        this.state.usageData.limits.session = session;
        this.renderAll();
    }

    checkExpiredLimits() {
        const { usageData } = this.state;
        if (!usageData) return;

        const now = Date.now();
        const activeLimits = usageData.getActiveLimits();

        const activeKeys = new Set(activeLimits.map(limit => limit.key));
        for (const key of this.state.expiryRefreshes.keys()) {
            if (!activeKeys.has(key)) this.state.expiryRefreshes.delete(key);
        }

        for (const limit of activeLimits) {
            if (!limit.resetsAt || limit.resetsAt > now - EXPIRY_GRACE_MS) {
                this.state.expiryRefreshes.delete(limit.key);
                continue;
            }

            const previous = this.state.expiryRefreshes.get(limit.key);
            if (previous) {
                const wait = Math.min(EXPIRY_RETRY_BASE_MS * 2 ** previous.attempts, EXPIRY_RETRY_MAX_MS);
                if (now - previous.requestedAt < wait) continue;
                previous.requestedAt = now;
                previous.attempts++;
            } else {
                this.state.expiryRefreshes.set(limit.key, { requestedAt: now, attempts: 0 });
            }

            Log(`UsageUI: Limit "${limit.key}" expired, requesting fresh data`);
            sendBackgroundMessage({ type: 'requestData' }).catch(async (error) => {
                const record = this.state.expiryRefreshes.get(limit.key);
                if (record && record.attempts > 0) record.attempts--;
                await Log("warn", `UsageUI: Refresh request for expired limit "${limit.key}" failed:`, error);
            });
            return;
        }
    }

    checkModelChange() {
        const modelSelector = document.querySelector(SELECTORS.MODEL_SELECTOR);
        const modelName = modelSelector?.textContent?.trim() || null;

        if (modelName && modelName !== this.state.currentModel) {
            this.state.currentModel = modelName;
            this.renderChatArea();
        }
    }

    checkPeakHoursChange() {
        const peak = isPeakHours();
        if (peak !== this.wasPeakHours) {
            this.wasPeakHours = peak;
            this.renderChatArea();
            this.renderSidebar();
        }
    }

    checkQoLInstalled() {
        const hasQoL = document.documentElement.hasAttribute('data-claude-qol-installed');
        if (hasQoL) {
            const qolFooter = this.elements.sidebar?.container?.querySelector('.ut-qol-footer');
            if (qolFooter) {
                qolFooter.remove();
            }
        }
    }

    startUpdateLoop() {
        const update = async (timestamp) => {
            if (timestamp - this.lastUpdateTime >= this.updateInterval) {
                this.lastUpdateTime = timestamp;
                this.renderResetTimes();
                this.checkExpiredLimits();
                this.checkModelChange();
                this.checkPeakHoursChange();
                this.checkQoLInstalled();
                this.mountSidebar();
                this.mountChatArea();
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }
}

const usageUI = new UsageUI();