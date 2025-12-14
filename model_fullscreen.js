(() => {
    'use strict';

    const BODY_ACTIVE_CLASS = 'model-fullscreen-active';
    const OVERLAY_ID = 'model-fullscreen-overlay';
    const TOOLBAR_ID = 'model-fullscreen-toolbar';
    const CONTENT_ID = 'model-fullscreen-content';
    const PLACEHOLDER_ID = 'model-fullscreen-placeholder';

    const getEl = (id) => document.getElementById(id);

    const safeClick = (id) => {
        const el = getEl(id);
        if (!el) return false;
        el.click();
        return true;
    };

    const safeToggleCheckbox = (id) => {
        const el = getEl(id);
        if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') return false;
        el.checked = !el.checked;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    };

    const safeSetSelectValue = (id, value) => {
        const el = getEl(id);
        if (!(el instanceof HTMLSelectElement)) return false;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    };

    const requestRedraw = () => {
        // 既存のデバッグ関数を活用（あれば）
        if (typeof window.triggerManualResize === 'function') {
            window.triggerManualResize();
            return;
        }
        if (typeof window.drawOnCanvas === 'function') {
            window.drawOnCanvas();
        }
    };

    const isActive = () => document.body.classList.contains(BODY_ACTIVE_CLASS);

    const ensureOverlay = () => {
        let overlay = getEl(OVERLAY_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'model-fullscreen-overlay';

        const toolbar = document.createElement('div');
        toolbar.id = TOOLBAR_ID;
        toolbar.className = 'model-fullscreen-toolbar';

        const content = document.createElement('div');
        content.id = CONTENT_ID;
        content.className = 'model-fullscreen-content';

        overlay.appendChild(toolbar);
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        return overlay;
    };

    const buildToolbar = () => {
        const toolbar = getEl(TOOLBAR_ID);
        if (!toolbar) return;

        const addBtn = ({ icon, tip, onClick, id }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'model-fs-btn';
            if (id) btn.id = id;
            btn.textContent = icon;
            btn.setAttribute('data-tip', tip);
            btn.setAttribute('aria-label', tip);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            });
            toolbar.appendChild(btn);
        };

        const addSep = () => {
            const sep = document.createElement('div');
            sep.className = 'model-fs-sep';
            toolbar.appendChild(sep);
        };

        toolbar.textContent = '';

        addBtn({
            icon: '⤢',
            tip: '全画面を終了 (Esc)',
            onClick: () => exitFullscreenMode(),
        });

        addSep();

        addBtn({ icon: '🖱', tip: '選択/移動 (S)', onClick: () => safeClick('mode-select') });
        addBtn({ icon: '●+', tip: '節点追加 (N)', onClick: () => safeClick('mode-add-node') });
        addBtn({ icon: '━+', tip: '部材追加 (M)', onClick: () => safeClick('mode-add-member') });
        addBtn({ icon: '↩', tip: '元に戻す (Ctrl+Z)', onClick: () => safeClick('undo-btn') });

        addSep();

        addBtn({ icon: '🔍', tip: '自動スケーリング (A)', onClick: () => safeClick('auto-scale-btn') });
        addBtn({ icon: '⛶', tip: '全体表示', onClick: () => safeClick('fit-view-model') });
        addBtn({ icon: '+', tip: '拡大', onClick: () => safeClick('zoom-in-btn') });
        addBtn({ icon: '−', tip: '縮小', onClick: () => safeClick('zoom-out-btn') });

        addSep();

        addBtn({ icon: '▦', tip: 'グリッド表示切替 (G)', onClick: () => safeToggleCheckbox('grid-toggle') });
        addBtn({ icon: 'ℹ', tip: '部材情報表示切替', onClick: () => safeToggleCheckbox('member-info-toggle') });

        // 表示制御（存在するものだけ）
        if (getEl('show-external-loads')) {
            addBtn({ icon: '⇩', tip: '外部荷重表示切替', onClick: () => safeToggleCheckbox('show-external-loads') });
        }
        if (getEl('show-self-weight')) {
            addBtn({ icon: '⚖', tip: '自重表示切替', onClick: () => safeToggleCheckbox('show-self-weight') });
        }
        if (getEl('show-member-dimensions')) {
            addBtn({ icon: '📏', tip: '部材寸法表示切替', onClick: () => safeToggleCheckbox('show-member-dimensions') });
        }
        if (getEl('show-spring-stiffness')) {
            addBtn({ icon: '🌀', tip: 'バネ定数/剛性表示切替', onClick: () => safeToggleCheckbox('show-spring-stiffness') });
        }

        addSep();

        // 3D/2Dビュー切替
        if (getEl('model-view-mode')) {
            addBtn({
                icon: '2D/3D',
                tip: '2D/3D表示切替',
                onClick: () => {
                    const select = getEl('model-view-mode');
                    if (!(select instanceof HTMLSelectElement)) return;
                    const next = (select.value === '3d') ? '2d' : '3d';
                    safeSetSelectValue('model-view-mode', next);
                },
            });
        } else {
            addBtn({ icon: '🧊', tip: '3Dビューア(別ウィンドウ)', onClick: () => safeClick('view-3d-btn') });
        }

        // 投影（3D統合版のみ）
        if (getEl('projection-mode')) {
            addBtn({
                icon: '⟂',
                tip: '投影面を切替',
                onClick: () => {
                    const select = getEl('projection-mode');
                    if (!(select instanceof HTMLSelectElement)) return;
                    const options = Array.from(select.options).map(o => o.value);
                    const idx = Math.max(0, options.indexOf(select.value));
                    const next = options[(idx + 1) % options.length];
                    safeSetSelectValue('projection-mode', next);
                },
            });
        }

        addSep();

        addBtn({ icon: '🏗', tip: 'フレームジェネレーター', onClick: () => safeClick('frame-generator-btn') });
        addBtn({ icon: '📊', tip: 'スプレッドシート入力', onClick: () => safeClick('spreadsheet-input-btn') });
    };

    const enterFullscreenMode = async () => {
        if (isActive()) return;

        const workspace = getEl('model-workspace-root');
        if (!workspace) return;

        const overlay = ensureOverlay();
        const content = getEl(CONTENT_ID);
        if (!content) return;

        let placeholder = getEl(PLACEHOLDER_ID);
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = PLACEHOLDER_ID;
            placeholder.style.display = 'none';
            workspace.parentNode?.insertBefore(placeholder, workspace);
        }

        buildToolbar();

        content.appendChild(workspace);
        document.body.classList.add(BODY_ACTIVE_CLASS);

        // Fullscreen API は可能なら使う（失敗してもオーバーレイ表示は維持）
        try {
            if (overlay.requestFullscreen && !document.fullscreenElement) {
                await overlay.requestFullscreen();
            }
        } catch (_) {
            // ignore
        }

        requestRedraw();
    };

    const exitFullscreenMode = async () => {
        if (!isActive()) return;

        const workspace = getEl('model-workspace-root');
        const placeholder = getEl(PLACEHOLDER_ID);
        const overlay = getEl(OVERLAY_ID);

        if (placeholder && placeholder.parentNode && workspace) {
            placeholder.parentNode.insertBefore(workspace, placeholder);
        }

        document.body.classList.remove(BODY_ACTIVE_CLASS);

        try {
            if (document.fullscreenElement && document.exitFullscreen) {
                await document.exitFullscreen();
            }
        } catch (_) {
            // ignore
        }

        // overlay 内に残った空要素があってもOKだが、スクロール抑止などを解除
        if (overlay) {
            // nothing
        }

        requestRedraw();
    };

    // グローバルにも出しておく（デバッグ用）
    window.enterModelFullscreen = enterFullscreenMode;
    window.exitModelFullscreen = exitFullscreenMode;

    const bind = () => {
        const btn = getEl('fullscreen-model-btn');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (isActive()) {
                    exitFullscreenMode();
                } else {
                    enterFullscreenMode();
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isActive()) {
                exitFullscreenMode();
            }
        });

        document.addEventListener('fullscreenchange', () => {
            // Escでブラウザ側のfullscreenが解除された場合も追従
            if (!document.fullscreenElement && isActive()) {
                exitFullscreenMode();
            }
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
