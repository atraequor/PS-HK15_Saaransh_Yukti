(() => {
    const STORAGE_KEY = 'fm_translate_lang';
    const DEFAULT_LANG = 'en';
    const API_PATH = '/api/translate';
    const LANG_API_PATH = '/api/translate/languages';
    const CHUNK_SIZE = 30;
    let languages = [
        { code: 'en', short: 'EN', label: 'English' },
        { code: 'hi', short: 'HI', label: 'Hindi' }
    ];

    const SKIP_TEXT = new Set(['FarmMind', 'FARMMIND']);

    const state = {
        current: DEFAULT_LANG,
        translating: false,
        cache: new Map(),
        originalText: new WeakMap(),
        originalAttrs: new WeakMap(),
        observer: null,
        mutationTimer: null,
        ui: null
    };

    function getLang(code) {
        return languages.find((lang) => lang.code === code) || languages[0];
    }

    function getCacheFor(code) {
        if (!state.cache.has(code)) state.cache.set(code, new Map());
        return state.cache.get(code);
    }

    function normalizeLanguages(raw) {
        const mapped = (raw || [])
            .filter((item) => item && item.code && (item.name || item.label))
            .map((item) => ({
                code: item.code,
                label: item.name || item.label,
                short: String(item.code).toUpperCase()
            }));

        const hasEnglish = mapped.some((lang) => lang.code === 'en');
        if (!hasEnglish) {
            mapped.unshift({ code: 'en', label: 'English', short: 'EN' });
        }
        return mapped;
    }

    async function loadLanguages() {
        try {
            const res = await fetch(LANG_API_PATH);
            if (!res.ok) throw new Error('Language list failed');
            const data = await res.json();
            const list = Array.isArray(data.languages) ? data.languages : (Array.isArray(data) ? data : []);
            const normalized = normalizeLanguages(list);
            if (normalized.length) languages = normalized;
        } catch (err) { }
    }

    function shouldSkipText(text) {
        const trimmed = text.trim();
        if (!trimmed) return true;
        if (SKIP_TEXT.has(trimmed)) return true;
        if (!/[A-Za-z]/.test(trimmed)) return true;
        if (/https?:\/\//i.test(trimmed) || /www\./i.test(trimmed)) return true;
        if (/@/.test(trimmed)) return true;
        return false;
    }

    function getOriginalText(node) {
        if (!state.originalText.has(node)) {
            state.originalText.set(node, node.textContent);
        }
        return state.originalText.get(node);
    }

    function getOriginalAttr(el, attr) {
        let map = state.originalAttrs.get(el);
        if (!map) {
            map = {};
            state.originalAttrs.set(el, map);
        }
        if (!(attr in map)) {
            map[attr] = el.getAttribute(attr);
        }
        return map[attr];
    }

    function collectTextNodes() {
        const nodes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                if (parent.closest('[data-no-translate], .notranslate, [translate="no"]')) return NodeFilter.FILTER_REJECT;
                if (parent.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
                const tag = parent.tagName;
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'MATH', 'TEXTAREA', 'INPUT'].includes(tag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let current;
        while ((current = walker.nextNode())) {
            nodes.push(current);
        }
        return nodes;
    }

    function addAttrItem(items, el, attr) {
        const original = getOriginalAttr(el, attr);
        if (!original) return;
        const trimmed = original.trim();
        if (shouldSkipText(trimmed)) return;
        items.push({
            key: trimmed,
            apply: (text) => el.setAttribute(attr, text),
            restore: () => el.setAttribute(attr, original)
        });
    }

    function collectItems() {
        const items = [];
        const textNodes = collectTextNodes();
        textNodes.forEach((node) => {
            const original = getOriginalText(node);
            const trimmed = original.trim();
            if (shouldSkipText(trimmed)) return;
            const leading = original.match(/^\s*/)[0];
            const trailing = original.match(/\s*$/)[0];
            items.push({
                key: trimmed,
                apply: (text) => {
                    node.textContent = `${leading}${text}${trailing}`;
                },
                restore: () => {
                    node.textContent = original;
                }
            });
        });

        const attrTargets = document.querySelectorAll('[placeholder], [title], [aria-label], img[alt], input[value]');
        attrTargets.forEach((el) => {
            if (el.closest('[data-no-translate], .notranslate, [translate="no"]')) return;
            if (el.closest('[contenteditable="true"]')) return;
            const tag = el.tagName;
            if (tag === 'INPUT') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                if (['button', 'submit', 'reset'].includes(type)) {
                    addAttrItem(items, el, 'value');
                } else if (el.hasAttribute('placeholder')) {
                    addAttrItem(items, el, 'placeholder');
                }
                return;
            }
            if (tag === 'TEXTAREA' && el.hasAttribute('placeholder')) {
                addAttrItem(items, el, 'placeholder');
                return;
            }
            if (el.hasAttribute('placeholder')) addAttrItem(items, el, 'placeholder');
            if (el.hasAttribute('title')) addAttrItem(items, el, 'title');
            if (el.hasAttribute('aria-label')) addAttrItem(items, el, 'aria-label');
            if (tag === 'IMG' && el.hasAttribute('alt')) addAttrItem(items, el, 'alt');
        });

        return items;
    }

    async function fetchTranslations(texts, sourceLang, targetLang) {
        const res = await fetch(API_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, source_lang: sourceLang, target_lang: targetLang })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Translation failed');
        if (!Array.isArray(data.translations)) throw new Error('Invalid translation response');
        return data.translations;
    }

    function chunkArray(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    function setStatus(text, type) {
        if (!state.ui || !state.ui.status) return;
        state.ui.status.textContent = text || '';
        state.ui.status.className = 'fm-translate-status' + (type ? ` ${type}` : '');
    }

    function setBusy(isBusy) {
        state.translating = isBusy;
        if (!state.ui) return;
        state.ui.apply.disabled = isBusy;
        state.ui.reset.disabled = isBusy;
        state.ui.select.disabled = isBusy;
        state.ui.panel.classList.toggle('busy', isBusy);
    }

    function updateLangButtons() {
        const lang = getLang(state.current);
        const buttons = document.querySelectorAll('.lang-switch');
        buttons.forEach((btn) => {
            btn.setAttribute('data-no-translate', 'true');
            btn.type = 'button';
            btn.textContent = lang.short;
        });
    }

    async function applyLanguage(targetCode, options = {}) {
        const lang = getLang(targetCode);
        if (lang.code === DEFAULT_LANG) {
            restoreOriginal();
            return;
        }
        if (state.translating) return;

        try {
            setBusy(true);
            setStatus('Translating...', '');
            const items = collectItems();
            const unique = [...new Set(items.map((item) => item.key))];
            const cache = getCacheFor(lang.code);
            const missing = unique.filter((text) => !cache.has(text));

            for (const chunk of chunkArray(missing, CHUNK_SIZE)) {
                if (!chunk.length) continue;
                const translations = await fetchTranslations(chunk, DEFAULT_LANG, lang.code);
                translations.forEach((t, idx) => {
                    cache.set(chunk[idx], t);
                });
            }

            items.forEach((item) => {
                const translated = cache.get(item.key) || item.key;
                item.apply(translated);
            });

            state.current = lang.code;
            localStorage.setItem(STORAGE_KEY, state.current);
            document.documentElement.lang = state.current;
            updateLangButtons();
            if (!options.silent) setStatus('Translated.', 'success');
        } catch (err) {
            const msg = (err && err.message) ? err.message : 'Translation failed';
            if (!options.silent) setStatus(msg, 'error');
        } finally {
            setBusy(false);
        }
    }

    function restoreOriginal() {
        if (state.translating) return;
        const items = collectItems();
        items.forEach((item) => item.restore());
        state.current = DEFAULT_LANG;
        localStorage.setItem(STORAGE_KEY, state.current);
        document.documentElement.lang = state.current;
        updateLangButtons();
        setStatus('English restored.', 'success');
    }

    function togglePanel(force) {
        if (!state.ui) return;
        if (typeof force === 'boolean') {
            state.ui.root.classList.toggle('open', force);
        } else {
            state.ui.root.classList.toggle('open');
        }
    }

    function bindLangSwitchButtons() {
        const buttons = document.querySelectorAll('.lang-switch');
        buttons.forEach((btn) => {
            btn.setAttribute('data-no-translate', 'true');
            btn.type = 'button';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                togglePanel();
            });
        });
    }

    function renderLanguageOptions() {
        if (!state.ui) return;
        const select = state.ui.select;
        select.innerHTML = '';
        languages.forEach((lang) => {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.label;
            select.appendChild(option);
        });

        if (!languages.some((lang) => lang.code === state.current)) {
            state.current = DEFAULT_LANG;
        }
        select.value = state.current;
    }

    function buildWidget() {
        if (document.getElementById('fmTranslateWidget')) return;
        const root = document.createElement('div');
        root.id = 'fmTranslateWidget';
        root.className = 'fm-translate';
        root.setAttribute('data-no-translate', 'true');

        root.innerHTML = `
            <button class="fm-translate-fab" type="button">Translate</button>
            <div class="fm-translate-panel" role="dialog" aria-label="Translate page">
                <label class="fm-translate-label" for="fmTranslateSelect">Language</label>
                <select id="fmTranslateSelect" class="fm-translate-select"></select>
                <div class="fm-translate-actions">
                    <button class="fm-translate-btn apply" type="button">Apply</button>
                    <button class="fm-translate-btn reset" type="button">English</button>
                </div>
                <div class="fm-translate-status" aria-live="polite"></div>
            </div>
        `;

        document.body.appendChild(root);

        const select = root.querySelector('#fmTranslateSelect');

        const ui = {
            root,
            panel: root.querySelector('.fm-translate-panel'),
            fab: root.querySelector('.fm-translate-fab'),
            select,
            apply: root.querySelector('.fm-translate-btn.apply'),
            reset: root.querySelector('.fm-translate-btn.reset'),
            status: root.querySelector('.fm-translate-status')
        };

        ui.fab.addEventListener('click', () => togglePanel());
        ui.apply.addEventListener('click', () => {
            const code = ui.select.value || DEFAULT_LANG;
            if (code === DEFAULT_LANG) {
                restoreOriginal();
            } else {
                applyLanguage(code);
            }
        });
        ui.reset.addEventListener('click', () => restoreOriginal());

        document.addEventListener('click', (e) => {
            if (!root.contains(e.target) && !e.target.closest('.lang-switch')) {
                togglePanel(false);
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') togglePanel(false);
        });

        state.ui = ui;
    }

    function scheduleReapply() {
        if (state.current === DEFAULT_LANG) return;
        if (state.mutationTimer) window.clearTimeout(state.mutationTimer);
        state.mutationTimer = window.setTimeout(() => {
            if (state.translating) {
                scheduleReapply();
                return;
            }
            applyLanguage(state.current, { silent: true });
        }, 350);
    }

    function startObserver() {
        if (state.observer) return;
        state.observer = new MutationObserver(() => {
            if (state.current !== DEFAULT_LANG) scheduleReapply();
        });
        state.observer.observe(document.body, { childList: true, subtree: true });
    }

    async function init() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && languages.some((lang) => lang.code === saved)) {
            state.current = saved;
        }

        buildWidget();
        bindLangSwitchButtons();
        await loadLanguages();
        renderLanguageOptions();
        updateLangButtons();
        document.documentElement.lang = state.current;

        if (state.current !== DEFAULT_LANG) {
            applyLanguage(state.current, { silent: true });
        }

        startObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { init().catch(() => { }); });
    } else {
        init().catch(() => { });
    }
})();
