// 3D座標を2D投影する関数（グローバルスコープ）
const project3DTo2D = (node, projectionMode) => {
    const nodeY = node.y !== undefined ? node.y : 0;  // Y座標(水平)
    const nodeZ = node.z !== undefined ? node.z : 0;  // Z座標(鉛直)
    
    switch(projectionMode) {
        case 'xy':  // XY平面(水平面を上から見た図)
            return { x: node.x, y: nodeY };
        case 'xz':  // XZ平面(X方向鉛直断面)
            return { x: node.x, y: nodeZ };
        case 'yz':  // YZ平面(Y方向鉛直断面)
            return { x: nodeY, y: nodeZ };
        case 'iso': // 等角投影(アイソメトリック)
            // 30度回転の等角投影
            const angle = Math.PI / 6; // 30度
            return {
                x: node.x - nodeY * Math.cos(angle),
                y: nodeZ + nodeY * Math.sin(angle)
            };
        default:
            return { x: node.x, y: nodeZ };
    }
};

// 木材基準強度データ (N/mm²)
const WOOD_BASE_STRENGTH_DATA = {
    "Matsu_Group": { name: "あかまつ、くろまつ、べいまつ", fc: 22.2, ft: 17.7, fb: 28.2, fs: 2.4 },
    "Hinoki_Group": { name: "からまつ、ひば、ひのき、べいひ", fc: 20.7, ft: 16.2, fb: 26.7, fs: 2.1 },
    "Tsuga_Group": { name: "つが、べいつが", fc: 19.2, ft: 14.7, fb: 25.2, fs: 2.1 },
    "Sugi_Group": { name: "もみ、えぞまつ、すぎ、べいすぎ等", fc: 17.7, ft: 13.5, fb: 22.2, fs: 1.8 },
    "Kashi": { name: "かし", fc: 20.7, ft: 16.2, fb: 26.7, fs: 4.2 },
    "Keyaki_Group": { name: "くり、なら、ぶな、けやき", fc: 19.2, ft: 14.7, fb: 25.2, fs: 3.0 }
};

// 材料密度データ (kg/m³)
const MATERIAL_DENSITY_DATA = {
    // 金属材料
    "205000": 7850,    // スチール
    "193000": 7900,    // ステンレス
    "70000": 2700,     // アルミニウム
    
    // 木材
    "7000": 400,       // 軟材（杉、もみ等）
    "8000": 500,       // 中硬材（松類、つが等）
    "9000": 550,       // やや硬材（カラマツ、檜等）
    "10000": 800,      // 硬材（樫）
    
    // デフォルト値
    "custom": 7850     // 任意入力時のデフォルト（スチール相当）
};

// 設定オブジェクト
const CONFIG = {
    validation: {
        minPositiveValue: 0.001,
        maxDimension: 10000,
        maxMemberCount: 1000,
        maxNodeCount: 1000
    },
    ui: {
        animationDuration: 200,
        errorDisplayTime: 3000,
        canvasResolutionScale: 2.0,
        panZoomDefaults: { scale: 1, offsetX: 0, offsetY: 0, isInitialized: false }
    },
    materials: {
        steelElasticModulus: 2.05e5,
        steelShearModulus: 7.7e4,
        defaultSteelStrength: 235
    },
    analysis3D: {
        enabled: true,
        dofsPerNode: 6,
        defaultTorsionalConstant: 100,
        visualizationDepth: 10
    }
};

const DEFAULT_PROJECTION_MODE = 'iso';

const UNIT_CONVERSION = {
    CM4_TO_MM4: 1e4,    // cm⁴ → mm⁴ (10,000倍)
    CM3_TO_MM3: 1e6,    // cm³ → mm³ (1,000,000倍)
    CM2_TO_MM2: 1e2,    // cm² → mm² (100倍)
    E_STEEL: CONFIG.materials.steelElasticModulus,
    G_STEEL: CONFIG.materials.steelShearModulus,
};

const SUPPORT_TYPE_OPTIONS = Object.freeze([
    { value: 'free', label: '自由' },
    { value: 'pinned', label: 'ピン' },
    { value: 'fixed', label: '固定' },
    { value: 'roller-x', label: 'ローラー(X軸固定)' },
    { value: 'roller-y', label: 'ローラー(Y軸固定)' },
    { value: 'roller-z', label: 'ローラー(Z軸固定)' }
]);

const SUPPORT_ALIAS_ENTRIES = [
    { target: 'free', aliases: ['f', 'free', '自由'] },
    { target: 'pinned', aliases: ['p', 'pin', 'pinned', 'hinge', 'hinged', 'ピン'] },
    { target: 'fixed', aliases: ['x', 'fix', 'fixed', '固定'] },
    { target: 'roller-x', aliases: ['roller-x', 'roller_x', 'rollerx', 'r-x', 'rx', 'ローラーx', 'ローラー(x)', 'ローラー(X軸固定)'] },
    { target: 'roller-y', aliases: ['roller-y', 'roller_y', 'rollery', 'r-y', 'ry', 'ローラー', 'ローラーy', 'ローラー(y)', 'ローラー(Y軸固定)', 'r', 'roller'] },
    { target: 'roller-z', aliases: ['roller-z', 'roller_z', 'rollerz', 'r-z', 'rz', 'ローラーz', 'ローラー(z)', 'ローラー(Z軸固定)'] }
];

const NODE_PROPS_TITLE_BASE = '節点プロパティ編集';

const SUPPORT_ALIAS_MAP = SUPPORT_ALIAS_ENTRIES.reduce((map, entry) => {
    entry.aliases.forEach(alias => {
        const key = `${alias}`.trim();
        if (!key) return;
        map.set(key, entry.target);
        map.set(key.toLowerCase(), entry.target);
    });
    return map;
}, new Map());

const normalizeSupportValue = (value) => {
    if (value === undefined || value === null) return 'free';
    const raw = `${value}`.trim();
    if (!raw) return 'free';
    return SUPPORT_ALIAS_MAP.get(raw) || SUPPORT_ALIAS_MAP.get(raw.toLowerCase()) || raw;
};

const isRollerSupport = (value) => {
    const normalized = normalizeSupportValue(value);
    return normalized === 'roller-x' || normalized === 'roller-y' || normalized === 'roller-z';
};

const getRollerAxis = (value) => {
    const normalized = normalizeSupportValue(value);
    if (normalized === 'roller-x') return 'x';
    if (normalized === 'roller-y') return 'y';
    if (normalized === 'roller-z') return 'z';
    return null;
};

// --- 2D由来: フォントスケール（モデル図） ---
// 2D側のUI（font-scale-model）と合わせて、window.settings.fontScale を参照する。
if (!globalThis.settings) globalThis.settings = {};
if (!globalThis.settings.fontScales) {
    globalThis.settings.fontScales = { model: 1.0 };
}
if (typeof globalThis.settings.fontScale !== 'number') {
    globalThis.settings.fontScale = globalThis.settings.fontScales.model;
}

const getModelFontScale = () => {
    const scale = globalThis.settings?.fontScale;
    return (typeof scale === 'number' && isFinite(scale) && scale > 0) ? scale : 1.0;
};

const SUPPORT_LABEL_MAP = SUPPORT_TYPE_OPTIONS.reduce((map, { value, label }) => {
    map[value] = label;
    return map;
}, {});

const buildSupportOptionsMarkup = (selectedValue = 'free') => {
    const normalized = normalizeSupportValue(selectedValue);
    return SUPPORT_TYPE_OPTIONS.map(({ value, label }) =>
        `<option value="${value}"${normalized === value ? ' selected' : ''}>${label}</option>`
    ).join('');
};

const buildSupportSelectMarkup = (selectedValue = 'free') => `<select>${buildSupportOptionsMarkup(selectedValue)}</select>`;

const resolveMemberConnectionTargets = (row) => {
    const fallback = {
        i: { select: null, cellIndex: -1 },
        j: { select: null, cellIndex: -1 }
    };

    if (!(row instanceof HTMLTableRowElement) || !row.cells || typeof row.querySelector !== 'function') {
        return fallback;
    }

    const cells = Array.from(row.cells);
    const inferFromClass = (className) => {
        const select = row.querySelector(`.${className}`);
        if (!(select instanceof HTMLSelectElement)) {
            const container = select?.closest('td');
            const resolvedSelect = container?.querySelector('select');
            return {
                select: resolvedSelect instanceof HTMLSelectElement ? resolvedSelect : null,
                cellIndex: container ? cells.indexOf(container) : -1
            };
        }
        const cell = select.closest('td');
        return {
            select,
            cellIndex: cell ? cells.indexOf(cell) : -1
        };
    };

    const handles = {
        i: inferFromClass('member-conn-select-i'),
        j: inferFromClass('member-conn-select-j')
    };

    const deleteIndex = cells.length - 1;
    if (deleteIndex >= 0) {
        const fallbackIndices = {
            j: deleteIndex - 1,
            i: deleteIndex - 2
        };

        for (const key of ['i', 'j']) {
            const candidateIndex = fallbackIndices[key];
            if ((handles[key].select && handles[key].cellIndex >= 0) || candidateIndex < 0 || candidateIndex >= cells.length) {
                continue;
            }
            const candidateCell = cells[candidateIndex];
            if (!candidateCell) continue;
            const candidateSelect = candidateCell.querySelector('select');
            if (candidateSelect instanceof HTMLSelectElement) {
                handles[key] = { select: candidateSelect, cellIndex: candidateIndex };
            }
        }
    }

    return handles;
};

const getMemberConnectionSelect = (row, endpoint = 'i') => {
    const handles = resolveMemberConnectionTargets(row);
    return handles?.[endpoint]?.select || null;
};

const getMemberConnectionCellIndex = (row, endpoint = 'i') => {
    const handles = resolveMemberConnectionTargets(row);
    return handles?.[endpoint]?.cellIndex ?? -1;
};

const zeroMatrixRowAndColumn = (matrix, index, tiny = 1e-9) => {
    if (!Array.isArray(matrix) || !Array.isArray(matrix[index])) return;
    const size = matrix.length;
    for (let i = 0; i < size; i++) {
        if (Array.isArray(matrix[index])) matrix[index][i] = 0;
        if (Array.isArray(matrix[i])) matrix[i][index] = 0;
    }
    if (Array.isArray(matrix[index])) matrix[index][index] = tiny;
};

const build3DReleaseData = (kLocal3D, T3D, globalIndexMap, iConn, jConn, matrixLib) => {
    const matrixOps = matrixLib || globalThis.matrixOps || globalThis.mat;
    if (!matrixOps) {
        throw new Error('3D release handling requires matrix utilities.');
    }
    const isPinned = (conn) => {
        if (typeof conn !== 'string') return false;
        const normalized = conn.trim().toLowerCase();
        return normalized === 'pinned' || normalized === 'p';
    };

    const releaseLocalIndices = [];
    if (isPinned(iConn)) {
        releaseLocalIndices.push(4, 5);
    }
    if (isPinned(jConn)) {
        releaseLocalIndices.push(10, 11);
    }

    const allIndices = Array.isArray(kLocal3D)
        ? kLocal3D.map((_, idx) => idx)
        : Array.from({ length: 12 }, (_, idx) => idx);

    if (!Array.isArray(kLocal3D) || releaseLocalIndices.length === 0) {
        return {
            hasRelease: false,
            usedCondensation: false,
            activeLocalIndices: allIndices,
            releaseLocalIndices,
            k_local_active: kLocal3D,
            T_active: T3D,
            K_rr_inv: null,
            K_ra: null,
            K_ar: null,
            fallbackZeroing: false,
            k_local_modified: kLocal3D,
            globalIndexMap
        };
    }

    const activeLocalIndices = allIndices.filter(idx => !releaseLocalIndices.includes(idx));

    const selectSubmatrix = (matrix, rowIndices, colIndices) => rowIndices.map(r => colIndices.map(c => matrix[r][c]));

    const K_rr = selectSubmatrix(kLocal3D, releaseLocalIndices, releaseLocalIndices);
    const K_ra = selectSubmatrix(kLocal3D, releaseLocalIndices, activeLocalIndices);
    const K_ar = selectSubmatrix(kLocal3D, activeLocalIndices, releaseLocalIndices);
    const K_aa = selectSubmatrix(kLocal3D, activeLocalIndices, activeLocalIndices);

    const K_rr_inv = matrixOps.inverse(K_rr);

    if (!K_rr_inv) {
        console.warn('3D端部解放の縮約に失敗したため、零行列による近似にフォールバックします。');
        // Condensation failed (singular). Fallback to zeroing.
        const kModified = kLocal3D.map(row => [...row]);
        releaseLocalIndices.forEach(idx => zeroMatrixRowAndColumn(kModified, idx));
        return {
            hasRelease: true,
            usedCondensation: false,
            activeLocalIndices: allIndices,
            releaseLocalIndices,
            k_local_active: kModified,
            T_active: T3D,
            K_rr_inv: null,
            K_ra: null,
            K_ar: null,
            fallbackZeroing: true,
            k_local_modified: kModified,
            globalIndexMap
        };
    }

    const temp = matrixOps.multiply(K_ar, matrixOps.multiply(K_rr_inv, K_ra));
    const K_condensed = matrixOps.subtract(K_aa, temp);
    const T_active = activeLocalIndices.map(idx => T3D[idx]);

    return {
        hasRelease: true,
        usedCondensation: true,
        activeLocalIndices,
        releaseLocalIndices,
        k_local_active: K_condensed,
        T_active,
        K_rr_inv,
        K_ra,
        K_ar,
        fallbackZeroing: false,
        k_local_modified: kLocal3D,
        globalIndexMap
    };
};

const enablePopupDrag = (popupElement, handleElement) => {
    if (!popupElement || !handleElement || handleElement.dataset.dragHandlerAttached === 'true') {
        return;
    }

    handleElement.dataset.dragHandlerAttached = 'true';
    handleElement.style.cursor = handleElement.style.cursor || 'move';
    handleElement.style.touchAction = handleElement.style.touchAction || 'none';

    let dragState = null;

    const beginDrag = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }

        const rect = popupElement.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: rect.left,
            startTop: rect.top
        };

        if (!popupElement.style.position) {
            popupElement.style.position = 'fixed';
        }

        if (typeof handleElement.setPointerCapture === 'function') {
            try {
                handleElement.setPointerCapture(event.pointerId);
            } catch (error) {
                /* Pointer capture unsupported; ignore. */
            }
        }

        event.preventDefault();
    };

    const updateDrag = (event) => {
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;

        popupElement.style.left = `${dragState.startLeft + deltaX}px`;
        popupElement.style.top = `${dragState.startTop + deltaY}px`;
    };

    const endDrag = (event) => {
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }

        if (typeof handleElement.releasePointerCapture === 'function') {
            try {
                handleElement.releasePointerCapture(event.pointerId);
            } catch (error) {
                /* Pointer capture release failed; ignore. */
            }
        }

        dragState = null;
    };

    handleElement.addEventListener('pointerdown', beginDrag);
    handleElement.addEventListener('pointermove', updateDrag);
    handleElement.addEventListener('pointerup', endDrag);
    handleElement.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointermove', updateDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
};

const setNodePropsTitle = (nodeNumber = null) => {
    if (!elements || !elements.nodePropsTitle) {
        return;
    }
    elements.nodePropsTitle.textContent = nodeNumber
        ? `${NODE_PROPS_TITLE_BASE}（節点 ${nodeNumber}）`
        : NODE_PROPS_TITLE_BASE;
};

function getCurrentProjectionMode() {
    return elements?.projectionMode?.value || DEFAULT_PROJECTION_MODE;
}

const utils = {
    formatNumber: (num, decimals = 2) => {
        if (typeof num !== 'number' || isNaN(num)) return '0';
        return Number(num.toFixed(decimals)).toLocaleString();
    },
    showMessage: (message, type = 'info', duration = CONFIG.ui.errorDisplayTime) => {
        const messageElement = document.createElement('div');
        messageElement.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 6px;
            color: white;
            font-weight: bold;
            z-index: 10000;
            max-width: 400px;
            word-wrap: break-word;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        const colors = {
            info: '#007bff',
            warning: '#ffc107',
            error: '#dc3545',
            success: '#28a745'
        };
        messageElement.style.backgroundColor = colors[type] || colors.info;
        messageElement.textContent = message;
        document.body.appendChild(messageElement);
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        }, duration);
    },
    executeWithErrorHandling: (operation, context = {}, userMessage = 'エラーが発生しました') => {
        try {
            const result = operation();
            if (result && typeof result.then === 'function') {
                return result.catch(error => {
                    utils.logError(error, context);
                    utils.showMessage(`${userMessage}: ${error.message}`, 'error');
                    throw error;
                });
            }
            return result;
        } catch (error) {
            utils.logError(error, context);
            utils.showMessage(`${userMessage}: ${error.message}`, 'error');
            throw error;
        }
    },
    logError: (error, context = {}) => {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            context
        };
        console.error('詳細エラー情報:', errorInfo);
    },
    validateInput: (value, rules = {}) => {
        const result = { isValid: true, error: '' };
        
        if (rules.required && (value === null || value === undefined || value === '')) {
            return { isValid: false, error: '必須項目です' };
        }
        
        if (rules.type === 'number') {
            const numValue = parseFloat(value);
            if (isNaN(numValue)) {
                return { isValid: false, error: '数値を入力してください' };
            }
            
            if (rules.min !== undefined && numValue < rules.min) {
                return { isValid: false, error: `${rules.min}以上の値を入力してください` };
            }
            
            if (rules.max !== undefined && numValue > rules.max) {
                return { isValid: false, error: `${rules.max}以下の値を入力してください` };
            }
        }
        
        return result;
    },

    /**
     * メモリリークを防ぐクリーンアップユーティリティ
     * @param {Array} cleanupCallbacks - クリーンアップコールバック関数の配列
     */
    cleanup: (cleanupCallbacks = []) => {
        cleanupCallbacks.forEach(callback => {
            try {
                if (typeof callback === 'function') {
                    callback();
                }
            } catch (error) {
                console.warn('クリーンアップエラー:', error);
            }
        });
    }
};

const calculateSelfWeight = {
    getMemberSelfWeight: (density, area, length) => {
        if (!density || !area || !length || density <= 0 || area <= 0 || length <= 0) {
            return 0;
        }

        const areaInM2 = area * 1e-4;
        const weightPerMeter = density * areaInM2 * 9.807 / 1000;

        return weightPerMeter;
    },

    calculateAllSelfWeights: (nodes, members, considerSelfWeightCheckbox, membersTableBody) => {
        const memberSelfWeights = [];
        const nodeSelfWeights = [];

        if (!considerSelfWeightCheckbox || !considerSelfWeightCheckbox.checked) {
            return { memberSelfWeights, nodeSelfWeights };
        }

        if (!membersTableBody) {
            console.warn('membersTableBody が見つからないため自重計算をスキップします');
            return { memberSelfWeights, nodeSelfWeights };
        }

        const nodeWeightMap = new Map();

        members.forEach((member, index) => {
            const node1 = nodes[member.i];
            const node2 = nodes[member.j];
            if (!node1 || !node2) return;

            const dx = node2.x - node1.x;
            const dy = node2.y - node1.y;
            const dz = node2.z - node1.z;
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!(length > 0)) return;

            const memberRow = membersTableBody.rows[index];
            if (!memberRow) return;

            const densityCell = memberRow.querySelector('.density-cell');
            if (!densityCell) return;

            const densityInput = densityCell.querySelector('input');
            const density = densityInput ? parseFloat(densityInput.value) : 0;

            const areaInput = memberRow.cells[9]?.querySelector('input');
            const area = areaInput ? parseFloat(areaInput.value) : 0;

            if (!(density > 0) || !(area > 0)) return;

            const areaInM2 = area * 1e-4;
            const totalWeight = density * areaInM2 * length * 9.807 / 1000;
            const weightPerMeter = totalWeight / length;

            if (!window.selfWeightCalcLogCount) window.selfWeightCalcLogCount = 0;
            if (window.selfWeightCalcLogCount === 0) {
                console.log(`部材${index + 1}自重計算詳細:`);
                console.log(`  密度: ${density} kg/m³`);
                console.log(`  断面積: ${area} cm² (${areaInM2.toFixed(6)} m²)`);
                console.log(`  部材長: ${length.toFixed(3)} m`);
                console.log(`  総重量: ${totalWeight.toFixed(4)} kN`);
                console.log(`  単位重量: ${weightPerMeter.toFixed(4)} kN/m`);
                window.selfWeightCalcLogCount = 1;
            }

            // 水平面からの傾斜角を計算（0°=水平, 90°=鉛直）
            const horizontalLength = Math.sqrt(dx * dx + dy * dy);
            const angleFromHorizontal = Math.atan2(Math.abs(dz), horizontalLength);
            const angleDegrees = angleFromHorizontal * 180 / Math.PI;

            const HORIZONTAL_TOLERANCE = 5;
            const VERTICAL_TOLERANCE = 5;

            let memberType;
            if (angleDegrees <= HORIZONTAL_TOLERANCE) {
                memberType = 'horizontal';
            } else if (angleDegrees >= (90 - VERTICAL_TOLERANCE)) {
                memberType = 'vertical';
            } else {
                memberType = 'inclined';
            }

            if (!window.memberTypeLogCount) window.memberTypeLogCount = 0;
            if (window.memberTypeLogCount < 5) {
                console.log(`部材${index + 1}: 角度=${angleDegrees.toFixed(1)}°, タイプ=${memberType}, 総重量=${totalWeight.toFixed(2)}kN, 長さ=${length.toFixed(2)}m`);
                window.memberTypeLogCount++;
            }

            if (memberType === 'horizontal') {
                const selfWeightValue = weightPerMeter;
                memberSelfWeights.push({
                    memberIndex: index,
                    member: index + 1,
                    w: selfWeightValue,
                    wz: selfWeightValue,  // 正の値で格納（大きさ）
                    totalWeight,
                    isFromSelfWeight: true,
                    loadType: 'distributed'
                });
            } else if (memberType === 'vertical') {
                const lowerNodeIndex = node1.z > node2.z ? member.i : member.j;

                memberSelfWeights.push({
                    memberIndex: index,
                    member: index + 1,
                    w: 0,
                    totalWeight,
                    isFromSelfWeight: true,
                    loadType: 'concentrated',
                    appliedNodeIndex: lowerNodeIndex
                });

                if (!nodeWeightMap.has(lowerNodeIndex)) {
                    nodeWeightMap.set(lowerNodeIndex, { nodeIndex: lowerNodeIndex, px: 0, py: 0, pz: 0 });
                }
                nodeWeightMap.get(lowerNodeIndex).pz -= totalWeight;
            } else {
                // 斜め部材: 自重を部材軸方向と垂直成分に分解
                // 重力ベクトル: (0, 0, -weightPerMeter) (下向き)
                // 部材軸ベクトル: (dx, dy, dz) / length
                
                const memberAxisX = dx / length;
                const memberAxisY = dy / length;
                const memberAxisZ = dz / length;
                
                // 重力の部材軸方向成分（部材に沿った荷重、引張/圧縮を生む）
                const axialComponent = -memberAxisZ * weightPerMeter;
                
                // 重力の部材軸垂直成分（曲げを生む分布荷重）
                const lateralComponent = Math.sqrt(weightPerMeter * weightPerMeter - axialComponent * axialComponent);
                
                memberSelfWeights.push({
                    memberIndex: index,
                    member: index + 1,
                    w: lateralComponent,  // 互換性のため
                    wz: lateralComponent,  // 正の値で格納（大きさ）
                    totalWeight,
                    isFromSelfWeight: true,
                    loadType: 'distributed'
                });

                // 軸方向成分は節点荷重として両端に分配
                const axialForce = axialComponent * length / 2;
                
                if (!nodeWeightMap.has(member.i)) {
                    nodeWeightMap.set(member.i, { nodeIndex: member.i, px: 0, py: 0, pz: 0 });
                }
                if (!nodeWeightMap.has(member.j)) {
                    nodeWeightMap.set(member.j, { nodeIndex: member.j, px: 0, py: 0, pz: 0 });
                }
                
                // 軸方向力を節点荷重として追加
                nodeWeightMap.get(member.i).px -= memberAxisX * axialForce;
                nodeWeightMap.get(member.i).py -= memberAxisY * axialForce;
                nodeWeightMap.get(member.i).pz -= memberAxisZ * axialForce;
                
                nodeWeightMap.get(member.j).px -= memberAxisX * axialForce;
                nodeWeightMap.get(member.j).py -= memberAxisY * axialForce;
                nodeWeightMap.get(member.j).pz -= memberAxisZ * axialForce;
            }
        });

        nodeWeightMap.forEach(nodeLoad => {
            nodeSelfWeights.push(nodeLoad);
        });

        console.log('📊 自重計算結果:');
        console.log('  部材自重数:', memberSelfWeights.length);
        console.log('  節点自重数:', nodeSelfWeights.length);
        nodeSelfWeights.forEach(load => {
            console.log(`  節点${load.nodeIndex + 1}: px=${load.px.toFixed(3)}, py=${load.py.toFixed(3)}, pz=${load.pz.toFixed(3)}`);
        });

        // テーブルの自重表示を更新
        memberSelfWeights.forEach(selfWeight => {
            if (selfWeight.totalWeight && selfWeight.memberIndex !== undefined) {
                const memberRow = membersTableBody.rows[selfWeight.memberIndex];
                if (memberRow) {
                    const densityCell = memberRow.querySelector('.density-cell');
                    if (densityCell) {
                        const selfWeightDisplay = densityCell.querySelector('.self-weight-display');
                        if (selfWeightDisplay) {
                            selfWeightDisplay.textContent = `自重: ${selfWeight.totalWeight.toFixed(3)} kN`;
                        }
                    }
                }
            }
        });

        return { memberSelfWeights, nodeSelfWeights };
    }
};

function highlightSelectedElements() {
    const canvas = document.getElementById('model-canvas') || document.getElementById('canvas');
    if (!canvas) {
        console.error('キャンバス要素が見つかりません');
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('2Dコンテキストが取得できません');
        return;
    }

    const drawingContext = window.lastDrawingContext;
    if (!drawingContext || typeof drawingContext.transform !== 'function') {
        console.error('window.lastDrawingContext が利用できません');
        return;
    }

    try {
        const { nodes, members } = window.parseInputs();
        const projectionMode = typeof getCurrentProjectionMode === 'function'
            ? getCurrentProjectionMode()
            : 'xy';

        const projectedNodes = Array.isArray(nodes)
            ? nodes.map(node => project3DTo2D(node, projectionMode))
            : [];

        const visibleNodeIndices = typeof getVisibleNodeIndices === 'function'
            ? getVisibleNodeIndices(nodes)
            : new Set(projectedNodes.map((_, index) => index));

        const getProjectedNode = (index) => {
            if (!Number.isInteger(index) || index < 0) return null;
            return projectedNodes[index] || null;
        };

        const isNodeVisible = (index) => {
            if (!Number.isInteger(index) || index < 0) return false;
            return visibleNodeIndices.has(index);
        };

        const transformPoint = (point) => {
            if (!point) return null;
            return drawingContext.transform(point.x, point.y);
        };

        const hasValidNode = Number.isInteger(window.selectedNodeIndex) && window.selectedNodeIndex >= 0;
        const hasValidMember = Number.isInteger(window.selectedMemberIndex) && window.selectedMemberIndex >= 0;

        if (hasValidNode && isNodeVisible(window.selectedNodeIndex)) {
            const nodeIndex = window.selectedNodeIndex;
            const node = nodes[nodeIndex];
            const projectedNode = getProjectedNode(nodeIndex);
            if (node && projectedNode) {
                const drawPos = transformPoint(projectedNode);
                if (drawPos) {
                    ctx.save();
                    ctx.strokeStyle = '#0066ff';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(drawPos.x, drawPos.y, 10, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        } else if (hasValidMember) {
            const memberIndex = window.selectedMemberIndex;
            const member = members[memberIndex];
            if (member) {
                const projected1 = getProjectedNode(member.i);
                const projected2 = getProjectedNode(member.j);
                if (projected1 && projected2 && isNodeVisible(member.i) && isNodeVisible(member.j)) {
                    const pos1 = transformPoint(projected1);
                    const pos2 = transformPoint(projected2);
                    if (pos1 && pos2) {
                        ctx.save();
                        ctx.strokeStyle = '#0066ff';
                        ctx.lineWidth = 5;
                        ctx.beginPath();
                        ctx.moveTo(pos1.x, pos1.y);
                        ctx.lineTo(pos2.x, pos2.y);
                        ctx.stroke();
                        ctx.restore();
                    }
                }
            }
        }

        if (window.selectedNodes && window.selectedNodes.size > 0) {
            for (const nodeId of window.selectedNodes) {
                if (!isNodeVisible(nodeId)) continue;
                const projectedNode = getProjectedNode(nodeId);
                const drawPos = transformPoint(projectedNode);
                if (drawPos) {
                    ctx.save();
                    ctx.strokeStyle = '#ff4444';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(drawPos.x, drawPos.y, 8, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        if (window.selectedMembers && window.selectedMembers.size > 0) {
            for (const memberId of window.selectedMembers) {
                const member = members[memberId];
                if (!member) continue;
                const projected1 = getProjectedNode(member.i);
                const projected2 = getProjectedNode(member.j);
                if (!projected1 || !projected2) continue;
                if (!isNodeVisible(member.i) || !isNodeVisible(member.j)) continue;

                const pos1 = transformPoint(projected1);
                const pos2 = transformPoint(projected2);
                if (!pos1 || !pos2) continue;

                ctx.save();
                ctx.strokeStyle = '#ff4444';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(pos1.x, pos1.y);
                ctx.lineTo(pos2.x, pos2.y);
                ctx.stroke();
                ctx.restore();
            }
        }
    } catch (e) {
        console.error('❌ 強調表示エラー:', e);
    }
}

// グローバルに確実に登録
window.highlightSelectedElements = highlightSelectedElements;

// 複数選択をクリアする関数
function clearMultiSelection() {
    console.log('複数選択をクリア - 以前の状態:', {
        selectedNodes: Array.from(selectedNodes),
        selectedMembers: Array.from(selectedMembers)
    });
    selectedNodes.clear();
    selectedMembers.clear();
    isMultiSelecting = false;
    if (typeof drawOnCanvas === 'function') {
        drawOnCanvas();
    }
    console.log('複数選択クリア完了');
}

function convertSectionProperties(props) {
    return {
        E: UNIT_CONVERSION.E_STEEL,  // N/mm²
        G: UNIT_CONVERSION.G_STEEL,  // N/mm²
        I: props.I * UNIT_CONVERSION.CM4_TO_MM4,  // cm⁴ → mm⁴
        A: props.A * UNIT_CONVERSION.CM2_TO_MM2,  // cm² → mm²
        Z: props.Z * UNIT_CONVERSION.CM3_TO_MM3   // cm³ → mm³
    };
}

function inverseTransform(mouseX, mouseY) {
    const drawingContext = window.lastDrawingContext;
    if (!drawingContext) {
        return null;
    }

    const { scale, offsetX, offsetY } = drawingContext;
    const modelX = (mouseX - offsetX) / scale;
    const modelY = (mouseY - offsetY) / -scale;

    return { x: modelX, y: modelY };
}

window.inverseTransform = inverseTransform;

function normalizeAxisInfo(axisInfo) {
    if (!axisInfo || typeof axisInfo !== 'object') return null;

    const fallbackKeyFromMode = (mode) => {
        switch (mode) {
            case 'weak':
                return 'y';
            case 'both':
                return 'both';
            case 'strong':
                return 'x';
            default:
                return null;
        }
    };

    const fallbackModeFromKey = (key) => {
        switch (key) {
            case 'y':
                return 'weak';
            case 'both':
                return 'both';
            case 'x':
            default:
                return 'strong';
        }
    };

    const fallbackLabelFromKey = (key) => {
        switch (key) {
            case 'y':
                return '弱軸 (Y軸)';
            case 'both':
                return '両軸 (X=Y)';
            case 'x':
            default:
                return '強軸 (X軸)';
        }
    };

    const candidateKey = typeof axisInfo.key === 'string' ? axisInfo.key.trim().toLowerCase() : '';
    const candidateMode = typeof axisInfo.mode === 'string' ? axisInfo.mode.trim().toLowerCase() : '';
    const candidateLabel = typeof axisInfo.label === 'string' ? axisInfo.label.trim() : '';

    const resolvedKey = ['x', 'y', 'both'].includes(candidateKey)
        ? candidateKey
        : (fallbackKeyFromMode(candidateMode) || 'x');
    const normalizedKey = ['x', 'y', 'both'].includes(resolvedKey) ? resolvedKey : 'x';

    const resolvedMode = ['strong', 'weak', 'both'].includes(candidateMode)
        ? (normalizedKey === 'both' ? 'both' : (candidateMode === 'both' ? fallbackModeFromKey(normalizedKey) : candidateMode))
        : fallbackModeFromKey(normalizedKey);

    const resolvedLabel = candidateLabel || fallbackLabelFromKey(normalizedKey);

    return { key: normalizedKey, mode: resolvedMode, label: resolvedLabel };
}

function deriveAxisKeyFromLabel(label) {
    if (!label) return null;
    const normalized = `${label}`.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('両') || normalized.includes('both') || normalized.includes('x=y') || normalized.includes('same')) {
        return 'both';
    }
    if (normalized.includes('弱') || normalized.includes('y') || normalized.includes('weak')) {
        return 'y';
    }
    if (normalized.includes('強') || normalized.includes('x') || normalized.includes('strong')) {
        return 'x';
    }
    return null;
}

function findMemberLoadRow(memberIndex) {
    if (!elements || !elements.memberLoadsTable || !Number.isInteger(memberIndex)) {
        return null;
    }

    return Array.from(elements.memberLoadsTable.rows || []).find((row) => {
        const memberInput = row.cells[0]?.querySelector('input');
        if (!memberInput) return false;
        const value = parseInt(memberInput.value, 10);
        return Number.isInteger(value) && value - 1 === memberIndex;
    }) || null;
}

function readMemberLoadComponents(row) {
    if (!(row instanceof HTMLTableRowElement)) {
        return { wx: 0, wy: 0, wz: 0 };
    }
    const readCellValue = (index) => {
        const input = row.cells[index]?.querySelector('input');
        const value = input ? parseFloat(input.value) : 0;
        return Number.isFinite(value) ? value : 0;
    };

    return {
        wx: readCellValue(1),
        wy: readCellValue(2),
        wz: readCellValue(3)
    };
}

function areLoadsNearlyZero(loads, tolerance = 1e-6) {
    if (!loads || typeof loads !== 'object') return true;
    return ['wx', 'wy', 'wz'].every((key) => {
        const value = parseFloat(loads[key]);
        return !Number.isFinite(value) || Math.abs(value) <= tolerance;
    });
}

function setPopupLoadInputs(loads = {}) {
    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) {
            const numericValue = Number.isFinite(value) ? value : 0;
            input.value = numericValue;
        }
    };

    setValue('popup-wx', loads.wx ?? 0);
    setValue('popup-wy', loads.wy ?? 0);
    setValue('popup-wz', loads.wz ?? 0);
}

function getPopupLoadInputs() {
    const readValue = (id) => {
        const input = document.getElementById(id);
        const value = input ? parseFloat(input.value) : 0;
        return Number.isFinite(value) ? value : 0;
    };

    return {
        wx: readValue('popup-wx'),
        wy: readValue('popup-wy'),
        wz: readValue('popup-wz')
    };
}

function updateMemberLoadRow(memberIndex, loads) {
    if (!elements || !elements.memberLoadsTable) return null;

    const sanitizedLoads = {
        wx: Number.isFinite(loads?.wx) ? loads.wx : 0,
        wy: Number.isFinite(loads?.wy) ? loads.wy : 0,
        wz: Number.isFinite(loads?.wz) ? loads.wz : 0
    };

    let row = findMemberLoadRow(memberIndex);

    if (!row) {
        row = addRow(elements.memberLoadsTable, [
            `<input type="number" value="${memberIndex + 1}">`,
            `<input type="number" value="${sanitizedLoads.wx}">`,
            `<input type="number" value="${sanitizedLoads.wy}">`,
            `<input type="number" value="${sanitizedLoads.wz}">`
        ]);
    } else {
        const setCell = (index, value) => {
            const input = row.cells[index]?.querySelector('input');
            if (input) {
                input.value = value;
            }
        };
        setCell(1, sanitizedLoads.wx);
        setCell(2, sanitizedLoads.wy);
        setCell(3, sanitizedLoads.wz);

        const memberInput = row.cells[0]?.querySelector('input');
        if (memberInput) {
            memberInput.value = memberIndex + 1;
        }
    }

    return row;
}

function getPopupDensityElements() {
    return {
        densityLabel: document.getElementById('popup-density-label'),
        densityContainer: document.getElementById('popup-density-container'),
        densityInput: document.getElementById('popup-density-input'),
        densitySelect: document.getElementById('popup-density-select'),
        selfWeightLabel: document.getElementById('popup-self-weight-label'),
        selfWeightValue: document.getElementById('popup-self-weight-value')
    };
}

function updatePopupSelfWeightDisplay() {
    const { densityContainer, densityInput, selfWeightLabel, selfWeightValue } = getPopupDensityElements();
    if (!densityContainer || densityContainer.style.display === 'none') {
        return;
    }

    const areaInput = document.getElementById('popup-a');
    if (!areaInput) return;

    const density = parseFloat(densityInput?.value ?? '0');
    const area = parseFloat(areaInput.value ?? '0');
    const weightPerMeter = calculateSelfWeight.getMemberSelfWeight(density, area, 1);

    if (selfWeightLabel) selfWeightLabel.style.display = '';
    if (selfWeightValue) {
        selfWeightValue.style.display = '';
        if (Number.isFinite(weightPerMeter) && weightPerMeter > 0) {
            selfWeightValue.textContent = `${weightPerMeter.toFixed(3)} kN/m`;
        } else {
            selfWeightValue.textContent = '-';
        }
    }
}

function setupPopupDensityHandlers() {
    const { densityInput, densitySelect } = getPopupDensityElements();
    if (densitySelect) {
        densitySelect.addEventListener('change', () => {
            updatePopupSelfWeightDisplay();
        });
    }

    if (densityInput) {
        densityInput.addEventListener('input', updatePopupSelfWeightDisplay);
    }
}

// 部材ツールチップ関数
function detectMemberAtPosition(clientX, clientY) {
    console.log('🔍 detectMemberAtPosition呼び出し - 座標:', clientX, clientY);
    
    // DOM要素から部材データを取得
    const membersTable = document.getElementById('members-table')?.getElementsByTagName('tbody')[0];
    if (!membersTable || membersTable.rows.length === 0) {
        console.log('❌ 部材テーブルが見つからない - 行数:', membersTable?.rows?.length || 0);
        return null;
    }
    
    const nodesTable = document.getElementById('nodes-table')?.getElementsByTagName('tbody')[0];
    if (!nodesTable || nodesTable.rows.length === 0) {
        console.log('❌ 節点テーブルが見つからない - 行数:', nodesTable?.rows?.length || 0);
        return null;
    }
    
    console.log('📊 テーブル確認 - 部材:', membersTable.rows.length, '行, 節点:', nodesTable.rows.length, '行');
    
    // キャンバス要素を取得
    const canvas = document.getElementById("model-canvas");
    if (!canvas) {
        console.log('❌ キャンバス要素が見つからない');
        return null;
    }
    
    const getCellValue = (cell) => {
        if (!cell) return '';
        const input = cell.querySelector('input');
        if (input && typeof input.value === 'string') {
            const value = input.value.trim();
            if (value !== '') {
                return value;
            }
        }
        const select = cell.querySelector('select');
        if (select) {
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption) {
                const optionLabel = selectedOption.textContent?.trim();
                if (optionLabel) {
                    return optionLabel;
                }
            }
            const selectValue = select.value?.trim();
            if (selectValue) {
                return selectValue;
            }
        }
        return cell.textContent?.trim() || '';
    };
    const getCellNumber = (cell) => {
        const rawValue = getCellValue(cell);
        if (!rawValue) return NaN;
        const numericValue = parseFloat(rawValue.replace(/,/g, ''));
        return Number.isFinite(numericValue) ? numericValue : NaN;
    };
    const getCellInteger = (cell) => {
        const rawValue = getCellValue(cell);
        if (!rawValue) return NaN;
        const integerValue = parseInt(rawValue.replace(/,/g, ''), 10);
        return Number.isFinite(integerValue) ? integerValue : NaN;
    };

    const parseOptionalFloat = (value) => {
        if (value === undefined || value === null) return null;
        const numeric = Number.parseFloat(String(value).replace(/,/g, ''));
        return Number.isFinite(numeric) ? numeric : null;
    };

    const getSelectLabel = (select) => {
        if (!select) return '';
        const option = select.options?.[select.selectedIndex];
        if (option && typeof option.textContent === 'string') {
            const trimmed = option.textContent.trim();
            if (trimmed) return trimmed;
        }
        return select.value || '';
    };

    // 節点データを取得（ヘッダー行をスキップ）
    const nodesMap = {};
    const nodeRows = Array.from(nodesTable.rows);
    console.log('📊 節点テーブル行数:', nodeRows.length);
    
    // 最初の行がヘッダーの場合はスキップ
    nodeRows.forEach((row, index) => {
        const firstCellText = getCellValue(row.cells[0]);
        
        // ヘッダー行の識別（数値以外または特定キーワードを含む場合はヘッダーとみなす）
        const isHeader = isNaN(parseInt(firstCellText)) || 
                        firstCellText.includes('節点') || 
                        firstCellText.includes('Node') ||
                        firstCellText.includes('番号');
        
        if (index === 0) {
            console.log('📊 節点最初の行:', Array.from(row.cells).map(cell => cell.textContent?.trim()));
            console.log('📊 ヘッダー判定:', isHeader, '(firstCell:', firstCellText, ')');
        }
        
        if (isHeader) {
            console.log(`📊 節点行${index}スキップ (ヘッダー):`, firstCellText);
            return;
        }
        
        const nodeNumber = getCellInteger(row.cells[0]);
        const x = getCellNumber(row.cells[1]);
        const y = getCellNumber(row.cells[2]);
        const z = getCellNumber(row.cells[3]);

        if (index <= 7) {
            console.log(`📊 節点行${index}: number=${nodeNumber}, x=${x}, y=${y}, z=${z}`);
        }

        if (!isNaN(nodeNumber) && !isNaN(x) && !isNaN(y)) {
            nodesMap[nodeNumber] = { x, y, z: isNaN(z) ? 0 : z };
            console.log(`✅ 節点${nodeNumber}追加: (${x}, ${y}, ${z})`);
        }
    });

    console.log('📊 全nodesMap:', nodesMap);
    
    // 部材データを取得（ヘッダー行をスキップ）
    const members = [];
    const memberRows = Array.from(membersTable.rows);
    console.log('📊 部材テーブル行数:', memberRows.length);
    
    const uniformLoadMap = new Map();
    const memberLoadsTable = document.getElementById('member-loads-table')?.getElementsByTagName('tbody')[0];
    if (memberLoadsTable && memberLoadsTable.rows) {
        Array.from(memberLoadsTable.rows).forEach((loadRow) => {
            const memberInput = loadRow.cells?.[0]?.querySelector('input');
            const memberId = parseInt(memberInput?.value, 10);
            if (!Number.isFinite(memberId)) {
                return;
            }

            const wxInput = loadRow.cells?.[1]?.querySelector('input');
            const wyInput = loadRow.cells?.[2]?.querySelector('input');
            const wzInput = loadRow.cells?.[3]?.querySelector('input');

            const wxValue = parseOptionalFloat(wxInput?.value) || 0;
            const wyValue = parseOptionalFloat(wyInput?.value) || 0;
            const wzValue = parseOptionalFloat(wzInput?.value) || 0;

            if (wxValue !== 0 || wyValue !== 0 || wzValue !== 0) {
                uniformLoadMap.set(memberId, { wx: wxValue, wy: wyValue, wz: wzValue });
            } else {
                uniformLoadMap.set(memberId, { wx: 0, wy: 0, wz: 0 });
            }
        });
    }

    memberRows.forEach((row, index) => {
        const firstCellText = getCellValue(row.cells[0]);
        
        // ヘッダー行の識別（数値以外または特定キーワードを含む場合はヘッダーとみなす）
        const isHeader = isNaN(parseInt(firstCellText)) || 
                        firstCellText.includes('部材') || 
                        firstCellText.includes('Member') ||
                        firstCellText.includes('番号');
        
        if (index === 0) {
            console.log('📊 部材最初の行:', Array.from(row.cells).map(cell => cell.textContent?.trim()));
            console.log('📊 ヘッダー判定:', isHeader, '(firstCell:', firstCellText, ')');
        }
        
        if (isHeader) {
            console.log(`📊 部材行${index}スキップ (ヘッダー):`, firstCellText);
            return;
        }
        
        const memberNumber = getCellInteger(row.cells[0]);
        const nodeI = getCellInteger(row.cells[1]);
        const nodeJ = getCellInteger(row.cells[2]);

        const materialSelect = row.cells[3]?.querySelector('select');
        const materialSelectLabel = getSelectLabel(materialSelect);
        let material = '';
        if (materialSelectLabel) {
            material = materialSelectLabel;
        } else {
            material = getCellValue(row.cells[3]);
        }

        const strengthSelect = row.cells[4]?.querySelector('select');
        const strengthInput = row.cells[4]?.querySelector('input');
        let section = '';
        if (strengthSelect) {
            const selectedStrength = strengthSelect.options[strengthSelect.selectedIndex];
            const strengthLabel = selectedStrength?.textContent?.trim();
            if (strengthSelect.value === 'custom' && strengthInput && strengthInput.value.trim() !== '') {
                section = `任意 (${strengthInput.value.trim()} N/mm²)`;
            } else {
                section = strengthLabel || strengthSelect.value || '';
            }
        } else {
            section = getCellValue(row.cells[4]);
        }

        let sectionInfo = null;
        if (row.dataset.sectionInfo) {
            try {
                sectionInfo = JSON.parse(decodeURIComponent(row.dataset.sectionInfo));
                sectionInfo = ensureSectionSvgMarkup(sectionInfo);
            } catch (error) {
                console.warn('Failed to parse sectionInfo for row', index, error);
            }
        }
        const sectionLabel = row.dataset.sectionLabel || sectionInfo?.label;
        const sectionSummary = row.dataset.sectionSummary || sectionInfo?.dimensionSummary || '';
        if (sectionLabel) {
            section = sectionLabel;
        }

        const eInput = row.cells[3]?.querySelector('input[type="number"]');
        const elasticModulus = {
            value: eInput?.value?.trim() || '',
            numeric: parseOptionalFloat(eInput?.value),
            label: materialSelectLabel,
            optionValue: materialSelect?.value || ''
        };

        const strengthCell = row.cells[4];
        const strengthContainer = strengthCell?.querySelector('[data-strength-type]') || strengthCell?.firstElementChild || null;
        const strengthType = strengthContainer?.dataset?.strengthType || 'F-value';
        const strengthSelectEl = strengthContainer?.querySelector('select');
        const strengthInputs = strengthContainer ? Array.from(strengthContainer.querySelectorAll('input')) : [];
        let strengthValue = '';
        let strengthLabel = '';
        let strengthDetails = null;
        if (strengthType === 'wood-type') {
            strengthValue = strengthSelectEl?.value || '';
            strengthLabel = getSelectLabel(strengthSelectEl);
            strengthDetails = strengthInputs.reduce((acc, input) => {
                const key = input.id ? input.id.split('-').pop() : input.name || '';
                if (key) {
                    acc[key] = input.value;
                }
                return acc;
            }, {});
        } else {
            const strengthPrimaryInput = strengthInputs[0] || strengthInput;
            strengthValue = strengthPrimaryInput?.value || '';
            strengthLabel = getSelectLabel(strengthSelectEl) || strengthValue;
        }

        const inertiaInput = row.cells[5]?.querySelector('input[type="number"]');
        const areaInput = row.cells[9]?.querySelector('input[type="number"]');
        const modulusInput = row.cells[10]?.querySelector('input[type="number"]');

        const densityCell = row.querySelector('.density-cell');
        const densitySelect = densityCell?.querySelector('select');
        const densityInput = densityCell?.querySelector('input');
        const densityInfo = densityCell ? {
            value: densityInput?.value || '',
            numeric: parseOptionalFloat(densityInput?.value),
            label: getSelectLabel(densitySelect),
            optionValue: densitySelect?.value || ''
        } : null;

        let sectionAxis = null;
        if (row.dataset.sectionAxisKey || row.dataset.sectionAxisLabel || row.dataset.sectionAxisMode) {
            sectionAxis = normalizeAxisInfo({
                key: row.dataset.sectionAxisKey,
                mode: row.dataset.sectionAxisMode,
                label: row.dataset.sectionAxisLabel
            });
        } else if (sectionInfo && sectionInfo.axis) {
            sectionAxis = normalizeAxisInfo(sectionInfo.axis);
        }
        
        const connSelects = Array.from(row.querySelectorAll('select.conn-select'));
        const startConnSelect = connSelects[0] || null;
        const endConnSelect = connSelects[1] || null;

        const areaNumeric = parseOptionalFloat(areaInput?.value);
        const densityNumeric = densityInfo?.numeric;
        const selfWeightPerLength = (densityNumeric !== null && areaNumeric !== null)
            ? (densityNumeric * (areaNumeric * 1e-4) * 9.80665 / 1000)
            : null;

        const uniformLoad = uniformLoadMap.get(memberNumber) ?? null;

        console.log(`📊 部材行${index}: member=${memberNumber}, nodeI=${nodeI}, nodeJ=${nodeJ}`);

        if (index === 0) {
            console.log('🔍 nodesMap内容:', nodesMap);
            console.log('🔍 nodeI検索:', nodeI, '→', nodesMap[nodeI]);
            console.log('🔍 nodeJ検索:', nodeJ, '→', nodesMap[nodeJ]);
        }

        if (!isNaN(memberNumber) && !isNaN(nodeI) && !isNaN(nodeJ) &&
            nodesMap[nodeI] && nodesMap[nodeJ]) {
            members.push({
                number: memberNumber,
                nodeI,
                nodeJ,
                material,
                materialValue: materialSelect?.value || '',
                section,
                sectionLabel,
                sectionInfo,
                sectionSummary,
                sectionAxis,
                sectionSource: row.dataset.sectionSource || sectionInfo?.source || '',
                nodes: {
                    i: nodesMap[nodeI],
                    j: nodesMap[nodeJ]
                },
                properties: {
                    elasticModulus,
                    strength: {
                        type: strengthType,
                        value: strengthValue,
                        label: strengthLabel,
                        numeric: strengthType === 'wood-type' ? null : parseOptionalFloat(strengthValue),
                        details: strengthDetails
                    },
                    inertia: {
                        value: inertiaInput?.value || '',
                        numeric: parseOptionalFloat(inertiaInput?.value),
                        unit: 'cm⁴'
                    },

                    area: {
                        value: areaInput?.value || '',
                        numeric: areaNumeric,
                        unit: 'cm²'
                    },
                    sectionModulus: {
                        value: modulusInput?.value || '',
                        numeric: parseOptionalFloat(modulusInput?.value),
                        unit: 'cm³',
                        zx: row.dataset.zx || '',
                        zy: row.dataset.zy || '',
                        zxNumeric: parseOptionalFloat(row.dataset.zx),
                        zyNumeric: parseOptionalFloat(row.dataset.zy)
                    },
                    radiusOfGyration: {
                        ix: row.dataset.ix || '',
                        iy: row.dataset.iy || '',
                        ixNumeric: parseOptionalFloat(row.dataset.ix),
                        iyNumeric: parseOptionalFloat(row.dataset.iy)
                    },
                    density: densityInfo,
                    selfWeightPerLength
                },
                connections: {
                    start: {
                        value: startConnSelect?.value || 'rigid',
                        label: getSelectLabel(startConnSelect) || '剛'
                    },
                    end: {
                        value: endConnSelect?.value || 'rigid',
                        label: getSelectLabel(endConnSelect) || '剛'
                    }
                },
                loads: {
                    uniform: uniformLoad
                }
            });
            console.log(`✅ 部材${memberNumber}追加: ${nodeI}-${nodeJ}`);
        }
    });
    
    if (members.length === 0 || Object.keys(nodesMap).length === 0) {
        console.log('❌ データ不足 - 部材:', members.length, '個, 節点:', Object.keys(nodesMap).length, '個');
        return null;
    }
    
    console.log('📏 有効データ - 部材:', members.length, '個, 節点:', Object.keys(nodesMap).length, '個');
    
    // キャンバス座標からモデル座標への変換（既存のinverseTransform関数を使用）
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    
    console.log('🖱️ マウス位置: キャンバス内=', mouseX.toFixed(2), mouseY.toFixed(2));
    
    // 既存の座標変換システムを使用
    const worldCoords = inverseTransform(mouseX, mouseY);
    if (!worldCoords) {
        console.log('❌ 座標変換失敗 - lastDrawingContextが未初期化');
        return null;
    }
    
    const { x: worldX, y: worldY } = worldCoords;
    console.log('🌍 ワールド座標:', worldX.toFixed(2), worldY.toFixed(2));
    
    // 現在の描画コンテキスト情報を取得
    const currentDrawingContext = window.lastDrawingContext;
    const currentScale = currentDrawingContext?.scale || 1;
    const transformFn = currentDrawingContext?.transform;

    // 投影モードと奥行き座標を取得
    const projectionMode = document.getElementById('projection-mode')?.value || DEFAULT_PROJECTION_MODE;
    const hiddenAxisCoordSelect = document.getElementById('hidden-axis-coord');
    const rawHiddenAxisCoord = hiddenAxisCoordSelect ? parseFloat(hiddenAxisCoordSelect.value) : 0;
    const hiddenAxisCoord = Number.isFinite(rawHiddenAxisCoord) ? rawHiddenAxisCoord : null;
    const hiddenAxisCoordLog = hiddenAxisCoord !== null ? hiddenAxisCoord : 'n/a';
    const hiddenAxisCoordText = hiddenAxisCoord !== null ? hiddenAxisCoord.toFixed(3) : 'n/a';

    // 画面上の近接判定はピクセル単位で行い、閾値を一定に保つ
    const tolerancePixels = 12;
    const depthTolerance = 0.01; // 奥行き方向の許容誤差 (m)

    const depthAxisMap = { xy: 'z', xz: 'y', yz: 'x' };
    const depthAxis = depthAxisMap[projectionMode] || null;
    const depthAxisLabel = depthAxis ? depthAxis.toUpperCase() : null;

    console.log('📏 近接判定しきい値:', `${tolerancePixels}px`, '(スケール:', currentScale.toFixed(2), ')');
    console.log('🔧 transformFn存在:', !!transformFn, 'currentDrawingContext:', !!currentDrawingContext);
    console.log('📐 投影モード:', projectionMode, '奥行き軸:', depthAxisLabel || 'N/A', '奥行き座標:', hiddenAxisCoordLog);

    let closestMember = null;
    let closestDistancePixels = Infinity;
    let memberDistances = []; // デバッグ用

    members.forEach((member) => {
        const node1 = member.nodes.i;
        const node2 = member.nodes.j;

        // 3D座標を取得 (デフォルトは0)
        const x1 = node1.x || 0;
        const y1 = node1.y || 0;
        const z1 = node1.z || 0;
        const x2 = node2.x || 0;
        const y2 = node2.y || 0;
        const z2 = node2.z || 0;

        // 奥行き座標によるフィルタリング（投影面に応じて判定）
        let node1Depth = null;
        let node2Depth = null;
        if (depthAxis && hiddenAxisCoord !== null) {
            node1Depth = depthAxis === 'x' ? x1 : depthAxis === 'y' ? y1 : z1;
            node2Depth = depthAxis === 'x' ? x2 : depthAxis === 'y' ? y2 : z2;
            const node1Matches = Math.abs(node1Depth - hiddenAxisCoord) <= depthTolerance;
            const node2Matches = Math.abs(node2Depth - hiddenAxisCoord) <= depthTolerance;

            if (!node1Matches || !node2Matches) {
                memberDistances.push({
                    部材: member.number,
                    距離_mm: '-(depth)',
                    画面距離_px: '-(depth)',
                    閾値内: '✗ 奥行',
                    座標: `(${x1.toFixed(1)},${y1.toFixed(1)},${z1.toFixed(1)})-(${x2.toFixed(1)},${y2.toFixed(1)},${z2.toFixed(1)})`,
                    奥行座標: `${depthAxisLabel}:${node1Depth.toFixed(3)},${node2Depth.toFixed(3)} → ${hiddenAxisCoordText}`
                });
                return;
            }
        }

        // 描画と同じ投影処理を適用
        const projected1 = project3DTo2D({ x: x1, y: y1, z: z1 }, projectionMode);
        const projected2 = project3DTo2D({ x: x2, y: y2, z: z2 }, projectionMode);
        const coord1_x = projected1.x;
        const coord1_y = projected1.y;
        const coord2_x = projected2.x;
        const coord2_y = projected2.y;

        // ワールド座標と画面座標の両方で距離を計算
        const worldDistance = distanceFromPointToLine(
            worldX, worldY,
            coord1_x, coord1_y,
            coord2_x, coord2_y
        );

        let screenDistance = Infinity;
        if (transformFn && typeof transformFn === 'function') {
            try {
                // 投影された2D座標でtransformFnを呼び出し
                const screenNode1 = transformFn(coord1_x, coord1_y);
                const screenNode2 = transformFn(coord2_x, coord2_y);
                screenDistance = distanceFromPointToLine(
                    mouseX, mouseY,
                    screenNode1.x, screenNode1.y,
                    screenNode2.x, screenNode2.y
                );
            } catch (e) {
                console.warn('transformFn エラー:', e);
            }
        } else {
            // transformFnがない場合は、ワールド距離をピクセル換算
            screenDistance = worldDistance * currentScale;
        }

        memberDistances.push({
            部材: member.number,
            距離_mm: worldDistance.toFixed(2),
            画面距離_px: Number.isFinite(screenDistance) ? screenDistance.toFixed(2) : 'N/A',
            閾値内: screenDistance <= tolerancePixels ? '✓' : '✗',
            座標: `(${x1.toFixed(1)},${y1.toFixed(1)},${z1.toFixed(1)})-(${x2.toFixed(1)},${y2.toFixed(1)},${z2.toFixed(1)})`,
            投影座標: `(${coord1_x.toFixed(1)},${coord1_y.toFixed(1)})-(${coord2_x.toFixed(1)},${coord2_y.toFixed(1)})`,
            奥行座標: depthAxis && hiddenAxisCoord !== null ? `${depthAxisLabel}:${node1Depth.toFixed(3)},${node2Depth.toFixed(3)} → ${hiddenAxisCoordText}` : '-'
        });
        
        if (Number.isFinite(screenDistance) && screenDistance <= tolerancePixels && screenDistance < closestDistancePixels) {
            closestDistancePixels = screenDistance;
            closestMember = {
                ...member,
                distance: worldDistance
            };
        }
    });
    
    // 全部材の距離をログ出力
    console.table(memberDistances);
    console.log('🎯 検出結果:', closestMember ? `部材${closestMember.number} (画面距離: ${closestDistancePixels.toFixed(2)}px, ワールド距離: ${closestMember.distance.toFixed(2)})` : '部材なし');
    
    return closestMember;
}

function distanceFromPointToLine(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) {
        return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }
    
    // 点から線分への射影を計算
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    
    return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
}

function showMemberTooltip(memberData, mouseX, mouseY) {
    console.log('🔧 ツールチップ表示開始 - 部材:', memberData.number);
    
    const tooltip = document.querySelector('.member-tooltip');
    if (!tooltip || !memberData) {
        console.log('❌ ツールチップ表示失敗:', !tooltip ? 'DOM要素なし' : '部材データなし');
        return;
    }
    
    console.log('✅ ツールチップDOM要素確認完了');
    
    const { number, nodeI, nodeJ, material, section, nodes, sectionInfo, sectionSummary, sectionAxis, properties = {}, connections = {}, loads = {} } = memberData;
    
    // 入力テーブルから直接物性値を取得
    let tableProperties = {};
    try {
        const memberRows = elements.membersTable.rows;
        const memberIndex = number - 1; // 部材番号は1ベース、配列は0ベース
        
        for (let i = 1; i < memberRows.length; i++) {
            const row = memberRows[i];
            const firstCell = row.cells[0];
            let rowMemberNumber = 0;
            
            // 部材番号の取得
            const input = firstCell.querySelector('input');
            if (input && input.value && !isNaN(parseInt(input.value))) {
                rowMemberNumber = parseInt(input.value);
            } else {
                const textContent = firstCell.textContent?.trim();
                if (textContent && !isNaN(parseInt(textContent))) {
                    rowMemberNumber = parseInt(textContent);
                } else {
                    rowMemberNumber = i;
                }
            }
            
            // 部材1の特別処理
            if (i === 1 && memberIndex === 0) {
                rowMemberNumber = 1;
            }
            
            if (rowMemberNumber === number) {
                // テーブルから物性値を取得
                const eInput = row.cells[3]?.querySelector('input[type="number"]');
                const fInput = row.cells[4]?.querySelector('input[type="number"]');
                const ixInput = row.cells[5]?.querySelector('input[type="number"]');
                const iyInput = row.cells[6]?.querySelector('input[type="number"]');
                const jInput = row.cells[7]?.querySelector('input[type="number"]');
                const iwInput = row.cells[8]?.querySelector('input[type="number"]');
                const aInput = row.cells[9]?.querySelector('input[type="number"]');
                const zxInput = row.cells[10]?.querySelector('input[type="number"]');
                const zyInput = row.cells[11]?.querySelector('input[type="number"]');
                
                tableProperties = {
                    E: eInput?.value ? parseFloat(eInput.value) : null,
                    F: fInput?.value ? parseFloat(fInput.value) : null,
                    Ix: ixInput?.value ? parseFloat(ixInput.value) : null,
                    Iy: iyInput?.value ? parseFloat(iyInput.value) : null,
                    J: jInput?.value ? parseFloat(jInput.value) : null,
                    Iw: iwInput?.value ? parseFloat(iwInput.value) : null,
                    A: aInput?.value ? parseFloat(aInput.value) : null,
                    Zx: zxInput?.value ? parseFloat(zxInput.value) : null,
                    Zy: zyInput?.value ? parseFloat(zyInput.value) : null
                };
                
                console.log('🔧 テーブルから物性値取得:', {
                    memberNumber: number,
                    tableProperties
                });
                break;
            }
        }
    } catch (error) {
        console.warn('テーブルからの物性値取得エラー:', error);
    }

    const length = Math.sqrt(Math.pow(nodes.j.x - nodes.i.x, 2) + Math.pow(nodes.j.y - nodes.i.y, 2));
    const axisLabel = sectionAxis?.label || sectionInfo?.axis?.label || '';

    const asNumeric = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const numeric = Number.parseFloat(String(value).replace(/,/g, ''));
        return Number.isFinite(numeric) ? numeric : null;
    };

    const createChip = ({ label, numeric, raw, unit, digits, suffix, emphasis, wide, subValue }) => {
        let displayValue = null;
        if (numeric !== null && numeric !== undefined && Number.isFinite(numeric)) {
            const precision = digits !== undefined ? digits : (Math.abs(numeric) >= 1000 ? 0 : 2);
            displayValue = numeric.toLocaleString(undefined, {
                maximumFractionDigits: precision,
                minimumFractionDigits: 0
            });
        } else if (typeof raw === 'string' && raw.trim() !== '') {
            displayValue = raw.trim();
        }

        if (!displayValue) return '';

        const valueWithUnit = unit ? `${displayValue} ${unit}` : displayValue;
        const suffixText = suffix ? `<span class="chip-suffix">${suffix}</span>` : '';
        const subValueText = subValue ? `<span class="chip-subvalue">${subValue}</span>` : '';
        const modifiers = [wide ? ' tooltip-chip--wide' : '', emphasis ? ' tooltip-chip--emphasis' : ''].join('');

        return `<div class="tooltip-chip${modifiers}"><span class="chip-label">${label}</span><span class="chip-value">${valueWithUnit}</span>${suffixText}${subValueText}</div>`;
    };

    const generalInfoRows = [
        { label: 'I座標', value: `(${nodes.i.x.toFixed(1)}, ${nodes.i.y.toFixed(1)})` },
        { label: 'J座標', value: `(${nodes.j.x.toFixed(1)}, ${nodes.j.y.toFixed(1)})` }
    ];

    if (!sectionInfo && section) {
        generalInfoRows.push({ label: '断面', value: section });
    }

    const summaryChips = [
        { label: '節点', value: `${nodeI} → ${nodeJ}` },
        { label: '長さ', value: `${length.toFixed(1)} mm` }
    ];

    if (axisLabel) {
        summaryChips.push({ label: '軸', value: axisLabel });
    }

    if (material) {
        summaryChips.push({ label: '材料', value: material });
    }

    const summaryChipsHTML = summaryChips
        .map(chip => `<div class="tooltip-chip tooltip-chip--summary"><span class="chip-label">${chip.label}</span><span class="chip-value">${chip.value}</span></div>`)
        .join('');

    const generalInfoHTML = generalInfoRows
        .map(row => `<div class="tooltip-stat-item"><span class="stat-label">${row.label}</span><span class="stat-value">${row.value}</span></div>`)
        .join('');

    const generalInfoSectionHTML = generalInfoHTML
        ? `<div class="tooltip-subsection"><div class="tooltip-subtitle">概要</div><div class="tooltip-stat-grid">${generalInfoHTML}</div></div>`
        : '';

    // テーブルからの値が取得できた場合はそれを使用、そうでなければpropertiesを使用
    const useTableValues = Object.keys(tableProperties).some(key => tableProperties[key] !== null);
    
    let elasticModulus = {}, strength = {}, inertia = {}, areaProp = {}, sectionModulus = {}, radiusOfGyration = {}, densityPropRaw = null, selfWeightPerLength = null;
    
    if (useTableValues) {
        // テーブルからの値を使用
        elasticModulus = { value: tableProperties.E?.toString() || '', numeric: tableProperties.E };
        strength = { value: tableProperties.F?.toString() || '', numeric: tableProperties.F };
        inertia = { 
            value: tableProperties.Ix?.toString() || '', 
            numeric: tableProperties.Ix,
            unit: 'cm⁴',
            ix: tableProperties.Ix?.toString() || '',
            iy: tableProperties.Iy?.toString() || '',
            j: tableProperties.J?.toString() || '',
            ixNumeric: tableProperties.Ix,
            iyNumeric: tableProperties.Iy,
            jNumeric: tableProperties.J
        };
        areaProp = { 
            value: tableProperties.A?.toString() || '', 
            numeric: tableProperties.A,
            unit: 'cm²'
        };
        sectionModulus = {
            value: tableProperties.Zx?.toString() || '',
            numeric: tableProperties.Zx,
            unit: 'cm³',
            zx: tableProperties.Zx?.toString() || '',
            zy: tableProperties.Zy?.toString() || '',
            zxNumeric: tableProperties.Zx,
            zyNumeric: tableProperties.Zy
        };
        
        console.log('🔧 テーブルからの物性値を使用:', {
            memberNumber: number,
            useTableValues,
            tableProperties
        });
    } else {
        // 従来のpropertiesを使用
        ({ 
            elasticModulus = {},
            strength = {},
            inertia = {},
            area: areaProp = {},
            sectionModulus = {},
            radiusOfGyration = {},
            density: densityPropRaw = null,
            selfWeightPerLength = null
        } = properties);
        
        console.log('🔧 従来のpropertiesを使用:', {
            memberNumber: number,
            useTableValues,
            properties
        });
    }

    const densityProp = (densityPropRaw && typeof densityPropRaw === 'object') ? densityPropRaw : {};

    const propertyChips = [];

    if (elasticModulus.value || Number.isFinite(elasticModulus.numeric)) {
        const suffix = elasticModulus.label && elasticModulus.label !== material ? elasticModulus.label : '';
        propertyChips.push(createChip({
            label: 'E',
            numeric: elasticModulus.numeric ?? asNumeric(elasticModulus.value),
            raw: elasticModulus.value,
            unit: 'N/mm²',
            digits: 0,
            suffix
        }));
    }

    if (strength.type === 'wood-type') {
        const detailEntries = strength.details
            ? Object.entries(strength.details).map(([key, value]) => `${key.toUpperCase()}: ${value}`).join(' / ')
            : '';
        propertyChips.push(createChip({
            label: '木材',
            raw: strength.label || 'カスタム',
            unit: '',
            wide: true,
            subValue: detailEntries ? `${detailEntries} N/mm²` : ''
        }));
    } else if (strength.value || Number.isFinite(strength.numeric)) {
        const suffix = strength.label && strength.label !== strength.value ? strength.label : '';
        propertyChips.push(createChip({
            label: 'F',
            numeric: strength.numeric ?? asNumeric(strength.value),
            raw: strength.value,
            unit: 'N/mm²',
            digits: 0,
            suffix
        }));
    }

    // 断面二次モーメント Ix
    if (useTableValues && tableProperties.Ix !== null) {
        propertyChips.push(createChip({
            label: 'Ix',
            numeric: tableProperties.Ix,
            raw: tableProperties.Ix.toString(),
            unit: 'cm⁴'
        }));
    } else if (inertia.value || Number.isFinite(inertia.numeric)) {
        propertyChips.push(createChip({
            label: 'I',
            numeric: inertia.numeric ?? asNumeric(inertia.value),
            raw: inertia.value,
            unit: 'cm⁴'
        }));
    }
    
    // 断面二次モーメント Iy
    if (useTableValues && tableProperties.Iy !== null) {
        propertyChips.push(createChip({
            label: 'Iy',
            numeric: tableProperties.Iy,
            raw: tableProperties.Iy.toString(),
            unit: 'cm⁴'
        }));
    }
    
    // ねじり定数 J
    if (useTableValues && tableProperties.J !== null) {
        propertyChips.push(createChip({
            label: 'J',
            numeric: tableProperties.J,
            raw: tableProperties.J.toString(),
            unit: 'cm⁴'
        }));
    }

    if (areaProp.value || Number.isFinite(areaProp.numeric)) {
        propertyChips.push(createChip({
            label: 'A',
            numeric: areaProp.numeric ?? asNumeric(areaProp.value),
            raw: areaProp.value,
            unit: 'cm²'
        }));
    }

    const zxNumeric = sectionModulus.zxNumeric ?? asNumeric(sectionModulus.zx);
    const zyNumeric = sectionModulus.zyNumeric ?? asNumeric(sectionModulus.zy);
    const primaryZNumeric = sectionModulus.numeric ??
        (sectionAxis?.key === 'y' ? (zyNumeric ?? zxNumeric) : sectionAxis?.key === 'x' ? (zxNumeric ?? zyNumeric) : asNumeric(sectionModulus.value));
    const primaryZRaw = sectionModulus.value || (sectionAxis?.key === 'y' ? sectionModulus.zy : sectionModulus.zx);
    const zUnit = 'cm³';

    const primaryZLabel = sectionAxis?.key === 'y' ? 'Zy' : sectionAxis?.key === 'x' ? 'Zx' : 'Z';
    if (primaryZRaw || Number.isFinite(primaryZNumeric)) {
        propertyChips.push(createChip({
            label: primaryZLabel,
            numeric: primaryZNumeric ?? asNumeric(primaryZRaw),
            raw: primaryZRaw,
            unit: zUnit
        }));
    }

    const zTolerance = 1e-6;
    if (sectionAxis?.key === 'x' && zyNumeric !== null && Math.abs((primaryZNumeric ?? zyNumeric) - zyNumeric) > zTolerance) {
        propertyChips.push(createChip({ label: 'Zy', numeric: zyNumeric, raw: sectionModulus.zy, unit: zUnit }));
    } else if (sectionAxis?.key === 'y' && zxNumeric !== null && Math.abs((primaryZNumeric ?? zxNumeric) - zxNumeric) > zTolerance) {
        propertyChips.push(createChip({ label: 'Zx', numeric: zxNumeric, raw: sectionModulus.zx, unit: zUnit }));
    } else if (!sectionAxis && zxNumeric !== null && zyNumeric !== null && Math.abs(zxNumeric - zyNumeric) > zTolerance) {
        propertyChips.push(createChip({ label: 'Zx', numeric: zxNumeric, raw: sectionModulus.zx, unit: zUnit }));
        propertyChips.push(createChip({ label: 'Zy', numeric: zyNumeric, raw: sectionModulus.zy, unit: zUnit }));
    }

    if (radiusOfGyration.ix || Number.isFinite(radiusOfGyration.ixNumeric)) {
        propertyChips.push(createChip({
            label: 'ix',
            numeric: radiusOfGyration.ixNumeric ?? asNumeric(radiusOfGyration.ix),
            raw: radiusOfGyration.ix,
            unit: 'cm'
        }));
    }

    if (radiusOfGyration.iy || Number.isFinite(radiusOfGyration.iyNumeric)) {
        propertyChips.push(createChip({
            label: 'iy',
            numeric: radiusOfGyration.iyNumeric ?? asNumeric(radiusOfGyration.iy),
            raw: radiusOfGyration.iy,
            unit: 'cm'
        }));
    }

    if (densityProp.value || Number.isFinite(densityProp.numeric)) {
        propertyChips.push(createChip({
            label: 'ρ',
            numeric: densityProp.numeric ?? asNumeric(densityProp.value),
            raw: densityProp.value,
            unit: 'kg/m³',
            suffix: densityProp.label && densityProp.label !== densityProp.value ? densityProp.label : ''
        }));
    }

    const propertySectionHTML = propertyChips.length
        ? `<div class="tooltip-subsection"><div class="tooltip-subtitle">物性値</div><div class="tooltip-chip-list">${propertyChips.join('')}</div></div>`
        : '';

    const connectionChips = [];
    if (connections.start?.label || connections.start?.value) {
        connectionChips.push(`<div class="tooltip-chip tooltip-chip--connection"><span class="chip-label">始端</span><span class="chip-value">${connections.start.label || connections.start.value}</span></div>`);
    }
    if (connections.end?.label || connections.end?.value) {
        connectionChips.push(`<div class="tooltip-chip tooltip-chip--connection"><span class="chip-label">終端</span><span class="chip-value">${connections.end.label || connections.end.value}</span></div>`);
    }

    const connectionSectionHTML = connectionChips.length
        ? `<div class="tooltip-subsection"><div class="tooltip-subtitle">接合条件</div><div class="tooltip-chip-list compact">${connectionChips.join('')}</div></div>`
        : '';

    const loadChips = [];
    const uniformLoad = loads.uniform;
    if (uniformLoad && typeof uniformLoad === 'object') {
        const componentLabels = [
            { key: 'wx', label: 'Wx' },
            { key: 'wy', label: 'Wy' },
            { key: 'wz', label: 'Wz' }
        ];
        componentLabels.forEach(({ key, label }) => {
            const value = Number(uniformLoad[key]);
            if (Number.isFinite(value) && Math.abs(value) > 1e-9) {
                loadChips.push(createChip({ label, numeric: value, unit: 'kN/m', digits: 2 }));
            }
        });
        if (loadChips.length === 0) {
            loadChips.push(createChip({ label: 'W', raw: '0', unit: 'kN/m' }));
        }
    } else {
        const uniformLoadNumeric = asNumeric(uniformLoad);
        if (uniformLoadNumeric !== null) {
            loadChips.push(createChip({ label: 'W', numeric: uniformLoadNumeric, unit: 'kN/m', digits: 2 }));
        } else if (uniformLoad !== null && uniformLoad !== undefined && String(uniformLoad).trim() !== '') {
            loadChips.push(createChip({ label: 'W', raw: String(uniformLoad).trim(), unit: 'kN/m' }));
        }
    }
    if (selfWeightPerLength !== null && selfWeightPerLength !== undefined) {
        loadChips.push(createChip({ label: '自重', numeric: selfWeightPerLength, unit: 'kN/m', digits: 3 }));
    }

    const loadSectionHTML = loadChips.length
        ? `<div class="tooltip-subsection"><div class="tooltip-subtitle">荷重</div><div class="tooltip-chip-list compact">${loadChips.join('')}</div></div>`
        : '';

    // ==========================================================
    // 解析結果セクション
    // ==========================================================
    let analysisSectionHTML = '';

    // 解析結果がグローバル変数に存在するかチェック
    if (window.lastResults && window.lastSectionCheckResults && window.lastBucklingResults) {
        const memberIndex = memberData.number - 1;

        const summaryChips = [];
        const statItems = [];

        // --- 断面算定結果 ---
        const checkResult = window.lastSectionCheckResults[memberIndex];
        if (checkResult && checkResult.maxRatio !== 'N/A') {
            const isNg = checkResult.status === 'NG';

            // 最大合成応力度を計算
            let maxCombinedStress = null;
            const N = asNumeric(checkResult.N);
            const M = asNumeric(checkResult.M);
            const A_m2 = asNumeric(properties?.area?.numeric) * 1e-4; // cm2 -> m2
            const Z_m3 = asNumeric(properties?.sectionModulus?.numeric) * 1e-6; // cm3 -> m3

            if (N !== null && M !== null && A_m2 !== null && Z_m3 !== null && A_m2 > 0 && Z_m3 > 0) {
                const sigma_a = (Math.abs(N) * 1000) / (A_m2 * 1e6); // kN -> N, m2 -> mm2 => N/mm2
                const sigma_b = (Math.abs(M) * 1e6) / (Z_m3 * 1e9); // kNm -> Nmm, m3 -> mm3 => N/mm2
                maxCombinedStress = sigma_a + sigma_b;
                statItems.push(`<div class="tooltip-stat-item"><span class="stat-label">最大合成応力度</span><span class="stat-value">${maxCombinedStress.toFixed(1)} N/mm²</span></div>`);
            }

            summaryChips.push(createChip({
                label: '最大検定比',
                numeric: checkResult.maxRatio,
                digits: 3,
                emphasis: isNg, // NGの場合は強調表示
                wide: true,
                subValue: `判定: ${checkResult.status}`
            }));
        }

        // --- 座屈解析結果 ---
        const bucklingResult = window.lastBucklingResults[memberIndex];
        if (bucklingResult && typeof bucklingResult.safetyFactor === 'number' && isFinite(bucklingResult.safetyFactor)) {
            const isDangerous = bucklingResult.status === '座屈危険';
            const isWarning = bucklingResult.status === '要注意';
            summaryChips.push(createChip({
                label: '座屈安全率',
                numeric: bucklingResult.safetyFactor,
                digits: 2,
                emphasis: isDangerous || isWarning, // 危険・要注意の場合は強調表示
                wide: true,
                subValue: `判定: ${bucklingResult.status}`
            }));
        }

        // --- 最大断面力 ---
        const forceResult = window.lastResults.forces[memberIndex];
        if (forceResult) {
            const maxAxial = Math.max(Math.abs(forceResult.N_i), Math.abs(forceResult.N_j));
            const maxShear = Math.max(Math.abs(forceResult.Q_i), Math.abs(forceResult.Q_j));
            const maxMoment = Math.max(Math.abs(forceResult.M_i), Math.abs(forceResult.M_j));

            statItems.push(`<div class="tooltip-stat-item"><span class="stat-label">最大軸力</span><span class="stat-value">${maxAxial.toFixed(1)} kN</span></div>`);
            statItems.push(`<div class="tooltip-stat-item"><span class="stat-label">最大せん断力</span><span class="stat-value">${maxShear.toFixed(1)} kN</span></div>`);
            statItems.push(`<div class="tooltip-stat-item"><span class="stat-label">最大曲げM</span><span class="stat-value">${maxMoment.toFixed(1)} kN·m</span></div>`);
        }

        if (summaryChips.length > 0 || statItems.length > 0) {
            analysisSectionHTML = `
                <div class="tooltip-subsection">
                    <div class="tooltip-subtitle">📈 解析結果</div>
                    ${summaryChips.length > 0 ? `<div class="tooltip-chip-list">${summaryChips.join('')}</div>` : ''}
                    ${statItems.length > 0 ? `<div class="tooltip-stat-grid" style="margin-top: 8px;">${statItems.join('')}</div>` : ''}
                </div>`;
        }
    }
    // ==========================================================

    let sectionColumnHTML = '';
    const axisChip = axisLabel ? `<span class="section-axis-chip">${axisLabel}</span>` : '';
    const sectionSummaryText = sectionSummary || sectionInfo?.dimensionSummary;

    if (sectionInfo) {
        const dimensionItems = Array.isArray(sectionInfo.dimensions)
            ? sectionInfo.dimensions.filter(dim => dim && typeof dim.value === 'number' && isFinite(dim.value))
            : [];
        const limitedItems = dimensionItems.slice(0, 8);

        const dimensionsHTML = limitedItems.length > 0
            ? `<div class="section-dimension-grid">${limitedItems.map(dim => `<div class="section-dimension-item"><span class="dim-key">${dim.label || dim.key}</span><span class="dim-value">${dim.value} mm</span></div>`).join('')}</div>`
            : '';

        sectionColumnHTML = `
            <div class="section-preview-card">
                <div class="section-preview-header">
                    <span class="section-title">${sectionInfo.label || '断面情報'}</span>
                    ${axisChip}
                </div>
                ${sectionSummaryText ? `<div class="section-summary-text">${sectionSummaryText}</div>` : ''}
                ${sectionInfo.svgMarkup ? `<div class="tooltip-section-preview">${sectionInfo.svgMarkup}</div>` : ''}
                ${dimensionsHTML}
                ${sectionInfo.source ? `<div class="section-source">参照: ${sectionInfo.source}</div>` : ''}
            </div>
        `.trim();
    } else {
        sectionColumnHTML = `
            <div class="section-preview-card">
                <div class="section-preview-header">
                    <span class="section-title">断面情報</span>
                    ${axisChip}
                </div>
                <div class="section-placeholder">断面情報が設定されていません。</div>
                ${sectionSummaryText ? `<div class="section-summary-text">${sectionSummaryText}</div>` : ''}
            </div>
        `.trim();
    }

    // 3列レイアウト用に情報を分割
    const column1HTML = [
        summaryChipsHTML ? `<div class="tooltip-summary-chip-row">${summaryChipsHTML}</div>` : '',
        generalInfoSectionHTML,
        connectionSectionHTML
    ].filter(Boolean).join('');

    const column2HTML = [
        propertySectionHTML,
        loadSectionHTML,
        analysisSectionHTML
    ].filter(Boolean).join('');

    let content = `<div class="tooltip-header">部材 ${number}</div>`;
    content += `<div class="tooltip-body">`;
    content += `<div class="tooltip-info-pane">${column1HTML}</div>`;
    content += `<div class="tooltip-info-pane">${column2HTML}</div>`;
    content += `<div class="tooltip-figure-pane">${sectionColumnHTML}</div>`;
    content += `</div>`;
    
    tooltip.innerHTML = content;
    console.log('📝 ツールチップコンテンツ設定完了');
    
    // hiddenクラスを削除してツールチップを表示
    tooltip.classList.remove('hidden');
    tooltip.style.display = 'block';
    console.log('👁️ ツールチップ表示状態変更完了');
    
    // ツールチップの位置を調整
    const rect = tooltip.getBoundingClientRect();
    const offsetParent = tooltip.offsetParent;
    const padding = 10;
    let computedLeft;
    let computedTop;

    if (offsetParent) {
        const parentRect = offsetParent.getBoundingClientRect();
        const parentScrollLeft = offsetParent.scrollLeft || 0;
        const parentScrollTop = offsetParent.scrollTop || 0;
        const parentWidth = offsetParent.clientWidth || window.innerWidth;
        const parentHeight = offsetParent.clientHeight || window.innerHeight;

        const relativeX = mouseX - parentRect.left + parentScrollLeft;
        const relativeY = mouseY - parentRect.top + parentScrollTop;

        let left = relativeX + padding;
        let top = relativeY - padding;

        const maxLeft = parentScrollLeft + parentWidth - rect.width - padding;
        if (left > maxLeft) {
            left = Math.max(parentScrollLeft + padding, relativeX - rect.width - padding);
        }

        const maxTop = parentScrollTop + parentHeight - rect.height - padding;
        if (top > maxTop) {
            top = Math.max(parentScrollTop + padding, relativeY - rect.height - padding);
        }

        computedLeft = left;
        computedTop = top;
    } else {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = mouseX + padding;
        let top = mouseY - padding;

        if (left + rect.width > viewportWidth) {
            left = Math.max(padding, mouseX - rect.width - padding);
        }

        if (top + rect.height > viewportHeight) {
            top = Math.max(padding, mouseY - rect.height - padding);
        }

        computedLeft = left;
        computedTop = top;
    }

    tooltip.style.left = `${computedLeft}px`;
    tooltip.style.top = `${computedTop}px`;

    console.log('✅ ツールチップ表示完了:', {
        位置: `${computedLeft}px, ${computedTop}px`,
        サイズ: `${rect.width}px × ${rect.height}px`,
        visible: tooltip.style.display,
        hiddenClass: tooltip.classList.contains('hidden')
    });
}

function hideMemberTooltip() {
    const tooltip = document.querySelector('.member-tooltip');
    if (tooltip) {
        tooltip.classList.add('hidden');
        tooltip.style.display = 'none';
        console.log('🔧 ツールチップ非表示完了');
    }
}

// ★★★ 重要: elements をグローバルスコープで宣言（DOMContentLoaded内で初期化） ★★★
let elements = null;
let shareLinkApplied = false;

// 編集モード関連のグローバル変数（3Dビューからアクセスするため）
let canvasMode = 'select';
let firstMemberNode = null;
let selectedNodeIndex = null;
let selectedMemberIndex = null;

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements をグローバル変数に割り当て
    elements = {
        nodesTable: document.getElementById('nodes-table').getElementsByTagName('tbody')[0],
        membersTable: document.getElementById('members-table').getElementsByTagName('tbody')[0],
        nodeLoadsTable: document.getElementById('node-loads-table').getElementsByTagName('tbody')[0],
        memberLoadsTable: document.getElementById('member-loads-table').getElementsByTagName('tbody')[0],
        addNodeBtn: document.getElementById('add-node-btn'),
        addMemberBtn: document.getElementById('add-member-btn'),
        addNodeLoadBtn: document.getElementById('add-node-load-btn'),
        addMemberLoadBtn: document.getElementById('add-member-load-btn'),
        calculateBtn: document.getElementById('calculate-btn'),
        calculateAndAnimateBtn: document.getElementById('calculate-and-animate-btn'),
        presetSelector: document.getElementById('preset-selector'),
        displacementResults: document.getElementById('displacement-results'),
        reactionResults: document.getElementById('reaction-results'),
        forceResults: document.getElementById('force-results'),
        errorMessage: document.getElementById('error-message'),
        modelCanvas: document.getElementById('model-canvas'),
        displacementCanvas: document.getElementById('displacement-canvas'),
        momentCanvas: document.getElementById('moment-canvas'),
        axialCanvas: document.getElementById('axial-canvas'),
        shearCanvas: document.getElementById('shear-canvas'),
        momentCanvas2: document.getElementById('moment-canvas2'),
        shearCanvas2: document.getElementById('shear-canvas2'),
        secondaryMomentContainer: document.getElementById('secondary-moment-container'),
        secondaryShearContainer: document.getElementById('secondary-shear-container'),
        stressCanvas: document.getElementById('stress-canvas'),
        projectionMode: document.getElementById('projection-mode'),
        modeSelectBtn: document.getElementById('mode-select'),
        modeAddNodeBtn: document.getElementById('mode-add-node'),
        modeAddMemberBtn: document.getElementById('mode-add-member'),
        undoBtn: document.getElementById('undo-btn'),
        nodeContextMenu: document.getElementById('node-context-menu'),
        memberPropsPopup: document.getElementById('member-props-popup'),
        nodePropsPopup: document.getElementById('node-props-popup'),
    nodePropsTitle: document.getElementById('node-props-title'),
        nodeLoadPopup: document.getElementById('node-load-popup'),
        nodeCoordsPopup: document.getElementById('node-coords-popup'),
        addMemberPopup: document.getElementById('add-member-popup'),
        gridToggle: document.getElementById('grid-toggle'),
        memberInfoToggle: document.getElementById('member-info-toggle'),
        gridSpacing: document.getElementById('grid-spacing'),
        animScaleInput: document.getElementById('anim-scale-input'),
        saveBtn: document.getElementById('save-btn'),
        loadBtn: document.getElementById('load-btn'),
        exportExcelBtn: document.getElementById('export-excel-btn'),
        reportBtn: document.getElementById('report-btn'),
        ratioCanvas: document.getElementById('ratio-canvas'),
        sectionCheckResults: document.getElementById('section-check-results'),
        deflectionCheckResults: document.getElementById('deflection-check-results'),
        ltbCheckResults: document.getElementById('ltb-check-results'),
        loadTermRadios: document.querySelectorAll('input[name="load-term"]'),
        resetModelBtn: document.getElementById('reset-model-btn'),
        autoScaleBtn: document.getElementById('auto-scale-btn'),
        zoomInBtn: document.getElementById('zoom-in-btn'),
        zoomOutBtn: document.getElementById('zoom-out-btn'),
        considerSelfWeightCheckbox: document.getElementById('consider-self-weight-checkbox'),
        hiddenAxisCoord: document.getElementById('hidden-axis-coord'),
        hiddenAxisLabel: document.getElementById('hidden-axis-label'),
    };

    if (elements.nodePropsPopup && elements.nodePropsTitle) {
        setNodePropsTitle();
        enablePopupDrag(elements.nodePropsPopup, elements.nodePropsTitle);
    }

    const popupSupportSelect = document.getElementById('popup-support');
    if (popupSupportSelect) {
        const initializedValue = normalizeSupportValue(popupSupportSelect.value || 'free');
        popupSupportSelect.innerHTML = buildSupportOptionsMarkup(initializedValue);
        popupSupportSelect.value = initializedValue;
    }

    const popupAreaInput = document.getElementById('popup-a');
    if (popupAreaInput) {
        popupAreaInput.addEventListener('input', updatePopupSelfWeightDisplay);
    }

    // 部材表: 列トグル/自重密度の表示同期 + 接合バネ表示切替
    try {
        const colToggles = document.querySelectorAll('.column-toggles .col-toggle');
        colToggles.forEach(toggle => toggle.addEventListener('change', updateMemberTableVisibility));
        if (elements.considerSelfWeightCheckbox) {
            elements.considerSelfWeightCheckbox.addEventListener('change', updateMemberTableVisibility);
        }
        document.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (!target.matches('#members-table select.conn-select')) return;
            updateConnCellSpringVisibility(target);
        });
        updateMemberTableVisibility();
        refreshAllMemberSpringVisibility();
    } catch (e) {
        console.warn('member table visibility init failed', e);
    }

    const popupSectionNameInput = document.getElementById('popup-section-name');
    const popupSectionNameClearBtn = document.getElementById('popup-section-name-clear');

    function syncPopupSectionNameClearState() {
        if (!popupSectionNameClearBtn) return;
        const hasValue = !!(popupSectionNameInput?.value || '').trim();
        popupSectionNameClearBtn.disabled = !hasValue;
    }

    if (popupSectionNameInput) {
        popupSectionNameInput.addEventListener('input', syncPopupSectionNameClearState);
    }

    if (popupSectionNameInput && popupSectionNameClearBtn) {
        popupSectionNameClearBtn.addEventListener('click', () => {
            popupSectionNameInput.value = '';
            popupSectionNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            popupSectionNameInput.dispatchEvent(new Event('change', { bubbles: true }));
            popupSectionNameInput.focus();
        });
        syncPopupSectionNameClearState();
    }

    // --- 2D由来: モデル図の文字サイズスライダー ---
    try {
        const slider = document.getElementById('font-scale-model');
        const label = document.getElementById('font-scale-value-model');
        if (slider && label) {
            const initial = (globalThis.settings?.fontScales?.model ?? 1.0);
            slider.value = initial;
            label.textContent = Number(initial).toFixed(1) + 'x';

            slider.addEventListener('input', () => {
                const scale = parseFloat(slider.value);
                globalThis.settings.fontScales.model = scale;
                globalThis.settings.fontScale = scale; // 互換
                label.textContent = scale.toFixed(1) + 'x';
                if (typeof drawOnCanvas === 'function') drawOnCanvas();
            });
        }

        const fitBtn = document.getElementById('fit-view-model');
        if (fitBtn) {
            fitBtn.addEventListener('click', () => {
                const autoScaleBtn = document.getElementById('auto-scale-btn');
                if (autoScaleBtn) autoScaleBtn.click();
            });
        }
    } catch (e) {
        console.warn('font scale init failed:', e);
    }

    if (elements.projectionMode) {
        const initialProjection = elements.projectionMode.value;
        if (!initialProjection || initialProjection === 'xy') {
            elements.projectionMode.value = DEFAULT_PROJECTION_MODE;
        }
    }

    let panZoomState = { scale: 1, offsetX: 0, offsetY: 0, isInitialized: false };
    let lastResults = null;
    let lastAnalysisResult = null;
    let lastSectionCheckResults = null;
    let lastDeflectionCheckResults = null;
    let lastLtbCheckResults = null;
    let internalLastDisplacementScale = 0;

    const applyAnimationAutoScale = (scale, { updatePlaceholder = true } = {}) => {
        const numericScale = Number(scale);
        if (!Number.isFinite(numericScale) || numericScale <= 0) {
            internalLastDisplacementScale = 0;
            return internalLastDisplacementScale;
        }

        internalLastDisplacementScale = numericScale;

        if (updatePlaceholder && elements?.animScaleInput) {
            const target = elements.animScaleInput;
            const placeholderText = `自動(${numericScale.toFixed(2)})`;
            target.placeholder = placeholderText;
            target.dataset.autoScale = numericScale.toString();
        }

        return internalLastDisplacementScale;
    };

    window.updateAnimationAutoScale = (scale, options) => applyAnimationAutoScale(scale, options);

    const previousDisplacementScale = Number(window.lastDisplacementScale ?? 0);

    Object.defineProperty(window, 'lastDisplacementScale', {
        get: () => internalLastDisplacementScale,
        set: (value) => applyAnimationAutoScale(value),
        configurable: true
    });

    if (Number.isFinite(previousDisplacementScale) && previousDisplacementScale > 0) {
        applyAnimationAutoScale(previousDisplacementScale);
    }

    if (elements.addMemberPopup) {
                const highlightNode = (nodeIndex) => {
                    const node = nodes[nodeIndex];
                    const projectedNode = getProjectedNode(nodeIndex);
                    if (node && projectedNode) {
                        const drawPos = transformPoint(projectedNode);
                        if (drawPos) {
                            ctx.save();
                            ctx.strokeStyle = '#0066ff';
                            ctx.lineWidth = 4;
                            ctx.beginPath();
                            ctx.arc(drawPos.x, drawPos.y, 10, 0, 2 * Math.PI);
                            ctx.stroke();
                            ctx.restore();
                        }
                    }
                };
        elements.addMemberPopup.style.display = 'none';
                const highlightMember = (memberIndex) => {
                    const member = members[memberIndex];
                    if (member) {
                        const projected1 = getProjectedNode(member.i);
                        const projected2 = getProjectedNode(member.j);
                        if (projected1 && projected2 && isNodeVisible(member.i) && isNodeVisible(member.j)) {
                            const pos1 = transformPoint(projected1);
                            const pos2 = transformPoint(projected2);
                            if (pos1 && pos2) {
                                ctx.save();
                                ctx.strokeStyle = '#0066ff';
                                ctx.lineWidth = 5;
                                ctx.beginPath();
                                ctx.moveTo(pos1.x, pos1.y);
                                ctx.lineTo(pos2.x, pos2.y);
                                ctx.stroke();
                                ctx.restore();
                            }
                        }
                    }
                };
        elements.addMemberPopup.style.visibility = 'hidden';
                const hasValidNode = Number.isInteger(window.selectedNodeIndex) && window.selectedNodeIndex >= 0;
                const hasValidMember = Number.isInteger(window.selectedMemberIndex) && window.selectedMemberIndex >= 0;

                if (hasValidNode && isNodeVisible(window.selectedNodeIndex)) {
                    highlightNode(window.selectedNodeIndex);
                } else if (hasValidMember) {
                    highlightMember(window.selectedMemberIndex);
                }
    }
    
    // ツールチップ表示の状態管理
    let hoveredMember = null;
    let tooltipTimeout = null;
    
    // グローバル変数をwindowオブジェクトに登録（ハイライト関数からアクセスできるように）
    window.selectedNodeIndex = null;
    window.selectedMemberIndex = null;
    
    // 複数選択機能の状態
    let isMultiSelecting = false;
    let multiSelectStart = { x: 0, y: 0 };
    let multiSelectEnd = { x: 0, y: 0 };
    let selectedNodes = new Set();
    let selectedMembers = new Set();
    let isShiftPressed = false;
    let isRangeSelecting = false;
    let rangeSelectionAdditive = false;
    let selectionChoiceMenu = null;
    let isDragging = false;
    let isDraggingCanvas = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let historyStack = [];
    let newMemberDefaults = {
        E: '205000',
        F: '235',
        Iz: '1840',
        Iy: '613',
        J: '235',
        A: '2340',
        Zz: '1230',
        Zy: '410',
        i_conn: 'rigid',
        j_conn: 'rigid'
    };

    window.newMemberDefaults = newMemberDefaults;

    const addNodeToTable = (x, y, z, support = 'free', options = {}) => {
        const tableBody = elements?.nodesTable || document.getElementById('nodes-table')?.getElementsByTagName('tbody')[0];
        if (!tableBody) {
            console.error('nodes-table not found');
            return null;
        }

        // 既存の節点と同じ座標位置かチェック
        const tolerance = 0.001; // 座標の許容誤差（mm）
        const newX = Number.parseFloat(x) || 0;
        const newY = Number.parseFloat(y) || 0;
        const newZ = Number.parseFloat(z) || 0;

        const rows = tableBody.getElementsByTagName('tr');
        for (let i = 0; i < rows.length; i++) {
            const cells = rows[i].getElementsByTagName('td');
            if (cells.length >= 4) {
                const existingX = Number.parseFloat(cells[1].querySelector('input')?.value) || 0;
                const existingY = Number.parseFloat(cells[2].querySelector('input')?.value) || 0;
                const existingZ = Number.parseFloat(cells[3].querySelector('input')?.value) || 0;

                const dx = Math.abs(newX - existingX);
                const dy = Math.abs(newY - existingY);
                const dz = Math.abs(newZ - existingZ);

                if (dx < tolerance && dy < tolerance && dz < tolerance) {
                    alert(`既に同じ座標位置に節点${i + 1}が存在します。\n座標: (${existingX.toFixed(3)}, ${existingY.toFixed(3)}, ${existingZ.toFixed(3)})`);
                    return null;
                }
            }
        }

        const normalizedSupport = normalizeSupportValue(support);
        const saveHistory = Object.prototype.hasOwnProperty.call(options, 'saveHistory')
            ? options.saveHistory
            : true;

        const formatCoord = (value) => {
            const num = Number.parseFloat(value ?? 0);
            return Number.isFinite(num) ? num.toFixed(3) : '0.000';
        };

        const formatForced = (value, decimals = 3) => {
            if (value === '' || value === null || value === undefined) return '0';
            const num = Number.parseFloat(value);
            return Number.isFinite(num) ? num.toFixed(decimals) : '0';
        };

        const forcedDx = options.dx_forced ?? options.dx ?? 0;
        const forcedDy = options.dy_forced ?? options.dy ?? 0;
        const forcedDz = options.dz_forced ?? options.dz ?? 0;
        const nodeCells = [
            '#',
            `<input type="number" step="0.001" value="${formatCoord(x)}">`,
            `<input type="number" step="0.001" value="${formatCoord(y)}">`,
            `<input type="number" step="0.001" value="${formatCoord(z)}">`,
            buildSupportSelectMarkup(normalizedSupport),
            `<input type="number" value="${formatForced(forcedDx, 3)}" step="0.1" title="強制変位 δx (mm)">`,
            `<input type="number" value="${formatForced(forcedDy, 3)}" step="0.1" title="強制変位 δy (mm)">`,
            `<input type="number" value="${formatForced(forcedDz, 3)}" step="0.1" title="強制変位 δz (mm)">`
        ];

        return addRow(tableBody, nodeCells, saveHistory);
    };

    window.addNodeToTable = addNodeToTable;
    
    // window変数として登録（クロススコープアクセス用）
    window.selectedNodes = selectedNodes;
    window.selectedMembers = selectedMembers;
    
    // 複数選択用の関数
    const clearMultiSelection = () => {
        console.log('複数選択をクリア - 以前の状態:', {
            selectedNodes: Array.from(selectedNodes),
            selectedMembers: Array.from(selectedMembers),
            windowSelectedNodes: Array.from(window.selectedNodes || []),
            windowSelectedMembers: Array.from(window.selectedMembers || [])
        });
        selectedNodes.clear();
        selectedMembers.clear();
        console.log('複数選択クリア後 - window同期確認:', {
            windowSelectedNodesSize: window.selectedNodes ? window.selectedNodes.size : 'undefined',
            windowSelectedMembersSize: window.selectedMembers ? window.selectedMembers.size : 'undefined'
        });
        isMultiSelecting = false;
        isRangeSelecting = false;
        rangeSelectionAdditive = false;
        multiSelectStart = { x: 0, y: 0 };
        multiSelectEnd = { x: 0, y: 0 };
        hideSelectionChoiceMenu();
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
        console.log('複数選択クリア完了');
    };

    const hideSelectionChoiceMenu = () => {
        if (selectionChoiceMenu) {
            selectionChoiceMenu.remove();
            selectionChoiceMenu = null;
        }
    };

    const clearSingleSelection = () => {
        console.log('単一選択をクリア - 以前の状態:', {
            selectedNodeIndex,
            selectedMemberIndex
        });
        selectedNodeIndex = null;
        selectedMemberIndex = null;
        window.selectedNodeIndex = null;
        window.selectedMemberIndex = null;
        hideSelectionChoiceMenu();
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
        console.log('単一選択クリア完了');
    };
    window.clearSingleSelection = clearSingleSelection;

    const startCanvasPan = (mouseX, mouseY) => {
        isDraggingCanvas = true;
        lastMouseX = mouseX;
        lastMouseY = mouseY;
    };

    // 不安定構造の分析機能
    let unstableNodes = new Set();
    let unstableMembers = new Set();
    let instabilityMessage = '';

    const analyzeInstability = (K_global, reduced_indices, nodes, members, is2DFrame = false) => {
        const analysis = {
            message: '',
            unstableNodes: new Set(),
            unstableMembers: new Set()
        };

        try {
            // 1. 拘束不足の節点を検出
            const constraintAnalysis = analyzeConstraints(nodes, is2DFrame);
            if (constraintAnalysis.unconstrainedNodes.length > 0) {
                analysis.unstableNodes = new Set(constraintAnalysis.unconstrainedNodes);
                analysis.message += `拘束が不足している節点: ${constraintAnalysis.unconstrainedNodes.map(i => i+1).join(', ')}`;
            }

            // 2. 機構（メカニズム）を検出
            const mechanismAnalysis = analyzeMechanisms(nodes, members, is2DFrame);
            if (mechanismAnalysis.problematicMembers.length > 0) {
                mechanismAnalysis.problematicMembers.forEach(idx => analysis.unstableMembers.add(idx));
                if (analysis.message) analysis.message += '\n';
                analysis.message += `不安定な部材構成: ${mechanismAnalysis.problematicMembers.map(i => i+1).join(', ')}`;
            }

            // 3. 剛性マトリックスの特異性を分析
            const matrixAnalysis = analyzeStiffnessMatrix(K_global, reduced_indices);
            if (matrixAnalysis.zeroEnergyModes.length > 0) {
                if (analysis.message) analysis.message += '\n';
                analysis.message += `特異モード（零エネルギーモード）が検出されました`;
            }

            // グローバル変数に設定（描画用）
            unstableNodes = analysis.unstableNodes;
            unstableMembers = analysis.unstableMembers;
            instabilityMessage = analysis.message;

            return analysis;
        } catch (error) {
            console.error('不安定性解析中にエラー:', error);
            return {
                message: '不安定性の詳細分析中にエラーが発生しました',
                unstableNodes: new Set(),
                unstableMembers: new Set()
            };
        }
    };

    const ZERO_TOL_CONSTRAINT = 1e-6;

    const isEffectivelyZeroConstraint = (value) => {
        if (value === undefined || value === null) return false;
        const numeric = Number(value);
        return Number.isFinite(numeric) && Math.abs(numeric) < ZERO_TOL_CONSTRAINT;
    };

    const collectConstraintDofsForNode = (node, is2DFrame) => {
        const dofs = new Set();
        if (!node) return dofs;

        const support = normalizeSupportValue(node.support);

        if (is2DFrame) {
            if (support === 'fixed') {
                dofs.add('dx');
                dofs.add('dy');
                dofs.add('rz');
            } else if (support === 'pinned') {
                dofs.add('dx');
                dofs.add('dy');
            } else if (isRollerSupport(support)) {
                const axis = getRollerAxis(support);
                if (axis === 'x') dofs.add('dx');
                else if (axis === 'z') dofs.add('dy');
                else if (axis === 'y') dofs.add('out-of-plane-y');
                else dofs.add(`roller-${support}`);
            }

            if (isEffectivelyZeroConstraint(node.dx_forced)) dofs.add('dx');
            if (isEffectivelyZeroConstraint(node.dy_forced)) dofs.add('dy');
        } else {
            if (support === 'fixed') {
                ['dx', 'dy', 'dz', 'rx', 'ry', 'rz'].forEach(dof => dofs.add(dof));
            } else if (support === 'pinned') {
                ['dx', 'dy', 'dz'].forEach(dof => dofs.add(dof));
            } else if (isRollerSupport(support)) {
                const axis = getRollerAxis(support);
                if (axis === 'x') dofs.add('dx');
                else if (axis === 'y') dofs.add('dy');
                else if (axis === 'z') dofs.add('dz');
                else dofs.add(`roller-${support}`);
            }

            if (isEffectivelyZeroConstraint(node.dx_forced)) dofs.add('dx');
            if (isEffectivelyZeroConstraint(node.dy_forced)) dofs.add('dy');
            if (isEffectivelyZeroConstraint(node.dz_forced)) dofs.add('dz');
        }

        return dofs;
    };

    const analyzeConstraints = (nodes, is2DFrame) => {
        const unconstrainedNodes = [];
        
        // support値から拘束数を計算するヘルパー関数
        const getConstraintCount = (node) => collectConstraintDofsForNode(node, is2DFrame).size;
        
        nodes.forEach((node, index) => {
            let constraintCount = getConstraintCount(node);
            
            // collectConstraintDofsForNode で強制変位も考慮済みなので追加処理は不要
            
            // 2D解析では最低2自由度の拘束が必要（並進2方向）
            // 全く拘束されていない節点を検出
            if (constraintCount === 0) {
                unconstrainedNodes.push(index);
            }
        });

        return { unconstrainedNodes };
    };

    const analyzeMechanisms = (nodes, members, is2DFrame) => {
        const problematicMembers = [];
        
        // support値と強制変位から拘束数を計算するヘルパー関数
        const getConstraintCount = (node) => collectConstraintDofsForNode(node, is2DFrame).size;
        
        // 基本的なメカニズム検出
        // 1. 孤立した部材（どちらかの端が拘束されていない）
        members.forEach((member, index) => {
            const startNode = nodes[member.i];
            const endNode = nodes[member.j];
            
            if (!startNode || !endNode) return; // 節点が見つからない場合はスキップ
            
            const startConstraints = getConstraintCount(startNode);
            const endConstraints = getConstraintCount(endNode);
            
            // 両端とも十分な拘束がない場合（2D解析では最低1自由度の拘束が必要）
            if (startConstraints === 0 && endConstraints === 0) {
                problematicMembers.push(index);
            }
        });

        return { problematicMembers };
    };

    const analyzeStiffnessMatrix = (K_global, reduced_indices) => {
        const zeroEnergyModes = [];
        
        try {
            // 簡易的な特異性検出
            // 対角要素がゼロまたは極小の要素を検出
            reduced_indices.forEach((idx, i) => {
                if (Math.abs(K_global[idx][idx]) < 1e-10) {
                    zeroEnergyModes.push(idx);
                }
            });
        } catch (error) {
            console.error('剛性マトリックス解析エラー:', error);
        }

        return { zeroEnergyModes };
    };

    // 不安定要素をハイライト表示する関数
    const highlightInstabilityElements = (ctx, transform) => {
        if (!ctx || !transform) return;
        
        const { nodes, members } = parseInputs();
        if (!nodes.length) return;

        // 不安定な節点をハイライト
        if (unstableNodes.size > 0) {
            ctx.save();
            ctx.strokeStyle = '#FF6B35'; // オレンジ色
            ctx.fillStyle = 'rgba(255, 107, 53, 0.3)';
            ctx.lineWidth = 4;

            unstableNodes.forEach(nodeIndex => {
                if (nodeIndex < nodes.length) {
                    const node = nodes[nodeIndex];
                    const x = node.x * transform.scale + transform.offsetX;
                    const y = node.y * transform.scale + transform.offsetY;
                    
                    // 点滅効果のための大きめの円
                    ctx.beginPath();
                    ctx.arc(x, y, 12, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.stroke();
                    
                    // 警告マーク
                    ctx.fillStyle = '#FF6B35';
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('⚠', x, y + 5);
                }
            });
            ctx.restore();
        }

        // 不安定な部材をハイライト
        if (unstableMembers.size > 0) {
            ctx.save();
            ctx.strokeStyle = '#FF6B35'; // オレンジ色
            ctx.lineWidth = 6;
            ctx.setLineDash([10, 5]); // 破線

            unstableMembers.forEach(memberIndex => {
                if (memberIndex < members.length) {
                    const member = members[memberIndex];
                    const startNode = nodes[member.start];
                    const endNode = nodes[member.end];
                    
                    if (startNode && endNode) {
                        const x1 = startNode.x * transform.scale + transform.offsetX;
                        const y1 = startNode.y * transform.scale + transform.offsetY;
                        const x2 = endNode.x * transform.scale + transform.offsetX;
                        const y2 = endNode.y * transform.scale + transform.offsetY;
                        
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();
                    }
                }
            });
            ctx.restore();
        }

        // 不安定性メッセージがある場合は画面上部に表示
        if (instabilityMessage) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 107, 53, 0.9)';
            ctx.strokeStyle = '#FF6B35';
            ctx.lineWidth = 2;
            
            // メッセージボックス
            const boxWidth = Math.min(800, ctx.canvas.width - 40);
            const boxHeight = 60 + (instabilityMessage.split('\n').length - 1) * 20;
            const boxX = (ctx.canvas.width - boxWidth) / 2;
            const boxY = 20;
            
            ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
            ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
            
            // テキスト
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            
            const lines = instabilityMessage.split('\n');
            lines.forEach((line, index) => {
                ctx.fillText(line, ctx.canvas.width / 2, boxY + 25 + index * 20);
            });
            
            ctx.restore();
        }
    };

    // 不安定性分析結果をクリアする関数
    const clearInstabilityHighlight = () => {
        unstableNodes.clear();
        unstableMembers.clear();
        instabilityMessage = '';
    };

    // 入力値のリアルタイム検証機能
    const validateInputValue = (input, validationType) => {
        const value = input.value.trim();
        let isValid = true;
        let errorMessage = '';

        try {
            const { nodes, members } = parseInputs();
            
            switch (validationType) {
                case 'node-reference':
                    // 節点番号の参照チェック
                    if (value && !isNaN(value)) {
                        const nodeIndex = parseInt(value) - 1;
                        if (nodeIndex < 0 || nodeIndex >= nodes.length) {
                            isValid = false;
                            errorMessage = `節点 ${value} は存在しません`;
                        }
                    }
                    break;
                
                case 'member-reference':
                    // 部材番号の参照チェック
                    if (value && !isNaN(value)) {
                        const memberIndex = parseInt(value) - 1;
                        if (memberIndex < 0 || memberIndex >= members.length) {
                            isValid = false;
                            errorMessage = `部材 ${value} は存在しません`;
                        }
                    }
                    break;
                
                case 'member-nodes':
                    // 部材表の節点番号チェック
                    if (value && !isNaN(value)) {
                        const nodeIndex = parseInt(value) - 1;
                        if (nodeIndex < 0 || nodeIndex >= nodes.length) {
                            isValid = false;
                            errorMessage = `節点 ${value} は存在しません`;
                        }
                    }
                    break;
                
                case 'positive-number':
                    // 正の数値チェック
                    if (value && !isNaN(value)) {
                        if (parseFloat(value) <= 0) {
                            isValid = false;
                            errorMessage = '正の値を入力してください';
                        }
                    }
                    break;
                
                case 'non-negative-number':
                    // 非負数値チェック
                    if (value && !isNaN(value)) {
                        if (parseFloat(value) < 0) {
                            isValid = false;
                            errorMessage = '0以上の値を入力してください';
                        }
                    }
                    break;
            }
        } catch (error) {
            // parseInputs が失敗した場合は検証をスキップ
            console.debug('入力検証中にparseInputsエラー:', error);
        }

        // スタイルの適用
        if (isValid) {
            input.style.backgroundColor = '';
            input.style.borderColor = '';
            input.removeAttribute('title');
        } else {
            input.style.backgroundColor = '#ffebee';
            input.style.borderColor = '#f44336';
            input.setAttribute('title', errorMessage);
        }

        return isValid;
    };

    // 入力フィールドに検証機能を設定
    const setupInputValidation = (input, validationType) => {
        input.addEventListener('input', () => {
            validateInputValue(input, validationType);
        });
        input.addEventListener('blur', () => {
            validateInputValue(input, validationType);
        });
        
        // 初期検証
        setTimeout(() => validateInputValue(input, validationType), 100);
    };

    // テーブルの行に応じた入力検証を設定
    const setupTableInputValidation = (row, tableBody) => {
        if (tableBody === elements.membersTable) {
            // 部材表：始点・終点の節点番号検証
            const startNodeInput = row.cells[1]?.querySelector('input');
            const endNodeInput = row.cells[2]?.querySelector('input');
            if (startNodeInput) setupInputValidation(startNodeInput, 'member-nodes');
            if (endNodeInput) setupInputValidation(endNodeInput, 'member-nodes');
            
            // 断面性能は正の値
            const iInput = row.cells[5]?.querySelector('input');
            const aInput = row.cells[6]?.querySelector('input');
            if (iInput) setupInputValidation(iInput, 'positive-number');
            if (aInput) setupInputValidation(aInput, 'positive-number');
            
        } else if (tableBody === elements.nodeLoadsTable) {
            // 節点荷重表：節点番号検証
            const nodeInput = row.cells[0]?.querySelector('input');
            if (nodeInput) setupInputValidation(nodeInput, 'node-reference');
            
        } else if (tableBody === elements.memberLoadsTable) {
            // 部材荷重表：部材番号検証
            const memberInput = row.cells[0]?.querySelector('input');
            if (memberInput) setupInputValidation(memberInput, 'member-reference');
        }
    };

    // 既存のテーブル行に入力検証を適用
    const initializeExistingInputValidation = () => {
        // 部材表の検証
        Array.from(elements.membersTable.rows).forEach(row => {
            setupTableInputValidation(row, elements.membersTable);
        });
        
        // 節点荷重表の検証
        Array.from(elements.nodeLoadsTable.rows).forEach(row => {
            setupTableInputValidation(row, elements.nodeLoadsTable);
        });
        
        // 部材荷重表の検証
        Array.from(elements.memberLoadsTable.rows).forEach(row => {
            setupTableInputValidation(row, elements.memberLoadsTable);
        });
    };

    const showSelectionChoiceMenu = (pageX, pageY, onSelectNodes, onSelectMembers) => {
        console.log('showSelectionChoiceMenu が呼び出されました:', { pageX, pageY });
        hideSelectionChoiceMenu();

        // 表示位置を調整して画面内に収まるようにする（マウス位置の近くに表示）
        const maxX = window.innerWidth - 280; // メニューの幅を考慮
        const maxY = window.innerHeight - 150; // メニューの高さを考慮
        const adjustedX = Math.min(Math.max(50, pageX), maxX);
        const adjustedY = Math.min(Math.max(50, pageY + 20), maxY); // マウス位置から少し下に表示
        
        console.log('メニュー位置調整:', { 
            original: { pageX, pageY }, 
            adjusted: { adjustedX, adjustedY },
            windowSize: { width: window.innerWidth, height: window.innerHeight }
        });

        const menu = document.createElement('div');
        menu.style.cssText = `
            position: fixed;
            top: ${adjustedY}px;
            left: ${adjustedX}px;
            transform: translate(-50%, 0px);
            background: #ffffff;
            border: 3px solid #007bff;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            padding: 16px 20px;
            z-index: 9999999;
            font-family: Arial, sans-serif;
            max-width: 260px;
            color: #333;
            min-width: 200px;
        `;

        const message = document.createElement('div');
        message.textContent = '節点と部材が両方含まれています。どちらを選択状態にしますか？';
        message.style.cssText = `
            margin-bottom: 10px;
            font-size: 14px;
            line-height: 1.4;
        `;
        menu.appendChild(message);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        `;

        const createButton = (label, color, handler) => {
            const button = document.createElement('button');
            button.textContent = label;
            button.style.cssText = `
                padding: 8px 10px;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.2s ease;
                color: #ffffff;
                background-color: ${color};
            `;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                hideSelectionChoiceMenu();
                handler();
            });
            button.addEventListener('mouseenter', () => {
                button.style.filter = 'brightness(1.1)';
            });
            button.addEventListener('mouseleave', () => {
                button.style.filter = 'none';
            });
            return button;
        };

        buttonContainer.appendChild(createButton('節点のみ', '#007bff', onSelectNodes));
        buttonContainer.appendChild(createButton('部材のみ', '#28a745', onSelectMembers));

        menu.appendChild(buttonContainer);

        menu.addEventListener('click', (event) => event.stopPropagation());

        selectionChoiceMenu = menu;
        document.body.appendChild(menu);
        console.log('選択メニューをDOMに追加しました:', menu);

        setTimeout(() => {
            const outsideHandler = () => hideSelectionChoiceMenu();
            document.addEventListener('click', outsideHandler, { once: true });
        }, 0);
    };

    const getSelectionRectangle = () => {
        const left = Math.min(multiSelectStart.x, multiSelectEnd.x);
        const right = Math.max(multiSelectStart.x, multiSelectEnd.x);
        const top = Math.min(multiSelectStart.y, multiSelectEnd.y);
        const bottom = Math.max(multiSelectStart.y, multiSelectEnd.y);
        return {
            left,
            right,
            top,
            bottom,
            width: Math.abs(right - left),
            height: Math.abs(bottom - top)
        };
    };

    const isPointInsideRect = (point, rect) => (
        point.x >= rect.left && point.x <= rect.right &&
        point.y >= rect.top && point.y <= rect.bottom
    );

    const segmentsIntersect = (p1, p2, q1, q2) => {
        const EPS = 1e-6;
        const orientation = (a, b, c) => {
            const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
            if (Math.abs(val) < EPS) return 0;
            return val > 0 ? 1 : 2;
        };
        const onSegment = (a, b, c) => (
            Math.min(a.x, c.x) - EPS <= b.x && b.x <= Math.max(a.x, c.x) + EPS &&
            Math.min(a.y, c.y) - EPS <= b.y && b.y <= Math.max(a.y, c.y) + EPS
        );

        const o1 = orientation(p1, p2, q1);
        const o2 = orientation(p1, p2, q2);
        const o3 = orientation(q1, q2, p1);
        const o4 = orientation(q1, q2, p2);

        if (o1 !== o2 && o3 !== o4) return true;
        if (o1 === 0 && onSegment(p1, q1, p2)) return true;
        if (o2 === 0 && onSegment(p1, q2, p2)) return true;
        if (o3 === 0 && onSegment(q1, p1, q2)) return true;
        if (o4 === 0 && onSegment(q1, p2, q2)) return true;
        return false;
    };

    const segmentIntersectsRect = (p1, p2, rect) => {
        const { left, right, top, bottom } = rect;
        if (Math.max(p1.x, p2.x) < left || Math.min(p1.x, p2.x) > right ||
            Math.max(p1.y, p2.y) < top || Math.min(p1.y, p2.y) > bottom) {
            return false;
        }
        if (isPointInsideRect(p1, rect) || isPointInsideRect(p2, rect)) {
            return true;
        }
        const rectPoints = [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom }
        ];
        for (let i = 0; i < 4; i++) {
            const q1 = rectPoints[i];
            const q2 = rectPoints[(i + 1) % 4];
            if (segmentsIntersect(p1, p2, q1, q2)) {
                return true;
            }
        }
        return false;
    };

    const drawSelectionRectangle = (ctx) => {
        if (!isRangeSelecting || !isMultiSelecting) return;
        const rect = getSelectionRectangle();
        if (rect.width < 2 && rect.height < 2) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 123, 255, 0.9)';
        ctx.fillStyle = 'rgba(0, 123, 255, 0.15)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        ctx.setLineDash([]);
        ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        ctx.restore();
    };

    const finalizeRangeSelection = (event = null) => {
        console.log('finalizeRangeSelection開始');
        if (!lastDrawingContext) {
            console.log('lastDrawingContext が null のため終了');
            return;
        }
        const rect = getSelectionRectangle();
        console.log('選択範囲:', rect);
        if (rect.width < 3 && rect.height < 3) {
            console.log('選択範囲が小さすぎるため終了');
            return;
        }

        try {
            const { nodes, members } = parseInputs();
            console.log('parseInputs成功 - nodes:', nodes.length, 'members:', members.length);
            const nodesInRect = [];
            nodes.forEach((node, idx) => {
                const pos = lastDrawingContext.transform(node.x, node.y);
                if (isPointInsideRect(pos, rect)) {
                    nodesInRect.push(idx);
                    console.log('範囲内の節点:', idx, 'pos:', pos);
                }
            });

            const membersInRect = [];
            members.forEach((member, idx) => {
                const start = lastDrawingContext.transform(nodes[member.i].x, nodes[member.i].y);
                const end = lastDrawingContext.transform(nodes[member.j].x, nodes[member.j].y);
                if (segmentIntersectsRect(start, end, rect)) {
                    membersInRect.push(idx);
                    console.log('範囲内の部材:', idx, 'start:', start, 'end:', end);
                }
            });
            
            console.log('検出結果 - nodesInRect:', nodesInRect.length, 'membersInRect:', membersInRect.length);

            const additiveMode = rangeSelectionAdditive;
            const applySelection = (target) => {
                console.log('applySelection called with target:', target, 'additiveMode:', additiveMode);
                console.log('nodesInRect:', nodesInRect, 'membersInRect:', membersInRect);
                if (target === 'nodes') {
                    if (selectedMembers.size > 0) {
                        selectedMembers.clear();
                    }
                    if (!additiveMode) {
                        selectedNodes.clear();
                    }
                    nodesInRect.forEach(idx => {
                        if (additiveMode && selectedNodes.has(idx)) {
                            selectedNodes.delete(idx);
                        } else {
                            selectedNodes.add(idx);
                        }
                    });
                    console.log('nodes selected:', Array.from(selectedNodes));
                } else if (target === 'members') {
                    if (selectedNodes.size > 0) {
                        selectedNodes.clear();
                    }
                    if (!additiveMode) {
                        selectedMembers.clear();
                    }
                    membersInRect.forEach(idx => {
                        if (additiveMode && selectedMembers.has(idx)) {
                            selectedMembers.delete(idx);
                        } else {
                            selectedMembers.add(idx);
                        }
                    });
                    console.log('members selected:', Array.from(selectedMembers));
                }
                if (typeof drawOnCanvas === 'function') {
                    drawOnCanvas();
                }
            };

            if (!nodesInRect.length && !membersInRect.length) {
                console.log('範囲内に要素が見つからなかったため終了');
                return;
            }

            console.log('選択処理を開始 - nodesInRect:', nodesInRect, 'membersInRect:', membersInRect);
            console.log('現在の選択状態 - selectedNodes.size:', selectedNodes.size, 'selectedMembers.size:', selectedMembers.size);

            if (nodesInRect.length && membersInRect.length) {
                console.log('節点と部材の両方が検出されました');
                // 既存の選択状態に応じて優先的に選択するタイプを決定
                if (selectedNodes.size > 0 && selectedMembers.size === 0) {
                    console.log('既存の節点選択があるため節点を選択');
                    applySelection('nodes');
                } else if (selectedMembers.size > 0 && selectedNodes.size === 0) {
                    console.log('既存の部材選択があるため部材を選択');
                    applySelection('members');
                } else {
                    // 節点と部材の両方が含まれる場合は常に選択メニューを表示
                    console.log('節点と部材の両方が含まれるため選択メニューを表示');
                    // マウスの現在位置を取得（マウスアップ時の位置）
                    const pageX = event ? event.clientX : window.innerWidth / 2;
                    const pageY = event ? event.clientY : window.innerHeight / 2;
                    console.log('メニュー表示位置:', { pageX, pageY, eventType: event?.type });
                    showSelectionChoiceMenu(pageX, pageY, () => applySelection('nodes'), () => applySelection('members'));
                }
            } else if (nodesInRect.length) {
                applySelection('nodes');
            } else {
                applySelection('members');
            }
        } catch (error) {
            console.error('範囲選択の処理中にエラーが発生しました:', error);
        }
    };

    // 一括編集メニューを表示する関数
    const showBulkEditMenu = (pageX, pageY) => {
        console.log('showBulkEditMenu 関数が呼び出されました', { pageX, pageY, selectedMembers: Array.from(selectedMembers) });
        
        // 既存のすべてのメニューとポップアップを確実に隠す
        const existingMenu = document.getElementById('bulk-edit-menu');
        if (existingMenu) {
            console.log('既存のメニューを削除');
            existingMenu.remove();
        }
        
        // 他のコンテキストメニューとポップアップも隠す
        if (elements.nodeContextMenu) elements.nodeContextMenu.style.display = 'none';
        if (elements.memberPropsPopup) elements.memberPropsPopup.style.display = 'none';
        if (elements.nodeLoadPopup) elements.nodeLoadPopup.style.display = 'none';
        if (elements.nodeCoordsPopup) elements.nodeCoordsPopup.style.display = 'none';
        
        // ページ上のすべてのコンテキストメニューを隠す
        document.querySelectorAll('.context-menu').forEach(menu => {
            if (menu.id !== 'bulk-edit-menu') {
                menu.style.display = 'none';
            }
        });
        
        // 一括編集メニューを作成
        const menu = document.createElement('div');
        menu.id = 'bulk-edit-menu';
        // CSSクラスを使わずにすべてインラインスタイルで設定
        menu.style.cssText = `
            position: fixed !important;
            background-color: white !important;
            border: 2px solid #007bff !important;
            border-radius: 4px !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
            padding: 8px 0px !important;
            min-width: 200px !important;
            z-index: 999999 !important;
            font-size: 14px !important;
            font-family: Arial, sans-serif !important;
            display: block !important;
            visibility: visible !important;
            pointer-events: auto !important;
            opacity: 1 !important;
            transform: scale(1) !important;
            transition: none !important;
        `;
        
        console.log('メニュー要素を作成:', menu);
        
        const menuItem = document.createElement('div');
        menuItem.textContent = `選択した${selectedMembers.size}つの部材を一括編集...`;
        // CSSクラスを使わずにすべてインラインスタイルで設定
        menuItem.style.cssText = `
            padding: 10px 20px !important;
            cursor: pointer !important;
            font-size: 16px !important;
            font-weight: bold !important;
            color: #007bff !important;
            border-bottom: 1px solid #eee !important;
            transition: background-color 0.2s !important;
            display: block !important;
            width: 100% !important;
            box-sizing: border-box !important;
        `;
        
        console.log('メニューアイテムを作成:', menuItem);
        
        menuItem.addEventListener('click', () => {
            console.log('メニューアイテムがクリックされました');
            menu.remove();
            showBulkEditDialog();
        });
        
        menuItem.addEventListener('mouseover', () => {
            menuItem.style.backgroundColor = '#f0f0f0';
        });
        
        menuItem.addEventListener('mouseout', () => {
            menuItem.style.backgroundColor = 'white';
        });
        
        menu.appendChild(menuItem);
        
        // 確実にbodyの最後に追加
        console.log('body要素:', document.body);
        console.log('body要素の子要素数（追加前）:', document.body.children.length);
        document.body.appendChild(menu);
        console.log('body要素の子要素数（追加後）:', document.body.children.length);
        console.log('追加されたメニュー要素:', document.getElementById('bulk-edit-menu'));
        
        // メニューのサイズを取得してから位置を調整
        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // マウス位置をクライアント座標に変換
        let menuLeft = pageX - window.scrollX;
        let menuTop = pageY - window.scrollY;
        
        // 画面からはみ出さないように調整
        if (menuLeft + menuRect.width > windowWidth) {
            menuLeft = windowWidth - menuRect.width - 10;
        }
        if (menuTop + menuRect.height > windowHeight) {
            menuTop = windowHeight - menuRect.height - 10;
        }
        if (menuLeft < 0) menuLeft = 10;
        if (menuTop < 0) menuTop = 10;
        
        menu.style.left = `${menuLeft}px`;
        menu.style.top = `${menuTop}px`;
        
        // アニメーション効果を無効化（デバッグのため）
        /*
        menu.style.opacity = '0';
        menu.style.transform = 'scale(0.8)';
        menu.style.transition = 'all 0.2s ease-out';
        
        // アニメーションを開始
        setTimeout(() => {
            menu.style.opacity = '1';
            menu.style.transform = 'scale(1)';
        }, 10);
        */
        
        console.log('メニューをDOMに追加しました。調整後の位置:', { 
            left: menu.style.left, 
            top: menu.style.top,
            originalPageX: pageX,
            originalPageY: pageY,
            windowSize: { width: windowWidth, height: windowHeight },
            menuSize: { width: menuRect.width, height: menuRect.height }
        });
        
        // メニュー外クリックで閉じる
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 10);
    };

    // 一括編集ダイアログを表示する関数
    const showBulkEditDialog = () => {
        console.log('一括編集ダイアログを表示:', Array.from(selectedMembers));
        
        // 既存のダイアログがあれば削除
        const existingDialog = document.getElementById('bulk-edit-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // ダイアログを作成
        const dialog = document.createElement('div');
        dialog.id = 'bulk-edit-dialog';
        dialog.style.position = 'fixed';
        dialog.style.top = '50%';
        dialog.style.left = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
        dialog.style.backgroundColor = 'white';
        dialog.style.border = '2px solid #007bff';
        dialog.style.borderRadius = '8px';
        dialog.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
        dialog.style.padding = '20px';
        dialog.style.minWidth = '400px';
        dialog.style.maxWidth = '90vw';
        dialog.style.maxHeight = '90vh';
        dialog.style.overflowY = 'auto';
        dialog.style.zIndex = '3000';
        
        dialog.innerHTML = `
            <h3>部材一括編集 (${selectedMembers.size}つの部材)</h3>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-e"> 弾性係数 E (N/mm²)</label>
                <div id="bulk-e-container" style="margin-left: 20px; display: none;"></div>
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-f"> 基準強度 F (N/mm²)</label>
                <div id="bulk-f-container" style="margin-left: 20px; display: none;"></div>
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-i"> 断面二次モーメント I (cm⁴)</label>
                <input type="number" id="bulk-i" style="margin-left: 20px; display: none;" step="0.01">
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-a"> 断面積 A (cm²)</label>
                <input type="number" id="bulk-a" style="margin-left: 20px; display: none;" step="0.01">
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-z"> 断面係数 Z (cm³)</label>
                <input type="number" id="bulk-z" style="margin-left: 20px; display: none;" step="0.01">
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-section"> 断面選択</label>
                <div id="bulk-section-container" style="margin-left: 20px; display: none;">
                    <button id="bulk-section-btn" style="padding: 5px 10px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer;">断面選択ツール</button>
                    <div id="bulk-section-info" style="margin-top: 5px; font-size: 12px; color: #666;"></div>
                </div>
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-i-conn"> 始端接合</label>
                <select id="bulk-i-conn" style="margin-left: 20px; display: none;">
                    <option value="rigid">剛接合</option>
                    <option value="pinned">ピン接合</option>
                </select>
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-j-conn"> 終端接合</label>
                <select id="bulk-j-conn" style="margin-left: 20px; display: none;">
                    <option value="rigid">剛接合</option>
                    <option value="pinned">ピン接合</option>
                </select>
            </div>
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-load"> 等分布荷重</label>
                <div id="bulk-load-container" style="margin-left: 20px; display: none;">
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <label style="min-width: 150px;">部材座標系 x 方向 w<sub>x</sub>:</label>
                            <input type="number" id="bulk-load-wx" step="0.01" placeholder="kN/m" style="width: 120px;">
                            <span style="font-size: 12px;">kN/m</span>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <label style="min-width: 150px;">部材座標系 y 方向 w<sub>y</sub>:</label>
                            <input type="number" id="bulk-load-wy" step="0.01" placeholder="kN/m" style="width: 120px;">
                            <span style="font-size: 12px;">kN/m</span>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <label style="min-width: 150px;">部材座標系 z 方向 w<sub>z</sub>:</label>
                            <input type="number" id="bulk-load-wz" step="0.01" placeholder="kN/m" style="width: 120px;">
                            <span style="font-size: 12px;">kN/m</span>
                        </div>
                        <div style="font-size: 12px; color: #666;">※ 空欄の方向は変更しません。0 を入力すると該当方向をゼロに更新します。</div>
                    </div>
                </div>
            </div>
            <div style="margin-top: 20px; text-align: center;">
                <button id="bulk-apply-btn" style="margin-right: 10px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">適用</button>
                <button id="bulk-cancel-btn" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">キャンセル</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // チェックボックスの変更イベント
        dialog.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const targetId = checkbox.id.replace('bulk-edit-', 'bulk-');
                const targetElement = document.getElementById(targetId);
                const containerElement = document.getElementById(targetId + '-container');
                
                if (targetElement) {
                    targetElement.style.display = checkbox.checked ? 'inline-block' : 'none';
                } else if (containerElement) {
                    containerElement.style.display = checkbox.checked ? 'block' : 'none';
                    if (checkbox.checked && targetId === 'bulk-e') {
                        // E値選択UIを生成
                        containerElement.innerHTML = createEInputHTML('bulk-e', '205000');
                    } else if (checkbox.checked && targetId === 'bulk-f') {
                        // F値選択UIを生成
                        containerElement.appendChild(createStrengthInputHTML('steel', 'bulk-f'));
                    }
                }
            });
        });
        
        // 断面選択ボタンのイベントリスナー
        const sectionBtn = document.getElementById('bulk-section-btn');
        if (sectionBtn) {
            sectionBtn.addEventListener('click', () => {
                // 一括編集用の断面選択ツールを開く
                openBulkSectionSelector();
            });
        }
        
        // 断面選択ツール用のグローバル変数（一括編集用）
        window.bulkSectionProperties = null;
        
        // 一括編集用断面選択ツールを開く関数
        const openBulkSectionSelector = () => {
            const url = `steel_selector.html?targetMember=bulk&bulk=true`;
            const popup = window.open(url, 'BulkSteelSelector', 'width=1200,height=800,scrollbars=yes,resizable=yes');
            
            if (!popup) {
                alert('ポップアップブロッカーにより断面選択ツールを開けませんでした。ポップアップを許可してください。');
                return;
            }
            
            // ポップアップから戻った時の処理
            const checkPopup = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkPopup);
                    // localStorageから断面性能データを取得
                    const storedData = localStorage.getItem('steelSelectionForFrameAnalyzer');
                    if (storedData) {
                        try {
                            const data = JSON.parse(storedData);
                            if (data.targetMemberIndex === 'bulk' && data.properties) {
                                window.bulkSectionProperties = data.properties;
                                updateBulkSectionInfo(data.properties);
                                localStorage.removeItem('steelSelectionForFrameAnalyzer');
                            }
                        } catch (e) {
                            console.error('断面選択データの解析エラー:', e);
                        }
                    }
                }
            }, 500);
        };
        
        // 一括編集の断面情報表示を更新
        const updateBulkSectionInfo = (properties) => {
            const infoElement = document.getElementById('bulk-section-info');
            if (!infoElement || !properties) return;

            const formatValue = (value, unit) => {
                if (value === undefined || value === null || value === '') return '-';
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return value;
                return `${numeric.toLocaleString()}${unit}`;
            };

            const axisInfo = normalizeAxisInfo(properties.sectionAxis || properties.sectionInfo?.axis);
            const ixValue = properties.Ix ?? properties.Iz ?? (axisInfo?.key === 'y' ? undefined : properties.I);
            const iyValue = properties.Iy ?? (axisInfo?.key === 'y' ? properties.I : undefined);
            const zxValue = properties.Zx ?? properties.Zz ?? (axisInfo?.key === 'y' ? undefined : properties.Z);
            const zyValue = properties.Zy ?? (axisInfo?.key === 'y' ? properties.Z : undefined);

            const parts = [
                `Ix=${formatValue(ixValue, 'cm⁴')}`,
                `Iy=${formatValue(iyValue, 'cm⁴')}`,
                `Zx=${formatValue(zxValue, 'cm³')}`,
                `Zy=${formatValue(zyValue, 'cm³')}`,
                `A=${formatValue(properties.A, 'cm²')}`
            ];

            infoElement.textContent = `選択済み: ${parts.join(' / ')}`;
            infoElement.style.color = '#28a745';
        };
        
        // 適用ボタンのイベント
        document.getElementById('bulk-apply-btn').addEventListener('click', () => {
            applyBulkEdit();
            dialog.remove();
        });
        
        // キャンセルボタンのイベント
        document.getElementById('bulk-cancel-btn').addEventListener('click', () => {
            dialog.remove();
        });
    };

    // 一括編集を適用する関数
    const applyBulkEdit = () => {
        console.log('一括編集を適用開始');
        
        const updates = {};
        
        // チェックされた項目を収集
        if (document.getElementById('bulk-edit-e').checked) {
            const eSelect = document.getElementById('bulk-e-select');
            const eInput = document.getElementById('bulk-e-input');
            updates.E = eSelect && eInput ? (eSelect.value === 'custom' ? eInput.value : eSelect.value) : null;
        }
        
        if (document.getElementById('bulk-edit-i').checked) {
            updates.I = document.getElementById('bulk-i').value;
        }
        
        if (document.getElementById('bulk-edit-a').checked) {
            updates.A = document.getElementById('bulk-a').value;
        }
        
        if (document.getElementById('bulk-edit-z').checked) {
            updates.Z = document.getElementById('bulk-z').value;
        }
        
        if (document.getElementById('bulk-edit-i-conn').checked) {
            updates.i_conn = document.getElementById('bulk-i-conn').value;
        }
        
        if (document.getElementById('bulk-edit-j-conn').checked) {
            updates.j_conn = document.getElementById('bulk-j-conn').value;
        }
        
        // 断面選択の処理
        if (document.getElementById('bulk-edit-section').checked && window.bulkSectionProperties) {
            updates.sectionProperties = window.bulkSectionProperties;
        }
        
        // 等分布荷重の処理
        if (document.getElementById('bulk-edit-load').checked) {
            const loadInputs = [
                { key: 'wx', elementId: 'bulk-load-wx' },
                { key: 'wy', elementId: 'bulk-load-wy', alias: 'w' },
                { key: 'wz', elementId: 'bulk-load-wz' }
            ];
            const memberLoad = {};
            let hasInput = false;

            loadInputs.forEach(({ key, elementId, alias }) => {
                const input = document.getElementById(elementId);
                if (!input) return;
                const rawValue = input.value;
                if (rawValue === '') return;
                const parsed = parseFloat(rawValue);
                if (Number.isFinite(parsed)) {
                    memberLoad[key] = parsed;
                    if (alias) {
                        memberLoad[alias] = parsed;
                    }
                    hasInput = true;
                }
            });

            if (hasInput) {
                updates.memberLoad = memberLoad;
            }
        }
        
        console.log('一括編集内容:', updates);
        
        // 選択された部材に変更を適用
        pushState(); // 変更前の状態を保存
        
        for (const memberIndex of selectedMembers) {
            const row = elements.membersTable.rows[memberIndex];
            if (!row) continue;
            
            const mergedProps = {};

            if (updates.sectionProperties) {
                Object.assign(mergedProps, updates.sectionProperties);
            }

            if (updates.E) {
                mergedProps.E = updates.E;
            }
            if (updates.I) {
                mergedProps.I = updates.I;
            }
            if (updates.A) {
                mergedProps.A = updates.A;
            }
            if (updates.Z) {
                mergedProps.Z = updates.Z;
            }
            if (updates.Iz && mergedProps.Ix === undefined) {
                mergedProps.Ix = updates.Iz;
            }
            if (updates.Iy && mergedProps.Iy === undefined) {
                mergedProps.Iy = updates.Iy;
            }
            if (updates.J && mergedProps.J === undefined) {
                mergedProps.J = updates.J;
            }
            if (updates.Zz && mergedProps.Zx === undefined) {
                mergedProps.Zx = updates.Zz;
            }
            if (updates.Zy && mergedProps.Zy === undefined) {
                mergedProps.Zy = updates.Zy;
            }

            if (Object.keys(mergedProps).length > 0) {
                updateMemberProperties(memberIndex, mergedProps);
            }
            
            // 接合条件の更新
            const connectionTargets = resolveMemberConnectionTargets(row);

            if (updates.i_conn) {
                if (connectionTargets.i.select) {
                    connectionTargets.i.select.value = updates.i_conn;
                } else {
                    console.warn('始端接合selectが見つかりません (bulk edit)', {
                        memberIndex,
                        value: updates.i_conn
                    });
                }
            }
            if (updates.j_conn) {
                if (connectionTargets.j.select) {
                    connectionTargets.j.select.value = updates.j_conn;
                } else {
                    console.warn('終端接合selectが見つかりません (bulk edit)', {
                        memberIndex,
                        value: updates.j_conn
                    });
                }
            }
            
            // 等分布荷重の処理
            if (updates.memberLoad) {
                // 既存の部材荷重を検索
                const existingLoadRow = Array.from(elements.memberLoadsTable.rows).find(loadRow => {
                    const memberInput = loadRow.cells[0].querySelector('input');
                    return parseInt(memberInput.value) - 1 === memberIndex;
                });

                const hasProp = (prop) => Object.prototype.hasOwnProperty.call(updates.memberLoad, prop);
                const getSafeValue = (prop, fallback = 0) => {
                    if (!hasProp(prop)) return fallback;
                    const value = updates.memberLoad[prop];
                    return Number.isFinite(value) ? value : 0;
                };

                if (existingLoadRow) {
                    if (hasProp('wx')) {
                        existingLoadRow.cells[1].querySelector('input').value = getSafeValue('wx');
                    }
                    if (hasProp('wy') || hasProp('w')) {
                        const value = hasProp('wy') ? getSafeValue('wy') : getSafeValue('w');
                        existingLoadRow.cells[2].querySelector('input').value = value;
                    }
                    if (hasProp('wz')) {
                        existingLoadRow.cells[3].querySelector('input').value = getSafeValue('wz');
                    }
                } else {
                    const wx = getSafeValue('wx');
                    const wy = hasProp('wy') ? getSafeValue('wy') : getSafeValue('w');
                    const wz = getSafeValue('wz');

                    if (wx !== 0 || wy !== 0 || wz !== 0) {
                        const newLoadRow = elements.memberLoadsTable.insertRow();
                        newLoadRow.innerHTML = `
                            <td><input type="number" value="${memberIndex + 1}" min="1"></td>
                            <td><input type="number" value="${wx}" step="0.01"></td>
                            <td><input type="number" value="${wy}" step="0.01"></td>
                            <td><input type="number" value="${wz}" step="0.01"></td>
                            <td><button class="delete-row-btn">×</button></td>
                        `;

                        // 削除ボタンのイベントリスナーを追加
                        const deleteBtn = newLoadRow.querySelector('.delete-row-btn');
                        deleteBtn.onclick = () => {
                            pushState();
                            newLoadRow.remove();
                            if (typeof drawOnCanvas === 'function') {
                                drawOnCanvas();
                            }
                        };

                        // 入力変更時の再描画
                        newLoadRow.querySelectorAll('input').forEach(input => {
                            input.addEventListener('change', () => {
                                if (typeof drawOnCanvas === 'function') {
                                    drawOnCanvas();
                                }
                            });
                        });
                    }
                }
            }
        }
        
        // 表示を更新
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
        
        console.log(`${selectedMembers.size}つの部材に一括編集を適用しました`);
        
        // 成功メッセージを表示
        const message = document.createElement('div');
        message.style.position = 'fixed';
        message.style.top = '20px';
        message.style.right = '20px';
        message.style.background = '#28a745';
        message.style.color = 'white';
        message.style.padding = '10px 15px';
        message.style.borderRadius = '4px';
        message.style.zIndex = '4000';
        message.textContent = `${selectedMembers.size}つの部材を一括編集しました`;
        document.body.appendChild(message);
        
        setTimeout(() => message.remove(), 3000);
    };

    // 節点一括編集メニュー表示関数
    const showBulkNodeEditMenu = (pageX, pageY) => {
        // 既存のすべてのメニューとポップアップを確実に隠す
        const existingMenu = document.getElementById('bulk-node-edit-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        // 他のコンテキストメニューとポップアップも隠す
        if (elements.nodeContextMenu) elements.nodeContextMenu.style.display = 'none';
        if (elements.memberPropsPopup) elements.memberPropsPopup.style.display = 'none';
        if (elements.nodeLoadPopup) elements.nodeLoadPopup.style.display = 'none';
        if (elements.nodeCoordsPopup) elements.nodeCoordsPopup.style.display = 'none';
        
        // 節点一括編集メニューを作成
        const menu = document.createElement('div');
        menu.id = 'bulk-node-edit-menu';
        menu.style.cssText = `
            position: fixed !important;
            background-color: white !important;
            border: 1px solid #ccc !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2) !important;
            padding: 4px 0px !important;
            z-index: 9999999 !important;
            min-width: 180px !important;
            font-family: Arial, sans-serif !important;
            font-size: 14px !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        `;
        
        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 10px 16px;
            cursor: pointer;
            background-color: white !important;
            color: #333 !important;
            font-size: 14px !important;
        `;
        menuItem.textContent = '選択した節点を一括編集';
        
        menuItem.addEventListener('mouseover', () => {
            menuItem.style.backgroundColor = '#f0f8ff';
        });
        
        menuItem.addEventListener('mouseout', () => {
            menuItem.style.backgroundColor = 'white';
        });
        
        menuItem.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // メニューを削除
            if (document.getElementById('bulk-node-edit-menu')) {
                document.getElementById('bulk-node-edit-menu').remove();
            }
            
            // ダイアログを表示
            window.showBulkNodeEditDialog();
        });
        menu.appendChild(menuItem);
        document.body.appendChild(menu);
        
        // メニューのサイズを取得してから位置を調整（部材一括編集と同じ方式）
        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // マウス位置をクライアント座標に変換
        let menuLeft = pageX - window.scrollX;
        let menuTop = pageY - window.scrollY;
        
        // 画面からはみ出さないように調整
        if (menuLeft + menuRect.width > windowWidth) {
            menuLeft = windowWidth - menuRect.width - 10;
        }
        if (menuTop + menuRect.height > windowHeight) {
            menuTop = windowHeight - menuRect.height - 10;
        }
        if (menuLeft < 0) menuLeft = 10;
        if (menuTop < 0) menuTop = 10;
        
        menu.style.left = `${menuLeft}px`;
        menu.style.top = `${menuTop}px`;
        
        console.log('メニュー位置設定:', {
            mouse: { x: pageX, y: pageY },
            client: { x: pageX - window.scrollX, y: pageY - window.scrollY },
            menuRect: { width: menuRect.width, height: menuRect.height },
            final: { x: menuLeft, y: menuTop }
        });
        
        // メニュー外クリックで閉じる
        const closeMenu = (event) => {
            if (!menu.contains(event.target)) {
                if (document.body.contains(menu)) {
                    document.body.removeChild(menu);
                }
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 200);
    };

    // 節点一括編集ダイアログ表示関数
    const showBulkNodeEditDialog = () => {
        // 既存のダイアログがあれば削除
        const existingDialog = document.getElementById('bulk-node-edit-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        const dialog = document.createElement('div');
        dialog.id = 'bulk-node-edit-dialog';
        dialog.style.cssText = `
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 2px solid #333;
            border-radius: 8px;
            padding: 20px;
            z-index: 10001;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            min-width: 400px;
            max-height: 80vh;
            overflow-y: auto;
            font-family: Arial, sans-serif;
        `;
        
        const bulkSupportOptionsHtml = buildSupportOptionsMarkup('free');

        dialog.innerHTML = `
            <h3>節点一括編集 (${selectedNodes.size}個の節点)</h3>
            
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-coords"> 座標</label>
                <div id="bulk-coords-container" style="margin-left: 20px; display: none;">
                    <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
                        <label style="min-width: 50px;">X座標:</label>
                        <select id="bulk-coord-x-mode" style="width: 80px;">
                            <option value="set">設定</option>
                            <option value="add">加算</option>
                        </select>
                        <input type="number" id="bulk-coord-x" step="0.01" placeholder="m" style="width: 100px;">
                        <span style="font-size: 12px;">m</span>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <label style="min-width: 50px;">Y座標:</label>
                        <select id="bulk-coord-y-mode" style="width: 80px;">
                            <option value="set">設定</option>
                            <option value="add">加算</option>
                        </select>
                        <input type="number" id="bulk-coord-y" step="0.01" placeholder="m" style="width: 100px;">
                        <span style="font-size: 12px;">m</span>
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label><input type="checkbox" id="bulk-edit-support"> 境界条件</label>
                <div id="bulk-support-container" style="margin-left: 20px; display: none;">
                    <select id="bulk-support-type" style="width: 150px;">
                        ${bulkSupportOptionsHtml}
                    </select>
                </div>
            </div>
            
            <div class="dialog-buttons" style="margin-top: 20px; text-align: right;">
                <button onclick="window.applyBulkNodeEdit()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin-right: 10px; cursor: pointer;">適用</button>
                <button onclick="document.body.removeChild(document.getElementById('bulk-node-edit-dialog'))" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">キャンセル</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        console.log('節点一括編集ダイアログが作成されました');
        
        // チェックボックスのイベントリスナーを追加
        document.getElementById('bulk-edit-coords').addEventListener('change', function() {
            document.getElementById('bulk-coords-container').style.display = this.checked ? 'block' : 'none';
        });
        
        document.getElementById('bulk-edit-support').addEventListener('change', function() {
            document.getElementById('bulk-support-container').style.display = this.checked ? 'block' : 'none';
        });
    };

    // ウィンドウオブジェクトに関数をアタッチ
    window.showBulkNodeEditDialog = showBulkNodeEditDialog;

    // 節点一括編集適用関数
    const applyBulkNodeEdit = () => {
        const updates = {};
        
        // 座標の処理
        if (document.getElementById('bulk-edit-coords').checked) {
            const xMode = document.getElementById('bulk-coord-x-mode').value;
            const yMode = document.getElementById('bulk-coord-y-mode').value;
            const x = document.getElementById('bulk-coord-x').value;
            const y = document.getElementById('bulk-coord-y').value;
            
            if (x) {
                updates.coordX = { mode: xMode, value: parseFloat(x) };
            }
            if (y) {
                updates.coordY = { mode: yMode, value: parseFloat(y) };
            }
        }
        
        // 境界条件の処理
        if (document.getElementById('bulk-edit-support').checked) {
            updates.support = normalizeSupportValue(document.getElementById('bulk-support-type').value);
        }
        
        console.log('節点一括編集内容:', updates);
        
        // 選択された節点に変更を適用
        pushState(); // 変更前の状態を保存
        
        const editedCount = selectedNodes.size;
        for (const nodeIndex of selectedNodes) {
            const row = elements.nodesTable.rows[nodeIndex];
            if (!row) continue;
            // 座標の更新
            if (updates.coordX) {
                const currentX = parseFloat(row.cells[1].querySelector('input').value);
                const newX = updates.coordX.mode === 'set' ? 
                    updates.coordX.value : 
                    currentX + updates.coordX.value;
                row.cells[1].querySelector('input').value = newX.toFixed(2);
            }
            if (updates.coordY) {
                const currentY = parseFloat(row.cells[2].querySelector('input').value);
                const newY = updates.coordY.mode === 'set' ? 
                    updates.coordY.value : 
                    currentY + updates.coordY.value;
                row.cells[2].querySelector('input').value = newY.toFixed(2);
            }
            // 境界条件の更新
            if (updates.support) {
                const supportSelect = row.querySelector('select');
                if (supportSelect) {
                    supportSelect.value = updates.support;
                }
            }
        }
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
        document.body.removeChild(document.getElementById('bulk-node-edit-dialog'));
        clearMultiSelection(); // 編集後に選択をクリア
        // 成功メッセージを表示
        const message = document.createElement('div');
        message.style.position = 'fixed';
        message.style.top = '20px';
        message.style.right = '20px';
        message.style.background = '#28a745';
        message.style.color = 'white';
        message.style.padding = '10px 15px';
        message.style.borderRadius = '4px';
        message.style.zIndex = '4000';
        message.textContent = `${editedCount}つの節点を一括編集しました`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 3000);
    };

    // ウィンドウオブジェクトに関数をアタッチ
    window.applyBulkNodeEdit = applyBulkNodeEdit;
    
    // --- Matrix Math Library ---
    const mat = {
        create: (rows, cols, value = 0) => Array(rows).fill().map(() => Array(cols).fill(value)),
        clone: (A) => A.map(row => row.slice()),
        identity: (n) => {
            const I = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => (row === col ? 1 : 0)));
            return I;
        },
        multiply: (A, B) => {
            const C = mat.create(A.length, B[0].length);
            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < B[0].length; j++) {
                    for (let k = 0; k < A[0].length; k++) {
                        C[i][j] += A[i][k] * B[k][j];
                    }
                }
            }
            return C;
        },
        transpose: A => A[0].map((_, colIndex) => A.map(row => row[colIndex])),
        add: (A, B) => A.map((row, i) => row.map((val, j) => val + B[i][j])),
        subtract: (A, B) => A.map((row, i) => row.map((val, j) => val - B[i][j])),
        solve: (A, b) => {
            const n = A.length;
            const aug = A.map((row, i) => [...row, b[i][0]]);
            for (let i = 0; i < n; i++) {
                let maxRow = i;
                for (let k = i + 1; k < n; k++) {
                    if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
                }
                [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
                if (aug[i][i] === 0) continue;
                for (let k = i + 1; k < n; k++) {
                    const factor = aug[k][i] / aug[i][i];
                    for (let j = i; j < n + 1; j++) aug[k][j] -= factor * aug[i][j];
                }
            }
            const x = mat.create(n, 1);
            for (let i = n - 1; i >= 0; i--) {
                let sum = 0;
                for (let j = i + 1; j < n; j++) sum += aug[i][j] * x[j][0];
                if (aug[i][i] === 0 && aug[i][n] - sum !== 0) return null;
                x[i][0] = aug[i][i] === 0 ? 0 : (aug[i][n] - sum) / aug[i][i];
            }
            return x;
        },
        inverse: (A) => {
            if (!Array.isArray(A) || A.length === 0 || A.length !== A[0].length) return null;
            const n = A.length;
            const identity = mat.identity(n);
            const inv = mat.create(n, n);
            for (let col = 0; col < n; col++) {
                const e = identity.map(row => [row[col]]);
                const solution = mat.solve(mat.clone(A), e);
                if (!solution) return null;
                for (let row = 0; row < n; row++) {
                    inv[row][col] = solution[row][0];
                }
            }
            return inv;
        }
    };
    if (!globalThis.matrixOps) {
        globalThis.matrixOps = mat;
    }
    
    // --- State and History Management ---
    const getCurrentState = () => {
        const state = { nodes: [], members: [], nodeLoads: [], memberLoads: [] };
        Array.from(elements.nodesTable.rows).forEach(row => {
            const supportSelectValue = row.cells[4]?.querySelector('select')?.value || 'free';
            state.nodes.push({
                x: row.cells[1]?.querySelector('input')?.value || 0,
                y: row.cells[2]?.querySelector('input')?.value || 0,
                z: row.cells[3]?.querySelector('input')?.value || 0,
                support: normalizeSupportValue(supportSelectValue),
                dx_forced: row.cells[5]?.querySelector('input')?.value || 0,
                dy_forced: row.cells[6]?.querySelector('input')?.value || 0,
                dz_forced: row.cells[7]?.querySelector('input')?.value || 0
            });
        });
        Array.from(elements.membersTable.rows).forEach(row => {
            const eCell = row.cells[3];
            const e_select = eCell ? eCell.querySelector('select') : null;
            const e_input = eCell ? eCell.querySelector('input[type="number"]') : null;
            const strengthCell = row.cells[4];
            const strengthInputContainer = strengthCell ? strengthCell.firstElementChild : null;
            const strengthType = strengthInputContainer?.dataset?.strengthType || '';
            let strengthValue = '';
            if (strengthInputContainer) {
                if (strengthType === 'F-value' || strengthType === 'Fc' || strengthType === 'F-stainless' || strengthType === 'F-aluminum') {
                    const valueInput = strengthInputContainer.querySelector('input');
                    strengthValue = valueInput ? valueInput.value : '';
                } else if (strengthType === 'wood-type') {
                    const presetSelect = strengthInputContainer.querySelector('select');
                    strengthValue = presetSelect ? presetSelect.value : '';
                }
            }

            const izValue = row.cells[5]?.querySelector('input')?.value || 1840;
            const iyValue = row.cells[6]?.querySelector('input')?.value || 613;
            const jValue = row.cells[7]?.querySelector('input')?.value || 235;
            const iwValue = row.cells[8]?.querySelector('input')?.value || '';
            const aValue = row.cells[9]?.querySelector('input')?.value || 2340;
            const zzValue = row.cells[10]?.querySelector('input')?.value || 1230;
            const zyValue = row.cells[11]?.querySelector('input')?.value || 410;

            const bucklingKValue = (row.querySelector('.buckling-k-input') ? row.querySelector('.buckling-k-input').value : '');

            const memberRecord = {
                i: row.cells[1]?.querySelector('input')?.value || 1,
                j: row.cells[2]?.querySelector('input')?.value || 2,
                E: e_select?.value === 'custom' ? (e_input?.value || '') : (e_select?.value || '205000'),
                strengthType,
                strengthValue,
                Iz: izValue,
                Iy: iyValue,
                J: jValue,
                Iw: iwValue,
                A: aValue,
                Zz: zzValue,
                Zy: zyValue,
                bucklingK: bucklingKValue,
                I: izValue,
                Z: zzValue
            };

            state.members.push(memberRecord);
            
            // 接合条件を追加（安全な取得）
            const currentMember = state.members[state.members.length - 1];
            const connectionTargets = resolveMemberConnectionTargets(row);
            currentMember.i_conn = connectionTargets.i.select?.value || 'rigid';
            currentMember.j_conn = connectionTargets.j.select?.value || 'rigid';
            currentMember.Zx = row.dataset.zx;
            currentMember.ix = row.dataset.ix;
            currentMember.iy = row.dataset.iy;

            // 各行のバネ剛性を取得（UI単位で保存: Kx,Ky=kN/mm, Kr=kN·mm/rad）
            const readSpringFromSelect = (selectEl) => {
                const container = selectEl?.closest('.conn-cell')?.querySelector('.spring-inputs');
                if (!container) return null;
                const parse = (el) => {
                    const v = parseFloat(el?.value);
                    return Number.isFinite(v) ? v : 0;
                };
                const Kx = parse(container.querySelector('.spring-kx'));
                const Ky = parse(container.querySelector('.spring-ky'));
                const Kr = parse(container.querySelector('.spring-kr'));
                const rigidKx = !!container.querySelector('.spring-rigid-kx')?.checked;
                const rigidKy = !!container.querySelector('.spring-rigid-ky')?.checked;
                const rigidKr = !!container.querySelector('.spring-rigid-kr')?.checked;
                return { Kx, Ky, Kr, rigidKx, rigidKy, rigidKr };
            };

            try {
                if (currentMember.i_conn === 'spring') {
                    currentMember.spring_i = readSpringFromSelect(connectionTargets.i.select) || { Kx: 0, Ky: 0, Kr: 0 };
                }
            } catch (e) {
                console.warn('getCurrentState: 始端バネ読み取りエラー', e);
            }
            try {
                if (currentMember.j_conn === 'spring') {
                    currentMember.spring_j = readSpringFromSelect(connectionTargets.j.select) || { Kx: 0, Ky: 0, Kr: 0 };
                }
            } catch (e) {
                console.warn('getCurrentState: 終端バネ読み取りエラー', e);
            }

            // 断面情報と軸設定を保存
            const sectionInfoEncoded = row.dataset.sectionInfo;
            let sectionInfo = null;
            if (sectionInfoEncoded) {
                try {
                    sectionInfo = JSON.parse(decodeURIComponent(sectionInfoEncoded));
                } catch (error) {
                    console.warn('Failed to parse sectionInfo from dataset:', error);
                }
            }

            const resolveAxisInfo = () => {
                const datasetAxis = normalizeAxisInfo({
                    key: row.dataset.sectionAxisKey,
                    mode: row.dataset.sectionAxisMode,
                    label: row.dataset.sectionAxisLabel
                });

                if (datasetAxis) {
                    return datasetAxis;
                }

                if (sectionInfo && sectionInfo.axis) {
                    return normalizeAxisInfo(sectionInfo.axis);
                }

                return null;
            };

            const sectionAxis = resolveAxisInfo();

            currentMember.sectionInfo = sectionInfo || null;
            currentMember.sectionInfoEncoded = sectionInfoEncoded || '';
            currentMember.sectionLabel = row.dataset.sectionLabel || sectionInfo?.label || '';
            currentMember.sectionSummary = row.dataset.sectionSummary || sectionInfo?.dimensionSummary || '';
            currentMember.sectionSource = row.dataset.sectionSource || sectionInfo?.source || '';
            currentMember.sectionAxis = sectionAxis;
            currentMember.sectionAxisKey = sectionAxis?.key || '';
            currentMember.sectionAxisMode = sectionAxis?.mode || '';
            currentMember.sectionAxisLabel = sectionAxis?.label || '';
        });
        Array.from(elements.nodeLoadsTable.rows).forEach(row => {
            state.nodeLoads.push({
                node: row.cells[0]?.querySelector('input')?.value || 1,
                px: row.cells[1]?.querySelector('input')?.value || 0,
                py: row.cells[2]?.querySelector('input')?.value || 0,
                pz: row.cells[3]?.querySelector('input')?.value || 0
            });
        });
        Array.from(elements.memberLoadsTable.rows).forEach(row => {
            state.memberLoads.push({ 
                member: row.cells[0]?.querySelector('input')?.value || 1, 
                wx: row.cells[1]?.querySelector('input')?.value || 0,
                wy: row.cells[2]?.querySelector('input')?.value || 0,
                wz: row.cells[3]?.querySelector('input')?.value || 0,
                w: row.cells[2]?.querySelector('input')?.value || 0
            });
        });
        return state;
    };

    const pushState = () => { historyStack.push(getCurrentState()); };

    const restoreState = (state) => {
        if (!state) return;
        
        const safeDecode = (value) => {
            if (typeof value !== 'string' || value.length === 0) return value || '';
            try {
                return decodeURIComponent(value);
            } catch (error) {
                return value;
            }
        };

        const parseSectionInfo = (member) => {
            if (!member) return null;
            if (member.sectionInfo && typeof member.sectionInfo === 'object' && !Array.isArray(member.sectionInfo)) {
                return ensureSectionSvgMarkup(cloneDeep(member.sectionInfo));
            }

            let encoded = '';
            if (typeof member.sectionInfo === 'string' && member.sectionInfo.trim()) {
                encoded = member.sectionInfo.trim();
            } else if (typeof member.sectionInfoEncoded === 'string' && member.sectionInfoEncoded.trim()) {
                encoded = member.sectionInfoEncoded.trim();
            }

            if (!encoded) return null;

            const decoded = safeDecode(encoded);
            try {
                const parsed = JSON.parse(decoded);
                return parsed && typeof parsed === 'object' ? ensureSectionSvgMarkup(parsed) : null;
            } catch (error) {
                console.warn('Failed to parse sectionInfo during restoreState:', error, member);
                return null;
            }
        };
        const toNumberOrDefault = (value, defaultValue = 0) => {
            const num = typeof value === 'number' ? value : parseFloat(value);
            return Number.isFinite(num) ? num : defaultValue;
        };
        const asFiniteNumber = (value) => {
            if (value === undefined || value === null || value === '') return null;
            const num = typeof value === 'number' ? value : parseFloat(value);
            return Number.isFinite(num) ? num : null;
        };
        const getNumberValue = (value, defaultValue = 0) => {
            const num = asFiniteNumber(value);
            return num !== null ? num : defaultValue;
        };
        const getPositiveNumberValue = (value, defaultValue) => {
            const num = asFiniteNumber(value);
            if (num !== null && num > 0) return num;
            return defaultValue;
        };
        const pickMemberValue = (member, keys, defaultValue) => {
            for (const key of keys) {
                const num = getPositiveNumberValue(member?.[key], null);
                if (num !== null) {
                    return num;
                }
            }
            return defaultValue;
        };
        const MEMBER_PROPERTY_DEFAULTS = Object.freeze({
            Iz: 1840,
            Iy: 613,
            J: 235,
            A: 2340,
            Zz: 1230,
            Zy: 410
        });
        const getValue = (value, defaultValue = 0) => getNumberValue(value, defaultValue);
        const buildSupportSelect = (supportValue) => buildSupportSelectMarkup(supportValue);

        try {
            elements.nodesTable.innerHTML = '';
            elements.membersTable.innerHTML = '';
            elements.nodeLoadsTable.innerHTML = '';
            elements.memberLoadsTable.innerHTML = '';
            
            // 節点復元
            state.nodes.forEach(n => {
                const normalizedSupport = normalizeSupportValue(n.support);
                addRow(elements.nodesTable, [
                `#`,
                `<input type="number" value="${getNumberValue(n.x, 0)}">`,
                `<input type="number" value="${getNumberValue(n.y, 0)}">`,
                `<input type="number" value="${getNumberValue(n.z, 0)}">`,
                buildSupportSelect(normalizedSupport),
                `<input type="number" value="${getNumberValue(n.dx_forced, 0)}" step="0.1">`,
                `<input type="number" value="${getNumberValue(n.dy_forced, 0)}" step="0.1">`,
                `<input type="number" value="${getNumberValue(n.dz_forced, 0)}" step="0.1">`
            ], false);
            });
            
            // 部材復元
            state.members.forEach(m => {
                try {
                    const iz_cm4 = pickMemberValue(m, ['Iz', 'iz', 'I'], MEMBER_PROPERTY_DEFAULTS.Iz);
                    const iy_cm4 = pickMemberValue(m, ['Iy', 'iy'], MEMBER_PROPERTY_DEFAULTS.Iy);
                    const j_cm4 = pickMemberValue(m, ['J', 'j'], MEMBER_PROPERTY_DEFAULTS.J);
                    const a_cm2 = pickMemberValue(m, ['A', 'a'], MEMBER_PROPERTY_DEFAULTS.A);
                    const zz_cm3 = pickMemberValue(m, ['Zz', 'Z', 'zz'], MEMBER_PROPERTY_DEFAULTS.Zz);
                    const zy_cm3 = pickMemberValue(m, ['Zy', 'zy'], MEMBER_PROPERTY_DEFAULTS.Zy);

                    const memberI = getNumberValue(m.i, 1);
                    const memberJ = getNumberValue(m.j, 2);
                    const memberIConn = m.i_conn || m.ic || 'rigid';
                    const memberJConn = m.j_conn || m.jc || 'rigid';
                    const Iz_m4 = getPositiveNumberValue(iz_cm4, MEMBER_PROPERTY_DEFAULTS.Iz) * 1e-8;
                    const Iy_m4 = getPositiveNumberValue(iy_cm4, MEMBER_PROPERTY_DEFAULTS.Iy) * 1e-8;
                    const J_m4 = getPositiveNumberValue(j_cm4, MEMBER_PROPERTY_DEFAULTS.J) * 1e-8;
                    const A_m2 = getPositiveNumberValue(a_cm2, MEMBER_PROPERTY_DEFAULTS.A) * 1e-4;
                    const Zz_m3 = getPositiveNumberValue(zz_cm3, MEMBER_PROPERTY_DEFAULTS.Zz) * 1e-6;
                    const Zy_m3 = getPositiveNumberValue(zy_cm3, MEMBER_PROPERTY_DEFAULTS.Zy) * 1e-6;
                    
                    // memberRowHTML の戻り値を安全に取得
                    const memberHTML = memberRowHTML(
                        memberI,
                        memberJ,
                        m.E || '205000',
                        '235',
                        Iz_m4,
                        Iy_m4,
                        J_m4,
                        A_m2,
                        Zz_m3,
                        Zy_m3,
                        memberIConn,
                        memberJConn,
                        safeDecode(m.sectionLabel || ''),
                        (m.sectionAxis && m.sectionAxis.label) ? safeDecode(m.sectionAxis.label) : safeDecode(m.sectionAxisLabel || ''),
                        (m.bucklingK !== undefined ? m.bucklingK : (m.buckling_k ?? ''))
                    );
                    if (!memberHTML || !Array.isArray(memberHTML)) {
                        console.warn('memberRowHTML returned invalid data:', memberHTML);
                        return;
                    }
                    
                    const newRow = addRow(elements.membersTable, [`#`, ...memberHTML], false);
                    
                    if (newRow && newRow.cells && newRow.cells.length > 4) {
                        // 弾性係数の復元
                        const eSelect = newRow.cells[3] ? newRow.cells[3].querySelector('select') : null;
                        if (eSelect) {
                            eSelect.value = m.E === 'custom' ? 'custom' : m.E;
                            eSelect.dispatchEvent(new Event('change')); // Trigger update
                        }
                        
                        // 降伏強度の復元
                        const strengthCell = newRow.cells[4];
                        if (strengthCell) {
                            const strengthInputContainer = strengthCell.firstElementChild;
                            if (strengthInputContainer) {
                                if (m.strengthType === 'F-value' || m.strengthType === 'Fc' || m.strengthType === 'F-stainless' || m.strengthType === 'F-aluminum') {
                                    const strengthInput = strengthInputContainer.querySelector('input');
                                    if (strengthInput) strengthInput.value = m.strengthValue;
                                    const strengthSelect = strengthInputContainer.querySelector('select');
                                    if (strengthSelect) strengthSelect.value = 'custom';
                                } else if (m.strengthType === 'wood-type') {
                                    const strengthSelect = strengthInputContainer.querySelector('select');
                                    if (strengthSelect) strengthSelect.value = m.strengthValue;
                                }
                            }
                        }

                        // その他のデータ復元
                        if(m.Zx) newRow.dataset.zx = m.Zx;
                        if(m.Zy) newRow.dataset.zy = m.Zy;
                        if(m.ix) newRow.dataset.ix = m.ix;
                        if(m.iy) newRow.dataset.iy = m.iy;

                        // 座屈係数Kの復元
                        try {
                            const kEl = newRow.querySelector('.buckling-k-input');
                            if (kEl) {
                                const val = (m.bucklingK !== undefined ? m.bucklingK : (m.buckling_k ?? ''));
                                kEl.value = (val === null || val === undefined) ? '' : `${val}`;
                            }
                        } catch (e) {
                            console.warn('restoreState: bucklingK復元エラー', e);
                        }

                        // ---- バネ情報（接合条件）が保存されている場合は表示/値を復元 ----
                        try {
                            const connSelects = newRow.querySelectorAll('select.conn-select');
                            const showSpringBoxFor = (selectEl) => {
                                const box = selectEl.closest('.conn-cell')?.querySelector('.spring-inputs');
                                if (box) box.style.display = (selectEl.value === 'spring') ? '' : 'none';
                            };

                            const toUI = (v) => {
                                const num = (typeof v === 'number') ? v : parseFloat(v);
                                return Number.isFinite(num) ? num : 0;
                            };
                            const extractSpring = (prefix) => {
                                // 1) spring_i / spring_j オブジェクト優先
                                const obj = (prefix === 'i') ? m.spring_i : m.spring_j;
                                if (obj && typeof obj === 'object') {
                                    return {
                                        Kx: toUI(obj.Kx),
                                        Ky: toUI(obj.Ky),
                                        Kr: toUI(obj.Kr),
                                        rigidKx: !!obj.rigidKx,
                                        rigidKy: !!obj.rigidKy,
                                        rigidKr: !!obj.rigidKr
                                    };
                                }
                                // 2) CSV列（Kx_i 等）フォールバック
                                const kx = toUI(m[prefix === 'i' ? 'Kx_i' : 'Kx_j']);
                                const ky = toUI(m[prefix === 'i' ? 'Ky_i' : 'Ky_j']);
                                const kr = toUI(m[prefix === 'i' ? 'Kr_i' : 'Kr_j']);
                                return { Kx: kx, Ky: ky, Kr: kr, rigidKx: false, rigidKy: false, rigidKr: false };
                            };

                            if (connSelects && connSelects.length >= 2) {
                                const iSel = connSelects[0];
                                const jSel = connSelects[1];
                                if (m.i_conn) iSel.value = m.i_conn;
                                if (m.j_conn) jSel.value = m.j_conn;
                                showSpringBoxFor(iSel);
                                showSpringBoxFor(jSel);

                                if (iSel.value === 'spring') {
                                    const s = extractSpring('i');
                                    const box = iSel.closest('.conn-cell')?.querySelector('.spring-inputs');
                                    if (box) {
                                        const kx = box.querySelector('.spring-kx');
                                        const ky = box.querySelector('.spring-ky');
                                        const kr = box.querySelector('.spring-kr');
                                        const rkx = box.querySelector('.spring-rigid-kx');
                                        const rky = box.querySelector('.spring-rigid-ky');
                                        const rkr = box.querySelector('.spring-rigid-kr');
                                        if (kx) kx.value = s.Kx;
                                        if (ky) ky.value = s.Ky;
                                        if (kr) kr.value = s.Kr;
                                        if (rkx) rkx.checked = !!s.rigidKx;
                                        if (rky) rky.checked = !!s.rigidKy;
                                        if (rkr) rkr.checked = !!s.rigidKr;
                                        // disabled同期
                                        if (kx) kx.disabled = !!s.rigidKx;
                                        if (ky) ky.disabled = !!s.rigidKy;
                                        if (kr) kr.disabled = !!s.rigidKr;
                                    }
                                }
                                if (jSel.value === 'spring') {
                                    const s = extractSpring('j');
                                    const box = jSel.closest('.conn-cell')?.querySelector('.spring-inputs');
                                    if (box) {
                                        const kx = box.querySelector('.spring-kx');
                                        const ky = box.querySelector('.spring-ky');
                                        const kr = box.querySelector('.spring-kr');
                                        const rkx = box.querySelector('.spring-rigid-kx');
                                        const rky = box.querySelector('.spring-rigid-ky');
                                        const rkr = box.querySelector('.spring-rigid-kr');
                                        if (kx) kx.value = s.Kx;
                                        if (ky) ky.value = s.Ky;
                                        if (kr) kr.value = s.Kr;
                                        if (rkx) rkx.checked = !!s.rigidKx;
                                        if (rky) rky.checked = !!s.rigidKy;
                                        if (rkr) rkr.checked = !!s.rigidKr;
                                        if (kx) kx.disabled = !!s.rigidKx;
                                        if (ky) ky.disabled = !!s.rigidKy;
                                        if (kr) kr.disabled = !!s.rigidKr;
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('restoreState: バネ表示復元中にエラー', e);
                        }

                        // 断面情報と軸情報を復元
                        let sectionInfoToApply = parseSectionInfo(m);
                        const decodedLabel = safeDecode(m.sectionLabel || '');
                        const decodedSummary = safeDecode(m.sectionSummary || '');
                        const decodedSource = safeDecode(m.sectionSource || '');

                        if (!sectionInfoToApply && (decodedLabel || decodedSummary || decodedSource)) {
                            sectionInfoToApply = {};
                            if (decodedLabel) sectionInfoToApply.label = decodedLabel;
                            if (decodedSummary) sectionInfoToApply.dimensionSummary = decodedSummary;
                            if (decodedSource) sectionInfoToApply.source = decodedSource;
                        }

                        const axisInfo = buildAxisInfo(m, sectionInfoToApply);
                        if (axisInfo) {
                            if (!sectionInfoToApply) sectionInfoToApply = {};
                            sectionInfoToApply.axis = { ...axisInfo };
                        }

                        if (sectionInfoToApply) {
                            setRowSectionInfo(newRow, sectionInfoToApply);
                        } else if (axisInfo) {
                            applySectionAxisDataset(newRow, axisInfo);
                        } else {
                            // 念のため既存のデータセットをクリア
                            applySectionAxisDataset(newRow, null);
                        }
                    }
                } catch (memberError) {
                    console.error('Error restoring member:', memberError, m);
                }
            });
            
            // 節点荷重復元
            state.nodeLoads.forEach(l => addRow(elements.nodeLoadsTable, [
                `<input type="number" value="${getNumberValue(l.node ?? l.n, 1)}">`,
                `<input type="number" value="${getNumberValue(l.px, 0)}">`,
                `<input type="number" value="${getNumberValue(l.py, 0)}">`,
                `<input type="number" value="${getNumberValue(l.pz, 0)}">`
            ], false));
            
            // 部材荷重復元
            state.memberLoads.forEach(l => addRow(elements.memberLoadsTable, [
                `<input type="number" value="${getNumberValue(l.member ?? l.m, 1)}">`,
                `<input type="number" value="${getNumberValue(l.wx, 0)}">`,
                `<input type="number" value="${getNumberValue(l.wy ?? l.w, 0)}">`,
                `<input type="number" value="${getNumberValue(l.wz, 0)}">`
            ], false));
            
            renumberTables();
            if (typeof drawOnCanvas === 'function') {
                drawOnCanvas();
            }
        } catch (error) {
            console.error('Error in restoreState:', error);
            alert('元に戻す処理中にエラーが発生しました。コンソールで詳細を確認してください。');
        }
    };
    
    elements.undoBtn.onclick = () => { if (historyStack.length > 0) { const lastState = historyStack.pop(); if(lastState) restoreState(lastState); } };

    // 2D側と同様に、状態管理をグローバルから参照できるようにする（スプレッドシート/AI連携用）
    window.pushState = pushState;
    window.restoreState = restoreState;
    window.getCurrentState = getCurrentState;
    
    /**
     * テーブル行の基本構造を作成
     * @param {HTMLTableSectionElement} tableBody - 対象のテーブルボディ
     * @param {Array} cells - セルの内容配列
     * @returns {HTMLTableRowElement} 作成された行要素
     */
    const createTableRow = (tableBody, cells) => {
        const newRow = tableBody.insertRow();
        cells.forEach(cellHTML => { 
            const cell = newRow.insertCell(); 
            cell.innerHTML = cellHTML; 
        });
        
        // 削除ボタンセルを追加
        const deleteCell = newRow.insertCell();
        deleteCell.innerHTML = '<button class="delete-row-btn">×</button>';
        
        return newRow;
    };

    // ▼▼▼ 追加: 部材テーブルの列表示を更新・同期する関数（2Dと同等） ▼▼▼
    function updateMemberTableVisibility() {
        const table = document.getElementById('members-table');
        if (!table) return;

        const toggles = document.querySelectorAll('.column-toggles .col-toggle');
        const visibilityState = {};
        toggles.forEach(toggle => {
            const target = toggle.getAttribute('data-target');
            if (target) visibilityState[target] = toggle.checked;
        });

        const isDensityEnabled = document.getElementById('consider-self-weight-checkbox')?.checked;

        const shouldShow = (element) => {
            if (element.classList.contains('density-column') && !isDensityEnabled) {
                return false;
            }
            for (const [cls, isVisible] of Object.entries(visibilityState)) {
                if (element.classList.contains(cls) && !isVisible) {
                    return false;
                }
            }
            return true;
        };

        table.querySelectorAll('thead th').forEach(th => {
            th.style.display = shouldShow(th) ? '' : 'none';
        });
        table.querySelectorAll('tbody tr').forEach(row => {
            Array.from(row.cells).forEach(cell => {
                cell.style.display = shouldShow(cell) ? '' : 'none';
            });
        });
    }
    // ▲▲▲ 追加終了 ▲▲▲

    // ▼▼▼ 追加: 接合バネの表示切替（2Dと同等のDOM前提） ▼▼▼
    function updateConnCellSpringVisibility(selectEl) {
        try {
            const box = selectEl?.closest('.conn-cell')?.querySelector('.spring-inputs');
            if (!box) return;
            box.style.display = (selectEl.value === 'spring') ? '' : 'none';
        } catch (e) {
            console.warn('spring visibility update failed', e);
        }
    }

    function refreshAllMemberSpringVisibility() {
        try {
            document.querySelectorAll('#members-table select.conn-select').forEach(sel => updateConnCellSpringVisibility(sel));
        } catch (e) {
            console.warn('spring visibility refresh failed', e);
        }
    }
    // ▲▲▲ 追加終了 ▲▲▲

    /**
     * 部材テーブル用の特別な設定を適用
     * @param {HTMLTableRowElement} row - 設定対象の行
     */
    const setupMemberRowSpecialFeatures = (row) => {
        // 1) 断面算定関連のクラスを追加（theadの定義に追随させる）
        try {
            const table = row.closest('table');
            const headerRow = table?.tHead?.rows?.[0] || table?.querySelector('thead tr');
            if (headerRow) {
                for (let i = 0; i < headerRow.cells.length && i < row.cells.length; i++) {
                    if (headerRow.cells[i]?.classList?.contains('section-check-item')) {
                        row.cells[i]?.classList?.add('section-check-item');
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        // 2) 断面選択ボタンの挿入（接合セルの直前に入れる: 2Dと同じロジック）
        let firstConnIndex = -1;
        for (let i = 0; i < row.cells.length; i++) {
            const cell = row.cells[i];
            try {
                if (cell?.querySelector && (cell.querySelector('.conn-cell') || cell.querySelector('.conn-select'))) {
                    firstConnIndex = i;
                    break;
                }
            } catch (e) {}
        }
        const insertIndex = firstConnIndex !== -1 ? firstConnIndex : (row.cells.length > 0 ? row.cells.length - 1 : 0);
        if (!row.querySelector('.select-props-btn')) {
            const selectCell = row.insertCell(insertIndex);
            selectCell.innerHTML = `<button class="select-props-btn" title="鋼材データツールを開く">選択</button>`;
        }

        // 3) 全セルに列トグル用クラスを付与（コンテンツベース判定）
        for (let i = 0; i < row.cells.length; i++) {
            const cell = row.cells[i];
            if (!cell) continue;
            if (cell.querySelector('.delete-row-btn')) continue;

            cell.classList.remove('col-material', 'col-section', 'col-buckling', 'col-conn', 'density-column');

            try {
                // 密度
                if (cell.classList.contains('density-cell') || cell.querySelector('input[title*="密度"]')) {
                    cell.classList.add('col-section', 'density-column');
                    continue;
                }
                // 座屈係数K
                if (cell.querySelector('.buckling-k-input')) {
                    cell.classList.add('col-buckling');
                    continue;
                }
                // 断面選択ボタン
                if (cell.querySelector('.select-props-btn')) {
                    cell.classList.add('col-section');
                    continue;
                }
                // 断面名称/軸
                if (cell.querySelector('.section-name-cell') || cell.querySelector('.section-axis-cell')) {
                    cell.classList.add('col-section');
                    continue;
                }
                // 接合条件
                if (cell.querySelector('.conn-cell') || cell.querySelector('.conn-select')) {
                    cell.classList.add('col-conn');
                    continue;
                }
                // 材料（E/F）
                if (i === 3 || i === 4) {
                    cell.classList.add('col-material');
                    continue;
                }
                // 断面諸量（Iz..）
                if (i >= 5 && i <= 10) {
                    cell.classList.add('col-section');
                    continue;
                }
            } catch (e) {
                console.warn('Cell class assignment error', e);
            }
        }

        // 4) 追加直後に表示状態を同期
        try { refreshAllMemberSpringVisibility(); } catch (e) {}
        try { updateMemberTableVisibility(); } catch (e) {}
    };

    /**
     * 材料タイプ変更時の強度入力UIを設定
     * @param {HTMLTableRowElement} row - 対象の行
     */
    const setupMaterialTypeHandling = (row) => {
        const eSelect = row.cells[3].querySelector('select');
        const strengthCell = row.cells[4];
        
        const handleMaterialChange = () => {
            const selectedOption = eSelect.options[eSelect.selectedIndex];
            let materialType = 'steel';
            
            if (selectedOption.textContent.includes('木材')) materialType = 'wood';
            else if (selectedOption.textContent.includes('コンクリート')) materialType = 'concrete';
            else if (selectedOption.textContent.includes('ステンレス')) materialType = 'stainless';
            else if (selectedOption.textContent.includes('アルミニウム')) materialType = 'aluminum';
            
            strengthCell.innerHTML = '';
            strengthCell.appendChild(createStrengthInputHTML(materialType, `member-strength-${row.rowIndex}`));
            
            // 自重考慮がオンの場合、密度も更新
            if (elements.considerSelfWeightCheckbox && elements.considerSelfWeightCheckbox.checked) {
                const densityCell = row.querySelector('.density-cell');
                if (densityCell) {
                    const eInput = row.cells[3].querySelector('input[type="number"]');
                    const eValue = eSelect.value === 'custom' ? eInput.value : eSelect.value;
                    const newDensity = MATERIAL_DENSITY_DATA[eValue] || MATERIAL_DENSITY_DATA['custom'];
                    
                    // 密度セルのHTMLを更新
                    densityCell.innerHTML = createDensityInputHTML(`member-density-${row.rowIndex}`, newDensity);
                }
            }
            
            // 木材選択時の弾性係数連動処理
            if (materialType === 'wood') {
                setTimeout(() => setupWoodElasticModulusSync(row, strengthCell), 100);
            }
        };
        
        eSelect.addEventListener('change', handleMaterialChange);
        
        // 初期化処理
        try {
            handleMaterialChange();
        } catch (error) {
            console.warn('材料タイプ初期化失敗:', error);
        }
    };

    /**
     * 木材選択時の弾性係数自動更新を設定
     * @param {HTMLTableRowElement} row - 対象の行
     * @param {HTMLTableCellElement} strengthCell - 強度入力セル
     */
    const setupWoodElasticModulusSync = (row, strengthCell) => {
        const strengthSelect = strengthCell.querySelector('select');
        const eInput = row.cells[3].querySelector('input');
        
        if (!strengthSelect || !eInput) return;
        
        const woodElasticModuli = {
            'Akamatsu_Group': 8000, 'Kuromatsu_Group': 8000, 'Beimatsu_Group': 8000,
            'Karamatsu_Group': 9000, 'Hiba_Group': 9000, 'Hinoki_Group': 9000, 'Beihi_Group': 9000,
            'Tuga_Group': 8000, 'Beituga_Group': 8000,
            'Momi_Group': 7000, 'Ezomatsu_Group': 7000, 'Todomatsu_Group': 7000, 'Benimatsu_Group': 7000,
            'Sugi_Group': 7000, 'Beisugi_Group': 7000, 'Spruce_Group': 7000,
            'Kashi_Group': 10000,
            'Kuri_Group': 8000, 'Nara_Group': 8000, 'Buna_Group': 8000, 'Keyaki_Group': 8000
        };
        
        const updateElasticModulus = () => {
            const woodType = strengthSelect.value;
            if (woodElasticModuli[woodType]) {
                eInput.value = woodElasticModuli[woodType];
            }
        };
        
        strengthSelect.addEventListener('change', updateElasticModulus);
        updateElasticModulus(); // 初期値設定
    };

    /**
     * 行削除ボタンのイベントリスナーを設定
     * @param {HTMLTableRowElement} row - 対象の行
     * @param {HTMLTableSectionElement} tableBody - 所属するテーブルボディ
     */
    const setupRowDeleteHandler = (row, tableBody) => {
        const deleteBtn = row.querySelector('.delete-row-btn');
        
        if (tableBody === elements.membersTable) {
            deleteBtn.onclick = () => handleMemberRowDeletion(row);
        } else if (tableBody === elements.nodesTable) {
            deleteBtn.onclick = () => handleNodeRowDeletion(row);
        } else {
            deleteBtn.onclick = () => handleGenericRowDeletion(row);
        }
    };

    /**
     * 部材行削除の処理
     * @param {HTMLTableRowElement} row - 削除対象の行
     */
    const handleMemberRowDeletion = (row) => {
        pushState();
        const deletedMemberNumber = row.rowIndex;
        
        // 関連する部材荷重を削除
        const loadsToDelete = Array.from(elements.memberLoadsTable.rows)
            .filter(r => parseInt(r.cells[0].querySelector('input').value) - 1 === deletedMemberNumber);
        loadsToDelete.forEach(r => r.remove());
        
        // 後続の部材荷重の番号を調整
        Array.from(elements.memberLoadsTable.rows).forEach(r => {
            const input = r.cells[0].querySelector('input');
            const current = parseInt(input.value);
            if (current - 1 > deletedMemberNumber) {
                input.value = current - 1;
            }
        });
        
        row.remove();
        renumberTables();
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
    };

    /**
     * 節点行削除の処理
     * @param {HTMLTableRowElement} row - 削除対象の行
     */
    const handleNodeRowDeletion = (row) => {
        pushState();
        const deletedNodeIndex = row.rowIndex - 1;
        const deletedNodeNumber = deletedNodeIndex + 1;
        
        const membersToDelete = [];
        const membersToUpdate = [];
        
        // 関連する部材の処理
        Array.from(elements.membersTable.rows).forEach(r => {
            const i = r.cells[1].querySelector('input');
            const j = r.cells[2].querySelector('input');
            const c_i = parseInt(i.value);
            const c_j = parseInt(j.value);
            
            if (c_i === deletedNodeNumber || c_j === deletedNodeNumber) {
                membersToDelete.push(r);
            } else {
                if (c_i > deletedNodeNumber) {
                    membersToUpdate.push({ input: i, newValue: c_i - 1 });
                }
                if (c_j > deletedNodeNumber) {
                    membersToUpdate.push({ input: j, newValue: c_j - 1 });
                }
            }
        });
        
        // 関連する節点荷重の処理
        const nodeLoadsToDelete = [];
        const nodeLoadsToUpdate = [];
        
        Array.from(elements.nodeLoadsTable.rows).forEach(r => {
            const n = r.cells[0].querySelector('input');
            const current = parseInt(n.value);
            
            if (current === deletedNodeNumber) {
                nodeLoadsToDelete.push(r);
            } else if (current > deletedNodeNumber) {
                nodeLoadsToUpdate.push({ input: n, newValue: current - 1 });
            }
        });
        
        // 削除と更新を実行
        membersToDelete.forEach(r => r.remove());
        nodeLoadsToDelete.forEach(r => r.remove());
        membersToUpdate.forEach(item => item.input.value = item.newValue);
        nodeLoadsToUpdate.forEach(item => item.input.value = item.newValue);
        
        row.remove();
        renumberTables();
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
    };

    /**
     * 一般的な行削除の処理
     * @param {HTMLTableRowElement} row - 削除対象の行
     */
    const handleGenericRowDeletion = (row) => {
        pushState();
        row.remove();
        renumberTables();
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
    };

    /**
     * 行の入力フィールドにイベントリスナーを設定
     * @param {HTMLTableRowElement} row - 対象の行
     * @param {HTMLTableSectionElement} tableBody - 所属するテーブルボディ
     */
    const setupRowInputListeners = (row, tableBody) => {
        row.querySelectorAll('input, select').forEach(element => {
            element.addEventListener('focus', pushState);
            element.addEventListener('change', () => {
                if (typeof drawOnCanvas === 'function') {
                    drawOnCanvas();
                }
            });
        });
        
        // 入力検証の設定
        setupTableInputValidation(row, tableBody);
    };

    const addRow = (tableBody, cells, saveHistory = true) => {
        return utils.executeWithErrorHandling(() => {
            if (saveHistory) pushState();
            
            const newRow = createTableRow(tableBody, cells);
            
            // テーブル固有の設定
            if (tableBody === elements.membersTable) {
                setupMemberRowSpecialFeatures(newRow);
                setupMaterialTypeHandling(newRow);
            }
            
            // イベントリスナーの設定
            setupRowDeleteHandler(newRow, tableBody);
            setupRowInputListeners(newRow, tableBody);
            
            if (saveHistory) {
                renumberTables();
                // プリセット読み込み中は描画をスキップ
                if (typeof drawOnCanvas === 'function' && !window.isLoadingPreset) {
                    drawOnCanvas();
                }
            }
            
            return newRow;
        }, { tableType: tableBody.id, cellCount: cells.length }, 'テーブル行の追加に失敗しました');
    };

    const renumberTables = () => {
        elements.nodesTable.querySelectorAll('tr').forEach((row, i) => row.cells[0].textContent = i + 1);
        elements.membersTable.querySelectorAll('tr').forEach((row, i) => row.cells[0].textContent = i + 1);
    };
    
    const calculate = () => {
        try {
            // elements が初期化されているかチェック
            if (!elements) {
                console.error('❌ calculate: elements が初期化されていません');
                alert('内部エラー: DOM要素が初期化されていません。ページを再読み込みしてください。');
                return;
            }
            
            elements.errorMessage.style.display = 'none';
            clearResults(); 
            const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
            const projectionModeForCalc = getProjectionModeValue();
            const is3DModeActive = window.is3DMode === true;
            const { calcRules } = buildConcentratedLoadRules(projectionModeForCalc, is3DModeActive);
            const adjustedNodeLoads = nodeLoads.map(load => applyCalcRulesToLoad(load, calcRules));
            const loadCalcMultipliers = {
                x: calcRules.px?.multiplier ?? 1,
                y: calcRules.py?.multiplier ?? 1,
                z: calcRules.pz?.multiplier ?? 1
            };
            
            // 2次元フレームの自動検出（全ての節点のY座標が同じ値の場合）
            const is2DFrame = nodes.length > 0 && nodes.every(node => Math.abs(node.y - nodes[0].y) < 1e-6);
            
            if (is2DFrame) {
                // 2次元フレームの場合、Z座標をY座標として扱う（2D解析エンジンはXY平面用）
                nodes.forEach(node => {

            const addNode = typeof window.addNodeToTable === 'function' ? window.addNodeToTable : null;
            if (!addNode) {
                alert('節点追加処理が初期化されていません。ページを再読み込みしてください。');
                return;
            }
                    const tempY = node.y;
                    node.y = node.z; // Z座標（垂直）をY座標として使用
                    node.z = tempY;  // Y座標（面外）をZ座標として退避
                });
                
                // 部材の幾何情報を再計算（座標変換後）
                members.forEach(member => {
                    const ni = nodes[member.i];
                    const nj = nodes[member.j];
                    const dx = nj.x - ni.x;
                    const dy = nj.y - ni.y;
                    const L = Math.sqrt(dx**2 + dy**2);
                    
                    if (L === 0) {
                        console.error(`部材 ${member.i+1}-${member.j+1} の長さが0です`);
                        return;
                    }
                    
                    // 方向余弦を更新
                    const c = dx / L;
                    const s = dy / L;
                    member.length = L;
                    member.c = c;
                    member.s = s;
                    
                    // 変換マトリックスを更新（2D用）
                    member.T = [
                        [c, s, 0, 0, 0, 0],
                        [-s, c, 0, 0, 0, 0],
                        [0, 0, 1, 0, 0, 0],
                        [0, 0, 0, c, s, 0],
                        [0, 0, 0, -s, c, 0],
                        [0, 0, 0, 0, 0, 1]
                    ];
                    
                    // 局所剛性マトリックスを再計算
                    const E = member.E;
                    const A = member.A;
                    const axisProps2D = member.axisProperties || null;
                    const I = axisProps2D?.bendingInertia ?? member.I ?? member.Iz; // 選択軸に応じた断面二次モーメント
                    
                    const i_conn = member.i_conn;
                    const j_conn = member.j_conn;

                    member.k_local = compute2DLocalStiffnessWithEndSprings({
                        E,
                        A,
                        I,
                        L,
                        i_conn,
                        j_conn,
                        spring_i: member.spring_i || { Kx: 0, Ky: 0, Kr: 0 },
                        spring_j: member.spring_j || { Kx: 0, Ky: 0, Kr: 0 }
                    });
                });
                
                // 面外方向の自由度を拘束（元のdy_forcedをdz_forcedに移動）
                nodes.forEach(node => {
                    node.dz_forced = 0; // 面外変位（元のY方向）を拘束
                    node.dy_forced = undefined; // Y方向（現在は垂直方向）は自由
                });
            }
            
            // 解析用に自重荷重を部材・節点荷重へ統合（常にグローバル-Z方向）
            const combinedNodeLoads = [...adjustedNodeLoads];

            const EPS = 1e-9;
            const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
            const cross3 = (a, b) => ({
                x: a.y * b.z - a.z * b.y,
                y: a.z * b.x - a.x * b.z,
                z: a.x * b.y - a.y * b.x
            });
            const magnitude3 = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            const normalize3 = (v) => {
                const len = magnitude3(v);
                if (!isFinite(len) || len <= EPS) {
                    return { x: 0, y: 0, z: 0 };
                }
                return { x: v.x / len, y: v.y / len, z: v.z / len };
            };
            const scale3 = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
            const subtract3 = (a, b) => ({
                x: (a?.x ?? 0) - (b?.x ?? 0),
                y: (a?.y ?? 0) - (b?.y ?? 0),
                z: (a?.z ?? 0) - (b?.z ?? 0)
            });

            const ensureCombinedNodeLoad = (nodeIndex) => {
                let target = combinedNodeLoads.find(load => load.nodeIndex === nodeIndex);
                if (!target) {
                    target = {
                        nodeIndex,
                        px: 0,
                        py: 0,
                        pz: 0,
                        mx: 0,
                        my: 0,
                        mz: 0
                    };
                    combinedNodeLoads.push(target);
                }
                return target;
            };

            const getMemberBasis = (member) => {
                const nodeI = nodes[member.i];
                const nodeJ = nodes[member.j];
                if (!nodeI || !nodeJ) {
                    return null;
                }

                const dx = (nodeJ.x ?? 0) - (nodeI.x ?? 0);
                const dy = (nodeJ.y ?? 0) - (nodeI.y ?? 0);
                const dz = is2DFrame ? 0 : ((nodeJ.z ?? 0) - (nodeI.z ?? 0));
                const axisVector = { x: dx, y: dy, z: dz };
                const length = magnitude3(axisVector);
                if (!(length > EPS)) {
                    return null;
                }

                const localX = { x: axisVector.x / length, y: axisVector.y / length, z: axisVector.z / length };
                let localY;
                let localZ;

                if (is2DFrame) {
                    localZ = { x: 0, y: 0, z: 1 };
                    localY = { x: -localX.y, y: localX.x, z: 0 };
                    const localYLength = magnitude3(localY);
                    if (!(localYLength > EPS)) {
                        localY = { x: 0, y: 1, z: 0 };
                    } else {
                        localY = normalize3(localY);
                    }
                } else {
                    if (Math.abs(localX.z) < 0.9) {
                        const temp = Math.sqrt(localX.x * localX.x + localX.y * localX.y);
                        localZ = normalize3({
                            x: -localX.z * localX.x / temp,
                            y: -localX.z * localX.y / temp,
                            z: temp
                        });
                        localY = normalize3(cross3(localZ, localX));
                    } else {
                        localY = { x: 0, y: 1, z: 0 };
                        localZ = normalize3(cross3(localX, localY));
                        localY = normalize3(cross3(localZ, localX));
                    }
                }

                return { localX, localY, localZ, length };
            };

            const combinedMemberLoads = [];

            memberLoads.forEach(load => {
                const memberIndex = load.memberIndex;
                const member = members[memberIndex];
                if (!member) {
                    return;
                }

                const basis = getMemberBasis(member);
                if (!basis) {
                    return;
                }

                const wxInput = Number(load.wx);
                const wyInput = Number(load.wy);
                const wzInput = Number(load.wz);
                const legacyW = Number(load.w);

                const originalGlobal = {
                    x: Number.isFinite(wxInput) ? wxInput : 0,
                    y: Number.isFinite(wyInput) ? wyInput : 0,
                    z: Number.isFinite(wzInput) ? wzInput : (Number.isFinite(legacyW) ? legacyW : 0)
                };

                if (Math.abs(originalGlobal.x) < EPS && Math.abs(originalGlobal.y) < EPS && Math.abs(originalGlobal.z) < EPS) {
                    return;
                }

                const analysisGlobal = is2DFrame
                    ? { x: originalGlobal.x, y: originalGlobal.z, z: originalGlobal.y }
                    : { ...originalGlobal };

                const localComponents = {
                    wx: dot3(analysisGlobal, basis.localX),
                    wy: dot3(analysisGlobal, basis.localY),
                    wz: dot3(analysisGlobal, basis.localZ)
                };

                if (Math.abs(localComponents.wx) > EPS && basis.length > EPS) {
                    const halfAxial = (localComponents.wx * basis.length) / 2;
                    if (Math.abs(halfAxial) > EPS) {
                        const axialVector = scale3(basis.localX, halfAxial);
                        const loadI = ensureCombinedNodeLoad(member.i);
                        const loadJ = ensureCombinedNodeLoad(member.j);
                        loadI.px = (loadI.px || 0) + axialVector.x;
                        loadI.py = (loadI.py || 0) + axialVector.y;
                        loadI.pz = (loadI.pz || 0) + axialVector.z;
                        loadJ.px = (loadJ.px || 0) + axialVector.x;
                        loadJ.py = (loadJ.py || 0) + axialVector.y;
                        loadJ.pz = (loadJ.pz || 0) + axialVector.z;
                    }
                }

                const hasTransverse = Math.abs(localComponents.wy) > EPS || (!is2DFrame && Math.abs(localComponents.wz) > EPS);
                if (!hasTransverse) {
                    return;
                }

                combinedMemberLoads.push({
                    memberIndex,
                    wy: localComponents.wy,
                    wz: is2DFrame ? 0 : localComponents.wz,
                    w: localComponents.wy,
                    global: {
                        wx: analysisGlobal.x,
                        wy: analysisGlobal.y,
                        wz: analysisGlobal.z
                    },
                    isFromUserInput: true
                });
            });

            if (memberSelfWeights && memberSelfWeights.length > 0) {
                console.log('🔧 自重荷重を解析に追加（全てグローバル座標系の−Z方向）:');

                const downwardUnit = is2DFrame ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: -1 };

                const selfWeightNodeMap = new Map();
                const ensureNodeLoad = (nodeIndex) => {
                    if (!selfWeightNodeMap.has(nodeIndex)) {
                        selfWeightNodeMap.set(nodeIndex, {
                            nodeIndex,
                            px: 0,
                            py: 0,
                            pz: 0,
                            mx: 0,
                            my: 0,
                            mz: 0,
                            isFromSelfWeight: true
                        });
                    }
                    return selfWeightNodeMap.get(nodeIndex);
                };

                memberSelfWeights.forEach(selfWeightLoad => {
                    const member = members[selfWeightLoad.memberIndex];
                    if (!member) return;

                    const nodeI = nodes[member.i];
                    const nodeJ = nodes[member.j];
                    if (!nodeI || !nodeJ) return;

                    const dx = (nodeJ.x ?? 0) - (nodeI.x ?? 0);
                    const dy = (nodeJ.y ?? 0) - (nodeI.y ?? 0);
                    const dz = is2DFrame ? 0 : ((nodeJ.z ?? 0) - (nodeI.z ?? 0));
                    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (!(length > EPS)) return;

                    const weightPerMeter = selfWeightLoad.w || 0;
                    if (Math.abs(weightPerMeter) < EPS) return;

                    // 自重は常にグローバル鉛直方向（下向き）に作用
                    // weightPerMeterは正の値で格納されているので、符号を反転して下向きにする
                    // 2Dフレーム: -Y方向, 3Dフレーム: -Z方向
                    const globalLoadVector = is2DFrame ? {
                        wx: 0,
                        wy: -weightPerMeter,  // 2D: 負の値（Y軸下向き）
                        wz: 0
                    } : {
                        wx: 0,
                        wy: 0,
                        wz: -weightPerMeter  // 3D: 負の値（Z軸下向き）
                    };

                    // 部材の局所座標系を計算（解析用）
                    const localX = normalize3({ x: dx, y: dy, z: dz });
                    let localY;
                    let localZ;

                    if (is2DFrame) {
                        const globalZAxis = { x: 0, y: 0, z: 1 };
                        localY = normalize3(cross3(globalZAxis, localX));
                        localZ = globalZAxis;
                        if (magnitude3(localY) <= EPS) {
                            localY = { x: 0, y: 1, z: 0 };
                        }
                    } else {
                        if (Math.abs(localX.z) < 0.9) {
                            const temp = Math.sqrt(localX.x * localX.x + localX.y * localX.y);
                            localZ = normalize3({
                                x: -localX.z * localX.x / temp,
                                y: -localX.z * localX.y / temp,
                                z: temp
                            });
                            localY = normalize3(cross3(localZ, localX));
                        } else {
                            localY = { x: 0, y: 1, z: 0 };
                            localZ = normalize3(cross3(localX, localY));
                            localY = normalize3(cross3(localZ, localX));
                        }
                    }

                    // グローバル荷重ベクトルを局所座標系に変換（解析用）
                    const loadVectorGlobal = is2DFrame ? 
                        { x: 0, y: -weightPerMeter, z: 0 } :
                        { x: 0, y: 0, z: -weightPerMeter };
                    const wyComponent = dot3(loadVectorGlobal, localY);
                    const wzComponent = is2DFrame ? 0 : dot3(loadVectorGlobal, localZ);

                    // 解析用に局所成分の分布荷重を追加
                    const hasTransverse = Math.abs(wyComponent) > EPS || Math.abs(wzComponent) > EPS;
                    if (hasTransverse) {
                        const distributedLoad = {
                            memberIndex: selfWeightLoad.memberIndex,
                            wy: Math.abs(wyComponent) > EPS ? wyComponent : 0,
                            wz: is2DFrame ? 0 : (Math.abs(wzComponent) > EPS ? wzComponent : 0),
                            w: weightPerMeter,
                            isFromSelfWeight: true,
                            global: globalLoadVector  // グローバル成分を保存（描画用）
                        };
                        console.log(`  部材${selfWeightLoad.memberIndex + 1}: wy=${distributedLoad.wy.toFixed(4)}kN/m, wz=${(distributedLoad.wz || 0).toFixed(4)}kN/m (グローバル${is2DFrame ? 'Y' : 'Z'}軸下向き)`);
                        combinedMemberLoads.push(distributedLoad);
                    } else {
                        console.log(`  部材${selfWeightLoad.memberIndex + 1}: 分布荷重成分なし（軸方向のみ）`);
                    }
                });

                // 軸方向成分を節点荷重に加算
                if (selfWeightNodeMap.size > 0) {
                    let totalVertical = 0;
                    const totalVector = { x: 0, y: 0, z: 0 };
                    selfWeightNodeMap.forEach(load => {
                        const existing = combinedNodeLoads.find(item => item.nodeIndex === load.nodeIndex);
                        if (existing) {
                            existing.px = (existing.px || 0) + (load.px || 0);
                            existing.py = (existing.py || 0) + (load.py || 0);
                            existing.pz = (existing.pz || 0) + (load.pz || 0);
                            if (load.isFromSelfWeight) existing.isFromSelfWeight = true;
                        } else {
                            combinedNodeLoads.push(load);
                        }
                        if (is2DFrame) {
                            totalVertical += load.py || 0;
                        } else {
                            totalVertical += load.pz || 0;
                        }

                        totalVector.x += load.px || 0;
                        totalVector.y += load.py || 0;
                        totalVector.z += load.pz || 0;

                        console.log(`  節点${load.nodeIndex + 1}: (Px, Py, Pz)=(${(load.px||0).toFixed(4)}, ${(load.py||0).toFixed(4)}, ${(load.pz||0).toFixed(4)})kN (自重軸成分)`);
                    });
                    console.log(`  ▶ 節点自重合計: ${is2DFrame ? 'Py' : 'Pz'}=${totalVertical.toFixed(4)}kN, ベクトル合計=(${totalVector.x.toFixed(4)}, ${totalVector.y.toFixed(4)}, ${totalVector.z.toFixed(4)})kN`);
                }
            }

            // 解析用に自重節点荷重（事前計算分）があれば統合
            if (nodeSelfWeights && nodeSelfWeights.length > 0) {
                console.log('🔧 自重節点荷重を解析に追加:');
                nodeSelfWeights.forEach(selfWeightLoad => {
                    const existingLoad = combinedNodeLoads.find(load => load.nodeIndex === selfWeightLoad.nodeIndex);
                    const target = existingLoad || {
                        nodeIndex: selfWeightLoad.nodeIndex,
                        px: 0,
                        py: 0,
                        pz: 0
                    };

                    ['px', 'py', 'pz'].forEach(key => {
                        if (typeof selfWeightLoad[key] === 'number') {
                            target[key] = (target[key] || 0) + selfWeightLoad[key];
                        }
                    });
                    target.isFromSelfWeight = true;

                    if (!existingLoad) {
                        combinedNodeLoads.push(target);
                    }

                    const logLabel = is2DFrame ? 'Py' : 'Pz';
                    const logValue = is2DFrame ? (target.py || 0) : (target.pz || 0);
                    console.log(`  節点${target.nodeIndex + 1}: ${logLabel}=${logValue.toFixed(4)}kN (追加自重)`);
                });
            }
            
            // 🔧 自由度の決定：2Dなら3自由度/節点、3Dなら6自由度/節点
            const dofPerNode = is2DFrame ? 3 : 6;
            const dof = nodes.length * dofPerNode;
            
            // 🔧 3D構造の場合、各部材に3D用の変換マトリックスと剛性マトリックスを設定
            if (!is2DFrame) {
                members.forEach((member, idx) => {
                    const ni = nodes[member.i];
                    const nj = nodes[member.j];
                    const dx = nj.x - ni.x;
                    const dy = nj.y - ni.y;
                    const dz = nj.z - ni.z;
                    const L = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    
                    if (L === 0) {
                        throw new Error(`部材 ${idx+1} の長さが0です`);
                    }
                    
                    // 局所座標系: x'軸を部材軸方向とする
                    const cx = dx / L;
                    const cy = dy / L;
                    const cz = dz / L;
                    
                    // y'軸とz'軸の決定（簡易的に、部材がほぼ垂直でない場合はZ軸を基準）
                    let v_y, v_z;
                    if (Math.abs(cz) < 0.9) {
                        // 部材が垂直でない場合、z'軸を水平面に投影した方向を基準
                        const temp = Math.sqrt(cx*cx + cy*cy);
                        v_z = { x: -cz*cx/temp, y: -cz*cy/temp, z: temp };
                        const len_vz = Math.sqrt(v_z.x*v_z.x + v_z.y*v_z.y + v_z.z*v_z.z);
                        v_z = { x: v_z.x/len_vz, y: v_z.y/len_vz, z: v_z.z/len_vz };
                        
                        // y'軸 = z'軸 × x'軸
                        v_y = {
                            x: v_z.y*cz - v_z.z*cy,
                            y: v_z.z*cx - v_z.x*cz,
                            z: v_z.x*cy - v_z.y*cx
                        };
                    } else {
                        // 部材がほぼ垂直の場合、Y軸を基準
                        v_y = { x: 0, y: 1, z: 0 };
                        v_z = {
                            x: cy*0 - cz*1,
                            y: cz*0 - cx*0,
                            z: cx*1 - cy*0
                        };
                        const len_vz = Math.sqrt(v_z.x*v_z.x + v_z.y*v_z.y + v_z.z*v_z.z);
                        if (len_vz > 1e-6) {
                            v_z = { x: v_z.x/len_vz, y: v_z.y/len_vz, z: v_z.z/len_vz };
                        }
                    }
                    
                    // 3D変換マトリックス（12×12）
                    const R = [
                        [cx, cy, cz, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        [v_y.x, v_y.y, v_y.z, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        [v_z.x, v_z.y, v_z.z, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, cx, cy, cz, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, v_y.x, v_y.y, v_y.z, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, v_z.x, v_z.y, v_z.z, 0, 0, 0, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, cx, cy, cz, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, v_y.x, v_y.y, v_y.z, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, v_z.x, v_z.y, v_z.z, 0, 0, 0],
                        [0, 0, 0, 0, 0, 0, 0, 0, 0, cx, cy, cz],
                        [0, 0, 0, 0, 0, 0, 0, 0, 0, v_y.x, v_y.y, v_y.z],
                        [0, 0, 0, 0, 0, 0, 0, 0, 0, v_z.x, v_z.y, v_z.z]
                    ];
                    
                    member.T3D = R;
                    member.length = L;
                    
                    // 3D局所剛性マトリックス（12×12）
                    const E = member.E;
                    const G = E / (2 * (1 + 0.3)); // ポアソン比0.3を仮定
                    const A = member.A;
                    const axisProps3D = member.axisProperties || null;
                    const Iy = axisProps3D?.local?.inertia?.y ?? member.Iy;
                    const Iz = axisProps3D?.local?.inertia?.z ?? member.Iz;
                    const J = member.J;
                    
                    const EA_L = E * A / L;
                    const GJ_L = G * J / L;
                    const EIy_L3 = 12 * E * Iy / (L*L*L);
                    const EIy_L2 = 6 * E * Iy / (L*L);
                    const EIy_L = 4 * E * Iy / L;
                    const EIy_L_half = 2 * E * Iy / L;
                    const EIz_L3 = 12 * E * Iz / (L*L*L);
                    const EIz_L2 = 6 * E * Iz / (L*L);
                    const EIz_L = 4 * E * Iz / L;
                    const EIz_L_half = 2 * E * Iz / L;
                    
                    // 簡易的な剛接合の剛性マトリックス（ピン・ローラー接合は後で対応）
                    const k_local_3d = [
                        [EA_L, 0, 0, 0, 0, 0, -EA_L, 0, 0, 0, 0, 0],
                        [0, EIz_L3, 0, 0, 0, EIz_L2, 0, -EIz_L3, 0, 0, 0, EIz_L2],
                        [0, 0, EIy_L3, 0, -EIy_L2, 0, 0, 0, -EIy_L3, 0, -EIy_L2, 0],
                        [0, 0, 0, GJ_L, 0, 0, 0, 0, 0, -GJ_L, 0, 0],
                        [0, 0, -EIy_L2, 0, EIy_L, 0, 0, 0, EIy_L2, 0, EIy_L_half, 0],
                        [0, EIz_L2, 0, 0, 0, EIz_L, 0, -EIz_L2, 0, 0, 0, EIz_L_half],
                        [-EA_L, 0, 0, 0, 0, 0, EA_L, 0, 0, 0, 0, 0],
                        [0, -EIz_L3, 0, 0, 0, -EIz_L2, 0, EIz_L3, 0, 0, 0, -EIz_L2],
                        [0, 0, -EIy_L3, 0, EIy_L2, 0, 0, 0, EIy_L3, 0, EIy_L2, 0],
                        [0, 0, 0, -GJ_L, 0, 0, 0, 0, 0, GJ_L, 0, 0],
                        [0, 0, -EIy_L2, 0, EIy_L_half, 0, 0, 0, EIy_L2, 0, EIy_L, 0],
                        [0, EIz_L2, 0, 0, 0, EIz_L_half, 0, -EIz_L2, 0, 0, 0, EIz_L]
                    ];

                    const globalIndexMap = [
                        member.i * 6,
                        member.i * 6 + 1,
                        member.i * 6 + 2,
                        member.i * 6 + 3,
                        member.i * 6 + 4,
                        member.i * 6 + 5,
                        member.j * 6,
                        member.j * 6 + 1,
                        member.j * 6 + 2,
                        member.j * 6 + 3,
                        member.j * 6 + 4,
                        member.j * 6 + 5
                    ];

                    const releaseData = build3DReleaseData(k_local_3d, R, globalIndexMap, member.i_conn, member.j_conn, mat);

                    member.k_local_3d = k_local_3d;
                    member.k_local_active = releaseData.k_local_active;
                    member.T_active = releaseData.T_active;
                    member.activeLocalIndices = releaseData.activeLocalIndices;
                    member.releaseLocalIndices = releaseData.releaseLocalIndices;
                    member.release3D = releaseData;
                    member.globalIndexMap = globalIndexMap;
                });
            }
            let K_global = mat.create(dof, dof);
            let F_global = mat.create(dof, 1);
            const fixedEndForces = {};

            const axisKeyMap2D = ['x', 'y', 'rz'];
            const axisKeyMap3D = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
            const addForceWithSignFlip = (globalIndex, value) => {
                if (!Number.isFinite(value) || Math.abs(value) < 1e-12) {
                    return;
                }
                const axisKey = is2DFrame ? axisKeyMap2D[globalIndex % 3] : axisKeyMap3D[globalIndex % 6];
                let multiplier = 1;
                if (axisKey === 'x' || axisKey === 'y' || axisKey === 'z') {
                    multiplier = loadCalcMultipliers[axisKey] ?? 1;
                }
                if (multiplier === 0) {
                    return;
                }
                F_global[globalIndex][0] += value * multiplier;
            };
            
            // 同一部材の荷重を合計して重複を防ぐ (3D対応: wy, wz別々に管理)
            const memberLoadMap = new Map();
            combinedMemberLoads.forEach(load => {
                const memberIndex = load.memberIndex;
                if (memberLoadMap.has(memberIndex)) {
                    const existing = memberLoadMap.get(memberIndex);
                    existing.wy = (existing.wy || 0) + (load.wy || 0);
                    existing.wz = (existing.wz || 0) + (load.wz || 0);
                    existing.w = (existing.w || 0) + (load.w || 0);
                    if (load.global) {
                        if (!existing.global) {
                            existing.global = { wx: 0, wy: 0, wz: 0 };
                        }
                        existing.global.wx += load.global.wx || 0;
                        existing.global.wy += load.global.wy || 0;
                        existing.global.wz += load.global.wz || 0;
                    }
                    if (load.isFromSelfWeight) {
                        existing.isFromSelfWeight = true;
                    }
                    if (load.isFromUserInput) {
                        existing.isFromUserInput = true;
                    }
                } else {
                    memberLoadMap.set(memberIndex, {
                        memberIndex,
                        wy: load.wy || 0,
                        wz: load.wz || 0,
                        w: load.w || 0,
                        global: load.global ? {
                            wx: load.global.wx || 0,
                            wy: load.global.wy || 0,
                            wz: load.global.wz || 0
                        } : null,
                        isFromSelfWeight: !!load.isFromSelfWeight,
                        isFromUserInput: !!load.isFromUserInput
                    });
                }
            });
            
            // デバッグログ：合計された荷重を確認
            if (!window.mergedLoadLogCount) window.mergedLoadLogCount = 0;
            if (window.mergedLoadLogCount === 0) {
                console.log('=== 合計された部材荷重 ===');
                memberLoadMap.forEach((load, memberIndex) => {
                    const wyStr = load.wy !== undefined ? `wy=${load.wy.toFixed(4)}` : `w=${(load.w || 0).toFixed(4)}`;
                    const wzStr = load.wz !== undefined ? `, wz=${load.wz.toFixed(4)}` : '';
                    console.log(`部材${memberIndex + 1}: ${wyStr}${wzStr}kN/m`);
                });
                console.log('========================');
                window.mergedLoadLogCount = 1;
            }
            
            // 合計された荷重で固定端力を計算 (3D対応)
            memberLoadMap.forEach(load => {
                const member = members[load.memberIndex];
                const L = member.length;
                const wy = load.wy !== undefined ? load.wy : (load.w || 0);
                const wz = load.wz || 0;
                let fel;

                if (is2DFrame) {
                    // 2D: 6要素の固定端力ベクトル (3自由度×2節点)
                    // 注意: 固定端力は荷重と逆向き（下向き荷重→上向き拘束力）
                    // しかし、等価節点荷重として扱うため、さらに符号反転が必要
                    // 結果として、wyと同じ符号の固定端力を使用
                    if (member.i_conn === 'rigid' && member.j_conn === 'rigid') {
                        fel = [0, -wy*L/2, -wy*L**2/12, 0, -wy*L/2, wy*L**2/12];
                    }
                    else if (member.i_conn === 'pinned' && member.j_conn === 'rigid') {
                        fel = [0, -3*wy*L/8, 0, 0, -5*wy*L/8, wy*L**2/8];
                    }
                    else if (member.i_conn === 'rigid' && member.j_conn === 'pinned') {
                        fel = [0, -5*wy*L/8, -wy*L**2/8, 0, -3*wy*L/8, 0];
                    }
                    else {
                        fel = [0, -wy*L/2, 0, 0, -wy*L/2, 0];
                    }
                    const T_t = mat.transpose(member.T);
                    const feg = mat.multiply(T_t, fel.map(v => [v]));
                    const i = member.i;
                    const j = member.j;
                    addForceWithSignFlip(i*3, -feg[0][0]);
                    addForceWithSignFlip(i*3+1, -feg[1][0]);
                    F_global[i*3+2][0] -= feg[2][0];
                    addForceWithSignFlip(j*3, -feg[3][0]);
                    addForceWithSignFlip(j*3+1, -feg[4][0]);
                    F_global[j*3+2][0] -= feg[5][0];
                    fixedEndForces[load.memberIndex] = fel;
                } else {
                    // 3D: 12要素の固定端力ベクトル (6自由度×2節点)
                    // fel = [Fx_i, Fy_i, Fz_i, Mx_i, My_i, Mz_i, Fx_j, Fy_j, Fz_j, Mx_j, My_j, Mz_j]
                    if (member.i_conn === 'rigid' && member.j_conn === 'rigid') {
                        fel = [0, -wy*L/2, -wz*L/2, 0, wz*L**2/12, -wy*L**2/12, 0, -wy*L/2, -wz*L/2, 0, -wz*L**2/12, wy*L**2/12];
                    }
                    else if (member.i_conn === 'pinned' && member.j_conn === 'rigid') {
                        fel = [0, -3*wy*L/8, -3*wz*L/8, 0, 0, 0, 0, -5*wy*L/8, -5*wz*L/8, 0, wz*L**2/8, wy*L**2/8];
                    }
                    else if (member.i_conn === 'rigid' && member.j_conn === 'pinned') {
                        fel = [0, -5*wy*L/8, -5*wz*L/8, 0, wz*L**2/8, -wy*L**2/8, 0, -3*wy*L/8, -3*wz*L/8, 0, 0, 0];
                    }
                    else {
                        fel = [0, -wy*L/2, -wz*L/2, 0, 0, 0, 0, -wy*L/2, -wz*L/2, 0, 0, 0];
                    }

                    const releaseInfo = member.release3D;
                    if (releaseInfo?.releaseLocalIndices?.length) {
                        releaseInfo.releaseLocalIndices.forEach(idx => {
                            fel[idx] = 0;
                        });
                    }

                    const T_forLoads = releaseInfo?.T_active || member.T3D;
                    const activeLocalIndices = releaseInfo?.activeLocalIndices || Array.from({ length: 12 }, (_, idx) => idx);
                    const felActiveVector = activeLocalIndices.map(idx => fel[idx]).map(v => [v]);
                    const feg = mat.multiply(mat.transpose(T_forLoads), felActiveVector);

                    const i = member.i;
                    const j = member.j;
                    addForceWithSignFlip(i*6, -feg[0][0]);
                    addForceWithSignFlip(i*6+1, -feg[1][0]);
                    F_global[i*6+2][0] -= feg[2][0];
                    F_global[i*6+3][0] -= feg[3][0];
                    F_global[i*6+4][0] -= feg[4][0];
                    F_global[i*6+5][0] -= feg[5][0];
                    addForceWithSignFlip(j*6, -feg[6][0]);
                    addForceWithSignFlip(j*6+1, -feg[7][0]);
                    F_global[j*6+2][0] -= feg[8][0];
                    F_global[j*6+3][0] -= feg[9][0];
                    F_global[j*6+4][0] -= feg[10][0];
                    F_global[j*6+5][0] -= feg[11][0];
                    fixedEndForces[load.memberIndex] = fel;
                }
            });
            
            // 節点荷重を設定（2D/3Dで処理を分ける）
            if (is2DFrame) {
                combinedNodeLoads.forEach(load => { 
                    const base = load.nodeIndex * 3; 
                    addForceWithSignFlip(base, load.px || 0); 
                    addForceWithSignFlip(base + 1, load.py || 0); 
                    F_global[base + 2][0] += (load.mz || 0);
                });
            } else {
                // 3D: 6自由度
                combinedNodeLoads.forEach(load => { 
                    const base = load.nodeIndex * 6; 
                    addForceWithSignFlip(base, load.px || 0); 
                    addForceWithSignFlip(base + 1, load.py || 0); 
                    const pzContribution = (load.pz || 0) * (loadCalcMultipliers.z ?? 1);
                    F_global[base + 2][0] += pzContribution; 
                    F_global[base + 3][0] += (load.mx || 0);
                    F_global[base + 4][0] += (load.my || 0);
                    F_global[base + 5][0] += (load.mz || 0);
                });
            }
            
            // 全体剛性マトリックスの組み立て（2D/3Dで処理を分ける）
            if (is2DFrame) {
                members.forEach((member) => {
                    const {k_local, T, i, j} = member;
                    const T_t = mat.transpose(T), k_global_member = mat.multiply(mat.multiply(T_t, k_local), T);
                    const indices = [i*3, i*3+1, i*3+2, j*3, j*3+1, j*3+2];
                    for (let row = 0; row < 6; row++) {
                        for (let col = 0; col < 6; col++) {
                            K_global[indices[row]][indices[col]] += k_global_member[row][col];
                        }
                    }
                });
            } else {
                // 3D解析
                members.forEach((member) => {
                    const T_use = member.T_active || member.T3D;
                    const k_local_use = member.k_local_active || member.k_local_3d;
                    const indices = member.globalIndexMap || [
                        member.i * 6, member.i * 6 + 1, member.i * 6 + 2,
                        member.i * 6 + 3, member.i * 6 + 4, member.i * 6 + 5,
                        member.j * 6, member.j * 6 + 1, member.j * 6 + 2,
                        member.j * 6 + 3, member.j * 6 + 4, member.j * 6 + 5
                    ];

                    const T_t = mat.transpose(T_use);
                    const k_global_member = mat.multiply(mat.multiply(T_t, k_local_use), T_use);

                    for (let row = 0; row < 12; row++) {
                        const globalRow = indices[row];
                        if (globalRow === null || globalRow === undefined) continue;
                        for (let col = 0; col < 12; col++) {
                            const globalCol = indices[col];
                            if (globalCol === null || globalCol === undefined) continue;
                            K_global[globalRow][globalCol] += k_global_member[row][col];
                        }
                    }
                });
            }
            const excludedDOFs = new Set();
            if (!is2DFrame) {
                const tolerance = 1e-9;
                for (let r = 0; r < dof; r++) {
                    let maxMagnitude = 0;
                    for (let c = 0; c < dof; c++) {
                        const val = K_global[r][c];
                        if (Math.abs(val) > maxMagnitude) {
                            maxMagnitude = Math.abs(val);
                            if (maxMagnitude > tolerance) break;
                        }
                    }
                    if (maxMagnitude <= tolerance && Math.abs(F_global[r][0]) <= tolerance) {
                        excludedDOFs.add(r);
                        F_global[r][0] = 0;
                    }
                }
            }

            // ==========================================================
            // 強制変位を考慮した解析ロジック（自由節点も対応）
            // ==========================================================

            // 1. 物理的な支点による拘束自由度を定義（2D/3Dで処理を分ける）
            const support_constraints = new Set();
            const registerConstraint = (index) => {
                if (index >= 0 && index < dof && !excludedDOFs.has(index)) {
                    support_constraints.add(index);
                }
            };

            nodes.forEach((node, i) => {
                const supportType = normalizeSupportValue(node.support);
                
                if (is2DFrame) {
                    // 2D解析: 3自由度 (dx, dy, θz)
                    if (supportType === 'fixed') {
                        registerConstraint(i * 3);
                        registerConstraint(i * 3 + 1);
                        registerConstraint(i * 3 + 2);
                    } else if (supportType === 'pinned') {
                        registerConstraint(i * 3);
                        registerConstraint(i * 3 + 1);
                    } else if (supportType === 'roller-x') {
                        registerConstraint(i * 3);
                    } else if (supportType === 'roller-y' || supportType === 'roller-z') {
                        registerConstraint(i * 3 + 1);
                    }
                } else {
                    // 3D解析: 6自由度 (dx, dy, dz, θx, θy, θz)
                    if (supportType === 'fixed') {
                        // 完全固定: 全6自由度を拘束
                        registerConstraint(i * 6);
                        registerConstraint(i * 6 + 1);
                        registerConstraint(i * 6 + 2);
                        registerConstraint(i * 6 + 3);
                        registerConstraint(i * 6 + 4);
                        registerConstraint(i * 6 + 5);
                    } else if (supportType === 'pinned') {
                        // ピン: 移動3自由度を拘束、回転自由
                        registerConstraint(i * 6);
                        registerConstraint(i * 6 + 1);
                        registerConstraint(i * 6 + 2);
                    } else if (isRollerSupport(supportType)) {
                        const axis = getRollerAxis(supportType) || 'y';
                        const axisIndexMap = { x: 0, y: 1, z: 2 };
                        const offset = axisIndexMap[axis];
                        if (offset !== undefined) {
                            registerConstraint(i * 6 + offset);
                        }
                    }
                }
            });

            // 2. 強制変位が与えられた自由度を特定し、既知変位ベクトルD_sを作成
            const D_s = mat.create(dof, 1);
            const forced_disp_constraints = new Set();
            const assignForcedDisplacement = (index, value) => {
                if (!Number.isFinite(value) || value === 0) return;
                if (excludedDOFs.has(index)) {
                    console.warn('強制変位が解放自由度に指定されました', { index, value });
                    return;
                }
                D_s[index][0] = value;
                forced_disp_constraints.add(index);
            };
            
            if (is2DFrame) {
                // 2D: dx, dy
                nodes.forEach((node, i) => {
                    if (node.dx_forced !== undefined && node.dx_forced !== null && node.dx_forced !== 0) {
                        assignForcedDisplacement(i * 3, node.dx_forced);
                    }
                    if (node.dy_forced !== undefined && node.dy_forced !== null && node.dy_forced !== 0) {
                        assignForcedDisplacement(i * 3 + 1, node.dy_forced);
                    }
                });
            } else {
                // 3D: dx, dy, dz
                nodes.forEach((node, i) => {
                    if (node.dx_forced !== undefined && node.dx_forced !== null && node.dx_forced !== 0) {
                        assignForcedDisplacement(i * 6, node.dx_forced);
                    }
                    if (node.dy_forced !== undefined && node.dy_forced !== null && node.dy_forced !== 0) {
                        assignForcedDisplacement(i * 6 + 1, node.dy_forced);
                    }
                    if (node.dz_forced !== undefined && node.dz_forced !== null && node.dz_forced !== 0) {
                        assignForcedDisplacement(i * 6 + 2, node.dz_forced);
                    }
                });
            }
            
            // 3. 物理支点と強制変位を合算し、最終的な「拘束自由度」と「自由度」を決定
            const constrained_indices_set = new Set([...support_constraints, ...forced_disp_constraints]);
            const constrained_indices = Array.from(constrained_indices_set)
                .filter(index => !excludedDOFs.has(index))
                .sort((a, b) => a - b);
            const free_indices = [...Array(dof).keys()].filter(i => !constrained_indices_set.has(i) && !excludedDOFs.has(i));

            if (free_indices.length === 0) { // 完全拘束モデルの場合
                const D_global = D_s;
                const R = mat.subtract(mat.multiply(K_global, D_global), F_global);
                
                // 部材断面力の計算（2D/3Dで処理を分ける）
                const memberForces = members.map((member, idx) => {
                    // 部材に作用する荷重を取得
                    const memberLoad = memberLoadMap.get(idx);
                    const wy = memberLoad ? (memberLoad.wy !== undefined ? memberLoad.wy : (memberLoad.w || 0)) : 0;
                    const wz = memberLoad ? (memberLoad.wz || 0) : 0;

                    if (is2DFrame) {
                        // 2D解析
                        const { T, k_local, i, j } = member;
                        const d_global_member = [ ...D_global.slice(i * 3, i * 3 + 3), ...D_global.slice(j * 3, j * 3 + 3) ];
                        const d_local = mat.multiply(T, d_global_member);
                        let f_local = mat.multiply(k_local, d_local);
                        if(fixedEndForces[idx]) {
                            const fel_mat = fixedEndForces[idx].map(v=>[v]);
                            f_local = mat.add(f_local, fel_mat);
                        }
                        return {
                            N_i: f_local[0][0],
                            Q_i: f_local[1][0],
                            M_i: f_local[2][0],
                            N_j: f_local[3][0],
                            Q_j: f_local[4][0],
                            M_j: f_local[5][0],
                            w: wy  // 等分布荷重を追加
                        };
                    } else {
                        // 3D解析
                        const { i, j } = member;
                        const d_global_member = [
                            D_global[i*6][0], D_global[i*6+1][0], D_global[i*6+2][0],
                            D_global[i*6+3][0], D_global[i*6+4][0], D_global[i*6+5][0],
                            D_global[j*6][0], D_global[j*6+1][0], D_global[j*6+2][0],
                            D_global[j*6+3][0], D_global[j*6+4][0], D_global[j*6+5][0]
                        ].map(v => [v]);

                        const releaseInfo = member.release3D;
                        const T_use = member.T_active || member.T3D;
                        const k_local_use = member.k_local_active || member.k_local_3d;
                        const d_local_active = mat.multiply(T_use, d_global_member);

                        let d_local_full;
                        if (releaseInfo?.usedCondensation) {
                            d_local_full = Array.from({ length: 12 }, () => [0]);
                            releaseInfo.activeLocalIndices.forEach((localIdx, pos) => {
                                d_local_full[localIdx][0] = d_local_active[pos][0];
                            });
                            if (releaseInfo.releaseLocalIndices.length > 0) {
                                const temp = mat.multiply(releaseInfo.K_ra, d_local_active);
                                const d_released = mat.multiply(releaseInfo.K_rr_inv, temp);
                                releaseInfo.releaseLocalIndices.forEach((localIdx, pos) => {
                                    d_local_full[localIdx][0] = -d_released[pos][0];
                                });
                            }
                        } else {
                            d_local_full = d_local_active;
                        }

                        const k_for_force = (releaseInfo && !releaseInfo.usedCondensation)
                            ? (member.k_local_active || member.k_local_3d)
                            : member.k_local_3d;

                        let f_local = mat.multiply(k_for_force, d_local_full);

                        if (fixedEndForces[idx]) {
                            const fel_mat = fixedEndForces[idx].map(v => [v]);
                            f_local = mat.add(f_local, fel_mat);
                        }

                        return {
                            N_i: f_local[0][0],
                            Qy_i: f_local[1][0],
                            Qz_i: f_local[2][0],
                            Mx_i: f_local[3][0],
                            My_i: f_local[4][0],
                            Mz_i: f_local[5][0],
                            N_j: f_local[6][0],
                            Qy_j: f_local[7][0],
                            Qz_j: f_local[8][0],
                            Mx_j: f_local[9][0],
                            My_j: f_local[10][0],
                            Mz_j: f_local[11][0],
                            // 2D互換性のため
                            Q_i: f_local[2][0],
                            M_i: f_local[4][0],
                            Q_j: f_local[8][0],
                            M_j: f_local[10][0],
                            w: wy,   // 等分布荷重Y方向を追加
                            wz: wz   // 等分布荷重Z方向を追加
                        };
                    }
                });
                displayResults(D_global, R, memberForces, nodes, members, nodeLoads, memberLoads);
                return;
            }

            // 3. 行列を分割 (K_ff, K_fs, K_sf, K_ss)
            const K_ff = free_indices.map(r => free_indices.map(c => K_global[r][c]));
            const K_fs = free_indices.map(r => constrained_indices.map(c => K_global[r][c]));
            const K_sf = constrained_indices.map(r => free_indices.map(c => K_global[r][c]));
            const K_ss = constrained_indices.map(r => constrained_indices.map(c => K_global[r][c]));

            // 4. ベクトルを分割
            const F_f = free_indices.map(idx => [F_global[idx][0]]);
            const F_s = constrained_indices.map(idx => [F_global[idx][0]]);
            const D_s_constrained = constrained_indices.map(idx => [D_s[idx][0]]);

            // 5. 強制変位による等価節点力を計算し、荷重ベクトルを修正
            // F_modified = F_f - K_fs * D_s_constrained
            const Kfs_Ds = mat.multiply(K_fs, D_s_constrained);
            const F_modified = mat.subtract(F_f, Kfs_Ds);

            // 6. 未知変位 D_f を解く
            const D_f = mat.solve(K_ff, F_modified);
            if (!D_f) {
                const instabilityAnalysis = analyzeInstability(K_global, free_indices, nodes, members, is2DFrame);
                throw new Error(`解を求めることができませんでした。構造が不安定であるか、拘束が不適切である可能性があります。\n${instabilityAnalysis.message}`);
            }

            // 7. 全体変位ベクトル D_global を組み立てる
            const D_global = mat.create(dof, 1);
            free_indices.forEach((val, i) => { D_global[val][0] = D_f[i][0]; });
            constrained_indices.forEach((val, i) => { D_global[val][0] = D_s_constrained[i][0]; });

            // 8. 反力 R を計算
            // R = K_sf * D_f + K_ss * D_s_constrained - F_s
            const Ksf_Df = mat.multiply(K_sf, D_f);
            const Kss_Ds = mat.multiply(K_ss, D_s_constrained);
            let R_constrained = mat.add(Ksf_Df, Kss_Ds);
            R_constrained = mat.subtract(R_constrained, F_s);

            const R = mat.create(dof, 1);
            constrained_indices.forEach((val, i) => { R[val][0] = R_constrained[i][0]; });

            // ==========================================================
            // 部材断面力の計算（2D/3Dで処理を分ける）
            // ==========================================================
            const memberForces = members.map((member, idx) => {
                // 部材に作用する荷重を取得
                const memberLoad = memberLoadMap.get(idx);
                const wy = memberLoad ? (memberLoad.wy !== undefined ? memberLoad.wy : (memberLoad.w || 0)) : 0;
                const wz = memberLoad ? (memberLoad.wz || 0) : 0;

                if (is2DFrame) {
                    // 2D解析
                    const { T, k_local, i, j } = member;
                    const d_global_member = [ ...D_global.slice(i * 3, i * 3 + 3), ...D_global.slice(j * 3, j * 3 + 3) ];
                    const d_local = mat.multiply(T, d_global_member);
                    let f_local = mat.multiply(k_local, d_local);
                    if(fixedEndForces[idx]) {
                        const fel_mat = fixedEndForces[idx].map(v=>[v]);
                        f_local = mat.add(f_local, fel_mat);
                    }
                    return {
                        N_i: f_local[0][0],
                        Q_i: f_local[1][0],
                        M_i: f_local[2][0],
                        N_j: f_local[3][0],
                        Q_j: f_local[4][0],
                        M_j: f_local[5][0],
                        w: wy  // 等分布荷重を追加
                    };
                } else {
                    // 3D解析
                    const { i, j } = member;
                    const d_global_member = [
                        D_global[i*6][0], D_global[i*6+1][0], D_global[i*6+2][0],
                        D_global[i*6+3][0], D_global[i*6+4][0], D_global[i*6+5][0],
                        D_global[j*6][0], D_global[j*6+1][0], D_global[j*6+2][0],
                        D_global[j*6+3][0], D_global[j*6+4][0], D_global[j*6+5][0]
                    ].map(v => [v]);

                    const releaseInfo = member.release3D;
                    const T_use = member.T_active || member.T3D;
                    const d_local_active = mat.multiply(T_use, d_global_member);

                    let d_local_full;
                    if (releaseInfo?.usedCondensation) {
                        d_local_full = Array.from({ length: 12 }, () => [0]);
                        releaseInfo.activeLocalIndices.forEach((localIdx, pos) => {
                            d_local_full[localIdx][0] = d_local_active[pos][0];
                        });
                        if (releaseInfo.releaseLocalIndices.length > 0) {
                            const temp = mat.multiply(releaseInfo.K_ra, d_local_active);
                            const d_released = mat.multiply(releaseInfo.K_rr_inv, temp);
                            releaseInfo.releaseLocalIndices.forEach((localIdx, pos) => {
                                d_local_full[localIdx][0] = -d_released[pos][0];
                            });
                        }
                    } else {
                        d_local_full = d_local_active;
                    }

                    const k_for_force = (releaseInfo && !releaseInfo.usedCondensation)
                        ? (member.k_local_active || member.k_local_3d)
                        : member.k_local_3d;

                    let f_local = mat.multiply(k_for_force, d_local_full);

                    if (fixedEndForces[idx]) {
                        const fel_mat = fixedEndForces[idx].map(v => [v]);
                        f_local = mat.add(f_local, fel_mat);
                    }

                    // 3D断面力の全成分を保存
                    // f_local: [Fx_i, Fy_i, Fz_i, Mx_i, My_i, Mz_i, Fx_j, Fy_j, Fz_j, Mx_j, My_j, Mz_j]
                    return {
                        N_i: f_local[0][0],    // 軸力（X方向）
                        Qy_i: f_local[1][0],   // せん断力（Y方向）
                        Qz_i: f_local[2][0],   // せん断力（Z方向）
                        Mx_i: f_local[3][0],   // ねじりモーメント（X軸周り）
                        My_i: f_local[4][0],   // 曲げモーメント（Y軸周り）
                        Mz_i: f_local[5][0],   // 曲げモーメント（Z軸周り）
                        N_j: f_local[6][0],    // 軸力（X方向）
                        Qy_j: f_local[7][0],   // せん断力（Y方向）
                        Qz_j: f_local[8][0],   // せん断力（Z方向）
                        Mx_j: f_local[9][0],   // ねじりモーメント（X軸周り）
                        My_j: f_local[10][0],  // 曲げモーメント（Y軸周り）
                        Mz_j: f_local[11][0],  // 曲げモーメント（Z軸周り）
                        // 2D互換性のため
                        Q_i: f_local[2][0],    // デフォルトはZ方向
                        M_i: f_local[4][0],    // デフォルトはY軸周り
                        Q_j: f_local[8][0],    // デフォルトはZ方向
                        M_j: f_local[10][0],   // デフォルトはY軸周り
                        w: wy,                 // 等分布荷重Y方向を追加
                        wz: wz                 // 等分布荷重Z方向を追加
                    };
                }
            });
            
            // 計算成功時は不安定性ハイライトをクリア
            clearInstabilityHighlight();
            
            // 解析結果をグローバルに保存（応力度コンター図用）
            window.lastAnalysisResults = {
                displacements: D_global,
                reactions: R,
                forces: memberForces,
                nodes: nodes,
                members: members
            };
            
            // 合計された部材荷重を配列に変換
            const finalMemberLoads = Array.from(memberLoadMap.values());
            
            displayResults(D_global, R, memberForces, nodes, members, combinedNodeLoads, finalMemberLoads);
        } catch (error) {
            // elements が初期化されているかチェック
            if (elements && elements.errorMessage) {
                elements.errorMessage.textContent = `エラー: ${error.message}`;
                elements.errorMessage.style.display = 'block';
            } else {
                console.error('❌ elements.errorMessage が利用できません');
                alert(`エラー: ${error.message}`);
            }
            console.error(error);
            
            // 不安定要素をハイライト表示
            if (typeof drawOnCanvas === 'function') {
                drawOnCanvas();
            }
        }
    };
    
    const clearRowValidationState = (row) => {
        if (!row) return;
        row.classList.remove('input-error');
        delete row.dataset.validationError;
        const controls = row.querySelectorAll('input, select, textarea');
        controls.forEach(control => {
            control.classList.remove('input-error-field');
            control.removeAttribute('data-validation-message');
            control.removeAttribute('aria-invalid');
        });
    };

    const markRowValidationError = (row, message) => {
        if (!row) return;
        row.classList.add('input-error');
        row.dataset.validationError = message;
        const controls = row.querySelectorAll('input, select, textarea');
        controls.forEach(control => {
            control.classList.add('input-error-field');
            control.setAttribute('data-validation-message', message);
            control.setAttribute('aria-invalid', 'true');
        });
        if (elements && elements.errorMessage) {
            elements.errorMessage.textContent = `エラー: ${message}`;
            elements.errorMessage.style.display = 'block';
        }
    };

    const getNodePopupField = (id, { required = true } = {}) => {
        const element = document.getElementById(id);
        if (!element && required) {
            const message = `節点プロパティポップアップの要素 '${id}' が見つかりません。`;
            console.error(`❌ ${message}`);
            if (elements && elements.errorMessage) {
                elements.errorMessage.textContent = `エラー: ${message}`;
                elements.errorMessage.style.display = 'block';
            }
        }
        return element || null;
    };

    // 2Dフレーム(6x6)用: 端部条件（剛/ピン/バネ）を柔度で合成し、局所剛性を生成（2D側ロジック移植）
    function compute2DLocalStiffnessWithEndSprings({ E, A, I, L, i_conn, j_conn, spring_i, spring_j }) {
        const zero6 = () => Array.from({ length: 6 }, () => Array(6).fill(0));
        const invert3x3 = (m) => {
            const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
                        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
            if (Math.abs(det) < 1e-30) return null;
            const invDet = 1 / det;
            return [
                [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) * invDet, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet],
                [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invDet],
                [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) * invDet, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * invDet, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invDet]
            ];
        };
        const getFlexibility = (connType, springData) => {
            if (connType === 'rigid') return [0, 0, 0];
            if (connType === 'pinned') return [0, 0, 1e9];
            if (connType === 'spring' && springData) {
                let fx = 1e9;
                if (springData.rigidKx) fx = 0;
                else if (springData.Kx && springData.Kx > 1e-12) fx = 1 / springData.Kx;

                let fy = 1e9;
                if (springData.rigidKy) fy = 0;
                else if (springData.Ky && springData.Ky > 1e-12) fy = 1 / springData.Ky;

                let fr = 1e9;
                if (springData.rigidKr) fr = 0;
                else if (springData.Kr && springData.Kr > 1e-12) fr = 1 / springData.Kr;

                return [fx, fy, fr];
            }
            return [0, 0, 0];
        };

        if (!(L > 0) || !(E > 0) || !(A > 0) || !(I > 0)) return zero6();

        // ティモシェンコ梁: せん断変形（2Dと同等）
        const nu = 0.3;
        const G = E / (2 * (1 + nu));
        const kappa = 1.5;
        const As = A / kappa;
        const shear_flex = (G > 0 && As > 0) ? (L / (G * As)) : 0;

        const EI = E * I;
        const EA = E * A;
        const L2 = L * L;
        const L3 = L2 * L;

        const f_beam = [
            [L / EA, 0, 0],
            [0, L3 / (3 * EI) + shear_flex, L2 / (2 * EI)],
            [0, L2 / (2 * EI), L / EI]
        ];

        const f_spring_i = getFlexibility(i_conn, spring_i);
        const f_spring_j = getFlexibility(j_conn, spring_j);

        const B = [
            [-1, 0, 0],
            [0, -1, 0],
            [0, -L, -1]
        ];

        const f_total = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                let val = f_beam[r][c] || 0;
                if (r === c) val += (f_spring_j[r] || 0);
                for (let k = 0; k < 3; k++) {
                    val += (B[k][r] || 0) * (f_spring_i[k] || 0) * (B[k][c] || 0);
                }
                f_total[r][c] = val;
            }
        }

        const K_jj = invert3x3(f_total);
        if (!K_jj) return zero6();

        const K_ij = Array.from({ length: 3 }, () => Array(3).fill(0));
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let k = 0; k < 3; k++) sum += B[r][k] * K_jj[k][c];
                K_ij[r][c] = sum;
            }
        }
        const K_ji = K_ij[0].map((_, col) => K_ij.map(row => row[col]));
        const K_ii = Array.from({ length: 3 }, () => Array(3).fill(0));
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let k = 0; k < 3; k++) sum += B[r][k] * K_ji[k][c];
                K_ii[r][c] = sum;
            }
        }

        return [
            [K_ii[0][0], K_ii[0][1], K_ii[0][2], K_ij[0][0], K_ij[0][1], K_ij[0][2]],
            [K_ii[1][0], K_ii[1][1], K_ii[1][2], K_ij[1][0], K_ij[1][1], K_ij[1][2]],
            [K_ii[2][0], K_ii[2][1], K_ii[2][2], K_ij[2][0], K_ij[2][1], K_ij[2][2]],
            [K_ji[0][0], K_ji[0][1], K_ji[0][2], K_jj[0][0], K_jj[0][1], K_jj[0][2]],
            [K_ji[1][0], K_ji[1][1], K_ji[1][2], K_jj[1][0], K_jj[1][1], K_jj[1][2]],
            [K_ji[2][0], K_ji[2][1], K_ji[2][2], K_jj[2][0], K_jj[2][1], K_jj[2][2]]
        ];
    }

    const parseInputs = () => {
        // プリセット読み込み中は簡易的なダミーデータを返してエラーを回避
        if (window.isLoadingPreset) {
            return {
                nodes: [],
                members: [],
                nodeLoads: [],
                memberLoads: [],
                memberSelfWeights: [],
                nodeSelfWeights: []
            };
        }
        
        // エラーログをリセット（新しい解析サイクルの開始時）
        if (window.resetErrorLogs) {
            window.memberErrorLogged = {};
            window.cellCountErrorLogged = {};
            window.cellMissingErrorLogged = {};
            window.selfWeightLogCount = 0;
            window.resetErrorLogs = false;
        }

        if (elements && elements.errorMessage) {
            elements.errorMessage.style.display = 'none';
            elements.errorMessage.textContent = '';
        }
        
        const toPositiveNumber = (value) => {
            const num = Number(value);
            return Number.isFinite(num) && num > 0 ? num : null;
        };

        const deriveRadiusFrom = (moment, area) => {
            if (!Number.isFinite(moment) || moment <= 0 || !Number.isFinite(area) || area <= 0) {
                return null;
            }
            const radius = Math.sqrt(moment / area);
            return Number.isFinite(radius) && radius > 0 ? radius : null;
        };

        const combineApproximate = (a, b) => {
            if (a !== null && b !== null) {
                const diff = Math.abs(a - b);
                const tolerance = Math.max(1e-9, Math.abs(a) * 1e-5, Math.abs(b) * 1e-5);
                if (diff <= tolerance) {
                    return (a + b) / 2;
                }
                return (a + b) / 2;
            }
            return a !== null ? a : b;
        };

        const selectWithFallback = (primary, secondary, fallback) => {
            if (primary !== null && Number.isFinite(primary)) return primary;
            if (secondary !== null && Number.isFinite(secondary)) return secondary;
            return fallback;
        };

        const computeAxisProperties = (strongAxis, weakAxis, axisKey, area) => {
            const normalizedKey = axisKey === 'y' ? 'y' : axisKey === 'both' ? 'both' : 'x';

            const strong = {
                inertia: toPositiveNumber(strongAxis?.inertia),
                modulus: toPositiveNumber(strongAxis?.modulus),
                radius: toPositiveNumber(strongAxis?.radius)
            };
            const weak = {
                inertia: toPositiveNumber(weakAxis?.inertia),
                modulus: toPositiveNumber(weakAxis?.modulus),
                radius: toPositiveNumber(weakAxis?.radius)
            };

            strong.radius = strong.radius ?? deriveRadiusFrom(strong.inertia, area);
            weak.radius = weak.radius ?? deriveRadiusFrom(weak.inertia, area);

            const fallbackInertia = (() => {
                const combined = combineApproximate(strong.inertia, weak.inertia);
                if (combined !== null && Number.isFinite(combined)) return combined;
                return strong.inertia ?? weak.inertia ?? 1e-12;
            })();

            const fallbackModulus = (() => {
                const combined = combineApproximate(strong.modulus, weak.modulus);
                if (combined !== null && Number.isFinite(combined)) return combined;
                return strong.modulus ?? weak.modulus ?? 1e-6;
            })();

            const fallbackRadius = (() => {
                const combined = combineApproximate(strong.radius, weak.radius);
                if (combined !== null && Number.isFinite(combined)) return combined;
                return deriveRadiusFrom(fallbackInertia, area) ?? 0.01;
            })();

            let localInertiaZ;
            let localInertiaY;
            let localModulusZ;
            let localModulusY;
            let localRadiusZ;
            let localRadiusY;

            if (normalizedKey === 'y') {
                localInertiaZ = selectWithFallback(weak.inertia, strong.inertia, fallbackInertia);
                localInertiaY = selectWithFallback(strong.inertia, weak.inertia, fallbackInertia);
                localModulusZ = selectWithFallback(weak.modulus, strong.modulus, fallbackModulus);
                localModulusY = selectWithFallback(strong.modulus, weak.modulus, fallbackModulus);
                localRadiusZ = selectWithFallback(weak.radius, strong.radius, fallbackRadius);
                localRadiusY = selectWithFallback(strong.radius, weak.radius, fallbackRadius);
            } else if (normalizedKey === 'both') {
                const sharedInertia = combineApproximate(strong.inertia, weak.inertia) ?? fallbackInertia;
                const sharedModulus = combineApproximate(strong.modulus, weak.modulus) ?? fallbackModulus;
                const sharedRadius = combineApproximate(strong.radius, weak.radius) ?? deriveRadiusFrom(sharedInertia, area) ?? fallbackRadius;
                localInertiaZ = sharedInertia;
                localInertiaY = sharedInertia;
                localModulusZ = sharedModulus;
                localModulusY = sharedModulus;
                localRadiusZ = sharedRadius;
                localRadiusY = sharedRadius;
            } else {
                localInertiaZ = selectWithFallback(strong.inertia, weak.inertia, fallbackInertia);
                localInertiaY = selectWithFallback(weak.inertia, strong.inertia, fallbackInertia);
                localModulusZ = selectWithFallback(strong.modulus, weak.modulus, fallbackModulus);
                localModulusY = selectWithFallback(weak.modulus, strong.modulus, fallbackModulus);
                localRadiusZ = selectWithFallback(strong.radius, weak.radius, fallbackRadius);
                localRadiusY = selectWithFallback(weak.radius, strong.radius, fallbackRadius);
            }

            const bendingInertia = localInertiaZ;
            const bendingModulus = localModulusZ;
            const bendingRadius = localRadiusZ;

            return {
                selectedKey: normalizedKey,
                strong,
                weak,
                local: {
                    inertia: { y: localInertiaY, z: localInertiaZ },
                    sectionModulus: { y: localModulusY, z: localModulusZ },
                    radius: { y: localRadiusY, z: localRadiusZ }
                },
                bendingInertia,
                bendingSectionModulus: bendingModulus,
                bendingRadius,
                orthogonal: {
                    inertia: localInertiaY,
                    sectionModulus: localModulusY,
                    radius: localRadiusY
                }
            };
        };

        const rotateAxisPropertiesBy90 = (properties) => {
            if (!properties || typeof properties !== 'object') {
                return properties;
            }

            const local = properties.local || {};
            const inertia = local.inertia || {};
            const sectionModulus = local.sectionModulus || {};
            const radius = local.radius || {};

            const rotatedLocal = {
                ...local,
                inertia: {
                    ...inertia,
                    y: inertia.z,
                    z: inertia.y
                },
                sectionModulus: {
                    ...sectionModulus,
                    y: sectionModulus.z,
                    z: sectionModulus.y
                },
                radius: {
                    ...radius,
                    y: radius.z,
                    z: radius.y
                }
            };

            return {
                ...properties,
                local: rotatedLocal,
                bendingInertia: rotatedLocal.inertia?.z ?? properties.bendingInertia,
                bendingSectionModulus: rotatedLocal.sectionModulus?.z ?? properties.bendingSectionModulus,
                bendingRadius: rotatedLocal.radius?.z ?? properties.bendingRadius,
                orthogonal: {
                    ...(properties.orthogonal || {}),
                    inertia: rotatedLocal.inertia?.y ?? properties.orthogonal?.inertia,
                    sectionModulus: rotatedLocal.sectionModulus?.y ?? properties.orthogonal?.sectionModulus,
                    radius: rotatedLocal.radius?.y ?? properties.orthogonal?.radius
                },
                rotationOverride: 'horizontal-90'
            };
        };

    const nodeRows = Array.from(elements.nodesTable.rows);
    nodeRows.forEach(clearRowValidationState);

    const membersRows = Array.from(elements.membersTable.rows);
    membersRows.forEach(clearRowValidationState);

    const nodes = nodeRows.map((row, i) => {
            // 安全な値取得
            const xInput = row.cells[1]?.querySelector('input');
            const yInput = row.cells[2]?.querySelector('input');
            const zInput = row.cells[3]?.querySelector('input');
            const supportSelect = row.cells[4]?.querySelector('select');

            if (!xInput || !yInput || !zInput || !supportSelect) {
                throw new Error(`節点 ${i + 1}: 入力フィールドが見つかりません`);
            }

            // 強制変位の読み取りを追加 (3D: dx, dy, dz, θx, θy, θz)
            const dx_forced_mm = parseFloat(row.cells[5]?.querySelector('input')?.value) || 0;
            const dy_forced_mm = parseFloat(row.cells[6]?.querySelector('input')?.value) || 0;
            const dz_forced_mm = parseFloat(row.cells[7]?.querySelector('input')?.value) || 0;

            const supportValue = normalizeSupportValue(supportSelect.value);

            return {
                id: i + 1,
                x: parseFloat(xInput.value),
                y: parseFloat(yInput.value),
                z: parseFloat(zInput.value),
                support: supportValue,
                // 強制変位を基本単位(m, rad)で格納
                dx_forced: dx_forced_mm / 1000,
                dy_forced: dy_forced_mm / 1000,
                dz_forced: dz_forced_mm / 1000
            };
        });
    const coordinateTolerance = 1e-6;
    const orientationToleranceRatio = 1e-3;
    const modelIsEffectively2D = nodes.every(node => Math.abs(node.z || 0) <= coordinateTolerance);

    const members = membersRows.map((row, index) => {
            // 安全な節点番号取得
            const iNodeInput = row.cells[1]?.querySelector('input');
            const jNodeInput = row.cells[2]?.querySelector('input');
            
            if (!iNodeInput || !jNodeInput) {
                throw new Error(`部材 ${index + 1}: 節点番号の入力フィールドが見つかりません`);
            }
            
            const i = parseInt(iNodeInput.value) - 1;
            const j = parseInt(jNodeInput.value) - 1;
            
            // 弾性係数の取得も安全に
            const e_select = row.cells[3]?.querySelector('select');
            const e_input = row.cells[3]?.querySelector('input[type="number"]');
            
            if (!e_select) {
                throw new Error(`部材 ${index + 1}: 弾性係数の選択フィールドが見つかりません`);
            }
            
            let E = (e_select.value === 'custom' ? parseFloat(e_input?.value || 0) : parseFloat(e_select.value)) * 1000;
            
            // 弾性係数選択欄から材料名を直接取得
            const getMaterialNameFromSelect = (selectElement) => {
                const selectedOption = selectElement.options[selectElement.selectedIndex];
                if (selectedOption.value === 'custom') {
                    const eValue = parseFloat(e_input?.value || 0);
                    return `任意材料(E=${(eValue/1000).toLocaleString()}GPa)`;
                }
                return selectedOption.textContent; // "スチール", "ステンレス", "アルミニウム", "木材" など
            };
            const material = getMaterialNameFromSelect(e_select);
            
            const strengthInputContainer = row.cells[4].firstElementChild;
            if (!strengthInputContainer) {
                console.warn(`行 ${index} の強度入力コンテナが見つかりません`);
                return { i, j, E, A: parseFloat(row.cells[9]?.querySelector('input')?.value || 0), material, strengthProps: { type: 'unknown' } };
            }
            const strengthType = strengthInputContainer.dataset.strengthType;
            let strengthProps = { type: strengthType };

            if (strengthType === 'wood-type') {
                    const presetSelect = strengthInputContainer.querySelector('select');
                    if (presetSelect) {
                        strengthProps.preset = presetSelect.value;
                        if (presetSelect.value === 'custom') {
                            // 任意入力の場合、基準強度として値を読み取る
                            const ftInput = strengthInputContainer.querySelector('input[id*="-ft"]');
                            const fcInput = strengthInputContainer.querySelector('input[id*="-fc"]');
                            const fbInput = strengthInputContainer.querySelector('input[id*="-fb"]');
                            const fsInput = strengthInputContainer.querySelector('input[id*="-fs"]');
                            
                            if (ftInput && fcInput && fbInput && fsInput) {
                                strengthProps.baseStrengths = {
                                    ft: parseFloat(ftInput.value),
                                    fc: parseFloat(fcInput.value),
                                    fb: parseFloat(fbInput.value),
                                    fs: parseFloat(fsInput.value)
                                };
                            }
                        }
                    }
                }
            else { // Steel, Stainless, Aluminum
                const strengthInput = strengthInputContainer.querySelector('input');
                if (strengthInput) {
                    strengthProps.value = parseFloat(strengthInput.value);
                }
            }

            // 安全な値取得(断面諸量) 3D用
            // Iw列追加に伴い、A/Zx/Zy 以降のセルインデックスが+1シフト
            const izMomentInput = row.cells[5]?.querySelector('input');
            const iyMomentInput = row.cells[6]?.querySelector('input');
            const jTorsionInput = row.cells[7]?.querySelector('input');
            const iwWarpingInput = row.cells[8]?.querySelector('input');
            const aAreaInput = row.cells[9]?.querySelector('input');
            const zzSectionInput = row.cells[10]?.querySelector('input');
            const zySectionInput = row.cells[11]?.querySelector('input');
            
            if (!izMomentInput || !iyMomentInput || !jTorsionInput || !aAreaInput || !zzSectionInput || !zySectionInput) {
                const message = `部材 ${index + 1}: 断面諸量の入力フィールドが見つかりません`;
                markRowValidationError(row, message);
                throw new Error(message);
            }
            
            const Iz = parseFloat(izMomentInput.value) * 1e-8;
            const Iy = parseFloat(iyMomentInput.value) * 1e-8;
            const J = parseFloat(jTorsionInput.value) * 1e-8;
            const A = parseFloat(aAreaInput.value) * 1e-4;
            const Zz = parseFloat(zzSectionInput.value) * 1e-6;
            const Zy = parseFloat(zySectionInput.value) * 1e-6;
            
            // 密度列が存在するかどうかでインデックスを調整（より安全な方法）
            const totalCellCount = row.cells.length;
            let hasDensityColumn = false;
            
            // セル数で判定 (3D用: Iw列追加後、密度列がある場合17列、ない場合16列)
            if (totalCellCount >= 17) {
                hasDensityColumn = true;
            } else if (totalCellCount >= 16) {
                hasDensityColumn = false;
            } else {
                if (!window.cellCountErrorLogged || !window.cellCountErrorLogged[index]) {
                    if (!window.cellCountErrorLogged) window.cellCountErrorLogged = {};
                    window.cellCountErrorLogged[index] = true;
                    console.warn(`部材 ${index + 1}: セル数が不足しています (${totalCellCount})`);
                }
                // デフォルトで密度列なしと仮定
                hasDensityColumn = false;
            }
            
            // 断面情報を取得（3Dビューア用）
            let sectionInfo = null;
            let sectionAxis = null;
            if (row.dataset.sectionInfo) {
                try {
                    sectionInfo = JSON.parse(decodeURIComponent(row.dataset.sectionInfo));
                } catch (error) {
                    console.warn(`部材 ${index + 1}: 断面情報のパースに失敗`, error);
                }
            }

            // Iw (cm^6) を入力欄または dataset から取得し、内部単位(m^6)に変換
            const iwFromInput = (() => {
                const raw = iwWarpingInput?.value;
                if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
                const n = parseFloat(raw);
                return Number.isFinite(n) ? (n * 1e-12) : undefined;
            })();
            const iwFromDataset = (row.dataset.iw !== undefined && row.dataset.iw !== '') ? (parseFloat(row.dataset.iw) * 1e-12) : undefined;
            const Iw = iwFromInput ?? iwFromDataset;

            // 軸情報を取得（3つの個別属性から構築）
            if (row.dataset.sectionAxisKey || row.dataset.sectionAxisMode || row.dataset.sectionAxisLabel) {
                sectionAxis = {
                    key: row.dataset.sectionAxisKey,
                    mode: row.dataset.sectionAxisMode,
                    label: row.dataset.sectionAxisLabel
                };
            }

            // 接合条件の取得・検証
            const connectionTargets = resolveMemberConnectionTargets(row);
            const iConnSelect = connectionTargets.i.select;
            const jConnSelect = connectionTargets.j.select;

            if (!iConnSelect || !jConnSelect) {
                if (!window.memberErrorLogged || !window.memberErrorLogged[index] || window.memberErrorLogged[index] < 2) {
                    if (!window.memberErrorLogged) window.memberErrorLogged = {};
                    window.memberErrorLogged[index] = (window.memberErrorLogged[index] || 0) + 1;
                    console.warn(`部材 ${index + 1}: 接続条件のselect要素にアクセスできません`, {
                        cellCount: totalCellCount,
                        hasDensityColumn,
                        connectionTargets,
                        cellsWithSelects: Array.from(row.cells).map((cell, i) => ({
                            index: i,
                            hasSelect: !!cell.querySelector('select'),
                            innerHTML: cell.innerHTML.substring(0, 80) + '...'
                        })).filter(c => c.hasSelect)
                    });
                }
            }

            const i_conn = iConnSelect?.value || 'rigid';
            const j_conn = jConnSelect?.value || 'rigid';

            // 座屈係数K（空欄=自動）
            let bucklingK = null;
            try {
                const kEl = row.querySelector('.buckling-k-input');
                if (kEl && kEl.value !== '') {
                    const parsed = parseFloat(kEl.value);
                    if (!isNaN(parsed) && isFinite(parsed)) bucklingK = parsed;
                }
            } catch (e) {}

            // バネ定数（内部単位へ変換）
            // UI: Kx,Ky -> kN/mm , Kr -> kN·mm/rad
            // 内部: Kx,Ky -> kN/m (×1000), Kr -> kN·m/rad (×1e-3)
            const EPS_SPRING_LOCAL = 1e-9;
            const readSpringFromSelectInternal = (selectEl) => {
                const container = selectEl?.closest('.conn-cell')?.querySelector('.spring-inputs');
                if (!container) return null;
                const kx_ui = parseFloat(container.querySelector('.spring-kx')?.value || 0);
                const ky_ui = parseFloat(container.querySelector('.spring-ky')?.value || 0);
                const kr_ui = parseFloat(container.querySelector('.spring-kr')?.value || 0);
                const rigidKx = !!container.querySelector('.spring-rigid-kx')?.checked;
                const rigidKy = !!container.querySelector('.spring-rigid-ky')?.checked;
                const rigidKr = !!container.querySelector('.spring-rigid-kr')?.checked;
                const Kx = (Number.isFinite(kx_ui) ? kx_ui : 0) * 1000;
                const Ky = (Number.isFinite(ky_ui) ? ky_ui : 0) * 1000;
                const Kr = (Number.isFinite(kr_ui) ? kr_ui : 0) * 1e-3;
                if (!rigidKx && !rigidKy && Kx === 0 && Ky === 0) {
                    return { Kx: EPS_SPRING_LOCAL, Ky: EPS_SPRING_LOCAL, Kr: Kr || 0, rigidKx, rigidKy, rigidKr };
                }
                return { Kx: Kx || 0, Ky: Ky || 0, Kr: Kr || 0, rigidKx, rigidKy, rigidKr };
            };

            const spring_i = (i_conn === 'spring') ? (readSpringFromSelectInternal(iConnSelect) || { Kx: 0, Ky: 0, Kr: 0 }) : { Kx: 0, Ky: 0, Kr: 0 };
            const spring_j = (j_conn === 'spring') ? (readSpringFromSelectInternal(jConnSelect) || { Kx: 0, Ky: 0, Kr: 0 }) : { Kx: 0, Ky: 0, Kr: 0 };
            const parseRadiusDataset = (value) => {
                const num = Number(value);
                return Number.isFinite(num) && num > 0 ? num * 1e-2 : null;
            };

            const ixDataset = parseRadiusDataset(row.dataset.ix);
            const iyDataset = parseRadiusDataset(row.dataset.iy);
            const ixStrongRadius = ixDataset ?? deriveRadiusFrom(Iz, A);
            const iyWeakRadius = iyDataset ?? deriveRadiusFrom(Iy, A);

            if (isNaN(E) || isNaN(Iz) || isNaN(Iy) || isNaN(J) || isNaN(A) || isNaN(Zz) || isNaN(Zy)) {
                const message = `部材 ${index + 1} の物性値が無効です。`;
                markRowValidationError(row, message);
                throw new Error(message);
            }
            if (i < 0 || j < 0 || i >= nodes.length || j >= nodes.length) {
                const message = `部材 ${index + 1} の節点番号が不正です。`;
                markRowValidationError(row, message);
                throw new Error(message);
            }
            if (i === j) {
                const message = `部材 ${index + 1}: 始端と終端の節点番号が同一です。異なる節点を指定してください。`;
                markRowValidationError(row, message);
                throw new Error(message);
            }
            const ni = nodes[i];
            const nj = nodes[j];
            const dx = nj.x - ni.x;
            const dy = nj.y - ni.y;
            const dz = (nj.z ?? 0) - (ni.z ?? 0);
            const L = Math.sqrt(dx**2 + dy**2 + dz**2);
            if (L === 0) {
                const message = `部材 ${index + 1}: 節点 ${i + 1} と節点 ${j + 1} の座標が同じため長さが0です。節点位置を見直してください。`;
                markRowValidationError(row, message);
                throw new Error(message);
            }

            let axisProps = computeAxisProperties(
                { inertia: Iz, modulus: Zz, radius: ixStrongRadius },
                { inertia: Iy, modulus: Zy, radius: iyWeakRadius },
                sectionAxis?.key,
                A
            );

            const verticalComponent = modelIsEffectively2D ? Math.abs(dy) : Math.abs(dz);
            const horizontalThreshold = Math.max(coordinateTolerance, orientationToleranceRatio * L);
            const isHorizontalMember = verticalComponent <= horizontalThreshold;

            if (isHorizontalMember) {
                axisProps = rotateAxisPropertiesBy90(axisProps);
            }

            const fallbackRadiusZ = axisProps?.local?.radius?.z ?? deriveRadiusFrom(axisProps?.bendingInertia, A) ?? ixStrongRadius ?? iyWeakRadius ?? 0;
            const fallbackRadiusY = axisProps?.local?.radius?.y ?? deriveRadiusFrom(axisProps?.orthogonal?.inertia, A) ?? iyWeakRadius ?? ixStrongRadius ?? 0;
            const ix = selectWithFallback(ixStrongRadius, axisProps?.local?.radius?.z, fallbackRadiusZ);
            const iy = selectWithFallback(iyWeakRadius, axisProps?.local?.radius?.y, fallbackRadiusY);
            
            // 3D用の剛性マトリックスと変換マトリックスは frame_analyzer_3d.js で計算されるため、
            // ここでは2D互換の値を保持 (将来的に統合予定)
            const c = dx/L, s = dy/L, T = [ [c,s,0,0,0,0], [-s,c,0,0,0,0], [0,0,1,0,0,0], [0,0,0,c,s,0], [0,0,0,-s,c,0], [0,0,0,0,0,1] ];
            const bendingInertia = axisProps?.bendingInertia ?? Iz;
            const k_local = compute2DLocalStiffnessWithEndSprings({
                E,
                A,
                I: bendingInertia,
                L,
                i_conn,
                j_conn,
                spring_i,
                spring_j
            });
            const bendingSectionModulus = axisProps?.bendingSectionModulus ?? Zz;

            return {
                i,
                j,
                E,
                strengthProps,
                I: bendingInertia,
                Z: bendingSectionModulus,
                Iz,
                Iy,
                J,
                Iw,
                A,
                Zz,
                Zy,
                ix,
                iy,
                length: L,
                c,
                s,
                T,
                i_conn,
                j_conn,
                spring_i,
                spring_j,
                bucklingK,
                k_local,
                material,
                sectionInfo,
                sectionAxis,
                axisProperties: axisProps
            };
        });
        const nodeLoads = Array.from(elements.nodeLoadsTable.rows).map((r, i) => { 
            const n = parseInt(r.cells[0].querySelector('input').value) - 1; 
            if (n < 0 || n >= nodes.length) throw new Error(`節点荷重 ${i+1} の節点番号が不正です。`); 
            return { 
                nodeIndex:n, 
                px:parseFloat(r.cells[1].querySelector('input').value)||0, 
                py:parseFloat(r.cells[2].querySelector('input').value)||0, 
                pz:parseFloat(r.cells[3].querySelector('input').value)||0,
                mx:0,
                my:0,
                mz:0
            }; 
        });
        const memberLoads = Array.from(elements.memberLoadsTable.rows).map((r, i) => { 
            const m = parseInt(r.cells[0].querySelector('input').value) - 1; 
            if (m < 0 || m >= members.length) throw new Error(`部材荷重 ${i+1} の部材番号が不正です。`); 
            return { 
                memberIndex:m, 
                wx:parseFloat(r.cells[1].querySelector('input').value)||0,
                wy:parseFloat(r.cells[2].querySelector('input').value)||0,
                wz:parseFloat(r.cells[3].querySelector('input').value)||0
            }; 
        });
        
        // 自重荷重を追加
        const considerSelfWeightCheckbox = document.getElementById('consider-self-weight-checkbox');
        const membersTableBody = document.getElementById('members-table').getElementsByTagName('tbody')[0];
        const { memberSelfWeights, nodeSelfWeights } = calculateSelfWeight.calculateAllSelfWeights(
            nodes, 
            members, 
            considerSelfWeightCheckbox, 
            membersTableBody
        );
        
        if (memberSelfWeights.length > 0) {
            // 自重荷重ログの頻度制限
            if (!window.selfWeightLogCount) window.selfWeightLogCount = 0;
            if (window.selfWeightLogCount < 3) {
                console.log('自重荷重を追加:', memberSelfWeights);
                window.selfWeightLogCount++;
            }
        }
        
        return { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights };
    };
    
    // window変数として登録（クロススコープアクセス用）
    window.parseInputs = parseInputs;
    
    const clearResults = () => {
        // elements が初期化されているかチェック
        if (!elements) {
            console.warn('⚠️ clearResults: elements が初期化されていません');
            return;
        }
        const canvases = [elements.displacementCanvas, elements.momentCanvas, elements.axialCanvas, elements.shearCanvas, elements.ratioCanvas];
        canvases.forEach(c => { if (c) { const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); } });
        const tables = [elements.displacementResults, elements.reactionResults, elements.forceResults, elements.sectionCheckResults];
        tables.forEach(t => { if(t) t.innerHTML = ''; });
        lastResults = null;
        lastAnalysisResult = null;
        lastSectionCheckResults = null;
        window.lastResults = null; // グローバル変数もクリア
        window.lastSectionCheckResults = null;
        window.lastBucklingResults = null;
    };
    
    const displayResults = (D, R, forces, nodes, members, nodeLoads, memberLoads) => {
        // elements が初期化されているかチェック
        if (!elements) {
            console.error('FATAL: elements が初期化されていません！DOMContentLoaded が完了していない可能性があります。');
            alert('内部エラー: DOM要素が初期化されていません。ページを再読み込みしてください。');
            return;
        }
        
        lastResults = { D, R, forces, nodes, members, nodeLoads, memberLoads };
        window.lastResults = lastResults; // グローバルに保存

        const dofPerNode = (nodes?.length && D?.length) ? (D.length / nodes.length) : 0;
        const is3D = dofPerNode === 6;

        // エクセル出力用の解析結果を保存
        lastAnalysisResult = {
            displacements: D ? (
                is3D
                    ? Array.from({ length: D.length / 6 }, (_, i) => ({
                        x: D[i*6][0],
                        y: D[i*6+1][0],
                        z: D[i*6+2][0],
                        rx: D[i*6+3][0],
                        ry: D[i*6+4][0],
                        rz: D[i*6+5][0]
                    }))
                    : Array.from({ length: D.length / 3 }, (_, i) => ({
                        x: D[i*3][0],
                        y: D[i*3+1][0],
                        rotation: D[i*3+2][0]
                    }))
            ) : [],
            forces: forces ? (
                is3D
                    ? forces.map(f => ({
                        i: {
                            N: -f.N_i,
                            Vy: f.Qy_i,
                            Vz: f.Qz_i,
                            Tx: f.Mx_i,
                            My: f.My_i,
                            Mz: f.Mz_i
                        },
                        j: {
                            N: f.N_j,
                            Vy: -f.Qy_j,
                            Vz: -f.Qz_j,
                            Tx: f.Mx_j,
                            My: f.My_j,
                            Mz: f.Mz_j
                        }
                    }))
                    : forces.map(f => ({
                        i: { N: -f.N_i, Q: f.Q_i, M: f.M_i },
                        j: { N: f.N_j, Q: -f.Q_j, M: f.M_j }
                    }))
            ) : [],
            reactions: R ? (
                is3D
                    ? Array.from({ length: R.length / 6 }, (_, i) => ({
                        x: -R[i*6][0] || 0,
                        y: -R[i*6+1][0] || 0,
                        z: -R[i*6+2][0] || 0,
                        mx: -R[i*6+3][0] || 0,
                        my: -R[i*6+4][0] || 0,
                        mz: -R[i*6+5][0] || 0
                    }))
                    : Array.from({ length: R.length / 3 }, (_, i) => ({
                        x: -R[i*3][0] || 0,
                        y: -R[i*3+1][0] || 0,
                        mz: -R[i*3+2][0] || 0
                    }))
            ) : [],
            nodes: nodes || [],
            members: members || [],
            sectionCheckResults: null  // 後で断面検定実行時に設定される
        };

        // 構造解析完了後に自動で座屈解析を実行
        if (forces && forces.length > 0) {
            try {
                lastBucklingResults = calculateBucklingAnalysis();
                window.lastBucklingResults = lastBucklingResults; // グローバルに保存
                // 座屈解析結果も自動で表示
                displayBucklingResults();
            } catch (error) {
                console.warn('座屈解析中にエラーが発生しましたが、処理を続行します:', error);
            }
        }
        
        elements.errorMessage.style.display = 'none';
        
        // 🔧 2D/3D判定（自由度数から判定）
        const dofPerNodeDisplay = D.length / nodes.length;
        const is3DDisplay = (dofPerNodeDisplay === 6);
        
        // 変位結果の表示
        let dispHTML;
        if (is3DDisplay) {
            // 3D表示
            dispHTML = `<thead><tr><th>節点 #</th><th>変位 δx (mm)</th><th>変位 δy (mm)</th><th>変位 δz (mm)</th><th>回転角 θx (rad)</th><th>回転角 θy (rad)</th><th>回転角 θz (rad)</th></tr></thead><tbody>`;
            const numNodes = D.length / 6;
            for (let i = 0; i < numNodes; i++) {
                const row = `<tr><td>${i+1}</td><td>${(D[i*6][0]*1000).toFixed(2)}</td><td>${(D[i*6+1][0]*1000).toFixed(2)}</td><td>${(D[i*6+2][0]*1000).toFixed(2)}</td><td>${D[i*6+3][0].toFixed(6)}</td><td>${D[i*6+4][0].toFixed(6)}</td><td>${D[i*6+5][0].toFixed(6)}</td></tr>`;
                dispHTML += row;
            }
        } else {
            // 2D表示
            dispHTML = `<thead><tr><th>節点 #</th><th>変位 δx (mm)</th><th>変位 δy (mm)</th><th>回転角 θz (rad)</th></tr></thead><tbody>`;
            const numNodes = D.length / 3;
            for (let i = 0; i < numNodes; i++) {
                const row = `<tr><td>${i+1}</td><td>${(D[i*3][0]*1000).toFixed(2)}</td><td>${(D[i*3+1][0]*1000).toFixed(2)}</td><td>${D[i*3+2][0].toFixed(2)}</td></tr>`;
                dispHTML += row;
            }
        }
        dispHTML += '</tbody>';
        
        if (elements.displacementResults) {
            elements.displacementResults.innerHTML = dispHTML;
            elements.displacementResults.style.display = 'table';
            elements.displacementResults.style.visibility = 'visible';
        }
        
        // 反力結果の表示
        let reactHTML;
        if (is3DDisplay) {
            // 3D表示
            reactHTML = `<thead><tr><th>節点 #</th><th>反力 Rx (kN)</th><th>反力 Ry (kN)</th><th>反力 Rz (kN)</th><th>反力 Mx (kN・m)</th><th>反力 My (kN・m)</th><th>反力 Mz (kN・m)</th></tr></thead><tbody>`;
            nodes.forEach((n, i) => {
                if (n.support !== 'free') {
                    const rx = -R[i*6][0]||0, ry = -R[i*6+1][0]||0, rz = -R[i*6+2][0]||0;
                    const mx = -R[i*6+3][0]||0, my = -R[i*6+4][0]||0, mz = -R[i*6+5][0]||0;
                    reactHTML += `<tr><td>${i+1}</td><td>${rx.toFixed(2)}</td><td>${ry.toFixed(2)}</td><td>${rz.toFixed(2)}</td><td>${mx.toFixed(2)}</td><td>${my.toFixed(2)}</td><td>${mz.toFixed(2)}</td></tr>`;
                }
            });
        } else {
            // 2D表示
            reactHTML = `<thead><tr><th>節点 #</th><th>反力 Rx (kN)</th><th>反力 Ry (kN)</th><th>反力 Mz (kN・m)</th></tr></thead><tbody>`;
            nodes.forEach((n, i) => {
                if (n.support !== 'free') {
                    const rx = -R[i*3][0]||0, ry = -R[i*3+1][0]||0, mz = -R[i*3+2][0]||0;
                    reactHTML += `<tr><td>${i+1}</td><td>${rx.toFixed(2)}</td><td>${ry.toFixed(2)}</td><td>${mz.toFixed(2)}</td></tr>`;
                }
            });
        }
        reactHTML += '</tbody>';
        if (elements.reactionResults) {
            elements.reactionResults.innerHTML = reactHTML;
            elements.reactionResults.style.display = 'table';
            elements.reactionResults.style.visibility = 'visible';
        }
        
        // 断面力結果の表示
        let forceHTML;
        if (is3DDisplay) {
            forceHTML = `<thead><tr><th>部材 #</th><th>端部</th><th>節点 #</th><th>軸力 N<sub>x</sub> (kN)</th><th>せん断力 V<sub>y</sub> (kN)</th><th>せん断力 V<sub>z</sub> (kN)</th><th>ねじり T<sub>x</sub> (kN・m)</th><th>曲げ M<sub>y</sub> (kN・m)</th><th>曲げ M<sub>z</sub> (kN・m)</th></tr></thead><tbody>`;
            forces.forEach((f, idx) => {
                const ni = members[idx].i + 1;
                const nj = members[idx].j + 1;
                forceHTML += `<tr><td rowspan="2">${idx + 1}</td><td>i端</td><td>${ni}</td>` +
                    `<td>${(-f.N_i).toFixed(2)}</td><td>${f.Qy_i.toFixed(2)}</td><td>${f.Qz_i.toFixed(2)}</td>` +
                    `<td>${f.Mx_i.toFixed(2)}</td><td>${f.My_i.toFixed(2)}</td><td>${f.Mz_i.toFixed(2)}</td></tr>`;
                forceHTML += `<tr><td>j端</td><td>${nj}</td>` +
                    `<td>${f.N_j.toFixed(2)}</td><td>${(-f.Qy_j).toFixed(2)}</td><td>${(-f.Qz_j).toFixed(2)}</td>` +
                    `<td>${f.Mx_j.toFixed(2)}</td><td>${f.My_j.toFixed(2)}</td><td>${f.Mz_j.toFixed(2)}</td></tr>`;
            });
        } else {
            forceHTML = `<thead><tr><th>部材 #</th><th>始端 #i</th><th>終端 #j</th><th>軸力 N (kN)</th><th>せん断力 Q (kN)</th><th>曲げM (kN・m)</th></tr></thead><tbody>`;
            forces.forEach((f, i) => {
                const ni = members[i].i+1, nj = members[i].j+1;
                forceHTML += `<tr><td rowspan="2">${i+1}</td><td>${ni} (i端)</td><td>-</td><td>${(-f.N_i).toFixed(2)}</td><td>${f.Q_i.toFixed(2)}</td><td>${f.M_i.toFixed(2)}</td></tr>`;
                forceHTML += `<tr><td>-</td><td>${nj} (j端)</td><td>${f.N_j.toFixed(2)}</td><td>${(-f.Q_j).toFixed(2)}</td><td>${f.M_j.toFixed(2)}</td></tr>`;
            });
        }
        forceHTML += '</tbody>';
        if (elements.forceResults) {
            elements.forceResults.innerHTML = forceHTML;
            elements.forceResults.style.display = 'table';
            elements.forceResults.style.visibility = 'visible';
        }
        
        // 新しい全投影対応の描画関数を使用
        drawDisplacementDiagram(nodes, members, D, memberLoads);
        
        // 応力図描画（現在の描画 + 第2軸表示）
        if (typeof drawStressDiagram === 'function') {
            // 投影面に応じてタイトルを動的に設定
            const projectionMode = getCurrentProjectionMode();
            let momentTitle = '曲げモーメント図 (BMD) (kN・m)';
            let shearTitle = 'せん断力図 (SFD) (kN)';
            
            if (projectionMode === 'xy') {
                momentTitle = '曲げモーメント図 Mz (BMD) (kN・m)';
                shearTitle = 'せん断力図 Vz (SFD) (kN)';
            } else if (projectionMode === 'xz') {
                momentTitle = '曲げモーメント図 My (BMD) (kN・m)';
                shearTitle = 'せん断力図 Vy (SFD) (kN)';
            } else if (projectionMode === 'yz') {
                momentTitle = '曲げモーメント図 Mx (BMD) (kN・m)';
                shearTitle = 'せん断力図 Vx (SFD) (kN)';
            }
            
            // 第1軸と第2軸の応力図を横並びで描画（3D構造の場合）
            const dofPerNode = (nodes?.length && D?.length) ? (D.length / nodes.length) : 0;
            const is3D = dofPerNode === 6;
            
            if (is3D && typeof drawSecondaryAxisStressDiagram === 'function') {
                console.log('🚀 3D構造: 第1軸と第2軸の応力図を横並び表示');
                try {
                    // 第1軸の応力図を描画
                    drawStressDiagram(elements.momentCanvas, nodes, members, forces, 'moment', momentTitle);
                    drawStressDiagram(elements.axialCanvas, nodes, members, forces, 'axial', '軸力図 (AFD) (kN)');
                    drawStressDiagram(elements.shearCanvas, nodes, members, forces, 'shear', shearTitle);
                    
                    // 第2軸の応力図を別キャンバスに描画（横並び表示）
                    const secondaryMomentTitle = momentTitle.replace('Mz', 'My').replace('My', 'Mz');
                    const secondaryShearTitle = shearTitle.replace('Vz', 'Vy').replace('Vy', 'Vz');
                    
                    // 第2軸用のキャンバスを表示
                    if (elements.secondaryMomentContainer) {
                        elements.secondaryMomentContainer.style.display = 'block';
                    }
                    if (elements.secondaryShearContainer) {
                        elements.secondaryShearContainer.style.display = 'block';
                    }
                    
                    // 第2軸の応力図を別キャンバスに描画
                    if (elements.momentCanvas2) {
                        drawSecondaryAxisStressDiagram(elements.momentCanvas2, nodes, members, forces, 'moment', secondaryMomentTitle);
                    }
                    if (elements.shearCanvas2) {
                        drawSecondaryAxisStressDiagram(elements.shearCanvas2, nodes, members, forces, 'shear', secondaryShearTitle);
                    }
                    
                    // 軸力図は軸に依存しないので第2軸は不要
                    
                } catch (error) {
                    console.error('❌ 第2軸応力図でエラー:', error);
                    // エラーの場合は第1軸のみ表示
                    drawStressDiagram(elements.momentCanvas, nodes, members, forces, 'moment', momentTitle);
                    drawStressDiagram(elements.axialCanvas, nodes, members, forces, 'axial', '軸力図 (AFD) (kN)');
                    drawStressDiagram(elements.shearCanvas, nodes, members, forces, 'shear', shearTitle);
                    
                    // 第2軸用のキャンバスは非表示
                    if (elements.secondaryMomentContainer) {
                        elements.secondaryMomentContainer.style.display = 'none';
                    }
                    if (elements.secondaryShearContainer) {
                        elements.secondaryShearContainer.style.display = 'none';
                    }
                }
            } else {
                // 2D構造の場合は第1軸のみ表示
                drawStressDiagram(elements.momentCanvas, nodes, members, forces, 'moment', momentTitle);
                drawStressDiagram(elements.axialCanvas, nodes, members, forces, 'axial', '軸力図 (AFD) (kN)');
                drawStressDiagram(elements.shearCanvas, nodes, members, forces, 'shear', shearTitle);
                
                // 第2軸用のキャンバスは非表示
                if (elements.secondaryMomentContainer) {
                    elements.secondaryMomentContainer.style.display = 'none';
                }
                if (elements.secondaryShearContainer) {
                    elements.secondaryShearContainer.style.display = 'none';
                }
            }
        } else {
            // フォールバック: 古い単一投影の描画関数
            drawMomentDiagram(nodes, members, forces, memberLoads);
            drawAxialForceDiagram(nodes, members, forces);
            drawShearForceDiagram(nodes, members, forces, memberLoads);
        }
    };


// --- Canvas Drawing ---
    let lastDrawingContext = null;
    
    // 重複判定用のヘルパー関数
    function boxesOverlap(box1, box2) {
        return !(box1.x + box1.width < box2.x || 
                box2.x + box2.width < box1.x || 
                box1.y + box1.height < box2.y || 
                box2.y + box2.height < box1.y);
    }
    
    // 重複面積計算用のヘルパー関数
    function calculateOverlapArea(box1, box2) {
        const overlapX = Math.max(0, Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x));
        const overlapY = Math.max(0, Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y));
        return overlapX * overlapY;
    }
    
    // 部材番号の重複回避位置計算（部材上に制限）
    function calculateMemberLabelPositions(members, nodes, transform, ctx) {
        const memberLabelPositions = [];
        
        members.forEach((m, memberIndex) => {
            const start = transform(nodes[m.i].x, nodes[m.i].y);
            const end = transform(nodes[m.j].x, nodes[m.j].y);
            
            ctx.font = "10px Arial";
            const memberText = (memberIndex + 1).toString();
            const textMetrics = ctx.measureText(memberText);
            const textWidth = textMetrics.width;
            const textHeight = 10;
            const padding = 2;
            const boxWidth = textWidth + padding * 2;
            const boxHeight = textHeight + padding * 2;
            
            // 部材上の候補位置を生成（部材線上の複数点）
            const candidates = [];
            const numCandidates = 7; // 候補数を増やして選択肢を豊富にする
            
            for (let i = 0; i < numCandidates; i++) {
                const t = i / (numCandidates - 1); // 0から1の間で分割
                const x = start.x + (end.x - start.x) * t;
                const y = start.y + (end.y - start.y) * t;
                
                candidates.push({ x, y, t });
            }
            
            // 最適な位置を選択（他のラベルと重複しない部材上の点）
            let bestPosition = candidates[Math.floor(numCandidates / 2)]; // デフォルトは中点
            let minOverlap = Infinity;
            
            for (const candidate of candidates) {
                const candidateBox = {
                    x: candidate.x - boxWidth / 2,
                    y: candidate.y - boxHeight / 2,
                    width: boxWidth,
                    height: boxHeight
                };
                
                let overlapCount = 0;
                let totalOverlapArea = 0;
                
                // 既存のラベル位置との重複チェック
                for (const existing of memberLabelPositions) {
                    if (boxesOverlap(candidateBox, existing)) {
                        overlapCount++;
                        totalOverlapArea += calculateOverlapArea(candidateBox, existing);
                    }
                }
                
                // 重複度の計算 + 中心に近いほど好ましい（中心からの距離によるペナルティ）
                const centerBias = Math.abs(candidate.t - 0.5) * 100; // 中心から離れるほどペナルティ
                const overlapScore = overlapCount * 1000 + totalOverlapArea + centerBias;
                
                if (overlapScore < minOverlap) {
                    minOverlap = overlapScore;
                    bestPosition = candidate;
                }
            }
            
            // 選択された位置をラベル位置リストに追加
            memberLabelPositions.push({
                x: bestPosition.x - boxWidth / 2,
                y: bestPosition.y - boxHeight / 2,
                width: boxWidth,
                height: boxHeight,
                memberIndex: memberIndex,
                textX: bestPosition.x,
                textY: bestPosition.y,
                t: bestPosition.t // 部材上の位置パラメータ
            });
        });
        
        return memberLabelPositions;
    }
    
    // project3DTo2D関数はグローバルスコープで定義済み
    
    // window変数として登録（クロススコープアクセス用）
    window.lastDrawingContext = null;
    window.lastConcentratedLoadArrows = window.lastConcentratedLoadArrows || [];
    const getDrawingContext = (canvas) => {
        let nodes;
        try { nodes = parseInputs().nodes; } catch (e) { nodes = []; }
        if (!canvas) return null;
        
        const isModelCanvas = canvas.id === 'model-canvas';
        
        // 投影モードを取得
    const projectionMode = getCurrentProjectionMode();
        
        // 3D座標を2D投影
        const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode));
        
        const minX = projectedNodes.length > 0 ? Math.min(...projectedNodes.map(n => n.x)) : 0;
        const maxX = projectedNodes.length > 0 ? Math.max(...projectedNodes.map(n => n.x)) : 0;
        const minY = projectedNodes.length > 0 ? Math.min(...projectedNodes.map(n => n.y)) : 0;
        const maxY = projectedNodes.length > 0 ? Math.max(...projectedNodes.map(n => n.y)) : 0;
        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        
        const padding = 70;
        const isRatioCanvas = canvas.id === 'ratio-canvas';
        const minHeight = isRatioCanvas ? 350 : 250;
        const maxHeight = isRatioCanvas ? 1200 : 800;
        
        // キャンバスの高さを先に決定する
        let requiredHeight;
        if (nodes.length === 0) {
            requiredHeight = isRatioCanvas ? 500 : 400;
        } else if (modelWidth === 0 && modelHeight === 0) {
            requiredHeight = isRatioCanvas ? 500 : 400;
        } else {
            // まず仮のコンテナサイズでスケールを計算
            const containerRect = canvas.parentElement.getBoundingClientRect();
            const tempScaleX = (containerRect.width - 2 * padding) / (modelWidth || 1);
            const tempScaleY = (containerRect.height - 2 * padding) / (modelHeight || 1);
            const tempScale = Math.min(tempScaleX, tempScaleY) * 0.9;
            requiredHeight = modelHeight * tempScale + 2 * padding;
            requiredHeight = Math.max(minHeight, Math.min(maxHeight, requiredHeight));
        }

        canvas.style.height = `${requiredHeight}px`;
        
        // キャンバスの高さを変更した後に、新しいサイズを取得してスケールを再計算
        const rect = canvas.getBoundingClientRect();
        const containerRect = canvas.parentElement.getBoundingClientRect();
        
        let scale, offsetX, offsetY;
        
        if (nodes.length === 0) {
            scale = 50; // An arbitrary scale for an empty grid
            offsetX = padding;
            offsetY = rect.height - padding;
        } else if (modelWidth === 0 && modelHeight === 0) {
            // Single node or all nodes at the same location. Center the view on the first node.
            scale = 50; // Default zoom level
            const nodeX = nodes[0].x;
            const nodeY = nodes[0].y;
            offsetX = (rect.width / 2) - (nodeX * scale);
            offsetY = (rect.height / 2) + (nodeY * scale);
        } else {
            // 新しいサイズでスケールを正確に計算
            const scaleX = (rect.width - 2 * padding) / (modelWidth || 1);
            const scaleY = (rect.height - 2 * padding) / (modelHeight || 1);
            scale = Math.min(scaleX, scaleY) * 0.9;
            
            // リサイズ時は常に自動スケーリングを実行（panZoomState.isInitialized = falseの場合）
            if (isModelCanvas && panZoomState.isInitialized) {
                // モデル図が初期化済みの場合、既存のパン・ズーム情報を使用
                ({ scale, offsetX, offsetY } = panZoomState);
            } else {
                // 結果の図、またはモデル図の初回描画時/リサイズ時は、常に中央に配置
                offsetX = padding + (rect.width - 2 * padding - modelWidth * scale) / 2 - minX * scale;
                offsetY = padding + (rect.height - 2 * padding - modelHeight * scale) / 2 + maxY * scale;

                if (isModelCanvas) {
                    // モデル図の状態を保存
                    panZoomState = { scale, offsetX, offsetY, isInitialized: true };
                }
            }
        }

        const resolutionScale = (() => {
            const override = (typeof window !== 'undefined') ? window.canvasResolutionScale : undefined;
            if (Number.isFinite(override) && override > 0) return override;
            const configValue = CONFIG && CONFIG.ui ? CONFIG.ui.canvasResolutionScale : undefined;
            return Number.isFinite(configValue) && configValue > 0 ? configValue : 1;
        })();

        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr * resolutionScale;
        canvas.height = rect.height * dpr * resolutionScale;

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr * resolutionScale, dpr * resolutionScale);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "12px Arial";
        
        const transform = (x, y) => ({ x: x * scale + offsetX, y: -y * scale + offsetY });
        
        return { ctx, transform, scale, offsetX, offsetY };
    };
    // 座標軸を描画する関数
    const drawCoordinateAxes = (ctx, transform, scale, offsetX, offsetY, canvasWidth, canvasHeight) => {
        // 実際のキャンバスの描画領域のサイズを使用
        const rect = ctx.canvas.getBoundingClientRect();
        const actualWidth = rect.width;
        const actualHeight = rect.height;
        
        // 座標軸の範囲を計算
        const leftX = (-offsetX) / scale; // 左端のX座標
        const rightX = (actualWidth - offsetX) / scale; // 右端のX座標
        const topY = (offsetY) / scale; // 上端のY座標（Y軸は反転している）
        const bottomY = (offsetY - actualHeight) / scale; // 下端のY座標
        
        // グリッド間隔を取得
        const gridSpacing = parseFloat(elements.gridSpacing.value);
        if (isNaN(gridSpacing) || gridSpacing <= 0) return;
        
        // グリッド設定値の小数点以下桁数を取得
        const gridSpacingStr = elements.gridSpacing.value.toString();
        const decimalPlaces = gridSpacingStr.includes('.') ? 
            gridSpacingStr.split('.')[1].length : 0;
        
        // 適切な目盛間隔を計算（グリッド間隔の倍数）
        const xRange = rightX - leftX;
        const yRange = topY - bottomY;
        const getTickInterval = (range, baseSpacing) => {
            const desiredTicks = 10; // 10個程度の目盛りが目安
            const rawInterval = range / desiredTicks;
            const multiplier = Math.ceil(rawInterval / baseSpacing);
            return Math.max(1, multiplier) * baseSpacing;
        };
        
        const xTickInterval = getTickInterval(xRange, gridSpacing);
        const yTickInterval = getTickInterval(yRange, gridSpacing);
        
        ctx.save();
        ctx.strokeStyle = '#999';
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.lineWidth = 1;
        
        // X軸の目盛り（下端）
        const xStart = Math.floor(leftX / xTickInterval) * xTickInterval;
        const xEnd = Math.ceil(rightX / xTickInterval) * xTickInterval;
        
        for (let x = xStart; x <= xEnd; x += xTickInterval) {
            const screenPos = transform(x, bottomY);
            if (screenPos.x >= 0 && screenPos.x <= actualWidth) {
                // 目盛り線（短い縦線）
                ctx.beginPath();
                ctx.moveTo(screenPos.x, actualHeight - 15);
                ctx.lineTo(screenPos.x, actualHeight - 5);
                ctx.stroke();
                
                // 数値表示（グリッド設定値と同じ小数点以下桁数）
                ctx.textAlign = 'center';
                ctx.fillText(x.toFixed(decimalPlaces), screenPos.x, actualHeight - 18);
            }
        }
        
        // Y軸の目盛り（左端）
        const yStart = Math.floor(bottomY / yTickInterval) * yTickInterval;
        const yEnd = Math.ceil(topY / yTickInterval) * yTickInterval;
        
        for (let y = yStart; y <= yEnd; y += yTickInterval) {
            const screenPos = transform(leftX, y);
            if (screenPos.y >= 0 && screenPos.y <= actualHeight) {
                // 目盛り線（短い横線）
                ctx.beginPath();
                ctx.moveTo(5, screenPos.y);
                ctx.lineTo(15, screenPos.y);
                ctx.stroke();
                
                // 数値表示（グリッド設定値と同じ小数点以下桁数）
                ctx.textAlign = 'right';
                ctx.fillText(y.toFixed(decimalPlaces), 50, screenPos.y + 3);
            }
        }
        
        ctx.restore();
    };

    const drawStructure = (ctx, transform, nodes, members, color, showNodeNumbers = true, showMemberNumbers = true, showCoordinateAxes = false, drawingContext = null) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        const fontScale = getModelFontScale();

        // 投影モードを取得
    const projectionMode = getCurrentProjectionMode();

        // 座標軸を描画（必要な場合）
        if (showCoordinateAxes && drawingContext) {
            const canvas = ctx.canvas;
            drawCoordinateAxes(ctx, transform, drawingContext.scale, drawingContext.offsetX, drawingContext.offsetY, canvas.width, canvas.height);
        }

        // ノードを投影
        const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode));

        // フィルタリング: 選択された座標値の節点のみを表示
        const visibleNodeIndices = getVisibleNodeIndices(nodes);

        // 部材番号の表示位置を計算（重複回避） - 投影後の座標を使用
        const memberLabelPositions = showMemberNumbers ?
            calculateMemberLabelPositions(members, projectedNodes, transform, ctx) : [];

        members.forEach((m, memberIndex) => {
            // 両端の節点が表示対象の場合のみ部材を描画
            if (!visibleNodeIndices.has(m.i) || !visibleNodeIndices.has(m.j)) {
                return;
            }

            const start = transform(projectedNodes[m.i].x, projectedNodes[m.i].y);
            const end = transform(projectedNodes[m.j].x, projectedNodes[m.j].y);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke(); 
            
            // 部材番号を表示（改良版：重複回避）
            if (showMemberNumbers) {
                const labelInfo = memberLabelPositions.find(info => info.memberIndex === memberIndex);
                if (labelInfo) {
                    const memberText = (memberIndex + 1).toString();
                    
                    ctx.font = `${10 * fontScale}px Arial`;
                    ctx.textAlign = "center";
                    
                    // 白背景の四角を描画
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(labelInfo.x, labelInfo.y, labelInfo.width, labelInfo.height);
                    
                    // 黒枠を描画
                    ctx.strokeStyle = "#000000";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(labelInfo.x, labelInfo.y, labelInfo.width, labelInfo.height);
                    
                    // 部材番号テキストを描画
                    ctx.fillStyle = "#000000";
                    ctx.fillText(memberText, labelInfo.textX, labelInfo.textY + 2);
                    
                    // 部材線描画用の設定を復元
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                }
            }
        });
        
        projectedNodes.forEach((projNode, i) => {
            // 表示対象の節点のみを描画
            if (!visibleNodeIndices.has(i)) {
                return;
            }

            const pos = transform(projNode.x, projNode.y);
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI);
            ctx.fill();
            if (showNodeNumbers) {
                ctx.fillStyle = "#333";
                ctx.font = `${12 * fontScale}px Arial`;
                ctx.textAlign = "left";
                ctx.fillText(i + 1, pos.x + 8, pos.y - 8);
            }
        });
    };
    const drawConnections = (ctx, transform, nodes, members) => { ctx.fillStyle = 'white'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; const offset = 6; const projectionMode = getCurrentProjectionMode(); const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode)); const visibleNodeIndices = getVisibleNodeIndices(nodes); members.forEach(m => { if (!visibleNodeIndices.has(m.i) || !visibleNodeIndices.has(m.j)) return; const n_i = projectedNodes[m.i]; const p_i = transform(n_i.x, n_i.y); if (m.i_conn === 'pinned') { const p_i_offset = { x: p_i.x + offset * m.c, y: p_i.y - offset * m.s }; ctx.beginPath(); ctx.arc(p_i_offset.x, p_i_offset.y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); } if (m.j_conn === 'pinned') { const n_j = projectedNodes[m.j]; const p_j = transform(n_j.x, n_j.y); const p_j_offset = { x: p_j.x - offset * m.c, y: p_j.y + offset * m.s }; ctx.beginPath(); ctx.arc(p_j_offset.x, p_j_offset.y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); } }); };

    const projectAxisToScreen = (node, axis, transform, projectionMode) => {
        const axisVectors = {
            x: { x: 1, y: 0, z: 0 },
            y: { x: 0, y: 1, z: 0 },
            z: { x: 0, y: 0, z: 1 }
        };
        const basis = axisVectors[axis];
        if (!basis) {
            return null;
        }
        const originProjected = project3DTo2D(node, projectionMode);
        const offsetNode = {
            x: (node?.x ?? 0) + basis.x,
            y: (node?.y ?? 0) + basis.y,
            z: (node?.z ?? 0) + basis.z
        };
        const offsetProjected = project3DTo2D(offsetNode, projectionMode);
        const originScreen = transform(originProjected.x, originProjected.y);
        const offsetScreen = transform(offsetProjected.x, offsetProjected.y);
        const dir = {
            x: offsetScreen.x - originScreen.x,
            y: offsetScreen.y - originScreen.y
        };
        const len = Math.hypot(dir.x, dir.y);
        if (!isFinite(len) || len < 1e-3) {
            return null;
        }
        return { x: dir.x / len, y: dir.y / len };
    };

    const rotatePoint = (point, angle) => ({
        x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
        y: point.x * Math.sin(angle) + point.y * Math.cos(angle)
    });

    const drawRollerTriangle = (ctx, center, size, angle) => {
        const localPoints = [
            { x: 0, y: -size },
            { x: -size, y: size },
            { x: size, y: size }
        ];
        const rotated = localPoints.map(p => {
            const r = rotatePoint(p, angle);
            return { x: center.x + r.x, y: center.y + r.y };
        });

        ctx.beginPath();
        ctx.moveTo(rotated[0].x, rotated[0].y);
        ctx.lineTo(rotated[1].x, rotated[1].y);
        ctx.lineTo(rotated[2].x, rotated[2].y);
        ctx.closePath();
        ctx.stroke();

        return {
            apex: rotated[0],
            baseLeft: rotated[1],
            baseRight: rotated[2]
        };
    };

    const drawRollerGroundLine = (ctx, baseLeft, baseRight, axisDirection, offset = 4) => {
        let offsetVector;
        if (axisDirection && isFinite(axisDirection.x) && isFinite(axisDirection.y)) {
            offsetVector = {
                x: -axisDirection.x * offset,
                y: -axisDirection.y * offset
            };
        } else {
            offsetVector = { x: 0, y: offset };
        }

        ctx.beginPath();
        ctx.moveTo(baseLeft.x + offsetVector.x, baseLeft.y + offsetVector.y);
        ctx.lineTo(baseRight.x + offsetVector.x, baseRight.y + offsetVector.y);
        ctx.stroke();
    };
    const drawRollerAxisIndicator2D = (ctx, transform, projectionMode, node, screenPos, axis, supportSize = 10) => {
        if (!ctx || !axis) return;
        const style = ROLLER_AXIS_STYLES[axis] || { color: '#555555', label: axis.toUpperCase() };
        const node3D = {
            x: node?.x ?? 0,
            y: node?.y ?? 0,
            z: node?.z ?? 0
        };

        const axisOffset3D = {
            x: node3D.x + (axis === 'x' ? 1 : 0),
            y: node3D.y + (axis === 'y' ? 1 : 0),
            z: node3D.z + (axis === 'z' ? 1 : 0)
        };

        const projectedOffset = project3DTo2D(axisOffset3D, projectionMode);
        const offsetScreen = transform(projectedOffset.x, projectedOffset.y);
        const baseScreen = { x: screenPos.x, y: screenPos.y };
        const dirVec = {
            x: offsetScreen.x - baseScreen.x,
            y: offsetScreen.y - baseScreen.y
        };
        const length = Math.hypot(dirVec.x, dirVec.y);
        const TARGET_LENGTH = 18;

        if (length >= 1e-3) {
            const scale = TARGET_LENGTH / length;
            const arrowVec = {
                x: dirVec.x * scale,
                y: dirVec.y * scale
            };
            ctx.save();
            ctx.strokeStyle = style.color;
            ctx.fillStyle = style.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(baseScreen.x, baseScreen.y);
            ctx.lineTo(baseScreen.x + arrowVec.x, baseScreen.y + arrowVec.y);
            ctx.stroke();

            const headSize = 6;
            const angle = Math.atan2(arrowVec.y, arrowVec.x);
            ctx.beginPath();
            ctx.moveTo(baseScreen.x + arrowVec.x, baseScreen.y + arrowVec.y);
            ctx.lineTo(baseScreen.x + arrowVec.x - headSize * Math.cos(angle - Math.PI / 6), baseScreen.y + arrowVec.y - headSize * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(baseScreen.x + arrowVec.x - headSize * Math.cos(angle + Math.PI / 6), baseScreen.y + arrowVec.y - headSize * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else {
            const fallbackPos = {
                x: baseScreen.x,
                y: baseScreen.y + supportSize + 8
            };
            ctx.save();
            ctx.fillStyle = style.color;
            ctx.beginPath();
            ctx.arc(fallbackPos.x, fallbackPos.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(style.label, fallbackPos.x, fallbackPos.y);
            ctx.restore();
        }
    };
    const drawBoundaryConditions = (ctx, transform, nodes) => {
        const size = 10;
        const projectionMode = getCurrentProjectionMode();
        const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode));
        const visibleNodeIndices = getVisibleNodeIndices(nodes);

        projectedNodes.forEach((projNode, idx) => {
            if (!visibleNodeIndices.has(idx)) return;

            const node = nodes[idx];
            const supportType = normalizeSupportValue(node.support);
            if (supportType === 'free') return;

            const pos = transform(projNode.x, projNode.y);

            ctx.save();
            ctx.strokeStyle = '#008000';
            ctx.fillStyle = '#008000';
            ctx.lineWidth = 1.5;

            if (supportType === 'fixed') {
                ctx.beginPath();
                ctx.moveTo(pos.x - size, pos.y + size);
                ctx.lineTo(pos.x + size, pos.y + size);
                for (let i = 0; i < 5; i++) {
                    ctx.moveTo(pos.x - size + (i * size) / 2, pos.y + size);
                    ctx.lineTo(pos.x - size + (i * size) / 2 - size / 2, pos.y + size + size / 2);
                }
                ctx.stroke();
            } else if (supportType === 'pinned') {
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(pos.x - size, pos.y + size);
                ctx.lineTo(pos.x + size, pos.y + size);
                ctx.closePath();
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(pos.x - size * 1.2, pos.y + size);
                ctx.lineTo(pos.x + size * 1.2, pos.y + size);
                ctx.stroke();
            } else if (isRollerSupport(supportType)) {
                const axis = getRollerAxis(supportType);
                const axisDirection = projectAxisToScreen(node, axis, transform, projectionMode);
                const angle = axisDirection
                    ? Math.atan2(axisDirection.y, axisDirection.x) + Math.PI / 2
                    : 0;

                const triangle = drawRollerTriangle(ctx, pos, size, angle);
                drawRollerGroundLine(ctx, triangle.baseLeft, triangle.baseRight, axisDirection, 4);
            }

            ctx.restore();
        });
    };
    const drawDimensions = (ctx, transform, nodes, members, labelManager, obstacles) => {
        const offset = 15;
        ctx.strokeStyle = '#0000ff';
        ctx.lineWidth = 1;
        const projectionMode = getCurrentProjectionMode();
        const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode));
        const visibleNodeIndices = getVisibleNodeIndices(nodes);
        members.forEach(m => {
            if (!visibleNodeIndices.has(m.i) || !visibleNodeIndices.has(m.j)) return;
            const n1 = projectedNodes[m.i];
            const n2 = projectedNodes[m.j];
            const p1 = transform(n1.x, n1.y);
            const p2 = transform(n2.x, n2.y);
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            const offsetX = offset * Math.sin(angle);
            const offsetY = -offset * Math.cos(angle);
            const labelTargetX = midX + offsetX;
            const labelTargetY = midY + offsetY;
            const labelText = `${m.length.toFixed(2)}m`;
            ctx.fillStyle = '#0000ff';
            labelManager.draw(ctx, labelText, labelTargetX, labelTargetY, obstacles);
        });
    };
    const getProjectionModeValue = () => getCurrentProjectionMode();

    const buildConcentratedLoadRules = (projectionMode, is3DModeActive) => {
        const displayRules = {
            px: { source: 'px', axis: 'x', show: true, directionMultiplier: 1, label: 'node-load-px' },
            py: { source: 'py', axis: 'y', show: true, directionMultiplier: 1, label: 'node-load-py' },
            pz: { source: 'pz', axis: 'z', show: true, directionMultiplier: 1, label: 'node-load-pz' }
        };

        const calcRules = {
            px: { source: 'px', multiplier: 1 },
            py: { source: 'py', multiplier: 1 },
            pz: { source: 'pz', multiplier: 1 }
        };

        if (!is3DModeActive) {
            switch (projectionMode) {
                case 'xy':
                    displayRules.py.directionMultiplier = 1;
                    displayRules.pz.show = false;
                    calcRules.px.multiplier = 1;
                    break;
                case 'xz':
                    displayRules.py.show = false;
                    displayRules.pz.directionMultiplier = -1;
                    calcRules.px.multiplier = 1;
                    break;
                case 'yz':
                    displayRules.px.show = false;
                    displayRules.pz.directionMultiplier = -1;
                    break;
                case 'iso':
                    displayRules.pz.directionMultiplier = -1;
                    calcRules.px.multiplier = 1;
                    break;
                default:
                    break;
            }
        } else {
            switch (projectionMode) {
                case 'iso':
                    displayRules.pz.directionMultiplier = -1;
                    calcRules.px.multiplier = -1;
                    break;
                default:
                    break;
            }
        }

        return { displayRules, calcRules };
    };

    const applyCalcRulesToLoad = (load, calcRules) => {
        const clone = { ...load };
        const applyAxis = (axisKey) => {
            const rule = calcRules[axisKey];
            const fallbackValue = Number(load[axisKey]) || 0;
            if (!rule) {
                return fallbackValue;
            }
            const multiplier = rule.multiplier ?? 1;
            if (Math.abs(multiplier) < 1e-9) {
                return 0;
            }
            const sourceKey = rule.source || axisKey;
            return Number(load[sourceKey]) || 0;
        };

        clone.px = applyAxis('px');
        clone.py = applyAxis('py');
        clone.pz = applyAxis('pz');
        return clone;
    };

    const createDisplayComponents = (load, displayRules) => {
        const components = [];
        const EPS = 1e-9;
        Object.entries(displayRules).forEach(([key, rule]) => {
            if (!rule || rule.show === false) {
                return;
            }
            const sourceKey = rule.source || key;
            const rawValue = Number(load[sourceKey]) || 0;
            if (Math.abs(rawValue) <= EPS) {
                return;
            }
            const axis = rule.axis || key.replace(/^p/, '');
            components.push({
                axis,
                value: rawValue,
                directionMultiplier: rule.directionMultiplier ?? 1,
                labelType: rule.label || `node-load-${sourceKey}`,
                sourceKey
            });
        });
        return components;
    };

    const AXIS_VECTORS = Object.freeze({
        x: { x: 1, y: 0, z: 0 },
        y: { x: 0, y: 1, z: 0 },
        z: { x: 0, y: 0, z: 1 }
    });

    const drawExternalLoads = (ctx, transform, nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights, labelManager, obstacles) => {
        const arrowSize = 10;
        const loadScale = 3;

        // 投影モードを取得してノードを投影
    const projectionMode = elements.projectionMode ? elements.projectionMode.value : DEFAULT_PROJECTION_MODE;
        const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode));
    const is3DModeActive = window.is3DMode === true;
    const { displayRules } = buildConcentratedLoadRules(projectionMode, is3DModeActive);
    const concentratedArrowRecords = [];

        // 表示対象の節点インデックスを取得
        const visibleNodeIndices = getVisibleNodeIndices(nodes);

        // 表示制御用チェックボックスの状態を取得
        const showExternalLoads = document.getElementById('show-external-loads')?.checked ?? true;
        const showSelfWeight = document.getElementById('show-self-weight')?.checked ?? true;

        // 両方のチェックが外れている場合は何も描画しない
        if (!showExternalLoads && !showSelfWeight) {
            return;
        }

        // memberSelfWeightsをmemberLoadsに統合（自重をグローバルZ方向の等分布荷重として扱う）
        const allMemberLoads = [...memberLoads];
        if (memberSelfWeights && memberSelfWeights.length > 0) {
            memberSelfWeights.forEach(selfWeight => {
                // 自重のwプロパティをwz（グローバルZ方向）に変換して追加
                // selfWeight.wは正の値（大きさ）で、そのまま正の値として格納
                // 描画時にZ軸負方向ベクトルと組み合わせて下向きにする
                allMemberLoads.push({
                    memberIndex: selfWeight.memberIndex,
                    wx: 0,
                    wy: 0,
                    wz: selfWeight.w,  // 正の値（大きさ）
                    isFromSelfWeight: true
                });
            });
        }

    ctx.strokeStyle = '#ff4500';
    ctx.fillStyle = '#ff4500';
        ctx.lineWidth = 1.5;

        // 分布荷重のテキスト領域を障害物として追加
        const loadObstacles = [...obstacles];
        const getDistributedLoadOrientationMultiplier = (axisLabel, isSelfWeight = false) => {
            // 分布荷重の描画方向を軸ごとに補正
            // モデル図ではグローバルX/Y方向の矢印が反転して描画されていたため補正する
            if (axisLabel === 'Wx' || axisLabel === 'Wy') {
                return -1;
            }
            return 1;
        };

        const subtractVec3 = (a, b) => ({
            x: (a?.x ?? 0) - (b?.x ?? 0),
            y: (a?.y ?? 0) - (b?.y ?? 0),
            z: (a?.z ?? 0) - (b?.z ?? 0)
        });
        const crossVec3 = (a, b) => ({
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        });
        const lengthVec3 = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        const normalizeVec3 = (v) => {
            const len = lengthVec3(v);
            if (!isFinite(len) || len < 1e-9) return null;
            return { x: v.x / len, y: v.y / len, z: v.z / len };
        };
        const projectDirection2D = (originNode, direction) => {
            const originProjected = project3DTo2D(originNode, projectionMode);
            const offsetNode = {
                x: (originNode?.x ?? 0) + direction.x,
                y: (originNode?.y ?? 0) + direction.y,
                z: (originNode?.z ?? 0) + direction.z
            };
            const offsetProjected = project3DTo2D(offsetNode, projectionMode);
            return {
                x: offsetProjected.x - originProjected.x,
                y: offsetProjected.y - originProjected.y
            };
        };
        const lengthVec2 = (v) => Math.sqrt(v.x * v.x + v.y * v.y);
        const normalizeVec2 = (v) => {
            const len = lengthVec2(v);
            if (!isFinite(len) || len < 1e-6) return null;
            return { x: v.x / len, y: v.y / len };
        };
        const projectedDirectionCache = new Map();
        const getProjectedLocalDirection = (memberIndex, component) => {
            const cacheKey = `${memberIndex}-${component}-${projectionMode}`;
            if (projectedDirectionCache.has(cacheKey)) {
                return projectedDirectionCache.get(cacheKey);
            }

            const member = members[memberIndex];
            if (!member) return null;
            const nodeI = nodes[member.i];
            const nodeJ = nodes[member.j];
            if (!nodeI || !nodeJ) return null;

            const axisVec = subtractVec3(nodeJ, nodeI);
            const axisUnit = normalizeVec3(axisVec);
            if (!axisUnit) return null;

            const globalUp = { x: 0, y: 0, z: 1 };
            let localY3D = crossVec3(axisUnit, globalUp);
            if (!localY3D || lengthVec3(localY3D) < 1e-9) {
                localY3D = crossVec3(axisUnit, { x: 1, y: 0, z: 0 });
            }
            if (!localY3D || lengthVec3(localY3D) < 1e-9) {
                localY3D = crossVec3(axisUnit, { x: 0, y: 1, z: 0 });
            }
            const localYUnit = normalizeVec3(localY3D);
            if (!localYUnit) return null;
            const localZ3D = crossVec3(axisUnit, localYUnit);
            const localZUnit = normalizeVec3(localZ3D);
            if (!localZUnit) return null;

            const targetDirection3D = component === 'localZ' ? localZUnit : localYUnit;
            const projectedDir = projectDirection2D(nodeI, targetDirection3D);
            const normalizedDir = normalizeVec2(projectedDir);
            if (!normalizedDir) return null;

            projectedDirectionCache.set(cacheKey, normalizedDir);
            return normalizedDir;
        };

        const projectGlobalDirection = (point3D, vector3D) => {
            if (!point3D || !vector3D) return null;
            const baseProj = project3DTo2D(point3D, projectionMode);
            const offsetPoint = {
                x: point3D.x + (vector3D.x || 0),
                y: point3D.y + (vector3D.y || 0),
                z: point3D.z + (vector3D.z || 0)
            };
            const offsetProj = project3DTo2D(offsetPoint, projectionMode);
            
            const baseScreen = transform(baseProj.x, baseProj.y);
            const offsetScreen = transform(offsetProj.x, offsetProj.y);
            const dx = offsetScreen.x - baseScreen.x;
            const dy = offsetScreen.y - baseScreen.y;
            
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) {
                return null;
            }
            let result = { x: dx / len, y: dy / len };

            // 純粋なZ軸ベクトル（上下方向）の場合、y座標を反転
            // これにより、Z軸負方向（下向き）が画面上で下向きに描画される
            const EPS = 1e-9;
            const isPureZAxis = Math.abs(vector3D.z || 0) > EPS &&
                Math.abs(vector3D.x || 0) < EPS &&
                Math.abs(vector3D.y || 0) < EPS;
            if (isPureZAxis) {
                result = { x: result.x, y: -result.y };
            }

            return result;
        };

        // まず分布荷重を描画して、そのテキスト領域と矢印領域を障害物に追加
        allMemberLoads.forEach(load => {
            const isSelfWeightLoad = !!load.isFromSelfWeight;
            if (isSelfWeightLoad) {
                if (!showSelfWeight) return;
            } else if (!showExternalLoads) {
                return;
            }

            const considerSelfWeightCheckbox = document.getElementById('consider-self-weight-checkbox');
            const isSelfWeightChecked = considerSelfWeightCheckbox && considerSelfWeightCheckbox.checked;
            if (isSelfWeightLoad && !isSelfWeightChecked) {
                return;
            }

            const member = members[load.memberIndex];
            if (!member) return;

            if (!visibleNodeIndices.has(member.i) || !visibleNodeIndices.has(member.j)) return;
            const nodeI = nodes[member.i];
            const nodeJ = nodes[member.j];
            if (!nodeI || !nodeJ) return;

            const midPoint = {
                x: ((nodeI.x ?? 0) + (nodeJ.x ?? 0)) / 2,
                y: ((nodeI.y ?? 0) + (nodeJ.y ?? 0)) / 2,
                z: ((nodeI.z ?? 0) + (nodeJ.z ?? 0)) / 2
            };

            const p1 = transform(projectedNodes[member.i].x, projectedNodes[member.i].y);
            const p2 = transform(projectedNodes[member.j].x, projectedNodes[member.j].y);
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            const numArrows = 5;
            const arrowLength = arrowSize * 1.5;
            const arrowHeadSize = 5;
            const defaultDirection2D = { x: Math.sin(angle), y: -Math.cos(angle) };
            const defaultDirectionNorm = normalizeVec2(defaultDirection2D) || { x: 0, y: -1 };

            const EPS = 1e-9;
            // グローバル成分を取得（load.globalが優先、なければload.wx/wy/wz）
            const wxValue = load.global ? (Number(load.global.wx) || 0) : (Number(load.wx) || 0);
            const wyValue = load.global ? (Number(load.global.wy) || 0) : (Number(load.wy) || 0);
            const wzValue = load.global ? (Number(load.global.wz) || 0) : (Number(load.wz) || 0);
            const legacyValue = Number(load.w);
            const hasLegacyW = Number.isFinite(legacyValue) && Math.abs(legacyValue) > EPS;

            const components = [];
            // 自重の場合はZ軸を負方向（下向き）に設定
            const zVector = isSelfWeightLoad ? { x: 0, y: 0, z: -1 } : { x: 0, y: 0, z: 1 };
            const axisDefinitions = [
                { value: wxValue, label: 'Wx', vector: { x: 1, y: 0, z: 0 } },
                { value: wyValue, label: 'Wy', vector: { x: 0, y: 1, z: 0 } },
                { value: wzValue, label: 'Wz', vector: zVector }
            ];

            axisDefinitions.forEach(axis => {
                if (!Number.isFinite(axis.value) || Math.abs(axis.value) <= EPS) {
                    return;
                }
                const projectedDir = projectGlobalDirection(midPoint, axis.vector);
                if (!projectedDir) {
                    return;
                }
                components.push({ w: axis.value, direction: projectedDir, label: axis.label });
            });

            if (components.length === 0 && hasLegacyW) {
                const projectedDir = projectGlobalDirection(midPoint, { x: 0, y: 0, z: 1 });
                if (projectedDir) {
                    components.push({ w: legacyValue, direction: projectedDir, label: 'W' });
                }
            }

            if (components.length === 0) {
                return;
            }

            // 自重と外部荷重で色を変える
            if (isSelfWeightLoad) {
                ctx.strokeStyle = '#00aa00';  // 自重は緑色
                ctx.fillStyle = '#00aa00';
            } else {
                ctx.strokeStyle = '#ff4500';  // 外部荷重は赤色
                ctx.fillStyle = '#ff4500';
            }

            components.forEach(component => {
                // 自重の場合: 負の値で格納されている（下向き）
                // 外部荷重の場合: ユーザー入力値の符号をそのまま使用
                // 3Dモード: 符号をそのまま反映
                // 2Dモード: orientationSignで反転（projectGlobalDirectionのy軸反転を補正）
                const baseSign = Math.sign(component.w || 1);
                const orientationSign = getDistributedLoadOrientationMultiplier(component.label, isSelfWeightLoad);
                const dir = baseSign * orientationSign;
                const dirNorm = normalizeVec2(component.direction) || defaultDirectionNorm;
                const firstArrowTipX = p1.x + dir * arrowLength * dirNorm.x;
                const firstArrowTipY = p1.y + dir * arrowLength * dirNorm.y;
                const lastArrowTipX = p2.x + dir * arrowLength * dirNorm.x;
                const lastArrowTipY = p2.y + dir * arrowLength * dirNorm.y;

                const arrowMinX = Math.min(p1.x, p2.x, firstArrowTipX, lastArrowTipX);
                const arrowMaxX = Math.max(p1.x, p2.x, firstArrowTipX, lastArrowTipX);
                const arrowMinY = Math.min(p1.y, p2.y, firstArrowTipY, lastArrowTipY);
                const arrowMaxY = Math.max(p1.y, p2.y, firstArrowTipY, lastArrowTipY);
                const arrowPadding = 5;
                const arrowObstacle = {
                    x1: arrowMinX - arrowPadding,
                    y1: arrowMinY - arrowPadding,
                    x2: arrowMaxX + arrowPadding,
                    y2: arrowMaxY + arrowPadding
                };
                loadObstacles.push(arrowObstacle);

                // 3Dモードで自重の場合は矢印を描画しない（ラベルのみ）
                const is3DModeActive = window.is3DMode === true;
                const skipArrowDrawing = is3DModeActive && isSelfWeightLoad;
                
                if (!skipArrowDrawing) {
                    ctx.beginPath();
                    ctx.moveTo(firstArrowTipX, firstArrowTipY);
                    ctx.lineTo(lastArrowTipX, lastArrowTipY);
                    ctx.stroke();

                    for (let i = 0; i <= numArrows; i++) {
                        const ratio = i / numArrows;
                        const memberX = p1.x + (p2.x - p1.x) * ratio;
                        const memberY = p1.y + (p2.y - p1.y) * ratio;
                        const baseX = memberX + dir * arrowLength * dirNorm.x;
                        const baseY = memberY + dir * arrowLength * dirNorm.y;
                        ctx.beginPath();
                        ctx.moveTo(baseX, baseY);
                        ctx.lineTo(memberX, memberY);
                        const headAngle = Math.atan2(memberY - baseY, memberX - baseX);
                        ctx.moveTo(memberX, memberY);
                        ctx.lineTo(memberX - arrowHeadSize * Math.cos(headAngle - Math.PI / 6), memberY - arrowHeadSize * Math.sin(headAngle - Math.PI / 6));
                        ctx.moveTo(memberX, memberY);
                        ctx.lineTo(memberX - arrowHeadSize * Math.cos(headAngle + Math.PI / 6), memberY - arrowHeadSize * Math.sin(headAngle + Math.PI / 6));
                        ctx.stroke();
                    }
                }

                const textOffset = arrowLength + 10;
                const textX = (p1.x + p2.x) / 2 + dir * textOffset * dirNorm.x;
                const textY = (p1.y + p2.y) / 2 + dir * textOffset * dirNorm.y;

                const labelPrefix = component.label ? `${component.label}=` : '';
                const selfWeightPrefix = isSelfWeightLoad ? '自重 ' : '';
                const loadText = `${selfWeightPrefix}${labelPrefix}${Math.abs(component.w).toFixed(2)}kN/m`;
                labelManager.draw(ctx, loadText, textX, textY, [...obstacles, arrowObstacle], {
                    type: 'member-load-w',
                    index: load.memberIndex,
                    component: component.label || 'default',
                    value: component.w
                });

                const metrics = ctx.measureText(loadText);
                const textWidth = metrics.width;
                const textHeight = 12;
                const padding = 6;
                loadObstacles.push({
                    x1: textX - textWidth / 2 - padding,
                    y1: textY - textHeight - padding,
                    x2: textX + textWidth / 2 + padding,
                    y2: textY + padding
                });
            });
        }); 
        
        // 等分布荷重描画後に色をリセット
        // 次に集中荷重を描画
        if (showExternalLoads) {
            nodeLoads.forEach(load => {
                if (!visibleNodeIndices.has(load.nodeIndex)) return;
                const displayComponents = createDisplayComponents(load, displayRules);
                const nodeProjected = projectedNodes[load.nodeIndex];
                const node3D = nodes[load.nodeIndex];
                const pos = transform(nodeProjected.x, nodeProjected.y);

                const concentratedColor = '#1e90ff';
                ctx.strokeStyle = concentratedColor;
                ctx.fillStyle = concentratedColor;

                displayComponents.forEach(component => {
                    const axisVector = AXIS_VECTORS[component.axis];
                    if (!axisVector) {
                        return;
                    }

                    let projectedDir = projectGlobalDirection(node3D, axisVector);
                    if (!projectedDir && projectionMode === 'yz' && component.axis === 'x') {
                        projectedDir = { x: 1, y: 0 };
                    }
                    if (!projectedDir) {
                        return;
                    }

                    const dirNorm = normalizeVec2(projectedDir);
                    if (!dirNorm) {
                        return;
                    }

                    const orientationMultiplier = component.directionMultiplier ?? 1;
                    const sign = component.value >= 0 ? 1 : -1;
                    const direction = {
                        x: dirNorm.x * orientationMultiplier * sign,
                        y: dirNorm.y * orientationMultiplier * sign
                    };

                    const arrowLength = arrowSize * loadScale;
                    const tailX = pos.x - direction.x * arrowLength;
                    const tailY = pos.y - direction.y * arrowLength;

                    ctx.beginPath();
                    ctx.moveTo(tailX, tailY);
                    ctx.lineTo(pos.x, pos.y);
                    ctx.stroke();

                    const headAngle = Math.atan2(pos.y - tailY, pos.x - tailX);
                    ctx.beginPath();
                    ctx.moveTo(pos.x, pos.y);
                    ctx.lineTo(
                        pos.x - arrowSize * Math.cos(headAngle - Math.PI / 6),
                        pos.y - arrowSize * Math.sin(headAngle - Math.PI / 6)
                    );
                    ctx.moveTo(pos.x, pos.y);
                    ctx.lineTo(
                        pos.x - arrowSize * Math.cos(headAngle + Math.PI / 6),
                        pos.y - arrowSize * Math.sin(headAngle + Math.PI / 6)
                    );
                    ctx.stroke();

                    const textOffset = arrowLength * 0.3;
                    const textX = pos.x - direction.x * textOffset;
                    const textY = pos.y - direction.y * textOffset;
                    const valueText = `${component.value}kN`;
                    labelManager.draw(ctx, valueText, textX, textY, loadObstacles, {
                        type: component.labelType,
                        index: load.nodeIndex,
                        value: component.value
                    });

                    const textMetrics = ctx.measureText(valueText);
                    const textWidth = textMetrics.width;
                    const textHeight = 12;
                    const padding = 6;
                    loadObstacles.push({
                        x1: textX - textWidth / 2 - padding,
                        y1: textY - textHeight - padding,
                        x2: textX + textWidth / 2 + padding,
                        y2: textY + padding
                    });

                    const arrowMinX = Math.min(tailX, pos.x);
                    const arrowMaxX = Math.max(tailX, pos.x);
                    const arrowMinY = Math.min(tailY, pos.y);
                    const arrowMaxY = Math.max(tailY, pos.y);
                    const arrowPadding = 5;
                    loadObstacles.push({
                        x1: arrowMinX - arrowPadding,
                        y1: arrowMinY - arrowPadding,
                        x2: arrowMaxX + arrowPadding,
                        y2: arrowMaxY + arrowPadding
                    });

                    concentratedArrowRecords.push({
                        nodeIndex: load.nodeIndex,
                        axis: component.axis,
                        sourceKey: component.sourceKey,
                        tail: { x: tailX, y: tailY },
                        head: { x: pos.x, y: pos.y },
                        value: component.value
                    });
                });
            });
        }

        window.lastConcentratedLoadArrows = concentratedArrowRecords;
        
        // 自重による集中荷重を緑色で描画
    if (showSelfWeight) {
            // 3Dモードでは矢印を描画せず、ラベルのみ表示
            const is3DModeActive = window.is3DMode === true;
            
            // 1. 個別の矢印描画（3Dモードではスキップ）
            if (!is3DModeActive) {
                nodeSelfWeights.forEach(load => {
                    if (load.pz === undefined || load.pz === 0) return;
                    // 節点が表示対象でない場合はスキップ
                    if (!visibleNodeIndices.has(load.nodeIndex)) return;
                    const node3D = nodes[load.nodeIndex];
                    const projectedNode = projectedNodes[load.nodeIndex];
                    const pos = transform(projectedNode.x, projectedNode.y);
                    
                    // 自重荷重用の緑色で描画
                    ctx.strokeStyle = '#32CD32';
                    ctx.fillStyle = '#32CD32';
                
                if (load.pz && load.pz !== 0) {
                    // 自重の集中荷重: pzは負の値で格納されている（下向き）
                    // 矢印を正しい方向に描画するため、符号をそのまま使用
                    const directionSign = -Math.sign(load.pz);
                    const projectedDir = projectGlobalDirection(node3D, { x: 0, y: 0, z: directionSign });
                    const hasProjectedDir = projectedDir && Math.hypot(projectedDir.x, projectedDir.y) > 1e-6;

                    if (hasProjectedDir) {
                        const direction2D = normalizeVec2(projectedDir);
                        if (!direction2D) {
                            console.warn(`節点${load.nodeIndex + 1}: 自重方向が正規化できず描画をスキップします。`, projectedDir);
                            return;
                        }
                        const perpDir = normalizeVec2({ x: -direction2D.y, y: direction2D.x }) || { x: 1, y: 0 };
                        const arrowLen = arrowSize * loadScale;
                        const headX = pos.x;
                        const headY = pos.y;
                        const tailX = headX - direction2D.x * arrowLen;
                        const tailY = headY - direction2D.y * arrowLen;

                        ctx.beginPath();
                        ctx.moveTo(tailX, tailY);
                        ctx.lineTo(headX, headY);
                        ctx.stroke();

                        const headLength = arrowSize * 0.9;
                        const headWidth = arrowSize * 0.6;
                        const leftX = headX - direction2D.x * headLength + perpDir.x * headWidth;
                        const leftY = headY - direction2D.y * headLength + perpDir.y * headWidth;
                        const rightX = headX - direction2D.x * headLength - perpDir.x * headWidth;
                        const rightY = headY - direction2D.y * headLength - perpDir.y * headWidth;

                        ctx.beginPath();
                        ctx.moveTo(headX, headY);
                        ctx.lineTo(leftX, leftY);
                        ctx.moveTo(headX, headY);
                        ctx.lineTo(rightX, rightY);
                        ctx.stroke();
                    } else {
                        const radius = arrowSize * 0.7;
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, radius * 0.4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            });
        }
        
        // 2. 節点ごとの合計荷重を計算してラベル表示
        const nodeWeightSummary = new Map();
        console.log('📊 nodeSelfWeights詳細:');
        nodeSelfWeights.forEach((load, idx) => {
            const pz = (load.pz || 0).toFixed(3);
            console.log(`  [${idx}] 節点${load.nodeIndex + 1}: pz=${pz}`);
            
            const nodeIndex = load.nodeIndex;
            if (!nodeWeightSummary.has(nodeIndex)) {
                nodeWeightSummary.set(nodeIndex, { pz: 0 });
            }
            
            const summary = nodeWeightSummary.get(nodeIndex);
            summary.pz += load.pz || 0;
        });
        
        // デバッグログ
        console.log('📊 節点自重表示処理:');
        console.log('  対象節点荷重数:', nodeSelfWeights.length);
        console.log('  表示予定節点数:', nodeWeightSummary.size);
        nodeWeightSummary.forEach((totalLoad, nodeIndex) => {
            const totalForce = Math.abs(totalLoad.pz);
            console.log(`  節点${nodeIndex + 1}: Pz=${totalLoad.pz.toFixed(3)}kN`);
        });
        
        // 3. 合計ラベルを描画
        nodeWeightSummary.forEach((totalLoad, nodeIndex) => {
            const node = projectedNodes[nodeIndex];
            const pos = transform(node.x, node.y);
            const nodeNumber = nodeIndex + 1;
            
            // 合計荷重を計算（Pzのみ）
            const totalForce = Math.abs(totalLoad.pz);
            
            // デバッグログ
            console.log(`  節点${nodeNumber}処理中: Pz=${totalLoad.pz.toFixed(3)}`);
            
            // 表示のしきい値をより低く設定
            if (totalForce < 0.001) {
                console.log(`  節点${nodeNumber}: しきい値未満でスキップ (合力=${totalForce.toFixed(6)})`);
                return;
            }
            
            // 表示位置を決定（最も大きな荷重成分の位置を基準）
            let textX, textY;
            
            if (totalLoad.pz !== 0) {
                const forceDirection = totalLoad.pz > 0 ? 1 : -1;
                const projected = projectGlobalDirection(nodes[nodeIndex], { x: 0, y: 0, z: forceDirection }) || { x: 0, y: forceDirection > 0 ? -1 : 1 };
                const dir2D = normalizeVec2(projected) || { x: 0, y: forceDirection > 0 ? -1 : 1 };
                textX = pos.x - dir2D.x * (arrowSize * loadScale * 1.1);
                textY = pos.y - dir2D.y * (arrowSize * loadScale * 1.1);
            } else {
                // デフォルト位置
                textX = pos.x + 8;
                textY = pos.y - 8;
            }
            
            // 合計荷重値のテキスト表示
            ctx.fillStyle = '#32CD32';
            const directionLabel = totalLoad.pz > 0 ? '+Z (上向き)' : '-Z (下向き)';
            const labelText = `節点${nodeNumber}自重：Pz=${totalLoad.pz.toFixed(2)}kN ${directionLabel}`;
            
            console.log(`  節点${nodeNumber}: "${labelText}" を位置 (${textX.toFixed(1)}, ${textY.toFixed(1)}) に表示`);
            labelManager.draw(ctx, labelText, textX, textY, loadObstacles);
        }); 
        }

        // ==========================================================
        // ▼▼▼ 強制変位を描画（節点荷重と同じルールで方向決定） ▼▼▼
        // ==========================================================
        const forcedArrowScale = 2.2;
        const forcedColor = '#8e44ad';
        const forcedLineWidth = 2.4;
        const forcedLabelPrefix = { x: 'ΔX', y: 'ΔY', z: 'ΔZ' };
        const forcedEPS = 1e-9;

        nodes.forEach((node, i) => {
            if (!visibleNodeIndices.has(i)) {
                return;
            }

            const components = [
                { axis: 'x', value: node.dx_forced ?? 0, rule: displayRules?.px },
                { axis: 'y', value: node.dy_forced ?? 0, rule: displayRules?.py },
                { axis: 'z', value: node.dz_forced ?? 0, rule: displayRules?.pz }
            ].filter(component => Math.abs(component.value) > forcedEPS && (component.rule?.show !== false));

            if (components.length === 0) {
                return;
            }

            const projected = projectedNodes[i];
            if (!projected) {
                return;
            }

            const pos = transform(projected.x, projected.y);

            components.forEach(component => {
                const axisVector = AXIS_VECTORS[component.axis];
                if (!axisVector) {
                    return;
                }

                let projectedDir = projectGlobalDirection(node, axisVector);
                if (!projectedDir && projectionMode === 'yz' && component.axis === 'x') {
                    projectedDir = { x: 1, y: 0 };
                }
                const dirNorm = projectedDir ? normalizeVec2(projectedDir) : null;
                if (!dirNorm) {
                    return;
                }

                const directionMultiplier = component.rule?.directionMultiplier ?? 1;
                const sign = component.value >= 0 ? 1 : -1;
                const direction = {
                    x: dirNorm.x * directionMultiplier * sign,
                    y: dirNorm.y * directionMultiplier * sign
                };

                const arrowLength = arrowSize * forcedArrowScale;
                const tailX = pos.x - direction.x * arrowLength;
                const tailY = pos.y - direction.y * arrowLength;

                ctx.save();
                ctx.strokeStyle = forcedColor;
                ctx.fillStyle = forcedColor;
                ctx.lineWidth = forcedLineWidth;

                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();

                const headAngle = Math.atan2(pos.y - tailY, pos.x - tailX);
                const headLength = arrowSize * 0.9;
                const headWidth = arrowSize * 0.6;

                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(
                    pos.x - headLength * Math.cos(headAngle - Math.PI / 6),
                    pos.y - headLength * Math.sin(headAngle - Math.PI / 6)
                );
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(
                    pos.x - headLength * Math.cos(headAngle + Math.PI / 6),
                    pos.y - headLength * Math.sin(headAngle + Math.PI / 6)
                );
                ctx.stroke();

                const textOffset = arrowLength * 0.35;
                const textX = pos.x - direction.x * textOffset;
                const textY = pos.y - direction.y * textOffset;
                const valueText = `${forcedLabelPrefix[component.axis] || component.axis.toUpperCase()}=${(component.value * 1000).toFixed(1)}mm`;
                labelManager.draw(ctx, valueText, textX, textY, loadObstacles, {
                    type: `forced-displacement-${component.axis}`,
                    index: i,
                    value: component.value
                });

                const textMetrics = ctx.measureText(valueText);
                const textWidth = textMetrics.width;
                const textHeight = 12;
                const padding = 6;
                loadObstacles.push({
                    x1: textX - textWidth / 2 - padding,
                    y1: textY - textHeight - padding,
                    x2: textX + textWidth / 2 + padding,
                    y2: textY + padding
                });

                const arrowMinX = Math.min(tailX, pos.x);
                const arrowMaxX = Math.max(tailX, pos.x);
                const arrowMinY = Math.min(tailY, pos.y);
                const arrowMaxY = Math.max(tailY, pos.y);
                const arrowPadding = 5;
                loadObstacles.push({
                    x1: arrowMinX - arrowPadding,
                    y1: arrowMinY - arrowPadding,
                    x2: arrowMaxX + arrowPadding,
                    y2: arrowMaxY + arrowPadding
                });

                ctx.restore();
            });
        });
        // ==========================================================
        // ▲▲▲ 強制変位描画ここまで ▲▲▲
        // ==========================================================
    };
    // 表示対象の節点インデックスを取得する関数
    function getVisibleNodeIndices(nodes) {
    const projectionMode = getCurrentProjectionMode();
        const hiddenCoord = elements.hiddenAxisCoord ? parseFloat(elements.hiddenAxisCoord.value) : null;
        const tolerance = 0.01;
        const visibleNodeIndices = new Set();

        if (hiddenCoord !== null && !isNaN(hiddenCoord) && projectionMode !== 'iso') {
            nodes.forEach((node, idx) => {
                let coordToCheck = 0;
                if (projectionMode === 'xy') {
                    coordToCheck = node.z;
                } else if (projectionMode === 'xz') {
                    coordToCheck = node.y;
                } else if (projectionMode === 'yz') {
                    coordToCheck = node.x;
                }
                if (Math.abs(coordToCheck - hiddenCoord) < tolerance) {
                    visibleNodeIndices.add(idx);
                }
            });
        } else {
            // 等角投影または座標値が無効な場合は全て表示
            nodes.forEach((_, idx) => visibleNodeIndices.add(idx));
        }

        return visibleNodeIndices;
    }
    window.getVisibleNodeIndices = getVisibleNodeIndices;

    // 各投影面の全ての座標値を取得する関数
    const getAllFrameCoordinates = (nodes, projectionMode) => {
        const uniqueCoords = new Set();
        const tolerance = 0.01;

        nodes.forEach(node => {
            let coord = 0;
            if (projectionMode === 'xy') {
                coord = node.z;
            } else if (projectionMode === 'xz') {
                coord = node.y;
            } else if (projectionMode === 'yz') {
                coord = node.x;
            }

            // 誤差範囲内で丸める
            const roundedCoord = Math.round(coord / tolerance) * tolerance;
            uniqueCoords.add(roundedCoord);
        });

        return [...uniqueCoords].sort((a, b) => a - b);
    };

    const drawGrid = (ctx, transform, width, height) => { const { x: minX, y: maxY } = inverseTransform(0,0); const { x: maxX, y: minY } = inverseTransform(width, height); const spacing = parseFloat(elements.gridSpacing.value); if (isNaN(spacing) || spacing <= 0) return; ctx.strokeStyle = '#e9e9e9'; ctx.lineWidth = 1; const startX = Math.floor(minX / spacing) * spacing; for (let x = startX; x <= maxX; x += spacing) { const p1 = transform(x, minY); const p2 = transform(x, maxY); ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); } const startY = Math.floor(minY / spacing) * spacing; for (let y = startY; y <= maxY; y += spacing) { const p1 = transform(minX, y); const p2 = transform(maxX, y); ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); } };
    const drawAxisIndicator = (ctx, width, height, projectionMode) => {
        const margin = 60;
        const arrowLength = 40;
        const originX = margin;
        const originY = height - margin;

        const computeAxisDirection = (vector) => {
            const projected = project3DTo2D(vector, projectionMode);
            const screenDx = projected.x;
            const screenDy = -projected.y;
            const length = Math.hypot(screenDx, screenDy);
            if (length < 1e-6) return null;
            return { dx: screenDx / length, dy: screenDy / length };
        };

        const axes = [];
        const addAxis = (label, vector, color) => {
            const dir = computeAxisDirection(vector);
            if (!dir) return;
            axes.push({ label, color, ...dir });
        };

        if (projectionMode === 'xy') {
            addAxis('X', { x: 1, y: 0, z: 0 }, '#ff0000');
            addAxis('Y', { x: 0, y: 1, z: 0 }, '#00ff00');
        } else if (projectionMode === 'xz') {
            addAxis('X', { x: 1, y: 0, z: 0 }, '#ff0000');
            addAxis('Z', { x: 0, y: 0, z: 1 }, '#0000ff');
        } else if (projectionMode === 'yz') {
            addAxis('Y', { x: 0, y: 1, z: 0 }, '#00ff00');
            addAxis('Z', { x: 0, y: 0, z: 1 }, '#0000ff');
        } else if (projectionMode === 'iso') {
            addAxis('X', { x: 1, y: 0, z: 0 }, '#ff0000');
            addAxis('Y', { x: 0, y: 1, z: 0 }, '#00ff00');
            addAxis('Z', { x: 0, y: 0, z: 1 }, '#0000ff');
        }

        // 各軸を描画
        axes.forEach(axis => {
            const endX = originX + axis.dx * arrowLength;
            const endY = originY + axis.dy * arrowLength;

            // 矢印の線
            ctx.strokeStyle = axis.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(originX, originY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // 矢印の先端
            const arrowHeadLength = 8;
            const angle = Math.atan2(axis.dy, axis.dx);
            ctx.fillStyle = axis.color;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
                endX - arrowHeadLength * Math.cos(angle - Math.PI / 6),
                endY - arrowHeadLength * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
                endX - arrowHeadLength * Math.cos(angle + Math.PI / 6),
                endY - arrowHeadLength * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();

            // ラベル
            ctx.fillStyle = axis.color;
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(axis.label, endX + axis.dx * 15, endY + axis.dy * 15);
        });
    };
    const LabelManager = () => {
        const drawnLabels = []; // 描画したラベル情報をすべて保存する配列
        const isOverlapping = (rect1, rect2) => !(rect1.x2 < rect2.x1 || rect1.x1 > rect2.x2 || rect1.y2 < rect2.y1 || rect1.y1 > rect2.y2);
        return {
            draw: (ctx, text, targetX, targetY, obstacles = [], options = {}) => {
                const bounds = options.bounds || null;
                const metrics = ctx.measureText(text);
                const w = metrics.width;
                const h = metrics.fontBoundingBoxAscent ?? 12;
                const padding = 6;
                const candidates = [
                    [w/2 + padding, -padding, 'left', 'bottom'],
                    [-w/2 - padding, -padding, 'right', 'bottom'],
                    [w/2 + padding, h + padding, 'left', 'top'],
                    [-w/2 - padding, h + padding, 'right', 'top'],
                    [0, -h - padding, 'center', 'bottom'],
                    [0, h + padding, 'center', 'top'],
                    [w/2 + padding, h/2, 'left', 'middle'],
                    [-w/2 - padding, h/2, 'right', 'middle'],
                    // フォールバック候補（より遠い位置）
                    [w/2 + padding * 3, -padding * 3, 'left', 'bottom'],
                    [-w/2 - padding * 3, -padding * 3, 'right', 'bottom'],
                    [0, -h - padding * 3, 'center', 'bottom'],
                    [0, h + padding * 3, 'center', 'top']
                ];

                for (const cand of candidates) {
                    const x = targetX + cand[0];
                    const y = targetY + cand[1];
                    let rect;
                    if (cand[2] === 'left') rect = { x1: x, y1: y - h, x2: x + w, y2: y };
                    else if (cand[2] === 'right') rect = { x1: x - w, y1: y - h, x2: x, y2: y };
                    else rect = { x1: x - w/2, y1: y - h, x2: x + w/2, y2: y };

                    const paddedRect = {x1: rect.x1 - padding, y1: rect.y1 - padding, x2: rect.x2 + padding, y2: rect.y2 + padding};
                    let isInvalid = false;

                    for (const existing of [...drawnLabels.map(l => l.rect), ...obstacles]) {
                        if (isOverlapping(paddedRect, existing)) {
                            isInvalid = true;
                            break;
                        }
                    }
                    if (isInvalid) continue;

                    if (bounds) {
                        if (paddedRect.x1 < bounds.x1 || paddedRect.x2 > bounds.x2 || paddedRect.y1 < bounds.y1 || paddedRect.y2 > bounds.y2) {
                            isInvalid = true;
                        }
                    }
                    if (isInvalid) continue;

                    ctx.textAlign = cand[2];
                    ctx.textBaseline = cand[3];
                    ctx.fillText(text, x, y);

                    // 編集に必要な情報を保存
                    const centerX = (rect.x1 + rect.x2) / 2;
                    const centerY = (rect.y1 + rect.y2) / 2;
                    drawnLabels.push({
                        rect: paddedRect,
                        center: { x: centerX, y: centerY },
                        width: w + padding * 2,
                        value: options.value,
                        type: options.type,
                        index: options.index,
                    });
                    return;
                }

                // フォールバック: 全候補がブロックされた場合、最初の候補位置に強制表示
                const fallbackCand = candidates[0];
                const x = targetX + fallbackCand[0];
                const y = targetY + fallbackCand[1];
                let rect;
                if (fallbackCand[2] === 'left') rect = { x1: x, y1: y - h, x2: x + w, y2: y };
                else if (fallbackCand[2] === 'right') rect = { x1: x - w, y1: y - h, x2: x, y2: y };
                else rect = { x1: x - w/2, y1: y - h, x2: x + w/2, y2: y };

                const paddedRect = {x1: rect.x1 - padding, y1: rect.y1 - padding, x2: rect.x2 + padding, y2: rect.y2 + padding};
                ctx.textAlign = fallbackCand[2];
                ctx.textBaseline = fallbackCand[3];
                ctx.fillText(text, x, y);

                // フォールバックの場合も情報を保存
                const centerX = (rect.x1 + rect.x2) / 2;
                const centerY = (rect.y1 + rect.y2) / 2;
                drawnLabels.push({
                    rect: paddedRect,
                    center: { x: centerX, y: centerY },
                    width: w + padding * 2,
                    value: options.value,
                    type: options.type,
                    index: options.index,
                });
            },
            getLabelAt: (x, y) => {
                // 最も手前に描画されたラベルから逆順に検索
                for (let i = drawnLabels.length - 1; i >= 0; i--) {
                    const label = drawnLabels[i];
                    if (x >= label.rect.x1 && x <= label.rect.x2 && y >= label.rect.y1 && y <= label.rect.y2) {
                        return label;
                    }
                }
                return null;
            },
            clear: () => {
                drawnLabels.length = 0;
            }
        };
    };
    const drawOnCanvas = () => {
        const drawingCtx = getDrawingContext(elements.modelCanvas);
        if (!drawingCtx) return; // Should not happen with the modified getDrawingContext

        lastDrawingContext = drawingCtx;
        window.lastDrawingContext = drawingCtx;
        const { ctx, transform } = drawingCtx;
        let nodes = [], members = [];
        let nodeLoads = [], memberLoads = [], memberSelfWeights = [], nodeSelfWeights = [];
        try {
            if (elements.gridToggle.checked) {
                drawGrid(ctx, transform, elements.modelCanvas.clientWidth, elements.modelCanvas.clientHeight);
            }
            const parsed = parseInputs();
            nodes = parsed.nodes;
            members = parsed.members;
            nodeLoads = parsed.nodeLoads || [];
            memberLoads = parsed.memberLoads || [];
            memberSelfWeights = parsed.memberSelfWeights || [];
            nodeSelfWeights = parsed.nodeSelfWeights || [];
            if (nodes.length > 0) {
                // 投影モードを取得
                const projectionMode = getCurrentProjectionMode();
                const projectedNodes = nodes.map(n => project3DTo2D(n, projectionMode));
                
                const labelManager = LabelManager();
                window.lastLabelManager = labelManager; // グローバルにアクセス可能にする
                const nodeObstacles = projectedNodes.map((n, idx) => {
                    const pos = transform(n.x, n.y);
                    const metrics = ctx.measureText(idx + 1);
                    const textWidth = metrics.width;
                    return { x1: pos.x - 8, y1: pos.y - 8 - 12, x2: pos.x + 8 + textWidth, y2: pos.y + 8 };
                });
                drawStructure(ctx, transform, nodes, members, '#333', true, true, true, drawingCtx);
                drawConnections(ctx, transform, nodes, members);
                drawBoundaryConditions(ctx, transform, nodes);
                drawDimensions(ctx, transform, nodes, members, labelManager, nodeObstacles);
                drawExternalLoads(ctx, transform, nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights, labelManager, nodeObstacles);
                if (canvasMode === 'addMember' && firstMemberNode !== null) {
                    const node = projectedNodes[firstMemberNode];
                    const pos = transform(node.x, node.y);
                    ctx.fillStyle = 'rgba(255, 165, 0, 0.5)';
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
        } catch (e) {
            console.error("Drawing error:", e);
        }
        
        // 複数選択された要素を強調表示
        highlightSelectedElements();

        // 不安定要素をハイライト表示
        highlightInstabilityElements(ctx, transform);

        drawSelectionRectangle(ctx);

        // 座標軸インジケーターを描画
    const projectionMode = getCurrentProjectionMode();
        drawAxisIndicator(ctx, elements.modelCanvas.clientWidth, elements.modelCanvas.clientHeight, projectionMode);

        // 3Dビューアにモデルデータを送信
        sendModelToViewer();

        // モデル図3Dビューが表示中の場合は更新
        const modelViewModeSelect = document.getElementById('model-view-mode');
        if (modelViewModeSelect && modelViewModeSelect.value === '3d' && typeof updateModel3DView === 'function') {
            try {
                updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
            } catch (e) {
                console.error('Error updating model 3D view:', e);
            }
        }
    };

    // AI/スプレッドシート連携用にグローバル公開
    window.drawOnCanvas = drawOnCanvas;

// 変位図描画関数はnew_displacement_diagram.jsで定義されています

const getMemberDistributedLoadY = (memberLoad) => {
    if (!memberLoad) return 0;
    const value = memberLoad.wy ?? memberLoad.w ?? 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const drawMomentDiagram = (nodes, members, forces, memberLoads) => { 
        const drawingCtx = getDrawingContext(elements.momentCanvas); 
        if (!drawingCtx) return; 
    const { ctx, transform, scale } = drawingCtx; 
    const labelManager = LabelManager(); 
    const projectionMode = getCurrentProjectionMode();
        
        // 部材番号も表示する
        drawStructure(ctx, transform, nodes, members, '#ccc', false, true); 
        
        const nodeObstacles = nodes.map(n => { 
            const node3D = { x: n.x, y: n.y || 0, z: n.z || 0 };
            const projected = project3DTo2D(node3D, projectionMode);
            const pos = transform(projected.x, projected.y); 
            return {x1: pos.x - 12, y1: pos.y - 12, x2: pos.x + 12, y2: pos.y + 12}; 
        }); 
        let maxMoment = 0; 
        forces.forEach((f, idx) => { 
            const member = members[idx]; 
            const load = memberLoads.find(l => l.memberIndex === idx); 
            const w = getMemberDistributedLoadY(load); 
            const L = member.length; 
            let localMax = Math.max(Math.abs(f.M_i), Math.abs(f.M_j)); 
            if (w !== 0 && Math.abs(f.Q_i) > 1e-9) { 
                const x_q_zero = f.Q_i / w; 
                if (x_q_zero > 0 && x_q_zero < L) { 
                    const M_max_parabolic = -f.M_i * (1 - x_q_zero / L) + f.M_j * (x_q_zero / L) + w * L * x_q_zero / 2 - w * x_q_zero**2 / 2; 
                    localMax = Math.max(localMax, Math.abs(M_max_parabolic)); 
                } 
            } 
            maxMoment = Math.max(maxMoment, localMax); 
        }); 
        const maxOffsetPixels = 60; 
        let momentScale = 0; 
        if (scale > 0 && maxMoment > 1e-9) { 
            const maxOffsetModelUnits = maxOffsetPixels / scale; 
            momentScale = maxOffsetModelUnits / maxMoment; 
        } 
        members.forEach((m, idx) => { 
            const force = forces[idx]; 
            const load = memberLoads.find(l => l.memberIndex === idx); 
            const w = getMemberDistributedLoadY(load); 
            const n_i = nodes[m.i], n_j = nodes[m.j]; 
            ctx.beginPath(); 
            const startNode = { x: n_i.x, y: n_i.y || 0, z: n_i.z || 0 };
            const startProjected = project3DTo2D(startNode, projectionMode);
            const start = transform(startProjected.x, startProjected.y); 
            ctx.moveTo(start.x, start.y); 
            const numPoints = 20; 
            for (let i = 0; i <= numPoints; i++) { 
                const x_local = (i / numPoints) * m.length, M_linear = -force.M_i * (1 - x_local / m.length) + force.M_j * (x_local / m.length), M_parabolic = w * m.length * x_local / 2 - w * x_local**2 / 2; 
                const m_local = M_linear + M_parabolic, offset = -m_local * momentScale; 
                const globalX = n_i.x + x_local * m.c - offset * m.s;
                const globalY = (n_i.y || 0) + x_local * m.s + offset * m.c;
                const globalZ = (n_i.z || 0) + x_local * (m.cz || 0);
                const globalNode = { x: globalX, y: globalY, z: globalZ };
                const projectedNode = project3DTo2D(globalNode, projectionMode);
                const pt = transform(projectedNode.x, projectedNode.y); 
                ctx.lineTo(pt.x, pt.y); 
            } 
            const endNode = { x: n_j.x, y: n_j.y || 0, z: n_j.z || 0 };
            const endProjected = project3DTo2D(endNode, projectionMode);
            const end = transform(endProjected.x, endProjected.y); 
            ctx.lineTo(end.x, end.y); 
            ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; 
            ctx.strokeStyle = 'red'; 
            ctx.lineWidth = 1; 
            ctx.closePath(); 
            ctx.fill(); 
            ctx.stroke(); 
            ctx.fillStyle = '#333'; 
            if (Math.abs(force.M_i) > 1e-3) labelManager.draw(ctx, `${force.M_i.toFixed(2)}`, start.x, start.y, nodeObstacles); 
            if (Math.abs(force.M_j) > 1e-3) labelManager.draw(ctx, `${force.M_j.toFixed(2)}`, end.x, end.y, nodeObstacles); 
            if (w !== 0 && Math.abs(force.Q_i) > 1e-9) { 
                const x_max = force.Q_i / w; 
                if (x_max > 1e-6 && x_max < m.length - 1e-6) { 
                    const M_linear = -force.M_i*(1-x_max/m.length)+force.M_j*(x_max/m.length), M_parabolic=w*m.length*x_max/2-w*x_max**2/2; 
                    const M_max=M_linear+M_parabolic, offset=-M_max*momentScale; 
                    const globalX=n_i.x+x_max*m.c-offset*m.s;
                    const globalY=(n_i.y || 0)+x_max*m.s+offset*m.c;
                    const globalZ=(n_i.z || 0)+x_max*(m.cz || 0);
                    const globalNode = { x: globalX, y: globalY, z: globalZ };
                    const projectedNode = project3DTo2D(globalNode, projectionMode);
                    const pt=transform(projectedNode.x, projectedNode.y); 
                    labelManager.draw(ctx,`${M_max.toFixed(2)}`,pt.x,pt.y,nodeObstacles); 
                } 
            } 
        }); 
    };
    const drawAxialForceDiagram = (nodes, members, forces) => { 
        const drawingCtx = getDrawingContext(elements.axialCanvas); 
        if (!drawingCtx) return; 
    const { ctx, transform, scale } = drawingCtx; 
    const labelManager = LabelManager(); 
    const projectionMode = getCurrentProjectionMode();
        
        // 部材番号も表示する
        drawStructure(ctx, transform, nodes, members, '#ccc', false, true); 
        
        const nodeObstacles = nodes.map(n => { 
            const node3D = { x: n.x, y: n.y || 0, z: n.z || 0 };
            const projected = project3DTo2D(node3D, projectionMode);
            const pos = transform(projected.x, projected.y); 
            return {x1: pos.x - 12, y1: pos.y - 12, x2: pos.x + 12, y2: pos.y + 12}; 
        }); 
        let maxAxial = 0; 
        forces.forEach(f => maxAxial = Math.max(maxAxial, Math.abs(f.N_i), Math.abs(f.N_j))); 
        const maxOffsetPixels = 40; 
        let axialScale = 0; 
        if (scale > 0 && maxAxial > 0) { 
            const maxOffsetModelUnits = maxOffsetPixels / scale; 
            axialScale = maxOffsetModelUnits / maxAxial; 
        } 
        members.forEach((m, idx) => { 
            const N = -forces[idx].N_i, offset = -N * axialScale; 
            const n_i = nodes[m.i], n_j = nodes[m.j]; 
            const p1_offset_x = -offset*m.s, p1_offset_y = offset*m.c; 
            
            const n_i_offset = { x: n_i.x+p1_offset_x, y: (n_i.y || 0)+p1_offset_y, z: n_i.z || 0 };
            const n_j_offset = { x: n_j.x+p1_offset_x, y: (n_j.y || 0)+p1_offset_y, z: n_j.z || 0 };
            const n_i_3d = { x: n_i.x, y: n_i.y || 0, z: n_i.z || 0 };
            const n_j_3d = { x: n_j.x, y: n_j.y || 0, z: n_j.z || 0 };
            
            const p1_proj = project3DTo2D(n_i_offset, projectionMode);
            const p2_proj = project3DTo2D(n_j_offset, projectionMode);
            const p_start_proj = project3DTo2D(n_i_3d, projectionMode);
            const p_end_proj = project3DTo2D(n_j_3d, projectionMode);
            
            const p1 = transform(p1_proj.x, p1_proj.y);
            const p2 = transform(p2_proj.x, p2_proj.y);
            const p_start = transform(p_start_proj.x, p_start_proj.y);
            const p_end = transform(p_end_proj.x, p_end_proj.y);
            
            ctx.beginPath(); 
            ctx.moveTo(p_start.x, p_start.y); 
            ctx.lineTo(p1.x, p1.y); 
            ctx.lineTo(p2.x, p2.y); 
            ctx.lineTo(p_end.x, p_end.y); 
            ctx.closePath(); 
            ctx.fillStyle = N > 0 ? 'rgba(255,0,0,0.2)' : 'rgba(0,0,255,0.2)'; 
            ctx.strokeStyle = N > 0 ? 'red' : 'blue'; 
            ctx.fill(); 
            ctx.stroke(); 
            ctx.fillStyle = '#333'; 
            if (Math.abs(N) > 1e-3) { 
                const mid_offset_x=p1_offset_x*0.5, mid_offset_y=p1_offset_y*0.5; 
                const mid_3d = { x: (n_i.x+n_j.x)/2+mid_offset_x, y: ((n_i.y || 0)+(n_j.y || 0))/2+mid_offset_y, z: ((n_i.z || 0)+(n_j.z || 0))/2 };
                const mid_proj = project3DTo2D(mid_3d, projectionMode);
                const mid_pos = transform(mid_proj.x, mid_proj.y); 
                labelManager.draw(ctx,`${N.toFixed(2)}`,mid_pos.x,mid_pos.y,nodeObstacles); 
            } 
        }); 
    };
    const getProjectionPlaneBasis = (projectionMode) => {
        switch (projectionMode) {
            case 'xy':
                return {
                    u: { x: 1, y: 0, z: 0 },
                    v: { x: 0, y: 1, z: 0 }
                };
            case 'yz':
                return {
                    u: { x: 0, y: 1, z: 0 },
                    v: { x: 0, y: 0, z: 1 }
                };
            case 'xz':
            default:
                return {
                    u: { x: 1, y: 0, z: 0 },
                    v: { x: 0, y: 0, z: 1 }
                };
        }
    };

    const vecDot = (a, b) =>
        ((a?.x || 0) * (b?.x || 0)) +
        ((a?.y || 0) * (b?.y || 0)) +
        ((a?.z || 0) * (b?.z || 0));

    const vecCross = (a, b) => ({
        x: (a?.y || 0) * (b?.z || 0) - (a?.z || 0) * (b?.y || 0),
        y: (a?.z || 0) * (b?.x || 0) - (a?.x || 0) * (b?.z || 0),
        z: (a?.x || 0) * (b?.y || 0) - (a?.y || 0) * (b?.x || 0)
    });

    const vecMagnitude = (v) => Math.sqrt(vecDot(v, v));

    const vecNormalize = (v) => {
        const mag = vecMagnitude(v);
        if (!(mag > 1e-9)) return null;
        return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
    };

    const vecScale = (v, scalar) => ({
        x: (v?.x || 0) * scalar,
        y: (v?.y || 0) * scalar,
        z: (v?.z || 0) * scalar
    });

    const vecAdd = (a, b) => ({
        x: (a?.x || 0) + (b?.x || 0),
        y: (a?.y || 0) + (b?.y || 0),
        z: (a?.z || 0) + (b?.z || 0)
    });

    const computeMemberFrameForDiagram = (member, nodes) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return null;

        const dx = (nodeJ.x ?? 0) - (nodeI.x ?? 0);
        const dy = (nodeJ.y ?? 0) - (nodeI.y ?? 0);
        const dz = (nodeJ.z ?? 0) - (nodeI.z ?? 0);

        const localX = vecNormalize({ x: dx, y: dy, z: dz });
        if (!localX) return null;

        let reference = Math.abs(localX.z) < 0.9
            ? { x: 0, y: 0, z: 1 }
            : { x: 0, y: 1, z: 0 };

        let localY = vecNormalize(vecCross(reference, localX));
        if (!localY) {
            reference = { x: 1, y: 0, z: 0 };
            localY = vecNormalize(vecCross(reference, localX));
        }
        if (!localY) return null;

        let localZ = vecNormalize(vecCross(localX, localY));
        if (!localZ) {
            localZ = { x: 0, y: 0, z: 1 };
            localY = vecNormalize(vecCross(localZ, localX)) || { x: 0, y: 1, z: 0 };
            localZ = vecNormalize(vecCross(localX, localY)) || localZ;
        }

        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return { localX, localY, localZ, length };
    };

    const computePlaneProjectionData = (frame, planeBasis) => {
        if (!frame || !planeBasis) return null;
        const dirU = vecDot(frame.localX, planeBasis.u);
        const dirV = vecDot(frame.localX, planeBasis.v);
        const planarMagnitude = Math.hypot(dirU, dirV);
        if (!(planarMagnitude > 1e-6)) return null;

        const dirPlane = { u: dirU / planarMagnitude, v: dirV / planarMagnitude };
        const perpPlane = { u: -dirPlane.v, v: dirPlane.u };

        const perpGlobal = {
            x: perpPlane.u * planeBasis.u.x + perpPlane.v * planeBasis.v.x,
            y: perpPlane.u * planeBasis.u.y + perpPlane.v * planeBasis.v.y,
            z: perpPlane.u * planeBasis.u.z + perpPlane.v * planeBasis.v.z
        };
        const planarDirGlobal = {
            x: dirPlane.u * planeBasis.u.x + dirPlane.v * planeBasis.v.x,
            y: dirPlane.u * planeBasis.u.y + dirPlane.v * planeBasis.v.y,
            z: dirPlane.u * planeBasis.u.z + dirPlane.v * planeBasis.v.z
        };

        return { perpGlobal, planarDirGlobal };
    };

    const computeShearVectorsGlobal = (force, frame) => {
        if (!force || !frame) {
            return {
                i: { x: 0, y: 0, z: 0 },
                j: { x: 0, y: 0, z: 0 }
            };
        }

        const Qy_i = Number.isFinite(force.Qy_i) ? force.Qy_i : 0;
        const Qz_i = Number.isFinite(force.Qz_i) ? force.Qz_i : (Number.isFinite(force.Q_i) ? force.Q_i : 0);
        const Qy_j = Number.isFinite(force.Qy_j) ? force.Qy_j : 0;
        const Qz_j = Number.isFinite(force.Qz_j) ? force.Qz_j : (Number.isFinite(force.Q_j) ? force.Q_j : 0);

        const shearI = vecAdd(
            vecScale(frame.localY, Qy_i),
            vecScale(frame.localZ, Qz_i)
        );
        const shearJ = vecAdd(
            vecScale(frame.localY, Qy_j),
            vecScale(frame.localZ, Qz_j)
        );

        return { i: shearI, j: shearJ };
    };

    const computeDistributedLoadComponent = (load, perpGlobal) => {
        if (!load || !perpGlobal) {
            return 0;
        }
        const wx = Number.isFinite(load.wx) ? load.wx : 0;
        const wy = Number.isFinite(load.wy) ? load.wy : (Number.isFinite(load.w) ? load.w : 0);
        const wz = Number.isFinite(load.wz) ? load.wz : 0;
        return wx * perpGlobal.x + wy * perpGlobal.y + wz * perpGlobal.z;
    };

    const drawShearForceDiagram = (nodes, members, forces, memberLoads) => {
        const drawingCtx = getDrawingContext(elements.shearCanvas);
        if (!drawingCtx) return;
        const { ctx, transform, scale } = drawingCtx;
        const labelManager = LabelManager();
        const projectionMode = getCurrentProjectionMode();
        const planeBasis = getProjectionPlaneBasis(projectionMode);

        // 部材番号も表示する
        drawStructure(ctx, transform, nodes, members, '#ccc', false, true);

        const nodeObstacles = nodes.map(n => {
            const node3D = { x: n.x, y: n.y || 0, z: n.z || 0 };
            const projected = project3DTo2D(node3D, projectionMode);
            const pos = transform(projected.x, projected.y);
            return { x1: pos.x - 12, y1: pos.y - 12, x2: pos.x + 12, y2: pos.y + 12 };
        });

        const memberLoadMap = new Map();
        memberLoads.forEach(load => {
            if (Number.isInteger(load.memberIndex)) {
                memberLoadMap.set(load.memberIndex, load);
            }
        });

        const shearDataByIndex = new Array(members.length).fill(null);
        let maxShear = 0;

        members.forEach((member, idx) => {
            const frame = computeMemberFrameForDiagram(member, nodes);
            if (!frame || !(frame.length > 1e-6)) {
                return;
            }

            const planeData = computePlaneProjectionData(frame, planeBasis);
            if (!planeData) {
                return;
            }

            const force = forces[idx];
            const shearVectors = computeShearVectorsGlobal(force, frame);
            const shearI = vecDot(shearVectors.i, planeData.perpGlobal);
            const shearJ = vecDot(shearVectors.j, planeData.perpGlobal);

            const Q_i = Number.isFinite(shearI) ? shearI : 0;
            const Q_j = Number.isFinite(shearJ) ? shearJ : 0;
            const Q_j_converted = -Q_j;

            const load = memberLoadMap.get(idx);
            const wComponent = computeDistributedLoadComponent(load, planeData.perpGlobal);

            maxShear = Math.max(maxShear, Math.abs(Q_i), Math.abs(Q_j_converted));

            shearDataByIndex[idx] = {
                member,
                frame,
                planeData,
                Q_i,
                Q_j,
                Q_j_converted,
                w: Number.isFinite(wComponent) ? wComponent : 0
            };
        });

        const maxOffsetPixels = 50;
        let shearScale = 0;
        if (scale > 0 && maxShear > 0) {
            const maxOffsetModelUnits = maxOffsetPixels / scale;
            shearScale = maxOffsetModelUnits / maxShear;
        }

        shearDataByIndex.forEach((data, idx) => {
            if (!data) return;
            const { member, frame, planeData, Q_i, Q_j, Q_j_converted, w } = data;
            const n_i = nodes[member.i];
            const n_j = nodes[member.j];
            if (!n_i || !n_j) return;

            const offset_i = -Q_i * shearScale;
            const offset_j = Q_j * shearScale;
            const startOffset = vecScale(planeData.perpGlobal, offset_i);
            const endOffset = vecScale(planeData.perpGlobal, offset_j);

            const n_i_offset = {
                x: (n_i.x ?? 0) + startOffset.x,
                y: (n_i.y ?? 0) + startOffset.y,
                z: (n_i.z ?? 0) + startOffset.z
            };
            const n_j_offset = {
                x: (n_j.x ?? 0) + endOffset.x,
                y: (n_j.y ?? 0) + endOffset.y,
                z: (n_j.z ?? 0) + endOffset.z
            };

            const n_i_3d = { x: n_i.x ?? 0, y: n_i.y ?? 0, z: n_i.z ?? 0 };
            const n_j_3d = { x: n_j.x ?? 0, y: n_j.y ?? 0, z: n_j.z ?? 0 };

            const p_start_proj = project3DTo2D(n_i_3d, projectionMode);
            const p_end_proj = project3DTo2D(n_j_3d, projectionMode);
            const p1_proj = project3DTo2D(n_i_offset, projectionMode);
            const p2_proj = project3DTo2D(n_j_offset, projectionMode);

            const p_start = transform(p_start_proj.x, p_start_proj.y);
            const p_end = transform(p_end_proj.x, p_end_proj.y);
            const p1 = transform(p1_proj.x, p1_proj.y);

            ctx.beginPath();
            ctx.moveTo(p_start.x, p_start.y);
            ctx.lineTo(p1.x, p1.y);

            let p2 = null;
            if (Math.abs(w) < 1e-9) {
                p2 = transform(p2_proj.x, p2_proj.y);
                ctx.lineTo(p2.x, p2.y);
            } else {
                const numPoints = 10;
                const memberLength = frame.length || member.length || 0;
                for (let i = 1; i <= numPoints; i++) {
                    const ratio = Math.min(i / numPoints, 1);
                    const x_local = ratio * memberLength;
                    const Q_local = Q_i + (Q_j_converted - Q_i) * ratio;
                    const offset_local = -Q_local * shearScale;

                    const center = {
                        x: (n_i.x ?? 0) + frame.localX.x * x_local,
                        y: (n_i.y ?? 0) + frame.localX.y * x_local,
                        z: (n_i.z ?? 0) + frame.localX.z * x_local
                    };
                    const offsetVec = vecScale(planeData.perpGlobal, offset_local);
                    const globalPoint = {
                        x: center.x + offsetVec.x,
                        y: center.y + offsetVec.y,
                        z: center.z + offsetVec.z
                    };
                    const projectedNode = project3DTo2D(globalPoint, projectionMode);
                    p2 = transform(projectedNode.x, projectedNode.y);
                    ctx.lineTo(p2.x, p2.y);
                }
            }

            ctx.lineTo(p_end.x, p_end.y);
            ctx.closePath();
            ctx.fillStyle = Q_i > 0 ? 'rgba(0,128,0,0.2)' : 'rgba(255,165,0,0.2)';
            ctx.strokeStyle = Q_i > 0 ? 'green' : 'orange';
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#333';
            if (Math.abs(Q_i) > 1e-3) {
                labelManager.draw(ctx, `${Q_i.toFixed(2)}`, p1.x, p1.y, nodeObstacles);
            }
            if (p2 && Math.abs(Q_j_converted) > 1e-3) {
                labelManager.draw(ctx, `${Q_j_converted.toFixed(2)}`, p2.x, p2.y, nodeObstacles);
            }
        });
    };

// --- 応力度の計算とカラーマッピング ---
    const calculateCombinedStress = (force, sectionData) => {
        const { N_i, M_i, N_j, M_j } = force;
        const { A, Iy } = sectionData;
        
        // 部材両端での応力度を計算
        const stress_i = {
            axial: N_i / A,
            bending_top: Math.abs(M_i) / Iy * (sectionData.H / 2),  // 上端での曲げ応力
            bending_bottom: Math.abs(M_i) / Iy * (sectionData.H / 2) // 下端での曲げ応力
        };
        
        const stress_j = {
            axial: N_j / A,
            bending_top: Math.abs(M_j) / Iy * (sectionData.H / 2),
            bending_bottom: Math.abs(M_j) / Iy * (sectionData.H / 2)
        };
        
        // 合成応力度（最大値）
        const combined_i = Math.max(
            Math.abs(stress_i.axial + stress_i.bending_top),
            Math.abs(stress_i.axial - stress_i.bending_bottom)
        );
        
        const combined_j = Math.max(
            Math.abs(stress_j.axial + stress_j.bending_top),
            Math.abs(stress_j.axial - stress_j.bending_bottom)
        );
        
        return Math.max(combined_i, combined_j);
    };

    const getStressColor = (stress, maxStress) => {
        if (maxStress === 0) return 'rgb(0, 0, 255)'; // 青
        
        const ratio = Math.min(stress / maxStress, 1.0);
        
        // 4段階の色相変化：青→緑→黄→赤
        if (ratio <= 0.33) {
            // 青から緑へ (0-33%)
            const localRatio = ratio / 0.33;
            const r = 0;
            const g = Math.round(255 * localRatio);
            const b = Math.round(255 * (1 - localRatio));
            return `rgb(${r}, ${g}, ${b})`;
        } else if (ratio <= 0.66) {
            // 緑から黄へ (33-66%)
            const localRatio = (ratio - 0.33) / 0.33;
            const r = Math.round(255 * localRatio);
            const g = 255;
            const b = 0;
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // 黄から赤へ (66-100%)
            const localRatio = (ratio - 0.66) / 0.34;
            const r = 255;
            const g = Math.round(255 * (1 - localRatio));
            const b = 0;
            return `rgb(${r}, ${g}, ${b})`;
        }
    };

    const drawStressContour = (nodes, members, forces, sections) => {
        console.log('=== DRAWING STRESS CONTOUR START ===');
        console.log('Received parameters:', {
            nodesCount: nodes ? nodes.length : 'null',
            membersCount: members ? members.length : 'null',
            forcesCount: forces ? forces.length : 'null',
            sectionsCount: sections ? sections.length : 'null'
        });
        
        if (!elements.stressCanvas) {
            console.error('❌ Stress canvas element not found!');
            return;
        }
        
        console.log('✅ Stress canvas element found:', elements.stressCanvas);
        
        const drawingCtx = getDrawingContext(elements.stressCanvas);
        if (!drawingCtx) {
            console.log('❌ Failed to get drawing context for stress canvas');
            return;
        }
        
        const { ctx, transform, scale } = drawingCtx;
        console.log('✅ Drawing context obtained successfully');
        
        // キャンバスをクリア
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        console.log('✅ Canvas cleared');
        
        // 最大応力度を計算
        let maxStress = 0;
        const memberStresses = [];
        
        members.forEach((member, idx) => {
            const force = forces[idx];
            const sectionData = sections[member.sectionIndex];
            
            if (sectionData) {
                const stress = calculateCombinedStress(force, sectionData);
                memberStresses[idx] = stress;
                maxStress = Math.max(maxStress, stress);
            } else {
                memberStresses[idx] = 0;
            }
        });
        
        console.log(`Maximum stress: ${maxStress.toFixed(2)} N/mm²`);
        console.log('Member stresses:', memberStresses.slice(0, 5)); // 最初の5つを表示
        
        // 各部材を応力度に応じて色分けして描画
        let drawnMembers = 0;
        members.forEach((member, idx) => {
            const stress = memberStresses[idx];
            const color = getStressColor(stress, maxStress);
            const n_i = nodes[member.i];
            const n_j = nodes[member.j];
            
            if (!n_i || !n_j) {
                console.log(`Missing nodes for member ${idx}:`, { i: member.i, j: member.j });
                return;
            }
            
            const start = transform(n_i.x, n_i.y);
            const end = transform(n_j.x, n_j.y);
            
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4; // 太い線で表示
            ctx.stroke();
            
            drawnMembers++;
            
            // 最初の3つの部材の情報をログ出力
            if (idx < 3) {
                console.log(`Member ${idx}: stress=${stress.toFixed(2)}, color=${color}, start=(${start.x.toFixed(1)},${start.y.toFixed(1)}), end=(${end.x.toFixed(1)},${end.y.toFixed(1)})`);
            }
        });
        
        console.log(`Drew ${drawnMembers} members`);
        
        // 節点を描画
        let drawnNodes = 0;
        nodes.forEach((node, idx) => {
            const pos = transform(node.x, node.y);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#333';
            ctx.fill();
            drawnNodes++;
        });
        
        console.log(`Drew ${drawnNodes} nodes`);
        
        // 凡例を描画
        drawStressLegend(ctx, maxStress);
        console.log('Legend drawn');
        console.log('=== DRAWING STRESS CONTOUR COMPLETED ===');
    };

    const drawStressLegend = (ctx, maxStress) => {
        const legendX = 20;
        const legendY = 20;
        const legendWidth = 200;
        const legendHeight = 20;
        
        // 背景
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(legendX - 5, legendY - 5, legendWidth + 60, legendHeight + 30);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(legendX - 5, legendY - 5, legendWidth + 60, legendHeight + 30);
        
        // グラデーション
        for (let i = 0; i <= legendWidth; i++) {
            const ratio = i / legendWidth;
            const color = getStressColor(ratio * maxStress, maxStress);
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(legendX + i, legendY);
            ctx.lineTo(legendX + i, legendY + legendHeight);
            ctx.stroke();
        }
        
        // ラベル
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.fillText('0', legendX - 2, legendY + legendHeight + 15);
        ctx.fillText(`${maxStress.toFixed(1)} N/mm²`, legendX + legendWidth - 30, legendY + legendHeight + 15);
        ctx.fillText('応力度コンター', legendX + 70, legendY - 10);
    };

    // 応力度関数をwindow変数として登録（クロススコープアクセス用）
    window.calculateCombinedStress = calculateCombinedStress;
    window.getStressColor = getStressColor;
    window.drawStressContour = drawStressContour;
    window.drawStressLegend = drawStressLegend;

// --- 弾性座屈解析機能 ---
    const calculateBucklingAnalysis = () => {
        if (!lastResults) return [];
        const { members, forces } = lastResults;
        const bucklingResults = [];

        members.forEach((member, idx) => {
            const { strengthProps, A, ix, iy, E, length } = member;
            // springは座屈係数の自動判定では「ピン相当」として扱う（明示Kがあれば優先）
            const i_conn = (member.i_conn === 'spring') ? 'pinned' : member.i_conn;
            const j_conn = (member.j_conn === 'spring') ? 'pinned' : member.j_conn;
            const force = forces[idx];
            
            if (!A || !ix || !iy || isNaN(A) || isNaN(ix) || isNaN(iy)) {
                bucklingResults.push({
                    memberIndex: idx,
                    status: 'データ不足',
                    criticalLoad: 'N/A',
                    bucklingMode: 'N/A',
                    bucklingLength: 'N/A',
                    slendernessRatio: 'N/A',
                    safetyFactor: 'N/A'
                });
                return;
            }

            // 座屈長の計算（座屈係数Kが入力されていれば最優先）
            let bucklingLengthFactor = 1.0;
            const userK = (member.bucklingK !== undefined && member.bucklingK !== null && `${member.bucklingK}` !== '')
                ? parseFloat(member.bucklingK)
                : null;
            if (userK !== null && isFinite(userK) && userK > 0) {
                bucklingLengthFactor = userK;
            } else {
                if (i_conn === 'rigid' && j_conn === 'rigid') {
                    bucklingLengthFactor = 0.5; // 両端固定
                } else if ((i_conn === 'rigid' && j_conn === 'pinned') ||
                          (i_conn === 'pinned' && j_conn === 'rigid')) {
                    bucklingLengthFactor = 0.7; // 一端固定・一端ピン
                } else if (i_conn === 'pinned' && j_conn === 'pinned') {
                    bucklingLengthFactor = 1.0; // 両端ピン
                }
            }
            
            const bucklingLength = length * bucklingLengthFactor; // 座屈長 (m)
            
            // 弱軸まわりの座屈（通常はiy < ix）
            const i_min = Math.min(ix, iy); // 最小回転半径 (m)
            const slendernessRatio = bucklingLength / i_min; // 細長比
            
            // オイラー座屈荷重の計算
            const E_Pa = E * 1000; // N/mm² → Pa (実際はE*1000なのでE*1000*1000000)
            const I_min = i_min * i_min * A; // 最小断面二次モーメント (m⁴)
            const eulerLoad = (Math.PI * Math.PI * E_Pa * I_min) / (bucklingLength * bucklingLength); // N
            
            // 現在の軸力（負の値を圧縮として扱う）
            const N_i = force.N_i; // 解析結果そのまま
            const N_j = force.N_j; // 解析結果そのまま
            
            // より大きな軸力を選択
            const axialForceKN = (Math.abs(N_i) > Math.abs(N_j)) ? N_i : N_j; // kN単位での軸力
            const compressionForce = axialForceKN < 0 ? Math.abs(axialForceKN) * 1000 : 0; // 負の値を圧縮力として抽出、N単位に変換
            
            // 座屈モードの判定
            let bucklingMode = '';
            if (ix < iy) {
                bucklingMode = 'X軸まわり座屈（強軸）';
            } else if (iy < ix) {
                bucklingMode = 'Y軸まわり座屈（弱軸）';  
            } else {
                bucklingMode = '等方性断面';
            }
            
            // 安全率の計算
            let safetyFactor = 'N/A';
            let status = '安全';
            
            if (compressionForce > 0) { // 圧縮力がある場合（負の軸力を圧縮として判定）
                safetyFactor = eulerLoad / compressionForce;
                if (safetyFactor < 1.0) {
                    status = '座屈危険';
                } else if (safetyFactor < 2.0) {
                    status = '要注意';
                } else {
                    status = '安全';
                }
            } else if (axialForceKN > 0) {
                // 引張材の場合
                status = '引張材（座屈なし）';
                safetyFactor = '∞';
            } else {
                // 軸力が0の場合
                status = '座屈なし';
                safetyFactor = '∞';
            }

            bucklingResults.push({
                memberIndex: idx,
                status: status,
                criticalLoad: eulerLoad / 1000, // kNに変換
                bucklingLoad: eulerLoad / 1000, // kNに変換（エクセル出力用）
                bucklingMode: bucklingMode,
                bucklingLength: bucklingLength,
                slendernessRatio: slendernessRatio,
                safetyFactor: safetyFactor,
                axialForce: axialForceKN, // kN単位（負の値が圧縮、正の値が引張）
                bucklingLengthFactor: bucklingLengthFactor,
                connectionType: `i:${i_conn}, j:${j_conn}`,
                memberLength: length,
                momentOfInertia: I_min,
                radiusOfGyration: i_min,
                elasticModulus: E_Pa / 1000000 // GPa単位
            });
        });

        return bucklingResults;
    };

// --- Section Check Logic and Drawing ---
    const calculateSectionCheck = (loadTerm) => {
        if (!lastResults) return [];
        const { members, forces, memberLoads } = lastResults;
        const results = [];
        members.forEach((member, idx) => {
            const { strengthProps, A, Z, ix, iy, E, length, Iy, Iz } = member;
            if(!strengthProps || !A || !Z || isNaN(A) || isNaN(Z)) {
                results.push({ 
                    maxRatio: 'N/A', 
                    N: 0, 
                    M: 0, 
                    checkType: 'データ不足', 
                    status: 'error', 
                    ratios: Array(21).fill(0),
                    ratiosY: Array(21).fill(0), // Y軸周りの検定比
                    ratiosZ: Array(21).fill(0)  // Z軸周りの検定比
                });
                return;
            }
            let ft, fc, fb, fs;
            const termIndex = (loadTerm === 'long') ? 0 : 1;
            
            switch(strengthProps.type) {
                case 'F-value': case 'F-stainless': case 'F-aluminum':
                    const F = strengthProps.value;
                    if (!F || isNaN(F)) { results.push({ maxRatio: 'N/A', N: 0, M: 0, checkType: 'F値無効', status: 'error', ratios: Array(21).fill(0)}); return; }
                    const factor = (loadTerm === 'long') ? 1.5 : 1.0;
                    ft = F / factor; fb = F / factor; fs = F / (factor * Math.sqrt(3));
                    const lk = length, i_min = Math.min(ix, iy);
                    fc = ft;
                    if (i_min > 1e-9) {
                        const lambda = lk / i_min, E_n_mm2 = E * 1e-3;
                        const lambda_p = Math.PI * Math.sqrt(E_n_mm2 / (0.6 * F));
                        if (lambda <= lambda_p) { fc = (1 - 0.4 * (lambda / lambda_p)**2) * F / factor; } 
                        else { fc = (0.277 * F) / ((lambda / lambda_p)**2); }
                    }
                    break;
                case 'wood-type': {
                    let baseStresses;
                    if (strengthProps.preset === 'custom') {
                        baseStresses = strengthProps.baseStrengths;
                        if (!baseStresses || isNaN(baseStresses.ft) || isNaN(baseStresses.fc) || isNaN(baseStresses.fb) || isNaN(baseStresses.fs)) {
                            results.push({ maxRatio: 'N/A', N: 0, M: 0, checkType: '木材基準強度無効', status: 'error', ratios: Array(21).fill(0) });
                            return; // continue forEach
                        }
                    } else {
                        baseStresses = WOOD_BASE_STRENGTH_DATA[strengthProps.preset];
                        if (!baseStresses) {
                            results.push({ maxRatio: 'N/A', N: 0, M: 0, checkType: '木材データ無', status: 'error', ratios: Array(21).fill(0) });
                            return; // continue forEach
                        }
                    }
                    // プリセット・任意入力共通の計算ロジック
                    const factor = (loadTerm === 'long') ? (1.1 / 3) : (2 / 3);
                    ft = baseStresses.ft * factor;
                    fc = baseStresses.fc * factor;
                    fb = baseStresses.fb * factor;
                    fs = baseStresses.fs * factor;
                    break;
                }
                case 'Fc':
                default:
                    results.push({ maxRatio: 'N/A', N: 0, M: 0, checkType: '未対応材料', status: 'error', ratios: Array(21).fill(0)});
                    return;
            }

            const force = forces[idx];
            const load = memberLoads.find(l => l.memberIndex === idx);
            const w = getMemberDistributedLoadY(load);
            const L = length, N = -force.N_i, Z_mm3 = Z * 1e9, A_mm2 = A * 1e6;
            
            // 両軸対応の断面係数計算
            // Y軸周りの断面係数（My用）
            let Zy_mm3 = Z_mm3;
            if (Iy && A) {
                const ry = Math.sqrt(Iy / A); // Y軸周りの回転半径
                const cy = ry * 2; // 断面の高さ（概算）
                Zy_mm3 = (Iy / cy) * 1e9; // Y軸周りの断面係数
            }
            
            // Z軸周りの断面係数（Mz用）
            let Zz_mm3 = Z_mm3;
            if (Iz && A) {
                const rz = Math.sqrt(Iz / A); // Z軸周りの回転半径
                const cz = rz * 2; // 断面の幅（概算）
                Zz_mm3 = (Iz / cz) * 1e9; // Z軸周りの断面係数
            }
            
            let maxRatio = 0, maxRatioY = 0, maxRatioZ = 0, M_at_max = 0;
            let maxShearRatio = 0, maxShearRatioY = 0, maxShearRatioZ = 0; // せん断力検定比
            const ratios = [];
            const ratiosY = []; // Y軸周りの検定比
            const ratiosZ = []; // Z軸周りの検定比
            const shearRatios = []; // せん断力検定比
            const shearRatiosY = []; // Y軸方向せん断力検定比
            const shearRatiosZ = []; // Z軸方向せん断力検定比
            
            for (let k = 0; k <= 20; k++) {
                const xi = k / 20; // 無次元座標
                const x = xi * L; // 実際の距離
                
                // 曲げモーメント図と同じ計算方法を使用
                // 第1軸（Y軸周り）の曲げモーメント
                let M1_x = 0;
                if (typeof calculateMemberMomentForAxis === 'function') {
                    M1_x = calculateMemberMomentForAxis(force, L, xi, 'y', w);
                } else {
                    // フォールバック: 線形補間 + 等分布荷重
                    const M_linear = -force.My_i * (1 - xi) + force.My_j * xi;
                    const M_parabolic = w * L * x / 2 - w * x**2 / 2;
                    M1_x = M_linear + M_parabolic;
                }
                
                // 第2軸（Z軸周り）の曲げモーメント
                let M2_x = 0;
                if (typeof calculateMemberMomentForAxis === 'function') {
                    M2_x = calculateMemberMomentForAxis(force, L, xi, 'z', w);
                } else {
                    // フォールバック: 線形補間 + 等分布荷重
                    const M_linear = -force.Mz_i * (1 - xi) + force.Mz_j * xi;
                    const M_parabolic = w * L * x / 2 - w * x**2 / 2;
                    M2_x = M_linear + M_parabolic;
                }
                
                // 従来の計算方法（後方互換性のため）
                const M_linear = -force.M_i * (1 - xi) + force.M_j * xi;
                const M_parabolic = w * L * x / 2 - w * x**2 / 2;
                const M_x = M_linear + M_parabolic;
                
                const sigma_a = (N * 1000) / A_mm2;
                const sigma_b = (Math.abs(M_x) * 1e6) / Z_mm3;
                const sigma_by = (Math.abs(M1_x) * 1e6) / Zy_mm3; // 第1軸（Y軸周り）
                const sigma_bz = (Math.abs(M2_x) * 1e6) / Zz_mm3; // 第2軸（Z軸周り）
                
                // せん断力計算（第2軸せん断力図と同じ軸選択方法を使用）
                let Q1_x = 0, Q2_x = 0; // 第1軸、第2軸のせん断力
                
                // 投影モードに応じて軸を決定（第2軸せん断力図と同じロジック）
                const getCurrentProjectionMode = () => {
                    const projectionSelect = document.getElementById('projection-mode');
                    return projectionSelect ? projectionSelect.value : 'iso';
                };
                
                const projectionMode = getCurrentProjectionMode();
                let currentAxis, secondaryAxis;
                
                if (projectionMode === 'xy') {
                    currentAxis = 'z'; // 現在表示: Z軸周り
                    secondaryAxis = 'y'; // 第2軸: Y軸周り
                } else if (projectionMode === 'xz') {
                    currentAxis = 'y'; // 現在表示: Y軸周り
                    secondaryAxis = 'z'; // 第2軸: Z軸周り
                } else if (projectionMode === 'yz') {
                    currentAxis = 'x'; // 現在表示: X軸周り
                    secondaryAxis = 'z'; // 第2軸: Z軸周り
                } else {
                    // 等角投影の場合は第2軸としてZ軸を表示
                    currentAxis = 'y'; // 現在表示: Y軸周り
                    secondaryAxis = 'z'; // 第2軸: Z軸周り
                }
                
                if (typeof calculateMemberShearForAxis === 'function') {
                    // 第2軸せん断力図と同じようにnullを渡す（等分布荷重は内部で計算される）
                    Q1_x = calculateMemberShearForAxis(force, L, xi, currentAxis, null);
                    Q2_x = calculateMemberShearForAxis(force, L, xi, secondaryAxis, null);
                } else {
                    // フォールバック: 線形補間（等分布荷重は考慮しない）
                    const Q1_linear = force[`Q${currentAxis}_i`] * (1 - xi) + force[`Q${currentAxis}_j`] * xi;
                    Q1_x = Q1_linear;
                    
                    const Q2_linear = force[`Q${secondaryAxis}_i`] * (1 - xi) + force[`Q${secondaryAxis}_j`] * xi;
                    Q2_x = Q2_linear;
                }
                
                // せん断応力度計算
                const tau1 = (Math.abs(Q1_x) * 1000) / A_mm2; // 第1軸せん断応力度
                const tau2 = (Math.abs(Q2_x) * 1000) / A_mm2; // 第2軸せん断応力度
                
                let ratio_x = 0, ratio_y = 0, ratio_z = 0;
                let shear_ratio1 = 0, shear_ratio2 = 0;
                
                if(isNaN(sigma_a) || !ft || !fc || !fb) { 
                    ratio_x = ratio_y = ratio_z = Infinity; 
                } else {
                    if (sigma_a >= 0) { // 引張
                    ratio_x = (sigma_a / ft) + (sigma_b / fb);
                        ratio_y = (sigma_a / ft) + (sigma_by / fb);
                        ratio_z = (sigma_a / ft) + (sigma_bz / fb);
                    } else { // 圧縮
                    ratio_x = (Math.abs(sigma_a) / fc) + (sigma_b / fb);
                        ratio_y = (Math.abs(sigma_a) / fc) + (sigma_by / fb);
                        ratio_z = (Math.abs(sigma_a) / fc) + (sigma_bz / fb);
                }
                }
                
                // せん断力検定比の計算
                if (fs && !isNaN(tau1) && !isNaN(tau2)) {
                    shear_ratio1 = tau1 / fs; // 第1軸せん断力検定比
                    shear_ratio2 = tau2 / fs; // 第2軸せん断力検定比
                } else {
                    shear_ratio1 = shear_ratio2 = Infinity;
                }
                
                ratios.push(ratio_x);
                ratiosY.push(ratio_y);
                ratiosZ.push(ratio_z);
                shearRatios.push(shear_ratio1);
                shearRatiosY.push(shear_ratio1);
                shearRatiosZ.push(shear_ratio2);
                
                if (ratio_x > maxRatio) { maxRatio = ratio_x; M_at_max = M_x; }
                if (ratio_y > maxRatioY) maxRatioY = ratio_y;
                if (ratio_z > maxRatioZ) maxRatioZ = ratio_z;
                if (shear_ratio1 > maxShearRatio) maxShearRatio = shear_ratio1;
                if (shear_ratio1 > maxShearRatioY) maxShearRatioY = shear_ratio1;
                if (shear_ratio2 > maxShearRatioZ) maxShearRatioZ = shear_ratio2;
            }
            
            // 曲げモーメント図と同じ方法で最大値を計算
            let maxM1 = 0, maxM2 = 0, maxQ1 = 0, maxQ2 = 0;
            for (let k = 0; k <= 20; k++) {
                const xi = k / 20;
                const x = xi * L;
                
                let M1_x = 0, M2_x = 0, Q1_x = 0, Q2_x = 0;
                if (typeof calculateMemberMomentForAxis === 'function') {
                    M1_x = calculateMemberMomentForAxis(force, L, xi, 'y', w);
                    M2_x = calculateMemberMomentForAxis(force, L, xi, 'z', w);
                } else {
                    const M1_linear = -force.My_i * (1 - xi) + force.My_j * xi;
                    const M1_parabolic = w * L * x / 2 - w * x**2 / 2;
                    M1_x = M1_linear + M1_parabolic;
                    
                    const M2_linear = -force.Mz_i * (1 - xi) + force.Mz_j * xi;
                    const M2_parabolic = w * L * x / 2 - w * x**2 / 2;
                    M2_x = M2_linear + M2_parabolic;
                }
                
                // せん断力の最大値も計算
                if (typeof calculateMemberShearForAxis === 'function') {
                    Q1_x = calculateMemberShearForAxis(force, L, xi, 'y', w);
                    Q2_x = calculateMemberShearForAxis(force, L, xi, 'z', w);
                } else {
                    const Q1_linear = force.Qy_i * (1 - xi) + force.Qy_j * xi;
                    Q1_x = Q1_linear - w * x;
                    
                    const Q2_linear = force.Qz_i * (1 - xi) + force.Qz_j * xi;
                    Q2_x = Q2_linear - w * x;
                }
                
                maxM1 = Math.max(maxM1, Math.abs(M1_x));
                maxM2 = Math.max(maxM2, Math.abs(M2_x));
                maxQ1 = Math.max(maxQ1, Math.abs(Q1_x));
                maxQ2 = Math.max(maxQ2, Math.abs(Q2_x));
            }
            
            results.push({ 
                maxRatio: Math.max(maxRatio, maxRatioY, maxRatioZ), // 両軸の最大値
                maxRatioY, 
                maxRatioZ,
                maxShearRatio, // せん断力検定比の最大値
                maxShearRatioY, // 第1軸せん断力検定比の最大値
                maxShearRatioZ, // 第2軸せん断力検定比の最大値
                N, 
                M: M_at_max, 
                M1: maxM1, // 第1軸（Y軸周り）の最大曲げモーメント
                M2: maxM2, // 第2軸（Z軸周り）の最大曲げモーメント
                Q1: maxQ1, // 第1軸（Y方向）の最大せん断力
                Q2: maxQ2, // 第2軸（Z方向）の最大せん断力
                checkType: '両軸組合せ応力', 
                status: Math.max(maxRatio, maxRatioY, maxRatioZ, maxShearRatio, maxShearRatioY, maxShearRatioZ) > 1.0 ? 'NG' : 'OK', 
                ratios,
                ratiosY,
                ratiosZ,
                shearRatios,
                shearRatiosY,
                shearRatiosZ
            });
        });
        return results;
    };

    const getDeflectionCheckSettings = () => {
        const fallback = window.settings?.deflectionCheck || { amplificationFactor: 1.0, allowableDeflectionMm: 10, spanRatio: 300 };

        const ampInput = document.getElementById('defl-amp-factor');
        const allowMmInput = document.getElementById('defl-allow-mm');
        const spanRatioInput = document.getElementById('defl-span-ratio');

        const amplificationFactorRaw = ampInput ? parseFloat(ampInput.value) : fallback.amplificationFactor;
        const allowableDeflectionMmRaw = allowMmInput ? parseFloat(allowMmInput.value) : fallback.allowableDeflectionMm;
        const spanRatioRaw = spanRatioInput ? parseFloat(spanRatioInput.value) : fallback.spanRatio;

        const amplificationFactor = (isFinite(amplificationFactorRaw) && amplificationFactorRaw >= 0) ? amplificationFactorRaw : 1.0;
        const allowableDeflectionMm = (isFinite(allowableDeflectionMmRaw) && allowableDeflectionMmRaw >= 0) ? allowableDeflectionMmRaw : 10;
        const spanRatio = (isFinite(spanRatioRaw) && spanRatioRaw >= 1) ? spanRatioRaw : 300;

        return { amplificationFactor, allowableDeflectionMm, spanRatio };
    };

    const getLtbCheckSettings = () => {
        const fallback = window.settings?.ltbCheck || { unbracedLengthFactor: 1.0, cb: 1.0, nu: 0.30 };

        const factorInput = document.getElementById('ltb-unbraced-factor');
        const cbInput = document.getElementById('ltb-cb');
        const nuInput = document.getElementById('ltb-nu');

        const unbracedLengthFactorRaw = factorInput ? parseFloat(factorInput.value) : fallback.unbracedLengthFactor;
        const cbRaw = cbInput ? parseFloat(cbInput.value) : fallback.cb;
        const nuRaw = nuInput ? parseFloat(nuInput.value) : fallback.nu;

        const unbracedLengthFactor = (isFinite(unbracedLengthFactorRaw) && unbracedLengthFactorRaw >= 0) ? unbracedLengthFactorRaw : 1.0;
        const cb = (isFinite(cbRaw) && cbRaw > 0) ? cbRaw : 1.0;
        const nu = (isFinite(nuRaw) && nuRaw >= 0 && nuRaw < 0.5) ? nuRaw : 0.30;

        return { unbracedLengthFactor, cb, nu };
    };

    const calculateDeflectionCheck = () => {
        if (!lastResults) return [];
        const { nodes, members, D, memberLoads } = lastResults;
        if (!D || !Array.isArray(D) || D.length === 0) return [];
        if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return [];

        const dofPerNode = D.length / nodes.length;
        const settings = getDeflectionCheckSettings();
        const results = [];

        const distPointToLine2D = (ax, ay, bx, by, px, py) => {
            const vx = bx - ax;
            const vy = by - ay;
            const wx = px - ax;
            const wy = py - ay;
            const denom = Math.sqrt(vx * vx + vy * vy);
            if (denom < 1e-12) return 0;
            const cross = vx * wy - vy * wx;
            return Math.abs(cross) / denom;
        };

        const distPointToLine3D = (a, b, p) => {
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const vz = b.z - a.z;
            const wx = p.x - a.x;
            const wy = p.y - a.y;
            const wz = p.z - a.z;
            const cx = vy * wz - vz * wy;
            const cy = vz * wx - vx * wz;
            const cz = vx * wy - vy * wx;
            const num = Math.sqrt(cx * cx + cy * cy + cz * cz);
            const den = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (den < 1e-12) return 0;
            return num / den;
        };

        members.forEach((m, idx) => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            if (!ni || !nj) {
                results.push({ memberIndex: idx, status: 'error', message: '節点情報がありません' });
                return;
            }

            const L = m.length;
            if (!isFinite(L) || L <= 0) {
                results.push({ memberIndex: idx, status: 'error', message: '部材長が無効です' });
                return;
            }

            const load = (memberLoads || []).find(l => l.memberIndex === idx);
            const w = getMemberDistributedLoadY(load);

            const spanBasedAllowableMm = (settings.spanRatio > 0) ? (L * 1000 / settings.spanRatio) : Infinity;
            const fixedAllowableMm = (settings.allowableDeflectionMm > 0) ? settings.allowableDeflectionMm : Infinity;
            const allowableMm = Math.min(spanBasedAllowableMm, fixedAllowableMm);

            if (dofPerNode === 3) {
                const dx_i = D[m.i * 3]?.[0] ?? 0;
                const dy_i = D[m.i * 3 + 1]?.[0] ?? 0;
                const dx_j = D[m.j * 3]?.[0] ?? 0;
                const dy_j = D[m.j * 3 + 1]?.[0] ?? 0;

                const ax = ni.x + dx_i;
                const ay = ni.y + dy_i;
                const bx = nj.x + dx_j;
                const by = nj.y + dy_j;

                const d_global_member_vec = [
                    ...D.slice(m.i * 3, m.i * 3 + 3),
                    ...D.slice(m.j * 3, m.j * 3 + 3)
                ];
                const d_local_vec = mat.multiply(m.T, d_global_member_vec);
                const [ui, vi, thi, uj, vj, thj] = d_local_vec.map(v => v[0]);

                let maxDeviation = 0;
                for (let k = 0; k <= 40; k++) {
                    const x = (k / 40) * L;
                    const xi = x / L;

                    const N1 = 1 - 3 * xi ** 2 + 2 * xi ** 3;
                    const N2 = x * (1 - xi) ** 2;
                    const N3 = 3 * xi ** 2 - 2 * xi ** 3;
                    const N4 = (x ** 2 / L) * (xi - 1);

                    const u_local = (1 - xi) * ui + xi * uj;
                    const v_homogeneous = N1 * vi + N2 * thi + N3 * vj + N4 * thj;

                    let v_particular = 0;
                    const I = m.I ?? m.Iz ?? m.axisProperties?.bendingInertia;
                    if (w !== 0 && m.E > 0 && I > 0) {
                        if (m.i_conn === 'rigid' && m.j_conn === 'rigid') v_particular = (w * x ** 2 * (L - x) ** 2) / (24 * m.E * I);
                        else if (m.i_conn === 'pinned' && m.j_conn === 'pinned') v_particular = (w * x * (L ** 3 - 2 * L * x ** 2 + x ** 3)) / (24 * m.E * I);
                        else if (m.i_conn === 'rigid' && m.j_conn === 'pinned') v_particular = (w * x ** 2 * (3 * L ** 2 - 5 * L * x + 2 * x ** 2)) / (48 * m.E * I);
                        else if (m.i_conn === 'pinned' && m.j_conn === 'rigid') v_particular = (w * x * (L ** 3 - 3 * L * x ** 2 + 2 * x ** 3)) / (48 * m.E * I);
                    }

                    const v_local = v_homogeneous - v_particular;

                    const c = m.c;
                    const s = m.s;
                    const disp_x_global = u_local * c - v_local * s;
                    const disp_y_global = u_local * s + v_local * c;

                    const orig_x = ni.x + x * c;
                    const orig_y = ni.y + x * s;
                    const def_x = orig_x + disp_x_global;
                    const def_y = orig_y + disp_y_global;

                    const deviation = distPointToLine2D(ax, ay, bx, by, def_x, def_y);
                    if (deviation > maxDeviation) maxDeviation = deviation;
                }

                const maxDeflectionMm = maxDeviation * 1000;
                const amplifiedDeflectionMm = maxDeflectionMm * settings.amplificationFactor;
                const ratio = (isFinite(allowableMm) && allowableMm > 1e-12) ? (amplifiedDeflectionMm / allowableMm) : NaN;
                const status = (isFinite(ratio)) ? (ratio > 1.0 ? 'NG' : 'OK') : 'N/A';
                const actualSpanRatio = (amplifiedDeflectionMm > 1e-12) ? ((L * 1000) / amplifiedDeflectionMm) : Infinity;

                results.push({
                    memberIndex: idx,
                    length: L,
                    maxDeflectionMm,
                    amplifiedDeflectionMm,
                    allowableMm,
                    allowableBySpanRatioMm: spanBasedAllowableMm,
                    allowableByFixedMm: fixedAllowableMm,
                    spanRatioLimit: settings.spanRatio,
                    actualSpanRatio,
                    ratio,
                    status
                });
                return;
            }

            if (dofPerNode === 6) {
                const dxi = D[m.i * 6]?.[0] ?? 0;
                const dyi = D[m.i * 6 + 1]?.[0] ?? 0;
                const dzi = D[m.i * 6 + 2]?.[0] ?? 0;
                const dxj = D[m.j * 6]?.[0] ?? 0;
                const dyj = D[m.j * 6 + 1]?.[0] ?? 0;
                const dzj = D[m.j * 6 + 2]?.[0] ?? 0;

                const aDef = { x: ni.x + dxi, y: ni.y + dyi, z: (ni.z ?? 0) + dzi };
                const bDef = { x: nj.x + dxj, y: nj.y + dyj, z: (nj.z ?? 0) + dzj };

                const R = m.T3D;
                if (!R || !Array.isArray(R) || R.length < 12) {
                    results.push({ memberIndex: idx, status: 'error', message: '3D変換行列がありません' });
                    return;
                }

                const d_global_member_vec = [
                    ...D.slice(m.i * 6, m.i * 6 + 6),
                    ...D.slice(m.j * 6, m.j * 6 + 6)
                ];
                const d_local_vec = mat.multiply(R, d_global_member_vec);

                const ui = d_local_vec[0]?.[0] ?? 0;
                const vi = d_local_vec[1]?.[0] ?? 0;
                const rzi = d_local_vec[5]?.[0] ?? 0;
                const uj = d_local_vec[6]?.[0] ?? 0;
                const vj = d_local_vec[7]?.[0] ?? 0;
                const rzj = d_local_vec[11]?.[0] ?? 0;

                const ex = { x: R[0][0], y: R[0][1], z: R[0][2] };
                const ey = { x: R[1][0], y: R[1][1], z: R[1][2] };

                const I = m.axisProperties?.bendingInertia ?? m.I ?? m.Iz;

                let maxDeviation = 0;
                for (let k = 0; k <= 40; k++) {
                    const x = (k / 40) * L;
                    const xi = x / L;

                    const N1 = 1 - 3 * xi ** 2 + 2 * xi ** 3;
                    const N2 = x * (1 - xi) ** 2;
                    const N3 = 3 * xi ** 2 - 2 * xi ** 3;
                    const N4 = (x ** 2 / L) * (xi - 1);

                    const u_local = (1 - xi) * ui + xi * uj;
                    const v_homogeneous = N1 * vi + N2 * rzi + N3 * vj + N4 * rzj;

                    let v_particular = 0;
                    if (w !== 0 && m.E > 0 && I > 0) {
                        if (m.i_conn === 'rigid' && m.j_conn === 'rigid') v_particular = (w * x ** 2 * (L - x) ** 2) / (24 * m.E * I);
                        else if (m.i_conn === 'pinned' && m.j_conn === 'pinned') v_particular = (w * x * (L ** 3 - 2 * L * x ** 2 + x ** 3)) / (24 * m.E * I);
                        else if (m.i_conn === 'rigid' && m.j_conn === 'pinned') v_particular = (w * x ** 2 * (3 * L ** 2 - 5 * L * x + 2 * x ** 2)) / (48 * m.E * I);
                        else if (m.i_conn === 'pinned' && m.j_conn === 'rigid') v_particular = (w * x * (L ** 3 - 3 * L * x ** 2 + 2 * x ** 3)) / (48 * m.E * I);
                    }

                    const v_local = v_homogeneous - v_particular;

                    const orig = {
                        x: ni.x + ex.x * x,
                        y: ni.y + ex.y * x,
                        z: (ni.z ?? 0) + ex.z * x
                    };

                    const disp = {
                        x: ex.x * u_local + ey.x * v_local,
                        y: ex.y * u_local + ey.y * v_local,
                        z: ex.z * u_local + ey.z * v_local
                    };

                    const pDef = { x: orig.x + disp.x, y: orig.y + disp.y, z: orig.z + disp.z };
                    const deviation = distPointToLine3D(aDef, bDef, pDef);
                    if (deviation > maxDeviation) maxDeviation = deviation;
                }

                const maxDeflectionMm = maxDeviation * 1000;
                const amplifiedDeflectionMm = maxDeflectionMm * settings.amplificationFactor;
                const ratio = (isFinite(allowableMm) && allowableMm > 1e-12) ? (amplifiedDeflectionMm / allowableMm) : NaN;
                const status = (isFinite(ratio)) ? (ratio > 1.0 ? 'NG' : 'OK') : 'N/A';
                const actualSpanRatio = (amplifiedDeflectionMm > 1e-12) ? ((L * 1000) / amplifiedDeflectionMm) : Infinity;

                results.push({
                    memberIndex: idx,
                    length: L,
                    maxDeflectionMm,
                    amplifiedDeflectionMm,
                    allowableMm,
                    allowableBySpanRatioMm: spanBasedAllowableMm,
                    allowableByFixedMm: fixedAllowableMm,
                    spanRatioLimit: settings.spanRatio,
                    actualSpanRatio,
                    ratio,
                    status
                });
                return;
            }

            results.push({ memberIndex: idx, status: 'N/A', message: '自由度が不明です' });
        });

        return results;
    };

    const displayDeflectionCheckResults = () => {
        if (!elements.deflectionCheckResults) return;
        if (!lastDeflectionCheckResults || lastDeflectionCheckResults.length === 0) {
            elements.deflectionCheckResults.innerHTML = '';
            return;
        }

        const settings = getDeflectionCheckSettings();
        let html = `<thead><tr>`;
        html += `<th>部材 #</th>`;
        html += `<th>スパン L (m)</th>`;
        html += `<th>最大たわみ (mm)</th>`;
        html += `<th>増大後 (×${settings.amplificationFactor.toFixed(2)}) (mm)</th>`;
        html += `<th>許容たわみ (mm)</th>`;
        html += `<th>スパン比 L/δ</th>`;
        html += `<th>検定比</th>`;
        html += `<th>判定</th>`;
        html += `</tr></thead><tbody>`;

        lastDeflectionCheckResults.forEach((res) => {
            const idx = (res.memberIndex ?? 0) + 1;
            const isNg = res.status === 'NG';
            const statusText = res.status === 'NG' ? '❌ NG' : (res.status === 'OK' ? '✅ OK' : '—');
            const ratioText = (typeof res.ratio === 'number' && isFinite(res.ratio)) ? res.ratio.toFixed(3) : '—';
            const spanRatioText = (typeof res.actualSpanRatio === 'number' && isFinite(res.actualSpanRatio)) ? res.actualSpanRatio.toFixed(1) : '∞';

            html += `<tr ${isNg ? 'style="background-color: #fdd;"' : ''}>`;
            html += `<td>${idx}</td>`;
            html += `<td>${(res.length ?? 0).toFixed(2)}</td>`;
            html += `<td>${(res.maxDeflectionMm ?? 0).toFixed(2)}</td>`;
            html += `<td>${(res.amplifiedDeflectionMm ?? 0).toFixed(2)}</td>`;
            html += `<td>${(res.allowableMm ?? 0).toFixed(2)}</td>`;
            html += `<td>${spanRatioText}</td>`;
            html += `<td style="font-weight: bold; ${isNg ? 'color: red;' : ''}">${ratioText}</td>`;
            html += `<td>${statusText}</td>`;
            html += `</tr>`;
        });

        html += `</tbody>`;
        elements.deflectionCheckResults.innerHTML = html;
    };

    const calculateLtbCheck = (loadTerm) => {
        try {
            if (!lastResults) {
                return [{ memberIndex: null, status: 'error', message: '解析結果がありません', ratio: NaN, loadTerm }];
            }

            const members = Array.isArray(lastResults.members) ? lastResults.members : [];
            const forces = Array.isArray(lastResults.forces) ? lastResults.forces : [];
            const memberLoads = Array.isArray(lastResults.memberLoads) ? lastResults.memberLoads : [];
            const settings = getLtbCheckSettings();

            if (members.length === 0) {
                return [{ memberIndex: null, status: 'N/A', message: '部材がありません', ratio: NaN, loadTerm }];
            }

            const results = [];
            const factor = (loadTerm === 'long') ? 1.5 : 1.0;

            members.forEach((member, idx) => {
                try {
                    if (!member) {
                        results.push({ memberIndex: idx, status: 'error', message: '部材データが不正', ratio: NaN, loadTerm });
                        return;
                    }

                    const { strengthProps, Z, E, length } = member;

            const isSteelLike = strengthProps && (strengthProps.type === 'F-value' || strengthProps.type === 'F-stainless' || strengthProps.type === 'F-aluminum');
            if (!isSteelLike) {
                results.push({ memberIndex: idx, status: 'N/A', message: '対象外材料', ratio: NaN });
                return;
            }

            try {
                const axisMode = member.sectionAxis?.mode;
                if (axisMode && axisMode !== 'strong' && axisMode !== 'both') {
                    results.push({ memberIndex: idx, status: 'N/A', message: '弱軸曲げ（横座屈省略）', ratio: NaN });
                    return;
                }
            } catch (_) { /* ignore */ }

            const F = strengthProps.value;
            if (!F || !isFinite(F)) {
                results.push({ memberIndex: idx, status: 'error', message: 'F値無効', ratio: NaN });
                return;
            }
            if (!Z || !isFinite(Z) || Z <= 0) {
                results.push({ memberIndex: idx, status: 'error', message: 'Zが無効', ratio: NaN });
                return;
            }
            if (!E || !isFinite(E) || E <= 0 || !length || !isFinite(length) || length <= 0) {
                results.push({ memberIndex: idx, status: 'error', message: 'E/長さが無効', ratio: NaN });
                return;
            }

            let Iy_m4 = member.Iy;
            let J_m4 = member.J;
            let Iw_m6 = member.Iw;

            const needBackfill = (!Iy_m4 || !isFinite(Iy_m4) || Iy_m4 <= 0 || !J_m4 || !isFinite(J_m4) || J_m4 <= 0 || !Iw_m6 || !isFinite(Iw_m6) || Iw_m6 <= 0);
            if (needBackfill) {
                try {
                    if (typeof lookupSteelDataPropertiesForSectionInfo === 'function') {
                        const sectionInfoForLookup = (typeof parseSectionInfoFromMember === 'function')
                            ? (parseSectionInfoFromMember(member) || member.sectionInfo)
                            : member.sectionInfo;

                        const props = sectionInfoForLookup ? lookupSteelDataPropertiesForSectionInfo(sectionInfoForLookup) : null;
                        if (props && typeof props === 'object') {
                            const iyCm4 = (props.Iy !== undefined && props.Iy !== null && props.Iy !== '') ? parseFloat(props.Iy) : NaN;
                            const jCm4 = (props.J !== undefined && props.J !== null && props.J !== '') ? parseFloat(props.J) : NaN;
                            const iwCm6 = (props.Iw !== undefined && props.Iw !== null && props.Iw !== '') ? parseFloat(props.Iw) : NaN;

                            const Iy2 = Number.isFinite(iyCm4) ? (iyCm4 * 1e-8) : undefined; // m^4
                            const J2 = Number.isFinite(jCm4) ? (jCm4 * 1e-8) : undefined; // m^4
                            const Iw2 = Number.isFinite(iwCm6) ? (iwCm6 * 1e-12) : undefined; // m^6

                            if ((!Iy_m4 || !isFinite(Iy_m4) || Iy_m4 <= 0) && Iy2 && isFinite(Iy2) && Iy2 > 0) Iy_m4 = Iy2;
                            if ((!J_m4 || !isFinite(J_m4) || J_m4 <= 0) && J2 && isFinite(J2) && J2 > 0) J_m4 = J2;
                            if ((!Iw_m6 || !isFinite(Iw_m6) || Iw_m6 <= 0) && Iw2 && isFinite(Iw2) && Iw2 > 0) Iw_m6 = Iw2;

                            if (Iy_m4 && isFinite(Iy_m4) && Iy_m4 > 0) member.Iy = Iy_m4;
                            if (J_m4 && isFinite(J_m4) && J_m4 > 0) member.J = J_m4;
                            if (Iw_m6 && isFinite(Iw_m6) && Iw_m6 > 0) member.Iw = Iw_m6;
                        }
                    }
                } catch (_) { /* ignore */ }
            }

            if (!Iy_m4 || !isFinite(Iy_m4) || Iy_m4 <= 0 || !J_m4 || !isFinite(J_m4) || J_m4 <= 0 || !Iw_m6 || !isFinite(Iw_m6) || Iw_m6 <= 0) {
                results.push({ memberIndex: idx, status: 'error', message: 'Iy/J/Iw データ不足', ratio: NaN });
                return;
            }

            const force = forces[idx];
            if (!force) {
                results.push({ memberIndex: idx, status: 'error', message: '断面力データがありません', ratio: NaN, loadTerm });
                return;
            }

            const load = memberLoads.find(l => l.memberIndex === idx);
            const w = getMemberDistributedLoadY(load);
            const L = length;

            let maxAbsM = 0;
            for (let k = 0; k <= 20; k++) {
                const x = (k / 20) * L;
                const M_linear = -force.M_i * (1 - x / L) + force.M_j * (x / L);
                const M_parabolic = w * L * x / 2 - w * x ** 2 / 2;
                const M_x = M_linear + M_parabolic;
                maxAbsM = Math.max(maxAbsM, Math.abs(M_x));
            }

            const E_Nmm2 = E * 1e-3; // kPa -> N/mm^2
            const nu = settings.nu;
            const G_Nmm2 = E_Nmm2 / (2 * (1 + nu));

            const Z_mm3 = Z * 1e9; // m^3 -> mm^3
            const Iy_mm4 = Iy_m4 * 1e12; // m^4 -> mm^4
            const J_mm4 = J_m4 * 1e12; // m^4 -> mm^4
            const Iw_mm6 = Iw_m6 * 1e18; // m^6 -> mm^6

            const lb_m = Math.max(0, settings.unbracedLengthFactor) * L;
            const lb_mm = lb_m * 1000;
            if (!isFinite(lb_mm) || lb_mm <= 1e-9) {
                results.push({ memberIndex: idx, status: 'error', message: 'Lbが無効', ratio: NaN });
                return;
            }

            const cb = settings.cb;
            const pi2 = Math.PI * Math.PI;
            const term1 = (pi2 * E_Nmm2 * Iy_mm4) / (lb_mm * lb_mm);
            const termInside = (Iw_mm6 / Iy_mm4) + ((lb_mm * lb_mm) * G_Nmm2 * J_mm4) / (pi2 * E_Nmm2 * Iy_mm4);
            const Mcr_Nmm = cb * term1 * Math.sqrt(Math.max(termInside, 0));
            const Mcr_kNm = Mcr_Nmm / 1e6;

            const fcr_Nmm2 = (Z_mm3 > 0) ? (Mcr_Nmm / Z_mm3) : NaN;

            const fb_base = F / factor;
            const fb_ltb = (isFinite(fcr_Nmm2) && fcr_Nmm2 > 0) ? Math.min(fb_base, fcr_Nmm2 / factor) : fb_base;

            const sigma_b = (Z_mm3 > 0) ? ((maxAbsM * 1e6) / Z_mm3) : NaN;
            const ratio = (isFinite(sigma_b) && isFinite(fb_ltb) && fb_ltb > 1e-12) ? (sigma_b / fb_ltb) : NaN;
            const status = isFinite(ratio) ? (ratio > 1.0 ? 'NG' : 'OK') : 'N/A';

            results.push({
                memberIndex: idx,
                L,
                Lb: lb_m,
                Cb: cb,
                nu,
                loadTerm,
                allowableFactor: factor,
                fb_base,
                Mmax: maxAbsM,
                Mcr: Mcr_kNm,
                sigma_b: sigma_b,
                fb_allow: fb_ltb,
                ratio,
                status,
                message: ''
            });
                } catch (e) {
                    console.error('LTB member calc failed:', { memberIndex: idx, e });
                    results.push({ memberIndex: idx, status: 'error', message: e?.message || 'LTB計算エラー', ratio: NaN, loadTerm });
                }
            });

            return results;
        } catch (e) {
            console.error('LTB check failed:', e);
            return [{ memberIndex: null, status: 'error', message: e?.message || 'LTB計算エラー', ratio: NaN, loadTerm }];
        }
    };

    const displayLtbCheckResults = () => {
        if (!elements.ltbCheckResults) return;
        if (!lastLtbCheckResults || lastLtbCheckResults.length === 0) {
            elements.ltbCheckResults.innerHTML = '<thead><tr><th>横座屈（LTB）</th></tr></thead><tbody><tr><td>結果なし（対象部材なし、または計算が実行されていない可能性があります）</td></tr></tbody>';
            return;
        }

        let html = `<thead><tr>`;
        html += `<th>部材 #</th>`;
        html += `<th>L (m)</th>`;
        html += `<th>Lb (m)</th>`;
        html += `<th>荷重</th>`;
        html += `<th>係数</th>`;
        html += `<th>fb基準 (N/mm²)</th>`;
        html += `<th>Cb</th>`;
        html += `<th>|M|max (kN·m)</th>`;
        html += `<th>Mcr (kN·m)</th>`;
        html += `<th>σb (N/mm²)</th>`;
        html += `<th>fb(横座屈) (N/mm²)</th>`;
        html += `<th>検定比</th>`;
        html += `<th>判定</th>`;
        html += `</tr></thead><tbody>`;

        lastLtbCheckResults.forEach((res) => {
            const idx = (typeof res.memberIndex === 'number') ? (res.memberIndex + 1) : '—';
            const isNg = res.status === 'NG';
            const statusText = res.status === 'NG' ? '❌ NG' : (res.status === 'OK' ? '✅ OK' : '—');
            const ratioText = (typeof res.ratio === 'number' && isFinite(res.ratio)) ? res.ratio.toFixed(3) : '—';

            const loadTermText = (res.loadTerm === 'long') ? '長期' : (res.loadTerm === 'short' ? '短期' : '—');
            const factorText = (typeof res.allowableFactor === 'number' && isFinite(res.allowableFactor)) ? res.allowableFactor.toFixed(2) : '—';
            const fbBaseText = (typeof res.fb_base === 'number' && isFinite(res.fb_base)) ? res.fb_base.toFixed(2) : '—';
            const cbText = (typeof res.Cb === 'number' && isFinite(res.Cb)) ? res.Cb.toFixed(2) : '—';

            const lText = (typeof res.L === 'number' && isFinite(res.L)) ? res.L.toFixed(2) : '—';
            const lbText = (typeof res.Lb === 'number' && isFinite(res.Lb)) ? res.Lb.toFixed(2) : '—';
            const mmaxText = (typeof res.Mmax === 'number' && isFinite(res.Mmax)) ? res.Mmax.toFixed(2) : '—';
            const mcrText = (typeof res.Mcr === 'number' && isFinite(res.Mcr)) ? res.Mcr.toFixed(2) : '—';
            const sigText = (typeof res.sigma_b === 'number' && isFinite(res.sigma_b)) ? res.sigma_b.toFixed(2) : (res.message || '—');
            const fbText = (typeof res.fb_allow === 'number' && isFinite(res.fb_allow)) ? res.fb_allow.toFixed(2) : '—';

            html += `<tr ${isNg ? 'style="background-color: #fdd;"' : ''}>`;
            html += `<td>${idx}</td>`;
            html += `<td>${lText}</td>`;
            html += `<td>${lbText}</td>`;
            html += `<td>${loadTermText}</td>`;
            html += `<td>${factorText}</td>`;
            html += `<td>${fbBaseText}</td>`;
            html += `<td>${cbText}</td>`;
            html += `<td>${mmaxText}</td>`;
            html += `<td>${mcrText}</td>`;
            html += `<td>${sigText}</td>`;
            html += `<td>${fbText}</td>`;
            html += `<td style="font-weight: bold; ${isNg ? 'color: red;' : ''}">${ratioText}</td>`;
            html += `<td>${statusText}</td>`;
            html += `</tr>`;
        });
        html += `</tbody>`;
        elements.ltbCheckResults.innerHTML = html;
    };

    const drawDualAxisCapacityRatioDiagram = (canvas, nodes, members, sectionCheckResults) => {
        console.log('🔧 drawDualAxisCapacityRatioDiagram 開始:', {
            hasCanvas: !!canvas,
            nodesCount: nodes?.length,
            membersCount: members?.length,
            sectionCheckResultsCount: sectionCheckResults?.length
        });
        
        if (!canvas) {
            console.warn('❌ 検定比図キャンバスが存在しません');
            return;
        }
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        console.log('🔧 キャンバス情報:', { width, height });
        
        // キャンバスをクリア
        ctx.clearRect(0, 0, width, height);
        
        // 投影モードを判定
        const dofPerNode = nodes.length > 0 && window.lastResults?.D ? (window.lastResults.D.length / nodes.length) : 0;
        const is3D = dofPerNode === 6;
        
        console.log('🔧 構造判定:', { dofPerNode, is3D });
        
        if (!is3D) {
            // 2D構造の場合は従来の検定比図を描画
            if (typeof drawCapacityRatioDiagram === 'function') {
                drawCapacityRatioDiagram(canvas, nodes, members, sectionCheckResults);
            }
            return;
        }
        
        // 3D構造の場合、応力図と同様の描画方式を使用
        drawCapacityRatioDiagramLikeStress(canvas, nodes, members, sectionCheckResults);
    };

    // 応力図と同様の検定比図描画関数
    const drawCapacityRatioDiagramLikeStress = (canvas, nodes, members, sectionCheckResults) => {
        const ctx = canvas.getContext('2d');
        
        // キャンバスをクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // フレーム設定（応力図と同様）
        const framePadding = 40;
        const frameWidth = 1200;  // 応力図と同じサイズ
        const frameHeight = 900;  // 応力図と同じサイズ
        const headerHeight = 80;
        
        // 第1軸と第2軸の検定比図を横並びで描画
        const frameData = [
            { title: '第1軸検定比図 (D/C)', axisType: 'primary' },
            { title: '第2軸検定比図 (D/C)', axisType: 'secondary' }
        ];
        
        // キャンバスサイズを調整（横スクロール対応）
        const totalWidth = frameData.length * (frameWidth + framePadding) + framePadding;
        const totalHeight = frameHeight + headerHeight + framePadding * 2;

        // 高DPI対応: デバイスピクセル比を取得
        const dpr = window.devicePixelRatio || 1;

        // キャンバスの内部解像度を高解像度に設定
        canvas.width = totalWidth * dpr;
        canvas.height = totalHeight * dpr;

        // CSSでの表示サイズは元のサイズ
        canvas.style.width = totalWidth + 'px';
        canvas.style.height = totalHeight + 'px';

        // コンテキストをスケール
        ctx.scale(dpr, dpr);
        
        // 各フレームを描画
        frameData.forEach((frame, frameIndex) => {
            const x = framePadding + frameIndex * (frameWidth + framePadding);
            const y = headerHeight + framePadding;
            
            const frameInfo = {
                ...frame,
                x: x,
                y: y
            };
            
            drawSingleCapacityRatioFrame(ctx, nodes, members, sectionCheckResults, frameInfo, frameWidth, frameHeight);
        });
        
        // 全体タイトル（期間情報を含む）
        const selectedTerm = document.querySelector('input[name="load-term"]:checked')?.value || 'short';
        const termLabel = selectedTerm === 'long' ? '長期' : '短期';
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`検定比図 (D/C) - ${termLabel}`, totalWidth / 2, 30);
    };

    // 単一フレームの検定比図描画（応力図と同様の方式）
    const drawSingleCapacityRatioFrame = (ctx, nodes, members, sectionCheckResults, frame, frameWidth, frameHeight) => {
        const { title, axisType, x, y } = frame;
        const projectionMode = 'iso'; // 等角投影を使用
        
        // フレーム境界
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);
        
        // フレームタイトル
        ctx.fillStyle = '#333';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(title, x + frameWidth / 2, y + 25);
        
        // 検定比データの準備
        let maxRatio = 0;
        let validMembers = [];
        
        members.forEach((member, idx) => {
            const result = sectionCheckResults[idx];
            if (!result || !result.ratios) return;
            
            const ratios = axisType === 'primary' ? result.ratios : 
                          (axisType === 'secondary' ? (result.ratiosY || result.ratiosZ || result.ratios) : result.ratios);
            
            if (ratios && ratios.length > 0) {
                const memberMaxRatio = Math.max(...ratios);
                maxRatio = Math.max(maxRatio, memberMaxRatio);
                validMembers.push({ member, idx, result, ratios });
            }
        });
        
        if (maxRatio === 0) {
            ctx.fillStyle = '#999';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('検定比データなし', x + frameWidth / 2, y + frameHeight / 2);
            return;
        }
        
        // スケール計算（コンテナ内に収まるように調整）
        const margin = 80; // マージンを大きくして数値表示のスペースを確保
        const drawWidth = frameWidth - 2 * margin;
        const drawHeight = frameHeight - 2 * margin;
        
        // 3D座標の範囲を計算
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        validMembers.forEach(({ member }) => {
            const ni = nodes[member.i];
            const nj = nodes[member.j];
            const pi = project3DTo2D(ni, projectionMode);
            const pj = project3DTo2D(nj, projectionMode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });
        
        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        
        // モデルスケール（検定比の表示領域も考慮）
        let modelScale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            // 検定比の表示領域を考慮してスケールを調整
            const ratioDisplaySpace = Math.min(drawWidth, drawHeight) * 0.2;
            modelScale = Math.min(
                (drawWidth - ratioDisplaySpace) / modelWidth, 
                (drawHeight - ratioDisplaySpace) / modelHeight
            ) * 0.7;
        }
        
        // 検定比のスケール（モデルに収まるように調整）
        const maxRatioPixels = Math.min(drawWidth, drawHeight) * 0.12;
        const ratioScale = maxRatio > 0 ? maxRatioPixels / maxRatio : 1;
        
        // 座標変換関数（モデルを中央に配置）
        const modelCenterX = (minX + maxX) / 2;
        const modelCenterY = (minY + maxY) / 2;
        const frameCenterX = x + frameWidth / 2;
        const frameCenterY = y + frameHeight / 2;
        
        const transform = (px, py) => ({
            x: frameCenterX + (px - modelCenterX) * modelScale,
            y: frameCenterY - (py - modelCenterY) * modelScale
        });
        
        // ラベル配置管理
        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];
        
        // 節点を描画
        validMembers.forEach(({ member, idx }) => {
            const ni = nodes[member.i];
            const nj = nodes[member.j];
            const pi = project3DTo2D(ni, projectionMode);
            const pj = project3DTo2D(nj, projectionMode);
            const pos1 = transform(pi.x, pi.y);
            const pos2 = transform(pj.x, pj.y);
            
            nodeScreenData.push({ nodeIndex: member.i, x: pos1.x, y: pos1.y });
            nodeScreenData.push({ nodeIndex: member.j, x: pos2.x, y: pos2.y });
            
            registerCircleObstacle(labelObstacles, pos1.x, pos1.y, 4);
            registerCircleObstacle(labelObstacles, pos2.x, pos2.y, 4);
        });
        
        // 構造を描画（応力図と同様）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        validMembers.forEach(({ member, idx }) => {
            const ni = nodes[member.i];
            const nj = nodes[member.j];
            const pi = project3DTo2D(ni, projectionMode);
            const pj = project3DTo2D(nj, projectionMode);
            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);
            
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.hypot(dx, dy) || 1;
            memberScreenData.push({
                memberIndex: idx,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                tangent: { x: dx / length, y: dy / length },
                normal: { x: -dy / length, y: dx / length }
            });
        });
        
        // 検定比分布を描画（応力図と同様の方式）
        validMembers.forEach(({ member, idx, result, ratios }) => {
            const ni = nodes[member.i];
            const nj = nodes[member.j];
            const pi = project3DTo2D(ni, projectionMode);
            const pj = project3DTo2D(nj, projectionMode);
            
            const start = transform(pi.x, pi.y);
            const end = transform(pj.x, pj.y);
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy);
            
            if (length === 0) return;
            
            const perpX = -dy / length;
            const perpY = dx / length;
            
            // 検定比分布の計算
            const numDivisions = ratios.length - 1;
            const ratioPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const t = k / numDivisions;
                const baseX = start.x + t * dx;
                const baseY = start.y + t * dy;
                const ratio = ratios[k];
                const offset = ratio * ratioScale;
                
                ratioPoints.push({
                    x: baseX,
                    y: baseY,
                    offset: offset,
                    value: ratio
                });
            }
            
            // 検定比分布を塗りつぶし（応力図と同じ方式）
            ctx.save();
            ctx.beginPath();
            
            // 外側の輪郭
            for (let k = 0; k <= numDivisions; k++) {
                const p = ratioPoints[k];
                const px = p.x + perpX * p.offset;
                const py = p.y + perpY * p.offset;
                
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            
            // 内側の輪郭（薄い線）
            for (let k = numDivisions; k >= 0; k--) {
                const p = ratioPoints[k];
                const px = p.x + perpX * p.offset * 0.1;
                const py = p.y + perpY * p.offset * 0.1;
                ctx.lineTo(px, py);
            }
            
            ctx.closePath();
            
            // 検定比に応じた色で塗りつぶし
            const maxMemberRatio = Math.max(...ratios);
            const color = window.getRatioColor ? window.getRatioColor(maxMemberRatio) : getRatioColor(maxMemberRatio);
            ctx.fillStyle = color + '60'; // 透明度付き
            ctx.fill();
            
            ctx.restore();
            
            // 輪郭線
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let k = 0; k <= numDivisions; k++) {
                const p = ratioPoints[k];
                const px = p.x + perpX * p.offset;
                const py = p.y + perpY * p.offset;
                
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            
            // 基準線（D/C=1.0）は表示しない（応力図と同様）
            
            // 数値表示：各部材の最大値のみ
            let maxAbsValue = 0;
            let maxAbsIndex = 0;
            ratioPoints.forEach((p, idx) => {
                if (Math.abs(p.value) > maxAbsValue) {
                    maxAbsValue = Math.abs(p.value);
                    maxAbsIndex = idx;
                }
            });
            
            if (maxAbsValue > 0.001) {
                const maxPoint = ratioPoints[maxAbsIndex];
                
                // 最大値の位置を正確に計算（検定比分布の外側に配置）
                const markerX = maxPoint.x + perpX * maxPoint.offset;
                const markerY = maxPoint.y + perpY * maxPoint.offset;
                
                // 最大値のマーカー（赤丸）
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(markerX, markerY, 5, 0, 2 * Math.PI);
                ctx.fill();
                
                // 白い縁取り
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                // 最大値の数値を表示（マーカーの近傍）
                const maxValueText = maxPoint.value.toFixed(3);
                ctx.font = 'bold 14px Arial';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#ff0000';
                ctx.fillText(maxValueText, markerX, markerY - 20);
            }
        });
        
        // 部材番号を表示
        ctx.fillStyle = '#0066cc';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        memberScreenData.forEach(({ memberIndex, midX, midY }) => {
            ctx.fillText(String(memberIndex + 1), midX, midY);
        });
        
        // スケール表示
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`最大検定比: ${maxRatio.toFixed(3)}`, x + 10, y + frameHeight - 10);
    };

    // 円形障害物を登録する関数
    const registerCircleObstacle = (obstacles, x, y, radius) => {
        obstacles.push({
            x1: x - radius,
            y1: y - radius,
            x2: x + radius,
            y2: y + radius
        });
    };

    // テキスト配置管理関数
    const drawTextWithPlacement = (ctx, text, x, y, obstacles, options = {}) => {
        const { strokeStyle = 'white', fillStyle = '#000', padding = 8 } = options;
        
        // テキストのサイズを測定
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = parseInt(ctx.font);
        
        // 衝突チェック
        const textRect = {
            x1: x - textWidth / 2 - padding,
            y1: y - textHeight / 2 - padding,
            x2: x + textWidth / 2 + padding,
            y2: y + textHeight / 2 + padding
        };
        
        let hasCollision = false;
        obstacles.forEach(obstacle => {
            if (textRect.x1 < obstacle.x2 && textRect.x2 > obstacle.x1 &&
                textRect.y1 < obstacle.y2 && textRect.y2 > obstacle.y1) {
                hasCollision = true;
            }
        });
        
        // 衝突がある場合は位置を調整（より多くの方向を試す）
        if (hasCollision) {
            // 上下左右、斜め方向にもオフセットを試す
            const offsets = [
                { dx: 0, dy: -textHeight - padding },      // 上
                { dx: 0, dy: textHeight + padding },       // 下
                { dx: textWidth + padding, dy: 0 },        // 右
                { dx: -textWidth - padding, dy: 0 },       // 左
                { dx: textWidth + padding, dy: -textHeight - padding }, // 右上
                { dx: -textWidth - padding, dy: -textHeight - padding }, // 左上
                { dx: textWidth + padding, dy: textHeight + padding },   // 右下
                { dx: -textWidth - padding, dy: textHeight + padding },  // 左下
            ];
            
            for (const offset of offsets) {
                const newX = x + offset.dx;
                const newY = y + offset.dy;
                const newRect = {
                    x1: newX - textWidth / 2 - padding,
                    y1: newY - textHeight / 2 - padding,
                    x2: newX + textWidth / 2 + padding,
                    y2: newY + textHeight / 2 + padding
                };
                
                let newCollision = false;
                obstacles.forEach(obstacle => {
                    if (newRect.x1 < obstacle.x2 && newRect.x2 > obstacle.x1 &&
                        newRect.y1 < obstacle.y2 && newRect.y2 > obstacle.y1) {
                        newCollision = true;
                    }
                });
                
                if (!newCollision) {
                    x = newX;
                    y = newY;
                    break;
                }
            }
        }
        
        // テキストを描画
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 3;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = fillStyle;
        ctx.fillText(text, x, y);
        
        // 障害物として登録
        obstacles.push({
            x1: x - textWidth / 2 - padding,
            y1: y - textHeight / 2 - padding,
            x2: x + textWidth / 2 + padding,
            y2: y + textHeight / 2 + padding
        });
    };

    // 検定比に応じた色を返す関数
    const getRatioColor = (ratio) => {
        if (ratio < 0.5) return '#00ff00';      // 緑
        if (ratio < 0.7) return '#90ee90';      // 薄緑
        if (ratio < 0.9) return '#ffff00';      // 黄色
        if (ratio < 1.0) return '#ffa500';      // オレンジ
        return '#ff0000';                        // 赤
    };
    
    const drawSingleAxisCapacityRatioDiagram = (ctx, nodes, members, sectionCheckResults, axisType, 
        x, y, width, height, projectionMode) => {
        
        console.log('🔧 drawSingleAxisCapacityRatioDiagram 開始:', {
            axisType,
            frameRect: { x, y, width, height },
            projectionMode,
            nodesCount: nodes?.length,
            membersCount: members?.length,
            sectionCheckResultsCount: sectionCheckResults?.length
        });
        
        // フレーム境界を描画
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        // タイトルを描画（期間情報を含む）
        const selectedTerm = document.querySelector('input[name="load-term"]:checked')?.value || 'short';
        const termLabel = selectedTerm === 'long' ? '長期' : '短期';
        ctx.fillStyle = '#333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        const title = axisType === 'primary' ? `第1軸検定比図 (${termLabel})` : `第2軸検定比図 (${termLabel})`;
        ctx.fillText(title, x + width / 2, y + 20);
        
        // 検定比の最大値を計算
        let maxRatio = 0;
        let validResultsCount = 0;
        sectionCheckResults.forEach((result, idx) => {
            if (result.ratios) {
                validResultsCount++;
                const ratios = axisType === 'primary' ? result.ratios : 
                              (axisType === 'secondary' ? (result.ratiosY || result.ratiosZ || result.ratios) : result.ratios);
                ratios.forEach(ratio => {
                    if (ratio > maxRatio) maxRatio = ratio;
                });
            }
        });
        
        console.log('🔧 検定比データ分析:', {
            axisType,
            totalResults: sectionCheckResults.length,
            validResultsCount,
            maxRatio,
            hasRatiosY: sectionCheckResults.some(r => r.ratiosY),
            hasRatiosZ: sectionCheckResults.some(r => r.ratiosZ)
        });
        
        if (maxRatio === 0) {
            console.warn('❌ 検定比データなし');
            ctx.fillStyle = '#999';
            ctx.font = '12px Arial';
            ctx.fillText('検定比データなし', x + width / 2, y + height / 2);
            return;
        }
        
        // 検定比スケールを計算（より大きな表示にする）
        const ratioScale = Math.min(width, height) * 0.8 / maxRatio;
        
        console.log('🔧 検定比スケール:', { maxRatio, ratioScale, frameSize: { width, height } });
        
        // 部材を描画
        let drawnMembersCount = 0;
        members.forEach((member, idx) => {
            const result = sectionCheckResults[idx];
            if (!result || !result.ratios) {
                console.log('🔧 部材スキップ:', { memberIndex: idx + 1, hasResult: !!result, hasRatios: !!(result?.ratios) });
                return;
            }
            
            const ratios = axisType === 'primary' ? result.ratios : 
                          (axisType === 'secondary' ? (result.ratiosY || result.ratiosZ || result.ratios) : result.ratios);
            
            const nodeI = nodes[member.i];
            const nodeJ = nodes[member.j];
            
            // 3D座標を2Dに投影
            const start3D = { x: nodeI.x, y: nodeI.y || 0, z: nodeI.z || 0 };
            const end3D = { x: nodeJ.x, y: nodeJ.y || 0, z: nodeJ.z || 0 };
            
            const start2D = project3DTo2D(start3D, projectionMode);
            const end2D = project3DTo2D(end3D, projectionMode);
            
            // フレーム内の座標に変換
            const startX = x + (start2D.x + 1) * width / 2;
            const startY = y + height - (start2D.y + 1) * height / 2;
            const endX = x + (end2D.x + 1) * width / 2;
            const endY = y + height - (end2D.y + 1) * height / 2;
            
            // 部材の方向ベクトルと垂直ベクトル
            const dx = endX - startX;
            const dy = endY - startY;
            const length = Math.sqrt(dx * dx + dy * dy);
            
            if (length === 0) return;
            
            const perpX = -dy / length;
            const perpY = dx / length;
            
            // 検定比分布を描画
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            
            // 検定比分布の外側ライン
            ratios.forEach((ratio, k) => {
                const t = k / (ratios.length - 1);
                const baseX = startX + t * dx;
                const baseY = startY + t * dy;
                const offset = ratio * ratioScale;
                const px = baseX + perpX * offset;
                const py = baseY + perpY * offset;
                ctx.lineTo(px, py);
            });
            
            // 検定比分布の内側ライン（逆順）
            for (let k = ratios.length - 1; k >= 0; k--) {
                const t = k / (ratios.length - 1);
                const baseX = startX + t * dx;
                const baseY = startY + t * dy;
                const px = baseX - perpX * ratioScale * 0.1; // 薄い線
                const py = baseY - perpY * ratioScale * 0.1;
                ctx.lineTo(px, py);
            }
            
            ctx.closePath();
            
            // 検定比に応じた色で塗りつぶし
            const maxMemberRatio = Math.max(...ratios);
            const color = getRatioColor(maxMemberRatio);
            ctx.fillStyle = color + '40'; // 透明度付き
            ctx.fill();
            
            // 輪郭線を描画
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // 最大検定比の位置にマーカー
            const maxRatioIndex = ratios.indexOf(maxMemberRatio);
            const t = maxRatioIndex / (ratios.length - 1);
            const markerX = startX + t * dx + perpX * maxMemberRatio * ratioScale;
            const markerY = startY + t * dy + perpY * maxMemberRatio * ratioScale;
            
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(markerX, markerY, 3, 0, 2 * Math.PI);
            ctx.fill();
            
            // 最大検定比の値を表示
            ctx.fillStyle = '#000';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(maxMemberRatio.toFixed(2), markerX, markerY - 8);
            
            drawnMembersCount++;
        });
        
        console.log('🔧 部材描画完了:', {
            axisType,
            totalMembers: members.length,
            drawnMembersCount,
            maxRatio
        });
    };

    const displaySectionCheckResults = () => {
        if (!lastSectionCheckResults) { elements.sectionCheckResults.innerHTML = ''; return; }
        console.log("断面算定の計算結果:", lastSectionCheckResults);
        
        // 現在選択されている期間を取得
        const selectedTerm = document.querySelector('input[name="load-term"]:checked')?.value || 'short';
        const termLabel = selectedTerm === 'long' ? '長期' : '短期';
        
        // HTMLの検定比図タイトルも更新
        const ratioDiagramTitle = document.getElementById('ratio-diagram-title');
        if (ratioDiagramTitle) {
            ratioDiagramTitle.textContent = `検定比図 (D/C) - ${termLabel}`;
        }
        
        // 3D構造かどうかを判定
        const dofPerNode = lastResults?.D?.length / lastResults?.nodes?.length;
        const is3D = dofPerNode === 6;
        
        let html;
        if (is3D) {
            // 3D構造の場合：両軸の結果を表示
            html = `<thead><tr><th>部材 #</th><th>軸力 N (kN)</th><th>曲げ M1 (kN·m)</th><th>曲げ M2 (kN·m)</th><th>せん断 Q1 (kN)</th><th>せん断 Q2 (kN)</th><th>検定項目</th><th>曲げ検定比1 (${termLabel})</th><th>曲げ検定比2 (${termLabel})</th><th>せん断検定比1 (${termLabel})</th><th>せん断検定比2 (${termLabel})</th><th>最大検定比 (${termLabel})</th><th>判定</th><th>詳細</th></tr></thead><tbody>`;
            lastSectionCheckResults.forEach((res, i) => {
                const is_ng = res.status === 'NG';
                const maxRatioText = (typeof res.maxRatio === 'number' && isFinite(res.maxRatio)) ? res.maxRatio.toFixed(2) : res.maxRatio;
                const statusText = is_ng ? '❌ NG' : '✅ OK';
                
                // 各軸の検定比を計算
                const ratio1 = res.ratios && res.ratios.length > 0 ? Math.max(...res.ratios).toFixed(2) : '0.00';
                const ratio2 = res.ratiosY && res.ratiosY.length > 0 ? Math.max(...res.ratiosY).toFixed(2) : '0.00';
                const shearRatio1 = res.shearRatiosY && res.shearRatiosY.length > 0 ? Math.max(...res.shearRatiosY).toFixed(2) : '0.00';
                const shearRatio2 = res.shearRatiosZ && res.shearRatiosZ.length > 0 ? Math.max(...res.shearRatiosZ).toFixed(2) : '0.00';
                
                // 断面検定の計算結果から曲げモーメントとせん断力を取得
                let M1_display = '0.00';
                let M2_display = '0.00';
                let Q1_display = '0.00';
                let Q2_display = '0.00';
                
                // 断面検定の計算結果からM1、M2、Q1、Q2を取得（曲げモーメント図と同じ計算方法）
                if (res.M1 !== undefined && res.M1 !== null) {
                    M1_display = res.M1.toFixed(2);
                }
                if (res.M2 !== undefined && res.M2 !== null) {
                    M2_display = res.M2.toFixed(2);
                }
                if (res.Q1 !== undefined && res.Q1 !== null) {
                    Q1_display = res.Q1.toFixed(2);
                }
                if (res.Q2 !== undefined && res.Q2 !== null) {
                    Q2_display = res.Q2.toFixed(2);
                }
                
                html += `<tr ${is_ng ? 'style="background-color: #fdd;"' : ''}>
                    <td>${i + 1}</td>
                    <td>${res.N.toFixed(2)}</td>
                    <td>${M1_display}</td>
                    <td>${M2_display}</td>
                    <td>${Q1_display}</td>
                    <td>${Q2_display}</td>
                    <td>${res.checkType}</td>
                    <td style="font-weight: bold; ${parseFloat(ratio1) > 1.0 ? 'color: red;' : ''}">${ratio1}</td>
                    <td style="font-weight: bold; ${parseFloat(ratio2) > 1.0 ? 'color: red;' : ''}">${ratio2}</td>
                    <td style="font-weight: bold; ${parseFloat(shearRatio1) > 1.0 ? 'color: red;' : ''}">${shearRatio1}</td>
                    <td style="font-weight: bold; ${parseFloat(shearRatio2) > 1.0 ? 'color: red;' : ''}">${shearRatio2}</td>
                    <td style="font-weight: bold; ${is_ng ? 'color: red;' : ''}">${maxRatioText}</td>
                    <td>${statusText}</td>
                    <td><button onclick="showSectionCheckDetail(${i})">詳細</button></td>
                </tr>`;
            });
        } else {
            // 2D構造の場合：従来の表示
            html = `<thead><tr><th>部材 #</th><th>軸力 N (kN)</th><th>曲げ M (kN·m)</th><th>検定項目</th><th>検定比 (D/C) (${termLabel})</th><th>判定</th><th>詳細</th></tr></thead><tbody>`;
            lastSectionCheckResults.forEach((res, i) => {
                const is_ng = res.status === 'NG';
                const maxRatioText = (typeof res.maxRatio === 'number' && isFinite(res.maxRatio)) ? res.maxRatio.toFixed(2) : res.maxRatio;
                const statusText = is_ng ? '❌ NG' : '✅ OK';
                html += `<tr ${is_ng ? 'style="background-color: #fdd;"' : ''}><td>${i + 1}</td><td>${res.N.toFixed(2)}</td><td>${res.M.toFixed(2)}</td><td>${res.checkType}</td><td style="font-weight: bold; ${is_ng ? 'color: red;' : ''}">${maxRatioText}</td><td>${statusText}</td><td><button onclick="showSectionCheckDetail(${i})">詳細</button></td></tr>`;
            });
        }
        
        html += `</tbody>`;
        elements.sectionCheckResults.innerHTML = html;
    };

    const showSectionCheckDetail = (memberIndex) => {
        const res = lastSectionCheckResults[memberIndex];
        if (!res || !res.ratios) return;

        const { members, forces, memberLoads } = lastResults;
        const member = members[memberIndex];
        const force = forces[memberIndex];
        const load = memberLoads.find(l => l.memberIndex === memberIndex);
        const w = getMemberDistributedLoadY(load);
        const L = member.length;
        const numPoints = res.ratios.length;
        
        // 3D構造かどうかを判定
        const dofPerNode = lastResults.D.length / lastResults.nodes.length;
        const is3D = dofPerNode === 6;

        // 材料特性の取得
        const { strengthProps, A: A_original, Z, ix, iy, E } = member;
        let materialInfo = '';
        let allowableStresses = { ft: 0, fc: 0, fb: 0, fs: 0 };
        
        // 部材1の場合はテーブルからの値を優先する（後でA_fromTableが取得された後に適用）
        let A = A_original;
        
        // 各軸の断面係数を取得
        console.log('🔧 断面係数デバッグ:', {
            memberIndex: memberIndex + 1,
            member: member,
            properties: member.properties,
            sectionModulus: member.properties?.sectionModulus,
            zxNumeric: member.properties?.sectionModulus?.zxNumeric,
            zyNumeric: member.properties?.sectionModulus?.zyNumeric,
            zx: member.properties?.sectionModulus?.zx,
            zy: member.properties?.sectionModulus?.zy,
            Z: Z,
            sectionInfo: member.sectionInfo,
            sectionSummary: member.sectionSummary,
            allMemberKeys: Object.keys(member)
        });
        
        // 部材テーブルから直接A、ZxとZyを取得
        let A_fromTable = null, Zx_fromTable = null, Zy_fromTable = null;
        try {
            const memberRows = elements.membersTable.rows;
            console.log('🔧 テーブル検索:', { targetMemberIndex: memberIndex + 1, totalRows: memberRows.length });
            
            // テーブルの構造をデバッグ出力
            if (memberIndex <= 1) {
                console.log('🔧 テーブル構造デバッグ:');
                for (let debugI = 1; debugI < Math.min(memberRows.length, 6); debugI++) {
                    const debugRow = memberRows[debugI];
                    const debugFirstCell = debugRow.cells[0];
                    const debugInput = debugFirstCell.querySelector('input');
                    const debugTextContent = debugFirstCell.textContent?.trim();
                    
                    // 断面係数の入力フィールドもチェック
                    const debugZxInput = debugRow.cells[10]?.querySelector('input[type="number"]');
                    const debugZyInput = debugRow.cells[11]?.querySelector('input[type="number"]');
                    
                    console.log(`  行${debugI}:`, {
                        hasInput: !!debugInput,
                        inputValue: debugInput?.value,
                        textContent: debugTextContent,
                        parsedValue: debugTextContent && !isNaN(parseInt(debugTextContent)) ? parseInt(debugTextContent) : null,
                        zxInputValue: debugZxInput?.value,
                        zyInputValue: debugZyInput?.value,
                        zxInputExists: !!debugZxInput,
                        zyInputExists: !!debugZyInput
                    });
                }
            }
            
            for (let i = 1; i < memberRows.length; i++) { // ヘッダー行をスキップ
                const row = memberRows[i];
                const firstCell = row.cells[0];
                
                // 部材番号の取得方法を複数試す
                let rowMemberNumber = 0;
                
                // 方法1: input要素から取得
                const input = firstCell.querySelector('input');
                if (input && input.value && !isNaN(parseInt(input.value))) {
                    rowMemberNumber = parseInt(input.value);
                } else {
                    // 方法2: テキストコンテンツから取得
                    const textContent = firstCell.textContent?.trim();
                    if (textContent && !isNaN(parseInt(textContent))) {
                        rowMemberNumber = parseInt(textContent);
                    } else {
                        // 方法3: 行インデックスを使用（1ベース）
                        // テーブルの行インデックスは1から始まり、部材番号も1から始まる
                        rowMemberNumber = i;
                    }
                }
                
                // 部材番号の妥当性チェック
                if (rowMemberNumber < 1 || rowMemberNumber > memberRows.length - 1) {
                    console.warn(`🔧 部材番号が範囲外: ${rowMemberNumber}, 行インデックス: ${i}`);
                    rowMemberNumber = i; // 行インデックスを部材番号として使用
                }
                
                // 部材1の特別処理：テーブルの最初の行（行インデックス1）は部材1として扱う
                if (i === 1 && memberIndex === 0) {
                    rowMemberNumber = 1;
                    console.log('🔧 部材1の特別処理: 行インデックス1を部材1として扱う');
                }
                
                // 部材1と部材2の詳細ログ
                if (memberIndex <= 1) {
                    console.log('🔧 行チェック:', { 
                        memberIndex: memberIndex + 1,
                        rowIndex: i, 
                        rowMemberNumber, 
                        targetMemberIndex: memberIndex + 1,
                        hasInput: !!input,
                        inputValue: input?.value,
                        textContent: firstCell.textContent?.trim(),
                        method: input ? 'input' : (firstCell.textContent?.trim() && !isNaN(parseInt(firstCell.textContent.trim())) ? 'text' : 'index'),
                        dataset: {
                            zx: row.dataset.zx,
                            zy: row.dataset.zy
                        },
                        isMatch: rowMemberNumber === memberIndex + 1
                    });
                }
                
                if (rowMemberNumber === memberIndex + 1) {
                    // 実際の入力フィールドから値を取得
                    const areaInput = row.cells[9]?.querySelector('input[type="number"]'); // 断面積 A (cm²)
                    const zxInput = row.cells[10]?.querySelector('input[type="number"]');  // 断面係数 Zx (cm³)
                    const zyInput = row.cells[11]?.querySelector('input[type="number"]');  // 断面係数 Zy (cm³)
                    
                    A_fromTable = areaInput?.value ? parseFloat(areaInput.value) : null;
                    Zx_fromTable = zxInput?.value ? parseFloat(zxInput.value) : null;
                    Zy_fromTable = zyInput?.value ? parseFloat(zyInput.value) : null;
                    
                    // 部材1と部材2の詳細ログ
                    if (memberIndex <= 1) {
                        console.log('🔧 テーブルから取得成功:', { 
                            memberIndex: memberIndex + 1,
                            A_fromTable,
                            Zx_fromTable, 
                            Zy_fromTable, 
                            rowMemberNumber,
                            areaInputValue: areaInput?.value,
                            zxInputValue: zxInput?.value,
                            zyInputValue: zyInput?.value,
                            areaInputElement: !!areaInput,
                            zxInputElement: !!zxInput,
                            zyInputElement: !!zyInput,
                            cell9Content: row.cells[9]?.textContent?.trim(),
                            cell10Content: row.cells[10]?.textContent?.trim(),
                            cell11Content: row.cells[11]?.textContent?.trim(),
                            // 追加デバッグ情報
                            cell9Query: row.cells[9]?.querySelector('input[type="number"]')?.value,
                            cell10Query: row.cells[10]?.querySelector('input[type="number"]')?.value,
                            cell11Query: row.cells[11]?.querySelector('input[type="number"]')?.value
                        });
                    }
                    break;
                }
            }
        } catch (error) {
            console.warn('テーブルからの断面係数取得エラー:', error);
        }
        
        // sectionInfoとsectionSummaryの詳細を確認
        console.log('🔧 sectionInfo詳細:', member.sectionInfo);
        console.log('🔧 sectionSummary詳細:', member.sectionSummary);
        
        // 断面係数の取得（複数の方法でフォールバック）
        let Zx_fromSectionInfo = null, Zx_fromSectionSummary = null;
        if (member.sectionInfo && typeof member.sectionInfo === 'object') {
            Zx_fromSectionInfo = member.sectionInfo.Zx || member.sectionInfo.zx || member.sectionInfo.Z;
        }
        if (member.sectionSummary && typeof member.sectionSummary === 'object') {
            Zx_fromSectionSummary = member.sectionSummary.Zx || member.sectionSummary.zx || member.sectionSummary.Z;
        }
        
        let Zy_fromSectionInfo = null, Zy_fromSectionSummary = null;
        if (member.sectionInfo && typeof member.sectionInfo === 'object') {
            Zy_fromSectionInfo = member.sectionInfo.Zy || member.sectionInfo.zy;
            // Zはフォールバックとして使用しない（Zxと同じ値になるため）
        }
        if (member.sectionSummary && typeof member.sectionSummary === 'object') {
            Zy_fromSectionSummary = member.sectionSummary.Zy || member.sectionSummary.zy;
            // Zはフォールバックとして使用しない（Zxと同じ値になるため）
        }
        
        // 部材1の場合はテーブルからの値を最優先にする
        let Zx_raw;
        if (memberIndex === 0) {
            // 部材1: テーブルからの値が取得できた場合はそれを使用、そうでなければ計算値を使用しない
            Zx_raw = Zx_fromTable || Z;
            if (Zx_fromTable === null) {
                console.log('🔧 部材1: テーブルからの値が取得できないため、フォールバック値を使用');
                console.log('🔧 部材1: テーブル検索結果:', {
                    Zx_fromTable,
                    Zy_fromTable,
                    A_fromTable,
                    totalRows: elements.membersTable.rows.length
                });
            } else {
                console.log('🔧 部材1: テーブルからの値を優先使用', {
                    Zx_fromTable,
                    Zy_fromTable
                });
            }
        } else {
            // 他の部材: 従来の優先順位
            Zx_raw = Zx_fromTable ||
                      member.properties?.sectionModulus?.zxNumeric || 
                      member.properties?.sectionModulus?.zx || 
                      member.properties?.sectionModulus?.numeric || 
                      Zx_fromSectionInfo ||
                      Zx_fromSectionSummary ||
                      Z;
        }
        // 部材1の場合はテーブルからの値を最優先にする（Zyについても同様）
        let Zy_raw;
        if (memberIndex === 0) {
            // 部材1: テーブルからの値が取得できた場合はそれを使用
            Zy_raw = Zy_fromTable || null;
        } else {
            // 他の部材: 従来の優先順位
            Zy_raw = Zy_fromTable ||
                      member.properties?.sectionModulus?.zyNumeric || 
                      member.properties?.sectionModulus?.zy || 
                      Zy_fromSectionInfo ||
                      Zy_fromSectionSummary;
        }
                      // Zはフォールバックとして使用しない（Zxと同じ値になるため）
        
        let Zx = parseFloat(Zx_raw) || Z;
        
        // Zyの取得を改善：より詳細なデバッグ情報付き
        let Zy = null;
        if (Zy_raw !== null && Zy_raw !== undefined && !isNaN(parseFloat(Zy_raw))) {
            Zy = parseFloat(Zy_raw);
        } else {
            // Zyが取得できない場合の代替計算
            // IyとAから断面係数を推定
            if (member.properties?.momentOfInertia?.iy && member.properties?.area) {
                const Iy_cm4 = parseFloat(member.properties.momentOfInertia.iy) || 0;
                const A_cm2 = parseFloat(member.properties.area.numeric) || 0;
                if (Iy_cm4 > 0 && A_cm2 > 0) {
                    const ry_cm = Math.sqrt(Iy_cm4 / A_cm2);
                    const cy_cm = ry_cm * 2; // 断面の高さ（概算）
                    Zy = Iy_cm4 / cy_cm; // cm³単位
                }
            }
            
            // それでも取得できない場合はZxの一定割合を使用
            if (Zy === null || Zy === 0) {
                Zy = Zx * 0.3; // 一般的にZyはZxより小さい
            }
        }
        
        // 部材1の断面係数が異常に小さい場合の修正（テーブルからの値が取得できない場合のみ）
        // 計算値による修正を一時的に無効化（テーブルからの値を使用するため）
        /*
        if (memberIndex === 0 && Zx < 1.0 && Zx_fromTable === null) {
            console.log('🔧 部材1の断面係数が異常に小さいため修正します（テーブルから値が取得できない場合）:', {
                original_Zx: Zx,
                Zx_fromTable,
                member_sectionInfo: member.sectionInfo
            });
            
            // H形鋼200×200×8×12の正しい断面係数を計算
            if (member.sectionInfo && member.sectionInfo.typeKey === 'hkatakou_hiro') {
                const dims = member.sectionInfo.rawDims;
                if (dims && dims.H === 200 && dims.B === 200 && dims.t1 === 8 && dims.t2 === 12) {
                    // H形鋼の断面係数計算
                    const H = dims.H / 10; // mm → cm
                    const B = dims.B / 10; // mm → cm
                    const t1 = dims.t1 / 10; // mm → cm
                    const t2 = dims.t2 / 10; // mm → cm
                    
                    const A_h = 2 * B * t2 + (H - 2 * t2) * t1;
                    const Ix_h = (B * H**3 - (B - t1) * (H - 2 * t2)**3) / 12;
                    const Iy_h = (2 * t2 * B**3 + (H - 2 * t2) * t1**3) / 12;
                    
                    const Zx_corrected = Ix_h / (H / 2);
                    const Zy_corrected = Iy_h / (B / 2);
                    
                    console.log('🔧 H形鋼200×200×8×12の正しい断面係数:', {
                        A_h: A_h.toFixed(2) + ' cm²',
                        Ix_h: Ix_h.toFixed(2) + ' cm⁴',
                        Iy_h: Iy_h.toFixed(2) + ' cm⁴',
                        Zx_corrected: Zx_corrected.toFixed(2) + ' cm³',
                        Zy_corrected: Zy_corrected.toFixed(2) + ' cm³'
                    });
                    
                    Zx = Zx_corrected;
                    Zy = Zy_corrected;
                }
            }
        }
        */
        
        // 部材1の場合はテーブルからの値を優先する（断面積についても）
        if (memberIndex === 0 && A_fromTable !== null) {
            // 断面積の単位変換を確認（テーブルから取得した値はcm²単位、member.Aはm²単位）
            // 他の部材と同様に、テーブルからの値（cm²）をm²に変換して使用
            A = A_fromTable * 1e-4; // cm² → m²
            console.log('🔧 部材1: テーブルからの断面積を使用（単位変換適用）', {
                A_original: A_original,
                A_fromTable: A_fromTable,
                A_final: A,
                unit_conversion_applied: true,
                conversion_factor: '1e-4 (cm² → m²)',
                note: 'テーブルからの値（cm²）をm²に変換して使用'
            });
        } else if (memberIndex === 0) {
            console.log('🔧 部材1: テーブルから断面積が取得できませんでした', {
                A_original: A_original,
                A_fromTable: A_fromTable,
                A_final: A
            });
        }
        
        // 部材1のテーブルからの値が正しく取得できているかチェック
        if (memberIndex === 0) {
            console.log('🔧 部材1のテーブル値チェック:', {
                A_fromTable,
                Zx_fromTable,
                Zy_fromTable,
                A_original: A_original,
                A_final: A,
                Zx_final: Zx,
                Zy_final: Zy,
                isTableValueUsed: Zx_fromTable !== null,
                tableValueMatchesFinal: Zx_fromTable !== null && Math.abs(Zx - Zx_fromTable) < 0.001
            });
        }
        
        // 部材1の詳細デバッグ情報
        if (memberIndex === 0) {
            console.log('🔧 部材1の断面係数詳細デバッグ:', {
                Zx_raw,
                Zx_parsed: parseFloat(Zx_raw),
                Z_fallback: Z,
                Zx_final: Zx,
                Zx_fromTable,
                Zx_fromSectionInfo,
                Zx_fromSectionSummary,
                Zy_fromTable,
                Zy_fromSectionInfo,
                Zy_fromSectionSummary,
                Zy_final: Zy,
                member_properties_sectionModulus: member.properties?.sectionModulus,
                member_sectionInfo: member.sectionInfo,
                member_sectionSummary: member.sectionSummary,
                table_access_success: Zx_fromTable !== null,
                source_used: Zx_fromTable !== null ? 'table' : 
                           (member.properties?.sectionModulus?.zxNumeric ? 'properties.zxNumeric' : 
                            member.properties?.sectionModulus?.zx ? 'properties.zx' :
                            member.properties?.sectionModulus?.numeric ? 'properties.numeric' :
                            Zx_fromSectionInfo ? 'sectionInfo' :
                            Zx_fromSectionSummary ? 'sectionSummary' : 'fallback_Z'),
                // 追加デバッグ情報
                member_properties_full: member.properties,
                member_keys: Object.keys(member),
                sectionModulus_keys: member.properties?.sectionModulus ? Object.keys(member.properties.sectionModulus) : null
            });
        }
        
        // 部材2の詳細デバッグ情報
        if (memberIndex === 1) {
            console.log('🔧 部材2の断面係数詳細デバッグ:', {
                Zx_raw,
                Zx_parsed: parseFloat(Zx_raw),
                Z_fallback: Z,
                Zx_final: Zx,
                Zx_fromTable,
                Zx_fromSectionInfo,
                Zx_fromSectionSummary,
                Zy_fromTable,
                Zy_fromSectionInfo,
                Zy_fromSectionSummary,
                Zy_final: Zy,
                member_properties_sectionModulus: member.properties?.sectionModulus,
                member_sectionInfo: member.sectionInfo,
                member_sectionSummary: member.sectionSummary,
                table_access_success: Zx_fromTable !== null,
                source_used: Zx_fromTable !== null ? 'table' : 
                           (member.properties?.sectionModulus?.zxNumeric ? 'properties.zxNumeric' : 
                            member.properties?.sectionModulus?.zx ? 'properties.zx' :
                            member.properties?.sectionModulus?.numeric ? 'properties.numeric' :
                            Zx_fromSectionInfo ? 'sectionInfo' :
                            Zx_fromSectionSummary ? 'sectionSummary' : 'fallback_Z')
            });
        }
        
        // 単位変換の確認（断面係数は通常cm³単位で入力される）
        const Zx_mm3 = Zx * 1e6; // cm³ -> mm³
        const Zy_mm3 = Zy * 1e6; // cm³ -> mm³
        
        console.log('🔧 断面係数計算結果詳細:', { 
            memberIndex: memberIndex + 1,
            Zx_raw, Zy_raw,
            Zx, Zy, 
            Zx_mm3, Zy_mm3,
            Zx_unit: 'cm³',
            Zy_unit: 'cm³',
            Zx_source: Zx_fromTable ? 'table' : 
                      (member.properties?.sectionModulus?.zxNumeric ? 'properties.zxNumeric' : 
                       member.properties?.sectionModulus?.zx ? 'properties.zx' :
                       member.properties?.sectionModulus?.numeric ? 'properties.numeric' :
                       Zx_fromSectionInfo ? 'sectionInfo' :
                       Zx_fromSectionSummary ? 'sectionSummary' : 'default_Z'),
            Zy_source: Zy_fromTable ? 'table' : 
                      (member.properties?.sectionModulus?.zyNumeric ? 'properties.zyNumeric' : 
                       member.properties?.sectionModulus?.zy ? 'properties.zy' :
                       Zy_fromSectionInfo ? 'sectionInfo' :
                       Zy_fromSectionSummary ? 'sectionSummary' : 'calculated'),
            Zy_calculation_method: Zy_raw !== null && Zy_raw !== undefined && !isNaN(parseFloat(Zy_raw)) ? 
                                  'from_raw_data' : 
                                  (member.properties?.momentOfInertia?.iy && member.properties?.area ? 
                                   'calculated_from_Iy_A' : 'fallback_to_Zx_ratio'),
            raw_values: {
                Zx_fromTable, Zy_fromTable,
                Zx_fromSectionInfo, Zy_fromSectionInfo,
                Zx_fromSectionSummary, Zy_fromSectionSummary,
                member_zx: member.properties?.sectionModulus?.zx,
                member_zy: member.properties?.sectionModulus?.zy,
                member_zxNumeric: member.properties?.sectionModulus?.zxNumeric,
                member_zyNumeric: member.properties?.sectionModulus?.zyNumeric
            },
            member_properties: {
                sectionModulus: member.properties?.sectionModulus,
                momentOfInertia: member.properties?.momentOfInertia,
                area: member.properties?.area
            }
        });
        
        // 部材データから直接材料名を取得（弾性係数選択で取得した材料名を使用）
        const materialName = member.material || `任意材料(E=${(E/1000).toLocaleString()}GPa)`;
        
        const selectedTerm = document.querySelector('input[name="load-term"]:checked').value;
        const termIndex = (selectedTerm === 'long') ? 0 : 1;
        
        switch(strengthProps.type) {
            case 'F-value':
            case 'F-stainless':
            case 'F-aluminum':
                const F = strengthProps.value;
                const factor = (selectedTerm === 'long') ? 1.5 : 1.0;
                materialInfo = `材料: ${materialName} (F=${F} N/mm²)`;
                allowableStresses.ft = F / factor;
                allowableStresses.fb = F / factor;
                allowableStresses.fs = F / (factor * Math.sqrt(3));
                
                // 座屈を考慮した圧縮許容応力度
                const lk = L, i_min = Math.min(ix, iy);
                allowableStresses.fc = allowableStresses.ft;
                if (i_min > 1e-9) {
                    const lambda = lk / i_min, E_n_mm2 = E * 1e-3;
                    const lambda_p = Math.PI * Math.sqrt(E_n_mm2 / (0.6 * F));
                    if (lambda <= lambda_p) {
                        allowableStresses.fc = (1 - 0.4 * (lambda / lambda_p)**2) * F / factor;
                    } else {
                        allowableStresses.fc = (0.277 * F) / ((lambda / lambda_p)**2);
                    }
                }
                break;
            case 'wood-type':
                const woodPreset = strengthProps.preset;
                if (woodPreset === 'custom') {
                    materialInfo = `材料: ${materialName} (任意入力)`;
                    const customShortStresses = strengthProps.stresses;
                    if (selectedTerm === 'long') {
                        allowableStresses.ft = customShortStresses.ft * 1.1 / 2;
                        allowableStresses.fc = customShortStresses.fc * 1.1 / 2;
                        allowableStresses.fb = customShortStresses.fb * 1.1 / 2;
                        allowableStresses.fs = customShortStresses.fs * 1.1 / 2;
                    } else {
                        allowableStresses.ft = customShortStresses.ft;
                        allowableStresses.fc = customShortStresses.fc;
                        allowableStresses.fb = customShortStresses.fb;
                        allowableStresses.fs = customShortStresses.fs;
                    }
                } else {
                    const baseStresses = WOOD_BASE_STRENGTH_DATA[woodPreset];
                    materialInfo = `材料: ${materialName} (${baseStresses.name})`;
                    const factor = (selectedTerm === 'long') ? (1.1 / 3) : (2 / 3);
                    allowableStresses.ft = baseStresses.ft * factor;
                    allowableStresses.fc = baseStresses.fc * factor;
                    allowableStresses.fb = baseStresses.fb * factor;
                    allowableStresses.fs = baseStresses.fs * factor;
                    materialInfo += `<br>基準強度: Fc=${baseStresses.fc}, Ft=${baseStresses.ft}, Fb=${baseStresses.fb}, Fs=${baseStresses.fs} (N/mm²)`;
                }
                break;
            default:
                materialInfo = `材料: ${materialName}`;
        }

        // 表示用の最終値をログ出力
        console.log('🔧 最終表示値:', {
            memberIndex: memberIndex + 1,
            Zx_final: Zx,
            Zy_final: Zy,
            Zx_unit: 'cm³',
            Zy_unit: 'cm³'
        });

        let detailHtml = `
            <div style="font-family: Arial, sans-serif;">
                <h3>部材 ${memberIndex + 1} の詳細応力度計算結果</h3>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #f5f5f5; border-radius: 5px;">
                    <h4>部材情報</h4>
                    <p><strong>${materialInfo}</strong></p>
                    <p>弾性係数 E: ${(E/1000).toLocaleString()} N/mm²</p>
                    <p>部材長: ${L.toFixed(2)} m</p>
                    <p>断面積 A: ${(A * 1e4).toFixed(2)} cm²</p>
                    <p>断面係数 Zx: ${Zx.toFixed(4)} cm³</p>
                    <p>断面係数 Zy: ${Zy.toFixed(4)} cm³</p>
                    <p>回転半径 ix: ${(ix * 1e2).toFixed(2)} cm, iy: ${(iy * 1e2).toFixed(2)} cm</p>
                    ${w !== 0 ? `<p>等分布荷重: ${w} kN/m</p>` : ''}
                </div>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #e8f4fd; border-radius: 5px;">
                    <h4>許容応力度 (${selectedTerm === 'long' ? '長期' : '短期'})</h4>
                    <p>引張許容応力度 ft: ${allowableStresses.ft.toFixed(2)} N/mm²</p>
                    <p>圧縮許容応力度 fc: ${allowableStresses.fc.toFixed(2)} N/mm²</p>
                    <p>曲げ許容応力度 fb: ${allowableStresses.fb.toFixed(2)} N/mm²</p>
                    <p>せん断許容応力度 fs: ${allowableStresses.fs.toFixed(2)} N/mm²</p>
                </div>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #fff2e8; border-radius: 5px;">
                    <h4>部材端力</h4>
                    <p><strong>第1軸（X軸周り）:</strong></p>
                    <p>i端: N = ${(-force.N_i).toFixed(2)} kN, Q = ${force.Q_i.toFixed(2)} kN, M = ${force.M_i.toFixed(2)} kN·m</p>
                    <p>j端: N = ${force.N_j.toFixed(2)} kN, Q = ${(-force.Q_j).toFixed(2)} kN, M = ${force.M_j.toFixed(2)} kN·m</p>
                    ${is3D ? `
                    <p><strong>第2軸（Y軸周り）:</strong></p>
                    <p>i端: My = ${force.My_i.toFixed(2)} kN·m, Mz = ${force.Mz_i.toFixed(2)} kN·m</p>
                    <p>j端: My = ${force.My_j.toFixed(2)} kN·m, Mz = ${force.Mz_j.toFixed(2)} kN·m</p>
                    ` : ''}
                </div>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr style="background-color: #f0f0f0;">
                            <th style="border: 1px solid #ccc; padding: 8px;">位置 (m)</th>
                            <th style="border: 1px solid #ccc; padding: 8px;">軸力 N (kN)</th>
                            <th style="border: 1px solid #ccc; padding: 8px;">曲げ M1 (kN·m)</th>
                            ${is3D ? '<th style="border: 1px solid #ccc; padding: 8px;">曲げ M2 (kN·m)</th>' : ''}
                            <th style="border: 1px solid #ccc; padding: 8px;">せん断 Q1 (kN)</th>
                            ${is3D ? '<th style="border: 1px solid #ccc; padding: 8px;">せん断 Q2 (kN)</th>' : ''}
                            <th style="border: 1px solid #ccc; padding: 8px;">軸応力度 σ_a (N/mm²)</th>
                            <th style="border: 1px solid #ccc; padding: 8px;">曲げ応力度 σ_b1 (N/mm²)</th>
                            ${is3D ? '<th style="border: 1px solid #ccc; padding: 8px;">曲げ応力度 σ_b2 (N/mm²)</th>' : ''}
                            <th style="border: 1px solid #ccc; padding: 8px;">せん断応力度 τ1 (N/mm²)</th>
                            ${is3D ? '<th style="border: 1px solid #ccc; padding: 8px;">せん断応力度 τ2 (N/mm²)</th>' : ''}
                            <th style="border: 1px solid #ccc; padding: 8px;">曲げ検定比1</th>
                            ${is3D ? '<th style="border: 1px solid #ccc; padding: 8px;">曲げ検定比2</th>' : ''}
                            <th style="border: 1px solid #ccc; padding: 8px;">せん断検定比1</th>
                            ${is3D ? '<th style="border: 1px solid #ccc; padding: 8px;">せん断検定比2</th>' : ''}
                            <th style="border: 1px solid #ccc; padding: 8px;">最大検定比</th>
                            <th style="border: 1px solid #ccc; padding: 8px;">判定</th>
                        </tr>
                    </thead>
                    <tbody>`;

        for (let k = 0; k < numPoints; k++) {
            const xi = k / (numPoints - 1); // 無次元座標
            const x = xi * L; // 実際の距離
            const ratio1 = res.ratios[k];
            const ratio2 = res.ratiosY ? res.ratiosY[k] : 0;
            const ratio3 = res.ratiosZ ? res.ratiosZ[k] : 0;
            const shearRatio1 = res.shearRatiosY ? res.shearRatiosY[k] : 0;
            const shearRatio2 = res.shearRatiosZ ? res.shearRatiosZ[k] : 0;
            
            // 曲げモーメント図と同じ計算方法を使用
            // 第1軸（Y軸周り）の曲げモーメント
            let M1_x = 0;
            if (typeof calculateMemberMomentForAxis === 'function') {
                M1_x = calculateMemberMomentForAxis(force, L, xi, 'y', w);
            } else {
                // フォールバック: 線形補間 + 等分布荷重
                const M_linear = -force.My_i * (1 - xi) + force.My_j * xi;
                const M_parabolic = w * L * x / 2 - w * x**2 / 2;
                M1_x = M_linear + M_parabolic;
            }
            
            // 第2軸（Z軸周り）の曲げモーメント
            let M2_x = 0;
            if (typeof calculateMemberMomentForAxis === 'function') {
                M2_x = calculateMemberMomentForAxis(force, L, xi, 'z', w);
            } else {
                // フォールバック: 線形補間 + 等分布荷重
                const M_linear = -force.Mz_i * (1 - xi) + force.Mz_j * xi;
                const M_parabolic = w * L * x / 2 - w * x**2 / 2;
                M2_x = M_linear + M_parabolic;
            }
            
            // せん断力計算（第2軸せん断力図と同じ軸選択方法を使用）
            let Q1_x = 0, Q2_x = 0; // 第1軸、第2軸のせん断力
            
            // 投影モードに応じて軸を決定（第2軸せん断力図と同じロジック）
            const getCurrentProjectionMode = () => {
                const projectionSelect = document.getElementById('projection-mode');
                return projectionSelect ? projectionSelect.value : 'iso';
            };
            
            const projectionMode = getCurrentProjectionMode();
            let currentAxis, secondaryAxis;
            
            if (projectionMode === 'xy') {
                currentAxis = 'z'; // 現在表示: Z軸周り
                secondaryAxis = 'y'; // 第2軸: Y軸周り
            } else if (projectionMode === 'xz') {
                currentAxis = 'y'; // 現在表示: Y軸周り
                secondaryAxis = 'z'; // 第2軸: Z軸周り
            } else if (projectionMode === 'yz') {
                currentAxis = 'x'; // 現在表示: X軸周り
                secondaryAxis = 'z'; // 第2軸: Z軸周り
            } else {
                // 等角投影の場合は第2軸としてZ軸を表示
                currentAxis = 'y'; // 現在表示: Y軸周り
                secondaryAxis = 'z'; // 第2軸: Z軸周り
            }
            
            if (typeof calculateMemberShearForAxis === 'function') {
                // 第2軸せん断力図と同じようにnullを渡す（等分布荷重は内部で計算される）
                Q1_x = calculateMemberShearForAxis(force, L, xi, currentAxis, null);
                Q2_x = calculateMemberShearForAxis(force, L, xi, secondaryAxis, null);
            } else {
                // フォールバック: 線形補間（等分布荷重は考慮しない）
                const Q1_linear = force[`Q${currentAxis}_i`] * (1 - xi) + force[`Q${currentAxis}_j`] * xi;
                Q1_x = Q1_linear;
                
                const Q2_linear = force[`Q${secondaryAxis}_i`] * (1 - xi) + force[`Q${secondaryAxis}_j`] * xi;
                Q2_x = Q2_linear;
            }
            
            const N = -force.N_i; // 軸力は部材全体で一定
            const sigma_a = (N * 1000) / (A * 1e6);
            const sigma_b1 = (Math.abs(M1_x) * 1e6) / Zx_mm3; // 第1軸（Y軸周り）の曲げ応力度
            const sigma_b2 = is3D ? (Math.abs(M2_x) * 1e6) / Zy_mm3 : 0; // 第2軸（Z軸周り）の曲げ応力度
            
            // せん断応力度計算
            const tau1 = (Math.abs(Q1_x) * 1000) / (A * 1e6); // 第1軸せん断応力度
            const tau2 = is3D ? (Math.abs(Q2_x) * 1000) / (A * 1e6) : 0; // 第2軸せん断応力度
            
            const maxRatio = Math.max(ratio1, ratio2, ratio3, shearRatio1, shearRatio2);
            const status = maxRatio > 1.0 ? '❌ NG' : '✅ OK';
            const rowStyle = maxRatio > 1.0 ? 'background-color: #fdd;' : '';
            
            detailHtml += `
                <tr style="${rowStyle}">
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${x.toFixed(2)}</td>
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${N.toFixed(2)}</td>
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${M1_x.toFixed(2)}</td>
                    ${is3D ? `<td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${M2_x.toFixed(2)}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${Q1_x.toFixed(2)}</td>
                    ${is3D ? `<td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${Q2_x.toFixed(2)}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${sigma_a.toFixed(2)}</td>
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${sigma_b1.toFixed(2)}</td>
                    ${is3D ? `<td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${sigma_b2.toFixed(2)}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${tau1.toFixed(2)}</td>
                    ${is3D ? `<td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${tau2.toFixed(2)}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center; font-weight: bold;">${ratio1.toFixed(3)}</td>
                    ${is3D ? `<td style="border: 1px solid #ccc; padding: 8px; text-align: center; font-weight: bold;">${ratio2.toFixed(3)}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center; font-weight: bold;">${shearRatio1.toFixed(3)}</td>
                    ${is3D ? `<td style="border: 1px solid #ccc; padding: 8px; text-align: center; font-weight: bold;">${shearRatio2.toFixed(3)}</td>` : ''}
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center; font-weight: bold; color: ${maxRatio > 1.0 ? 'red' : 'green'};">${maxRatio.toFixed(3)}</td>
                    <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${status}</td>
                </tr>`;
        }

        detailHtml += `
                    </tbody>
                </table>
                <div style="margin-top: 20px; padding: 10px; background-color: #f9f9f9; border-radius: 5px;">
                    <h4>検定式</h4>
                    <p><strong>第1軸（曲げ）:</strong></p>
                    <p>軸力が引張の場合: D/C₁ = σ_a/ft + σ_b1/fb</p>
                    <p>軸力が圧縮の場合: D/C₁ = σ_a/fc + σ_b1/fb</p>
                    <p><strong>第1軸（せん断）:</strong></p>
                    <p>せん断力検定: D/C_Q1 = τ₁/fs</p>
                    ${is3D ? `
                    <p><strong>第2軸（曲げ）:</strong></p>
                    <p>軸力が引張の場合: D/C₂ = σ_a/ft + σ_b2/fb</p>
                    <p>軸力が圧縮の場合: D/C₂ = σ_a/fc + σ_b2/fb</p>
                    <p><strong>第2軸（せん断）:</strong></p>
                    <p>せん断力検定: D/C_Q2 = τ₂/fs</p>
                    <p><strong>最大検定比:</strong> D/C_max = max(D/C₁, D/C₂, D/C_Q1, D/C_Q2)</p>
                    ` : `
                    <p><strong>最大検定比:</strong> D/C_max = max(D/C₁, D/C_Q1)</p>
                    `}
                    <p>※ σ_a = N/A, σ_b1 = |M₁|/Zx, σ_b2 = |M₂|/Zy, τ₁ = |Q₁|/A, τ₂ = |Q₂|/A</p>
                </div>
            </div>`;

        // ポップアップで表示
        const popup = document.createElement('div');
        popup.style.position = 'fixed';
        popup.style.top = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.background = 'white';
        popup.style.border = '2px solid #ccc';
        popup.style.borderRadius = '10px';
        popup.style.zIndex = '1000';
        popup.style.width = '800px';
        popup.style.height = '600px';
        popup.style.minWidth = '400px';
        popup.style.minHeight = '300px';
        popup.style.maxWidth = '90vw';
        popup.style.maxHeight = '90vh';
        popup.style.overflow = 'hidden';
        popup.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
        popup.style.display = 'flex';
        popup.style.flexDirection = 'column';
        popup.style.resize = 'none'; // ブラウザのデフォルトリサイズを無効化
        
        // ドラッグ可能なヘッダーを作成
        const header = document.createElement('div');
        header.style.background = '#f0f0f0';
        header.style.padding = '10px 15px';
        header.style.borderBottom = '1px solid #ccc';
        header.style.borderRadius = '8px 8px 0 0';
        header.style.cursor = 'move';
        header.style.userSelect = 'none';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.fontWeight = 'bold';
        header.style.fontSize = '16px';
        header.textContent = `部材 ${memberIndex + 1} の詳細応力度計算結果`;
        
        // 閉じるボタンをヘッダーに追加
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.background = '#ff4444';
        closeButton.style.color = 'white';
        closeButton.style.border = 'none';
        closeButton.style.borderRadius = '50%';
        closeButton.style.width = '25px';
        closeButton.style.height = '25px';
        closeButton.style.cursor = 'pointer';
        closeButton.style.fontSize = '16px';
        closeButton.style.fontWeight = 'bold';
        closeButton.style.display = 'flex';
        closeButton.style.alignItems = 'center';
        closeButton.style.justifyContent = 'center';
        closeButton.onclick = () => popup.remove();
        
        header.appendChild(closeButton);
        
        // コンテンツエリアを作成
        const content = document.createElement('div');
        content.style.padding = '20px';
        content.style.flex = '1';
        content.style.overflowY = 'auto';
        content.style.overflowX = 'hidden';
        content.innerHTML = detailHtml;
        
        // リサイズハンドルを作成
        const resizeHandle = document.createElement('div');
        resizeHandle.style.position = 'absolute';
        resizeHandle.style.bottom = '0';
        resizeHandle.style.right = '0';
        resizeHandle.style.width = '20px';
        resizeHandle.style.height = '20px';
        resizeHandle.style.background = 'linear-gradient(-45deg, transparent 0%, transparent 30%, #ccc 30%, #ccc 40%, transparent 40%, transparent 70%, #ccc 70%)';
        resizeHandle.style.cursor = 'nw-resize';
        resizeHandle.style.borderRadius = '0 0 10px 0';
        
        // ドラッグ機能を実装
        let isDragging = false;
        let isResizing = false;
        let dragOffset = { x: 0, y: 0 };
        let startSize = { width: 0, height: 0 };
        let startPos = { x: 0, y: 0 };
        
        // ヘッダードラッグ機能
        header.addEventListener('mousedown', (e) => {
            if (e.target === closeButton) return; // 閉じるボタンは除外
            isDragging = true;
            const rect = popup.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;
            popup.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none'; // テキスト選択を防ぐ
            e.preventDefault();
        });
        
        // リサイズハンドルのドラッグ機能
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            const rect = popup.getBoundingClientRect();
            startSize.width = rect.width;
            startSize.height = rect.height;
            startPos.x = e.clientX;
            startPos.y = e.clientY;
            popup.style.cursor = 'nw-resize';
            document.body.style.userSelect = 'none'; // テキスト選択を防ぐ
            e.preventDefault();
            e.stopPropagation();
        });
        
        // マウス移動イベント
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const newX = e.clientX - dragOffset.x;
                const newY = e.clientY - dragOffset.y;
                
                // 画面境界内に制限（少し余裕を持たせる）
                const margin = 50;
                const maxX = window.innerWidth - popup.offsetWidth + margin;
                const maxY = window.innerHeight - popup.offsetHeight + margin;
                
                const constrainedX = Math.max(-margin, Math.min(newX, maxX));
                const constrainedY = Math.max(-margin, Math.min(newY, maxY));
                
                popup.style.left = constrainedX + 'px';
                popup.style.top = constrainedY + 'px';
                popup.style.transform = 'none';
            } else if (isResizing) {
                const deltaX = e.clientX - startPos.x;
                const deltaY = e.clientY - startPos.y;
                
                const newWidth = startSize.width + deltaX;
                const newHeight = startSize.height + deltaY;
                
                // 最小・最大サイズ制限
                const minWidth = 400;
                const minHeight = 300;
                const maxWidth = window.innerWidth - popup.offsetLeft;
                const maxHeight = window.innerHeight - popup.offsetTop;
                
                const constrainedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
                const constrainedHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
                
                popup.style.width = constrainedWidth + 'px';
                popup.style.height = constrainedHeight + 'px';
            }
        });
        
        // マウスアップイベント
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                popup.style.cursor = 'default';
                document.body.style.userSelect = ''; // テキスト選択を復元
            }
            if (isResizing) {
                isResizing = false;
                popup.style.cursor = 'default';
                document.body.style.userSelect = ''; // テキスト選択を復元
            }
        });
        
        // ポップアップに要素を追加
        popup.appendChild(header);
        popup.appendChild(content);
        popup.appendChild(resizeHandle);
        document.body.appendChild(popup);
        
        // ポップアップを最前面に表示するためのクリックイベント
        popup.addEventListener('mousedown', (e) => {
            // 他のポップアップがあればz-indexを下げる
            const allPopups = document.querySelectorAll('[data-popup-type="detail"]');
            allPopups.forEach(p => {
                if (p !== popup) {
                    p.style.zIndex = '999';
                }
            });
            popup.style.zIndex = '1000';
        });
        
        // ポップアップ識別用の属性を追加
        popup.setAttribute('data-popup-type', 'detail');
    };

    // グローバルスコープに関数を公開
    window.showSectionCheckDetail = showSectionCheckDetail;

    // 座屈解析結果表示関数
    let lastBucklingResults = null;
    
    const displayBucklingResults = () => {
        if (!lastBucklingResults) { 
            document.getElementById('buckling-analysis-results').innerHTML = ''; 
            return; 
        }
        
        console.log("座屈解析の計算結果:", lastBucklingResults);
        let html = `<thead><tr>
            <th>部材 #</th>
            <th>軸力 (kN)</th>
            <th>座屈荷重 (kN)</th>
            <th>安全率</th>
            <th>座屈長 (m)</th>
            <th>細長比</th>
            <th>座屈モード</th>
            <th>接合条件</th>
            <th>判定</th>
            <th>詳細</th>
        </tr></thead><tbody>`;
        
        lastBucklingResults.forEach((result, i) => {
            const isDangerous = result.status === '座屈危険';
            const isWarning = result.status === '要注意';
            let statusColor = '';
            let statusIcon = '';
            
            if (isDangerous) {
                statusColor = 'color: red; font-weight: bold;';
                statusIcon = '❌';
            } else if (isWarning) {
                statusColor = 'color: orange; font-weight: bold;';
                statusIcon = '⚠️';
            } else if (result.status === '安全') {
                statusColor = 'color: green;';
                statusIcon = '✅';
            } else {
                statusColor = 'color: blue;';
                statusIcon = 'ℹ️';
            }
            
            const rowStyle = isDangerous ? 'style="background-color: #fdd;"' : 
                           isWarning ? 'style="background-color: #fff3cd;"' : '';
            
            html += `<tr ${rowStyle}>
                <td>${i + 1}</td>
                <td>${typeof result.axialForce === 'number' ? result.axialForce.toFixed(2) : result.axialForce}${typeof result.axialForce === 'number' && result.axialForce < 0 ? '(圧縮)' : typeof result.axialForce === 'number' && result.axialForce > 0 ? '(引張)' : ''}</td>
                <td>${typeof result.criticalLoad === 'number' ? result.criticalLoad.toFixed(0) : result.criticalLoad}</td>
                <td>${typeof result.safetyFactor === 'number' ? result.safetyFactor.toFixed(2) : result.safetyFactor}</td>
                <td>${typeof result.bucklingLength === 'number' ? result.bucklingLength.toFixed(2) : result.bucklingLength}</td>
                <td>${typeof result.slendernessRatio === 'number' ? result.slendernessRatio.toFixed(1) : result.slendernessRatio}</td>
                <td>${result.bucklingMode}</td>
                <td>${result.connectionType}</td>
                <td style="${statusColor}">${statusIcon} ${result.status}</td>
                <td><button onclick="showBucklingDetail(${i})">詳細</button></td>
            </tr>`;
        });
        html += `</tbody>`;
        document.getElementById('buckling-analysis-results').innerHTML = html;
    };

    const showBucklingDetail = (memberIndex) => {
        const result = lastBucklingResults[memberIndex];
        if (!result) return;

        const { members } = lastResults;
        const member = members[memberIndex];
        
        let detailHtml = `
            <div style="font-family: Arial, sans-serif;">
                <h3>部材 ${memberIndex + 1} の座屈解析詳細</h3>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #f5f5f5; border-radius: 5px;">
                    <h4>部材情報</h4>
                    <p><strong>材料:</strong> ${member.material || '不明'}</p>
                    <p>弾性係数 E: ${(member.E/1000).toLocaleString()} N/mm²</p>
                    <p>部材長: ${member.length.toFixed(2)} m</p>
                    <p>断面積 A: ${(member.A * 1e4).toFixed(2)} cm²</p>
                    <p>回転半径 ix: ${(member.ix * 1e2).toFixed(2)} cm, iy: ${(member.iy * 1e2).toFixed(2)} cm</p>
                    <p>接合条件: ${result.connectionType}</p>
                </div>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #e8f4fd; border-radius: 5px;">
                    <h4>座屈解析結果</h4>
                    <p>座屈長: ${typeof result.bucklingLength === 'number' ? result.bucklingLength.toFixed(2) : result.bucklingLength} m</p>
                    <p>座屈長係数: ${result.bucklingLengthFactor}</p>
                    <p>細長比 λ: ${typeof result.slendernessRatio === 'number' ? result.slendernessRatio.toFixed(1) : result.slendernessRatio}</p>
                    <p>オイラー座屈荷重: ${typeof result.criticalLoad === 'number' ? result.criticalLoad.toFixed(0) : result.criticalLoad} kN</p>
                    <p>現在の軸力: ${typeof result.axialForce === 'number' ? result.axialForce.toFixed(2) : result.axialForce} kN ${typeof result.axialForce === 'number' && result.axialForce < 0 ? '(圧縮)' : result.axialForce > 0 ? '(引張)' : ''}</p>
                    <p>座屈モード: ${result.bucklingMode}</p>
                </div>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #fff2e8; border-radius: 5px;">
                    <h4>安全性評価</h4>
                    <p style="font-size: 1.1em;"><strong>安全率: ${typeof result.safetyFactor === 'number' ? result.safetyFactor.toFixed(2) : result.safetyFactor}</strong></p>
                    <p><strong>判定: ${result.status}</strong></p>
                    ${result.status === '座屈危険' ? '<p style="color: red;"><strong>⚠️ 警告: 座屈の危険があります。断面の見直しが必要です。</strong></p>' : ''}
                    ${result.status === '要注意' ? '<p style="color: orange;"><strong>⚠️ 注意: 安全率が低いため、断面の検討を推奨します。</strong></p>' : ''}
                </div>
                <div style="margin-bottom: 20px; padding: 10px; background-color: #f0f8ff; border-radius: 5px;">
                    <h4>座屈理論（参考）</h4>
                    <p>オイラー座屈荷重: P<sub>cr</sub> = π²EI/(lk)²</p>
                    <p>ここで、E: 弾性係数、I: 最小断面二次モーメント、lk: 座屈長</p>
                    <p><strong>軸力の符号規則:</strong> マイナス値が圧縮力、プラス値が引張力</p>
                    <p>座屈長は接合条件により決まります：</p>
                    <ul>
                        <li>両端ピン: lk = L (係数 1.0)</li>
                        <li>一端固定・一端ピン: lk = 0.7L (係数 0.7)</li>
                        <li>両端固定: lk = 0.5L (係数 0.5)</li>
                    </ul>
                </div>
            </div>
        `;

        const popup = window.open('', '_blank', 'width=800,height=600,scrollbars=yes');
        popup.document.write(`
            <html>
                <head><title>座屈解析詳細 - 部材 ${memberIndex + 1}</title></head>
                <body style="margin: 20px;">${detailHtml}</body>
            </html>
        `);
        popup.document.close();
    };

    window.showBucklingDetail = showBucklingDetail;

    const drawRatioDiagram = () => {
        console.log('🔧 drawRatioDiagram 開始:', {
            hasLastResults: !!lastResults,
            hasLastSectionCheckResults: !!lastSectionCheckResults,
            hasRatioCanvas: !!elements.ratioCanvas,
            nodesCount: lastResults?.nodes?.length,
            membersCount: lastResults?.members?.length,
            sectionCheckResultsCount: lastSectionCheckResults?.length
        });
        
        if (!lastResults || !lastSectionCheckResults) {
            console.warn('❌ 検定比図描画に必要なデータが不足:', { lastResults: !!lastResults, lastSectionCheckResults: !!lastSectionCheckResults });
            return;
        }
        
        const { nodes, members } = lastResults;
        
        // キャンバスサイズを適切に設定
        if (elements.ratioCanvas) {
            const container = elements.ratioCanvas.parentElement;
            if (container) {
                const rect = container.getBoundingClientRect();
                const width = Math.max(800, rect.width || 800);
                const height = Math.max(600, rect.height || 600);
                elements.ratioCanvas.width = width;
                elements.ratioCanvas.height = height;
                console.log('🔧 検定比図キャンバスサイズ設定:', { width, height });
            } else {
                console.warn('❌ 検定比図キャンバスの親要素が見つかりません');
            }
        } else {
            console.warn('❌ 検定比図キャンバスが見つかりません');
        }
        
        // 両軸対応の検定比図描画関数を使用
        if (typeof drawDualAxisCapacityRatioDiagram === 'function') {
            console.log('🔧 drawDualAxisCapacityRatioDiagram を呼び出し');
            try {
                drawDualAxisCapacityRatioDiagram(elements.ratioCanvas, nodes, members, lastSectionCheckResults);
                console.log('✅ drawDualAxisCapacityRatioDiagram 完了');
            } catch (error) {
                console.error('❌ drawDualAxisCapacityRatioDiagram エラー:', error);
            }
            return; // 新しい関数を使用した場合はここで終了
        }
        
        // フォールバック: 従来の描画関数
        if (typeof drawCapacityRatioDiagram === 'function') {
            console.log('🔧 drawCapacityRatioDiagram を呼び出し');
            try {
                drawCapacityRatioDiagram(elements.ratioCanvas, nodes, members, lastSectionCheckResults);
                console.log('✅ drawCapacityRatioDiagram 完了');
            } catch (error) {
                console.error('❌ drawCapacityRatioDiagram エラー:', error);
            }
            return;
        }
        
        // フォールバック: 古い単一投影の描画関数
        const drawingCtx = getDrawingContext(elements.ratioCanvas);
        if (!drawingCtx) return;
        const { ctx, transform, scale } = drawingCtx;
        drawStructure(ctx, transform, nodes, members, '#ccc', false);
        const labelManager = LabelManager();
        const nodeObstacles = nodes.map(n => { const pos = transform(n.x, n.y); return {x1: pos.x - 12, y1: pos.y - 12, x2: pos.x + 12, y2: pos.y + 12}; });
        const maxOffsetPixels = 60, ratioScale = maxOffsetPixels / (scale * 2.0);
        members.forEach((m, idx) => {
            const res = lastSectionCheckResults[idx];
            if(res.status === 'error') return;
            const n_i = nodes[m.i], n_j = nodes[m.j];
            if (res.maxRatio > 1.0) {
                 ctx.beginPath();
                 const start = transform(n_i.x, n_i.y), end = transform(n_j.x, n_j.y);
                 ctx.moveTo(start.x, start.y);
                 for (let k = 0; k <= 20; k++) {
                    const ratio = res.ratios[k], offset = -ratio * ratioScale, x_local = (k/20) * m.length;
                    const globalX = n_i.x + x_local * m.c - offset * m.s, globalY = n_i.y + x_local * m.s + offset * m.c;
                    ctx.lineTo(transform(globalX, globalY).x, transform(globalX, globalY).y);
                 }
                 ctx.lineTo(end.x, end.y);
                 ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'; ctx.strokeStyle = 'red'; ctx.lineWidth = 1; ctx.closePath(); ctx.fill(); ctx.stroke();
            }
            ctx.beginPath();
            const start = transform(n_i.x, n_i.y);
            ctx.moveTo(start.x, start.y);
            for (let k = 0; k <= 20; k++) {
                const ratio = Math.min(res.ratios[k], 1.0), offset = -ratio * ratioScale, x_local = (k/20) * m.length;
                const globalX = n_i.x + x_local * m.c - offset * m.s, globalY = n_i.y + x_local * m.s + offset * m.c;
                ctx.lineTo(transform(globalX, globalY).x, transform(globalX, globalY).y);
            }
            const end = transform(n_j.x, n_j.y);
            ctx.lineTo(end.x, end.y);
            ctx.fillStyle = 'rgba(0,0,255,0.2)'; ctx.strokeStyle = 'blue'; ctx.lineWidth = 1; ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.beginPath();
            const offset_1 = -1.0 * ratioScale;
            const p1_offset_x = -offset_1 * m.s, p1_offset_y = offset_1 * m.c;
            const p1 = transform(n_i.x+p1_offset_x, n_i.y+p1_offset_y), p2 = transform(n_j.x+p1_offset_x, n_j.y+p1_offset_y);
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = res.maxRatio > 1.0 ? 'red' : '#333';
            const mid_offset = -res.maxRatio * ratioScale * 0.5;
            const mid_offset_x = -mid_offset*m.s, mid_offset_y = mid_offset*m.c;
            const mid_pos = transform((n_i.x+n_j.x)/2+mid_offset_x, (n_i.y+n_j.y)/2+mid_offset_y);
            labelManager.draw(ctx, res.maxRatio.toFixed(2), mid_pos.x, mid_pos.y, nodeObstacles);
        });

        // 部材番号を表示（重複回避版）
        ctx.fillStyle = '#0066cc';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 検定比表示用の部材番号位置計算（部材上に制限）
        const ratioLabelPositions = [];
        members.forEach((m, idx) => {
            const n_i = nodes[m.i], n_j = nodes[m.j];
            const start_pos = transform(n_i.x, n_i.y);
            const end_pos = transform(n_j.x, n_j.y);
            
            const text = `${idx + 1}`;
            const textWidth = ctx.measureText(text).width;
            const textHeight = 14;
            const padding = 4;
            const boxWidth = textWidth + padding * 2;
            const boxHeight = textHeight + padding * 2;
            
            // 部材上の候補位置を生成
            const candidates = [];
            const numCandidates = 7;

            for (let i = 0; i < numCandidates; i++) {
                const t = i / (numCandidates - 1);
                const x = start_pos.x + (end_pos.x - start_pos.x) * t;
                const y = start_pos.y + (end_pos.y - start_pos.y) * t;

                candidates.push({ x, y, t });
            }

            // 最適な位置を選択
            let bestPosition = candidates[Math.floor(numCandidates / 2)];
            let minOverlap = Infinity;

            for (const candidate of candidates) {
                const candidateBox = {
                    x: candidate.x - boxWidth / 2,
                    y: candidate.y - boxHeight / 2,
                    width: boxWidth,
                    height: boxHeight
                };

                let overlapCount = 0;
                let totalOverlapArea = 0;

                for (const existing of ratioLabelPositions) {
                    if (boxesOverlap(candidateBox, existing)) {
                        overlapCount++;
                        totalOverlapArea += calculateOverlapArea(candidateBox, existing);
                    }
                }

                // 中心寄りを優遇
                const centerBias = Math.abs(candidate.t - 0.5) * 200;
                const overlapScore = overlapCount * 1000 + totalOverlapArea + centerBias;

                if (overlapScore < minOverlap) {
                    minOverlap = overlapScore;
                    bestPosition = candidate;
                }
            }
            
            ratioLabelPositions.push({
                x: bestPosition.x - boxWidth / 2,
                y: bestPosition.y - boxHeight / 2,
                width: boxWidth,
                height: boxHeight,
                memberIndex: idx,
                textX: bestPosition.x,
                textY: bestPosition.y,
                text: text
            });
        });
        
        // 部材番号を描画
        ratioLabelPositions.forEach(labelInfo => {
            // 部材番号の背景を描画（視認性向上のため）
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(labelInfo.x, labelInfo.y, labelInfo.width, labelInfo.height);

            // 部材番号を描画
            ctx.fillStyle = '#0066cc';
            ctx.fillText(labelInfo.text, labelInfo.textX, labelInfo.textY);
        });

        // 選択要素のハイライト表示
        console.log('drawOnCanvas内でハイライト関数を呼び出し中...');
        if (window.highlightSelectedElements) {
            window.highlightSelectedElements();
        } else {
            console.error('❌ window.highlightSelectedElements が見つかりません');
        }
    };
    const zoom = (factor, centerX, centerY) => {
        if (!panZoomState.isInitialized) return;
        const { scale, offsetX, offsetY } = panZoomState;
        const modelX = (centerX - offsetX) / scale;
        const modelY = (offsetY - centerY) / scale;
        const newScale = scale * factor;
        panZoomState.scale = newScale;
        panZoomState.offsetX = centerX - modelX * newScale;
        panZoomState.offsetY = centerY + modelY * newScale;
        drawOnCanvas();
    };

    const animateDisplacement = (nodes, members, D_global, memberLoads) => {
        console.log('🎬 アニメーション開始:', { nodes: nodes.length, members: members.length, D_global: D_global?.length });
        
        // アニメーション開始時に一度だけ描画コンテキストを取得
        const drawingCtx = getDrawingContext(elements.modelCanvas);
        if (!drawingCtx) {
            console.error('アニメーション: getDrawingContext が null を返しました');
            return;
        }
        const { ctx, transform, scale, offsetX, offsetY } = drawingCtx;

        // lastDrawingContextを更新
        lastDrawingContext = drawingCtx;
        window.lastDrawingContext = drawingCtx;

        let dispScale = parseFloat(elements.animScaleInput.value);
        const storedAutoScale = window.lastDisplacementScale;

        if (isNaN(dispScale)) {
            // 自動倍率計算: displacement図で求めた倍率があればそれを使用
            if (storedAutoScale && storedAutoScale > 0) {
                dispScale = storedAutoScale;
                console.log('アニメーション: 変位図のスケールを使用:', dispScale);
            } else {
                // lastDisplacementScaleが無い場合は変位図と同じ計算方式を使用
                // 2D/3D判定（自由度数から判定）
                const dofPerNode = D_global.length / nodes.length;
                const is3D = dofPerNode === 6;

                // 変位図と同じ最大変位計算
                let max_disp = 0;
                nodes.forEach((node, i) => {
                if (is3D) {
                        const dx = Math.abs(D_global[i * 6][0]);
                        const dy = Math.abs(D_global[i * 6 + 1][0]);
                        const dz = Math.abs(D_global[i * 6 + 2][0]);
                        const totalDisp = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        max_disp = Math.max(max_disp, totalDisp);
                } else {
                        const dx = Math.abs(D_global[i * 3][0]);
                        const dy = Math.abs(D_global[i * 3 + 1][0]);
                        const totalDisp = Math.sqrt(dx * dx + dy * dy);
                        max_disp = Math.max(max_disp, totalDisp);
                    }
                });

                // 変位図と同じ構造サイズ計算
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                let minZ = Infinity, maxZ = -Infinity;
                nodes.forEach(n => {
                    minX = Math.min(minX, n.x);
                    maxX = Math.max(maxX, n.x);
                    minY = Math.min(minY, n.y || 0);
                    maxY = Math.max(maxY, n.y || 0);
                    minZ = Math.min(minZ, n.z || 0);
                    maxZ = Math.max(maxZ, n.z || 0);
                });
                const structureSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

                // 変位図と同じスケール計算（構造サイズの5%）
                if (max_disp > 1e-12 && structureSize > 0) {
                    dispScale = (structureSize * 0.05) / max_disp;
                    // 適切な範囲に制限
                    dispScale = Math.max(1, Math.min(dispScale, 100000));
                } else if (max_disp > 1e-12) {
                    dispScale = 1000;
                } else {
                    dispScale = 100;
                }
                
                console.log('アニメーション: 独自計算スケール:', { max_disp, structureSize, dispScale });
            }
            applyAnimationAutoScale(dispScale);
        }

        console.log('アニメーション開始:', { dispScale, nodesCount: nodes.length, membersCount: members.length });

        // 投影モードを取得
        let projectionMode;
        try {
            projectionMode = getCurrentProjectionMode();
        } catch (error) {
            console.warn('投影モード取得エラー、デフォルトを使用:', error);
            projectionMode = 'isometric';
        }

        // 2D/3D判定（自由度数から判定）
        const dofPerNode = D_global.length / nodes.length;
        const is3D = dofPerNode === 6;

        const EPS = 1e-9;
        const toFiniteNumber = (value) => {
            if (typeof value === 'number') {
                return Number.isFinite(value) ? value : 0;
            }
            if (typeof value === 'string' && value.trim() !== '') {
                const parsed = parseFloat(value);
                return Number.isFinite(parsed) ? parsed : 0;
            }
            return 0;
        };
        const getHermiteCoefficients = (x, L) => {
            const xi = L > EPS ? x / L : 0;
            const xi2 = xi * xi;
            const xi3 = xi2 * xi;
            const N1 = 1 - 3 * xi2 + 2 * xi3;
            const N3 = 3 * xi2 - 2 * xi3;
            const N2 = x * (1 - xi) * (1 - xi);
            const N4 = L > EPS ? (x * x / L) * (xi - 1) : 0;
            return { N1, N2, N3, N4, xi };
        };
        const computeUniformLoadParticular = (w, x, L, E, I, connI, connJ) => {
            if (!w || !E || !I || !(L > EPS)) {
                return 0;
            }
            if (connI === 'rigid' && connJ === 'rigid') {
                return (w * x * x * Math.pow(L - x, 2)) / (24 * E * I);
            } else if (connI === 'pinned' && connJ === 'pinned') {
                return (w * x * (Math.pow(L, 3) - 2 * L * x * x + x * x * x)) / (24 * E * I);
            } else if (connI === 'rigid' && connJ === 'pinned') {
                return (w * x * x * (3 * L * L - 5 * L * x + 2 * x * x)) / (48 * E * I);
            } else if (connI === 'pinned' && connJ === 'rigid') {
                return (w * x * (Math.pow(L, 3) - 3 * L * x * x + 2 * x * x * x)) / (48 * E * I);
            }
            return 0;
        };
        const vecLength3 = (v) => Math.sqrt((v?.x ?? 0) ** 2 + (v?.y ?? 0) ** 2 + (v?.z ?? 0) ** 2);
        const vecNormalize3 = (v) => {
            const len = vecLength3(v);
            if (!(len > EPS)) {
                return { x: 0, y: 0, z: 0 };
            }
            return { x: v.x / len, y: v.y / len, z: v.z / len };
        };
        const vecCross3 = (a, b) => ({
            x: (a?.y ?? 0) * (b?.z ?? 0) - (a?.z ?? 0) * (b?.y ?? 0),
            y: (a?.z ?? 0) * (b?.x ?? 0) - (a?.x ?? 0) * (b?.z ?? 0),
            z: (a?.x ?? 0) * (b?.y ?? 0) - (a?.y ?? 0) * (b?.x ?? 0)
        });
        const computeLocalBasis = (member) => {
            const ni = nodes[member.i];
            const nj = nodes[member.j];
            if (!ni || !nj) {
                return null;
            }
            const dx = (nj.x ?? 0) - (ni.x ?? 0);
            const dy = (nj.y ?? 0) - (ni.y ?? 0);
            const dz = (nj.z ?? 0) - (ni.z ?? 0);
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!(length > EPS)) {
                return null;
            }

            let localX = { x: dx / length, y: dy / length, z: dz / length };
            let localY = null;
            let localZ = null;

            if (member.T3D && member.T3D.length >= 3) {
                localX = vecNormalize3({ x: member.T3D[0][0], y: member.T3D[0][1], z: member.T3D[0][2] });
                localY = vecNormalize3({ x: member.T3D[1][0], y: member.T3D[1][1], z: member.T3D[1][2] });
                localZ = vecNormalize3({ x: member.T3D[2][0], y: member.T3D[2][1], z: member.T3D[2][2] });
            }

            if (!localY || vecLength3(localY) <= EPS || !localZ || vecLength3(localZ) <= EPS) {
                const reference = Math.abs(localX.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
                localY = vecNormalize3(vecCross3(reference, localX));
                if (vecLength3(localY) <= EPS) {
                    localY = { x: 0, y: 1, z: 0 };
                }
                localZ = vecNormalize3(vecCross3(localX, localY));
            }

            return { localX, localY, localZ, length, origin: { x: ni.x ?? 0, y: ni.y ?? 0, z: ni.z ?? 0 } };
        };

        const memberLoadMap = new Map();
        if (Array.isArray(memberLoads)) {
            memberLoads.forEach(load => {
                if (load && typeof load.memberIndex === 'number' && !memberLoadMap.has(load.memberIndex)) {
                    memberLoadMap.set(load.memberIndex, load);
                }
            });
        }

        // 非表示軸の座標値を取得
        const hiddenAxisCoord = parseFloat(elements.hiddenAxisCoord ? elements.hiddenAxisCoord.value : 0) || 0;

        // この投影面に表示される節点をフィルタリング
        const tolerance = 0.01;
        const visibleNodeIndices = new Set();
        nodes.forEach((node, idx) => {
            let coordToCheck = 0;
            if (projectionMode === 'xy') {
                coordToCheck = node.z || 0;
            } else if (projectionMode === 'xz') {
                coordToCheck = node.y || 0;
            } else if (projectionMode === 'yz') {
                coordToCheck = node.x;
            }
            if (Math.abs(coordToCheck - hiddenAxisCoord) < tolerance) {
                visibleNodeIndices.add(idx);
            }
        });

        // この投影面に表示される部材のみをフィルタリング
        const visibleMembers = members.filter(m =>
            visibleNodeIndices.has(m.i) && visibleNodeIndices.has(m.j)
        );

        console.log('表示対象:', {
            projectionMode,
            hiddenAxisCoord,
            visibleNodes: visibleNodeIndices.size,
            visibleMembers: visibleMembers.length,
            totalMembers: members.length
        });

        const duration = 2000;
        let startTime = null;

        const animationFrame = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const elapsedTime = timestamp - startTime;
            let progress = Math.min(elapsedTime / duration, 1);
            progress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            // キャンバスをクリア（getDrawingContextを呼ばずに手動でクリア）
            const canvas = elements.modelCanvas;
            const rect = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);

            // グリッドと構造を描画
            if (elements.gridToggle.checked) {
                drawGrid(ctx, transform, canvas.clientWidth, canvas.clientHeight);
            }
            drawStructure(ctx, transform, nodes, members, '#ccc', true, true);
            drawBoundaryConditions(ctx, transform, nodes);

            // 変形した構造を赤色で描画（変位図と同じ変形計算を使用）
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;

            let drawnMembers = 0;
            visibleMembers.forEach((m) => {
                // 元の部材インデックスを取得
                const originalIdx = members.indexOf(m);
                if (originalIdx === -1) return;

                const memberForce = null; // アニメーションでは部材力は使用しない
                    
                    ctx.beginPath();
                const numDivisions = 20;
                for (let k = 0; k <= numDivisions; k++) {
                    const xi = k / numDivisions;
                    
                    // 変位図と同じ変形計算を使用
                    let deformedPoint;
                    if (typeof window.calculateMemberDeformation === 'function') {
                        // 変位図の関数が利用可能な場合
                        deformedPoint = window.calculateMemberDeformation(
                            m,
                            nodes,
                            D_global,
                            memberForce,
                            xi,
                            dispScale * progress // アニメーション進行度を考慮
                        );
                } else {
                        // フォールバック: 簡単な線形補間
                        const ni = nodes[m.i];
                        const nj = nodes[m.j];
                        
                        if (!ni || !nj) continue;
                        
                        const d_i = is3D ? {
                        dx: D_global[m.i * 6][0],
                        dy: D_global[m.i * 6 + 1][0],
                        dz: D_global[m.i * 6 + 2][0]
                        } : {
                            dx: D_global[m.i * 3][0],
                            dy: D_global[m.i * 3 + 1][0],
                            dz: 0
                    };
                        
                        const d_j = is3D ? {
                        dx: D_global[m.j * 6][0],
                        dy: D_global[m.j * 6 + 1][0],
                        dz: D_global[m.j * 6 + 2][0]
                        } : {
                            dx: D_global[m.j * 3][0],
                            dy: D_global[m.j * 3 + 1][0],
                            dz: 0
                        };

                        const original_x = ni.x + (nj.x - ni.x) * xi;
                        const original_y = (ni.y || 0) + ((nj.y || 0) - (ni.y || 0)) * xi;
                        const original_z = (ni.z || 0) + ((nj.z || 0) - (ni.z || 0)) * xi;

                        const dx = d_i.dx + (d_j.dx - d_i.dx) * xi;
                        const dy = d_i.dy + (d_j.dy - d_i.dy) * xi;
                        const dz = d_i.dz + (d_j.dz - d_i.dz) * xi;

                        deformedPoint = {
                            x: original_x + dx * dispScale * progress,
                            y: original_y + dy * dispScale * progress,
                            z: original_z + dz * dispScale * progress
                        };
                    }

                    if (deformedPoint) {
                        const projected = project3DTo2D(deformedPoint, projectionMode);
                        const p = transform(projected.x, projected.y);

                        if (k === 0) ctx.moveTo(p.x, p.y); 
                        else ctx.lineTo(p.x, p.y);
                    }
                    }
                    ctx.stroke();
                    drawnMembers++;
            });

            // 初回のみログ出力
            if (progress < 0.01) {
                console.log('アニメーションフレーム:', { progress, drawnMembers, totalMembers: members.length, is3D, dispScale });
            }

            if (progress < 1) {
                requestAnimationFrame(animationFrame);
            } else {
                console.log('アニメーション完了 - drawOnCanvas()を呼び出します');
                drawOnCanvas();
            }
        };
        requestAnimationFrame(animationFrame);
    };

    // --- Canvas Interaction ---
    const getNodeAt = (canvasX, canvasY) => { 
        console.log('getNodeAt called:', { canvasX, canvasY, hasLastDrawingContext: !!lastDrawingContext });
        if (!lastDrawingContext) return -1; 
        try { 
            const { nodes } = parseInputs(); 
            const projectionMode = getCurrentProjectionMode();
            const visibleNodeIndices = getVisibleNodeIndices(nodes);
            console.log('getNodeAt nodes:', { nodeCount: nodes.length, projectionMode, visibleCount: visibleNodeIndices.size });
            const tolerance = 10; 
            for (let i = 0; i < nodes.length; i++) { 
                if (!visibleNodeIndices.has(i)) continue;
                const projected = project3DTo2D(nodes[i], projectionMode);
                const nodePos = lastDrawingContext.transform(projected.x, projected.y); 
                const dist = Math.sqrt((canvasX - nodePos.x)**2 + (canvasY - nodePos.y)**2); 
                console.log(`getNodeAt node ${i}:`, { nodePos, dist, tolerance, hit: dist < tolerance });
                if (dist < tolerance) return i; 
            } 
        } catch(e) { 
            console.error('getNodeAt error:', e);
        } 
        return -1; 
    };
    const getMemberAt = (canvasX, canvasY) => { 
        console.log('getMemberAt called:', { canvasX, canvasY, hasLastDrawingContext: !!lastDrawingContext });
        if (!lastDrawingContext) return -1; 
        try { 
            const { nodes, members } = parseInputs(); 
            const projectionMode = getCurrentProjectionMode();
            const visibleNodeIndices = getVisibleNodeIndices(nodes);
            console.log('getMemberAt data:', { nodeCount: nodes.length, memberCount: members.length, projectionMode, visibleCount: visibleNodeIndices.size });
            const tolerance = 5; 
            for (let i = 0; i < members.length; i++) { 
                const member = members[i]; 
                if (!visibleNodeIndices.has(member.i) || !visibleNodeIndices.has(member.j)) {
                    console.log(`getMemberAt member ${i}: skipped (hidden depth)`);
                    continue;
                }
                const p1Projected = project3DTo2D(nodes[member.i], projectionMode);
                const p2Projected = project3DTo2D(nodes[member.j], projectionMode);
                const p1 = lastDrawingContext.transform(p1Projected.x, p1Projected.y);
                const p2 = lastDrawingContext.transform(p2Projected.x, p2Projected.y); 
                const dx = p2.x - p1.x, dy = p2.y - p1.y, lenSq = dx*dx + dy*dy; 
                if (lenSq === 0) continue; 
                let t = ((canvasX - p1.x) * dx + (canvasY - p1.y) * dy) / lenSq; 
                t = Math.max(0, Math.min(1, t)); 
                const closestX = p1.x + t * dx, closestY = p1.y + t * dy; 
                const dist = Math.sqrt((canvasX - closestX)**2 + (canvasY - closestY)**2); 
                console.log(`getMemberAt member ${i}:`, { p1, p2, dist, tolerance, hit: dist < tolerance });
                if (dist < tolerance) return i; 
            } 
        } catch (e) { 
            console.error('getMemberAt error:', e);
        } 
        return -1; 
    };
    const setCanvasMode = (newMode) => {
        canvasMode = newMode;
        firstMemberNode = null;
        const kebabCaseMode = newMode.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        const modeBtn = document.getElementById(`mode-${kebabCaseMode}`);
        if (modeBtn) modeBtn.classList.add('active');
        if (elements.modelCanvas) {
            elements.modelCanvas.style.cursor = { select: 'default', addNode: 'crosshair', addMember: 'copy' }[newMode];
        }

        // 3Dビューも更新
        if (typeof updateModel3DView === 'function') {
            try {
                const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
                updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
            } catch (e) {
                console.error('Error updating 3D view:', e);
            }
        }
    };

    // グローバルからアクセスできるようにする
    window.setCanvasMode = setCanvasMode;

    elements.zoomInBtn.onclick = () => {
        const rect = elements.modelCanvas.getBoundingClientRect();
        zoom(1.2, rect.width / 2, rect.height / 2);
    };
    elements.zoomOutBtn.onclick = () => {
        const rect = elements.modelCanvas.getBoundingClientRect();
        zoom(1 / 1.2, rect.width / 2, rect.height / 2);
    };
    
    // 自重考慮の表示を更新する関数
    const updateSelfWeightDisplay = () => {
        const considerSelfWeightCheckbox = document.getElementById('consider-self-weight-checkbox');
        if (!considerSelfWeightCheckbox) return;
        
        const isChecked = considerSelfWeightCheckbox.checked;
        
        // 密度列のヘッダーの表示/非表示を切り替え（HTMLに既に存在するヘッダー）
        const densityColumns = document.querySelectorAll('.density-column');
        densityColumns.forEach(column => {
            column.style.display = isChecked ? '' : 'none';
        });
        
        // 既存の部材行に密度列を追加/削除
        const memberRows = elements.membersTable.rows;
        for (let i = 0; i < memberRows.length; i++) {
            const row = memberRows[i];
            
            if (isChecked) {
                // 密度列が存在しない場合は追加（重複チェック強化）
                let densityCell = row.querySelector('.density-cell');
                const existingDensityCells = row.querySelectorAll('.density-cell');
                
                // 複数の密度セルがある場合は余分なものを削除
                if (existingDensityCells.length > 1) {
                    for (let j = 1; j < existingDensityCells.length; j++) {
                        existingDensityCells[j].remove();
                    }
                    densityCell = existingDensityCells[0];
                }
                
                if (!densityCell) {
                    // 挿入位置を決定：断面係数Zy列（位置10）の後、つまり位置11
                    let insertPosition = 11;
                    // より安全に、断面係数Zyセルを探してその次に挿入
                    for (let k = 0; k < row.cells.length; k++) {
                        const cell = row.cells[k];
                        const input = cell.querySelector('input[title*="断面係数 Zy"]');
                        if (input) {
                            insertPosition = k + 1;
                            break;
                        }
                    }

                    densityCell = row.insertCell(insertPosition);
                    densityCell.className = 'density-cell';
                    
                    // 現在のE値から密度を推定して設定
                    const eCell = row.cells[3];
                    const eSelect = eCell.querySelector('select');
                    const eValue = eSelect ? eSelect.value : '205000';
                    const density = MATERIAL_DENSITY_DATA[eValue] || MATERIAL_DENSITY_DATA['custom'];
                    
                    densityCell.innerHTML = createDensityInputHTML(`member-density-${i}`, density);
                }
            } else {
                // 密度列を削除
                const densityCell = row.querySelector('.density-cell');
                if (densityCell) {
                    densityCell.remove();
                }
            }
        }
        
        // 部材プロパティポップアップが開いている場合は位置を再調整
        if (elements.memberPropsPopup && elements.memberPropsPopup.style.display === 'block') {
            setTimeout(() => adjustPopupPosition(elements.memberPropsPopup), 0);
        }
        
        drawOnCanvas();
    };
    
    // 自重考慮チェックボックスのイベントリスナー
    elements.considerSelfWeightCheckbox.addEventListener('change', function() {
        updateSelfWeightDisplay();
    });
    
    // ウィンドウサイズ変更時のポップアップ位置調整
    window.addEventListener('resize', () => {
        if (elements.memberPropsPopup && elements.memberPropsPopup.style.display === 'block') {
            setTimeout(() => adjustPopupPosition(elements.memberPropsPopup), 100);
        }
        if (elements.addMemberPopup && elements.addMemberPopup.style.display === 'block') {
            setTimeout(() => adjustPopupPosition(elements.addMemberPopup), 100);
        }
        if (elements.nodeLoadPopup && elements.nodeLoadPopup.style.display === 'block') {
            setTimeout(() => adjustPopupPosition(elements.nodeLoadPopup), 100);
        }
    });
    
    elements.modelCanvas.addEventListener('wheel', (e) => {
        // 通常ホイールはページスクロールを優先し、Ctrl/ピンチ時のみズームする
        // (トラックパッドのピンチズームは ctrlKey が true になることがあります)
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const rect = elements.modelCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoom(zoomFactor, mouseX, mouseY);
    }, { passive: false });
    
    // 断面選択ツールを開く関数
    const openSteelSelector = (memberIndex, options = {}) => {
        const url = `steel_selector.html?targetMember=${memberIndex}`;
        const popup = window.open(url, 'SteelSelector', 'width=1200,height=800,scrollbars=yes,resizable=yes');

        if (!popup) {
            alert('ポップアップブロッカーにより断面選択ツールを開けませんでした。ポップアップを許可してください。');
            return;
        }

        // 必要に応じてオプション情報をlocalStorageに保存
        if (options && Object.keys(options).length > 0) {
            sessionStorage.setItem('steelSelectorOptions', JSON.stringify(options));
        }
    };

    elements.membersTable.addEventListener('click', (e) => {
    if (e.target && (e.target.classList.contains('select-props-btn') || e.target.classList.contains('section-select-btn'))) {
        const row = e.target.closest('tr');
        if (row) {
            const memberIndex = Array.from(row.parentNode.children).indexOf(row);

            // 材料情報を取得して渡す
            const eSelect = row.cells[3].querySelector('select');
            const selectedOption = eSelect.options[eSelect.selectedIndex];
            let materialType = 'steel'; // デフォルト
            if (selectedOption.textContent.includes('木材')) materialType = 'wood';
            else if (selectedOption.textContent.includes('コンクリート')) materialType = 'concrete';
            else if (selectedOption.textContent.includes('ステンレス')) materialType = 'stainless';
            else if (selectedOption.textContent.includes('アルミニウム')) materialType = 'aluminum';

            const strengthInputContainer = row.cells[4].firstElementChild;
            let strengthValue = '';
            if (strengthInputContainer.querySelector('input')) strengthValue = strengthInputContainer.querySelector('input').value;
            if (strengthInputContainer.querySelector('select')) strengthValue = strengthInputContainer.querySelector('select').value;

            openSteelSelector(memberIndex, {
                material: materialType,
                E: eSelect.value === 'custom' ? row.cells[3].querySelector('input[type="number"]').value : eSelect.value,
                strengthValue: strengthValue
            });
        }
    }
});

    elements.modeSelectBtn.onclick = () => setCanvasMode('select');
    elements.modeAddNodeBtn.onclick = () => setCanvasMode('addNode');
    elements.modeAddMemberBtn.onclick = () => {
        console.log('🔧 部材追加ボタンがクリックされました');

        // ポップアップ内のE入力欄を生成
        const eContainer = document.getElementById('add-popup-e-container');
        if (!eContainer) {
            console.error('❌ add-popup-e-container が見つかりません');
            return;
        }
        eContainer.innerHTML = createEInputHTML('add-popup-e', newMemberDefaults.E);

        // ポップアップ内のF入力欄を生成
        const fContainer = document.getElementById('add-popup-f-container');
        fContainer.innerHTML = '';
        fContainer.appendChild(createStrengthInputHTML('steel', 'add-popup-f', newMemberDefaults.F));

        // ポップアップ内のE選択に応じてF入力欄を更新するイベントリスナーを追加
        const addPopupESelect = document.getElementById('add-popup-e-select');
        if (addPopupESelect) {
            addPopupESelect.addEventListener('change', () => {
                const selectedOpt = addPopupESelect.options[addPopupESelect.selectedIndex];
                let newMaterialType = 'steel';
                if (selectedOpt.textContent.includes('木材')) newMaterialType = 'wood';
                else if (selectedOpt.textContent.includes('ステンレス')) newMaterialType = 'stainless';
                else if (selectedOpt.textContent.includes('アルミニウム')) newMaterialType = 'aluminum';
                
                fContainer.innerHTML = '';
                fContainer.appendChild(createStrengthInputHTML(newMaterialType, 'add-popup-f'));
                
                // 密度も更新（自重考慮がオンの場合）
                const hasDensityColumn = document.querySelector('.density-column') && document.querySelector('.density-column').style.display !== 'none';
                if (hasDensityColumn) {
                    const addPopupEInput = document.getElementById('add-popup-e-input');
                    const eValue = addPopupESelect.value === 'custom' ? addPopupEInput.value : addPopupESelect.value;
                    const newDensity = MATERIAL_DENSITY_DATA[eValue] || MATERIAL_DENSITY_DATA['custom'];
                    
                    // 新規部材追加ポップアップの密度欄を更新
                    const densityContainer = document.getElementById('add-popup-density-container');
                    if (densityContainer) {
                        densityContainer.innerHTML = createDensityInputHTML('add-popup-density', newDensity);
                        
                        // 密度欄更新後にポップアップ位置を再調整
                        setTimeout(() => adjustPopupPosition(elements.addMemberPopup), 0);
                    }
                }
            });
        }
        
        // その他のプロパティを設定
        const izInput = document.getElementById('add-popup-iz');
        const iyInput = document.getElementById('add-popup-iy');
        const jInput = document.getElementById('add-popup-j');
        const iwInput = document.getElementById('add-popup-iw');
        const aInput = document.getElementById('add-popup-a');
        const zzInput = document.getElementById('add-popup-zz');
        const zyInput = document.getElementById('add-popup-zy');
        const iConnInput = document.getElementById('add-popup-i-conn');
        const jConnInput = document.getElementById('add-popup-j-conn');

        console.log('🔍 フィールド存在確認:', {
            iz: !!izInput,
            iy: !!iyInput,
            j: !!jInput,
            iw: !!iwInput,
            a: !!aInput,
            zz: !!zzInput,
            zy: !!zyInput,
            iConn: !!iConnInput,
            jConn: !!jConnInput
        });

        if (izInput) izInput.value = newMemberDefaults.Iz || newMemberDefaults.I || 1840;
        if (iyInput) iyInput.value = newMemberDefaults.Iy || 613;
        if (jInput) jInput.value = newMemberDefaults.J || 235;
        if (iwInput) iwInput.value = newMemberDefaults.Iw || '';
        if (aInput) aInput.value = newMemberDefaults.A || 2340;
        if (zzInput) zzInput.value = newMemberDefaults.Zz || newMemberDefaults.Z || 1230;
        if (zyInput) zyInput.value = newMemberDefaults.Zy || 410;
        if (iConnInput) iConnInput.value = newMemberDefaults.i_conn || 'rigid';
        if (jConnInput) jConnInput.value = newMemberDefaults.j_conn || 'rigid';
        
        // ポップアップを画面中央に表示
        const popup = elements.addMemberPopup;
        if (!popup) {
            console.error('❌ addMemberPopup 要素が見つかりません');
            return;
        }
        console.log('✅ ポップアップを表示します');
        popup.style.display = 'block';
        popup.style.visibility = 'visible';
        
        // ポップアップのサイズを取得（デフォルト値を設定）
        const popupRect = popup.getBoundingClientRect();
        const popupWidth = popupRect.width || 400;  // デフォルト幅
        const popupHeight = popupRect.height || 600; // デフォルト高さ（3D用に増加）
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const availableHeight = Math.min(windowHeight, document.documentElement.clientHeight);
        const minMargin = 10;
        const bottomMargin = 20; // タスクバー対策

        // 画面内に収まるように配置
        const left = Math.max(minMargin, Math.min((windowWidth - popupWidth) / 2, windowWidth - popupWidth - minMargin));
        const top = Math.max(minMargin, Math.min((availableHeight - popupHeight) / 2, availableHeight - popupHeight - bottomMargin));

        console.log('📐 ポップアップ位置計算:', {
            popupWidth,
            popupHeight,
            windowWidth,
            windowHeight,
            left,
            top,
            currentDisplay: popup.style.display,
            currentVisibility: popup.style.visibility
        });

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.position = 'fixed';

        console.log('📐 ポップアップ最終スタイル:', {
            left: popup.style.left,
            top: popup.style.top,
            position: popup.style.position,
            display: popup.style.display,
            visibility: popup.style.visibility,
            zIndex: popup.style.zIndex || 'default'
        });
    };
    // 部材追加設定の断面選択ボタン
    document.getElementById('add-popup-select-section').onclick = () => {
        const url = `steel_selector.html?targetMember=addDefaults`;
        console.log('🚀 断面選択ウィンドウを開きます:', url);
        const popup = window.open(url, 'SteelSelector', 'width=1200,height=800,scrollbars=yes,resizable=yes');

        if (!popup) {
            alert('ポップアップブロッカーにより断面選択ツールを開けませんでした。ポップアップを許可してください。');
            console.error('❌ ポップアップブロック: 断面選択ウィンドウが開けませんでした');
        } else {
            console.log('✅ 断面選択ウィンドウが開きました。storageイベントでデータ受信を待機します。');
        }
    };

    document.getElementById('add-popup-ok').onclick = () => {
        const e_select = document.getElementById('add-popup-e-select'), e_input = document.getElementById('add-popup-e-input');
        if (e_select && e_input) {
            newMemberDefaults.E = e_select.value === 'custom' ? e_input.value : e_select.value;
        }

        // F値の取得 - 強度コンテナから現在のUIに応じて値を取得
        const fContainer = document.getElementById('add-popup-f-container');
        if (fContainer && fContainer.firstElementChild) {
            const strengthContainer = fContainer.firstElementChild;
            const strengthType = strengthContainer.dataset?.strengthType;

            if (strengthType === 'wood-type') {
                // 木材の場合 - プリセット値または カスタム値を取得
                const presetSelect = strengthContainer.querySelector('select');
                if (presetSelect) {
                    newMemberDefaults.F = presetSelect.value;
                    // カスタム値の場合は基準強度データを保存
                    if (presetSelect.value === 'custom') {
                        const ftInput = strengthContainer.querySelector('input[id*="-ft"]');
                        const fcInput = strengthContainer.querySelector('input[id*="-fc"]');
                        const fbInput = strengthContainer.querySelector('input[id*="-fb"]');
                        const fsInput = strengthContainer.querySelector('input[id*="-fs"]');

                        if (ftInput && fcInput && fbInput && fsInput) {
                            newMemberDefaults.F = {
                                baseStrengths: {
                                    ft: parseFloat(ftInput.value),
                                    fc: parseFloat(fcInput.value),
                                    fb: parseFloat(fbInput.value),
                                    fs: parseFloat(fsInput.value)
                                }
                            };
                        }
                    }
                }
            } else {
                // 従来の金属材料の場合
                const f_select = document.getElementById('add-popup-f-select');
                const f_input = document.getElementById('add-popup-f-input');
                if (f_select && f_input) {
                    newMemberDefaults.F = f_select.value === 'custom' ? f_input.value : f_select.value;
                } else {
                    // セレクトボックスがない場合は直接入力値を取得
                    const strengthInput = strengthContainer.querySelector('input');
                    if (strengthInput) {
                        newMemberDefaults.F = strengthInput.value;
                    }
                }
            }
        }

        const izInput = document.getElementById('add-popup-iz');
        const iyInput = document.getElementById('add-popup-iy');
        const jInput = document.getElementById('add-popup-j');
        const iwInput = document.getElementById('add-popup-iw');
        const aInput = document.getElementById('add-popup-a');
        const zzInput = document.getElementById('add-popup-zz');
        const zyInput = document.getElementById('add-popup-zy');
        const iConnSelect = document.getElementById('add-popup-i-conn');
        const jConnSelect = document.getElementById('add-popup-j-conn');

        if (izInput) newMemberDefaults.Iz = izInput.value;
        if (iyInput) newMemberDefaults.Iy = iyInput.value;
        if (jInput) newMemberDefaults.J = jInput.value;
        if (iwInput) newMemberDefaults.Iw = iwInput.value;
        if (aInput) newMemberDefaults.A = aInput.value;
        if (zzInput) newMemberDefaults.Zz = zzInput.value;
        if (zyInput) newMemberDefaults.Zy = zyInput.value;
        if (iConnSelect) newMemberDefaults.i_conn = iConnSelect.value;
        if (jConnSelect) newMemberDefaults.j_conn = jConnSelect.value;

        elements.addMemberPopup.style.display = 'none';
        setCanvasMode('addMember');
    };
    document.getElementById('add-popup-cancel').onclick = () => { elements.addMemberPopup.style.display = 'none'; };

    elements.modelCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const rect = elements.modelCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        selectedNodeIndex = getNodeAt(mouseX, mouseY);
        selectedMemberIndex = getMemberAt(mouseX, mouseY);
        
        // window変数も同期
        window.selectedNodeIndex = selectedNodeIndex;
        window.selectedMemberIndex = selectedMemberIndex;
        
        console.log('マウスクリック:', { mouseX, mouseY, selectedNodeIndex, selectedMemberIndex, isShiftPressed });
        
        if (canvasMode === 'select') {
            const projectionMode = getCurrentProjectionMode();
            if (isShiftPressed && (selectedNodeIndex !== -1 || selectedMemberIndex !== -1)) {
                // Shiftキーが押されている場合の複数選択
                if (selectedNodeIndex !== -1) {
                    // 節点を選択する場合、既に部材が選択されていたらクリア
                    if (selectedMembers.size > 0) {
                        console.log('部材選択をクリアして節点選択モードに切り替え');
                        selectedMembers.clear();
                    }
                    
                    if (selectedNodes.has(selectedNodeIndex)) {
                        selectedNodes.delete(selectedNodeIndex);
                        console.log('節点の選択解除:', selectedNodeIndex);
                    } else {
                        selectedNodes.add(selectedNodeIndex);
                        console.log('節点を選択:', selectedNodeIndex);
                    }
                } else if (selectedMemberIndex !== -1) {
                    // 部材を選択する場合、既に節点が選択されていたらクリア
                    if (selectedNodes.size > 0) {
                        console.log('節点選択をクリアして部材選択モードに切り替え');
                        selectedNodes.clear();
                    }
                    
                    if (selectedMembers.has(selectedMemberIndex)) {
                        selectedMembers.delete(selectedMemberIndex);
                        console.log('部材の選択解除:', selectedMemberIndex);
                    } else {
                        selectedMembers.add(selectedMemberIndex);
                        console.log('部材を選択:', selectedMemberIndex);
                    }
                }
                console.log('現在の選択状態:', { 
                    selectedNodes: Array.from(selectedNodes), 
                    selectedMembers: Array.from(selectedMembers) 
                });
                if (typeof drawOnCanvas === 'function') {
                    drawOnCanvas();
                }
                return;
            }
            
            if (selectedNodeIndex !== -1) {
                // 単一選択：既存の動作
                if (!isShiftPressed) {
                    clearMultiSelection();
                    // 部材の選択をクリア（節点を選択する場合）
                    selectedMemberIndex = null;
                    window.selectedMemberIndex = null;
                }
                if (projectionMode === 'iso' && !isShiftPressed) {
                    console.info('等角投影では節点移動を無効化しています。パン操作に切り替えます。');
                    startCanvasPan(mouseX, mouseY);
                    if (typeof drawOnCanvas === 'function') {
                        drawOnCanvas();
                    }
                    return;
                }

                isDragging = true;
                pushState();
                // 単一選択ハイライト表示
                if (typeof drawOnCanvas === 'function') {
                    drawOnCanvas(); // ハイライト表示のため再描画
                }
            } else if (selectedMemberIndex !== -1) {
                // 部材の単一選択
                if (!isShiftPressed) {
                    clearMultiSelection();
                    // 節点の選択をクリア（部材を選択する場合）
                    selectedNodeIndex = null;
                }
                if (projectionMode === 'iso' && !isShiftPressed) {
                    console.info('等角投影では部材移動をパン操作に切り替えます。');
                    startCanvasPan(mouseX, mouseY);
                    if (typeof drawOnCanvas === 'function') {
                        drawOnCanvas();
                    }
                    return;
                }
                // 部材選択ハイライト表示
                if (typeof drawOnCanvas === 'function') {
                    drawOnCanvas(); // ハイライト表示のため再描画
                }
            } else {
                // 空の場所をクリックした場合の処理
                if (isShiftPressed) {
                    // Shiftキーが押されている場合は範囲選択を開始
                    console.log('範囲選択を開始します');
                    hideSelectionChoiceMenu();
                    isRangeSelecting = true;
                    isMultiSelecting = true;
                    rangeSelectionAdditive = isShiftPressed;
                    multiSelectStart = { x: mouseX, y: mouseY };
                    multiSelectEnd = { x: mouseX, y: mouseY };
                    drawOnCanvas();
                } else {
                    // 通常のクリック：パンドラッグを開始
                    console.log('キャンバスパンを開始します');
                    clearMultiSelection();
                    clearSingleSelection(); // 単一選択もクリア
                    startCanvasPan(mouseX, mouseY);
                }
            }
        }
    });
    elements.modelCanvas.addEventListener('mousemove', (e) => {
        const rect = elements.modelCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // デバッグ：1%の確率でマウス移動の詳細を出力
        if (Math.random() < 0.01) {
            console.log('🖱️ マウス移動デバッグ:', {
                canvasMode,
                isRangeSelecting,
                isDragging, 
                isDraggingCanvas,
                条件OK: canvasMode === 'select' && !isRangeSelecting && !isDragging && !isDraggingCanvas,
                lastDrawingContext: !!window.lastDrawingContext
            });
        }
        
        // 部材ホバー検出とツールチップ表示
        if (canvasMode === 'select' && !isRangeSelecting && !isDragging && !isDraggingCanvas) {
            // lastDrawingContextが初期化されているかチェック
            if (!window.lastDrawingContext) {
                // 初回の場合は無視（まだ描画が完了していない）
                return;
            }
            
            // 部材情報表示チェックボックスの状態を確認
            const memberInfoToggle = document.getElementById('member-info-toggle');
            if (!memberInfoToggle || !memberInfoToggle.checked) {
                // チェックボックスが未チェックの場合はツールチップを非表示
                hideMemberTooltip();
                return;
            }
            
            try {
                const hoveredMember = detectMemberAtPosition(e.clientX, e.clientY);
                if (hoveredMember !== null) {
                    console.log('✅ 部材検出成功:', hoveredMember.number);
                    showMemberTooltip(hoveredMember, e.clientX, e.clientY);
                } else {
                    hideMemberTooltip();
                }
            } catch (error) {
                console.error('❌ ツールチップエラー:', error);
            }
        } else {
            // ツールチップ条件を満たさない場合は非表示
            hideMemberTooltip();
        }
        
        if (isRangeSelecting && canvasMode === 'select') {
            multiSelectEnd = { x: mouseX, y: mouseY };
            drawOnCanvas();
        } else if (isDragging && canvasMode === 'select' && selectedNodeIndex !== null && selectedNodeIndex !== -1) {
            const projectionMode = getCurrentProjectionMode();
            if (projectionMode === 'iso') {
                return;
            }

            let modelCoords = inverseTransform(mouseX, mouseY);
            if (modelCoords) {
                if (elements.gridToggle.checked) {
                    const spacing = parseFloat(elements.gridSpacing.value);
                    modelCoords.x = Math.round(modelCoords.x / spacing) * spacing;
                    modelCoords.y = Math.round(modelCoords.y / spacing) * spacing;
                }

                const nodeRow = elements.nodesTable.rows[selectedNodeIndex];
                if (!nodeRow) {
                    return;
                }

                const xInput = nodeRow.cells[1]?.querySelector('input');
                const yInput = nodeRow.cells[2]?.querySelector('input');
                const zInput = nodeRow.cells[3]?.querySelector('input');

                const originalX = xInput ? parseFloat(xInput.value) || 0 : 0;
                const originalY = yInput ? parseFloat(yInput.value) || 0 : 0;
                const originalZ = zInput ? parseFloat(zInput.value) || 0 : 0;

                let nextX = originalX;
                let nextY = originalY;
                let nextZ = originalZ;

                switch (projectionMode) {
                    case 'xy':
                        nextX = modelCoords.x;
                        nextY = modelCoords.y;
                        break;
                    case 'xz':
                        nextX = modelCoords.x;
                        nextZ = modelCoords.y;
                        break;
                    case 'yz':
                        nextY = modelCoords.x;
                        nextZ = modelCoords.y;
                        break;
                    default:
                        nextX = modelCoords.x;
                        nextY = modelCoords.y;
                        break;
                }

                if (xInput) xInput.value = nextX.toFixed(3);
                if (yInput) yInput.value = nextY.toFixed(3);
                if (zInput) zInput.value = nextZ.toFixed(3);

                drawOnCanvas();
            }
        } else if (isDraggingCanvas && canvasMode === 'select') {
            const deltaX = mouseX - lastMouseX;
            const deltaY = mouseY - lastMouseY;
            panZoomState.offsetX += deltaX;
            panZoomState.offsetY += deltaY;
            lastMouseX = mouseX;
            lastMouseY = mouseY;
            drawOnCanvas();
        }
    });
    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            if (isRangeSelecting) {
                console.log('範囲選択完了 - finalizeRangeSelectionを呼び出します');
                finalizeRangeSelection(e);
                isRangeSelecting = false;
                rangeSelectionAdditive = false;
                multiSelectStart = { x: 0, y: 0 };
                multiSelectEnd = { x: 0, y: 0 };
                drawOnCanvas();
            }
            if (isDragging) {
                elements.nodesTable.rows[selectedNodeIndex]?.cells[1].querySelector('input').dispatchEvent(new Event('change'));
                isDragging = false;
            }
            if (isDraggingCanvas) {
                isDraggingCanvas = false;
            }
        }
    });
    elements.modelCanvas.addEventListener('click', (e) => { 
        const rect = elements.modelCanvas.getBoundingClientRect(); let mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top; const clickedNodeIndex = getNodeAt(mouseX, mouseY); 
        if (canvasMode === 'addNode') {
            const targetMemberIndex = getMemberAt(mouseX, mouseY);
            let modelCoords = inverseTransform(mouseX, mouseY); if (!modelCoords) return;
            if (targetMemberIndex !== -1) {
                pushState();
                const { nodes } = parseInputs(), memberRow = elements.membersTable.rows[targetMemberIndex];
                const startNodeId = parseInt(memberRow.cells[1].querySelector('input').value), endNodeId = parseInt(memberRow.cells[2].querySelector('input').value);
                const p1 = nodes[startNodeId - 1], p2 = nodes[endNodeId - 1];
                
                // 投影モードを取得
                const projectionMode = getCurrentProjectionMode();
                
                // 2D投影座標から部材上の位置パラメータtを計算
                let p1_2d, p2_2d;
                if (projectionMode === 'xy') {
                    p1_2d = { x: p1.x, y: p1.y };
                    p2_2d = { x: p2.x, y: p2.y };
                } else if (projectionMode === 'xz') {
                    p1_2d = { x: p1.x, y: p1.z };
                    p2_2d = { x: p2.x, y: p2.z };
                } else if (projectionMode === 'yz') {
                    p1_2d = { x: p1.y, y: p1.z };
                    p2_2d = { x: p2.y, y: p2.z };
                } else {
                    p1_2d = { x: p1.x, y: p1.y };
                    p2_2d = { x: p2.x, y: p2.y };
                }
                
                // 部材上の位置パラメータtを計算（0〜1）
                const dx_2d = p2_2d.x - p1_2d.x;
                const dy_2d = p2_2d.y - p1_2d.y;
                const lenSq_2d = dx_2d * dx_2d + dy_2d * dy_2d;
                let t = 0;
                if (lenSq_2d > 1e-10) {
                    t = ((modelCoords.x - p1_2d.x) * dx_2d + (modelCoords.y - p1_2d.y) * dy_2d) / lenSq_2d;
                    t = Math.max(0, Math.min(1, t)); // 0〜1にクランプ
                }
                
                // グリッドスナップが有効な場合の処理
                let finalCoords;
                if (elements.gridToggle.checked) {
                    const spacing = parseFloat(elements.gridSpacing.value), snapTolerance = spacing / 2.5;
                    const nearestGridX = Math.round(modelCoords.x / spacing) * spacing;
                    const nearestGridY = Math.round(modelCoords.y / spacing) * spacing;
                    const distToGrid = Math.sqrt((modelCoords.x - nearestGridX)**2 + (modelCoords.y - nearestGridY)**2);
                    if (distToGrid < snapTolerance) {
                        const isCollinear = Math.abs((nearestGridY - p1_2d.y) * (p2_2d.x - p1_2d.x) - (nearestGridX - p1_2d.x) * (p2_2d.y - p1_2d.y)) < 1e-6;
                        const isWithinBounds = (nearestGridX >= Math.min(p1_2d.x, p2_2d.x) - 1e-6 && nearestGridX <= Math.max(p1_2d.x, p2_2d.x) + 1e-6 && 
                                              nearestGridY >= Math.min(p1_2d.y, p2_2d.y) - 1e-6 && nearestGridY <= Math.max(p1_2d.y, p2_2d.y) + 1e-6);
                        if (isCollinear && isWithinBounds) {
                            finalCoords = { x: nearestGridX, y: nearestGridY };
                            // グリッド位置に対応するtを再計算
                            if (lenSq_2d > 1e-10) {
                                t = ((finalCoords.x - p1_2d.x) * dx_2d + (finalCoords.y - p1_2d.y) * dy_2d) / lenSq_2d;
                                t = Math.max(0, Math.min(1, t));
                            }
                        }
                    }
                }
                
                // 3D座標を部材の実際の3D位置から補間して計算
                const nodeX = p1.x + t * (p2.x - p1.x);
                const nodeY = p1.y + t * (p2.y - p1.y);
                const nodeZ = p1.z + t * (p2.z - p1.z);

                const e_select=memberRow.cells[3].querySelector('select'), e_input=memberRow.cells[3].querySelector('input[type="number"]'); const E_val = e_select.value==='custom'?e_input.value:e_select.value;
                const f_select=memberRow.cells[4].querySelector('select'), f_input=memberRow.cells[4].querySelector('input[type="number"]'); const F_val = f_select ? (f_select.value==='custom'?f_input.value:f_select.value) : '235';
                const Iz_m4 = parseFloat(memberRow.cells[5].querySelector('input').value)*1e-8;
                const Iy_m4 = parseFloat(memberRow.cells[6].querySelector('input').value)*1e-8;
                const J_m4 = parseFloat(memberRow.cells[7].querySelector('input').value)*1e-8;
                const Iw_m6 = parseFloat(memberRow.cells[8].querySelector('input').value)*1e-12;
                const A_m2 = parseFloat(memberRow.cells[9].querySelector('input').value)*1e-4;
                const Zz_m3 = parseFloat(memberRow.cells[10].querySelector('input').value)*1e-6;
                const Zy_m3 = parseFloat(memberRow.cells[11].querySelector('input').value)*1e-6;

                // Dynamic cell index calculation for connections
                const connectionTargets = resolveMemberConnectionTargets(memberRow);
                const iConnSelect = connectionTargets.i.select;
                const jConnSelect = connectionTargets.j.select;
                const props = {E:E_val, F:F_val, Iz:Iz_m4, Iy:Iy_m4, J:J_m4, Iw:Iw_m6, A:A_m2, Zz:Zz_m3, Zy:Zy_m3, i_conn: iConnSelect ? iConnSelect.value : 'rigid', j_conn: jConnSelect ? jConnSelect.value : 'rigid'};
                
                // 節点追加を先に実行（失敗した場合は部材を削除しない）
                const newNodeRow = addNodeToTable(nodeX, nodeY, nodeZ, 'free');
                if (!newNodeRow) {
                    console.error('節点追加に失敗しました（部材分割）');
                    return;
                }
                
                // 節点追加が成功したら、既存の部材を削除
                memberRow.querySelector('.delete-row-btn').onclick.apply(memberRow.querySelector('.delete-row-btn'));
                
                const newNodeId = elements.nodesTable.rows.length;
                addRow(elements.membersTable, [`#`, ...memberRowHTML(startNodeId, newNodeId, props.E, props.F, props.Iz, props.Iy, props.J, props.Iw ?? '', props.A, props.Zz, props.Zy, props.i_conn, 'rigid')], false);
                addRow(elements.membersTable, [`#`, ...memberRowHTML(newNodeId, endNodeId, props.E, props.F, props.Iz, props.Iy, props.J, props.Iw ?? '', props.A, props.Zz, props.Zy, 'rigid', props.j_conn)], false);
                renumberTables(); drawOnCanvas();
            } else {
                const spacing=parseFloat(elements.gridSpacing.value), snapTolerance=spacing/2.5;
                const snappedX=Math.round(modelCoords.x/spacing)*spacing, snappedY=Math.round(modelCoords.y/spacing)*spacing;
                const dist=Math.sqrt((modelCoords.x-snappedX)**2+(modelCoords.y-snappedY)**2);
                if (elements.gridToggle.checked && dist < snapTolerance) { modelCoords.x=snappedX; modelCoords.y=snappedY; }

                // 投影モードに応じて3D座標を設定
                const projectionMode = getCurrentProjectionMode();
                const hiddenCoord = elements.hiddenAxisCoord ? parseFloat(elements.hiddenAxisCoord.value) || 0 : 0;
                let nodeX = 0, nodeY = 0, nodeZ = 0;
                if (projectionMode === 'xy') {
                    nodeX = modelCoords.x; nodeY = modelCoords.y; nodeZ = hiddenCoord;
                } else if (projectionMode === 'xz') {
                    nodeX = modelCoords.x; nodeY = hiddenCoord; nodeZ = modelCoords.y;
                } else if (projectionMode === 'yz') {
                    nodeX = hiddenCoord; nodeY = modelCoords.x; nodeZ = modelCoords.y;
                } else {
                    nodeX = modelCoords.x; nodeY = modelCoords.y; nodeZ = 0;
                }

                const newNodeRow = addNodeToTable(nodeX, nodeY, nodeZ, 'free');
                if (newNodeRow) {
                    renumberTables();
                    if (typeof drawOnCanvas === 'function') {
                        drawOnCanvas();
                    }
                }
            }
        } else if (canvasMode === 'addMember') {
            if (clickedNodeIndex !== -1) {
                if (firstMemberNode === null) { firstMemberNode = clickedNodeIndex; }
                else {
                    if (firstMemberNode !== clickedNodeIndex) {
                        const Iz_m4 = parseFloat(newMemberDefaults.Iz || newMemberDefaults.I || 1840)*1e-8;
                        const Iy_m4 = parseFloat(newMemberDefaults.Iy || 613)*1e-8;
                        const J_m4 = parseFloat(newMemberDefaults.J || 235)*1e-8;
                        const A_m2 = parseFloat(newMemberDefaults.A)*1e-4;
                        const Zz_m3 = parseFloat(newMemberDefaults.Zz || newMemberDefaults.Z || 1230)*1e-6;
                        const Zy_m3 = parseFloat(newMemberDefaults.Zy || 410)*1e-6;
                        
                        // 断面情報から寸法付き名称を生成
                        let sectionName = newMemberDefaults.sectionName || '';
                        if (newMemberDefaults.sectionInfo && newMemberDefaults.sectionInfo.rawDims) {
                            const info = newMemberDefaults.sectionInfo;
                            const dims = info.rawDims;
                            const parts = [info.typeLabel || ''];
                            if (dims.H != null) parts.push(dims.H);
                            if (dims.B != null) parts.push(dims.B);
                            if (dims.t1 != null) parts.push(dims.t1);
                            if (dims.t2 != null) parts.push(dims.t2);
                            if (parts.length > 1) {
                                sectionName = parts.join('×');
                            }
                        }
                        
                        const sectionAxis = newMemberDefaults.sectionAxis || '';
                        console.log('🔍 部材追加: newMemberDefaults:', { sectionName, sectionAxis, Iz: newMemberDefaults.Iz, Iy: newMemberDefaults.Iy, J: newMemberDefaults.J, A: newMemberDefaults.A, Zz: newMemberDefaults.Zz, Zy: newMemberDefaults.Zy });
                        addRow(elements.membersTable, [`#`, ...memberRowHTML(firstMemberNode+1, clickedNodeIndex+1, newMemberDefaults.E, newMemberDefaults.F, Iz_m4, Iy_m4, J_m4, '', A_m2, Zz_m3, Zy_m3, newMemberDefaults.i_conn, newMemberDefaults.j_conn, sectionName, sectionAxis)]);
                    }
                    firstMemberNode = null;
                }
                drawOnCanvas();
            }
        } 
    });

    const getNodeLoadAt = (canvasX, canvasY) => {
        if (!lastDrawingContext) return -1;

        const arrows = Array.isArray(window.lastConcentratedLoadArrows)
            ? window.lastConcentratedLoadArrows
            : [];

        const tolerance = 6;
        const distanceToSegment = (px, py, ax, ay, bx, by) => {
            const vx = bx - ax;
            const vy = by - ay;
            const wx = px - ax;
            const wy = py - ay;
            const c1 = vx * wx + vy * wy;
            const c2 = vx * vx + vy * vy;
            let b = c2 > 0 ? c1 / c2 : 0;
            if (b < 0) b = 0;
            if (b > 1) b = 1;
            const closestX = ax + b * vx;
            const closestY = ay + b * vy;
            return Math.hypot(px - closestX, py - closestY);
        };

        for (const record of arrows) {
            if (record.axis === 'mz' && record.arc) {
                const dist = Math.hypot(canvasX - record.arc.x, canvasY - record.arc.y);
                if (dist >= record.arc.radius - tolerance && dist <= record.arc.radius + tolerance) {
                    return record.nodeIndex;
                }
                continue;
            }

            if (record.tail && record.head) {
                const dist = distanceToSegment(canvasX, canvasY, record.tail.x, record.tail.y, record.head.x, record.head.y);
                if (dist <= tolerance) {
                    return record.nodeIndex;
                }
            }
        }

        return -1;
    };

    elements.modelCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const rect = elements.modelCanvas.getBoundingClientRect(), mouseX = e.clientX-rect.left, mouseY = e.clientY-rect.top;
        
        // 全てのポップアップとメニューを確実に非表示（null チェック付き）
        if (elements.nodeContextMenu) elements.nodeContextMenu.style.display='none';
        if (elements.memberPropsPopup) {
            elements.memberPropsPopup.style.display='none';
            elements.memberPropsPopup.style.visibility='hidden';
        }
        if (elements.nodePropsPopup) {
            elements.nodePropsPopup.style.display='none';
            elements.nodePropsPopup.style.visibility='hidden';
            setNodePropsTitle();
        }
        if (elements.nodeLoadPopup) {
            elements.nodeLoadPopup.style.display='none';
            elements.nodeLoadPopup.style.visibility='hidden';
        }
        if (elements.nodeCoordsPopup) {
            elements.nodeCoordsPopup.style.display='none';
            elements.nodeCoordsPopup.style.visibility='hidden';
        }
        
        // デバッグログを追加
        console.log('🖱️ 右クリックイベント発生 - マウス位置:', { mouseX, mouseY });
        console.log('現在の複数選択状態:', {
            selectedMembers: Array.from(selectedMembers),
            selectedNodes: Array.from(selectedNodes),
            selectedMembersSize: selectedMembers.size,
            selectedNodesSize: selectedNodes.size
        });
        
        // 複数選択状態をチェック
        if (selectedMembers.size > 1) {
            console.log('✅ 複数部材選択時の右クリック - 一括編集メニュー表示:', Array.from(selectedMembers));
            showBulkEditMenu(e.pageX, e.pageY);
            return;
        } else if (selectedNodes.size > 1) {
            console.log('✅ 複数節点選択時の右クリック - 一括編集メニュー表示:', Array.from(selectedNodes));
            showBulkNodeEditMenu(e.pageX, e.pageY);
            return;
        }
        
        console.log('📍 単一選択判定開始');
        selectedNodeIndex = getNodeAt(mouseX, mouseY);
        let loadedNodeIndex = -1; 
        if (selectedNodeIndex === -1) { 
            loadedNodeIndex = getNodeLoadAt(mouseX, mouseY); 
        }
        selectedMemberIndex = getMemberAt(mouseX, mouseY);

        // window変数も同期
        window.selectedNodeIndex = selectedNodeIndex;
        window.selectedMemberIndex = selectedMemberIndex;

        console.log('✅ 右クリック後の選択状態:', {
            selectedNodeIndex,
            selectedMemberIndex,
            loadedNodeIndex,
            windowSelectedNodeIndex: window.selectedNodeIndex,
            windowSelectedMemberIndex: window.selectedMemberIndex
        });

        if (loadedNodeIndex !== -1) {
            selectedNodeIndex = loadedNodeIndex;
            console.log('💡 荷重（節点荷重）編集 - 節点プロパティポップアップを開きます:', selectedNodeIndex + 1);
            if (typeof openNodeEditor === 'function') {
                openNodeEditor(selectedNodeIndex);
            } else if (typeof window.openNodeEditor === 'function') {
                window.openNodeEditor(selectedNodeIndex);
            } else {
                console.error('❌ openNodeEditor が見つかりません');
            }

            // 選択状態をハイライト表示するため再描画
            drawOnCanvas();
            return;
        } else if (selectedNodeIndex !== -1) {
            console.log('💡 節点コンテキストメニュー表示 - 節点:', selectedNodeIndex + 1);
            if (elements.nodeContextMenu) {
                elements.nodeContextMenu.style.display='block'; 
                elements.nodeContextMenu.style.left=`${e.pageX}px`; 
                elements.nodeContextMenu.style.top=`${e.pageY}px`;
                console.log('✅ 節点コンテキストメニュー表示完了');
            } else {
                console.error('❌ nodeContextMenu 要素が見つかりません');
            }
        } else if (selectedMemberIndex !== -1) {
            openMemberEditor(selectedMemberIndex);
        } else {
            console.log('❌ クリック位置に節点・部材・荷重が見つかりませんでした');
        }

        // 選択状態をハイライト表示するため再描画
        drawOnCanvas();
    });
    
    // ポップアップの位置を動的に再調整する関数
    function adjustPopupPosition(popup, targetBounds = null) {
        console.log('📐 adjustPopupPosition呼び出し:', {
            popup: popup?.id,
            display: popup?.style.display,
            targetBounds: targetBounds
        });
        
        if (!popup || popup.style.display === 'none') {
            console.log('❌ ポップアップが非表示または存在しません');
            return;
        }
        
        // 現在のポップアップサイズを取得
        const popupRect = popup.getBoundingClientRect();
        const popupWidth = popupRect.width;
        const popupHeight = popupRect.height;
        
        console.log('📏 ポップアップサイズ:', {
            width: popupWidth,
            height: popupHeight,
            currentRect: popupRect
        });
        const windowWidth = window.innerWidth;
        
        // 実際に利用可能な画面高さを取得（タスクバーなどを除く）
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.clientHeight;
        const availableHeight = Math.min(windowHeight, documentHeight);
        
        const minMargin = 10;
        const bottomMargin = 20; // タスクバー対策でより大きなマージン
        
        let left = parseInt(popup.style.left) || 0;
        let top = parseInt(popup.style.top) || 0;
        
        if (targetBounds) {
            // 部材位置を避けて再配置
            const margin = 20;
            
            // 右側に配置を試行
            left = targetBounds.right + margin;
            if (left + popupWidth > windowWidth - minMargin) {
                // 右側に収まらない場合は左側に配置
                left = targetBounds.left - popupWidth - margin;
                if (left < minMargin) {
                    // 左側にも収まらない場合は上下に配置
                    left = Math.max(minMargin, Math.min((windowWidth - popupWidth) / 2, windowWidth - popupWidth - minMargin));
                    top = targetBounds.bottom + margin;
                    if (top + popupHeight > availableHeight - bottomMargin) {
                        // 下側に収まらない場合は上側に配置
                        top = targetBounds.top - popupHeight - margin;
                        if (top < minMargin) {
                            // どこにも収まらない場合は画面中央（強制的に収める）
                            left = Math.max(minMargin, (windowWidth - popupWidth) / 2);
                            top = Math.max(minMargin, (availableHeight - popupHeight) / 2);
                        }
                    }
                } else {
                    // 左側に配置できる場合の縦位置
                    top = Math.max(minMargin, Math.min(targetBounds.top, availableHeight - popupHeight - bottomMargin));
                }
            } else {
                // 右側に配置できる場合の縦位置
                top = Math.max(minMargin, Math.min(targetBounds.top, availableHeight - popupHeight - bottomMargin));
            }
        } else {
            // 画面境界チェックのみ
            // 右端チェック
            if (left + popupWidth > windowWidth - minMargin) {
                left = windowWidth - popupWidth - minMargin;
            }
            // 左端チェック
            if (left < minMargin) {
                left = minMargin;
            }
            // 下端チェック（タスクバー対応）
            if (top + popupHeight > availableHeight - bottomMargin) {
                top = availableHeight - popupHeight - bottomMargin;
            }
            // 上端チェック
            if (top < minMargin) {
                top = minMargin;
            }
        }
        
        // 最終的に画面内に強制的に収める
        left = Math.max(minMargin, Math.min(left, windowWidth - popupWidth - minMargin));
        top = Math.max(minMargin, Math.min(top, availableHeight - popupHeight - bottomMargin));
        
        console.log('✅ ポップアップ最終位置:', {
            left: left,
            top: top,
            windowWidth: windowWidth,
            availableHeight: availableHeight,
            popupDisplay: popup.style.display
        });
        
        // position: fixedを明示的に設定
        popup.style.position = 'fixed';
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.zIndex = '10000'; // 非常に高いz-indexを設定
        
        console.log('🎯 ポップアップ位置設定完了:', {
            styleLeft: popup.style.left,
            styleTop: popup.style.top,
            styleDisplay: popup.style.display,
            stylePosition: popup.style.position,
            styleZIndex: popup.style.zIndex,
            boundingRect: popup.getBoundingClientRect()
        });
    }
    // 3Dビューから使用するためグローバルに公開
    window.adjustPopupPosition = adjustPopupPosition;

    function openMemberEditor(memberIndex) {
        if (typeof memberIndex !== 'number' || memberIndex < 0) {
            console.warn('⚠️ 無効な部材インデックスが指定されました:', memberIndex);
            return;
        }

        selectedMemberIndex = memberIndex;
        window.selectedMemberIndex = memberIndex;

        console.log('💡 部材プロパティポップアップ表示開始 - 部材:', memberIndex + 1);

        const memberRow = elements.membersTable.rows[memberIndex];
        if (!memberRow) {
            console.error('❌ 部材行が見つかりません', { memberIndex });
            return;
        }

        const popupTitle = document.getElementById('member-props-title');
        if (popupTitle) {
            popupTitle.textContent = `部材 #${memberIndex + 1} プロパティ編集`;
        }

        const eSelect = memberRow.cells[3]?.querySelector('select');
        const eInput = memberRow.cells[3]?.querySelector('input[type="number"]');
        const currentE = eSelect
            ? (eSelect.value === 'custom' ? (eInput?.value ?? '') : eSelect.value)
            : (eInput?.value ?? '');

        const eContainer = document.getElementById('popup-e-container');
        if (eContainer) {
            eContainer.innerHTML = createEInputHTML('popup-e', currentE);
        }

        const strengthContainer = memberRow.cells[4]?.firstElementChild;
        if (!strengthContainer) {
            console.error('強度入力コンテナが見つかりません');
            return;
        }

        const strengthType = strengthContainer.dataset.strengthType;
        let currentStrength;
        if (strengthType === 'wood-type') {
            const presetSelect = strengthContainer.querySelector('select');
            if (presetSelect && presetSelect.value === 'custom') {
                currentStrength = { baseStrengths: {} };
                ['ft', 'fc', 'fb', 'fs'].forEach((key) => {
                    const input = strengthContainer.querySelector(`input[id*="-${key}"]`);
                    currentStrength.baseStrengths[key] = input ? parseFloat(input.value || '0') : 0;
                });
            } else {
                currentStrength = presetSelect ? presetSelect.value : null;
            }
        } else {
            const input = strengthContainer.querySelector('input');
            currentStrength = input ? input.value : '';
        }

        const popupFContainer = document.getElementById('popup-f-container');
        let materialType = 'steel';
        if (eSelect) {
            const selectedOption = eSelect.options[eSelect.selectedIndex];
            if (selectedOption) {
                const label = selectedOption.textContent || '';
                if (label.includes('木材')) materialType = 'wood';
                else if (label.includes('ステンレス')) materialType = 'stainless';
                else if (label.includes('アルミニウム')) materialType = 'aluminum';
            }
        }

        if (popupFContainer) {
            popupFContainer.innerHTML = '';
            popupFContainer.appendChild(createStrengthInputHTML(materialType, 'popup-f', currentStrength));
        }

        const popupESelect = document.getElementById('popup-e-select');
        if (popupESelect && popupFContainer) {
            popupESelect.addEventListener('change', () => {
                const selectedOpt = popupESelect.options[popupESelect.selectedIndex];
                let newMaterialType = 'steel';
                if (selectedOpt && selectedOpt.textContent.includes('木材')) newMaterialType = 'wood';
                else if (selectedOpt && selectedOpt.textContent.includes('ステンレス')) newMaterialType = 'stainless';
                else if (selectedOpt && selectedOpt.textContent.includes('アルミニウム')) newMaterialType = 'aluminum';

                popupFContainer.innerHTML = '';
                popupFContainer.appendChild(createStrengthInputHTML(newMaterialType, 'popup-f'));

                const hasDensityColumn = document.querySelector('.density-column') && document.querySelector('.density-column').style.display !== 'none';
                if (hasDensityColumn) {
                    const popupEInput = document.getElementById('popup-e-input');
                    const eValue = popupESelect.value === 'custom' ? popupEInput?.value : popupESelect.value;
                    const newDensity = MATERIAL_DENSITY_DATA[eValue] || MATERIAL_DENSITY_DATA['custom'];
                    const densityContainer = document.getElementById('popup-density-container');
                    if (densityContainer) {
                        densityContainer.innerHTML = createDensityInputHTML('popup-density', newDensity);
                        setupPopupDensityHandlers();
                        updatePopupSelfWeightDisplay();
                    }
                }
            });
        }

        const assignValue = (id, tableCellIndex) => {
            const element = document.getElementById(id);
            const cellInput = memberRow.cells[tableCellIndex]?.querySelector('input');
            if (element && cellInput) {
                element.value = cellInput.value;
            }
        };

        assignValue('popup-iz', 5);
        assignValue('popup-iy', 6);
        assignValue('popup-j', 7);
        assignValue('popup-iw', 8);
        assignValue('popup-a', 9);
        assignValue('popup-zz', 10);
        assignValue('popup-zy', 11);

        const sectionNameInput = document.getElementById('popup-section-name');
        if (sectionNameInput) {
            const sectionNameSpan = memberRow.querySelector('.section-name-cell');
            const datasetLabel = (memberRow.dataset.sectionLabel || '').trim();
            const displayLabel = (sectionNameSpan?.textContent || '').trim();
            const resolvedName = displayLabel && displayLabel !== '-' ? displayLabel : datasetLabel;
            sectionNameInput.value = resolvedName || '';
            syncPopupSectionNameClearState();
        }

        const sectionAxisSelect = document.getElementById('popup-section-axis');
        if (sectionAxisSelect) {
            const axisKey = memberRow.dataset.sectionAxisKey || deriveAxisKeyFromLabel(memberRow.querySelector('.section-axis-cell')?.textContent) || 'x';
            sectionAxisSelect.value = ['x', 'y', 'both'].includes(axisKey) ? axisKey : 'x';
        }

        const hasDensityColumn = document.querySelector('.density-column') && document.querySelector('.density-column').style.display !== 'none';
        const densityLabel = document.getElementById('popup-density-label');
        const densityContainer = document.getElementById('popup-density-container');
        const selfWeightLabel = document.getElementById('popup-self-weight-label');
        const selfWeightValue = document.getElementById('popup-self-weight-value');

        if (densityLabel && densityContainer) {
            if (hasDensityColumn) {
                let currentDensity = '7850';
                const densityCell = memberRow.querySelector('.density-cell');
                if (densityCell) {
                    const densitySelect = densityCell.querySelector('select');
                    const densityInput = densityCell.querySelector('input[type="number"]');
                    currentDensity = densitySelect && densitySelect.value === 'custom'
                        ? densityInput?.value ?? '7850'
                        : densitySelect?.value ?? densityInput?.value ?? '7850';
                }

                densityLabel.style.display = '';
                densityContainer.style.display = '';
                if (selfWeightLabel) selfWeightLabel.style.display = '';
                if (selfWeightValue) selfWeightValue.style.display = '';

                densityContainer.innerHTML = createDensityInputHTML('popup-density', currentDensity);
                setupPopupDensityHandlers();
                updatePopupSelfWeightDisplay();
            } else {
                densityLabel.style.display = 'none';
                densityContainer.style.display = 'none';
                if (selfWeightLabel) selfWeightLabel.style.display = 'none';
                if (selfWeightValue) {
                    selfWeightValue.style.display = 'none';
                    selfWeightValue.textContent = '-';
                }
            }

            setTimeout(() => adjustPopupPosition(elements.memberPropsPopup), 0);
        }

        const connectionTargets = resolveMemberConnectionTargets(memberRow);
        const popupIConn = document.getElementById('popup-i-conn');
        const popupJConn = document.getElementById('popup-j-conn');

        if (popupIConn) {
            if (connectionTargets.i.select) {
                popupIConn.value = connectionTargets.i.select.value;
            } else {
                console.warn('始端接合selectが見つかりません。', { rowIndex: memberIndex, connectionTargets });
                popupIConn.value = 'rigid';
            }
        }

        if (popupJConn) {
            if (connectionTargets.j.select) {
                popupJConn.value = connectionTargets.j.select.value;
            } else {
                console.warn('終端接合selectが見つかりません。', { rowIndex: memberIndex, connectionTargets });
                popupJConn.value = 'rigid';
            }
        }

        const memberLoadRow = findMemberLoadRow(memberIndex);
        setPopupLoadInputs(memberLoadRow ? readMemberLoadComponents(memberLoadRow) : { wx: 0, wy: 0, wz: 0 });

        const popup = elements.memberPropsPopup;
        if (!popup) {
            console.error('❌ memberPropsPopup 要素が見つかりません');
            return;
        }

        popup.style.display = 'block';
        popup.style.visibility = 'visible';
        console.log('📦 部材プロパティポップアップ - 表示設定:', {
            display: popup.style.display,
            visibility: popup.style.visibility,
            position: popup.style.position
        });

        const popupRect = popup.getBoundingClientRect();
        const popupWidth = popupRect.width || 400;
        const popupHeight = popupRect.height || 350;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const availableHeight = Math.min(windowHeight, document.documentElement.clientHeight);
        const canvasRect = elements.modelCanvas.getBoundingClientRect();

        let memberBounds = null;
        if (window.selectedMemberIndex !== null && window.selectedMemberIndex >= 0) {
            try {
                const { nodes, members } = window.parseInputs();
                const member = members[window.selectedMemberIndex];
                if (member && window.lastDrawingContext) {
                    const node1 = nodes[member.i];
                    const node2 = nodes[member.j];
                    if (node1 && node2) {
                        const pos1 = window.lastDrawingContext.transform(node1.x, node1.y);
                        const pos2 = window.lastDrawingContext.transform(node2.x, node2.y);

                        const minX = Math.min(pos1.x, pos2.x);
                        const maxX = Math.max(pos1.x, pos2.x);
                        const minY = Math.min(pos1.y, pos2.y);
                        const maxY = Math.max(pos1.y, pos2.y);

                        memberBounds = {
                            left: canvasRect.left + minX - 50,
                            right: canvasRect.left + maxX + 50,
                            top: canvasRect.top + minY - 50,
                            bottom: canvasRect.top + maxY + 50
                        };
                    }
                }
            } catch (error) {
                console.warn('部材位置の取得に失敗:', error);
            }
        }

        let left;
        let top;

        if (memberBounds) {
            const margin = 20;
            const minMargin = 10;
            const bottomMargin = 20;

            left = memberBounds.right + margin;
            if (left + popupWidth > windowWidth - minMargin) {
                left = memberBounds.left - popupWidth - margin;
                if (left < minMargin) {
                    left = Math.max(minMargin, Math.min((windowWidth - popupWidth) / 2, windowWidth - popupWidth - minMargin));
                    top = memberBounds.bottom + margin;
                    if (top + popupHeight > availableHeight - bottomMargin) {
                        top = memberBounds.top - popupHeight - margin;
                        if (top < minMargin) {
                            left = Math.max(minMargin, (windowWidth - popupWidth) / 2);
                            top = Math.max(minMargin, (availableHeight - popupHeight) / 2);
                            if (left + popupWidth > windowWidth - minMargin) {
                                left = minMargin;
                            }
                            if (top + popupHeight > availableHeight - bottomMargin) {
                                top = minMargin;
                            }
                        }
                    }
                } else {
                    top = Math.max(minMargin, Math.min(memberBounds.top, availableHeight - popupHeight - bottomMargin));
                }
            } else {
                top = Math.max(minMargin, Math.min(memberBounds.top, availableHeight - popupHeight - bottomMargin));
            }
        } else {
            left = Math.max(10, Math.min((windowWidth - popupWidth) / 2, windowWidth - popupWidth - 10));
            top = Math.max(10, Math.min((availableHeight - popupHeight) / 2, availableHeight - popupHeight - 20));
        }

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.position = 'fixed';
        popup.style.zIndex = '10000';

        console.log('✅ 部材プロパティポップアップ表示完了:', {
            left: popup.style.left,
            top: popup.style.top,
            display: popup.style.display,
            visibility: popup.style.visibility,
            position: popup.style.position,
            zIndex: popup.style.zIndex
        });
    }
    window.openMemberEditor = openMemberEditor;

    // ポップアップのドラッグ機能を追加する関数
    function makePopupDraggable(popup) {
        if (!popup) return;
        
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        
        // ヘッダー部分を取得（h4タグまたはポップアップ全体）
        const header = popup.querySelector('h4') || popup;
        if (!header) return;
        
        // ヘッダーにドラッグ可能であることを示すスタイルを適用
        header.style.cursor = 'move';
        header.style.userSelect = 'none';
        
        function startDrag(e) {
            isDragging = true;
            const popupRect = popup.getBoundingClientRect();
            dragOffset.x = e.clientX - popupRect.left;
            dragOffset.y = e.clientY - popupRect.top;
            
            // ポップアップを最前面に移動とドラッグスタイル適用
            popup.style.zIndex = '1002';
            popup.classList.add('popup-dragging');
            
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
            e.preventDefault();
        }
        
        function doDrag(e) {
            if (!isDragging) return;
            
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const availableHeight = Math.min(windowHeight, document.documentElement.clientHeight);
            const popupRect = popup.getBoundingClientRect();
            const minMargin = 5;
            const bottomMargin = 20;
            
            // 新しい位置を計算
            let newLeft = e.clientX - dragOffset.x;
            let newTop = e.clientY - dragOffset.y;
            
            // 画面境界内に制限
            newLeft = Math.max(minMargin, Math.min(newLeft, windowWidth - popupRect.width - minMargin));
            newTop = Math.max(minMargin, Math.min(newTop, availableHeight - popupRect.height - bottomMargin));
            
            popup.style.left = `${newLeft}px`;
            popup.style.top = `${newTop}px`;
        }
        
        function stopDrag() {
            if (isDragging) {
                isDragging = false;
                // z-indexを元に戻してドラッグスタイルを削除
                popup.style.zIndex = '1001';
                popup.classList.remove('popup-dragging');
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            }
        }
        
        header.addEventListener('mousedown', startDrag);
        
        // タッチデバイス対応
        function startTouchDrag(e) {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousedown', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                startDrag(mouseEvent);
            }
        }
        
        function handleTouchMove(e) {
            if (isDragging && e.touches.length === 1) {
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousemove', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                doDrag(mouseEvent);
                e.preventDefault();
            }
        }
        
        function handleTouchEnd(e) {
            if (isDragging) {
                stopDrag();
                e.preventDefault();
            }
        }
        
        header.addEventListener('touchstart', startTouchDrag, { passive: false });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);
    }
    
    // 全てのポップアップにドラッグ機能を適用
    makePopupDraggable(elements.memberPropsPopup);
    makePopupDraggable(elements.addMemberPopup);
    makePopupDraggable(elements.nodeLoadPopup);

    document.addEventListener('click', (e) => { 
        if (elements.modeAddMemberBtn && elements.modeAddMemberBtn.contains(e.target)) return;
        if(elements.memberPropsPopup && elements.addMemberPopup && !elements.memberPropsPopup.contains(e.target) && !elements.addMemberPopup.contains(e.target)) { elements.memberPropsPopup.style.display='none'; elements.addMemberPopup.style.display='none'; }
        if(elements.nodeLoadPopup && !elements.nodeLoadPopup.contains(e.target)) elements.nodeLoadPopup.style.display='none';
        if(elements.nodeCoordsPopup && !elements.nodeCoordsPopup.contains(e.target)) elements.nodeCoordsPopup.style.display='none';
        if(elements.nodeContextMenu && !elements.nodeContextMenu.contains(e.target)) elements.nodeContextMenu.style.display='none';
    });

    elements.nodeContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = e.target;
        if (selectedNodeIndex === null) return;

        if (target.id === 'menu-edit-node-props') {
            openNodeEditor(selectedNodeIndex);
        } else if (target.id === 'menu-delete-node') {
            elements.nodesTable.rows[selectedNodeIndex].querySelector('.delete-row-btn').click();
        }
        elements.nodeContextMenu.style.display = 'none';
    });

    document.getElementById('popup-select-section').onclick = () => {
    if (selectedMemberIndex !== null) {
        // ポップアップ内の情報から材料情報を取得
        const popup_e_select = document.getElementById('popup-e-select');
        const selectedOption = popup_e_select.options[popup_e_select.selectedIndex];
        let materialType = 'steel';
        if (selectedOption.textContent.includes('木材')) materialType = 'wood';
        else if (selectedOption.textContent.includes('コンクリート')) materialType = 'concrete';
        else if (selectedOption.textContent.includes('ステンレス')) materialType = 'stainless';
        else if (selectedOption.textContent.includes('アルミニウム')) materialType = 'aluminum';
        
        const strengthContainer = document.getElementById('popup-f-container').firstElementChild;
        let strengthValue = '';
        if (strengthContainer.querySelector('input')) strengthValue = strengthContainer.querySelector('input').value;
        if (strengthContainer.querySelector('select')) strengthValue = strengthContainer.querySelector('select').value;

        openSteelSelector(selectedMemberIndex, {
            material: materialType,
            E: popup_e_select.value === 'custom' ? document.getElementById('popup-e-input').value : popup_e_select.value,
            strengthValue: strengthValue
        });
        elements.memberPropsPopup.style.display = 'none';
    }
};

    document.getElementById('popup-save').onclick = () => {
        if (selectedMemberIndex === null) return;
        pushState();
        const memberRow = elements.membersTable.rows[selectedMemberIndex];

        // 1. ポップアップからE係数の値を取得し、テーブルに反映
        const popup_e_select = document.getElementById('popup-e-select');
        const popup_e_input = document.getElementById('popup-e-input');

        if (!popup_e_select || !popup_e_input) {
            console.error('E入力欄が見つかりません:', {
                popup_e_select,
                popup_e_input,
                eContainer: document.getElementById('popup-e-container'),
                eContainerHTML: document.getElementById('popup-e-container')?.innerHTML
            });
            // setTimeoutで待ってから再試行
            setTimeout(() => {
                const retry_e_select = document.getElementById('popup-e-select');
                const retry_e_input = document.getElementById('popup-e-input');
                if (retry_e_select && retry_e_input) {
                    console.log('リトライ成功: E入力欄が見つかりました');
                    // OKボタンを再度クリック
                    document.getElementById('member-props-popup').querySelector('.popup-buttons button:first-child').click();
                } else {
                    alert('E入力欄が見つかりません。ポップアップを閉じて再度お試しください。');
                }
            }, 50);
            return;
        }

        const newEValue = popup_e_select.value === 'custom' ? popup_e_input.value : popup_e_select.value;
        
        const table_e_select = memberRow.cells[3].querySelector('select');
        const table_e_input = memberRow.cells[3].querySelector('input[type="number"]');
        
        const matching_option = Array.from(table_e_select.options).find(opt => opt.value === newEValue);
        if (matching_option) {
            table_e_select.value = newEValue;
        } else {
            table_e_select.value = 'custom';
        }
        table_e_input.value = newEValue;
        table_e_input.readOnly = (table_e_select.value !== 'custom');
        
        // 2. E係数の変更イベントを発火させ、基準強度UIを正しく再生成させる
        table_e_select.dispatchEvent(new Event('change'));

        // 3. ポップアップの基準強度UIの状態を、テーブルにコピーする
        const popupStrengthContainer = document.getElementById('popup-f-container').firstElementChild;
        const tableStrengthContainer = memberRow.cells[4].firstElementChild; // 再生成された最新のUI
        if (!popupStrengthContainer) {
            console.error('ポップアップ強度コンテナが見つかりません');
            return;
        }
        const strengthType = popupStrengthContainer.dataset.strengthType;

        if (strengthType === 'wood-type') {
            const popupPresetSelect = popupStrengthContainer.querySelector('select');
            const tablePresetSelect = tableStrengthContainer.querySelector('select');
            tablePresetSelect.value = popupPresetSelect.value;
            tablePresetSelect.dispatchEvent(new Event('change')); // UIの状態（readonlyなど）を更新
            
            if (popupPresetSelect.value === 'custom') {
                ['ft', 'fc', 'fb', 'fs'].forEach(key => {
                    const popupInput = popupStrengthContainer.querySelector(`input[id*="-${key}"]`);
                    const tableInput = tableStrengthContainer.querySelector(`input[id*="-${key}"]`);
                    if(popupInput && tableInput) tableInput.value = popupInput.value;
                });
            }
        } else { // 鋼材などの場合
            const popupSelect = popupStrengthContainer.querySelector('select');
            const popupInput = popupStrengthContainer.querySelector('input');
            const tableSelect = tableStrengthContainer.querySelector('select');
            const tableInput = tableStrengthContainer.querySelector('input');
            if(popupSelect && tableSelect) tableSelect.value = popupSelect.value;
            if(popupInput && tableInput) {
                tableInput.value = popupInput.value;
                tableInput.readOnly = popupInput.readOnly;
            }
        }

        // 4. その他のプロパティを更新
        memberRow.cells[5].querySelector('input').value = document.getElementById('popup-iz').value;
        memberRow.cells[6].querySelector('input').value = document.getElementById('popup-iy').value;
        memberRow.cells[7].querySelector('input').value = document.getElementById('popup-j').value;
        memberRow.cells[8].querySelector('input').value = document.getElementById('popup-iw').value;
        memberRow.cells[9].querySelector('input').value = document.getElementById('popup-a').value;
        memberRow.cells[10].querySelector('input').value = document.getElementById('popup-zz').value;
        memberRow.cells[11].querySelector('input').value = document.getElementById('popup-zy').value;
        
        // 密度の保存処理
        const hasDensityColumn = document.querySelector('.density-column') && document.querySelector('.density-column').style.display !== 'none';
        if (hasDensityColumn) {
            const popupDensitySelect = document.getElementById('popup-density-select');
            const popupDensityInput = document.getElementById('popup-density-input');
            
            if (popupDensitySelect && popupDensityInput) {
                const densityCell = memberRow.cells[12]; // 密度は12番目のセル (Iz,Iy,J,Iw,A,Zz,Zyの次)
                if (densityCell && densityCell.classList.contains('density-cell')) {
                    const tableDensitySelect = densityCell.querySelector('select');
                    const tableDensityInput = densityCell.querySelector('input[type="number"]');
                    
                    if (tableDensitySelect && tableDensityInput) {
                        tableDensitySelect.value = popupDensitySelect.value;
                        tableDensityInput.value = popupDensityInput.value;
                        tableDensityInput.readOnly = (popupDensitySelect.value !== 'custom');
                    }
                }
            }
        }
        
        const connectionTargets = resolveMemberConnectionTargets(memberRow);
        const popupIConnValue = document.getElementById('popup-i-conn').value;
        const popupJConnValue = document.getElementById('popup-j-conn').value;
        if (connectionTargets.i.select) {
            connectionTargets.i.select.value = popupIConnValue;
        } else {
            console.warn('始端接合selectが見つかりません (popup apply)', { rowIndex: selectedMemberIndex, popupValue: popupIConnValue });
        }
        if (connectionTargets.j.select) {
            connectionTargets.j.select.value = popupJConnValue;
        } else {
            console.warn('終端接合selectが見つかりません (popup apply)', { rowIndex: selectedMemberIndex, popupValue: popupJConnValue });
        }
        const sectionNameInputSave = document.getElementById('popup-section-name');
        if (sectionNameInputSave) {
            const nameValue = sectionNameInputSave.value.trim();
            const sectionNameSpan = memberRow.querySelector('.section-name-cell');
            if (sectionNameSpan) {
                sectionNameSpan.textContent = nameValue || '-';
            }
            if (nameValue) {
                memberRow.dataset.sectionLabel = nameValue;
            } else {
                delete memberRow.dataset.sectionLabel;
            }
            delete memberRow.dataset.sectionInfo;
            delete memberRow.dataset.sectionSummary;
            delete memberRow.dataset.sectionSource;
        }

        const sectionAxisSelectSave = document.getElementById('popup-section-axis');
        if (sectionAxisSelectSave) {
            const normalizedAxis = normalizeAxisInfo({ key: sectionAxisSelectSave.value });
            const axisSpan = memberRow.querySelector('.section-axis-cell');
            if (normalizedAxis) {
                memberRow.dataset.sectionAxisKey = normalizedAxis.key;
                memberRow.dataset.sectionAxisMode = normalizedAxis.mode;
                memberRow.dataset.sectionAxisLabel = normalizedAxis.label;
                if (axisSpan) axisSpan.textContent = normalizedAxis.label;
            } else {
                delete memberRow.dataset.sectionAxisKey;
                delete memberRow.dataset.sectionAxisMode;
                delete memberRow.dataset.sectionAxisLabel;
                if (axisSpan) axisSpan.textContent = '-';
            }
        }

        const loadValues = getPopupLoadInputs();
        const memberLoadRow = findMemberLoadRow(selectedMemberIndex);
        if (!areLoadsNearlyZero(loadValues)) {
            updateMemberLoadRow(selectedMemberIndex, loadValues);
        } else if (memberLoadRow) {
            const deleteBtn = memberLoadRow.querySelector('.delete-row-btn');
            if (deleteBtn) {
                deleteBtn.click();
            } else {
                memberLoadRow.remove();
                renumberTables();
            }
        }
        elements.memberPropsPopup.style.display = 'none';
        runFullAnalysis();
        drawOnCanvas();
    };
    document.getElementById('popup-cancel').onclick = () => { elements.memberPropsPopup.style.display = 'none'; };
    document.getElementById('popup-delete-member').onclick = () => { if(selectedMemberIndex !== null) { elements.membersTable.rows[selectedMemberIndex].querySelector('.delete-row-btn').click(); elements.memberPropsPopup.style.display='none'; } };

    const analyzeNodeRowLayout = (nodeRow) => {
        const defaultResult = {
            is3D: window.is3DMode === true,
            supportSelect: null,
            supportCellIndex: -1,
            numericInputsCount: 0,
            inputs: {}
        };

        if (!(nodeRow instanceof HTMLTableRowElement)) {
            return defaultResult;
        }

        const supportSelect = nodeRow.querySelector('select') || null;
        const cells = Array.from(nodeRow.cells || []);
        const supportCellIndex = supportSelect ? cells.findIndex((cell) => cell.contains(supportSelect)) : -1;
        const numericInputs = Array.from(nodeRow.querySelectorAll('input[type="number"]') || []);
        const getInput = (index) => numericInputs[index] || null;

        const inferred3D = window.is3DMode === true || numericInputs.length >= 6 || supportCellIndex > 3;

        return {
            is3D: inferred3D,
            supportSelect,
            supportCellIndex,
            numericInputsCount: numericInputs.length,
            inputs: {
                x: getInput(0),
                y: getInput(1),
                z: inferred3D ? getInput(2) : null,
                dx: inferred3D ? getInput(3) : getInput(2),
                dy: inferred3D ? getInput(4) : getInput(3),
                dz: inferred3D ? getInput(5) : null
            }
        };
    };

    // 節点プロパティ編集ポップアップを開き、データを設定する関数
    const openNodeEditor = (nodeIndex) => {
        selectedNodeIndex = nodeIndex;
        window.selectedNodeIndex = nodeIndex;

        const nodeRow = elements.nodesTable.rows[nodeIndex];
        if (!nodeRow) {
            console.error('❌ 節点行が見つかりません:', nodeIndex);
            return;
        }

        const layoutInfo = analyzeNodeRowLayout(nodeRow);

        // デバッグ: テーブル構造を確認
        console.log('🔍 テーブル行の構造:', {
            nodeIndex,
            cellCount: nodeRow.cells.length,
            is3DMode: window.is3DMode,
            inferredIs3D: layoutInfo.is3D,
            supportCellIndex: layoutInfo.supportCellIndex,
            numericInputsCount: layoutInfo.numericInputsCount,
            cells: Array.from(nodeRow.cells).map((cell, idx) => ({
                index: idx,
                html: cell.innerHTML.substring(0, 50)
            }))
        });

        const loadRow = Array.from(elements.nodeLoadsTable.rows).find(row => parseInt(row.cells[0].querySelector('input').value) - 1 === nodeIndex);

        // 各入力フィールドの存在確認
        const popupElements = {
            x: getNodePopupField('popup-x'),
            y: getNodePopupField('popup-y'),
            z: getNodePopupField('popup-z', { required: layoutInfo.is3D }),
            support: getNodePopupField('popup-support'),
            px: getNodePopupField('popup-px'),
            py: getNodePopupField('popup-py'),
            pz: getNodePopupField('popup-pz', { required: layoutInfo.is3D }),
            dx: getNodePopupField('popup-dx'),
            dy: getNodePopupField('popup-dy'),
            dz: getNodePopupField('popup-dz', { required: layoutInfo.is3D })
        };

        for (const [key, element] of Object.entries(popupElements)) {
            if (!element) {
                console.error(`❌ popup-${key} 要素が見つかりません`);
                return;
            }
        }

        const readInputValue = (input, fallback = '0') => {
            if (!input) return fallback;
            const value = input.value;
            return value !== undefined && value !== null && value !== '' ? value : fallback;
        };

        const { inputs: nodeInputs, supportSelect } = layoutInfo;
        if (!supportSelect) {
            console.warn('⚠️ 支持条件を表すselect要素が節点行内で検出できませんでした');
        }
        const supportValue = supportSelect ? supportSelect.value : (popupElements.support.value || 'free');

        // 各入力フィールドに現在の値を設定 (モード別)
        if (layoutInfo.is3D) {
            // 3Dモード
            popupElements.x.value = readInputValue(nodeInputs.x);
            popupElements.y.value = readInputValue(nodeInputs.y);
            popupElements.z.value = readInputValue(nodeInputs.z);
            popupElements.support.value = supportValue;
            popupElements.dx.value = readInputValue(nodeInputs.dx);
            popupElements.dy.value = readInputValue(nodeInputs.dy);
            popupElements.dz.value = readInputValue(nodeInputs.dz);
        } else {
            // 2Dモード (Z, dz, rx, ry, rzは0固定)
            popupElements.x.value = readInputValue(nodeInputs.x);
            popupElements.y.value = readInputValue(nodeInputs.y);
            popupElements.z.value = '0';
            popupElements.support.value = supportValue;
            popupElements.dx.value = readInputValue(nodeInputs.dx);
            popupElements.dy.value = readInputValue(nodeInputs.dy);
            popupElements.dz.value = '0';
        }

        // 荷重行から安全に値を取得
        const getLoadValue = (cellIndex) => {
            if (!loadRow || !loadRow.cells[cellIndex]) return '0';
            const element = loadRow.cells[cellIndex].querySelector('input');
            return element ? (element.value || '0') : '0';
        };

        popupElements.px.value = getLoadValue(1);
        popupElements.py.value = getLoadValue(2);
        popupElements.pz.value = getLoadValue(3);
        
        const popup = elements.nodePropsPopup;
        if (!popup) {
            console.error('❌ nodePropsPopup 要素が見つかりません');
            return;
        }

        setNodePropsTitle(nodeIndex + 1);
        
        popup.style.display = 'block';
        popup.style.visibility = 'visible';

        // ポップアップを画面中央に配置
        const popupRect = popup.getBoundingClientRect();
        popup.style.left = `${(window.innerWidth - popupRect.width) / 2}px`;
        popup.style.top = `${(window.innerHeight - popupRect.height) / 2}px`;
        popup.style.position = 'fixed';
        popup.style.zIndex = '10000';
        
        console.log('✅ 節点プロパティポップアップ表示完了:', {
            nodeIndex: selectedNodeIndex + 1,
            display: popup.style.display,
            visibility: popup.style.visibility
        });
    };

    // 3Dビューからアクセスできるようにグローバルスコープに公開
    window.openNodeEditor = openNodeEditor;

    // 新しい節点プロパティポップアップの保存ボタンの処理
    document.getElementById('popup-node-props-save').onclick = () => {
        if (selectedNodeIndex === null) return;
        pushState();

        const nodeRow = elements.nodesTable.rows[selectedNodeIndex];
        const layoutInfo = analyzeNodeRowLayout(nodeRow);
        const { inputs: nodeInputs, supportSelect } = layoutInfo;
        const is3D = layoutInfo.is3D;
        console.log('🔍 節点プロパティ保存:', {
            is3D,
            windowIs3DMode: window.is3DMode,
            supportCellIndex: layoutInfo.supportCellIndex,
            numericInputsCount: layoutInfo.numericInputsCount
        });

        if (!nodeInputs.x || !nodeInputs.y) {
            console.error('❌ 節点プロパティ保存: 座標入力フィールドが見つかりません', nodeInputs);
            return;
        }
        if (!supportSelect) {
            console.error('❌ 節点プロパティ保存: 支持条件selectが見つかりません');
            return;
        }

        const popupValues = {
            x: getNodePopupField('popup-x'),
            y: getNodePopupField('popup-y'),
            z: getNodePopupField('popup-z', { required: is3D }),
            support: getNodePopupField('popup-support'),
            px: getNodePopupField('popup-px'),
            py: getNodePopupField('popup-py'),
            pz: getNodePopupField('popup-pz', { required: is3D }),
            dx: getNodePopupField('popup-dx'),
            dy: getNodePopupField('popup-dy'),
            dz: getNodePopupField('popup-dz', { required: is3D })
        };

        const missingFields = Object.entries(popupValues)
            .filter(([_, element]) => !element)
            .map(([key]) => key);

        if (missingFields.length > 0) {
            console.warn('節点プロパティ保存処理を中断しました。欠落フィールド:', missingFields);
            return;
        }

        if (is3D) {
            // 3Dモード
            nodeInputs.x.value = popupValues.x.value;
            nodeInputs.y.value = popupValues.y.value;
            if (nodeInputs.z) nodeInputs.z.value = popupValues.z.value;
            supportSelect.value = popupValues.support.value;
            if (nodeInputs.dx) nodeInputs.dx.value = popupValues.dx.value;
            if (nodeInputs.dy) nodeInputs.dy.value = popupValues.dy.value;
            if (nodeInputs.dz) nodeInputs.dz.value = popupValues.dz.value;
        } else {
            // 2Dモード (Z座標と回転は無視)
            nodeInputs.x.value = popupValues.x.value;
            nodeInputs.y.value = popupValues.y.value;
            supportSelect.value = popupValues.support.value;
            if (nodeInputs.dx) nodeInputs.dx.value = popupValues.dx.value;
            if (nodeInputs.dy) nodeInputs.dy.value = popupValues.dy.value;
        }

        // 節点荷重テーブルの値を更新または作成/削除
        const px = popupValues.px.value || 0;
        const py = popupValues.py.value || 0;
        const pz = (popupValues.pz && popupValues.pz.value) || 0;

        let loadRow = Array.from(elements.nodeLoadsTable.rows).find(row => parseInt(row.cells[0].querySelector('input').value) - 1 === selectedNodeIndex);

        if (parseFloat(px) === 0 && parseFloat(py) === 0 && parseFloat(pz) === 0) {
            if (loadRow) loadRow.remove(); // 全ての荷重が0なら行を削除
        } else {
            if (loadRow) { // 既存の行があれば更新
                loadRow.cells[1].querySelector('input').value = px;
                loadRow.cells[2].querySelector('input').value = py;
                loadRow.cells[3].querySelector('input').value = pz;
            } else { // なければ新規作成
                addRow(elements.nodeLoadsTable, [`<input type="number" value="${selectedNodeIndex + 1}">`, `<input type="number" value="${px}">`, `<input type="number" value="${py}">`, `<input type="number" value="${pz}">`]);
            }
        }
        
        elements.nodePropsPopup.style.display = 'none';
        setNodePropsTitle();
        runFullAnalysis();
        drawOnCanvas();
    };

    // 新しい節点プロパティポップアップのキャンセルボタンの処理
    document.getElementById('popup-node-props-cancel').onclick = () => {
        elements.nodePropsPopup.style.display = 'none';
        setNodePropsTitle();
    };

    document.getElementById('help-select').onclick = () => alert('【選択/移動モード】\n・節点をクリック＆ドラッグして移動します。\n・節点、部材、荷重を右クリックすると、編集メニューが表示されます。\n・Shiftキーを押しながら空白部分をドラッグすると矩形範囲で節点または部材を追加/解除選択できます。\n・Ctrl（⌘）キーを押しながら空白部分をドラッグすると範囲選択をやり直せます。\n・矩形内に節点と部材が混在する場合は、解除後にどちらを選択するかのメニューが表示されます。\n\n■複数選択機能：\n・Shiftキーを押しながら節点や部材をクリックすると複数選択できます。\n・選択された要素は赤色で強調表示されます。\n・Escapeキーで選択をクリアできます。\n・選択中の要素は一括編集が可能です。');
    document.getElementById('help-add-node').onclick = () => alert('【節点追加モード】\n・キャンバス上の好きな位置をクリックすると、新しい節点が追加されます。\n・グリッド表示時、交点近くをクリックすると自動で交点上に配置されます。\n・既存の部材上をクリックすると、その部材を2つに分割する形で節点が追加されます。');
    document.getElementById('help-add-member').onclick = () => alert('【部材追加モード】\n始点となる節点をクリックし、次に終点となる節点をクリックすると、2つの節点を結ぶ部材が追加されます。');

    // キーボードショートカット機能とイベントリスナー（複数選択機能）
    document.addEventListener('keydown', (e) => {
        // 入力フィールドがアクティブな場合はショートカットをスキップ（Delete/BackspaceとCtrl+Z以外）
        const isInputActive = document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'TEXTAREA' || 
             document.activeElement.tagName === 'SELECT' ||
             document.activeElement.isContentEditable);

        // Shiftキー処理（複数選択用）
        if (e.key === 'Shift') {
            isShiftPressed = true;
            console.log('Shiftキー押下:', isShiftPressed);
        }
        
        // Escapeキー - 選択をクリア
        if (e.key === 'Escape') {
            console.log('Escapeキー押下 - 複数選択をクリア');
            clearMultiSelection();
            e.preventDefault();
        }
        
        // Delete/Backspaceキー - 選択された要素を削除
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (isInputActive) return; // 入力フィールドでは削除処理をスキップ
            
            console.log('Deleteキー押下 - 選択された要素を削除');
            e.preventDefault();
            deleteSelectedElements();
        }

        // 入力フィールドがアクティブな場合、以下のショートカットをスキップ
        if (isInputActive && !(e.ctrlKey && e.key === 'z')) return;

        // キーボードショートカット
        if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
            switch(e.key.toLowerCase()) {
                case 's':
                    // 選択/移動モード
                    console.log('ショートカット: 選択/移動モード (S)');
                    setCanvasMode('select');
                    e.preventDefault();
                    break;
                case 'n':
                    // 節点追加モード
                    console.log('ショートカット: 節点追加モード (N)');
                    setCanvasMode('addNode');
                    e.preventDefault();
                    break;
                case 'm':
                    // 部材追加モード
                    console.log('ショートカット: 部材追加モード (M)');
                    setCanvasMode('addMember');
                    e.preventDefault();
                    break;
                case 'c':
                    // 計算実行
                    console.log('ショートカット: 計算実行 (C)');
                    if (elements.calculateBtn && !elements.calculateBtn.disabled) {
                        elements.calculateBtn.click();
                    }
                    e.preventDefault();
                    break;
                case 'r':
                    // レポート出力
                    console.log('ショートカット: レポート出力 (R)');
                    if (elements.reportBtn && !elements.reportBtn.disabled) {
                        elements.reportBtn.click();
                    }
                    e.preventDefault();
                    break;
                case 'a':
                    // 自動スケーリング
                    console.log('ショートカット: 自動スケーリング (A)');
                    if (elements.autoScaleBtn) {
                        elements.autoScaleBtn.click();
                    }
                    e.preventDefault();
                    break;
                case 'g':
                    // グリッド表示切替
                    console.log('ショートカット: グリッド表示切替 (G)');
                    if (elements.gridToggle) {
                        elements.gridToggle.checked = !elements.gridToggle.checked;
                        drawOnCanvas();
                    }
                    e.preventDefault();
                    break;
            }
        }
        
        // Ctrl+キー の組み合わせ
        if (e.ctrlKey) {
            switch(e.key.toLowerCase()) {
                case 'z':
                    // 元に戻す
                    console.log('ショートカット: 元に戻す (Ctrl+Z)');
                    if (elements.undoBtn && !elements.undoBtn.disabled) {
                        elements.undoBtn.click();
                    }
                    e.preventDefault();
                    break;
                case 's':
                    // 入力保存
                    console.log('ショートカット: 入力保存 (Ctrl+S)');
                    if (elements.saveBtn) {
                        elements.saveBtn.click();
                    }
                    e.preventDefault();
                    break;
                case 'o':
                    // 入力読込
                    console.log('ショートカット: 入力読込 (Ctrl+O)');
                    if (elements.loadBtn) {
                        elements.loadBtn.click();
                    }
                    e.preventDefault();
                    break;
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') {
            isShiftPressed = false;
            console.log('Shiftキー解放:', isShiftPressed);
        }
    });

// --- Table Row Templates & Presets ---
const createEInputHTML = (idPrefix, currentE = '205000') => {

        const materials = { "205000": "スチール", "193000": "ステンレス", "70000": "アルミニウム", "8000": "木材" };
        const e_val_str = parseFloat(currentE).toString();
        let isPresetMaterial = materials.hasOwnProperty(e_val_str);
        let options_html = '';
        for (const [value, name] of Object.entries(materials)) { options_html += `<option value="${value}" ${e_val_str === value ? 'selected' : ''}>${name}</option>`; }
        options_html += `<option value="custom" ${!isPresetMaterial ? 'selected' : ''}>任意入力</option>`;
        const selectId = `${idPrefix}-select`, inputId = `${idPrefix}-input`;
        
        // HTMLを生成
        const html = `<div style="display: flex; flex-direction: column; gap: 2px;">
            <select id="${selectId}">
                ${options_html}
            </select>
            <input id="${inputId}" type="number" value="${currentE}" title="弾性係数 E (N/mm²)" style="display: inline-block;" ${!isPresetMaterial ? '' : 'readonly'}>
        </div>`;
        
        // イベントリスナーを後で設定するために、setTimeout を使用
        setTimeout(() => {
            const select = document.getElementById(selectId);
            const input = document.getElementById(inputId);
            if (select && input) {
                select.addEventListener('change', function() {
                    if (this.value !== 'custom') {
                        input.value = this.value;
                    }
                    input.readOnly = (this.value !== 'custom');
                    input.dispatchEvent(new Event('change'));
                    
                    // 木材が選択された場合、基準強度変更時に弾性係数を更新するイベントリスナーを設定
                    if (this.value === '8000') {
                        setTimeout(() => {
                            const strengthContainer = this.closest('tr')?.cells[4]?.firstElementChild || 
                                                   document.querySelector('[data-strength-type="wood-type"]');
                            if (strengthContainer) {
                                const strengthSelect = strengthContainer.querySelector('select');
                                if (strengthSelect) {
                                    const updateElasticModulus = () => {
                                        const woodType = strengthSelect.value;
                                        const woodElasticModuli = {
                                            'Akamatsu_Group': 8000, 'Kuromatsu_Group': 8000, 'Beimatsu_Group': 8000,
                                            'Karamatsu_Group': 9000, 'Hiba_Group': 9000, 'Hinoki_Group': 9000, 'Beihi_Group': 9000,
                                            'Tuga_Group': 8000, 'Beituga_Group': 8000,
                                            'Momi_Group': 7000, 'Ezomatsu_Group': 7000, 'Todomatsu_Group': 7000, 'Benimatsu_Group': 7000, 
                                            'Sugi_Group': 7000, 'Beisugi_Group': 7000, 'Spruce_Group': 7000,
                                            'Kashi_Group': 10000,
                                            'Kuri_Group': 8000, 'Nara_Group': 8000, 'Buna_Group': 8000, 'Keyaki_Group': 8000
                                        };
                                        if (woodElasticModuli[woodType]) {
                                            input.value = woodElasticModuli[woodType];
                                            input.dispatchEvent(new Event('change'));
                                        }
                                    };
                                    
                                    strengthSelect.removeEventListener('change', updateElasticModulus);
                                    strengthSelect.addEventListener('change', updateElasticModulus);
                                    updateElasticModulus(); // 初期値を設定
                                }
                            }
                        }, 100);
                    }
                });
            }
        }, 10);
        
        return html;
    };
    // 3Dビューから使用するためグローバルに公開
    window.createEInputHTML = createEInputHTML;

    const createStrengthInputHTML = (materialType, idPrefix, currentValue) => {
        const wrapper = document.createElement('div');
        let htmlContent = '';
        const selectId = `${idPrefix}-select`;
        const inputId = `${idPrefix}-input`;

        switch(materialType) {
            case 'steel': {
                const materials = { "235": "SS400, SN400B", "295": "SM490", "325": "SN490B", "355": "SM520" };
                const f_val_str = currentValue || '235';
                let isPreset = materials.hasOwnProperty(f_val_str);
                let options_html = '';
                for (const [value, name] of Object.entries(materials)) { 
                    options_html += `<option value="${value}" ${f_val_str === value ? 'selected' : ''}>${name} (F=${value})</option>`; 
                }
                options_html += `<option value="custom" ${!isPreset ? 'selected' : ''}>任意入力</option>`;
                
                const select = document.createElement('select');
                select.id = selectId;
                select.innerHTML = options_html;
                
                const input = document.createElement('input');
                input.id = inputId;
                input.type = 'number';
                input.value = f_val_str;
                input.readOnly = isPreset;
                
                const div = document.createElement('div');
                div.setAttribute('data-strength-type', 'F-value');
                div.appendChild(select);
                div.appendChild(input);
                
                select.addEventListener('change', function() {
                    input.value = this.value !== 'custom' ? this.value : input.value;
                    input.readOnly = this.value !== 'custom';
                });
                
                return div;
            }
            case 'wood': {
                const wood_val_str = currentValue ? (typeof currentValue === 'object' ? 'custom' : currentValue) : 'Sugi_Group';
                const isCustom = wood_val_str === 'custom';

                const baseStresses = isCustom
                    ? (currentValue.baseStrengths || WOOD_BASE_STRENGTH_DATA['Sugi_Group'])
                    : WOOD_BASE_STRENGTH_DATA[wood_val_str];

                const container = document.createElement('div');
                container.dataset.strengthType = 'wood-type';
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.gap = '4px';

                const select = document.createElement('select');
                select.id = `${idPrefix}-preset`;

                for (const [key, value] of Object.entries(WOOD_BASE_STRENGTH_DATA)) {
                    const option = new Option(value.name, key);
                    if (wood_val_str === key) option.selected = true;
                    select.add(option);
                }
                const customOption = new Option('任意入力 (基準強度)', 'custom');
                if (isCustom) customOption.selected = true;
                select.add(customOption);
                
                const inputsContainer = document.createElement('div');
                inputsContainer.style.display = 'grid';
                inputsContainer.style.gridTemplateColumns = 'auto 1fr';
                inputsContainer.style.gap = '2px 5px';
                inputsContainer.style.alignItems = 'center';
                inputsContainer.style.fontSize = '0.9em';

                const inputs = {};
                const stressLabels = {ft: "基準引張強度 Ft", fc: "基準圧縮強度 Fc", fb: "基準曲げ強度 Fb", fs: "基準せん断強度 Fs"};

                for (const key of ['ft', 'fc', 'fb', 'fs']) {
                    const label = document.createElement('label');
                    label.htmlFor = `${idPrefix}-${key}`;
                    label.title = stressLabels[key];
                    label.textContent = `${key} :`;
                    
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.id = `${idPrefix}-${key}`;
                    input.value = baseStresses[key].toFixed(2);
                    input.readOnly = !isCustom;
                    
                    inputs[key] = input;
                    inputsContainer.appendChild(label);
                    inputsContainer.appendChild(input);
                }

                select.onchange = () => {
                    const isCustomSelection = select.value === 'custom';
                    if (isCustomSelection) {
                        Object.values(inputs).forEach(input => { input.readOnly = false; });
                    } else {
                        const selectedBaseStresses = WOOD_BASE_STRENGTH_DATA[select.value];
                        inputs.ft.value = selectedBaseStresses.ft.toFixed(2);
                        inputs.fc.value = selectedBaseStresses.fc.toFixed(2);
                        inputs.fb.value = selectedBaseStresses.fb.toFixed(2);
                        inputs.fs.value = selectedBaseStresses.fs.toFixed(2);
                        Object.values(inputs).forEach(input => { input.readOnly = true; });
                    }
                };

                container.appendChild(select);
                container.appendChild(inputsContainer);
                return container;
            }
            case 'stainless': {
                const stainValue = currentValue || '205';
                const isPreset = ['205', '235'].includes(stainValue);
                htmlContent = `<div data-strength-type="F-stainless"><select id="${selectId}" onchange="const input = document.getElementById('${inputId}'); input.value = this.value; input.readOnly = (this.value !== 'custom');"><option value="205" ${stainValue === '205' ? 'selected' : ''}>SUS304</option><option value="235" ${stainValue === '235' ? 'selected' : ''}>SUS316</option><option value="custom" ${!isPreset ? 'selected' : ''}>任意入力</option></select><input id="${inputId}" type="number" value="${stainValue}" ${isPreset ? 'readonly' : ''}></div>`;
                wrapper.innerHTML = htmlContent;
                return wrapper.firstElementChild;
            }
            case 'aluminum': {
                const alumValue = currentValue || '150';
                const isPreset = ['150', '185'].includes(alumValue);
                htmlContent = `<div data-strength-type="F-aluminum"><select id="${selectId}" onchange="const input = document.getElementById('${inputId}'); input.value = this.value; input.readOnly = (this.value !== 'custom');"><option value="150" ${alumValue === '150' ? 'selected' : ''}>A5052</option><option value="185" ${alumValue === '185' ? 'selected' : ''}>A6061-T6</option><option value="custom" ${!isPreset ? 'selected' : ''}>任意入力</option></select><input id="${inputId}" type="number" value="${alumValue}" ${isPreset ? 'readonly' : ''}></div>`;
                wrapper.innerHTML = htmlContent;
                return wrapper.firstElementChild;
            }
            default: 
                htmlContent = '<div>-</div>';
                wrapper.innerHTML = htmlContent;
                return wrapper.firstElementChild;
        }
    };
    // 3Dビューから使用するためグローバルに公開
    window.createStrengthInputHTML = createStrengthInputHTML;

    // 密度入力HTML作成関数
    const createDensityInputHTML = (idPrefix, currentDensity = 7850) => {
        const inputId = `${idPrefix}-input`;
        const selectId = `${idPrefix}-select`;
        
        // 材料別の標準密度オプション
        const densityOptions = {
            "7850": "スチール",
            "7900": "ステンレス",
            "2700": "アルミニウム",
            "400": "軟材（杉等）",
            "500": "中硬材（松等）",
            "550": "やや硬材（檜等）",
            "800": "硬材（樫）"
        };
        
        const density_val_str = currentDensity.toString();
        const isPreset = densityOptions.hasOwnProperty(density_val_str);
        
        let options_html = '';
        for (const [value, name] of Object.entries(densityOptions)) {
            options_html += `<option value="${value}" ${density_val_str === value ? 'selected' : ''}>${name} (${value})</option>`;
        }
        options_html += `<option value="custom" ${!isPreset ? 'selected' : ''}>任意入力</option>`;
        
        const html = `<div style="display: flex; flex-direction: column; gap: 2px;">
            <select id="${selectId}">
                ${options_html}
            </select>
            <input id="${inputId}" type="number" value="${currentDensity}" title="密度 ρ (kg/m³)" min="0" ${isPreset ? 'readonly' : ''}>
            <span class="self-weight-display" style="font-size: 0.85em; color: #666; font-style: italic;">-</span>
        </div>`;
        
        // イベントリスナーを後で設定
        setTimeout(() => {
            const select = document.getElementById(selectId);
            const input = document.getElementById(inputId);
            if (select && input) {
                select.addEventListener('change', function() {
                    if (this.value !== 'custom') {
                        input.value = this.value;
                        input.readOnly = true;
                    } else {
                        input.readOnly = false;
                    }
                });
            }
        }, 10);

        return html;
    };
    // 3Dビューから使用するためグローバルに公開
    window.createDensityInputHTML = createDensityInputHTML;

    const memberRowHTML = (i, j, E = '205000', F='235', Iz = 1.84e-5, Iy = 6.13e-6, J = 2.35e-6, Iw = '', A = 2.34e-3, Zz = 1.23e-3, Zy = 4.10e-4, i_conn = 'rigid', j_conn = 'rigid', sectionName = '', sectionAxis = '', bucklingK = '') => {
        const baseColumns = [
            `<input type="number" value="${i}">`,
            `<input type="number" value="${j}">`,
            createEInputHTML(`member-e-${i}-${j}`, E),
            createStrengthInputHTML('steel', `member-strength-${i}-${j}`, F),
            `<input type="number" value="${(Iz * 1e8).toFixed(2)}" title="強軸断面二次モーメント Iz (cm⁴)">`,
            `<input type="number" value="${(Iy * 1e8).toFixed(2)}" title="弱軸断面二次モーメント Iy (cm⁴)">`,
            `<input type="number" value="${(J * 1e8).toFixed(2)}" title="ねじり定数 J (cm⁴)">`,
            `<input type="number" value="${(Iw === '' || Iw === undefined || Iw === null) ? '' : (Number(Iw) * 1e12).toFixed(2)}" title="曲げねじり定数 Iw (cm⁶)">`,
            `<input type="number" value="${(A * 1e4).toFixed(2)}" title="断面積 A (cm²)">`,
            `<input type="number" value="${(Zz * 1e6).toFixed(2)}" title="強軸断面係数 Zz (cm³)">`,
            `<input type="number" value="${(Zy * 1e6).toFixed(2)}" title="弱軸断面係数 Zy (cm³)">`
        ];

        // バネ入力部分のHTMLテンプレート生成関数（2Dと同様のDOM）
        const createSpringInputs = (defaultVisible = false) => `
        <div class="spring-inputs" style="display:${defaultVisible ? '' : 'none'}; margin-top:4px; padding:6px 4px; background-color:#f8f9fa; border:1px solid #e9ecef; border-radius:4px; text-align:left; width: 100%; box-sizing: border-box;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div style="display:flex; flex-direction:column; line-height:1;">
                    <span style="font-size:10px; font-weight:bold; color:#555;">Kx</span>
                    <span style="font-size:9px; color:#888; transform:scale(0.9); transform-origin:left top;">(kN/mm)</span>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    <input class="spring-kx" type="number" min="0" step="0.01" value="0" style="width:45px; padding:1px; font-size:10px; border:1px solid #ccc; border-radius:2px;">
                    <label style="font-size:10px; display:flex; align-items:center; cursor:pointer; margin:0;">
                        <input type="checkbox" class="spring-rigid-kx" style="margin:0 4px 0 0; vertical-align:middle;" onchange="this.closest('.spring-inputs').querySelector('.spring-kx').disabled = this.checked">剛
                    </label>
                </div>
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div style="display:flex; flex-direction:column; line-height:1;">
                    <span style="font-size:10px; font-weight:bold; color:#555;">Ky</span>
                    <span style="font-size:9px; color:#888; transform:scale(0.9); transform-origin:left top;">(kN/mm)</span>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    <input class="spring-ky" type="number" min="0" step="0.01" value="0" style="width:45px; padding:1px; font-size:10px; border:1px solid #ccc; border-radius:2px;">
                    <label style="font-size:10px; display:flex; align-items:center; cursor:pointer; margin:0;">
                        <input type="checkbox" class="spring-rigid-ky" style="margin:0 4px 0 0; vertical-align:middle;" onchange="this.closest('.spring-inputs').querySelector('.spring-ky').disabled = this.checked">剛
                    </label>
                </div>
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; flex-direction:column; line-height:1;">
                    <span style="font-size:10px; font-weight:bold; color:#555;">Kr</span>
                    <span style="font-size:8px; color:#888; transform:scale(0.85); transform-origin:left top;">(kN·mm/rad)</span>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    <input class="spring-kr" type="number" min="0" step="0.01" value="0" style="width:45px; padding:1px; font-size:10px; border:1px solid #ccc; border-radius:2px;">
                    <label style="font-size:10px; display:flex; align-items:center; cursor:pointer; margin:0;">
                        <input type="checkbox" class="spring-rigid-kr" style="margin:0 4px 0 0; vertical-align:middle;" onchange="this.closest('.spring-inputs').querySelector('.spring-kr').disabled = this.checked">剛
                    </label>
                </div>
            </div>
        </div>
        `;

        // 自重考慮チェックボックスがオンの場合、密度列を追加
        // プリセット読み込み中は密度列の表示状態に関係なく追加しない
        const shouldAddDensity = !window.isLoadingPreset &&
                                elements.considerSelfWeightCheckbox &&
                                elements.considerSelfWeightCheckbox.checked;

        if (shouldAddDensity) {
            const density = MATERIAL_DENSITY_DATA[E] || MATERIAL_DENSITY_DATA['custom'];
            baseColumns.push(createDensityInputHTML(`member-density-${i}-${j}`, density));
        }

        // 座屈係数K入力セル（空欄=自動）
        baseColumns.push(`
            <div class="cell-input-wrapper">
                <input type="number" class="buckling-k-input col-buckling" value="${bucklingK ?? ''}" step="0.1" min="0.1" max="10.0" placeholder="自動" style="width:50px;" title="空欄の場合は接合条件から自動判定">
            </div>
        `);

        // 断面名称と軸方向の列を追加
        baseColumns.push(`<span class="section-name-cell">${sectionName || '-'}</span>`);
        baseColumns.push(`<span class="section-axis-cell">${sectionAxis || '-'}</span>`);

        // 接続条件列を追加（2Dと同様: バネ入力を内包）
        baseColumns.push(`
            <div class="conn-cell">
                <select class="conn-select member-conn-select member-conn-select-i" data-conn="i">
                    <option value="rigid" ${i_conn === 'rigid' ? 'selected' : ''}>剛</option>
                    <option value="pinned" ${(i_conn === 'pinned' || i_conn === 'pin' || i_conn === 'p') ? 'selected' : ''}>ピン</option>
                    <option value="spring" ${i_conn === 'spring' ? 'selected' : ''}>バネ</option>
                </select>
                ${createSpringInputs(i_conn === 'spring')}
            </div>
        `);
        baseColumns.push(`
            <div class="conn-cell">
                <select class="conn-select member-conn-select member-conn-select-j" data-conn="j">
                    <option value="rigid" ${j_conn === 'rigid' ? 'selected' : ''}>剛</option>
                    <option value="pinned" ${(j_conn === 'pinned' || j_conn === 'pin' || j_conn === 'p') ? 'selected' : ''}>ピン</option>
                    <option value="spring" ${j_conn === 'spring' ? 'selected' : ''}>バネ</option>
                </select>
                ${createSpringInputs(j_conn === 'spring')}
            </div>
        `);

        return baseColumns;
    };
    
const p_truss = {
    ic: 'p',
    jc: 'p',
    E: UNIT_CONVERSION.E_STEEL,
    I: 1e-7, // 表示時に0にならないダミー値
    Z: 1e-6, // 表示時に0にならないダミー値
};

const STRONG_AXIS_INFO = Object.freeze({ key: 'x', mode: 'strong', label: '強軸 (X軸)' });

const H_SECTION_TYPE_TABLE = Object.freeze([
    { key: 'hkatakou_hiro', label: 'H形鋼（広幅）', minRatio: 0.85 },
    { key: 'hkatakou_naka', label: 'H形鋼（中幅）', minRatio: 0.65 },
    { key: 'hkatakou_hoso', label: 'H形鋼（細幅）', minRatio: 0 }
]);

const PRESET_SECTION_IMAGE_URLS = {
    hkatakou_hoso: 'https://arkhitek.co.jp/wp-content/uploads/2025/09/H形鋼.png',
    hkatakou_hiro: 'https://arkhitek.co.jp/wp-content/uploads/2025/09/H形鋼.png',
    hkatakou_naka: 'https://arkhitek.co.jp/wp-content/uploads/2025/09/H形鋼.png'
};

const cloneDeep = (value) => (value === undefined || value === null) ? value : JSON.parse(JSON.stringify(value));

const approxEqual = (a, b) => {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    const tolerance = Math.max(1e-9, Math.abs(a) * 1e-4);
    return Math.abs(a - b) <= tolerance;
};

const formatDimensionValue = (value) => {
    if (typeof value !== 'number' || !isFinite(value)) return value;
    return Math.abs(value - Math.round(value)) < 1e-6 ? Math.round(value) : Number(value.toFixed(2));
};

const buildSectionDiagramData = (typeKey, rawDims = {}, options = {}) => {
    const {
        labelScaleMultiplier = 1,
        showDimensions = true  // 寸法線と寸法値の表示/非表示を制御
    } = options || {};

    const numericDims = Object.fromEntries(
        Object.entries(rawDims).map(([key, value]) => {
            const num = Number(value);
            return [key, Number.isFinite(num) ? num : null];
        })
    );

    const sanitize = (value) => (Number.isFinite(value) && value > 0 ? value : null);

    const formatPrimaryDimension = (value) => {
        if (!Number.isFinite(value)) return '';
        return Math.round(value).toString();
    };

    const formatThicknessDimension = (value) => {
        if (!Number.isFinite(value)) return '';
        return (Math.round(value * 10) / 10).toFixed(1);
    };

    const buildLabelLines = (lines) => {
        if (!Array.isArray(lines)) return [];
        return lines
            .map((line) => (line === null || line === undefined ? '' : String(line).trim()))
            .filter((line) => line.length > 0);
    };

    const mmLabel = (symbol, value) => {
        const formatted = formatPrimaryDimension(value);
        if (symbol === 'B') {
            const singleLine = formatted ? `${symbol} = ${formatted} mm` : `${symbol} = ―`;
            return buildLabelLines([singleLine]);
        }
        return buildLabelLines([`${symbol} =`, formatted ? `${formatted} mm` : '―']);
    };

    const thicknessLabel = (symbol, value) => {
        const formatted = formatThicknessDimension(value);
        return buildLabelLines([`${symbol} =`, formatted ? `${formatted} mm` : '―']);
    };

    const phiLabel = (value) => {
        const formatted = formatPrimaryDimension(value);
        return buildLabelLines([formatted ? `φ ${formatted} mm` : 'φ ―']);
    };

    const createHelpers = (maxDim, fontSize) => {
        const baseGap = Math.max(maxDim * 0.12, fontSize * 0.85, 18);
        const smallGap = Math.max(maxDim * 0.08, fontSize * 0.7, 14);
        const lineHeight = fontSize * 1.2;

        const normalizeLabelLines = (label) => {
            if (Array.isArray(label)) {
                const cleaned = label.filter((line) => line !== null && line !== undefined && String(line).trim().length > 0).map(String);
                return cleaned.length > 0 ? cleaned : ['―'];
            }
            if (label && typeof label === 'object' && Array.isArray(label.lines)) {
                const cleaned = label.lines.filter((line) => line !== null && line !== undefined && String(line).trim().length > 0).map(String);
                return cleaned.length > 0 ? cleaned : ['―'];
            }
            if (label === null || label === undefined) return ['―'];
            const value = String(label).trim();
            return value.length > 0 ? [value] : ['―'];
        };

        const buildLabelMarkup = (lines, x) => {
            if (!Array.isArray(lines) || lines.length === 0) return '';
            const totalHeight = lineHeight * Math.max(0, lines.length - 1);
            const firstDy = lines.length === 1 ? 0 : -(totalHeight / 2);

            return lines
                .map((line, index) => {
                    const dyValue = index === 0 ? firstDy : lineHeight;
                    const dyAttr = index === 0 && lines.length === 1 ? '' : ` dy="${dyValue.toFixed(2)}px"`;
                    return `<tspan x="${x}"${dyAttr}>${line}</tspan>`;
                })
                .join('');
        };

        const adjustGapForLines = (gap, lineCount) => {
            if (!Number.isFinite(gap) || lineCount <= 1) return gap;
            const extra = lineHeight * (lineCount - 1) * 0.65;
            return gap + extra;
        };

        const horizontalDim = (x1, x2, y, label, { position = 'below', gap = baseGap, anchor = 'middle', extraClass = '' } = {}) => {
            const textX = anchor === 'start' ? x1 : anchor === 'end' ? x2 : (x1 + x2) / 2;
            const lines = normalizeLabelLines(label);
            const lineCount = lines.length;
            const adjustedGap = adjustGapForLines(gap, lineCount);
            const textY = position === 'below' ? y + adjustedGap : y - adjustedGap;
            const markup = buildLabelMarkup(lines, textX);
            return `
                <g class="dimension horizontal ${extraClass}">
                    <line class="dim-line" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" />
                    <text class="dim-label" x="${textX}" y="${textY}" text-anchor="${anchor}" dominant-baseline="middle">${markup}</text>
                </g>
            `;
        };

        const verticalDim = (x, y1, y2, label, { side = 'left', gap = baseGap, extraClass = '' } = {}) => {
            const textAnchor = side === 'right' ? 'start' : 'end';
            const textY = (y1 + y2) / 2;
            const lines = normalizeLabelLines(label);
            const lineCount = lines.length;
            const adjustedGap = adjustGapForLines(gap, lineCount);
            const finalX = side === 'right' ? x + adjustedGap : x - adjustedGap;
            const markup = buildLabelMarkup(lines, finalX);
            return `
                <g class="dimension vertical ${extraClass}">
                    <line class="dim-line" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" />
                    <text class="dim-label" x="${finalX}" y="${textY}" text-anchor="${textAnchor}" dominant-baseline="middle">${markup}</text>
                </g>
            `;
        };

        return { horizontalDim, verticalDim, baseGap, smallGap };
    };

    const calculateLabelOptions = (maxDim, scale = 1) => {
        const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

        if (!Number.isFinite(maxDim) || maxDim <= 0) {
            const baseFontSize = 28;
            const fontSize = baseFontSize * safeScale;
            return {
                fontSize,
                baseFontSize,
                scale: safeScale,
                labelStrokeWidth: 0.6 * Math.max(1, safeScale)
            };
        }

        const baseFontSize = Math.max(24, Math.min(56, maxDim * 0.18));
        const fontSize = baseFontSize * safeScale;
        const labelStrokeWidth = (fontSize >= 42 ? 0.8 : 0.6) * Math.max(1, safeScale * 0.9);
        return { fontSize, baseFontSize, scale: safeScale, labelStrokeWidth };
    };

    const calculateDiagramMargin = (maxDim, labelOptions = {}) => {
        let options = labelOptions;
        if (typeof labelOptions === 'number') {
            options = { fontSize: labelOptions, baseFontSize: labelOptions, scale: 1 };
        } else if (!labelOptions || typeof labelOptions !== 'object') {
            options = {};
        }

        const { fontSize, baseFontSize, scale = 1 } = options;
        const safeFont = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 32;
        const safeBase = Number.isFinite(baseFontSize) && baseFontSize > 0 ? baseFontSize : safeFont;
        const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
        const scaleFactor = Math.pow(safeScale, 0.65);

        if (!Number.isFinite(maxDim) || maxDim <= 0) {
            const fallbackGap = Math.max(safeBase * 0.9, 24);
            const baseMargin = Math.max(72, safeBase * 3.2, fallbackGap * 2.8);
            return baseMargin / scaleFactor;
        }

        const gapEstimate = Math.max(maxDim * 0.12, safeBase * 0.9, 20);
        const sideGapEstimate = Math.max(maxDim * 0.16, safeBase * 1.1, 24);
        const baseMargin = Math.max(maxDim * 0.52, 60);
        const fontMargin = safeFont * 3.2;
        const rawMargin = Math.max(baseMargin, fontMargin, gapEstimate * 3, sideGapEstimate * 2.4);
        return rawMargin / scaleFactor;
    };

    const wrapSvg = (viewBox, bodyMarkup, dimensionMarkup = '', thicknessMarkup = '', { fontSize = 18, labelStrokeWidth = 0.6 } = {}) => {
        const style = `
            .section-body {
                fill: #3b82f6;
                stroke: #1d4ed8;
                stroke-width: 1.4;
                stroke-linejoin: round;
            }
            .section-body * {
                fill: inherit;
                stroke: inherit;
            }
            .section-body .void {
                fill: #ffffff;
            }
            .dimension .dim-line {
                stroke: #0f172a;
                stroke-width: 1.2;
                fill: none;
                vector-effect: non-scaling-stroke;
            }
            .dimension .dim-label {
                font-family: 'Segoe UI', 'Hiragino Sans', sans-serif;
                font-weight: 600;
                font-size: ${fontSize}px;
                fill: #0f172a;
                stroke: #ffffff;
                stroke-width: ${labelStrokeWidth};
                paint-order: stroke fill;
            }
            .dimension.thickness .dim-line {
                stroke: #1e3a8a;
            }
            .dimension.thickness .dim-label {
                fill: #1e3a8a;
            }
        `;

        const defs = `
            <defs>
                <style>${style}</style>
            </defs>
        `;

        // showDimensionsがfalseの場合は寸法線を非表示
        const finalDimensionMarkup = showDimensions ? dimensionMarkup : '';
        const finalThicknessMarkup = showDimensions ? thicknessMarkup : '';

        return {
            viewBox,
            markup: `${defs}<g class="section-body">${bodyMarkup}</g><g class="dim-layer">${finalDimensionMarkup}</g><g class="dim-layer thickness">${finalThicknessMarkup}</g>`
        };
    };

    const renderHSection = (dims, { includeLip = false } = {}) => {
        const H = sanitize(dims.H);
        const B = sanitize(dims.B);
        const web = sanitize(dims.t1);
        const flange = sanitize(dims.t2);
        const lip = includeLip ? sanitize(dims.C) : null;

        if (!H || !B || !web || !flange) return null;

        const width = B;
        const height = H;
        const maxDim = Math.max(width, height);
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap, smallGap } = createHelpers(maxDim, labelOptions.fontSize);

        const shapes = [
            `<rect x="${-web / 2}" y="${-height / 2}" width="${web}" height="${height}" />`,
            `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${flange}" />`,
            `<rect x="${-width / 2}" y="${height / 2 - flange}" width="${width}" height="${flange}" />`
        ];

        if (includeLip && lip && lip > flange / 1.5) {
            const lipHeight = Math.min(lip, height / 2);
            shapes.push(`<rect x="${-width / 2}" y="${-height / 2}" width="${flange}" height="${lipHeight}" />`);
            shapes.push(`<rect x="${width / 2 - flange}" y="${-height / 2}" width="${flange}" height="${lipHeight}" />`);
            shapes.push(`<rect x="${-width / 2}" y="${height / 2 - lipHeight}" width="${flange}" height="${lipHeight}" />`);
            shapes.push(`<rect x="${width / 2 - flange}" y="${height / 2 - lipHeight}" width="${flange}" height="${lipHeight}" />`);
        }

        const dimensions = [
            verticalDim(-width / 2 - margin * 0.55, -height / 2, height / 2, mmLabel('H', H), { side: 'left', gap: baseGap }),
            horizontalDim(-width / 2, width / 2, height / 2 + margin * 0.55, mmLabel('B', B), { position: 'below', gap: baseGap })
        ].join('');

        const thickness = [
            horizontalDim(-web / 2, web / 2, -height / 2 - margin * 0.35, thicknessLabel('t₁', web), { position: 'above', gap: smallGap }),
            verticalDim(width / 2 + margin * 0.45, -height / 2, -height / 2 + flange, thicknessLabel('t₂', flange), { side: 'right', gap: baseGap })
        ];

        if (includeLip && lip) {
            thickness.push(
                verticalDim(width / 2 + margin * 0.7, -height / 2, -height / 2 + lip, thicknessLabel('C', lip), { side: 'right', gap: baseGap * 0.8 })
            );
        }

        return wrapSvg(viewBox, shapes.join(''), dimensions, thickness.join(''), labelOptions);
    };

    const renderChannelSection = (dims) => {
        const H = sanitize(dims.H);
        const flangeWidth = sanitize(dims.B) || sanitize(dims.A);
        const webThickness = sanitize(dims.t1) || sanitize(dims.t);
        const flangeThickness = sanitize(dims.t2) || sanitize(dims.t);
        const lip = sanitize(dims.C);

        if (!H || !flangeWidth || !webThickness || !flangeThickness) return null;

        const width = flangeWidth;
        const height = H;
        const maxDim = Math.max(width, height);
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap, smallGap } = createHelpers(maxDim, labelOptions.fontSize);

        const webX = -width / 2;
        const shapes = [
            `<rect x="${webX}" y="${-height / 2}" width="${webThickness}" height="${height}" />`,
            `<rect x="${webX}" y="${-height / 2}" width="${width}" height="${flangeThickness}" />`,
            `<rect x="${webX}" y="${height / 2 - flangeThickness}" width="${width}" height="${flangeThickness}" />`
        ];

        if (lip && lip > flangeThickness) {
            const lipHeight = Math.min(lip, height / 2);
            shapes.push(`<rect x="${width / 2 - flangeThickness}" y="${-height / 2}" width="${flangeThickness}" height="${lipHeight}" />`);
            shapes.push(`<rect x="${width / 2 - flangeThickness}" y="${height / 2 - lipHeight}" width="${flangeThickness}" height="${lipHeight}" />`);
        }

        const dimensions = [
            verticalDim(-width / 2 - margin * 0.55, -height / 2, height / 2, mmLabel('H', H), { side: 'left', gap: baseGap }),
            horizontalDim(-width / 2, width / 2, height / 2 + margin * 0.55, mmLabel('B', flangeWidth), { position: 'below', gap: baseGap })
        ].join('');

        const thickness = [
            horizontalDim(-webThickness / 2, webThickness / 2, -height / 2 - margin * 0.3, thicknessLabel('t₁', webThickness), { position: 'above', gap: smallGap }),
            verticalDim(width / 2 + margin * 0.45, -height / 2, -height / 2 + flangeThickness, thicknessLabel('t₂', flangeThickness), { side: 'right', gap: baseGap })
        ];

        if (lip && lip > flangeThickness) {
            thickness.push(
                verticalDim(width / 2 + margin * 0.7, -height / 2, -height / 2 + lip, thicknessLabel('C', lip), { side: 'right', gap: baseGap * 0.8 })
            );
        }

        return wrapSvg(viewBox, shapes.join(''), dimensions, thickness.join(''), labelOptions);
    };

    // 軽みぞ形鋼とリップ溝形鋼用の専用描画関数（板厚 t のみ表示）
    const renderLightChannelSection = (dims) => {
        const H = sanitize(dims.H);
        const flangeWidth = sanitize(dims.B) || sanitize(dims.A);
        const t = sanitize(dims.t) || sanitize(dims.t1) || sanitize(dims.t2); // 統一された板厚 't' を使用
        const lip = sanitize(dims.C);

        if (!H || !flangeWidth || !t) return null;

        const width = flangeWidth;
        const height = H;
        const maxDim = Math.max(width, height);
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap, smallGap } = createHelpers(maxDim, labelOptions.fontSize);

        const webX = -width / 2;
        const shapes = [
            `<rect x="${webX}" y="${-height / 2}" width="${t}" height="${height}" />`, // webThickness -> t
            `<rect x="${webX}" y="${-height / 2}" width="${width}" height="${t}" />`, // flangeThickness -> t
            `<rect x="${webX}" y="${height / 2 - t}" width="${width}" height="${t}" />`  // flangeThickness -> t
        ];

        if (lip && lip > t) { // flangeThickness -> t
            const lipHeight = Math.min(lip, height / 2);
            shapes.push(`<rect x="${width / 2 - t}" y="${-height / 2}" width="${t}" height="${lipHeight}" />`); // flangeThickness -> t
            shapes.push(`<rect x="${width / 2 - t}" y="${height / 2 - lipHeight}" width="${t}" height="${lipHeight}" />`); // flangeThickness -> t
        }

        const dimensions = [
            verticalDim(-width / 2 - margin * 0.55, -height / 2, height / 2, mmLabel('H', H), { side: 'left', gap: baseGap }),
            horizontalDim(-width / 2, width / 2, height / 2 + margin * 0.55, mmLabel('B', flangeWidth), { position: 'below', gap: baseGap })
        ].join('');

        const thickness = [
            // 統一された板厚 't' のラベルを1つだけ表示
            verticalDim(width / 2 + margin * 0.45, height / 2 - t, height / 2, thicknessLabel('t', t), { side: 'right', gap: baseGap })
        ];

        if (lip && lip > t) {
            thickness.push(
                // C（リップ）の寸法表示は維持
                verticalDim(width / 2 + margin * 0.7, -height / 2, -height / 2 + lip, thicknessLabel('C', lip), { side: 'right', gap: baseGap * 0.8 })
            );
        }

        return wrapSvg(viewBox, shapes.join(''), dimensions, thickness.join(''), labelOptions);
    };

    const renderAngleSection = (dims) => {
        const A = sanitize(dims.A);
        const B = sanitize(dims.B) || A;
        const t = sanitize(dims.t);

        if (!A || !B || !t) return null;

        const width = B;
        const height = A;
        const maxDim = Math.max(width, height);
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap, smallGap } = createHelpers(maxDim, labelOptions.fontSize);

        const leftX = -width / 2;
        const rightX = width / 2;
        const topY = -height / 2;
        const bottomY = height / 2;

        const verticalLeg = `<rect x="${leftX}" y="${topY}" width="${t}" height="${height}" />`;
        const horizontalLeg = `<rect x="${leftX}" y="${bottomY - t}" width="${width}" height="${t}" />`;
        const body = `<g>${verticalLeg}${horizontalLeg}</g>`;

        const dimensions = [
            verticalDim(leftX - margin * 0.45, topY, bottomY, mmLabel('A', A), { side: 'left', gap: baseGap }),
            horizontalDim(leftX, rightX, bottomY + margin * 0.55, mmLabel('B', B), { position: 'below', gap: baseGap })
        ].join('');

        const thickness = [
            horizontalDim(leftX, leftX + t, topY - margin * 0.3, thicknessLabel('t', t), { position: 'above', gap: smallGap, anchor: 'start' })
        ];

        return wrapSvg(viewBox, body, dimensions, thickness.join(''), labelOptions);
    };

    const renderRectTube = (dims) => {
        const outerH = sanitize(dims.A) || sanitize(dims.H);
        const outerB = sanitize(dims.B) || sanitize(dims.A);
        const t = sanitize(dims.t);

        if (!outerH || !outerB || !t) return null;

        const width = outerB;
        const height = outerH;
        const maxDim = Math.max(width, height);
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap, smallGap } = createHelpers(maxDim, labelOptions.fontSize);

        const outerRect = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" />`;
        const innerRect = `<rect class="void" x="${-width / 2 + t}" y="${-height / 2 + t}" width="${width - 2 * t}" height="${height - 2 * t}" />`;
        const body = `<g>${outerRect}${innerRect}</g>`;

        const dimensions = [
            verticalDim(-width / 2 - margin * 0.45, -height / 2, height / 2, mmLabel('H', outerH), { side: 'left', gap: baseGap }),
            horizontalDim(-width / 2, width / 2, height / 2 + margin * 0.5, mmLabel('B', outerB), { position: 'below', gap: baseGap })
        ].join('');

        const thickness = [
            verticalDim(width / 2 + margin * 0.45, -height / 2, -height / 2 + t, thicknessLabel('t', t), { side: 'right', gap: smallGap })
        ].join('');

        return wrapSvg(viewBox, body, dimensions, thickness, labelOptions);
    };

    const renderPipe = (dims) => {
        const D = sanitize(dims.D);
        const t = sanitize(dims.t);

        if (!D) return null;

        const width = D;
        const height = D;
        const maxDim = D;
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap, smallGap } = createHelpers(maxDim, labelOptions.fontSize);

        const outerCircle = `<circle cx="0" cy="0" r="${D / 2}" />`;
        const innerCircle = t && t < D / 2 ? `<circle class="void" cx="0" cy="0" r="${D / 2 - t}" />` : '';
        const body = `<g>${outerCircle}${innerCircle}</g>`;

        const dimensions = horizontalDim(-D / 2, D / 2, D / 2 + margin * 0.55, phiLabel(D), { position: 'below', gap: baseGap });

        const thickness = t
            ? verticalDim(D / 2 + margin * 0.45, -D / 2, -D / 2 + t, thicknessLabel('t', t), { side: 'right', gap: smallGap })
            : '';

        return wrapSvg(viewBox, body, dimensions, thickness, labelOptions);
    };

    const renderSolidRect = (dims) => {
        const H = sanitize(dims.H);
        const B = sanitize(dims.B);

        if (!H || !B) return null;

        const width = B;
        const height = H;
        const maxDim = Math.max(width, height);
        const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
        const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-height / 2 - margin} ${width + margin * 2} ${height + margin * 2}`;
        const { horizontalDim, verticalDim, baseGap } = createHelpers(maxDim, labelOptions.fontSize);

        const body = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" />`;

        const dimensions = [
            verticalDim(-width / 2 - margin * 0.5, -height / 2, height / 2, mmLabel('H', H), { side: 'left', gap: baseGap }),
            horizontalDim(-width / 2, width / 2, height / 2 + margin * 0.5, mmLabel('B', B), { position: 'below', gap: baseGap })
        ].join('');

        return wrapSvg(viewBox, body, dimensions, '', labelOptions);
    };

    const renderSolidCircle = (dims) => {
        const D = sanitize(dims.D);

        if (!D) return null;

        const width = D;
        const maxDim = D;
    const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
    const margin = calculateDiagramMargin(maxDim, labelOptions);
        const viewBox = `${-width / 2 - margin} ${-width / 2 - margin} ${width + margin * 2} ${width + margin * 2}`;
        const { horizontalDim, baseGap } = createHelpers(maxDim, labelOptions.fontSize);

        const body = `<circle cx="0" cy="0" r="${D / 2}" />`;
        const dimensions = horizontalDim(-D / 2, D / 2, D / 2 + margin * 0.5, phiLabel(D), { position: 'below', gap: baseGap });

        return wrapSvg(viewBox, body, dimensions, '', labelOptions);
    };

    const sectionBuilders = {
        hkatakou_hiro: (dims) => renderHSection(dims),
        hkatakou_naka: (dims) => renderHSection(dims),
        hkatakou_hoso: (dims) => renderHSection(dims),
        ikatakou: (dims) => renderHSection(dims),
        keiryouhkatakou: (dims) => renderHSection(dims),
        keiryourippuhkatakou: (dims) => renderHSection(dims, { includeLip: true }),
        mizogatakou: (dims) => renderChannelSection(dims), // みぞ形鋼は既存の関数を継続使用
        keimizogatakou: (dims) => renderLightChannelSection(dims), // 軽みぞ形鋼は専用関数使用
        rippumizokatakou: (dims) => renderLightChannelSection(dims), // リップ溝形鋼は専用関数使用
        touhenyamakatakou: (dims) => renderAngleSection(dims),
        futouhenyamagata: (dims) => renderAngleSection(dims),
        seihoukei: (dims) => renderRectTube({ ...dims, A: sanitize(dims.A), B: sanitize(dims.A), t: sanitize(dims.t) }),
        tyouhoukei: (dims) => renderRectTube(dims),
        koukan: (dims) => renderPipe(dims),
        '矩形': (dims) => renderSolidRect(dims),
        '円形': (dims) => renderSolidCircle(dims)
    };

    const builder = sectionBuilders[typeKey];
    const result = builder ? builder(numericDims) : null;

    if (result) {
        return result;
    }

    const fallbackViewBox = '-120 -80 240 160';
    const fallbackMarkup = `<g class="section-body"><rect x="-40" y="-40" width="80" height="80" /></g>`;
    return {
        viewBox: fallbackViewBox,
        markup: `
            <defs>
                <style>
                    .section-body * { fill: #94a3b8; stroke: #475569; stroke-width: 1.2; }
                </style>
            </defs>
            ${fallbackMarkup}
        `
    };
};

const generateSectionSvgMarkup = (typeKey, dims) => {
    if (!typeKey || !dims) return '';
    const diagram = buildSectionDiagramData(typeKey, dims, { labelScaleMultiplier: 0.5, showDimensions: false });
    if (!diagram || !diagram.markup) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${diagram.viewBox}" width="240" height="180" role="img" aria-label="断面図">${diagram.markup}</svg>`;
};

const deriveSectionTypeKey = (sectionInfo) => {
    if (!sectionInfo || typeof sectionInfo !== 'object') return null;
    const candidates = [
        sectionInfo.typeKey,
        sectionInfo.sectionType,
        sectionInfo.type,
        sectionInfo.profileKey,
        sectionInfo.profileType,
        sectionInfo.categoryKey
    ];
    return candidates.find(value => typeof value === 'string' && value.trim().length > 0) || null;
};

const parseDimensionValue = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const numeric = Number.parseFloat(String(value).replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
};

const deriveSectionDimensions = (sectionInfo) => {
    if (!sectionInfo || typeof sectionInfo !== 'object') return null;

    const sourceCandidates = [sectionInfo.rawDims, sectionInfo.dims, sectionInfo.dimensionsMap];
    for (const candidate of sourceCandidates) {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            return Object.fromEntries(
                Object.entries(candidate)
                    .map(([key, value]) => [key, parseDimensionValue(value)])
                    .filter(([, value]) => Number.isFinite(value) && value > 0)
            );
        }
    }

    if (Array.isArray(sectionInfo.dimensions)) {
        const fromArray = Object.fromEntries(
            sectionInfo.dimensions
                .map((dim) => {
                    if (!dim || typeof dim !== 'object') return null;
                    const key = dim.key || dim.name || dim.label;
                    const value = parseDimensionValue(dim.value);
                    if (!key || !Number.isFinite(value) || value <= 0) return null;
                    return [key, value];
                })
                .filter(Boolean)
        );
        if (Object.keys(fromArray).length > 0) return fromArray;
    }

    return null;
};

const toFiniteNumber = (value) => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const normalizeLegacyLabel = (value) => {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/[×ｘ]/g, 'x')
        .replace(/[－―–−ー]/g, '-')
        .replace(/[（）()]/g, '')
        .replace(/\s+/g, '');
};

const formatDimensionForLabel = (value) => {
    const num = toFiniteNumber(value);
    if (num === null) return '';
    const rounded = Math.round(num);
    if (Math.abs(num - rounded) < 1e-6) return String(rounded);
    return Number(num.toFixed(2)).toString();
};

const buildLegacyLabelAliases = (sectionInfo) => {
    if (!sectionInfo || typeof sectionInfo !== 'object') return [];

    const aliases = new Set();
    const pushAlias = (label) => {
        const normalized = normalizeLegacyLabel(label);
        if (normalized) aliases.add(normalized);
    };

    pushAlias(sectionInfo.label);
    if (sectionInfo.designation) {
        pushAlias(sectionInfo.designation);
        if (sectionInfo.typeLabel) {
            pushAlias(`${sectionInfo.typeLabel} ${sectionInfo.designation}`);
        }
    }

    const dims = sectionInfo.rawDims || {};
    const typeKey = sectionInfo.typeKey || '';
    const H = formatDimensionForLabel(dims.H);
    const B = formatDimensionForLabel(dims.B);
    const t1 = formatDimensionForLabel(dims.t1);
    const t2 = formatDimensionForLabel(dims.t2);
    const t = formatDimensionForLabel(dims.t);
    const D = formatDimensionForLabel(dims.D || dims.diameter);

    const addHShapeAliases = () => {
        if (H && B) {
            pushAlias(`H-${H}x${B}`);
            pushAlias(`H${H}x${B}`);
        }
        if (H && B && t1 && t2) {
            pushAlias(`H-${H}x${B}x${t1}x${t2}`);
            pushAlias(`H${H}x${B}x${t1}x${t2}`);
        }
    };

    if (typeKey.startsWith('hkatakou') || typeKey === 'ikatakou') {
        addHShapeAliases();
    } else if (typeKey === 'keiryouhkatakou' || typeKey === 'keiryourippuhkatakou') {
        addHShapeAliases();
    } else if (typeKey === 'seihoukei' || typeKey === 'tyouhoukei') {
        if (H && B) {
            pushAlias(`□-${H}x${B}`);
            pushAlias(`square-${H}x${B}`);
        }
        if (H && B && t) {
            pushAlias(`□-${H}x${B}x${t}`);
        }
    } else if (typeKey === 'koukan' || typeKey === 'pipe') {
        if (D && t) {
            pushAlias(`○-${D}x${t}`);
            pushAlias(`pipe-${D}x${t}`);
        }
        if (D) {
            pushAlias(`pipe-${D}`);
        }
    } else if (typeKey === '円形' || typeKey === 'circular' || typeKey === 'circle') {
        if (D) {
            pushAlias(`φ${D}`);
            pushAlias(`round-${D}`);
        }
    }

    if (Array.isArray(sectionInfo.legacyLabels)) {
        sectionInfo.legacyLabels.forEach(pushAlias);
    }

    return Array.from(aliases).filter(Boolean);
};

const determineHSectionTypeInfo = (H, B) => {
    if (!Number.isFinite(H) || H <= 0 || !Number.isFinite(B) || B <= 0) {
        return H_SECTION_TYPE_TABLE[H_SECTION_TYPE_TABLE.length - 1];
    }

    const ratio = B / H;
    for (const entry of H_SECTION_TYPE_TABLE) {
        if (ratio >= entry.minRatio) {
            return entry;
        }
    }

    return H_SECTION_TYPE_TABLE[H_SECTION_TYPE_TABLE.length - 1];
};

const parseLegacyHSectionLabel = (label) => {
    if (typeof label !== 'string') return null;

    const normalized = normalizeLegacyLabel(label);
    if (!normalized) return null;

    // 例:
    // - H-300x150x6.5x9
    // - H300x150x6.5x9
    // - H形鋼（細幅）300×150×6.5×9 など（日本語混在でも抽出する）
    // normalizeLegacyLabelで小文字/×→x/空白除去済み。
    const primary = normalized.match(/^h[^0-9]*-?(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))(?:x(\d+(?:\.\d+)?))(?:x(\d+(?:\.\d+)?))?$/);
    const fallback = primary ? null : normalized.match(/h[^0-9]*-?(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))(?:x(\d+(?:\.\d+)?))(?:x(\d+(?:\.\d+)?))?/);
    const match = primary || fallback;
    if (!match) return null;

    const parseValue = (token) => {
        if (token === undefined) return null;
        const parsed = Number.parseFloat(token);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const H = parseValue(match[1]);
    const B = parseValue(match[2]);
    const t1 = parseValue(match[3]);
    const t2 = parseValue(match[4]);

    if (!H || !B) return null;

    const { key: typeKey, label: typeLabel } = determineHSectionTypeInfo(H, B);

    const dims = { H, B };
    if (t1) dims.t1 = t1;
    if (t2) dims.t2 = t2;

    const designationParts = [H, B];
    if (t1) designationParts.push(t1);
    if (t2) designationParts.push(t2);

    const designation = designationParts
        .map(formatDimensionForLabel)
        .filter(Boolean)
        .join('×');

    return {
        typeKey,
        typeLabel,
        dims,
        designation,
        normalizedOriginal: normalized,
        originalLabel: label
    };
};

const createSectionInfoFromLegacyLabel = (label) => {
    const parsed = parseLegacyHSectionLabel(label);
    if (!parsed) return null;

    const { typeKey, typeLabel, dims, designation, normalizedOriginal, originalLabel } = parsed;

    const dimensionEntries = [
        { key: 'H', label: 'H', value: formatDimensionValue(dims.H) },
        { key: 'B', label: 'B', value: formatDimensionValue(dims.B) }
    ];

    if (dims.t1) {
        dimensionEntries.push({ key: 't1', label: 't₁', value: formatDimensionValue(dims.t1) });
    }
    if (dims.t2) {
        dimensionEntries.push({ key: 't2', label: 't₂', value: formatDimensionValue(dims.t2) });
    }

    const dimensionSummary = dimensionEntries.map(d => `${d.label}=${d.value}`).join(', ');

    const sectionInfo = {
        typeKey,
        typeLabel,
        designation,
        label: designation ? `${typeLabel} ${designation}` : typeLabel,
        dimensions: dimensionEntries,
        dimensionSummary,
        svgMarkup: generateSectionSvgMarkup(typeKey, dims),
        imageUrl: PRESET_SECTION_IMAGE_URLS[typeKey] || PRESET_SECTION_IMAGE_URLS.hkatakou_hiro || '',
        rawDims: { ...dims },
        source: 'legacy-label',
        axis: { ...STRONG_AXIS_INFO },
        legacyLabels: originalLabel ? [originalLabel] : []
    };

    const aliases = buildLegacyLabelAliases(sectionInfo);
    const aliasSet = new Set(aliases);
    if (normalizedOriginal) aliasSet.add(normalizedOriginal);
    sectionInfo.legacyLabels = Array.from(aliasSet);

    return ensureSectionSvgMarkup(sectionInfo);
};

const ensureSectionSvgMarkup = (sectionInfo) => {
    if (!sectionInfo || typeof sectionInfo !== 'object') return sectionInfo;
    if (sectionInfo.svgMarkup && sectionInfo.svgMarkup.includes('<svg')) return sectionInfo;

    const typeKey = deriveSectionTypeKey(sectionInfo);
    const dims = deriveSectionDimensions(sectionInfo);

    if (!typeKey || !dims) return sectionInfo;

    const diagram = buildSectionDiagramData(typeKey, dims, { labelScaleMultiplier: 0.5, showDimensions: false });
    if (diagram && diagram.markup) {
        sectionInfo.svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${diagram.viewBox}" width="240" height="180" role="img" aria-label="断面図">${diagram.markup}</svg>`;
        if (!sectionInfo.rawDims) {
            sectionInfo.rawDims = { ...dims };
        }
    }

    return sectionInfo;
};

const buildPresetSectionInfo = ({ typeKey, typeLabel, designation, dims }) => {
    const axis = { ...STRONG_AXIS_INFO };
    const dimensionEntries = [
        { key: 'H', label: 'H', value: formatDimensionValue(dims.H) },
        { key: 'B', label: 'B', value: formatDimensionValue(dims.B) },
        { key: 't1', label: 't₁', value: formatDimensionValue(dims.t1) },
        { key: 't2', label: 't₂', value: formatDimensionValue(dims.t2) }
    ];

    if (dims.r !== undefined) {
        dimensionEntries.push({ key: 'r', label: 'r', value: formatDimensionValue(dims.r) });
    }

    const dimensionSummary = dimensionEntries.map(d => `${d.label}=${d.value}`).join(', ');

    const displayLabel = designation ? `${typeLabel} ${designation}`.trim() : typeLabel;

    const sectionInfo = {
        typeKey,
        typeLabel,
        designation,
        label: displayLabel,
        dimensions: dimensionEntries,
        dimensionSummary,
        svgMarkup: generateSectionSvgMarkup(typeKey, dims),
        imageUrl: PRESET_SECTION_IMAGE_URLS[typeKey] || '',
        rawDims: { ...dims },
        source: 'library',
        axis
    };

    sectionInfo.legacyLabels = buildLegacyLabelAliases(sectionInfo);

    return ensureSectionSvgMarkup(sectionInfo);
};

const PRESET_SECTION_PROFILES = [
    {
        target: { I: 7.21e-5, A: 4.678e-3, Z: 4.81e-4 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hoso',
            typeLabel: 'H形鋼（細幅）',
            designation: '300×150',
            dims: { H: 300, B: 150, t1: 6.5, t2: 9, r: 13 }
        }),
        properties: { Zx: 481, Zy: 67.7, ix: 12.4, iy: 3.29 }
    },
    {
        target: { I: 1.10e-4, A: 5.245e-3, Z: 6.38e-4 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hoso',
            typeLabel: 'H形鋼（細幅）',
            designation: '346×174',
            dims: { H: 346, B: 174, t1: 6, t2: 9, r: 13 }
        }),
        properties: { Zx: 638, Zy: 91, ix: 14.5, iy: 3.88 }
    },
    {
        target: { I: 1.81e-5, A: 2.667e-3, Z: 1.81e-4 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hoso',
            typeLabel: 'H形鋼（細幅）',
            designation: '200×100',
            dims: { H: 200, B: 100, t1: 5.5, t2: 8, r: 8 }
        }),
        properties: { Zx: 181, Zy: 26.7, ix: 8.23, iy: 2.24 }
    },
    {
        target: { I: 3.96e-5, A: 3.697e-3, Z: 3.17e-4 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hoso',
            typeLabel: 'H形鋼（細幅）',
            designation: '250×125',
            dims: { H: 250, B: 125, t1: 6, t2: 9, r: 8 }
        }),
        properties: { Zx: 317, Zy: 47, ix: 10.4, iy: 2.82 }
    },
    {
        target: { I: 1.35e-4, A: 6.291e-3, Z: 7.71e-4 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hoso',
            typeLabel: 'H形鋼（細幅）',
            designation: '350×175',
            dims: { H: 350, B: 175, t1: 7, t2: 11, r: 13 }
        }),
        properties: { Zx: 771, Zy: 112, ix: 14.6, iy: 3.96 }
    },
    {
        target: { I: 2.35e-4, A: 8.337e-3, Z: 1.17e-3 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hoso',
            typeLabel: 'H形鋼（細幅）',
            designation: '400×200',
            dims: { H: 400, B: 200, t1: 8, t2: 13, r: 13 }
        }),
        properties: { Zx: 1170, Zy: 174, ix: 16.8, iy: 4.56 }
    },
    {
        target: { I: 3.98e-4, A: 1.719e-2, Z: 2.28e-3 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hiro',
            typeLabel: 'H形鋼（広幅）',
            designation: '350×350',
            dims: { H: 350, B: 350, t1: 12, t2: 19, r: 13 }
        }),
        properties: { Zx: 2280, Zy: 776, ix: 15.2, iy: 8.89 }
    },
    {
        target: { I: 5.61e-4, A: 1.868e-2, Z: 2.85e-3 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hiro',
            typeLabel: 'H形鋼（広幅）',
            designation: '394×398',
            dims: { H: 394, B: 398, t1: 11, t2: 18, r: 22 }
        }),
        properties: { Zx: 2850, Zy: 951, ix: 17.3, iy: 10.1 }
    },
    {
        target: { I: 6.66e-4, A: 2.187e-2, Z: 3.33e-3 },
        sectionInfo: buildPresetSectionInfo({
            typeKey: 'hkatakou_hiro',
            typeLabel: 'H形鋼（広幅）',
            designation: '400×400',
            dims: { H: 400, B: 400, t1: 13, t2: 21, r: 22 }
        }),
        properties: { Zx: 3330, Zy: 1120, ix: 17.5, iy: 10.1 }
    }
];

const findPresetSectionProfileByLabel = (label) => {
    const normalized = normalizeLegacyLabel(label);
    if (!normalized) return null;

    for (const profile of PRESET_SECTION_PROFILES) {
        const aliases = buildLegacyLabelAliases(profile.sectionInfo);
        if (aliases.includes(normalized)) {
            return profile;
        }
    }

    return null;
};

const findPresetSectionProfile = (member) => {
    if (!member || typeof member !== 'object') return null;
    const memberI = toFiniteNumber(member.I ?? member.Iz ?? member.Izz ?? member.IzStrong ?? member.IzzStrong);
    const memberA = toFiniteNumber(member.A ?? member.area ?? member.Ai);
    const memberZ = toFiniteNumber(member.Z ?? member.Zz ?? member.Zx ?? member.sectionModulus);

    const propertyMatches = PRESET_SECTION_PROFILES.filter(({ target }) => {
        const targetI = toFiniteNumber(target.I);
        const targetA = toFiniteNumber(target.A);
        const targetZ = toFiniteNumber(target.Z);

        let comparisons = 0;

        if (memberI !== null && targetI !== null) {
            comparisons++;
            if (!approxEqual(memberI, targetI)) return false;
        }

        if (memberA !== null && targetA !== null) {
            comparisons++;
            if (!approxEqual(memberA, targetA)) return false;
        }

        if (memberZ !== null && targetZ !== null) {
            comparisons++;
            if (!approxEqual(memberZ, targetZ)) return false;
        }

        return comparisons > 0;
    });

    if (propertyMatches.length === 1) {
        return propertyMatches[0];
    }

    const labelMatch = findPresetSectionProfileByLabel(
        member.sectionName || member.section || member.sectionLabel || member.sectionDesignation
    );
    if (labelMatch) {
        return labelMatch;
    }

    if (propertyMatches.length > 1) {
        return propertyMatches[0];
    }

    return null;
};

const parseSectionInfoFromMember = (member) => {
    if (!member || typeof member !== 'object') return null;

    if (member.sectionInfo && typeof member.sectionInfo === 'object' && !Array.isArray(member.sectionInfo)) {
        const info = cloneDeep(member.sectionInfo);
        return ensureSectionSvgMarkup(info);
    }

    // プリセットから直接sectionNameとaxisが指定されている場合
    if (member.sectionName && typeof member.sectionName === 'string') {
        const presetMatch = findPresetSectionProfileByLabel(member.sectionName);
        if (presetMatch) {
            return ensureSectionSvgMarkup(cloneDeep(presetMatch.sectionInfo));
        }

        const legacyInfo = createSectionInfoFromLegacyLabel(member.sectionName);
        if (legacyInfo) {
            return legacyInfo;
        }

        return {
            label: member.sectionName,
            type: 'H',  // デフォルトでH形鋼と仮定
            axis: member.axis ? { label: member.axis } : null
        };
    }

    const resolveCandidate = (raw) => {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;
        let decoded = trimmed;
        try {
            decoded = decodeURIComponent(trimmed);
        } catch (error) {
            // デコードに失敗した場合は元の文字列を使用
        }
        try {
            const parsed = JSON.parse(decoded);
            return parsed && typeof parsed === 'object' ? ensureSectionSvgMarkup(parsed) : null;
        } catch (error) {
            console.warn('Failed to parse sectionInfo from preset member definition:', error, member);
            return null;
        }
    };

    const parsedInfo = resolveCandidate(member.sectionInfo) || resolveCandidate(member.sectionInfoEncoded);
    if (parsedInfo) {
        return parsedInfo;
    }

    if (member.section) {
        const presetMatch = findPresetSectionProfileByLabel(member.section);
        if (presetMatch) {
            return ensureSectionSvgMarkup(cloneDeep(presetMatch.sectionInfo));
        }

        const legacyInfo = createSectionInfoFromLegacyLabel(member.section);
        if (legacyInfo) {
            return legacyInfo;
        }
    }

    const legacyFallback = [
        member.sectionLabel,
        member.sectionDesignation
    ].map(createSectionInfoFromLegacyLabel).find(Boolean);

    if (legacyFallback) {
        return legacyFallback;
    }

    return null;
};

// steel_data.js の window.steelData から、断面情報（typeKey + 寸法）に一致する断面定数を取得
// ※横座屈検定で必要な Iy/J/Iw を揃えるため
const lookupSteelDataPropertiesForSectionInfo = (sectionInfo) => {
    try {
        const typeKey = sectionInfo?.typeKey;
        const dims = sectionInfo?.rawDims;
        const steelData = window.steelData;
        if (!typeKey || !dims || !steelData || !steelData[typeKey]) return null;

        const category = steelData[typeKey];
        const headers = category?.headers;
        const data = category?.data;
        if (!Array.isArray(headers) || !Array.isArray(data) || data.length === 0) return null;

        const idx = (headerName) => headers.findIndex(h => String(h).trim() === headerName);
        const idxHB = idx('H×B');
        const idxA = idx('断面積(cm²)');
        const idxIx = idx('Ix(cm⁴)');
        const idxIy = idx('Iy(cm⁴)');
        const idxZx = idx('Zx(cm³)');
        const idxZy = idx('Zy(cm³)');
        const idxix = idx('ix(cm)');
        const idxiy = idx('iy(cm)');
        const idxJ = idx('J(cm⁴)');
        const idxIw = idx('Iw(cm⁶)');

        const idxT1 = idx('t1');
        const idxT2 = idx('t2');
        const idxR = idx('r');

        const H = Number(dims.H);
        const B = Number(dims.B);
        if (!isFinite(H) || !isFinite(B)) return null;
        const hbKey = `${H}×${B}`;

        const t1 = dims.t1 !== undefined ? Number(dims.t1) : null;
        const t2 = dims.t2 !== undefined ? Number(dims.t2) : null;
        const r = dims.r !== undefined ? Number(dims.r) : null;

        const approxNum = (a, b, tol = 1e-6) => {
            if (!isFinite(a) || !isFinite(b)) return false;
            return Math.abs(a - b) <= tol;
        };

        const row = data.find((row) => {
            if (!Array.isArray(row)) return false;
            if (idxHB >= 0 && String(row[idxHB]).trim() !== hbKey) return false;
            if (idxT1 >= 0 && t1 !== null && !approxNum(Number(row[idxT1]), t1, 1e-3)) return false;
            if (idxT2 >= 0 && t2 !== null && !approxNum(Number(row[idxT2]), t2, 1e-3)) return false;
            if (idxR >= 0 && r !== null && !approxNum(Number(row[idxR]), r, 1e-3)) return false;
            return true;
        });

        if (!row) return null;

        const pick = (i) => (i >= 0 ? Number(row[i]) : null);

        return {
            // 単位は steelData のまま（cm系）で返す
            A: pick(idxA),
            Ix: pick(idxIx),
            Iy: pick(idxIy),
            Zx: pick(idxZx),
            Zy: pick(idxZy),
            ix: pick(idxix),
            iy: pick(idxiy),
            J: pick(idxJ),
            Iw: pick(idxIw)
        };
    } catch (e) {
        console.warn('lookupSteelDataPropertiesForSectionInfo failed', e);
        return null;
    }
};

const safeDecodeString = (value) => {
    if (typeof value !== 'string') return value;
    if (value.length === 0) return '';
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
};

const sanitizeAxisLabel = (label) => {
    if (typeof label !== 'string') return '';
    const trimmed = label.trim();
    if (!trimmed) return '';

    const normalizedForMatch = trimmed
        .replace(/[（）\s]/g, '')
        .toLowerCase();

    const genericLabels = new Set([
        '強軸',
        '弱軸',
        '両軸',
        'strong',
        'weak',
        'both',
        'strongaxis',
        'weakaxis',
        'bothaxis'
    ]);

    if (genericLabels.has(normalizedForMatch)) {
        return '';
    }

    return trimmed;
};

const deriveAxisOrientationFromLabel = (label) => {
    if (typeof label !== 'string') return {};
    const normalized = label
        .trim()
        .replace(/[（）()\s]/g, '')
        .toLowerCase();

    const containsAny = (target, ...candidates) => candidates.some(candidate => target.includes(candidate));

    if (!normalized) return {};

    if (containsAny(normalized, '両軸', 'both', 'xy', 'x=y')) {
        return { key: 'both', mode: 'both' };
    }

    if (containsAny(normalized, '強軸', 'strong', 'x軸', 'xaxis', 'xdir')) {
        return { key: 'x', mode: 'strong' };
    }

    if (containsAny(normalized, '弱軸', 'weak', 'y軸', 'yaxis', 'ydir')) {
        return { key: 'y', mode: 'weak' };
    }

    return {};
};

const buildAxisInfo = (member, existingSectionInfo) => {
    if (!member || typeof member !== 'object') return null;

    const axisFromSection = existingSectionInfo && typeof existingSectionInfo === 'object'
        ? existingSectionInfo.axis
        : null;

    // プリセットから直接axisが指定されている場合も対応
    const rawLabelValue = typeof member.axis === 'string'
        ? member.axis
        : (typeof member.sectionAxisLabel === 'string'
            ? safeDecodeString(member.sectionAxisLabel)
            : axisFromSection?.label);

    const derivedAxisFromLabel = deriveAxisOrientationFromLabel(rawLabelValue);
    const rawKey = member.sectionAxisKey || axisFromSection?.key || derivedAxisFromLabel.key;
    const rawMode = member.sectionAxisMode || axisFromSection?.mode || derivedAxisFromLabel.mode;

    const sanitizedLabel = sanitizeAxisLabel(rawLabelValue);

    if (!(rawKey || rawMode || sanitizedLabel)) return null;

    return normalizeAxisInfo({
        key: rawKey,
        mode: rawMode,
        label: sanitizedLabel
    });
};

let presets = [
    { name: '--- 5. 3次元空間構造 (3D Space Structures) ---', disabled: true },
    // 5A-1: 3次元門形ラーメン(Y方向にも展開) - 断面性能調整済み（検定比1.8程度）
    { name: '5A-1: 3D門形ラーメン', data: {
        nodes: [
            {x:0, y:0, z:0, s:'x'},{x:0, y:6, z:0, s:'x'},{x:8, y:0, z:0, s:'x'},{x:8, y:6, z:0, s:'x'},
            {x:0, y:0, z:4, s:'f'},{x:0, y:6, z:4, s:'f'},{x:8, y:0, z:4, s:'f'},{x:8, y:6, z:4, s:'f'}
        ],
        members: [
            {i:1,j:5, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.5e-4, Iy:8.3e-5, J:3.2e-5, A:1.2e-2, Zz:1.5e-3, Zy:5.0e-4, sectionName:'H-200x200x8x12', axis:'強軸'},
            {i:2,j:6, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.5e-4, Iy:8.3e-5, J:3.2e-5, A:1.2e-2, Zz:1.5e-3, Zy:5.0e-4, sectionName:'H-200x200x8x12', axis:'強軸'},
            {i:3,j:7, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.5e-4, Iy:8.3e-5, J:3.2e-5, A:1.2e-2, Zz:1.5e-3, Zy:5.0e-4, sectionName:'H-200x200x8x12', axis:'強軸'},
            {i:4,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.5e-4, Iy:8.3e-5, J:3.2e-5, A:1.2e-2, Zz:1.5e-3, Zy:5.0e-4, sectionName:'H-200x200x8x12', axis:'強軸'},
            {i:5,j:7, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:3.0e-4, Iy:1.0e-4, J:3.8e-5, A:1.5e-2, Zz:2.0e-3, Zy:6.7e-4, sectionName:'H-250x250x9x14', axis:'強軸'},
            {i:6,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:3.0e-4, Iy:1.0e-4, J:3.8e-5, A:1.5e-2, Zz:2.0e-3, Zy:6.7e-4, sectionName:'H-250x250x9x14', axis:'強軸'},
            {i:5,j:6, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:1,j:2, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:3,j:4, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'}
        ],
        nl:[{n:5, px:10, py:8},{n:6, px:10, py:-8}], ml:[{m:5, wy:-3},{m:6, wy:-3}]
    } },

    // 5A-2: 3次元タワー構造(4本柱) - 断面性能調整済み（検定比1.9程度）
    { name: '5A-2: 3Dタワー構造', data: {
        nodes: [
            {x:0, y:0, z:0, s:'x'},{x:4, y:0, z:0, s:'x'},{x:4, y:4, z:0, s:'x'},{x:0, y:4, z:0, s:'x'},
            {x:0, y:0, z:6, s:'f'},{x:4, y:0, z:6, s:'f'},{x:4, y:4, z:6, s:'f'},{x:0, y:4, z:6, s:'f'},
            {x:0, y:0, z:12, s:'f'},{x:4, y:0, z:12, s:'f'},{x:4, y:4, z:12, s:'f'},{x:0, y:4, z:12, s:'f'}
        ],
        members: [
            {i:1,j:5, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:3.0e-4, Iy:1.0e-4, J:3.8e-5, A:1.5e-2, Zz:1.8e-3, Zy:6.0e-4, sectionName:'H-250x250x9x14', axis:'強軸'},
            {i:2,j:6, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:3.0e-4, Iy:1.0e-4, J:3.8e-5, A:1.5e-2, Zz:1.8e-3, Zy:6.0e-4, sectionName:'H-250x250x9x14', axis:'強軸'},
            {i:3,j:7, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:3.0e-4, Iy:1.0e-4, J:3.8e-5, A:1.5e-2, Zz:1.8e-3, Zy:6.0e-4, sectionName:'H-250x250x9x14', axis:'強軸'},
            {i:4,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:3.0e-4, Iy:1.0e-4, J:3.8e-5, A:1.5e-2, Zz:1.8e-3, Zy:6.0e-4, sectionName:'H-250x250x9x14', axis:'強軸'},
            {i:5,j:9, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.0e-4, Iy:6.7e-5, J:2.6e-5, A:1.0e-2, Zz:1.2e-3, Zy:4.0e-4, sectionName:'H-175x175x7.5x11', axis:'強軸'},
            {i:6,j:10, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.0e-4, Iy:6.7e-5, J:2.6e-5, A:1.0e-2, Zz:1.2e-3, Zy:4.0e-4, sectionName:'H-175x175x7.5x11', axis:'強軸'},
            {i:7,j:11, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.0e-4, Iy:6.7e-5, J:2.6e-5, A:1.0e-2, Zz:1.2e-3, Zy:4.0e-4, sectionName:'H-175x175x7.5x11', axis:'強軸'},
            {i:8,j:12, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:2.0e-4, Iy:6.7e-5, J:2.6e-5, A:1.0e-2, Zz:1.2e-3, Zy:4.0e-4, sectionName:'H-175x175x7.5x11', axis:'強軸'},
            {i:5,j:6, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:6,j:7, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:8,j:5, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:9,j:10, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:10,j:11, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:11,j:12, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:12,j:9, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.5e-4, Iy:5.0e-5, J:1.9e-5, A:8.0e-3, Zz:1.0e-3, Zy:3.3e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:5,j:7, ...p_truss, A:3.5e-3},{i:6,j:8, ...p_truss, A:3.5e-3},{i:9,j:11, ...p_truss, A:3.5e-3},{i:10,j:12, ...p_truss, A:3.5e-3}
        ],
        nl:[{n:9, px:8, py:4},{n:10, px:8, py:-4},{n:11, px:-8, py:-4},{n:12, px:-8, py:4}], ml:[{m:9, wy:-2},{m:10, wy:-2},{m:11, wy:-2},{m:12, wy:-2},{m:13, wy:-2},{m:14, wy:-2},{m:15, wy:-2},{m:16, wy:-2}]
    } },

    // 5A-3: 3次元グリッド構造 - 断面性能調整済み（検定比1.7程度）
    { name: '5A-3: 3Dグリッド構造', data: {
        nodes: [
            {x:0, y:0, z:0, s:'x'},{x:6, y:0, z:0, s:'x'},{x:12, y:0, z:0, s:'x'},
            {x:0, y:6, z:0, s:'x'},{x:6, y:6, z:0, s:'x'},{x:12, y:6, z:0, s:'x'},
            {x:0, y:0, z:4, s:'f'},{x:6, y:0, z:4, s:'f'},{x:12, y:0, z:4, s:'f'},
            {x:0, y:6, z:4, s:'f'},{x:6, y:6, z:4, s:'f'},{x:12, y:6, z:4, s:'f'}
        ],
        members: [
            {i:1,j:7, E:UNIT_CONVERSION.E_STEEL, I:1.5e-4, A:8.0e-3, Z:1.0e-3},{i:2,j:8, E:UNIT_CONVERSION.E_STEEL, I:1.5e-4, A:8.0e-3, Z:1.0e-3},
            {i:3,j:9, E:UNIT_CONVERSION.E_STEEL, I:1.5e-4, A:8.0e-3, Z:1.0e-3},{i:4,j:10, E:UNIT_CONVERSION.E_STEEL, I:1.5e-4, A:8.0e-3, Z:1.0e-3},
            {i:5,j:11, E:UNIT_CONVERSION.E_STEEL, I:1.5e-4, A:8.0e-3, Z:1.0e-3},{i:6,j:12, E:UNIT_CONVERSION.E_STEEL, I:1.5e-4, A:8.0e-3, Z:1.0e-3},
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:8,j:9, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},
            {i:10,j:11, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:11,j:12, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},
            {i:7,j:10, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:8,j:11, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},
            {i:9,j:12, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:1,j:2, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},
            {i:2,j:3, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:4,j:5, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},
            {i:5,j:6, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:1,j:4, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},
            {i:2,j:5, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4},{i:3,j:6, E:UNIT_CONVERSION.E_STEEL, I:1.2e-4, A:7.0e-3, Z:8.0e-4}
        ],
        nl:[], ml:[{m:7,wz:-6},{m:8,wz:-6},{m:9,wz:-6},{m:10,wz:-6}]
    } },

    // 5B-1: 3次元トラス橋梁 - 断面性能調整済み（検定比1.6程度）
    { name: '5B-1: 3Dトラス橋梁', data: {
        nodes: [
            {x:0, y:-2, z:0, s:'x'},{x:0, y:2, z:0, s:'x'},{x:6, y:-2, z:0, s:'f'},{x:6, y:2, z:0, s:'f'},
            {x:12, y:-2, z:0, s:'x'},{x:12, y:2, z:0, s:'x'},{x:0, y:-2, z:3, s:'f'},{x:0, y:2, z:3, s:'f'},
            {x:6, y:-2, z:3, s:'f'},{x:6, y:2, z:3, s:'f'},{x:12, y:-2, z:3, s:'f'},{x:12, y:2, z:3, s:'f'}
        ],
        members: [
            {i:1,j:3, ...p_truss, A:5.0e-3},{i:2,j:4, ...p_truss, A:5.0e-3},{i:3,j:5, ...p_truss, A:5.0e-3},{i:4,j:6, ...p_truss, A:5.0e-3},
            {i:7,j:9, ...p_truss, A:5.0e-3},{i:8,j:10, ...p_truss, A:5.0e-3},{i:9,j:11, ...p_truss, A:5.0e-3},{i:10,j:12, ...p_truss, A:5.0e-3},
            {i:1,j:7, ...p_truss, A:4.0e-3},{i:2,j:8, ...p_truss, A:4.0e-3},{i:3,j:9, ...p_truss, A:4.0e-3},{i:4,j:10, ...p_truss, A:4.0e-3},
            {i:5,j:11, ...p_truss, A:4.0e-3},{i:6,j:12, ...p_truss, A:4.0e-3},{i:1,j:2, ...p_truss, A:4.0e-3},{i:3,j:4, ...p_truss, A:4.0e-3},
            {i:5,j:6, ...p_truss, A:4.0e-3},{i:7,j:8, ...p_truss, A:4.0e-3},{i:9,j:10, ...p_truss, A:4.0e-3},{i:11,j:12, ...p_truss, A:4.0e-3},
            {i:1,j:9, ...p_truss, A:4.0e-3},{i:2,j:10, ...p_truss, A:4.0e-3},{i:3,j:11, ...p_truss, A:4.0e-3},{i:4,j:12, ...p_truss, A:4.0e-3},
            {i:7,j:3, ...p_truss, A:4.0e-3},{i:8,j:4, ...p_truss, A:4.0e-3},{i:9,j:5, ...p_truss, A:4.0e-3},{i:10,j:6, ...p_truss, A:4.0e-3}
        ],
        nl:[{n:9, pz:-12},{n:10, pz:-12}], ml:[]
    } },

    // 5B-2: 3次元ピラミッド構造（検定比1.5程度に調整）
    { name: '5B-2: 3Dピラミッド構造', data: {
        nodes: [
            {x:0, y:0, z:0, s:'x'},{x:8, y:0, z:0, s:'x'},{x:8, y:8, z:0, s:'x'},{x:0, y:8, z:0, s:'x'},
            {x:4, y:4, z:6, s:'f'}
        ],
        members: [
            {i:1,j:5, ...p_truss, A:5.0e-3},{i:2,j:5, ...p_truss, A:5.0e-3},{i:3,j:5, ...p_truss, A:5.0e-3},{i:4,j:5, ...p_truss, A:5.0e-3},
            {i:1,j:2, ...p_truss, A:3.5e-3},{i:2,j:3, ...p_truss, A:3.5e-3},{i:3,j:4, ...p_truss, A:3.5e-3},{i:4,j:1, ...p_truss, A:3.5e-3}
        ],
        nl:[{n:5, pz:-18}], ml:[]
    } },

    // 5C-1: 3層建築フレーム（検定比1.8程度に調整）
    { name: '5C-1: 3層建築フレーム', data: {
        nodes: [
            // 1階
            {x:0, y:0, z:0, s:'x'},{x:6, y:0, z:0, s:'x'},{x:12, y:0, z:0, s:'x'},
            {x:0, y:8, z:0, s:'x'},{x:6, y:8, z:0, s:'x'},{x:12, y:8, z:0, s:'x'},
            // 2階
            {x:0, y:0, z:4, s:'f'},{x:6, y:0, z:4, s:'f'},{x:12, y:0, z:4, s:'f'},
            {x:0, y:8, z:4, s:'f'},{x:6, y:8, z:4, s:'f'},{x:12, y:8, z:4, s:'f'},
            // 3階
            {x:0, y:0, z:8, s:'f'},{x:6, y:0, z:8, s:'f'},{x:12, y:0, z:8, s:'f'},
            {x:0, y:8, z:8, s:'f'},{x:6, y:8, z:8, s:'f'},{x:12, y:8, z:8, s:'f'},
            // 屋上
            {x:0, y:0, z:12, s:'f'},{x:6, y:0, z:12, s:'f'},{x:12, y:0, z:12, s:'f'},
            {x:0, y:8, z:12, s:'f'},{x:6, y:8, z:12, s:'f'},{x:12, y:8, z:12, s:'f'}
        ],
        members: [
            // 柱
            {i:1,j:7, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:2,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:3,j:9, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:4,j:10, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:5,j:11, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:6,j:12, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:7,j:13, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:8,j:14, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:9,j:15, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:10,j:16, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:11,j:17, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:12,j:18, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.8e-4, Iy:6.0e-5, J:2.3e-5, A:9.0e-3, Zz:1.1e-3, Zy:3.7e-4, sectionName:'H-150x150x7x10', axis:'強軸'},
            {i:13,j:19, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:14,j:20, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:15,j:21, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:16,j:22, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:17,j:23, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:18,j:24, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            // 梁(X方向)
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:8,j:9, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:10,j:11, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:11,j:12, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:13,j:14, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:14,j:15, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:16,j:17, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:17,j:18, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:19,j:20, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:20,j:21, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:22,j:23, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:23,j:24, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            // 梁(Y方向)
            {i:7,j:10, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:8,j:11, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:9,j:12, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:13,j:16, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:14,j:17, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:15,j:18, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:19,j:22, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:20,j:23, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'},
            {i:21,j:24, E:UNIT_CONVERSION.E_STEEL, F:235, Iz:1.0e-4, Iy:3.3e-5, J:1.3e-5, A:7.0e-3, Zz:6.7e-4, Zy:2.2e-4, sectionName:'H-125x125x6.5x9', axis:'強軸'}
        ],
        nl:[{n:19, px:12},{n:20, py:10},{n:23, px:-10, py:8}], ml:[{m:19, wz:-4},{m:20, wz:-4},{m:21, wz:-4},{m:22, wz:-4},{m:23, wz:-4},{m:24, wz:-4},{m:25, wz:-4},{m:26, wz:-4},{m:27, wz:-4},{m:28, wz:-4},{m:29, wz:-4},{m:30, wz:-4}]
    } },

    // 5C-2: 螺旋階段構造（検定比1.7程度に調整）
    { name: '5C-2: 螺旋階段構造', data: {
        nodes: [
            {x:4, y:0, z:0, s:'x'},{x:4, y:0, z:0.8, s:'f'},{x:2.83, y:2.83, z:1.6, s:'f'},
            {x:0, y:4, z:2.4, s:'f'},{x:-2.83, y:2.83, z:3.2, s:'f'},{x:-4, y:0, z:4, s:'f'},
            {x:-2.83, y:-2.83, z:4.8, s:'f'},{x:0, y:-4, z:5.6, s:'f'},{x:2.83, y:-2.83, z:6.4, s:'f'},
            {x:4, y:0, z:7.2, s:'f'},{x:4, y:0, z:8, s:'f'},{x:0, y:0, z:0, s:'x'},{x:0, y:0, z:8, s:'f'}
        ],
        members: [
            // 中心柱
            {i:12,j:13, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},
            // 階段部材
            {i:1,j:2, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:2,j:3, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            {i:3,j:4, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:4,j:5, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            {i:5,j:6, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:6,j:7, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:8,j:9, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            {i:9,j:10, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:10,j:11, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            // 中心への接続
            {i:12,j:1, ...p_truss, A:3.5e-3},{i:12,j:2, ...p_truss, A:3.5e-3},{i:12,j:3, ...p_truss, A:3.5e-3},
            {i:12,j:4, ...p_truss, A:3.5e-3},{i:12,j:5, ...p_truss, A:3.5e-3},{i:13,j:6, ...p_truss, A:3.5e-3},
            {i:13,j:7, ...p_truss, A:3.5e-3},{i:13,j:8, ...p_truss, A:3.5e-3},{i:13,j:9, ...p_truss, A:3.5e-3},
            {i:13,j:10, ...p_truss, A:3.5e-3},{i:13,j:11, ...p_truss, A:3.5e-3}
        ],
        nl:[{n:6, px:4, py:4},{n:11, px:-4, py:4}], ml:[]
    } },

    // 5C-3: 吊り橋構造（検定比1.9程度に調整）
    { name: '5C-3: 吊り橋構造', data: {
        nodes: [
            // 塔
            {x:0, y:-3, z:0, s:'x'},{x:0, y:3, z:0, s:'x'},{x:0, y:-3, z:15, s:'f'},{x:0, y:3, z:15, s:'f'},
            {x:24, y:-3, z:0, s:'x'},{x:24, y:3, z:0, s:'x'},{x:24, y:-3, z:15, s:'f'},{x:24, y:3, z:15, s:'f'},
            // 橋桁
            {x:0, y:0, z:3, s:'f'},{x:4, y:0, z:3, s:'f'},{x:8, y:0, z:3, s:'f'},{x:12, y:0, z:3, s:'f'},
            {x:16, y:0, z:3, s:'f'},{x:20, y:0, z:3, s:'f'},{x:24, y:0, z:3, s:'f'},
            // ケーブル接続点
            {x:0, y:0, z:12, s:'f'},{x:24, y:0, z:12, s:'f'}
        ],
        members: [
            // 塔
            {i:1,j:3, E:UNIT_CONVERSION.E_STEEL, I:2.5e-4, A:1.15e-2, Z:1.5e-3},{i:2,j:4, E:UNIT_CONVERSION.E_STEEL, I:2.5e-4, A:1.15e-2, Z:1.5e-3},
            {i:5,j:7, E:UNIT_CONVERSION.E_STEEL, I:2.5e-4, A:1.15e-2, Z:1.5e-3},{i:6,j:8, E:UNIT_CONVERSION.E_STEEL, I:2.5e-4, A:1.15e-2, Z:1.5e-3},
            {i:3,j:4, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:7,j:8, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            {i:3,j:16, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},{i:7,j:17, E:UNIT_CONVERSION.E_STEEL, I:1.0e-4, A:7.0e-3, Z:6.7e-4},
            // 橋桁
            {i:9,j:10, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},{i:10,j:11, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},
            {i:11,j:12, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},{i:12,j:13, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},
            {i:13,j:14, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},{i:14,j:15, E:UNIT_CONVERSION.E_STEEL, I:1.8e-4, A:9.0e-3, Z:1.1e-3},
            // ケーブル
            {i:16,j:9, ...p_truss, A:5.0e-3},{i:16,j:10, ...p_truss, A:5.0e-3},{i:16,j:11, ...p_truss, A:5.0e-3},
            {i:16,j:12, ...p_truss, A:5.0e-3},{i:17,j:12, ...p_truss, A:5.0e-3},{i:17,j:13, ...p_truss, A:5.0e-3},
            {i:17,j:14, ...p_truss, A:5.0e-3},{i:17,j:15, ...p_truss, A:5.0e-3},{i:16,j:17, ...p_truss, A:7.5e-3}
        ],
        nl:[{n:10, pz:-8},{n:11, pz:-10},{n:12, pz:-10},{n:13, pz:-10},{n:14, pz:-8}], ml:[]
    } },

    // 5D-1: 半球ドーム構造（検定比1.8程度に調整）
    { name: '5D-1: 半球ドーム構造', data: {
        nodes: [
            // 底部円周
            {x:8, y:0, z:0, s:'x'},{x:5.66, y:5.66, z:0, s:'x'},{x:0, y:8, z:0, s:'x'},{x:-5.66, y:5.66, z:0, s:'x'},
            {x:-8, y:0, z:0, s:'x'},{x:-5.66, y:-5.66, z:0, s:'x'},{x:0, y:-8, z:0, s:'x'},{x:5.66, y:-5.66, z:0, s:'x'},
            // 中間層
            {x:5.66, y:0, z:3, s:'f'},{x:4, y:4, z:3, s:'f'},{x:0, y:5.66, z:3, s:'f'},{x:-4, y:4, z:3, s:'f'},
            {x:-5.66, y:0, z:3, s:'f'},{x:-4, y:-4, z:3, s:'f'},{x:0, y:-5.66, z:3, s:'f'},{x:4, y:-4, z:3, s:'f'},
            // 上層
            {x:3, y:0, z:5.5, s:'f'},{x:2.12, y:2.12, z:5.5, s:'f'},{x:0, y:3, z:5.5, s:'f'},{x:-2.12, y:2.12, z:5.5, s:'f'},
            {x:-3, y:0, z:5.5, s:'f'},{x:-2.12, y:-2.12, z:5.5, s:'f'},{x:0, y:-3, z:5.5, s:'f'},{x:2.12, y:-2.12, z:5.5, s:'f'},
            // 頂点
            {x:0, y:0, z:7, s:'f'}
        ],
        members: [
            // 垂直リブ
            {i:1,j:9, ...p_truss, A:2.0e-3},{i:2,j:10, ...p_truss, A:2.0e-3},{i:3,j:11, ...p_truss, A:2.0e-3},{i:4,j:12, ...p_truss, A:2.0e-3},
            {i:5,j:13, ...p_truss, A:2.0e-3},{i:6,j:14, ...p_truss, A:2.0e-3},{i:7,j:15, ...p_truss, A:2.0e-3},{i:8,j:16, ...p_truss, A:2.0e-3},
            {i:9,j:17, ...p_truss, A:2.0e-3},{i:10,j:18, ...p_truss, A:2.0e-3},{i:11,j:19, ...p_truss, A:2.0e-3},{i:12,j:20, ...p_truss, A:2.0e-3},
            {i:13,j:21, ...p_truss, A:2.0e-3},{i:14,j:22, ...p_truss, A:2.0e-3},{i:15,j:23, ...p_truss, A:2.0e-3},{i:16,j:24, ...p_truss, A:2.0e-3},
            {i:17,j:25, ...p_truss, A:2.0e-3},{i:18,j:25, ...p_truss, A:2.0e-3},{i:19,j:25, ...p_truss, A:2.0e-3},{i:20,j:25, ...p_truss, A:2.0e-3},
            {i:21,j:25, ...p_truss, A:2.0e-3},{i:22,j:25, ...p_truss, A:2.0e-3},{i:23,j:25, ...p_truss, A:2.0e-3},{i:24,j:25, ...p_truss, A:2.0e-3},
            // 水平リング
            {i:1,j:2, ...p_truss, A:2.0e-3},{i:2,j:3, ...p_truss, A:2.0e-3},{i:3,j:4, ...p_truss, A:2.0e-3},{i:4,j:5, ...p_truss, A:2.0e-3},
            {i:5,j:6, ...p_truss, A:2.0e-3},{i:6,j:7, ...p_truss, A:2.0e-3},{i:7,j:8, ...p_truss, A:2.0e-3},{i:8,j:1, ...p_truss, A:2.0e-3},
            {i:9,j:10, ...p_truss, A:2.0e-3},{i:10,j:11, ...p_truss, A:2.0e-3},{i:11,j:12, ...p_truss, A:2.0e-3},{i:12,j:13, ...p_truss, A:2.0e-3},
            {i:13,j:14, ...p_truss, A:2.0e-3},{i:14,j:15, ...p_truss, A:2.0e-3},{i:15,j:16, ...p_truss, A:2.0e-3},{i:16,j:9, ...p_truss, A:2.0e-3},
            {i:17,j:18, ...p_truss, A:2.0e-3},{i:18,j:19, ...p_truss, A:2.0e-3},{i:19,j:20, ...p_truss, A:2.0e-3},{i:20,j:21, ...p_truss, A:2.0e-3},
            {i:21,j:22, ...p_truss, A:2.0e-3},{i:22,j:23, ...p_truss, A:2.0e-3},{i:23,j:24, ...p_truss, A:2.0e-3},{i:24,j:17, ...p_truss, A:2.0e-3}
        ],
        nl:[{n:25, pz:-40}], ml:[]
    } },

    // 5D-2: 送電鉄塔構造（検定比1.9程度に調整）
    { name: '5D-2: 送電鉄塔構造', data: {
        nodes: [
            // 底部
            {x:-4, y:-4, z:0, s:'x'},{x:4, y:-4, z:0, s:'x'},{x:4, y:4, z:0, s:'x'},{x:-4, y:4, z:0, s:'x'},
            // 第1段
            {x:-3, y:-3, z:8, s:'f'},{x:3, y:-3, z:8, s:'f'},{x:3, y:3, z:8, s:'f'},{x:-3, y:3, z:8, s:'f'},
            // 第2段
            {x:-2, y:-2, z:16, s:'f'},{x:2, y:-2, z:16, s:'f'},{x:2, y:2, z:16, s:'f'},{x:-2, y:2, z:16, s:'f'},
            // 第3段
            {x:-1, y:-1, z:24, s:'f'},{x:1, y:-1, z:24, s:'f'},{x:1, y:1, z:24, s:'f'},{x:-1, y:1, z:24, s:'f'},
            // 頂部
            {x:0, y:0, z:30, s:'f'},
            // 腕木
            {x:-8, y:0, z:22, s:'f'},{x:8, y:0, z:22, s:'f'},{x:-6, y:0, z:26, s:'f'},{x:6, y:0, z:26, s:'f'}
        ],
        members: [
            // 主柱
            {i:1,j:5, ...p_truss, A:2.5e-3},{i:2,j:6, ...p_truss, A:2.5e-3},{i:3,j:7, ...p_truss, A:2.5e-3},{i:4,j:8, ...p_truss, A:2.5e-3},
            {i:5,j:9, ...p_truss, A:2.5e-3},{i:6,j:10, ...p_truss, A:2.5e-3},{i:7,j:11, ...p_truss, A:2.5e-3},{i:8,j:12, ...p_truss, A:2.5e-3},
            {i:9,j:13, ...p_truss, A:2.0e-3},{i:10,j:14, ...p_truss, A:2.0e-3},{i:11,j:15, ...p_truss, A:2.0e-3},{i:12,j:16, ...p_truss, A:2.0e-3},
            {i:13,j:17, ...p_truss, A:2.0e-3},{i:14,j:17, ...p_truss, A:2.0e-3},{i:15,j:17, ...p_truss, A:2.0e-3},{i:16,j:17, ...p_truss, A:2.0e-3},
            // 水平ブレース
            {i:1,j:2, ...p_truss, A:2.0e-3},{i:2,j:3, ...p_truss, A:2.0e-3},{i:3,j:4, ...p_truss, A:2.0e-3},{i:4,j:1, ...p_truss, A:2.0e-3},
            {i:5,j:6, ...p_truss, A:2.0e-3},{i:6,j:7, ...p_truss, A:2.0e-3},{i:7,j:8, ...p_truss, A:2.0e-3},{i:8,j:5, ...p_truss, A:2.0e-3},
            {i:9,j:10, ...p_truss, A:2.0e-3},{i:10,j:11, ...p_truss, A:2.0e-3},{i:11,j:12, ...p_truss, A:2.0e-3},{i:12,j:9, ...p_truss, A:2.0e-3},
            {i:13,j:14, ...p_truss, A:2.0e-3},{i:14,j:15, ...p_truss, A:2.0e-3},{i:15,j:16, ...p_truss, A:2.0e-3},{i:16,j:13, ...p_truss, A:2.0e-3},
            // 対角ブレース
            {i:1,j:6, ...p_truss, A:2.0e-3},{i:2,j:7, ...p_truss, A:2.0e-3},{i:3,j:8, ...p_truss, A:2.0e-3},{i:4,j:5, ...p_truss, A:2.0e-3},
            {i:5,j:10, ...p_truss, A:2.0e-3},{i:6,j:11, ...p_truss, A:2.0e-3},{i:7,j:12, ...p_truss, A:2.0e-3},{i:8,j:9, ...p_truss, A:2.0e-3},
            {i:9,j:14, ...p_truss, A:2.0e-3},{i:10,j:15, ...p_truss, A:2.0e-3},{i:11,j:16, ...p_truss, A:2.0e-3},{i:12,j:13, ...p_truss, A:2.0e-3},
            // 腕木
            {i:13,j:18, ...p_truss, A:2.0e-3},{i:13,j:19, ...p_truss, A:2.0e-3},{i:17,j:20, ...p_truss, A:2.0e-3},{i:17,j:21, ...p_truss, A:2.0e-3},
            {i:18,j:20, ...p_truss, A:2.0e-3},{i:19,j:21, ...p_truss, A:2.0e-3}
        ],
        nl:[{n:18, px:-10, pz:-5},{n:19, px:10, pz:-5},{n:20, px:-8},{n:21, px:8}], ml:[]
    } },

    // 5E-1: 3次元アーチ橋（検定比1.7程度に調整）
    { name: '5E-1: 3次元アーチ橋', data: {
        nodes: [
            // 左アーチ
            {x:0, y:-3, z:0, s:'x'},{x:3, y:-3, z:2, s:'f'},{x:6, y:-3, z:3, s:'f'},{x:9, y:-3, z:2, s:'f'},{x:12, y:-3, z:0, s:'x'},
            // 右アーチ
            {x:0, y:3, z:0, s:'x'},{x:3, y:3, z:2, s:'f'},{x:6, y:3, z:3, s:'f'},{x:9, y:3, z:2, s:'f'},{x:12, y:3, z:0, s:'x'},
            // 橋桁
            {x:0, y:0, z:3, s:'f'},{x:3, y:0, z:3, s:'f'},{x:6, y:0, z:3, s:'f'},{x:9, y:0, z:3, s:'f'},{x:12, y:0, z:3, s:'f'}
        ],
        members: [
            // アーチ
            {i:1,j:2, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:2,j:3, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            {i:3,j:4, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:4,j:5, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            {i:6,j:7, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:7,j:8, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            {i:8,j:9, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:9,j:10, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            // 橋桁
            {i:11,j:12, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:12,j:13, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:13,j:14, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:14,j:15, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            // 吊材
            {i:2,j:12, ...p_truss, A:2.03e-3},{i:3,j:13, ...p_truss, A:2.03e-3},{i:4,j:14, ...p_truss, A:2.03e-3},
            {i:7,j:12, ...p_truss, A:2.03e-3},{i:8,j:13, ...p_truss, A:2.03e-3},{i:9,j:14, ...p_truss, A:2.03e-3},
            // 横構
            {i:2,j:7, ...p_truss, A:2.03e-3},{i:3,j:8, ...p_truss, A:2.03e-3},{i:4,j:9, ...p_truss, A:2.03e-3},
            {i:1,j:6, ...p_truss, A:2.03e-3},{i:5,j:10, ...p_truss, A:2.03e-3},{i:1,j:11, ...p_truss, A:2.03e-3},{i:5,j:15, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:12, pz:-20},{n:13, pz:-25},{n:14, pz:-20}], ml:[]
    } },

    // 5E-2: 立体トラス屋根（検定比1.6程度に調整）
    { name: '5E-2: 立体トラス屋根', data: {
        nodes: [
            // 下弦材
            {x:0, y:0, z:0, s:'x'},{x:6, y:0, z:0, s:'x'},{x:12, y:0, z:0, s:'x'},
            {x:0, y:6, z:0, s:'x'},{x:6, y:6, z:0, s:'x'},{x:12, y:6, z:0, s:'x'},
            {x:0, y:12, z:0, s:'x'},{x:6, y:12, z:0, s:'x'},{x:12, y:12, z:0, s:'x'},
            // 上弦材
            {x:0, y:0, z:3, s:'f'},{x:6, y:0, z:3, s:'f'},{x:12, y:0, z:3, s:'f'},
            {x:0, y:6, z:3, s:'f'},{x:6, y:6, z:3, s:'f'},{x:12, y:6, z:3, s:'f'},
            {x:0, y:12, z:3, s:'f'},{x:6, y:12, z:3, s:'f'},{x:12, y:12, z:3, s:'f'}
        ],
        members: [
            // 下弦材
            {i:1,j:2, ...p_truss, A:2.72e-3},{i:2,j:3, ...p_truss, A:2.72e-3},{i:4,j:5, ...p_truss, A:2.72e-3},{i:5,j:6, ...p_truss, A:2.72e-3},
            {i:7,j:8, ...p_truss, A:2.72e-3},{i:8,j:9, ...p_truss, A:2.72e-3},{i:1,j:4, ...p_truss, A:2.72e-3},{i:4,j:7, ...p_truss, A:2.72e-3},
            {i:2,j:5, ...p_truss, A:2.72e-3},{i:5,j:8, ...p_truss, A:2.72e-3},{i:3,j:6, ...p_truss, A:2.72e-3},{i:6,j:9, ...p_truss, A:2.72e-3},
            // 上弦材
            {i:10,j:11, ...p_truss, A:2.03e-3},{i:11,j:12, ...p_truss, A:2.03e-3},{i:13,j:14, ...p_truss, A:2.03e-3},{i:14,j:15, ...p_truss, A:2.03e-3},
            {i:16,j:17, ...p_truss, A:2.03e-3},{i:17,j:18, ...p_truss, A:2.03e-3},{i:10,j:13, ...p_truss, A:2.03e-3},{i:13,j:16, ...p_truss, A:2.03e-3},
            {i:11,j:14, ...p_truss, A:2.03e-3},{i:14,j:17, ...p_truss, A:2.03e-3},{i:12,j:15, ...p_truss, A:2.03e-3},{i:15,j:18, ...p_truss, A:2.03e-3},
            // 斜材
            {i:1,j:10, ...p_truss, A:2.03e-3},{i:2,j:11, ...p_truss, A:2.03e-3},{i:3,j:12, ...p_truss, A:2.03e-3},
            {i:4,j:13, ...p_truss, A:2.03e-3},{i:5,j:14, ...p_truss, A:2.03e-3},{i:6,j:15, ...p_truss, A:2.03e-3},
            {i:7,j:16, ...p_truss, A:2.03e-3},{i:8,j:17, ...p_truss, A:2.03e-3},{i:9,j:18, ...p_truss, A:2.03e-3},
            // 対角材
            {i:1,j:14, ...p_truss, A:2.03e-3},{i:2,j:13, ...p_truss, A:2.03e-3},{i:2,j:15, ...p_truss, A:2.03e-3},{i:3,j:14, ...p_truss, A:2.03e-3},
            {i:4,j:17, ...p_truss, A:2.03e-3},{i:5,j:16, ...p_truss, A:2.03e-3},{i:5,j:18, ...p_truss, A:2.03e-3},{i:6,j:17, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:14, pz:-30},{n:17, pz:-30}], ml:[]
    } },

    // 5F-1: キャンチレバー構造（検定比1.7程度に調整）
    { name: '5F-1: キャンチレバー構造', data: {
        nodes: [
            {x:0, y:-2, z:0, s:'x'},{x:0, y:2, z:0, s:'x'},{x:0, y:-2, z:6, s:'x'},{x:0, y:2, z:6, s:'x'},
            {x:4, y:-2, z:6, s:'f'},{x:4, y:2, z:6, s:'f'},{x:8, y:-2, z:6, s:'f'},{x:8, y:2, z:6, s:'f'},
            {x:12, y:-2, z:6, s:'f'},{x:12, y:2, z:6, s:'f'}
        ],
        members: [
            {i:1,j:3, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:2,j:4, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            {i:3,j:5, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:4,j:6, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:5,j:7, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:6,j:8, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:7,j:9, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:8,j:10, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:3,j:4, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:5,j:6, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:9,j:10, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:3,j:6, ...p_truss, A:2.03e-3},{i:4,j:5, ...p_truss, A:2.03e-3},{i:5,j:8, ...p_truss, A:2.03e-3},{i:6,j:7, ...p_truss, A:2.03e-3},
            {i:7,j:10, ...p_truss, A:2.03e-3},{i:8,j:9, ...p_truss, A:2.03e-3},{i:1,j:4, ...p_truss, A:2.03e-3},{i:2,j:3, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:9, pz:-25},{n:10, pz:-25}], ml:[]
    } },

    // 5F-2: 双曲放物面シェル（検定比1.8程度に調整）
    { name: '5F-2: 双曲放物面シェル', data: {
        nodes: [
            {x:0, y:0, z:0, s:'x'},{x:8, y:0, z:4, s:'x'},{x:8, y:8, z:0, s:'x'},{x:0, y:8, z:4, s:'x'},
            {x:4, y:0, z:2, s:'f'},{x:8, y:4, z:2, s:'f'},{x:4, y:8, z:2, s:'f'},{x:0, y:4, z:2, s:'f'},
            {x:2, y:2, z:1.5, s:'f'},{x:6, y:2, z:2.5, s:'f'},{x:6, y:6, z:1.5, s:'f'},{x:2, y:6, z:2.5, s:'f'},
            {x:4, y:4, z:2, s:'f'}
        ],
        members: [
            // 外周
            {i:1,j:5, ...p_truss, A:2.03e-3},{i:5,j:2, ...p_truss, A:2.03e-3},{i:2,j:6, ...p_truss, A:2.03e-3},{i:6,j:3, ...p_truss, A:2.03e-3},
            {i:3,j:7, ...p_truss, A:2.03e-3},{i:7,j:4, ...p_truss, A:2.03e-3},{i:4,j:8, ...p_truss, A:2.03e-3},{i:8,j:1, ...p_truss, A:2.03e-3},
            // 内部グリッド
            {i:5,j:9, ...p_truss, A:2.03e-3},{i:9,j:8, ...p_truss, A:2.03e-3},{i:5,j:10, ...p_truss, A:2.03e-3},{i:10,j:6, ...p_truss, A:2.03e-3},
            {i:6,j:11, ...p_truss, A:2.03e-3},{i:11,j:7, ...p_truss, A:2.03e-3},{i:7,j:12, ...p_truss, A:2.03e-3},{i:12,j:8, ...p_truss, A:2.03e-3},
            {i:9,j:10, ...p_truss, A:2.03e-3},{i:10,j:11, ...p_truss, A:2.03e-3},{i:11,j:12, ...p_truss, A:2.03e-3},{i:12,j:9, ...p_truss, A:2.03e-3},
            // 中心への接続
            {i:9,j:13, ...p_truss, A:2.03e-3},{i:10,j:13, ...p_truss, A:2.03e-3},{i:11,j:13, ...p_truss, A:2.03e-3},{i:12,j:13, ...p_truss, A:2.03e-3},
            // 対角材
            {i:1,j:13, ...p_truss, A:2.03e-3},{i:2,j:13, ...p_truss, A:2.03e-3},{i:3,j:13, ...p_truss, A:2.03e-3},{i:4,j:13, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:13, pz:-30}], ml:[]
    } },

    // 5G-1: 複合トラスブリッジ（検定比1.6程度に調整）
    { name: '5G-1: 複合トラスブリッジ', data: {
        nodes: [
            {x:0, y:-3, z:0, s:'x'},{x:0, y:3, z:0, s:'x'},{x:0, y:-3, z:4, s:'f'},{x:0, y:3, z:4, s:'f'},
            {x:5, y:-3, z:0, s:'f'},{x:5, y:3, z:0, s:'f'},{x:5, y:-3, z:4, s:'f'},{x:5, y:3, z:4, s:'f'},
            {x:10, y:-3, z:0, s:'f'},{x:10, y:3, z:0, s:'f'},{x:10, y:-3, z:4, s:'f'},{x:10, y:3, z:4, s:'f'},
            {x:15, y:-3, z:0, s:'x'},{x:15, y:3, z:0, s:'x'},{x:15, y:-3, z:4, s:'f'},{x:15, y:3, z:4, s:'f'}
        ],
        members: [
            // 下弦材
            {i:1,j:5, ...p_truss, A:2.72e-3},{i:5,j:9, ...p_truss, A:2.72e-3},{i:9,j:13, ...p_truss, A:2.72e-3},
            {i:2,j:6, ...p_truss, A:2.72e-3},{i:6,j:10, ...p_truss, A:2.72e-3},{i:10,j:14, ...p_truss, A:2.72e-3},
            // 上弦材
            {i:3,j:7, ...p_truss, A:2.03e-3},{i:7,j:11, ...p_truss, A:2.03e-3},{i:11,j:15, ...p_truss, A:2.03e-3},
            {i:4,j:8, ...p_truss, A:2.03e-3},{i:8,j:12, ...p_truss, A:2.03e-3},{i:12,j:16, ...p_truss, A:2.03e-3},
            // 垂直材
            {i:1,j:3, ...p_truss, A:2.03e-3},{i:2,j:4, ...p_truss, A:2.03e-3},{i:5,j:7, ...p_truss, A:2.03e-3},{i:6,j:8, ...p_truss, A:2.03e-3},
            {i:9,j:11, ...p_truss, A:2.03e-3},{i:10,j:12, ...p_truss, A:2.03e-3},{i:13,j:15, ...p_truss, A:2.03e-3},{i:14,j:16, ...p_truss, A:2.03e-3},
            // 斜材
            {i:1,j:7, ...p_truss, A:2.03e-3},{i:5,j:3, ...p_truss, A:2.03e-3},{i:5,j:11, ...p_truss, A:2.03e-3},{i:9,j:7, ...p_truss, A:2.03e-3},
            {i:9,j:15, ...p_truss, A:2.03e-3},{i:13,j:11, ...p_truss, A:2.03e-3},{i:2,j:8, ...p_truss, A:2.03e-3},{i:6,j:4, ...p_truss, A:2.03e-3},
            {i:6,j:12, ...p_truss, A:2.03e-3},{i:10,j:8, ...p_truss, A:2.03e-3},{i:10,j:16, ...p_truss, A:2.03e-3},{i:14,j:12, ...p_truss, A:2.03e-3},
            // 横構
            {i:1,j:2, ...p_truss, A:2.03e-3},{i:3,j:4, ...p_truss, A:2.03e-3},{i:5,j:6, ...p_truss, A:2.03e-3},{i:7,j:8, ...p_truss, A:2.03e-3},
            {i:9,j:10, ...p_truss, A:2.03e-3},{i:11,j:12, ...p_truss, A:2.03e-3},{i:13,j:14, ...p_truss, A:2.03e-3},{i:15,j:16, ...p_truss, A:2.03e-3},
            // 対角横構
            {i:1,j:8, ...p_truss, A:2.03e-3},{i:2,j:7, ...p_truss, A:2.03e-3},{i:5,j:12, ...p_truss, A:2.03e-3},{i:6,j:11, ...p_truss, A:2.03e-3},
            {i:9,j:16, ...p_truss, A:2.03e-3},{i:10,j:15, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:7, pz:-20},{n:8, pz:-20},{n:11, pz:-20},{n:12, pz:-20}], ml:[]
    } },

    // 5G-2: 観覧車構造（検定比1.8程度に調整）
    { name: '5G-2: 観覧車構造', data: {
        nodes: [
            // 中心支柱
            {x:0, y:0, z:0, s:'x'},{x:0, y:0, z:10, s:'f'},
            // 外周リング(8点)
            {x:6, y:0, z:10, s:'f'},{x:4.24, y:4.24, z:10, s:'f'},{x:0, y:6, z:10, s:'f'},{x:-4.24, y:4.24, z:10, s:'f'},
            {x:-6, y:0, z:10, s:'f'},{x:-4.24, y:-4.24, z:10, s:'f'},{x:0, y:-6, z:10, s:'f'},{x:4.24, y:-4.24, z:10, s:'f'},
            // 内周リング(8点)
            {x:3, y:0, z:10, s:'f'},{x:2.12, y:2.12, z:10, s:'f'},{x:0, y:3, z:10, s:'f'},{x:-2.12, y:2.12, z:10, s:'f'},
            {x:-3, y:0, z:10, s:'f'},{x:-2.12, y:-2.12, z:10, s:'f'},{x:0, y:-3, z:10, s:'f'},{x:2.12, y:-2.12, z:10, s:'f'}
        ],
        members: [
            // 支柱
            {i:1,j:2, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            // 外周リング
            {i:3,j:4, ...p_truss, A:2.03e-3},{i:4,j:5, ...p_truss, A:2.03e-3},{i:5,j:6, ...p_truss, A:2.03e-3},{i:6,j:7, ...p_truss, A:2.03e-3},
            {i:7,j:8, ...p_truss, A:2.03e-3},{i:8,j:9, ...p_truss, A:2.03e-3},{i:9,j:10, ...p_truss, A:2.03e-3},{i:10,j:3, ...p_truss, A:2.03e-3},
            // 内周リング
            {i:11,j:12, ...p_truss, A:2.03e-3},{i:12,j:13, ...p_truss, A:2.03e-3},{i:13,j:14, ...p_truss, A:2.03e-3},{i:14,j:15, ...p_truss, A:2.03e-3},
            {i:15,j:16, ...p_truss, A:2.03e-3},{i:16,j:17, ...p_truss, A:2.03e-3},{i:17,j:18, ...p_truss, A:2.03e-3},{i:18,j:11, ...p_truss, A:2.03e-3},
            // スポーク
            {i:2,j:3, ...p_truss, A:2.03e-3},{i:2,j:4, ...p_truss, A:2.03e-3},{i:2,j:5, ...p_truss, A:2.03e-3},{i:2,j:6, ...p_truss, A:2.03e-3},
            {i:2,j:7, ...p_truss, A:2.03e-3},{i:2,j:8, ...p_truss, A:2.03e-3},{i:2,j:9, ...p_truss, A:2.03e-3},{i:2,j:10, ...p_truss, A:2.03e-3},
            // 放射状接続
            {i:3,j:11, ...p_truss, A:2.03e-3},{i:4,j:12, ...p_truss, A:2.03e-3},{i:5,j:13, ...p_truss, A:2.03e-3},{i:6,j:14, ...p_truss, A:2.03e-3},
            {i:7,j:15, ...p_truss, A:2.03e-3},{i:8,j:16, ...p_truss, A:2.03e-3},{i:9,j:17, ...p_truss, A:2.03e-3},{i:10,j:18, ...p_truss, A:2.03e-3},
            // 内周への接続
            {i:2,j:11, ...p_truss, A:2.03e-3},{i:2,j:12, ...p_truss, A:2.03e-3},{i:2,j:13, ...p_truss, A:2.03e-3},{i:2,j:14, ...p_truss, A:2.03e-3},
            {i:2,j:15, ...p_truss, A:2.03e-3},{i:2,j:16, ...p_truss, A:2.03e-3},{i:2,j:17, ...p_truss, A:2.03e-3},{i:2,j:18, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:3, px:10},{n:7, px:-10},{n:5, py:10},{n:9, py:-10}], ml:[]
    } },

    // 5H-1: 体育館大空間構造（検定比1.7程度に調整）
    { name: '5H-1: 体育館大空間構造', data: {
        nodes: [
            // 基礎部
            {x:0, y:0, z:0, s:'x'},{x:20, y:0, z:0, s:'x'},{x:20, y:30, z:0, s:'x'},{x:0, y:30, z:0, s:'x'},
            // 壁上部
            {x:0, y:0, z:8, s:'f'},{x:20, y:0, z:8, s:'f'},{x:20, y:30, z:8, s:'f'},{x:0, y:30, z:8, s:'f'},
            // 屋根トラス下弦
            {x:0, y:10, z:8, s:'f'},{x:0, y:20, z:8, s:'f'},{x:20, y:10, z:8, s:'f'},{x:20, y:20, z:8, s:'f'},
            // 屋根トラス上弦
            {x:0, y:10, z:12, s:'f'},{x:0, y:20, z:12, s:'f'},{x:20, y:10, z:12, s:'f'},{x:20, y:20, z:12, s:'f'},
            // 屋根中央部
            {x:10, y:10, z:12, s:'f'},{x:10, y:20, z:12, s:'f'}
        ],
        members: [
            // 柱
            {i:1,j:5, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:2,j:6, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            {i:3,j:7, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},{i:4,j:8, E:UNIT_CONVERSION.E_STEEL, I:6.34e-5, A:5.546e-3, Z:5.08e-4},
            // 壁梁
            {i:5,j:6, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:6,j:7, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            {i:7,j:8, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},{i:8,j:5, E:UNIT_CONVERSION.E_STEEL, I:2.90e-5, A:4.00e-3, Z:2.90e-4},
            // 屋根トラス下弦
            {i:5,j:9, ...p_truss, A:2.72e-3},{i:9,j:10, ...p_truss, A:2.72e-3},{i:10,j:8, ...p_truss, A:2.72e-3},
            {i:6,j:11, ...p_truss, A:2.72e-3},{i:11,j:12, ...p_truss, A:2.72e-3},{i:12,j:7, ...p_truss, A:2.72e-3},
            // 屋根トラス上弦
            {i:13,j:14, ...p_truss, A:2.03e-3},{i:15,j:16, ...p_truss, A:2.03e-3},{i:13,j:17, ...p_truss, A:2.03e-3},
            {i:17,j:18, ...p_truss, A:2.03e-3},{i:18,j:14, ...p_truss, A:2.03e-3},{i:15,j:17, ...p_truss, A:2.03e-3},
            {i:17,j:16, ...p_truss, A:2.03e-3},{i:18,j:16, ...p_truss, A:2.03e-3},
            // 垂直材
            {i:9,j:13, ...p_truss, A:2.03e-3},{i:10,j:14, ...p_truss, A:2.03e-3},{i:11,j:15, ...p_truss, A:2.03e-3},{i:12,j:16, ...p_truss, A:2.03e-3},
            // 斜材
            {i:9,j:17, ...p_truss, A:2.03e-3},{i:10,j:18, ...p_truss, A:2.03e-3},{i:11,j:17, ...p_truss, A:2.03e-3},{i:12,j:18, ...p_truss, A:2.03e-3}
        ],
        nl:[{n:17, pz:-40},{n:18, pz:-40}], ml:[]
    } },

    // 5H-2: オフィスビルコア構造
    { name: '5H-2: オフィスビルコア構造', data: {
        nodes: [
            // 1階外周
            {x:0, y:0, z:0, s:'x'},{x:12, y:0, z:0, s:'x'},{x:12, y:12, z:0, s:'x'},{x:0, y:12, z:0, s:'x'},
            // 1階コア
            {x:4, y:4, z:0, s:'x'},{x:8, y:4, z:0, s:'x'},{x:8, y:8, z:0, s:'x'},{x:4, y:8, z:0, s:'x'},
            // 2階外周
            {x:0, y:0, z:4, s:'f'},{x:12, y:0, z:4, s:'f'},{x:12, y:12, z:4, s:'f'},{x:0, y:12, z:4, s:'f'},
            // 2階コア
            {x:4, y:4, z:4, s:'f'},{x:8, y:4, z:4, s:'f'},{x:8, y:8, z:4, s:'f'},{x:4, y:8, z:4, s:'f'},
            // 3階外周
            {x:0, y:0, z:8, s:'f'},{x:12, y:0, z:8, s:'f'},{x:12, y:12, z:8, s:'f'},{x:0, y:12, z:8, s:'f'},
            // 3階コア
            {x:4, y:4, z:8, s:'f'},{x:8, y:4, z:8, s:'f'},{x:8, y:8, z:8, s:'f'},{x:4, y:8, z:8, s:'f'}
        ],
        members: [
            // 外周柱（断面性能調整済み - 検定比1.2程度）
            {i:1,j:9, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},{i:2,j:10, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},
            {i:3,j:11, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},{i:4,j:12, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},
            {i:9,j:17, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},{i:10,j:18, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},
            {i:11,j:19, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},{i:12,j:20, E:UNIT_CONVERSION.E_STEEL, I:8.5e-6, A:1.5e-3, Z:8.5e-5},
            // コア柱（断面性能調整済み - 検定比1.8程度）
            {i:5,j:13, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},{i:6,j:14, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},
            {i:7,j:15, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},{i:8,j:16, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},
            {i:13,j:21, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},{i:14,j:22, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},
            {i:15,j:23, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},{i:16,j:24, E:UNIT_CONVERSION.E_STEEL, I:1.2e-5, A:2.0e-3, Z:1.2e-4},
            // 外周梁（断面性能調整済み - 検定比1.5程度）
            {i:9,j:10, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},{i:10,j:11, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},
            {i:11,j:12, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},{i:12,j:9, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},
            {i:17,j:18, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},{i:18,j:19, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},
            {i:19,j:20, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},{i:20,j:17, E:UNIT_CONVERSION.E_STEEL, I:1.0e-5, A:1.8e-3, Z:1.0e-4},
            // コア梁（断面性能調整済み - 検定比1.3程度）
            {i:13,j:14, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},{i:14,j:15, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},
            {i:15,j:16, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},{i:16,j:13, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},
            {i:21,j:22, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},{i:22,j:23, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},
            {i:23,j:24, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},{i:24,j:21, E:UNIT_CONVERSION.E_STEEL, I:1.5e-5, A:2.2e-3, Z:1.5e-4},
            // 外周とコアの接続梁（断面性能調整済み - 検定比1.1程度）
            {i:9,j:13, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},{i:10,j:14, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},
            {i:11,j:15, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},{i:12,j:16, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},
            {i:17,j:21, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},{i:18,j:22, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},
            {i:19,j:23, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4},{i:20,j:24, E:UNIT_CONVERSION.E_STEEL, I:2.0e-5, A:2.5e-3, Z:2.0e-4}
        ],
        nl:[{n:17, px:15, py:10},{n:18, px:-15, py:10},{n:19, px:-15, py:-10},{n:20, px:15, py:-10}], ml:[{m:9, wz:-5},{m:10, wz:-5},{m:11, wz:-5},{m:12, wz:-5},{m:17, wz:-5},{m:18, wz:-5},{m:19, wz:-5},{m:20, wz:-5},{m:25, wz:-3},{m:26, wz:-3},{m:27, wz:-3},{m:28, wz:-3},{m:29, wz:-3},{m:30, wz:-3},{m:31, wz:-3},{m:32, wz:-3}]
    } }
];
const loadPreset = (index) => {
        const preset = presets[index];
        if (!preset || !preset.data) return;
        const p = preset.data;
        
        // プリセット読み込み中フラグを設定（描画処理をスキップするため）
        window.isLoadingPreset = true;
        
        historyStack = [];
        elements.nodesTable.innerHTML = '';
        elements.membersTable.innerHTML = '';
        elements.nodeLoadsTable.innerHTML = '';
        elements.memberLoadsTable.innerHTML = '';
        p.nodes.forEach(n => {
            const supportRaw = n.support ?? n.s ?? 'free';
            const normalizedSupport = normalizeSupportValue(supportRaw);
            addRow(elements.nodesTable, [
                `#`, 
                `<input type="number" value="${n.x}">`, 
                `<input type="number" value="${n.y}">`, 
                `<input type="number" value="${n.z || 0}">`, 
                buildSupportSelectMarkup(normalizedSupport), 
                `<input type="number" value="0" step="0.1">`, 
                `<input type="number" value="0" step="0.1">`, 
                `<input type="number" value="0" step="0.1">`
            ], false);
        });
        p.members.forEach(m => {
            const E_N_mm2 = m.E || '205000';
            const F_N_mm2 = m.F || '235';
            const Iz_m4 = m.Iz || m.I || 1.84e-5;  // 2D互換性のためI→Izへフォールバック
            const Iy_m4 = m.Iy || (m.Iz || m.I || 1.84e-5) * 0.333;  // 強軸の約1/3をデフォルト
            const J_m4 = m.J || (m.Iz || m.I || 1.84e-5) * 0.128;   // ねじり定数をデフォルト推定
            const A_m2 = m.A || 2.34e-3;
            const Zz_m3 = m.Zz || m.Z || 1.23e-3;  // 2D互換性のためZ→Zzへフォールバック
            const Zy_m3 = m.Zy || (m.Zz || m.Z || 1.23e-3) * 0.333; // 強軸の約1/3をデフォルト

            // プリセットから断面情報と軸情報を取得
            const presetProfile = findPresetSectionProfile(m);
            const sectionInfoFromPreset = presetProfile ? cloneDeep(presetProfile.sectionInfo) : parseSectionInfoFromMember(m);
            const axisInfo = buildAxisInfo(m, sectionInfoFromPreset);

            // 断面名称と軸方向を取得（寸法付き名称を生成）
            let sectionName = sectionInfoFromPreset?.label || '';
            if (sectionInfoFromPreset && sectionInfoFromPreset.rawDims) {
                const dims = sectionInfoFromPreset.rawDims;
                const parts = [sectionInfoFromPreset.typeLabel || ''];
                if (dims.H != null) parts.push(dims.H);
                if (dims.B != null) parts.push(dims.B);
                if (dims.t1 != null) parts.push(dims.t1);
                if (dims.t2 != null) parts.push(dims.t2);
                if (parts.length > 1) {
                    sectionName = parts.join('×');
                }
            }
            const sectionAxis = axisInfo?.label || '';

            const rowCells = memberRowHTML(m.i, m.j, E_N_mm2, F_N_mm2, Iz_m4, Iy_m4, J_m4, m.Iw, A_m2, Zz_m3, Zy_m3, m.i_conn || m.ic, m.j_conn || m.jc, sectionName, sectionAxis);
            if (!rowCells || !Array.isArray(rowCells)) {
                console.warn('Failed to build member row cells for preset member:', m);
                return;
            }

            let newRow = addRow(elements.membersTable, [`#`, ...rowCells], false);
            if (!(newRow instanceof HTMLTableRowElement)) {
                if (newRow && typeof newRow.then === 'function') {
                    console.warn('addRow returned a Promise; falling back to last table row for preset member handling.', m);
                } else if (newRow !== undefined) {
                    console.warn('addRow returned a non-row value; attempting fallback.', newRow);
                }

                const memberRows = elements.membersTable?.rows;
                if (memberRows && memberRows.length > 0) {
                    newRow = memberRows[memberRows.length - 1];
                } else {
                    newRow = null;
                }
            }

            if (!(newRow instanceof HTMLTableRowElement)) {
                console.warn('Failed to obtain member row element for preset member:', m);
                return;
            }

            const propertySource = presetProfile ? presetProfile.properties : null;

            if (sectionInfoFromPreset) {
                if (axisInfo && !sectionInfoFromPreset.axis) {
                    sectionInfoFromPreset.axis = { ...axisInfo };
                }
                setRowSectionInfo(newRow, sectionInfoFromPreset);
            } else if (axisInfo) {
                applySectionAxisDataset(newRow, axisInfo);
            }

            const zxToApply = propertySource?.Zx ?? m.Zx;
            const zyToApply = propertySource?.Zy ?? m.Zy;
            const ixToApply = propertySource?.ix ?? m.ix;
            const iyToApply = propertySource?.iy ?? m.iy;

            if (zxToApply != null) newRow.dataset.zx = zxToApply;
            if (zyToApply != null) newRow.dataset.zy = zyToApply;
            if (ixToApply != null) newRow.dataset.ix = ixToApply;
            if (iyToApply != null) newRow.dataset.iy = iyToApply;
        });
        p.nl.forEach(l => addRow(elements.nodeLoadsTable, [
            `<input type="number" value="${l.n || l.node}">`, 
            `<input type="number" value="${l.px||0}">`, 
            `<input type="number" value="${l.py||0}">`, 
            `<input type="number" value="${l.pz||0}">`
        ], false));
        p.ml.forEach(l => addRow(elements.memberLoadsTable, [
            `<input type="number" value="${l.m || l.member}">`, 
            `<input type="number" value="${l.wx||0}">`, 
            `<input type="number" value="${l.wy||l.w||0}">`, 
            `<input type="number" value="${l.wz||0}">`
        ], false));
        renumberTables();
        
        // プリセット読み込み完了フラグをクリア
        window.isLoadingPreset = false;
        
        // 自重考慮チェックボックスがONの場合、自重を再計算して表示を更新
        const considerSelfWeightCheckbox = document.getElementById('consider-self-weight-checkbox');
        if (considerSelfWeightCheckbox && considerSelfWeightCheckbox.checked) {
            // 自重考慮の表示を更新（密度列の追加など）
            updateSelfWeightDisplay();
        }
        
        // ★★★★★ 修正箇所 ★★★★★
        // 描画範囲の自動調整フラグをリセット
        panZoomState.isInitialized = false; 
        
        drawOnCanvas();
        runFullAnalysis();
        
        // プリセット読み込み後に自動スケーリングを実行
        setTimeout(() => {
            if (window.triggerAutoScale) {
                window.triggerAutoScale();
            }
        }, 100);
    };

    const populatePresetSelector = () => {
        if (!elements?.presetSelector) return;
        elements.presetSelector.innerHTML = '';
        presets.forEach((p, i) => {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = p.name;
            if (p.disabled) {
                option.disabled = true;
                option.style.fontWeight = 'bold';
                option.style.backgroundColor = '#eee';
            }
            elements.presetSelector.appendChild(option);
        });
    };

    const load2DPresetsFromSource = async () => {
        const url = './2D構造解析/frame_analyzer.js';
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`2D presets fetch failed: ${resp.status}`);
        const rawText = await resp.text();
        const text = rawText.replace(/\r\n/g, '\n');

        const startKeyword = 'const presets = [';
        const start = text.indexOf(startKeyword);
        if (start === -1) throw new Error('2D presets marker not found');

        const startArray = text.indexOf('[', start);
        if (startArray === -1) throw new Error('2D presets array start not found');

        const endMarker = '\n];\nconst loadPreset';
        const end = text.indexOf(endMarker, startArray);
        if (end === -1) throw new Error('2D presets end marker not found');

        const arrayLiteral = text.slice(startArray, end + 2); // include closing ']'

        // 2Dのプリセット配列は、UNIT_CONVERSION や p_truss など既存グローバルを参照するため
        // 同一ページ上で評価してデータ配列として取得する。
        const result = (new Function(`return ${arrayLiteral};`))();
        if (!Array.isArray(result)) throw new Error('2D presets did not evaluate to array');
        return result;
    };

    const merge2DPresetsIntoSelector = async () => {
        try {
            const twoDPresets = await load2DPresetsFromSource();
            // 既存の5.カテゴリの前に 1〜4 を差し込む
            presets = [...twoDPresets, ...presets];
        } catch (e) {
            console.warn('2Dプリセットの読み込みに失敗しました（3Dプリセットのみで継続）:', e);
        }
        populatePresetSelector();
    };

    // changeハンドラは一度だけ登録
    elements.presetSelector.addEventListener('change', (e) => {
        loadPreset(e.target.value);
    });

    // まず3Dプリセットを表示し、次に2Dプリセットを取り込み次第統合して再描画
    populatePresetSelector();
    merge2DPresetsIntoSelector();

    elements.addNodeBtn.onclick = () => {
        const nodes = Array.from(elements.nodesTable.rows).map(row => ({
            x: parseFloat(row.cells[1].querySelector('input').value),
            y: parseFloat(row.cells[2].querySelector('input').value),
            z: parseFloat(row.cells[3].querySelector('input').value)
        }));
        let newX = 0, newY = 0, newZ = 0;
        if(nodes.length > 0) {
            const maxX = Math.max(...nodes.map(n => n.x));
            const nodeAtMaxX = nodes.find(n => n.x === maxX);
            newX = maxX + parseFloat(elements.gridSpacing.value);
            newY = nodeAtMaxX.y;
            newZ = nodeAtMaxX.z || 0;
        }
        // addNodeToTable関数を使用して重複チェック付きで追加
        addNodeToTable(newX, newY, newZ, 'free');
    };
    elements.addMemberBtn.onclick = () => {
        const nodeCount = elements.nodesTable.rows.length;
        if (nodeCount < 2) {
            alert('部材を追加するには少なくとも2つの節点が必要です。');
            return;
        }
        const existingMembers = new Set();
        Array.from(elements.membersTable.rows).forEach(row => {
            const i = parseInt(row.cells[1].querySelector('input').value);
            const j = parseInt(row.cells[2].querySelector('input').value);
            existingMembers.add(`${Math.min(i,j)}-${Math.max(i,j)}`);
        });
        for (let i = 1; i <= nodeCount; i++) {
            for (let j = i + 1; j <= nodeCount; j++) {
                if (!existingMembers.has(`${i}-${j}`)) {
                    const Iz_m4 = parseFloat(newMemberDefaults.Iz || newMemberDefaults.I || 1840) * 1e-8;
                    const Iy_m4 = parseFloat(newMemberDefaults.Iy || 613) * 1e-8;
                    const J_m4 = parseFloat(newMemberDefaults.J || 235) * 1e-8;
                    const A_m2 = parseFloat(newMemberDefaults.A) * 1e-4;
                    const Zz_m3 = parseFloat(newMemberDefaults.Zz || newMemberDefaults.Z || 1230) * 1e-6;
                    const Zy_m3 = parseFloat(newMemberDefaults.Zy || 410) * 1e-6;
                    addRow(elements.membersTable, [`#`, ...memberRowHTML(i,j,newMemberDefaults.E,newMemberDefaults.F,Iz_m4,Iy_m4,J_m4,'',A_m2,Zz_m3,Zy_m3,newMemberDefaults.i_conn,newMemberDefaults.j_conn)]);
                    return;
                }
            }
        }
        alert('接続可能なすべての節点ペアは既に接続されています。');
    };
    elements.addNodeLoadBtn.onclick = () => { addRow(elements.nodeLoadsTable, ['<input type="number" value="1">', '<input type="number" value="0">', '<input type="number" value="0">', '<input type="number" value="0">']); };
    elements.addMemberLoadBtn.onclick = () => { addRow(elements.memberLoadsTable, ['<input type="number" value="1">', '<input type="number" value="0">', '<input type="number" value="0">', '<input type="number" value="0">']); };
    
    const saveInputData = () => {
        try {
            const state = getCurrentState();
            const toCsvValue = (value) => (value === undefined || value === null) ? '' : `${value}`;
            const encodeIfNeeded = (value) => {
                if (typeof value !== 'string' || value.length === 0) return '';
                return encodeURIComponent(value);
            };
            const csvSections = [];

            // 2D/3Dどちらの保存データかを判別できるようにメタ情報を付与
            csvSections.push('#META\nkey,value\nmode,3d\n');
            if (state.nodes.length > 0) {
                const header = 'x,y,z,support,dx_forced,dy_forced,dz_forced';
                const rows = state.nodes.map(n => [
                    toCsvValue(n.x),
                    toCsvValue(n.y),
                    toCsvValue(n.z),
                    toCsvValue(n.support),
                    toCsvValue(n.dx_forced),
                    toCsvValue(n.dy_forced),
                    toCsvValue(n.dz_forced)
                ].join(','));
                csvSections.push('#NODES\n' + header + '\n' + rows.join('\n'));
            }
            if (state.members.length > 0) {
                const header = 'i,j,E,strengthType,strengthValue,Iz,Iy,J,A,Zz,Zy,I,Z,i_conn,j_conn,bucklingK,Kx_i,Ky_i,Kr_i,Kx_j,Ky_j,Kr_j,Zx,ix,iy,sectionLabel,sectionSummary,sectionSource,sectionInfo,sectionAxisKey,sectionAxisMode,sectionAxisLabel';
                const rows = state.members.map(m => {
                    const sectionLabel = encodeIfNeeded(m.sectionLabel || (m.sectionInfo && m.sectionInfo.label));
                    const sectionSummary = encodeIfNeeded(m.sectionSummary || (m.sectionInfo && m.sectionInfo.dimensionSummary));
                    const sectionSource = encodeIfNeeded(m.sectionSource || (m.sectionInfo && m.sectionInfo.source));
                    const sectionInfoEncoded = typeof m.sectionInfoEncoded === 'string' && m.sectionInfoEncoded.length > 0
                        ? m.sectionInfoEncoded
                        : (m.sectionInfo ? encodeURIComponent(JSON.stringify(m.sectionInfo)) : '');
                    const sectionAxisKey = m.sectionAxisKey || (m.sectionAxis && m.sectionAxis.key) || '';
                    const sectionAxisMode = m.sectionAxisMode || (m.sectionAxis && m.sectionAxis.mode) || '';
                    const sectionAxisLabel = encodeIfNeeded(m.sectionAxisLabel || (m.sectionAxis && m.sectionAxis.label));

                    const bk = (m.bucklingK !== undefined && m.bucklingK !== null) ? m.bucklingK : '';
                    const kxi = (m.spring_i && m.spring_i.Kx !== undefined && m.spring_i.Kx !== null) ? m.spring_i.Kx : '';
                    const kyi = (m.spring_i && m.spring_i.Ky !== undefined && m.spring_i.Ky !== null) ? m.spring_i.Ky : '';
                    const kri = (m.spring_i && m.spring_i.Kr !== undefined && m.spring_i.Kr !== null) ? m.spring_i.Kr : '';
                    const kxj = (m.spring_j && m.spring_j.Kx !== undefined && m.spring_j.Kx !== null) ? m.spring_j.Kx : '';
                    const kyj = (m.spring_j && m.spring_j.Ky !== undefined && m.spring_j.Ky !== null) ? m.spring_j.Ky : '';
                    const krj = (m.spring_j && m.spring_j.Kr !== undefined && m.spring_j.Kr !== null) ? m.spring_j.Kr : '';

                    return [
                        toCsvValue(m.i),
                        toCsvValue(m.j),
                        toCsvValue(m.E),
                        toCsvValue(m.strengthType),
                        toCsvValue(m.strengthValue),
                        toCsvValue(m.Iz ?? m.I),
                        toCsvValue(m.Iy),
                        toCsvValue(m.J),
                        toCsvValue(m.A),
                        toCsvValue(m.Zz ?? m.Z),
                        toCsvValue(m.Zy),
                        toCsvValue(m.I !== undefined ? m.I : (m.Iz ?? '')),
                        toCsvValue(m.Z !== undefined ? m.Z : (m.Zz ?? '')),
                        toCsvValue(m.i_conn),
                        toCsvValue(m.j_conn),
                        toCsvValue(bk),
                        toCsvValue(kxi),
                        toCsvValue(kyi),
                        toCsvValue(kri),
                        toCsvValue(kxj),
                        toCsvValue(kyj),
                        toCsvValue(krj),
                        toCsvValue(m.Zx),
                        toCsvValue(m.ix),
                        toCsvValue(m.iy),
                        sectionLabel,
                        sectionSummary,
                        sectionSource,
                        sectionInfoEncoded,
                        toCsvValue(sectionAxisKey),
                        toCsvValue(sectionAxisMode),
                        sectionAxisLabel
                    ].join(',');
                });
                csvSections.push('#MEMBERS\n' + header + '\n' + rows.join('\n'));
            }
            if (state.nodeLoads.length > 0) {
                const header = 'node,px,py,pz';
                const rows = state.nodeLoads.map(l => [
                    toCsvValue(l.node),
                    toCsvValue(l.px),
                    toCsvValue(l.py),
                    toCsvValue(l.pz)
                ].join(','));
                csvSections.push('#NODELOADS\n' + header + '\n' + rows.join('\n'));
            }
            if (state.memberLoads.length > 0) {
                const header = 'member,wx,wy,wz';
                const rows = state.memberLoads.map(l => [
                    toCsvValue(l.member),
                    toCsvValue(l.wx),
                    toCsvValue(l.wy ?? l.w),
                    toCsvValue(l.wz)
                ].join(','));
                csvSections.push('#MEMBERLOADS\n' + header + '\n' + rows.join('\n'));
            }
            const csvString = csvSections.join('\n\n');
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'frame-model.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            alert('CSVデータの保存に失敗しました: ' + error.message);
        }
    };

    const detectCsvSavedMode = (text) => {
        if (typeof text !== 'string' || !text.trim()) return null;

        // #META があれば最優先
        const metaMatch = text.match(/#META\s*[\r\n]+([^#]*)/i);
        if (metaMatch && metaMatch[1]) {
            const metaLines = metaMatch[1].trim().split(/\r?\n/).filter(Boolean);
            if (metaLines.length >= 2) {
                const metaHeader = metaLines[0].split(',').map(s => s.trim());
                const keyIndex = metaHeader.indexOf('key');
                const valueIndex = metaHeader.indexOf('value');
                for (let i = 1; i < metaLines.length; i++) {
                    const cols = metaLines[i].split(',');
                    const key = (cols[keyIndex] || '').trim().toLowerCase();
                    const value = (cols[valueIndex] || '').trim().toLowerCase();
                    if (key === 'mode' && (value === '2d' || value === '3d')) return value;
                }
            }
        }

        // 後方互換: ヘッダ内容から推定
        const nodesHeaderMatch = text.match(/#NODES\s*[\r\n]+([^\r\n]+)/i);
        if (nodesHeaderMatch && nodesHeaderMatch[1]) {
            const keys = nodesHeaderMatch[1].split(',').map(s => s.trim().toLowerCase());
            if (keys.includes('z') || keys.includes('dz_forced')) return '3d';
        }

        const membersHeaderMatch = text.match(/#MEMBERS\s*[\r\n]+([^\r\n]+)/i);
        if (membersHeaderMatch && membersHeaderMatch[1]) {
            const keys = membersHeaderMatch[1].split(',').map(s => s.trim().toLowerCase());
            if (keys.includes('i_factor') || keys.includes('i_radius') || keys.includes('i_factor')) return '2d';
            if (keys.includes('iz') || keys.includes('iy') || keys.includes('j') || keys.includes('z') || keys.includes('zz') || keys.includes('zy')) {
                // 3D側は Iz/Iy/J/Zz/Zy 等が入る
                if (keys.includes('iz') || keys.includes('iy') || keys.includes('zz') || keys.includes('zy')) return '3d';
            }
        }

        const nodeLoadsHeaderMatch = text.match(/#NODELOADS\s*[\r\n]+([^\r\n]+)/i);
        if (nodeLoadsHeaderMatch && nodeLoadsHeaderMatch[1]) {
            const keys = nodeLoadsHeaderMatch[1].split(',').map(s => s.trim().toLowerCase());
            if (keys.includes('pz')) return '3d';
        }

        const memberLoadsHeaderMatch = text.match(/#MEMBERLOADS\s*[\r\n]+([^\r\n]+)/i);
        if (memberLoadsHeaderMatch && memberLoadsHeaderMatch[1]) {
            const keys = memberLoadsHeaderMatch[1].split(',').map(s => s.trim().toLowerCase());
            if (keys.includes('wz') || keys.includes('wx')) return '3d';
        }
        return null;
    };

    const parseCsvTextToState = (text) => {
        const state = { meta: {}, nodes: [], members: [], nodeLoads: [], memberLoads: [] };
        const sections = text.split(/#\w+\s*/).filter(s => s.trim() !== '');
        const headers = text.match(/#\w+/g) || [];
        if (headers.length === 0 || sections.length === 0) throw new Error('有効なセクション（#NODESなど）が見つかりませんでした。');

        headers.forEach((header, index) => {
            const sectionText = sections[index];
            if (!sectionText) return;
            const lines = sectionText.trim().split(/\r?\n/);
            const headerLine = lines.shift();
            const keys = (headerLine || '').split(',').map(s => s.trim()).filter(Boolean);
            lines.forEach(line => {
                if (!line.trim()) return;
                const values = line.split(',');
                const obj = {};
                keys.forEach((key, i) => obj[key] = values[i] ? values[i].trim() : '');

                if (header === '#META') {
                    const k = (obj.key || '').trim();
                    const v = (obj.value || '').trim();
                    if (k) state.meta[k] = v;
                } else if (header === '#NODES') {
                    state.nodes.push(obj);
                } else if (header === '#MEMBERS') {
                    state.members.push(obj);
                } else if (header === '#NODELOADS') {
                    state.nodeLoads.push(obj);
                } else if (header === '#MEMBERLOADS') {
                    state.memberLoads.push(obj);
                }
            });
        });

        return state;
    };

    const loadFromCsvText = (text) => {
        const savedMode = detectCsvSavedMode(text);
        if (savedMode === '2d') {
            // 2Dデータを3D側で読んだ場合は、統合UIに切替を依頼して2D側で読込
            if (typeof window.requestCsvLoadInMode === 'function') {
                window.requestCsvLoadInMode('2d', text);
                return { redirected: true, mode: '2d' };
            }
            throw new Error('このCSVは2D保存データのため、2D構造解析モードで読み込んでください。');
        }

        const state = parseCsvTextToState(text);
        if (state.nodes.length === 0 && state.members.length === 0) throw new Error('ファイルから有効なデータを読み込めませんでした。');
        historyStack = [];
        pushState();
        restoreState(state);
        runFullAnalysis();
        return { redirected: false, mode: '3d' };
    };

    // 親(統合UI)からCSVテキストを渡された場合にも復元できるように公開
    window.__staticaLoadCsvText3D = (text) => {
        try {
            loadFromCsvText(text);
        } catch (e) {
            alert('CSVテキストの読み込みに失敗しました: ' + (e && e.message ? e.message : String(e)));
        }
    };

    const loadInputData = () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv,text/csv';
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const text = event.target.result;
                    loadFromCsvText(text);
                } catch (error) {
                    alert('CSVファイルの読み込みに失敗しました: ' + error.message);
                }
            };
            reader.readAsText(file);
        };
        fileInput.click();
    };
    // レポート用のテーブル HTML を生成する関数
    const generateReportTableHTML = (tableId) => {
        const table = document.getElementById(tableId);
        if (!table) return '';
        
        let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:2em;">';
        
        // ヘッダー
        const thead = table.querySelector('thead');
        if (thead) {
            html += '<thead>';
            Array.from(thead.rows).forEach(row => {
                html += '<tr>';
                Array.from(row.cells).forEach(cell => {
                    html += `<th style="border:1px solid #ccc;padding:8px;text-align:center;background-color:#f0f8ff;">${cell.textContent}</th>`;
                });
                html += '</tr>';
            });
            html += '</thead>';
        }
        
        // ボディ
        const tbody = table.querySelector('tbody');
        if (tbody) {
            html += '<tbody>';
            Array.from(tbody.rows).forEach(row => {
                html += '<tr>';
                Array.from(row.cells).forEach((cell, cellIndex) => {
                    let cellContent = '';
                    
                    // 部材テーブルの基準強度列（4番目の列、インデックス3）の特別処理
                    if (tableId === 'members-table' && cellIndex === 4) {
                        const strengthContainer = cell.firstElementChild;
                        if (strengthContainer) {
                            const strengthType = strengthContainer.dataset.strengthType;
                            
                            switch(strengthType) {
                                case 'F-value':
                                case 'F-stainless':
                                case 'F-aluminum':
                                    const select = strengthContainer.querySelector('select');
                                    const input = strengthContainer.querySelector('input');
                                    if (select && input) {
                                        const selectedOption = select.options[select.selectedIndex];
                                        if (select.value === 'custom') {
                                            cellContent = `任意入力 (F=${input.value})`;
                                        } else {
                                            cellContent = selectedOption.textContent;
                                        }
                                    }
                                    break;
                                case 'wood-type':
                                    const presetSelect = strengthContainer.querySelector('select');
                                    if (presetSelect) {
                                        if (presetSelect.value === 'custom') {
                                            const inputs = strengthContainer.querySelectorAll('input');
                                            const values = Array.from(inputs).map(input => 
                                                `${input.id.split('-').pop()}=${input.value}`
                                            ).join(', ');
                                            cellContent = `任意入力 (${values})`;
                                        } else {
                                            const selectedOption = presetSelect.options[presetSelect.selectedIndex];
                                            cellContent = selectedOption.textContent;
                                        }
                                    }
                                    break;
                                default:
                                    cellContent = cell.textContent || '-';
                            }
                        } else {
                            cellContent = cell.textContent || '-';
                        }
                    } else {
                        // 通常のセル処理
                        const input = cell.querySelector('input');
                        const select = cell.querySelector('select');
                        if (input) {
                            cellContent = input.value || '-';
                        } else if (select) {
                            const selectedOption = select.options[select.selectedIndex];
                            cellContent = selectedOption ? selectedOption.textContent : '-';
                        } else {
                            cellContent = cell.textContent || '-';
                        }
                    }
                    
                    html += `<td style="border:1px solid #ccc;padding:8px;text-align:center;">${cellContent}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody>';
        }
        
        html += '</table>';
        return html;
    };

    const generateReport = () => {
        try {
            const modelCanvasImg=elements.modelCanvas.toDataURL('image/png');
            const displacementCanvasImg=elements.displacementCanvas.toDataURL('image/png');
            const momentCanvasImg=elements.momentCanvas.toDataURL('image/png');
            const axialCanvasImg=elements.axialCanvas.toDataURL('image/png');
            const shearCanvasImg=elements.shearCanvas.toDataURL('image/png');
            const ratioCanvasImg = elements.ratioCanvas.toDataURL('image/png');

            const reportWindow = window.open('', '_blank');
            // 座屈解析結果のレポート用HTML生成
            let bucklingReportHTML = '';
            if (lastBucklingResults && lastBucklingResults.length > 0) {
                bucklingReportHTML = `<div class="no-break"><h2>弾性座屈解析結果</h2>${generateReportTableHTML('buckling-analysis-results')}</div>`;
            }

            reportWindow.document.write(`<html><head><title>構造解析レポート</title><style>body{font-family:sans-serif;margin:2em;}h1,h2,h3{color:#005A9C;border-bottom:2px solid #f0f8ff;padding-bottom:5px;}table{width:100%;border-collapse:collapse;margin-bottom:2em;}th,td{border:1px solid #ccc;padding:8px;text-align:center;}th{background-color:#f0f8ff;}img{max-width:100%;height:auto;border:1px solid #ccc;margin:1em 0;}.grid{display:grid;grid-template-columns:1fr;gap:20px;}.no-break{page-break-inside:avoid;}@media print{body{margin:1em;}button{display:none;}}</style></head><body><button onclick="window.print()">レポートを印刷</button><h1>構造解析レポート</h1><p>生成日時: ${new Date().toLocaleString()}</p><div class="no-break"><h2>モデル図</h2><img src="${modelCanvasImg}"></div><h2>入力データ</h2><div class="no-break"><h3>節点座標と境界条件</h3>${generateReportTableHTML('nodes-table')}</div><div class="no-break"><h3>部材 (物性値・接合条件)</h3>${generateReportTableHTML('members-table')}</div><div class="no-break"><h3>節点荷重</h3>${generateReportTableHTML('node-loads-table')}</div><div class="no-break"><h3>部材等分布荷重</h3>${generateReportTableHTML('member-loads-table')}</div><h2>計算結果</h2><div class="no-break grid"><div><h3>変位図</h3><img src="${displacementCanvasImg}"></div><div><h3>曲げモーメント図</h3><img src="${momentCanvasImg}"></div><div><h3>軸力図</h3><img src="${axialCanvasImg}"></div><div><h3>せん断力図</h3><img src="${shearCanvasImg}"></div></div><div class="no-break">${generateReportTableHTML('displacement-results')}</div><div class="no-break">${generateReportTableHTML('reaction-results')}</div><div class="no-break">${generateReportTableHTML('force-results')}</div><div class="no-break"><h2>断面算定結果</h2><h3>検定比図</h3><img src="${ratioCanvasImg}"><h3>検定比 詳細</h3>${generateReportTableHTML('section-check-results')}<h3>たわみ制限</h3>${generateReportTableHTML('deflection-check-results')}<h3>横座屈（曲げ材）</h3>${generateReportTableHTML('ltb-check-results')}</div>${bucklingReportHTML}</body></html>`);
            reportWindow.document.close();
        } catch (e) {
            alert('レポートの生成に失敗しました: ' + e.message);
            console.error("Report generation failed: ", e);
        }
    };
    
    const runFullAnalysis = () => {
        // プリセット読み込み中は解析をスキップ
        if (window.isLoadingPreset) {
            return;
        }
        calculate();
        runSectionCheck();
    };
    const runSectionCheck = () => {
        if (!lastResults) return;
        const selectedTerm = document.querySelector('input[name="load-term"]:checked').value;
        lastSectionCheckResults = calculateSectionCheck(selectedTerm);
        window.lastSectionCheckResults = lastSectionCheckResults; // グローバルに保存

        lastDeflectionCheckResults = calculateDeflectionCheck();
        window.lastDeflectionCheckResults = lastDeflectionCheckResults;

        lastLtbCheckResults = calculateLtbCheck(selectedTerm);
        window.lastLtbCheckResults = lastLtbCheckResults;
        console.log('📌 LTB results:', {
            count: Array.isArray(lastLtbCheckResults) ? lastLtbCheckResults.length : null,
            sample: Array.isArray(lastLtbCheckResults) ? lastLtbCheckResults.slice(0, 3) : lastLtbCheckResults,
            selectedTerm
        });

        // エクセル出力用にも断面検定結果を保存
        if (lastAnalysisResult) {
            lastAnalysisResult.sectionCheckResults = lastSectionCheckResults;
            lastAnalysisResult.deflectionCheckResults = lastDeflectionCheckResults;
            lastAnalysisResult.ltbCheckResults = lastLtbCheckResults;
        }

        displaySectionCheckResults();
        displayDeflectionCheckResults();
        displayLtbCheckResults();
        drawRatioDiagram();
    };
    elements.calculateBtn.addEventListener('click', runFullAnalysis);
    

    elements.calculateAndAnimateBtn.addEventListener('click', () => {
        console.log('🎬 アニメーションボタンクリック');
        runFullAnalysis();
        // 描画コンテキストを更新してからアニメーション実行
        drawOnCanvas();
        // 少し遅延させてから描画コンテキストが確実に初期化されるようにする
        setTimeout(() => {
            console.log('🎬 アニメーション実行チェック:', { 
                lastResults: !!lastResults, 
                lastResultsD: !!lastResults?.D,
                nodes: lastResults?.nodes?.length,
                members: lastResults?.members?.length,
                memberLoads: lastResults?.memberLoads?.length
            });
            if (lastResults && lastResults.D) {
                console.log('🎬 アニメーション実行開始');
                animateDisplacement(lastResults.nodes, lastResults.members, lastResults.D, lastResults.memberLoads);
            } else {
                console.warn('アニメーション実行できません: lastResults または lastResults.D が存在しません');
            }
        }, 100);
    });
    
    document.body.classList.remove('section-check-disabled');
    elements.loadTermRadios.forEach(radio => radio.addEventListener('change', () => {
        if (lastResults) {
            runSectionCheck();
        }
    }));
    
    elements.gridToggle.addEventListener('change', drawOnCanvas);
    elements.gridSpacing.addEventListener('change', drawOnCanvas);

    // 非表示軸のラベル更新関数
    const updateHiddenAxisLabel = () => {
        if (!elements.hiddenAxisLabel || !elements.projectionMode) return;
        const mode = elements.projectionMode.value;
        let axisName = 'Z座標';
        let isHidden = true;

        if (mode === 'xy') {
            axisName = 'Z座標';
        } else if (mode === 'xz') {
            axisName = 'Y座標';
        } else if (mode === 'yz') {
            axisName = 'X座標';
        } else if (mode === 'iso') {
            isHidden = false; // 等角投影では全軸が表示されるため非表示
        }

        if (elements.hiddenAxisCoord) {
            elements.hiddenAxisCoord.style.display = isHidden ? '' : 'none';
            elements.hiddenAxisLabel.style.display = isHidden ? '' : 'none';
        }
        elements.hiddenAxisLabel.textContent = axisName + ' (m):';
    };

    // 非表示軸の座標値オプション更新関数（既存節点の座標値を取得）
    const updateHiddenAxisCoordOptions = () => {
        if (!elements.projectionMode || !elements.hiddenAxisCoord) return;
        const mode = elements.projectionMode.value;
        if (mode === 'iso') return; // 等角投影では不要

        try {
            const { nodes } = parseInputs();
            const uniqueCoords = new Set();

            nodes.forEach(node => {
                if (mode === 'xy') {
                    uniqueCoords.add(node.z);
                } else if (mode === 'xz') {
                    uniqueCoords.add(node.y);
                } else if (mode === 'yz') {
                    uniqueCoords.add(node.x);
                }
            });

            // 現在の選択値を保持
            const currentValue = elements.hiddenAxisCoord.value;

            // selectのオプションを更新
            elements.hiddenAxisCoord.innerHTML = '';

            // 既存の座標値をオプションとして追加
            const sortedCoords = [...uniqueCoords].sort((a, b) => a - b);
            sortedCoords.forEach(coord => {
                const option = document.createElement('option');
                option.value = coord;
                option.textContent = coord;
                elements.hiddenAxisCoord.appendChild(option);
            });

            // 「新規入力」オプションを追加
            const customOption = document.createElement('option');
            customOption.value = 'custom';
            customOption.textContent = '新規入力...';
            elements.hiddenAxisCoord.appendChild(customOption);

            // 以前の選択値を復元（存在する場合）
            if (sortedCoords.includes(parseFloat(currentValue))) {
                elements.hiddenAxisCoord.value = currentValue;
            } else if (sortedCoords.length > 0) {
                elements.hiddenAxisCoord.value = sortedCoords[0];
            } else {
                // 節点がない場合はデフォルト値を追加
                const defaultOption = document.createElement('option');
                defaultOption.value = '0';
                defaultOption.textContent = '0';
                elements.hiddenAxisCoord.insertBefore(defaultOption, customOption);
                elements.hiddenAxisCoord.value = '0';
            }
        } catch (e) {
            // parseInputsでエラーが発生した場合は無視
            elements.hiddenAxisCoord.innerHTML = '<option value="0">0</option><option value="custom">新規入力...</option>';
            elements.hiddenAxisCoord.value = '0';
        }
    };

    // 非表示軸座標の変更イベント（新規入力の処理）
    if (elements.hiddenAxisCoord) {
        elements.hiddenAxisCoord.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                const axisName = elements.hiddenAxisLabel.textContent.replace(' (m):', '');
                const newValue = prompt(`新しい${axisName}の値を入力してください (m):`, '0');
                if (newValue !== null && !isNaN(parseFloat(newValue))) {
                    const value = parseFloat(newValue);
                    // 新しい値をオプションに追加
                    const newOption = document.createElement('option');
                    newOption.value = value;
                    newOption.textContent = value;
                    // 「新規入力」の前に挿入
                    const customOption = e.target.querySelector('option[value="custom"]');
                    e.target.insertBefore(newOption, customOption);
                    e.target.value = value;
                } else {
                    // キャンセルまたは無効な値の場合、最初のオプションに戻す
                    e.target.selectedIndex = 0;
                }
            }
            drawOnCanvas();
        });
    }

    // 投影モード変更イベント
    if (elements.projectionMode) {
        elements.projectionMode.addEventListener('change', () => {
            // 投影モード変更時はパン・ズーム状態をリセット
            panZoomState.isInitialized = false;
            updateHiddenAxisLabel();
            updateHiddenAxisCoordOptions();
            drawOnCanvas();
        });
    }

    // モデル表示モード切り替え（2D/3D）
    const modelViewModeSelect = document.getElementById('model-view-mode');
    if (modelViewModeSelect) {
        modelViewModeSelect.addEventListener('change', () => {
            const mode = modelViewModeSelect.value;
            if (mode === '3d') {
                toggleModel3DView(true);
                // 3D表示に切り替えた後、自動スケーリングを実行
                setTimeout(() => {
                    if (typeof autoScaleModel3DView === 'function') {
                        autoScaleModel3DView();
                    }
                }, 100);
            } else {
                toggleModel3DView(false);
                // 2D表示に切り替えた後、自動スケーリングを実行
                setTimeout(() => {
                    if (window.triggerAutoScale) {
                        window.triggerAutoScale();
                    }
                }, 100);
            }
        });
    }

    // 部材情報表示チェックボックスのイベントリスナー
    if (elements.memberInfoToggle) {
        elements.memberInfoToggle.addEventListener('change', () => {
            // チェックが外された場合はツールチップを即座に非表示
            if (!elements.memberInfoToggle.checked) {
                hideMemberTooltip();
            }
        });
    }
    
    // 荷重表示制御チェックボックスのイベントリスナー
    const showExternalLoadsCheckbox = document.getElementById('show-external-loads');
    const showSelfWeightCheckbox = document.getElementById('show-self-weight');
    if (showExternalLoadsCheckbox) {
        showExternalLoadsCheckbox.addEventListener('change', drawOnCanvas);
    }
    if (showSelfWeightCheckbox) {
        showSelfWeightCheckbox.addEventListener('change', drawOnCanvas);
    }
    
    elements.saveBtn.addEventListener('click', saveInputData);
    elements.loadBtn.addEventListener('click', loadInputData);
    
    // ==========================================================================
    // モデル共有リンク機能
    // ==========================================================================
    const createShareLinkBtn = document.getElementById('create-share-link-btn');
    const shareLinkModal = document.getElementById('share-link-modal');
    const shareLinkModalClose = document.getElementById('share-link-modal-close');
    const shareLinkTextarea = document.getElementById('share-link-textarea');
    const copyShareLinkBtn = document.getElementById('copy-share-link-btn');

    // URLセーフなBase64エンコード関数
    function toBase64Url(u8) {
        return btoa(String.fromCharCode.apply(null, u8))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    // URLセーフなBase64デコード関数
    function fromBase64Url(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) {
            str += '=';
        }
        const decoded = atob(str);
        const u8 = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; ++i) {
            u8[i] = decoded.charCodeAt(i);
        }
        return u8;
    }

    // 共有リンクを生成する関数
    const generateShareLink = () => {
        try {
            const state = getCurrentState();
            const jsonString = JSON.stringify(state);
            const compressed = pako.deflate(jsonString);
            const encodedData = toBase64Url(compressed);
            const baseUrl = window.location.href.split('#')[0];
            const shareUrl = `${baseUrl}#model=${encodedData}`;

            shareLinkTextarea.value = shareUrl;
            shareLinkModal.style.display = 'flex';
        } catch (error) {
            console.error("共有リンクの生成に失敗しました:", error);
            alert("共有リンクの生成に失敗しました。");
        }
    };

    // 共有リンクからモデルを読み込む関数
    const loadFromShareLink = () => {
        try {
            if (window.location.hash && window.location.hash.startsWith('#model=')) {
                console.log("共有リンクからモデルを読み込みます...");
                if (shareLinkApplied) {
                    console.log('共有リンクは既に適用済みです。スキップします。');
                    return;
                }
                const encodedData = window.location.hash.substring(7);
                if (!encodedData) return;

                const compressed = fromBase64Url(encodedData);
                const jsonString = pako.inflate(compressed, { to: 'string' });
                const state = JSON.parse(jsonString);
                
                if (state && Array.isArray(state.nodes) && state.nodes.length > 0) {
                    shareLinkApplied = true;
                    historyStack = [];
                    elements.nodesTable.innerHTML = '';
                    elements.membersTable.innerHTML = '';
                    elements.nodeLoadsTable.innerHTML = '';
                    elements.memberLoadsTable.innerHTML = '';
                    clearResults();

                    restoreState(state);
                    runFullAnalysis();
                    console.log("モデルの読み込みが完了しました。");
                    if (elements.presetSelector) {
                        let shareOption = elements.presetSelector.querySelector('option[value="shared"]');
                        if (!shareOption) {
                            shareOption = document.createElement('option');
                            shareOption.value = 'shared';
                            shareOption.textContent = '共有リンクから読み込み';
                            shareOption.dataset.dynamic = 'share-link';
                            elements.presetSelector.insertBefore(shareOption, elements.presetSelector.firstChild);
                        }
                        elements.presetSelector.value = 'shared';
                    }
                    
                    history.replaceState(null, document.title, window.location.pathname + window.location.search);
                }
            }
        } catch (error) {
            console.error("共有リンクからのモデル読み込みに失敗しました:", error);
            alert("共有リンクからのモデル読み込みに失敗しました。リンクが破損している可能性があります。");
        }
    };

    // 共有モーダルのイベントリスナー
    if (createShareLinkBtn) {
        createShareLinkBtn.addEventListener('click', generateShareLink);
    }
    if (shareLinkModalClose) {
        shareLinkModalClose.addEventListener('click', () => shareLinkModal.style.display = 'none');
    }
    if (shareLinkModal) {
        shareLinkModal.addEventListener('click', (e) => {
            if (e.target === shareLinkModal) {
                shareLinkModal.style.display = 'none';
            }
        });
    }
    if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener('click', () => {
            shareLinkTextarea.select();
            document.execCommand('copy');
            copyShareLinkBtn.textContent = 'コピーしました！';
            setTimeout(() => {
                copyShareLinkBtn.textContent = 'リンクをコピー';
            }, 2000);
        });
    }

    // ページ読み込み時に共有リンクをチェック
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadFromShareLink);
    } else {
        loadFromShareLink();
    }
    
    // エクセル出力ボタンのイベントリスナー追加（エラーチェック付き）
    if (elements.exportExcelBtn) {
        console.log('エクセル出力ボタンにイベントリスナーを追加しています...');
        elements.exportExcelBtn.addEventListener('click', exportToExcelHandler);
        console.log('エクセル出力ボタンのイベントリスナーが追加されました');
    } else {
        console.error('エクセル出力ボタンが見つかりません！');
    }
    
    elements.reportBtn.addEventListener('click', generateReport);
    window.addEventListener('resize', drawOnCanvas);

    elements.autoScaleBtn.addEventListener('click', () => {
        console.log('=== AUTO SCALE BUTTON CLICKED ===');
        
        // 3D表示かどうかを判定
        const modelViewModeSelect = document.getElementById('model-view-mode');
        const is3DView = modelViewModeSelect && modelViewModeSelect.value === '3d';
        
        if (is3DView) {
            // 3D表示の場合
            console.log('3D表示モード: autoScaleModel3DView() を実行');
            if (typeof autoScaleModel3DView === 'function') {
                autoScaleModel3DView();
                console.log('3D auto-scale completed');
            } else {
                console.error('autoScaleModel3DView function not found');
            }
        } else {
            // 2D表示の場合
            console.log('2D表示モード: 既存の自動スケーリング処理を実行');
            console.log('panZoomState before reset:', JSON.stringify(panZoomState));
            panZoomState.isInitialized = false;
            console.log('panZoomState after reset:', JSON.stringify(panZoomState));
            console.log('Calling drawOnCanvas()...');
            drawOnCanvas();
            console.log('drawOnCanvas() completed');
            console.log('panZoomState after drawOnCanvas:', JSON.stringify(panZoomState));
        }
        
        console.log('=== AUTO SCALE BUTTON PROCESS COMPLETED ===');
    });

    // 入力検証の初期化
    initializeExistingInputValidation();

    // 選択された要素を削除する関数
    const deleteSelectedElements = () => {
        if (selectedNodes.size === 0 && selectedMembers.size === 0) {
            console.log('削除対象の要素が選択されていません');
            return;
        }

        const nodeCount = selectedNodes.size;
        const memberCount = selectedMembers.size;
        
        // 確認ダイアログ
        let confirmMessage = '';
        if (nodeCount > 0 && memberCount > 0) {
            confirmMessage = `選択された節点${nodeCount}個と部材${memberCount}個を削除しますか？\n関連する荷重も同時に削除されます。`;
        } else if (nodeCount > 0) {
            confirmMessage = `選択された節点${nodeCount}個を削除しますか？\n関連する部材と荷重も同時に削除されます。`;
        } else {
            confirmMessage = `選択された部材${memberCount}個を削除しますか？\n関連する荷重も同時に削除されます。`;
        }
        
        if (!confirm(confirmMessage)) {
            return;
        }

        pushState(); // 元に戻す用の状態保存

        try {
            // 節点の削除処理
            if (selectedNodes.size > 0) {
                deleteSelectedNodes();
            }

            // 部材の削除処理
            if (selectedMembers.size > 0) {
                deleteSelectedMembers();
            }

            // 選択をクリア
            clearMultiSelection();

            // テーブルの番号を振り直し
            renumberTables();

            // 再描画
            drawOnCanvas();

            console.log(`削除完了: 節点${nodeCount}個, 部材${memberCount}個`);
            
        } catch (error) {
            console.error('削除処理中にエラーが発生しました:', error);
            alert('削除処理中にエラーが発生しました: ' + error.message);
        }
    };

    // 選択された節点を削除する関数
    const deleteSelectedNodes = () => {
        // 節点インデックスを降順でソート（後ろから削除して番号ずれを防ぐ）
        const sortedNodeIndices = Array.from(selectedNodes).sort((a, b) => b - a);
        
        sortedNodeIndices.forEach(nodeIndex => {
            if (nodeIndex < elements.nodesTable.rows.length) {
                const deletedNodeNumber = nodeIndex + 1;
                
                // この節点に関連する部材を削除
                const membersToDelete = [];
                Array.from(elements.membersTable.rows).forEach((row, idx) => {
                    const startInput = row.cells[1].querySelector('input');
                    const endInput = row.cells[2].querySelector('input');
                    const startNode = parseInt(startInput.value);
                    const endNode = parseInt(endInput.value);
                    
                    if (startNode === deletedNodeNumber || endNode === deletedNodeNumber) {
                        membersToDelete.push(row);
                    }
                });
                
                // 部材を削除
                membersToDelete.forEach(row => row.remove());
                
                // この節点に関連する荷重を削除
                const nodeLoadsToDelete = [];
                Array.from(elements.nodeLoadsTable.rows).forEach(row => {
                    const nodeInput = row.cells[0].querySelector('input');
                    const nodeNumber = parseInt(nodeInput.value);
                    if (nodeNumber === deletedNodeNumber) {
                        nodeLoadsToDelete.push(row);
                    }
                });
                
                nodeLoadsToDelete.forEach(row => row.remove());
                
                // 節点を削除
                elements.nodesTable.rows[nodeIndex].remove();
                
                // より大きな番号の節点番号を調整
                updateNodeNumbersAfterDeletion(deletedNodeNumber);
            }
        });
    };

    // 選択された部材を削除する関数
    const deleteSelectedMembers = () => {
        // 部材インデックスを降順でソート
        const sortedMemberIndices = Array.from(selectedMembers).sort((a, b) => b - a);
        
        sortedMemberIndices.forEach(memberIndex => {
            if (memberIndex < elements.membersTable.rows.length) {
                const deletedMemberNumber = memberIndex + 1;
                
                // この部材に関連する荷重を削除
                const memberLoadsToDelete = [];
                Array.from(elements.memberLoadsTable.rows).forEach(row => {
                    const memberInput = row.cells[0].querySelector('input');
                    const memberNumber = parseInt(memberInput.value);
                    if (memberNumber === deletedMemberNumber) {
                        memberLoadsToDelete.push(row);
                    }
                });
                
                memberLoadsToDelete.forEach(row => row.remove());
                
                // 部材を削除
                elements.membersTable.rows[memberIndex].remove();
                
                // より大きな番号の部材番号を調整
                updateMemberNumbersAfterDeletion(deletedMemberNumber);
            }
        });
    };

    // 節点削除後の番号調整
    const updateNodeNumbersAfterDeletion = (deletedNodeNumber) => {
        // 部材表の節点番号を更新
        Array.from(elements.membersTable.rows).forEach(row => {
            const startInput = row.cells[1].querySelector('input');
            const endInput = row.cells[2].querySelector('input');
            
            const startNode = parseInt(startInput.value);
            const endNode = parseInt(endInput.value);
            
            if (startNode > deletedNodeNumber) {
                startInput.value = startNode - 1;
            }
            if (endNode > deletedNodeNumber) {
                endInput.value = endNode - 1;
            }
        });
        
        // 節点荷重表の節点番号を更新
        Array.from(elements.nodeLoadsTable.rows).forEach(row => {
            const nodeInput = row.cells[0].querySelector('input');
            const nodeNumber = parseInt(nodeInput.value);
            
            if (nodeNumber > deletedNodeNumber) {
                nodeInput.value = nodeNumber - 1;
            }
        });
    };

    // 部材削除後の番号調整
    const updateMemberNumbersAfterDeletion = (deletedMemberNumber) => {
        // 部材荷重表の部材番号を更新
        Array.from(elements.memberLoadsTable.rows).forEach(row => {
            const memberInput = row.cells[0].querySelector('input');
            const memberNumber = parseInt(memberInput.value);
            
            if (memberNumber > deletedMemberNumber) {
                memberInput.value = memberNumber - 1;
            }
        });
    };

    elements.resetModelBtn.addEventListener('click', () => {
        if (confirm('本当にモデル情報を全てリセットしますか？この操作は元に戻せません。')) {
            panZoomState.isInitialized = false;
            historyStack = [];
            elements.nodesTable.innerHTML = '';
            elements.membersTable.innerHTML = '';
            elements.nodeLoadsTable.innerHTML = '';
            elements.memberLoadsTable.innerHTML = '';
            clearResults();
            drawOnCanvas();
        }
    });
    
    // Initial Load
    if (!shareLinkApplied) {
        loadPreset(1);
        elements.presetSelector.value = 1;
    } else if (elements.presetSelector && elements.presetSelector.value !== 'shared') {
        elements.presetSelector.value = 'shared';
    }
    setCanvasMode('select');
    
    // 初期化時に自重表示を更新
    setTimeout(() => {
        updateSelfWeightDisplay();
    }, 100); // プリセット読み込み後に実行

    function applySectionAxisDataset(row, axisInfo) {
        if (!row) return;

        const normalizedAxis = normalizeAxisInfo(axisInfo);
        if (normalizedAxis) {
            row.dataset.sectionAxisKey = normalizedAxis.key;
            row.dataset.sectionAxisMode = normalizedAxis.mode;
            row.dataset.sectionAxisLabel = normalizedAxis.label;
        } else {
            delete row.dataset.sectionAxisKey;
            delete row.dataset.sectionAxisMode;
            delete row.dataset.sectionAxisLabel;
        }
    }

    function setRowSectionInfo(row, sectionInfo) {
        if (!(row instanceof HTMLTableRowElement) || typeof row.querySelector !== 'function') {
            console.warn('setRowSectionInfo called with invalid row element:', row);
            return;
        }

        const sectionNameSpan = row.querySelector('.section-name-cell');
        const sectionAxisSpan = row.querySelector('.section-axis-cell');

        if (sectionInfo) {
            const enrichedInfo = ensureSectionSvgMarkup(sectionInfo);
            try {
                row.dataset.sectionInfo = encodeURIComponent(JSON.stringify(enrichedInfo));
            } catch (error) {
                console.error('Failed to encode sectionInfo:', error, enrichedInfo);
                row.dataset.sectionInfo = '';
            }
            row.dataset.sectionLabel = enrichedInfo.label || '';
            row.dataset.sectionSummary = enrichedInfo.dimensionSummary || '';
            row.dataset.sectionSource = enrichedInfo.source || '';
            applySectionAxisDataset(row, enrichedInfo.axis);

            let displayName = enrichedInfo.label || '-';
            if (enrichedInfo.rawDims) {
                const dims = enrichedInfo.rawDims;
                const dimParts = [];
                if (dims.H !== undefined) dimParts.push(dims.H);
                if (dims.B !== undefined) dimParts.push(dims.B);
                if (dims.t1 !== undefined) dimParts.push(dims.t1);
                if (dims.t2 !== undefined) dimParts.push(dims.t2);
                if (dimParts.length > 0) {
                    const baseName = enrichedInfo.typeLabel || (enrichedInfo.label ? enrichedInfo.label.split(' ')[0] : '');
                    displayName = `${baseName} ${dimParts.join('×')}`.trim();
                }
            }

            if (sectionNameSpan) {
                sectionNameSpan.textContent = displayName || '-';
            }

            if (sectionAxisSpan) {
                sectionAxisSpan.textContent = enrichedInfo.axis?.label || '-';
            }
        } else {
            delete row.dataset.sectionInfo;
            delete row.dataset.sectionLabel;
            delete row.dataset.sectionSummary;
            delete row.dataset.sectionSource;
            applySectionAxisDataset(row, null);

            if (sectionNameSpan) {
                sectionNameSpan.textContent = '-';
            }

            if (sectionAxisSpan) {
                sectionAxisSpan.textContent = '-';
            }
        }
    }

    function updateMemberProperties(memberIndex, props) {
        if (memberIndex >= 0 && memberIndex < elements.membersTable.rows.length) {
            const row = elements.membersTable.rows[memberIndex];
            const eSelect = row.cells[3].querySelector('select'), eInput = row.cells[3].querySelector('input[type="number"]');

            // E値の更新 (もしあれば)
            if (props.E) {
                const eValue = props.E.toString();
                eInput.value = eValue;
                eSelect.value = Array.from(eSelect.options).some(opt=>opt.value===eValue) ? eValue : 'custom';
                eInput.readOnly = eSelect.value !== 'custom';
                // E値の変更は強度入力欄の再生成をトリガーするため、changeイベントを発火させる
                eSelect.dispatchEvent(new Event('change'));
            }

            // ========== ここからが主要な修正点 ==========
            // props.F ではなく props.strengthValue をチェックし、タイプに応じて値を設定
            if (props.strengthValue) {
                // E値変更で再生成された後の要素を確実につかむため、少し待機する
                setTimeout(() => {
                    const strengthInputContainer = row.cells[4].firstElementChild;
                    if (strengthInputContainer) {
                        const s_input = strengthInputContainer.querySelector('input');
                        const s_select = strengthInputContainer.querySelector('select');
                        const s_type = props.strengthType;
                        const s_value = props.strengthValue;

                        if (s_type === 'wood-type') {
                            // 木材の場合：selectの値を更新
                            if(s_select) s_select.value = s_value;
                        } else {
                            // 鋼材、コンクリート、その他F値を持つ材料の場合
                            if(s_select && s_input) {
                                // プリセットに値が存在するかチェック
                                const isPreset = Array.from(s_select.options).some(opt => opt.value === s_value.toString());
                                if(isPreset) {
                                    s_select.value = s_value;
                                    s_input.value = s_value;
                                    s_input.readOnly = true;
                                } else {
                                    s_select.value = 'custom';
                                    s_input.value = s_value;
                                    s_input.readOnly = false;
                                }
                            }
                        }
                    }
                }, 0);
            }
            // ========== ここまでが主要な修正点 ==========

            // 3D用の正しいセルインデックス（Iw列追加によりA以降が+1）
            const ixInputEl = row.cells[5]?.querySelector('input[type="number"]');  // Ix
            const iyInputEl = row.cells[6]?.querySelector('input[type="number"]');  // Iy
            const jInputEl = row.cells[7]?.querySelector('input[type="number"]');   // J
            const iwInputEl = row.cells[8]?.querySelector('input[type="number"]');  // Iw
            const areaInputEl = row.cells[9]?.querySelector('input[type="number"]'); // A
            const zxInputEl = row.cells[10]?.querySelector('input[type="number"]');  // Zx
            const zyInputEl = row.cells[11]?.querySelector('input[type="number"]'); // Zy

            if (typeof memberIndex === 'number') {
                // Ix または I の更新
                if (ixInputEl && (props.Ix !== undefined || props.I !== undefined)) {
                    ixInputEl.value = props.Ix ?? props.I;
                }
                // Iy の更新
                if (iyInputEl && props.Iy !== undefined) {
                    iyInputEl.value = props.Iy;
                }
                // J の更新
                if (jInputEl && props.J !== undefined) {
                    jInputEl.value = props.J;
                }
                // Iw の更新
                if (iwInputEl && props.Iw !== undefined) {
                    iwInputEl.value = props.Iw;
                }
                // A の更新
                if (areaInputEl && props.A !== undefined && props.A !== null) {
                    areaInputEl.value = props.A;
                }
                // Zx または Z の更新
                if (zxInputEl && (props.Zx !== undefined || props.Z !== undefined)) {
                    zxInputEl.value = props.Zx ?? props.Z;
                }
                // Zy の更新
                if (zyInputEl && props.Zy !== undefined) {
                    zyInputEl.value = props.Zy;
                }

                // 断面名称と軸方向のセルを更新（密度列の有無を考慮）
                const hasDensityColumn = row.querySelector('.density-cell') !== null;
                const sectionNameCellIndex = hasDensityColumn ? 13 : 12;
                const sectionAxisCellIndex = hasDensityColumn ? 14 : 13;

                const sectionNameCell = row.cells[sectionNameCellIndex];
                const sectionAxisCell = row.cells[sectionAxisCellIndex];

                // 断面名称を生成（寸法付き）
                let displaySectionName = props.sectionName || props.sectionLabel || '';
                if (props.sectionInfo && props.sectionInfo.rawDims) {
                    const info = props.sectionInfo;
                    const dims = info.rawDims;
                    const parts = [info.typeLabel || ''];
                    if (dims.H != null) parts.push(dims.H);
                    if (dims.B != null) parts.push(dims.B);
                    if (dims.t1 != null) parts.push(dims.t1);
                    if (dims.t2 != null) parts.push(dims.t2);
                    if (parts.length > 1) {
                        displaySectionName = parts.join('×');
                    }
                }
                
                // axisまたはsectionAxisLabelを取得
                const displayAxisLabel = props.sectionAxisLabel || (props.sectionAxis ? props.sectionAxis.label : null) || props.axis || '';

                if (sectionNameCell) {
                    const sectionNameSpan = sectionNameCell.querySelector('.section-name-cell');
                    if (sectionNameSpan && displaySectionName) {
                        sectionNameSpan.textContent = displaySectionName;
                    }
                }

                if (sectionAxisCell) {
                    const sectionAxisSpan = sectionAxisCell.querySelector('.section-axis-cell');
                    if (sectionAxisSpan && displayAxisLabel) {
                        sectionAxisSpan.textContent = displayAxisLabel;
                    }
                }
            }

            const normalizeAxisFromProps = () => {
                if (props.sectionAxis) {
                    return normalizeAxisInfo(props.sectionAxis);
                }
                if (props.sectionInfo?.axis) {
                    return normalizeAxisInfo(props.sectionInfo.axis);
                }
                if (row.dataset.sectionAxisKey || row.dataset.sectionAxisMode || row.dataset.sectionAxisLabel) {
                    return normalizeAxisInfo({
                        key: row.dataset.sectionAxisKey,
                        mode: row.dataset.sectionAxisMode,
                        label: row.dataset.sectionAxisLabel
                    });
                }
                return null;
            };

            const axisInfo = normalizeAxisFromProps();
            const setDatasetValue = (key, value) => {
                if (value !== undefined && value !== null && value !== '') {
                    row.dataset[key] = value;
                } else {
                    delete row.dataset[key];
                }
            };

            const resolvedZx = props.Zx ?? (axisInfo?.key === 'both' ? props.Z : undefined);
            const resolvedZy = props.Zy ?? (axisInfo?.key === 'both' ? props.Z : undefined);
            const resolvedIx = props.ix ?? (axisInfo?.key === 'both' ? props.iy : undefined);
            const resolvedIy = props.iy ?? (axisInfo?.key === 'both' ? props.ix : undefined);

            setDatasetValue('zx', resolvedZx);
            setDatasetValue('zy', resolvedZy);
            setDatasetValue('ix', resolvedIx);
            setDatasetValue('iy', resolvedIy);

            // 横座屈等で必要となる断面特性（cm系で保持）
            // J: cm^4, Iw: cm^6
            setDatasetValue('j', props.J);
            setDatasetValue('iw', props.Iw);

            if (props.sectionInfo) {
                setRowSectionInfo(row, props.sectionInfo);
            } else if (props.sectionAxis) {
                applySectionAxisDataset(row, props.sectionAxis);
            }

            // 変更を計算に反映させるためにchangeイベントを発火
            ixInputEl?.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            console.error(`無効な部材インデックス: ${memberIndex}`);
        }
    }


    window.addEventListener('storage', (e) => {
        if (e.key === 'steelSelectionForFrameAnalyzer' && e.newValue) {
            try {
                const data = JSON.parse(e.newValue);
                if (data && data.targetMemberIndex !== undefined && data.properties) {
                    if (data.targetMemberIndex === 'bulk') {
                        window.bulkSectionProperties = data.properties;
                        if (typeof updateBulkSectionInfo === 'function') {
                            updateBulkSectionInfo(data.properties);
                        }
                    } else if (data.targetMemberIndex === 'addDefaults') {
                        // 新規部材追加時の処理
                        const props = data.properties;
                        console.log('✅ 部材追加設定(addDefaults)の断面データを受信:', props);

                        // ポップアップ内の入力欄を更新
                        document.getElementById('add-popup-i').value = props.I;
                        document.getElementById('add-popup-a').value = props.A;
                        document.getElementById('add-popup-z').value = props.Z;

                        // デフォルト値を更新
                        newMemberDefaults.I = props.I;
                        newMemberDefaults.A = props.A;
                        newMemberDefaults.Z = props.Z;

                        // 断面情報（名称と軸）を保存・表示
                        const sectionName = props.sectionName || props.sectionLabel || '';
                        const axisLabel = props.selectedAxis || props.sectionAxisLabel || (props.sectionAxis ? props.sectionAxis.label : null) || '-';

                        if (sectionName) {
                            newMemberDefaults.sectionInfo = props.sectionInfo; // 断面情報オブジェクト全体を保存
                            newMemberDefaults.sectionName = sectionName;
                            newMemberDefaults.sectionAxis = axisLabel;

                            const infoDiv = document.getElementById('add-popup-section-info');
                            const nameSpan = document.getElementById('add-popup-section-name');
                            const axisSpan = document.getElementById('add-popup-section-axis');

                            if (infoDiv && nameSpan && axisSpan) {
                                nameSpan.textContent = sectionName;
                                axisSpan.textContent = axisLabel;
                                infoDiv.style.display = 'block';
                            }
                        }
                    } else {
                        updateMemberProperties(data.targetMemberIndex, data.properties);
                    }
                    localStorage.removeItem('steelSelectionForFrameAnalyzer');
                }
            } catch (error) {
                console.error('localStorageからのデータ解析に失敗しました:', error);
            }
        }
    });

    // 自動スケーリング機能（手動ボタン用）
    window.triggerAutoScale = () => {
        console.log('triggerAutoScale called');
        
        // 3D表示かどうかを判定
        const modelViewModeSelect = document.getElementById('model-view-mode');
        const is3DView = modelViewModeSelect && modelViewModeSelect.value === '3d';
        
        if (is3DView) {
            // 3D表示の場合
            console.log('3D表示モード: autoScaleModel3DView() を実行');
            if (typeof autoScaleModel3DView === 'function') {
                autoScaleModel3DView();
                console.log('3D auto-scale completed');
            } else {
                console.error('autoScaleModel3DView function not found');
            }
        } else {
            // 2D表示の場合
            console.log('2D表示モード: 既存の自動スケーリング処理を実行');
            panZoomState.isInitialized = false;
            drawOnCanvas();
            console.log('Auto scale completed. New panZoomState:', panZoomState);
        }
    };
    
    // 手動でリサイズを実行する関数（デバッグ用）
    window.triggerManualResize = () => {
        console.log('Manual resize triggered');
        panZoomState.isInitialized = false;
        drawOnCanvas();
    };

    // リサイズ検出機能（ResizeObserverを使用）
    const modelCanvasContainer = document.querySelector('.input-section .canvas-container');
    
    if (modelCanvasContainer) {
        let lastKnownSize = { width: 0, height: 0 };
        
        // ResizeObserver対応確認
        if (typeof ResizeObserver === 'undefined') {
            console.error('ResizeObserver is not supported in this browser');
            return;
        }
        
        // ResizeObserverを使用してコンテナのリサイズを監視
        const resizeObserver = new ResizeObserver((entries) => {
            // 3D表示中かチェック
            const modelViewModeSelect = document.getElementById('model-view-mode');
            const is3DMode = modelViewModeSelect && modelViewModeSelect.value === '3d';
            
            if (is3DMode) {
                return; // 3D表示中は2D描画をスキップ
            }
            
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const currentSize = { width: Math.round(width), height: Math.round(height) };
                
                // サイズが実際に変更された場合のみ処理
                if (currentSize.width !== lastKnownSize.width || currentSize.height !== lastKnownSize.height) {
                    lastKnownSize = currentSize;
                    
                    // 自動スケーリングを実行
                    panZoomState.isInitialized = false;
                    drawOnCanvas();
                }
            }
        });
        
        resizeObserver.observe(modelCanvasContainer);
        
        // 初期サイズを記録
        setTimeout(() => {
            const rect = modelCanvasContainer.getBoundingClientRect();
            lastKnownSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
        }, 100);
    }

    // 代替リサイズ検出方法（フォールバック）
    let fallbackLastSize = { width: 0, height: 0 };
    
    const fallbackResizeCheck = () => {
        // 3D表示中かチェック
        const modelViewModeSelect = document.getElementById('model-view-mode');
        const is3DMode = modelViewModeSelect && modelViewModeSelect.value === '3d';
        
        if (is3DMode) {
            return; // 3D表示中は2D描画をスキップ
        }
        
        const container = document.querySelector('.input-section .canvas-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            const currentSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
            
            if (currentSize.width !== fallbackLastSize.width || currentSize.height !== fallbackLastSize.height) {
                fallbackLastSize = currentSize;
                panZoomState.isInitialized = false;
                drawOnCanvas();
            }
        }
    };
    
    // 初期サイズを記録（フォールバック用）
    setTimeout(() => {
        const container = document.querySelector('.input-section .canvas-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            fallbackLastSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
        }
    }, 200);
    
    // 定期的なサイズチェック（フォールバック）
    setInterval(fallbackResizeCheck, 500);
    
    // マウスイベント時のチェック（リサイズハンドル操作検出）
    document.addEventListener('mouseup', () => {
        setTimeout(fallbackResizeCheck, 50);
    });
    
    document.addEventListener('mousemove', (e) => {
        // リサイズ中かどうかをチェック（カーソルがリサイズ用の場合）
        if (e.target && e.target.closest && e.target.closest('.input-section .canvas-container')) {
            const container = e.target.closest('.input-section .canvas-container');
            const rect = container.getBoundingClientRect();
            const isNearBottomRight = (e.clientY > rect.bottom - 20) && (e.clientX > rect.right - 20);
            
            if (isNearBottomRight) {
                // リサイズハンドル付近でのマウス移動を検出
                setTimeout(fallbackResizeCheck, 100);
            }
        }
    });



    // SheetJSライブラリの動的読み込み
    function loadSheetJS() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            script.onload = () => {
                console.log('SheetJSライブラリが読み込まれました');
                resolve();
            };
            script.onerror = () => {
                reject(new Error('SheetJSライブラリの読み込みに失敗しました'));
            };
            document.head.appendChild(script);
        });
    }

    // エクセルファイル生成・出力
    async function exportToExcel() {
        console.log('エクセルファイルを生成中...');
        
        // ワークブック作成
        const workbook = XLSX.utils.book_new();
        
        try {
            // 1. 入力データシート
            await addInputDataSheet(workbook);
            
            // 2. 解析結果シート
            if (lastAnalysisResult && lastAnalysisResult.displacements) {
                await addAnalysisResultSheet(workbook);
            }
            
            // 3. 断面検定結果シート
            if ((lastAnalysisResult && lastAnalysisResult.sectionCheckResults && lastAnalysisResult.sectionCheckResults.length > 0) ||
                (lastSectionCheckResults && lastSectionCheckResults.length > 0)) {
                await addSectionCheckSheet(workbook);
            }
            
            // 4. 座屈解析結果シート
            if (lastBucklingResults && lastBucklingResults.length > 0) {
                await addBucklingAnalysisSheet(workbook);
            }
            
            // ファイル名生成
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:\-T]/g, '');
            const filename = `構造解析結果_${timestamp}.xlsx`;
            
            // エクセルファイル出力
            XLSX.writeFile(workbook, filename);
            
            console.log('エクセルファイルが正常に出力されました:', filename);
            alert('エクセルファイルが正常に出力されました: ' + filename);
            
        } catch (error) {
            console.error('エクセルファイル生成でエラーが発生しました:', error);
            throw error;
        }
    }

    // 入力データシート作成
    async function addInputDataSheet(workbook) {
        console.log('入力データシートを作成中...');
        
        const data = [];
        
        // ヘッダー情報
        data.push(['2次元フレームの構造解析結果']);
        data.push(['生成日時', new Date().toLocaleString('ja-JP')]);
        data.push([]);
        
        try {
            const inputs = parseInputs();
            
            // 節点データ
            data.push(['■ 節点データ']);
            data.push(['節点番号', 'X座標(m)', 'Y座標(m)', '境界条件']);
            inputs.nodes.forEach((node, i) => {
                data.push([i + 1, node.x, node.y, node.support]);
            });
            data.push([]);
            
            // 部材データ
            data.push(['■ 部材データ']);
            data.push(['部材番号', 'i節点', 'j節点', '長さ(m)', '材料', 'E(N/mm²)', 'A(mm²)', 'I(mm⁴)', 'i端接合', 'j端接合']);
            inputs.members.forEach((member, i) => {
                data.push([
                    i + 1, 
                    member.i + 1, 
                    member.j + 1, 
                    member.length.toFixed(3),
                    member.material || '不明',
                    member.E || 0,
                    member.A || 0,
                    member.I || 0,
                    member.i_conn || 'fixed',
                    member.j_conn || 'fixed'
                ]);
            });
            data.push([]);
            
            // 節点荷重データ
            if (inputs.nodeLoads && inputs.nodeLoads.length > 0) {
                data.push(['■ 節点荷重データ']);
                data.push(['節点番号', 'Px(kN)', 'Py(kN)', 'Mz(kN·m)']);
                inputs.nodeLoads.forEach(load => {
                    if (load.px !== 0 || load.py !== 0 || load.mz !== 0) {
                        data.push([load.nodeIndex + 1, load.px, load.py, load.mz]);
                    }
                });
                data.push([]);
            }
            
            // 部材荷重データ
            if (inputs.memberLoads && inputs.memberLoads.length > 0) {
                data.push(['■ 部材荷重データ']);
                data.push(['部材番号', '分布荷重(kN/m)']);
                inputs.memberLoads.forEach(load => {
                    if (load.w !== 0) {
                        data.push([load.memberIndex + 1, load.w]);
                    }
                });
            }
            
        } catch (error) {
            console.error('入力データの解析でエラーが発生しました:', error);
            data.push(['※入力データの解析でエラーが発生しました']);
        }
        
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, '入力データ');
    }

    // 解析結果シート作成
    async function addAnalysisResultSheet(workbook) {
        console.log('解析結果シートを作成中...');
        
        const data = [];
        data.push(['■ 解析結果']);
        data.push([]);
        
        if (lastAnalysisResult && lastAnalysisResult.displacements && lastAnalysisResult.displacements.length > 0) {
            const dispSample = lastAnalysisResult.displacements[0];
            const is3DDisp = dispSample && typeof dispSample.z === 'number';

            data.push(['■ 節点変位結果']);
            if (is3DDisp) {
                data.push(['節点番号', 'X変位(mm)', 'Y変位(mm)', 'Z変位(mm)', 'θx(rad)', 'θy(rad)', 'θz(rad)']);
                lastAnalysisResult.displacements.forEach((disp, i) => {
                    data.push([
                        i + 1,
                        (disp.x * 1000).toFixed(3),
                        (disp.y * 1000).toFixed(3),
                        (disp.z * 1000).toFixed(3),
                        disp.rx.toFixed(6),
                        disp.ry.toFixed(6),
                        disp.rz.toFixed(6)
                    ]);
                });
            } else {
                data.push(['節点番号', 'X変位(mm)', 'Y変位(mm)', '回転(rad)']);
                lastAnalysisResult.displacements.forEach((disp, i) => {
                    data.push([i + 1, (disp.x * 1000).toFixed(3), (disp.y * 1000).toFixed(3), disp.rotation.toFixed(6)]);
                });
            }
            data.push([]);
        } else {
            data.push(['※ 節点変位結果がありません']);
            data.push([]);
        }
        
        if (lastAnalysisResult && lastAnalysisResult.forces && lastAnalysisResult.forces.length > 0) {
            const forceSample = lastAnalysisResult.forces[0];
            const is3DForce = forceSample && forceSample.i && Object.prototype.hasOwnProperty.call(forceSample.i, 'Vy');

            data.push(['■ 部材力結果']);
            if (is3DForce) {
                data.push([
                    '部材番号',
                    'i端軸力(kN)', 'i端せん断力Vy(kN)', 'i端せん断力Vz(kN)', 'i端ねじりTx(kN·m)', 'i端曲げMy(kN·m)', 'i端曲げMz(kN·m)',
                    'j端軸力(kN)', 'j端せん断力Vy(kN)', 'j端せん断力Vz(kN)', 'j端ねじりTx(kN·m)', 'j端曲げMy(kN·m)', 'j端曲げMz(kN·m)'
                ]);
                lastAnalysisResult.forces.forEach((force, i) => {
                    data.push([
                        i + 1,
                        force.i.N.toFixed(2),
                        force.i.Vy.toFixed(2),
                        force.i.Vz.toFixed(2),
                        force.i.Tx.toFixed(2),
                        force.i.My.toFixed(2),
                        force.i.Mz.toFixed(2),
                        force.j.N.toFixed(2),
                        force.j.Vy.toFixed(2),
                        force.j.Vz.toFixed(2),
                        force.j.Tx.toFixed(2),
                        force.j.My.toFixed(2),
                        force.j.Mz.toFixed(2)
                    ]);
                });
            } else {
                data.push(['部材番号', 'i端軸力(kN)', 'i端せん断力(kN)', 'i端曲げモーメント(kN·m)', 'j端軸力(kN)', 'j端せん断力(kN)', 'j端曲げモーメント(kN·m)']);
                lastAnalysisResult.forces.forEach((force, i) => {
                    data.push([
                        i + 1,
                        force.i.N.toFixed(2),
                        force.i.Q.toFixed(2),
                        force.i.M.toFixed(2),
                        force.j.N.toFixed(2),
                        force.j.Q.toFixed(2),
                        force.j.M.toFixed(2)
                    ]);
                });
            }
        } else {
            data.push(['※ 部材力結果がありません']);
        }
        
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, '解析結果');
    }

    // 断面検定結果シート作成
    async function addSectionCheckSheet(workbook) {
        console.log('断面検定結果シートを作成中...');
        
        const data = [];
        data.push(['■ 断面検定結果']);
        data.push([]);
        data.push(['部材番号', '軸力(kN)', '曲げモーメント(kN·m)', '検定項目', '検定比', '判定', '材料情報', '詳細計算結果']);
        
        // 優先順位: lastAnalysisResult.sectionCheckResults > lastSectionCheckResults
        const sectionResults = (lastAnalysisResult && lastAnalysisResult.sectionCheckResults) || lastSectionCheckResults;
        
        if (sectionResults && sectionResults.length > 0) {
            sectionResults.forEach((result, i) => {
                // 検定比の表示
                let ratioText = '-';
                if (typeof result.maxRatio === 'number' && isFinite(result.maxRatio)) {
                    ratioText = result.maxRatio.toFixed(3);
                } else if (result.maxRatio) {
                    ratioText = result.maxRatio.toString();
                }
                
                // 判定
                let judgment = '-';
                if (result.status) {
                    judgment = result.status === 'NG' ? 'NG' : 'OK';
                } else if (typeof result.maxRatio === 'number') {
                    judgment = result.maxRatio <= 1.0 ? 'OK' : 'NG';
                }
                
                // 材料情報の取得（弾性係数から材料名を取得）
                let materialInfo = '';
                if (lastAnalysisResult && lastAnalysisResult.members && lastAnalysisResult.members[i]) {
                    const member = lastAnalysisResult.members[i];
                    
                    // 弾性係数から材料名を取得
                    const getMaterialNameFromE = (eValue) => {
                        const materials = { 
                            "205000000": "スチール", 
                            "193000000": "ステンレス", 
                            "70000000": "アルミニウム", 
                            "7000000": "木材", 
                            "8000000": "木材", 
                            "9000000": "木材", 
                            "10000000": "木材" 
                        };
                        const eStr = Math.round(eValue).toString();
                        return materials[eStr] || `任意材料(E=${(eValue/1000000).toLocaleString()}GPa)`;
                    };
                    
                    if (member.E) {
                        const materialName = getMaterialNameFromE(member.E);
                        if (member.strengthProps && member.strengthProps.value) {
                            materialInfo = `${materialName} (F=${member.strengthProps.value})`;
                        } else {
                            materialInfo = materialName;
                        }
                    } else if (member.strengthProps) {
                        materialInfo = `${member.strengthProps.type}: ${member.strengthProps.value}`;
                    } else if (member.material) {
                        materialInfo = member.material;
                    }
                }
                
                // 詳細計算結果の作成
                let detailResults = '';
                if (result.details) {
                    detailResults = result.details;
                } else if (result.ratios && result.ratios.length > 0) {
                    // 応力度と許容応力度の詳細
                    const details = [];
                    if (result.σt !== undefined && result.ft !== undefined) {
                        details.push(`引張: σt=${result.σt?.toFixed(2) || 0} ≤ ft=${result.ft?.toFixed(2) || 0} (${(result.σt/result.ft)?.toFixed(3) || 0})`);
                    }
                    if (result.σc !== undefined && result.fc !== undefined) {
                        details.push(`圧縮: σc=${result.σc?.toFixed(2) || 0} ≤ fc=${result.fc?.toFixed(2) || 0} (${(result.σc/result.fc)?.toFixed(3) || 0})`);
                    }
                    if (result.σb !== undefined && result.fb !== undefined) {
                        details.push(`曲げ: σb=${result.σb?.toFixed(2) || 0} ≤ fb=${result.fb?.toFixed(2) || 0} (${(result.σb/result.fb)?.toFixed(3) || 0})`);
                    }
                    if (result.τ !== undefined && result.fs !== undefined) {
                        details.push(`せん断: τ=${result.τ?.toFixed(2) || 0} ≤ fs=${result.fs?.toFixed(2) || 0} (${(result.τ/result.fs)?.toFixed(3) || 0})`);
                    }
                    
                    if (details.length > 0) {
                        detailResults = details.join('; ');
                    } else if (lastAnalysisResult && lastAnalysisResult.members && lastAnalysisResult.members[i]) {
                        const member = lastAnalysisResult.members[i];
                        const N = result.N || 0;
                        const M = result.M || 0;
                        const A = member.A || 1;
                        const Z = member.Z || 1;
                        
                        const σ_axial = Math.abs(N * 1000 / (A * 1e6)); // N/mm²
                        const σ_bending = Math.abs(M * 1e6 / (Z * 1e9)); // N/mm²
                        const σ_combined = σ_axial + σ_bending;
                        
                        detailResults = `軸応力度: ${σ_axial.toFixed(2)} N/mm²; 曲げ応力度: ${σ_bending.toFixed(2)} N/mm²; 合成: ${σ_combined.toFixed(2)} N/mm²`;
                    }
                }
                
                data.push([
                    i + 1,
                    (result.N || 0).toFixed(2),
                    (result.M || 0).toFixed(2),
                    result.checkType || '不明',
                    ratioText,
                    judgment,
                    materialInfo || '不明',
                    detailResults || '-'
                ]);
            });
            
            // 各部材の詳細応力度計算結果を追加
            data.push([]);
            data.push(['■ 各部材の詳細応力度計算結果']);
            data.push([]);
            
            // 計算に必要なデータを取得
            if (lastResults) {
                const { members, forces, memberLoads } = lastResults;
                const selectedTerm = document.querySelector('input[name="load-term"]:checked')?.value || 'short';
                
                sectionResults.forEach((result, memberIndex) => {
                    const member = members[memberIndex];
                    const force = forces[memberIndex];
                    const load = memberLoads.find(l => l.memberIndex === memberIndex);
                    const w = getMemberDistributedLoadY(load);
                    const L = member.length;
                    
                    // 材料特性の取得
                    const { strengthProps, A, Z, ix, iy, E } = member;
                    let materialInfo = '';
                    let allowableStresses = { ft: 0, fc: 0, fb: 0, fs: 0 };
                    
                    // 弾性係数から材料名を取得する関数
                    const getMaterialNameFromE_Detail = (eValue) => {
                        const materials = { 
                            "205000000": "スチール", 
                            "193000000": "ステンレス", 
                            "70000000": "アルミニウム", 
                            "7000000": "木材", 
                            "8000000": "木材", 
                            "9000000": "木材", 
                            "10000000": "木材" 
                        };
                        const eStr = Math.round(eValue).toString();
                        return materials[eStr] || `任意材料(E=${(eValue/1000000).toLocaleString()}GPa)`;
                    };
                    
                    const termIndex = (selectedTerm === 'long') ? 0 : 1;
                    
                    switch(strengthProps.type) {
                        case 'F-value':
                        case 'F-stainless':
                        case 'F-aluminum':
                            const F = strengthProps.value;
                            const factor = (selectedTerm === 'long') ? 1.5 : 1.0;
                            const materialName = getMaterialNameFromE_Detail(E);
                            materialInfo = `${materialName} (F=${F} N/mm²)`;
                            allowableStresses.ft = F / factor;
                            allowableStresses.fb = F / factor;
                            allowableStresses.fs = F / (factor * Math.sqrt(3));
                            
                            // 座屈を考慮した圧縮許容応力度
                            const lk = L, i_min = Math.min(ix, iy);
                            allowableStresses.fc = allowableStresses.ft;
                            if (i_min > 1e-9) {
                                const lambda = lk / i_min, E_n_mm2 = E * 1e-3;
                                const lambda_p = Math.PI * Math.sqrt(E_n_mm2 / (0.6 * F));
                                if (lambda <= lambda_p) {
                                    allowableStresses.fc = (1 - 0.4 * (lambda / lambda_p)**2) * F / factor;
                                } else {
                                    allowableStresses.fc = (0.277 * F) / ((lambda / lambda_p)**2);
                                }
                            }
                            break;
                        case 'wood-type':
                            const woodPreset = strengthProps.preset;
                            const woodMaterialName = getMaterialNameFromE_Detail(E);
                            if (woodPreset === 'custom') {
                                materialInfo = `${woodMaterialName} (任意入力)`;
                                const customShortStresses = strengthProps.stresses;
                                if (selectedTerm === 'long') {
                                    allowableStresses.ft = customShortStresses.ft * 1.1 / 2;
                                    allowableStresses.fc = customShortStresses.fc * 1.1 / 2;
                                    allowableStresses.fb = customShortStresses.fb * 1.1 / 2;
                                    allowableStresses.fs = customShortStresses.fs * 1.1 / 2;
                                } else {
                                    allowableStresses.ft = customShortStresses.ft;
                                    allowableStresses.fc = customShortStresses.fc;
                                    allowableStresses.fb = customShortStresses.fb;
                                    allowableStresses.fs = customShortStresses.fs;
                                }
                            } else {
                                const baseStresses = WOOD_BASE_STRENGTH_DATA[woodPreset];
                                materialInfo = `${woodMaterialName} (${baseStresses.name})`;
                                const factor = (selectedTerm === 'long') ? (1.1 / 3) : (2 / 3);
                                allowableStresses.ft = baseStresses.ft * factor;
                                allowableStresses.fc = baseStresses.fc * factor;
                                allowableStresses.fb = baseStresses.fb * factor;
                                allowableStresses.fs = baseStresses.fs * factor;
                            }
                            break;
                        default:
                            const defaultMaterialName = getMaterialNameFromE_Detail(E);
                            materialInfo = defaultMaterialName;
                    }
                    
                    // 部材の詳細情報を出力
                    data.push([`部材 ${memberIndex + 1} の詳細計算`]);
                    data.push([]);
                    data.push(['項目', '値', '単位', '備考']);
                    
                    // 部材情報
                    data.push(['材料', materialInfo, '', '']);
                    data.push(['部材長', L.toFixed(3), 'm', '']);
                    data.push(['断面積 A', (A * 1e4).toFixed(2), 'cm²', '']);
                    data.push(['断面係数 Z', (Z * 1e6).toFixed(2), 'cm³', '']);
                    data.push(['回転半径 ix', (ix * 1e2).toFixed(2), 'cm', '']);
                    data.push(['回転半径 iy', (iy * 1e2).toFixed(2), 'cm', '']);
                    if (w !== 0) data.push(['等分布荷重', w, 'kN/m', '']);
                    data.push([]);
                    
                    // 許容応力度
                    data.push(['許容応力度', `(${selectedTerm === 'long' ? '長期' : '短期'})`, '', '']);
                    data.push(['引張許容応力度 ft', allowableStresses.ft.toFixed(2), 'N/mm²', '']);
                    data.push(['圧縮許容応力度 fc', allowableStresses.fc.toFixed(2), 'N/mm²', '']);
                    data.push(['曲げ許容応力度 fb', allowableStresses.fb.toFixed(2), 'N/mm²', '']);
                    data.push(['せん断許容応力度 fs', allowableStresses.fs.toFixed(2), 'N/mm²', '']);
                    data.push([]);
                    
                    // 部材端力
                    data.push(['部材端力']);
                    data.push(['i端 軸力', (-force.N_i).toFixed(2), 'kN', '']);
                    data.push(['i端 せん断力', force.Q_i.toFixed(2), 'kN', '']);
                    data.push(['i端 曲げモーメント', force.M_i.toFixed(2), 'kN·m', '']);
                    data.push(['j端 軸力', force.N_j.toFixed(2), 'kN', '']);
                    data.push(['j端 せん断力', (-force.Q_j).toFixed(2), 'kN', '']);
                    data.push(['j端 曲げモーメント', force.M_j.toFixed(2), 'kN·m', '']);
                    data.push([]);
                    
                    // 応力度計算結果（21点での詳細計算）
                    data.push(['位置別応力度計算結果']);
                    data.push(['位置(m)', '軸力(kN)', 'モーメント(kN·m)', '軸応力度(N/mm²)', '曲げ応力度(N/mm²)', '合成応力度(N/mm²)', '検定比']);
                    
                    const numPoints = result.ratios ? result.ratios.length : 21;
                    for (let k = 0; k < numPoints; k++) {
                        const x = (k / (numPoints - 1)) * L;
                        
                        // 軸力（一定）
                        const N = Math.abs(-force.N_i);
                        
                        // モーメントの計算
                        let M;
                        if (w !== 0) {
                            M = Math.abs(force.M_i + force.Q_i * x - 0.5 * w * x**2);
                        } else {
                            M = Math.abs(force.M_i + force.Q_i * x);
                        }
                        
                        // 応力度計算
                        const sigma_axial = N * 1000 / (A * 1e6);
                        const sigma_bending = M * 1e6 / (Z * 1e9);
                        const sigma_combined = sigma_axial + sigma_bending;
                        
                        // 検定比計算
                        let checkRatio = 0;
                        if (N >= 0) { // 引張
                            checkRatio = sigma_combined / allowableStresses.ft;
                        } else { // 圧縮
                            checkRatio = sigma_combined / allowableStresses.fc;
                        }
                        
                        data.push([
                            x.toFixed(3),
                            N.toFixed(2),
                            M.toFixed(2),
                            sigma_axial.toFixed(2),
                            sigma_bending.toFixed(2),
                            sigma_combined.toFixed(2),
                            (result.ratios ? result.ratios[k] : checkRatio).toFixed(3)
                        ]);
                    }
                    data.push([]);
                });
            }
            
        } else {
            data.push(['※ 断面検定結果がありません']);
            data.push(['※ 「計算実行 & アニメーション表示」ボタンで解析を実行してから出力してください']);
        }
        
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, '断面検定結果');
    }

    // 座屈解析結果シート作成
    async function addBucklingAnalysisSheet(workbook) {
        console.log('座屈解析結果シートを作成中...');
        console.log('座屈解析結果データ:', lastBucklingResults);
        
        const toFiniteNumber = (value) => {
            if (value === undefined || value === null) return null;
            const num = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(num) ? num : null;
        };
        const formatNumber = (value, fractionDigits = 2) => {
            const num = toFiniteNumber(value);
            return num !== null ? num.toFixed(fractionDigits) : '-';
        };
        const formatRounded = (value) => {
            const num = toFiniteNumber(value);
            return num !== null ? Math.round(num) : '-';
        };
        const formatScaledNumber = (value, scale, fractionDigits = 2) => {
            const num = toFiniteNumber(value);
            return num !== null ? (num * scale).toFixed(fractionDigits) : '-';
        };

        const data = [];
        data.push(['■ 弾性座屈解析結果']);
        data.push([]);
        
        if (lastBucklingResults && lastBucklingResults.length > 0) {
            data.push(['部材番号', '軸力(kN)', '座屈長さ(m)', '座屈荷重(kN)', '安全率', '判定', '細長比', '座屈モード', '理論的背景']);
            
            lastBucklingResults.forEach((result, i) => {
                const safetyFactor = toFiniteNumber(result.safetyFactor);
                const axialForce = toFiniteNumber(result.axialForce);
                const bucklingLength = toFiniteNumber(result.bucklingLength);
                const bucklingLoad = toFiniteNumber(result.bucklingLoad);
                const slendernessRatio = toFiniteNumber(result.slendernessRatio);
                const bucklingFactor = toFiniteNumber(result.bucklingLengthFactor);

                // 判定
                let judgment = '-';
                if (safetyFactor !== null) {
                    if (safetyFactor >= 2.0) {
                        judgment = 'OK';
                    } else if (safetyFactor >= 1.0) {
                        judgment = '要注意';
                    } else {
                        judgment = 'NG';
                    }
                }
                
                // 座屈モードの決定
                let bucklingMode = '-';
                if (slendernessRatio !== null) {
                    if (slendernessRatio < 50) {
                        bucklingMode = '短柱（局部座屈）';
                    } else if (slendernessRatio < 200) {
                        bucklingMode = '中間柱（全体座屈）';
                    } else {
                        bucklingMode = '長柱（オイラー座屈）';
                    }
                }
                
                // 理論的背景
                const theory = `オイラー座屈理論: P_cr = π²EI/(lk)², 座屈長さ係数k=${bucklingFactor !== null ? bucklingFactor : '-'}`;
                
                data.push([
                    i + 1,
                    formatNumber(axialForce, 2),
                    formatNumber(bucklingLength, 3),
                    formatNumber(bucklingLoad, 2),
                    formatNumber(safetyFactor, 2),
                    judgment,
                    formatRounded(slendernessRatio),
                    bucklingMode,
                    theory
                ]);
            });
            
            data.push([]);
            data.push(['■ 座屈解析の詳細計算過程']);
            data.push([]);
            
            lastBucklingResults.forEach((result, i) => {
                const safetyFactor = toFiniteNumber(result.safetyFactor);
                const axialForce = toFiniteNumber(result.axialForce);
                const memberLength = toFiniteNumber(result.memberLength);
                const bucklingFactor = toFiniteNumber(result.bucklingLengthFactor);
                const bucklingLength = toFiniteNumber(result.bucklingLength);
                const momentOfInertia = toFiniteNumber(result.momentOfInertia);
                const radiusOfGyration = toFiniteNumber(result.radiusOfGyration);
                const slendernessRatio = toFiniteNumber(result.slendernessRatio);
                const elasticModulus = toFiniteNumber(result.elasticModulus);
                const bucklingLoad = toFiniteNumber(result.bucklingLoad);

                // 判定を再計算（詳細計算過程用）
                let detailJudgment = '-';
                if (safetyFactor !== null) {
                    if (safetyFactor >= 2.0) {
                        detailJudgment = 'OK';
                    } else if (safetyFactor >= 1.0) {
                        detailJudgment = '要注意';
                    } else {
                        detailJudgment = 'NG';
                    }
                }
                
                data.push([`部材 ${i + 1} の詳細計算`]);
                data.push(['計算項目', '値', '単位', '式・備考']);
                data.push(['軸力 P', formatNumber(axialForce, 2), 'kN', '負の値が圧縮、正の値が引張']);
                data.push(['部材長 L', formatNumber(memberLength, 3), 'm', '']);
                data.push(['座屈長さ係数 k', formatNumber(bucklingFactor, 1), '', '端部条件による']);
                data.push(['座屈長さ lk', formatNumber(bucklingLength, 3), 'm', 'lk = k × L']);
                data.push(['断面二次モーメント I', formatScaledNumber(momentOfInertia, 1e12, 2), 'mm⁴', '']);
                data.push(['回転半径 i', formatScaledNumber(radiusOfGyration, 1e3, 2), 'mm', 'i = √(I/A)']);
                data.push(['細長比 λ', formatRounded(slendernessRatio), '', 'λ = lk/i']);
                data.push(['弾性係数 E', formatScaledNumber(elasticModulus, 0.001, 0), 'GPa', '']);
                data.push(['オイラー座屈荷重 P_cr', formatNumber(bucklingLoad, 2), 'kN', 'P_cr = π²EI/(lk)²']);
                data.push(['安全率 SF', formatNumber(safetyFactor, 2), '', 'SF = P_cr / P']);
                data.push(['座屈判定', detailJudgment, '', 'SF≥2.0:OK, 1.0≤SF<2.0:要注意, SF<1.0:NG']);
                data.push([]);
            });
            
        } else {
            data.push(['※ 座屈解析結果がありません']);
            data.push(['※ 圧縮荷重を受ける部材がない場合は座屈解析は実行されません']);
        }
        
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, '座屈解析結果');
    }

    // エクセル出力のイベントハンドラー
    async function exportToExcelHandler() {
        console.log('=== エクセル出力ボタンがクリックされました ===');
        try {
            console.log('エクセル出力を開始します...');
            
            // SheetJSライブラリの動的読み込み
            if (typeof XLSX === 'undefined') {
                console.log('SheetJSライブラリを読み込み中...');
                await loadSheetJS();
            }
            
            await exportToExcel();
            console.log('エクセル出力が完了しました');
        } catch (error) {
            console.error('エクセル出力でエラーが発生しました:', error);
            alert('エクセル出力でエラーが発生しました: ' + error.message);
        }
    }

    // ==========================================================================
    // オンキャンバス直接編集機能
    // ==========================================================================
    let activeEditor = null;

    const showInPlaceEditor = (labelInfo) => {
        // 既存のエディタがあれば削除
        if (activeEditor) activeEditor.remove();

        const canvasRect = elements.modelCanvas.getBoundingClientRect();
        const editor = document.createElement('input');
        editor.type = 'number';
        editor.className = 'on-canvas-editor';
        editor.value = labelInfo.value;

        // エディタの位置とサイズを調整
        editor.style.left = `${canvasRect.left + window.scrollX + labelInfo.center.x}px`;
        editor.style.top = `${canvasRect.top + window.scrollY + labelInfo.center.y}px`;
        editor.style.width = `${labelInfo.width + 20}px`; // 少し幅に余裕を持たせる

        document.body.appendChild(editor);
        activeEditor = editor;

        editor.focus();
        editor.select();

        const commitEdit = () => {
            if (!activeEditor) return;

            // エディタの参照を保存してクリア
            const editorToRemove = activeEditor;
            activeEditor = null;

            // 値を取得して更新
            const newValue = parseFloat(editorToRemove.value);
            if (!isNaN(newValue)) {
                updateModelData(labelInfo, newValue);
            }

            // エディタを削除（既に削除されている場合もあるのでtry-catchで保護）
            try {
                if (editorToRemove && editorToRemove.parentNode) {
                    editorToRemove.remove();
                }
            } catch (e) {
                // エディタが既に削除されている場合は無視
            }
        };

        const cancelEdit = () => {
            if (!activeEditor) return;

            // エディタの参照を保存してクリア
            const editorToRemove = activeEditor;
            activeEditor = null;

            // エディタを削除
            try {
                if (editorToRemove && editorToRemove.parentNode) {
                    editorToRemove.remove();
                }
            } catch (e) {
                // エディタが既に削除されている場合は無視
            }
        };

        editor.addEventListener('blur', commitEdit);
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });
    };

    const updateModelData = (labelInfo, newValue) => {
        pushState(); // 変更を履歴に保存
        const { type, index } = labelInfo;

        switch (type) {
            case 'node-load-px':
            case 'node-load-py':
            case 'node-load-pz':
            {
                let loadRow = Array.from(elements.nodeLoadsTable.rows).find(r => parseInt(r.cells[0].querySelector('input').value) - 1 === index);
                if (!loadRow) {
                    // 荷重行が存在しない場合は新規作成
                    addRow(elements.nodeLoadsTable, [`<input type="number" value="${index + 1}">`, '<input type="number" value="0">', '<input type="number" value="0">', '<input type="number" value="0">']);
                    loadRow = elements.nodeLoadsTable.rows[elements.nodeLoadsTable.rows.length - 1];
                }
                const cellIndex = { 'node-load-px': 1, 'node-load-py': 2, 'node-load-pz': 3 }[type];
                loadRow.cells[cellIndex].querySelector('input').value = newValue;
                break;
            }
            case 'node-load-mz': {
                // 3D統合版ではMz入力を廃止（結果表示は維持）。旧データ互換のため無視。
                console.warn('Ignored node-load-mz edit (Mz input disabled in 3D mode).');
                break;
            }
            case 'member-load-w': {
                let loadRow = Array.from(elements.memberLoadsTable.rows).find(r => parseInt(r.cells[0].querySelector('input').value) - 1 === index);
                if (!loadRow) {
                    addRow(elements.memberLoadsTable, [`<input type="number" value="${index + 1}">`, '<input type="number" value="0">', '<input type="number" value="0">', '<input type="number" value="0">']);
                    loadRow = elements.memberLoadsTable.rows[elements.memberLoadsTable.rows.length - 1];
                }
                const targetCellIndex = labelInfo.component === 'wx' ? 1 : labelInfo.component === 'wz' ? 3 : 2;
                loadRow.cells[targetCellIndex].querySelector('input').value = newValue;
                break;
            }
        }

        // データを更新後に即座に再描画
        drawOnCanvas();

        // 解析結果がある場合は再計算も実行
        runFullAnalysis();
    };

    elements.modelCanvas.addEventListener('dblclick', (e) => {
        console.log('🖱️ ダブルクリックイベント発生');
        
        // 他のポップアップが表示されている場合は何もしない
        const existingPopup = document.querySelector('.popup-box[style*="display: block"]');
        if (existingPopup) {
            console.log('❌ ポップアップが既に表示されているため処理を停止:', existingPopup);
            return;
        }

        const rect = elements.modelCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // まず荷重ラベルのクリックをチェック
        let labelClicked = false;
        if (window.lastLabelManager) {
            const clickedLabel = window.lastLabelManager.getLabelAt(mouseX, mouseY);
            if (clickedLabel && clickedLabel.type && clickedLabel.index !== undefined) {
                e.preventDefault();
                e.stopPropagation();
                showInPlaceEditor(clickedLabel);
                labelClicked = true;
            }
        }

        // 荷重ラベルがクリックされていない場合、節点または部材をチェック
        if (!labelClicked) {
            const clickedNodeIndex = getNodeAt(mouseX, mouseY);
            const clickedMemberIndex = getMemberAt(mouseX, mouseY);
            
            console.log('🔍 ダブルクリック要素チェック:', {
                mouseX, mouseY, 
                clickedNodeIndex, 
                clickedMemberIndex,
                labelClicked
            });

            if (clickedNodeIndex !== -1) {
                // 節点のプロパティ編集ポップアップを表示
                e.preventDefault();
                e.stopPropagation();
                openNodeEditor(clickedNodeIndex);
                drawOnCanvas();
            } else if (clickedMemberIndex !== -1) {
                console.log('🔧 部材ダブルクリック処理開始:', {
                    clickedMemberIndex,
                    selectedMemberIndex
                });

                e.preventDefault();
                e.stopPropagation();
                openMemberEditor(clickedMemberIndex);
                drawOnCanvas();
            }
        }
    });

    // 初期化: 非表示軸ラベルとオプションを設定
    updateHiddenAxisLabel();
    updateHiddenAxisCoordOptions();

    // テーブル変更時に座標オプションを更新
    const nodesTableObserver = new MutationObserver(() => {
        updateHiddenAxisCoordOptions();
    });
    if (elements.nodesTable) {
        nodesTableObserver.observe(elements.nodesTable, { childList: true, subtree: true });
    }

    // 3Dビューアからアクセスできるように、一部の関数をグローバルスコープに公開
    window.addRow = addRow;
    window.memberRowHTML = memberRowHTML;
    
    // グローバル関数として公開
    window.calculateSectionCheck = calculateSectionCheck;
    window.displaySectionCheckResults = displaySectionCheckResults;
    window.showSectionCheckDetail = showSectionCheckDetail;
    window.calculateBucklingAnalysis = calculateBucklingAnalysis;
    window.displayBucklingResults = displayBucklingResults;
    window.showBucklingDetail = showBucklingDetail;
    window.drawDualAxisCapacityRatioDiagram = drawDualAxisCapacityRatioDiagram;
});

// ==========================================================================
// フレームジェネレーター機能
// ==========================================================================

// フレームジェネレーターの初期化
const initializeFrameGenerator = () => {
    const frameGeneratorBtn = document.getElementById('frame-generator-btn');
    const frameGeneratorModal = document.getElementById('frame-generator-modal');
    const modalClose = frameGeneratorModal.querySelector('.modal-close');
    const cancelBtn = document.getElementById('frame-generator-cancel');
    const generateBtn = document.getElementById('frame-generator-generate');
    
    // 入力要素
    const floorsInput = document.getElementById('frame-floors');
    const spansInput = document.getElementById('frame-spans');
    const depthSpansInput = document.getElementById('frame-depth-spans');
    const spanLengthInput = document.getElementById('frame-span-length');
    const depthSpanLengthInput = document.getElementById('frame-depth-span-length');
    const floorHeightInput = document.getElementById('frame-floor-height');
    const fixBaseCheckbox = document.getElementById('frame-fix-base');
    const startXInput = document.getElementById('frame-start-x');
    const startYInput = document.getElementById('frame-start-y');
    const startZInput = document.getElementById('frame-start-z');
    
    // プレビュー要素
    const previewNodes = document.getElementById('preview-nodes');
    const previewMembers = document.getElementById('preview-members');
    const previewSupport = document.getElementById('preview-support');
    
    // プレビュー更新関数
    const updatePreview = () => {
        const floors = parseInt(floorsInput.value) || 1;
        const spans = parseInt(spansInput.value) || 1;
        const depthSpans = parseInt(depthSpansInput.value) || 1;
        const fixBase = fixBaseCheckbox.checked;
        const startZ = parseFloat(startZInput.value) || 0;
        const floorHeight = parseFloat(floorHeightInput.value) || 3.5;

        const nodesPerFloor = (spans + 1) * (depthSpans + 1);
        const totalNodes = nodesPerFloor * (floors + 1);

        const zeroTolerance = 1e-6;
        let zeroLevelFloorCount = 0;
        for (let floor = 0; floor <= floors; floor++) {
            const zLevel = startZ + floor * floorHeight;
            if (Math.abs(zLevel) < zeroTolerance) {
                zeroLevelFloorCount++;
            }
        }

        const horizontalMembersXPerFloor = spans * (depthSpans + 1); // X方向梁
        const horizontalMembersYPerFloor = depthSpans * (spans + 1); // Y方向梁（従来Z方向表記）
        const effectiveHorizontalFloorCount = Math.max((floors + 1) - zeroLevelFloorCount, 0);
        const horizontalMembersX = horizontalMembersXPerFloor * effectiveHorizontalFloorCount;
        const horizontalMembersZ = horizontalMembersYPerFloor * effectiveHorizontalFloorCount;
        const verticalMembers = nodesPerFloor * floors; // 柱
        const totalMembers = horizontalMembersX + horizontalMembersZ + verticalMembers;

        previewNodes.textContent = totalNodes;
        previewMembers.textContent = totalMembers;
        previewSupport.textContent = fixBase ? '固定支点' : 'ピン支点';
    };
    
    // 入力値変更時のプレビュー更新
    [floorsInput, spansInput, depthSpansInput].forEach(input => {
        input.addEventListener('input', updatePreview);
    });
    
    // チェックボックス変更時のプレビュー更新
    fixBaseCheckbox.addEventListener('change', updatePreview);

    [floorHeightInput, startZInput].forEach(input => {
        if (input) {
            input.addEventListener('input', updatePreview);
        }
    });
    
    // モーダル表示
    const showModal = () => {
        frameGeneratorModal.style.display = 'flex';
        updatePreview();
    };
    
    // モーダル非表示
    const hideModal = () => {
        frameGeneratorModal.style.display = 'none';
    };
    
    // フレーム生成関数
    // フレームジェネレーター用ヘルパー関数
    const clearAllTables = () => {
        // 全てのテーブル行を削除（ヘッダーを除く）
        const nodesTable = document.getElementById('nodes-table')?.getElementsByTagName('tbody')[0];
        const membersTable = document.getElementById('members-table')?.getElementsByTagName('tbody')[0];
        const nodeLoadsTable = document.getElementById('node-loads-table')?.getElementsByTagName('tbody')[0];
        const memberLoadsTable = document.getElementById('member-loads-table')?.getElementsByTagName('tbody')[0];
        
        const tables = [nodesTable, membersTable, nodeLoadsTable, memberLoadsTable];
        
        tables.forEach(table => {
            if (table && table.rows) {
                // 逆順で削除（インデックスの変更を避けるため）
                for (let i = table.rows.length - 1; i >= 0; i--) {
                    table.deleteRow(i);
                }
            }
        });
    };
    
    const addMemberToTable = (nodeI, nodeJ, overrides = {}) => {
        try {
            const membersTableBody = elements?.membersTable || document.getElementById('members-table')?.getElementsByTagName('tbody')[0];
            if (!membersTableBody) {
                console.error('members-table not found');
                return null;
            }

            const defaults = window.newMemberDefaults ?? {
                    E: '205000',
                    F: '235',
                    Iz: '1840',
                    Iy: '613',
                    J: '235',
                    Iw: '',
                    A: '2340',
                    Zz: '1230',
                    Zy: '410',
                    i_conn: 'rigid',
                    j_conn: 'rigid'
                };

            const normalizeNumeric = (value, fallback) => {
                if (value === undefined || value === null) return fallback;
                if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
                if (typeof value === 'string' && value.trim() === '') return fallback;
                const parsed = Number.parseFloat(value);
                return Number.isFinite(parsed) ? parsed : fallback;
            };

            const strengthValue = overrides.F ?? defaults.F ?? '235';
            const EValue = overrides.E ?? defaults.E ?? '205000';

            const Iz_m4 = normalizeNumeric(overrides.Iz, normalizeNumeric(defaults.Iz ?? defaults.I, 1840)) * 1e-8;
            const Iy_m4 = normalizeNumeric(overrides.Iy, normalizeNumeric(defaults.Iy, 613)) * 1e-8;
            const J_m4 = normalizeNumeric(overrides.J, normalizeNumeric(defaults.J, 235)) * 1e-8;
            const Iw_m6 = (() => {
                const raw = normalizeNumeric(overrides.Iw, defaults.Iw ?? '');
                if (raw === '' || raw === null || raw === undefined) return '';
                const n = Number.parseFloat(raw);
                return Number.isFinite(n) ? (n * 1e-12) : '';
            })();
            const A_m2 = normalizeNumeric(overrides.A, normalizeNumeric(defaults.A, 2340)) * 1e-4;
            const Zz_m3 = normalizeNumeric(overrides.Zz ?? overrides.Z, normalizeNumeric(defaults.Zz ?? defaults.Z, 1230)) * 1e-6;
            const Zy_m3 = normalizeNumeric(overrides.Zy, normalizeNumeric(defaults.Zy, 410)) * 1e-6;

            const iConn = overrides.i_conn ?? overrides.startPin ?? defaults.i_conn ?? 'rigid';
            const jConn = overrides.j_conn ?? overrides.endPin ?? defaults.j_conn ?? 'rigid';
            const sectionName = overrides.sectionName ?? '';
            const sectionAxis = overrides.sectionAxis ?? '';

            const cells = [
                '#',
                ...memberRowHTML(
                    nodeI,
                    nodeJ,
                    `${EValue}`,
                    strengthValue,
                    Iz_m4,
                    Iy_m4,
                    J_m4,
                    Iw_m6,
                    A_m2,
                    Zz_m3,
                    Zy_m3,
                    iConn,
                    jConn,
                    sectionName,
                    sectionAxis
                )
            ];

            const newRow = addRow(membersTableBody, cells, false);
            return newRow || null;
        } catch (error) {
            console.error('addMemberToTable error:', error);
            return null;
        }
    };

    const generateFrame = () => {
        try {
            const floors = parseInt(floorsInput.value) || 1;
            const spans = parseInt(spansInput.value) || 1;
            const depthSpans = parseInt(depthSpansInput.value) || 1;
            const spanLength = parseFloat(spanLengthInput.value) || 6.0;
            const depthSpanLength = parseFloat(depthSpanLengthInput.value) || 6.0;
            const floorHeight = parseFloat(floorHeightInput.value) || 3.5;
            const fixBase = fixBaseCheckbox.checked;
            const startX = parseFloat(startXInput.value) || 0.0;
            const startY = parseFloat(startYInput.value) || 0.0;
            const startZ = parseFloat(startZInput.value) || 0.0;

            if (floors < 1 || floors > 20) {
                alert('層数は1から20の間で設定してください。');
                return;
            }
            if (spans < 1 || spans > 20) {
                alert('スパン数は1から20の間で設定してください。');
                return;
            }
            if (depthSpans < 1 || depthSpans > 20) {
                alert('奥行スパン数は1から20の間で設定してください。');
                return;
            }
            if (spanLength <= 0 || spanLength > 50) {
                alert('スパン長は0より大きく50以下で設定してください。');
                return;
            }
            if (depthSpanLength <= 0 || depthSpanLength > 50) {
                alert('奥行スパン長は0より大きく50以下で設定してください。');
                return;
            }
            if (floorHeight <= 0 || floorHeight > 20) {
                alert('階高は0より大きく20以下で設定してください。');
                return;
            }

            const nodesTableBody = elements?.nodesTable || document.getElementById('nodes-table')?.getElementsByTagName('tbody')[0];
            const membersTableBody = elements?.membersTable || document.getElementById('members-table')?.getElementsByTagName('tbody')[0];

            if (!nodesTableBody || !membersTableBody) {
                alert('テーブル要素が見つかりません。ページを再読み込みして再試行してください。');
                return;
            }

            const existingNodes = nodesTableBody.rows.length > 0;
            const existingMembers = membersTableBody.rows.length > 0;

            if (existingNodes || existingMembers) {
                if (!confirm('現在のモデルデータはクリアされます。続行しますか？')) {
                    return;
                }
            }

            if (typeof pushState === 'function') {
                pushState();
            }

            clearAllTables();

            const zeroTolerance = 1e-6;
            const zeroLevelFloors = new Set();
            for (let floor = 0; floor <= floors; floor++) {
                const zLevel = startZ + floor * floorHeight;
                if (Math.abs(zLevel) < zeroTolerance) {
                    zeroLevelFloors.add(floor);
                }
            }

            const nodesPerFloor = (spans + 1) * (depthSpans + 1);
            const totalNodes = nodesPerFloor * (floors + 1);

            const horizontalMembersXPerFloor = spans * (depthSpans + 1);
            const horizontalMembersZPerFloor = depthSpans * (spans + 1);
            const effectiveHorizontalFloorCount = Math.max((floors + 1) - zeroLevelFloors.size, 0);
            const expectedHorizontalMembersX = horizontalMembersXPerFloor * effectiveHorizontalFloorCount;
            const expectedHorizontalMembersZ = horizontalMembersZPerFloor * effectiveHorizontalFloorCount;
            const verticalMembers = nodesPerFloor * floors;
            const expectedMembers = expectedHorizontalMembersX + expectedHorizontalMembersZ + verticalMembers;

            const getNodeId = (floorIndex, depthIndex, spanIndex) => (
                floorIndex * nodesPerFloor + depthIndex * (spans + 1) + spanIndex + 1
            );

            // 節点追加関数の参照を取得
            const addNode = typeof window.addNodeToTable === 'function' ? window.addNodeToTable : null;
            if (!addNode) {
                alert('節点追加機能が初期化されていません。ページを再読み込みしてください。');
                return;
            }

            let nodesAdded = 0;
            for (let floor = 0; floor <= floors; floor++) {
                const z = startZ + floor * floorHeight;
                const isZeroLevel = zeroLevelFloors.has(floor);
                const support = isZeroLevel ? (fixBase ? 'fixed' : 'pinned') : 'free';
                for (let depth = 0; depth <= depthSpans; depth++) {
                    const y = startY + depth * depthSpanLength;
                    for (let spanIndex = 0; spanIndex <= spans; spanIndex++) {
                        const x = startX + spanIndex * spanLength;
                        const row = addNode(x, y, z, support, { saveHistory: false });
                        if (row) {
                            nodesAdded++;
                        }
                    }
                }
            }

            const addMemberAndCount = (nodeI, nodeJ, counter) => {
                const row = addMemberToTable(nodeI, nodeJ);
                if (row) {
                    counter.count++;
                }
            };
            const memberCounter = { count: 0 };

            for (let floor = 0; floor <= floors; floor++) {
                if (zeroLevelFloors.has(floor)) {
                    continue;
                }
                for (let depth = 0; depth <= depthSpans; depth++) {
                    for (let spanIndex = 0; spanIndex < spans; spanIndex++) {
                        const nodeI = getNodeId(floor, depth, spanIndex);
                        const nodeJ = getNodeId(floor, depth, spanIndex + 1);
                        addMemberAndCount(nodeI, nodeJ, memberCounter);
                    }
                }
            }

            for (let floor = 0; floor <= floors; floor++) {
                if (zeroLevelFloors.has(floor)) {
                    continue;
                }
                for (let depth = 0; depth < depthSpans; depth++) {
                    for (let spanIndex = 0; spanIndex <= spans; spanIndex++) {
                        const nodeI = getNodeId(floor, depth, spanIndex);
                        const nodeJ = getNodeId(floor, depth + 1, spanIndex);
                        addMemberAndCount(nodeI, nodeJ, memberCounter);
                    }
                }
            }

            for (let floor = 0; floor < floors; floor++) {
                for (let depth = 0; depth <= depthSpans; depth++) {
                    for (let spanIndex = 0; spanIndex <= spans; spanIndex++) {
                        const nodeI = getNodeId(floor, depth, spanIndex);
                        const nodeJ = getNodeId(floor + 1, depth, spanIndex);
                        addMemberAndCount(nodeI, nodeJ, memberCounter);
                    }
                }
            }

            if (memberCounter.count !== expectedMembers) {
                console.warn('フレームジェネレーター: 部材数の期待値と実際の数が一致しません', {
                    expected: expectedMembers,
                    actual: memberCounter.count
                });
            }

            if (typeof renumberTables === 'function') {
                renumberTables();
            } else {
                const renumber = (tableBody) => {
                    Array.from(tableBody.rows).forEach((row, index) => {
                        if (row.cells && row.cells[0]) {
                            row.cells[0].textContent = index + 1;
                        }
                    });
                };
                renumber(nodesTableBody);
                renumber(membersTableBody);
            }

            hideModal();

            if (typeof runFullAnalysis === 'function') {
                runFullAnalysis();
            }

            if (typeof drawOnCanvas === 'function') {
                drawOnCanvas();
            }

            setTimeout(() => {
                try {
                    console.log('フレームジェネレーター: 自動スケーリングを実行中...');

                    const autoScaleBtn = document.getElementById('auto-scale-btn');
                    if (autoScaleBtn) {
                        console.log('フレームジェネレーター: 自動スケールボタンを発見、クリック実行');
                        autoScaleBtn.click();
                        return;
                    }

                    if (typeof window.triggerAutoScale === 'function') {
                        console.log('フレームジェネレーター: triggerAutoScale関数を実行');
                        window.triggerAutoScale();
                        return;
                    }

                    if (typeof window.panZoomState !== 'undefined') {
                        console.log('フレームジェネレーター: panZoomState直接リセット');
                        window.panZoomState.isInitialized = false;
                        drawOnCanvas();
                        return;
                    }

                    console.log('フレームジェネレーター: 通常の再描画のみ実行');
                    drawOnCanvas();

                } catch (error) {
                    console.error('フレームジェネレーター: 自動スケーリングエラー:', error);
                    try {
                        drawOnCanvas();
                    } catch (drawError) {
                        console.error('フレームジェネレーター: 再描画エラー:', drawError);
                    }
                }
            }, 500);

            const totalMembers = memberCounter.count;

            setTimeout(() => {
                const autoScaleBtn = document.getElementById('auto-scale-btn');
                if (autoScaleBtn) {
                    console.log('フレームジェネレーター: アラート前最終自動スケーリング試行');
                    autoScaleBtn.click();
                }
            }, 700);

            alert(`フレーム構造を生成しました！\n節点数: ${nodesAdded} (期待値: ${totalNodes})\n部材数: ${totalMembers} (期待値: ${expectedMembers})`);

        } catch (error) {
            console.error('フレーム生成エラー:', error);
            alert('フレーム生成中にエラーが発生しました: ' + error.message);
        }
    };
    
    // イベントリスナー
    frameGeneratorBtn.addEventListener('click', showModal);
    modalClose.addEventListener('click', hideModal);
    cancelBtn.addEventListener('click', hideModal);
    generateBtn.addEventListener('click', generateFrame);
    
    // モーダル背景クリックで閉じる
    frameGeneratorModal.addEventListener('click', (e) => {
        if (e.target === frameGeneratorModal) {
            hideModal();
        }
    });
    
    // ESCキーでモーダルを閉じる
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && frameGeneratorModal.style.display === 'flex') {
            hideModal();
        }
    });
    
    // 初期プレビュー更新
    updatePreview();
};

// フレームジェネレーターの初期化を実行
document.addEventListener('DOMContentLoaded', () => {
    // 他の初期化コードの後で実行されるように遅延
    setTimeout(() => {
        console.log('フレームジェネレーターの初期化を開始');
        try {
            initializeFrameGenerator();
            console.log('フレームジェネレーターの初期化が完了');
        } catch (error) {
            console.error('フレームジェネレーターの初期化エラー:', error);
        }
    }, 100);
});

// デバッグ用：フレームジェネレーター要素の存在を確認する関数
window.checkFrameGenerator = () => {
    console.log('=== フレームジェネレーター要素チェック ===');
    
    const elements = [
        'frame-generator-btn',
        'frame-generator-modal', 
        'modal-close',
        'floors-input',
        'spans-input',
        'span-length-input',
        'floor-height-input',
        'fix-base',
        'start-x',
        'start-y',
        'cancel-btn',
        'generate-btn'
    ];
    
    elements.forEach(id => {
        const element = document.getElementById(id);
        console.log(`${id}: ${element ? '見つかりました' : '見つかりません'}`);
    });
};

// ========================================
// 3Dビューア機能（独立ウィンドウ版）
// ========================================

// 3Dビューアウィンドウの参照を保持
let viewerWindow = null;

// 3Dビューアにモデルデータを送信する関数
function sendModelToViewer() {
    if (viewerWindow && !viewerWindow.closed) {
        try {
            const modelData = parseInputs();
            viewerWindow.postMessage({ type: 'updateModel', data: modelData }, '*');
        } catch (error) {
            console.error("3Dビューアへのモデル更新送信に失敗しました:", error);
        }
    } else {
        viewerWindow = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const view3dBtn = document.getElementById('view-3d-btn');

    if (view3dBtn) {
        view3dBtn.addEventListener('click', () => {
            // 既に開いている場合はフォーカスするだけ
            if (viewerWindow && !viewerWindow.closed) {
                viewerWindow.focus();
                return;
            }

            try {
                const { nodes } = parseInputs();
                if (nodes.length === 0) {
                    alert('3D表示するモデルがありません。');
                    return;
                }

                // 新しいウィンドウで3Dビューアを開く
                viewerWindow = window.open('viewer_3d.html', 'Statica3DViewer', 'width=800,height=600,resizable=yes,scrollbars=yes');

                if (!viewerWindow) {
                    alert('ポップアップがブロックされた可能性があります。3Dビューアを開けませんでした。');
                    return;
                }

                // 1秒後に最初のモデルデータを送信
                setTimeout(() => {
                    sendModelToViewer();
                }, 1000);

            } catch (error) {
                console.error('3Dビューアの起動に失敗しました:', error);
                alert('3Dビューアの起動に失敗しました: ' + error.message);
            }
        });
    }
});

// ==========================================
// 3Dビューから呼び出されるグローバル関数
// ==========================================

/**
 * プログラムで節点を追加（3Dビューから使用）
 */
window.addNodeProgrammatically = function(x, y, z) {
    try {
        if (typeof window.addNodeToTable !== 'function') {
            throw new Error('addNodeToTable が初期化されていません');
        }

        const newRow = window.addNodeToTable(x, y, z, 'free');
        if (!newRow) {
            throw new Error('節点の追加に失敗しました');
        }

        renumberTables();

        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
    } catch (e) {
        console.error('Error adding node:', e);
    }
};

/**
 * プログラムで部材を追加（3Dビューから使用）
 * 2D表示の部材追加と同じロジックを使用
 */
window.addMemberProgrammatically = function(nodeI, nodeJ) {
    try {
        const membersTable = document.getElementById('members-table').getElementsByTagName('tbody')[0];
        if (!membersTable || typeof memberRowHTML !== 'function' || typeof addRow !== 'function') {
            console.error('必要な関数または要素が見つかりません');
            return;
        }

        // デフォルト値を取得（newMemberDefaults がある場合）
        const defaults = window.newMemberDefaults ?? {
            E: '205000',
            F: '235',
            Iz: 1840,
            Iy: 613,
            J: 235,
            Iw: '',
            A: 2340,
            Zz: 1230,
            Zy: 410,
            i_conn: 'rigid',
            j_conn: 'rigid'
        };

        // 1ベースのインデックスに変換
        const i = nodeI + 1;
        const j = nodeJ + 1;

        // 断面諸量を単位変換
        const Iz_m4 = parseFloat(defaults.Iz || defaults.I || 1840) * 1e-8;
        const Iy_m4 = parseFloat(defaults.Iy || 613) * 1e-8;
        const J_m4 = parseFloat(defaults.J || 235) * 1e-8;
        const Iw_m6 = (() => {
            const raw = defaults.Iw;
            if (raw === '' || raw === null || raw === undefined) return '';
            const n = parseFloat(raw);
            return Number.isFinite(n) ? (n * 1e-12) : '';
        })();
        const A_m2 = parseFloat(defaults.A || 2340) * 1e-4;
        const Zz_m3 = parseFloat(defaults.Zz || defaults.Z || 1230) * 1e-6;
        const Zy_m3 = parseFloat(defaults.Zy || 410) * 1e-6;

        // memberRowHTML 関数を使用して完全な行を作成
        addRow(membersTable, [
            `#`,
            ...memberRowHTML(
                i, j,
                defaults.E,
                defaults.F,
                Iz_m4, Iy_m4, J_m4, Iw_m6,
                A_m2,
                Zz_m3, Zy_m3,
                defaults.i_conn,
                defaults.j_conn
            )
        ]);

        // 描画を更新
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }

        console.log(`✅ 部材追加完了: 節点 ${i} → 節点 ${j}`);
    } catch (e) {
        console.error('部材追加エラー:', e);
    }
};

/**
 * 部材追加の第一節点を設定（3Dビューから使用）
 */
window.setFirstMemberNode = function(nodeIndex) {
    // グローバルのfirstMemberNodeを更新
    firstMemberNode = nodeIndex;
};

/**
 * 節点を選択（3Dビューから使用）
 */
window.selectNode = function(nodeIndex) {
    // 選択状態を更新
    selectedNodeIndex = nodeIndex;
    selectedMemberIndex = null;

    // テーブルの行をハイライト
    const nodesTable = document.getElementById('nodes-table');
    if (nodesTable) {
        const rows = nodesTable.getElementsByTagName('tbody')[0].rows;
        Array.from(rows).forEach((row, i) => {
            if (i === nodeIndex) {
                row.style.backgroundColor = '#ffffcc';
            } else {
                row.style.backgroundColor = '';
            }
        });
    }

    // 部材テーブルのハイライトをクリア
    const membersTable = document.getElementById('members-table');
    if (membersTable) {
        const rows = membersTable.getElementsByTagName('tbody')[0].rows;
        Array.from(rows).forEach((row) => {
            row.style.backgroundColor = '';
        });
    }
};

/**
 * 部材を選択（3Dビューから使用）
 */
window.selectMember = function(memberIndex) {
    // 選択状態を更新
    selectedMemberIndex = memberIndex;
    selectedNodeIndex = null;

    // テーブルの行をハイライト
    const membersTable = document.getElementById('members-table');
    if (membersTable) {
        const rows = membersTable.getElementsByTagName('tbody')[0].rows;
        Array.from(rows).forEach((row, i) => {
            if (i === memberIndex) {
                row.style.backgroundColor = '#ffffcc';
            } else {
                row.style.backgroundColor = '';
            }
        });
    }

    // 節点テーブルのハイライトをクリア
    const nodesTable = document.getElementById('nodes-table');
    if (nodesTable) {
        const rows = nodesTable.getElementsByTagName('tbody')[0].rows;
        Array.from(rows).forEach((row) => {
            row.style.backgroundColor = '';
        });
    }
};

/**
 * 節点のコンテキストメニューを表示（3Dビューから呼び出し用）
 */
window.showNodeContextMenu = function(nodeIndex, clientX, clientY) {
    if (!elements || !elements.nodeContextMenu) {
        console.error('❌ nodeContextMenu 要素が見つかりません');
        return;
    }

    selectedNodeIndex = nodeIndex;
    selectedMemberIndex = null;

    elements.nodeContextMenu.style.display = 'block';
    elements.nodeContextMenu.style.left = `${clientX}px`;
    elements.nodeContextMenu.style.top = `${clientY}px`;

    console.log('✅ 節点コンテキストメニュー表示完了 - 節点:', nodeIndex + 1);
};

/**
 * 部材のプロパティポップアップを表示（3Dビューから呼び出し用）
 * 2D表示と完全に同じロジックを使用
 */
window.showMemberProperties = function(memberIndex) {
    console.log('💡 部材プロパティポップアップ表示開始 - 部材:', memberIndex + 1);

    if (!elements || !elements.memberPropsPopup || !elements.membersTable) {
        console.error('❌ 必要な要素が見つかりません');
        return;
    }

    selectedMemberIndex = memberIndex;
    selectedNodeIndex = null;

    const memberRow = elements.membersTable.rows[memberIndex];
    if (!memberRow) {
        console.error('❌ 部材行が見つかりません:', memberIndex);
        return;
    }

    const e_select = memberRow.cells[3].querySelector('select');
    const e_input = memberRow.cells[3].querySelector('input[type="number"]');
    const currentE = (e_select && e_select.value === 'custom') ? e_input.value : (e_select ? e_select.value : '205000');

    // ポップアップ内のE入力欄を生成
    const eContainer = document.getElementById('popup-e-container');
    if (eContainer && window.createEInputHTML) {
        eContainer.innerHTML = window.createEInputHTML('popup-e', currentE);
    }

    // 現在の材料タイプと基準強度を取得
    const strengthContainer = memberRow.cells[4].firstElementChild;
    if (!strengthContainer) {
        console.error('強度入力コンテナが見つかりません');
        return;
    }
    const strengthType = strengthContainer.dataset.strengthType;
    let currentStrength;
    if (strengthType === 'wood-type') {
        const presetSelect = strengthContainer.querySelector('select');
        if (presetSelect && presetSelect.value === 'custom') {
            currentStrength = { baseStrengths: {} };
            ['ft', 'fc', 'fb', 'fs'].forEach(key => {
                const input = strengthContainer.querySelector(`input[id*="-${key}"]`);
                if (input) currentStrength.baseStrengths[key] = parseFloat(input.value);
            });
        } else if (presetSelect) {
            currentStrength = presetSelect.value;
        }
    } else {
        const input = strengthContainer.querySelector('input');
        currentStrength = input ? input.value : '235';
    }

    const popupFContainer = document.getElementById('popup-f-container');
    const selectedOption = e_select ? e_select.options[e_select.selectedIndex] : null;
    let materialType = 'steel';
    if (selectedOption) {
        if (selectedOption.textContent.includes('木材')) materialType = 'wood';
        else if (selectedOption.textContent.includes('ステンレス')) materialType = 'stainless';
        else if (selectedOption.textContent.includes('アルミニウム')) materialType = 'aluminum';
    }

    // ポップアップ内のF入力欄を生成
    if (popupFContainer && window.createStrengthInputHTML) {
        popupFContainer.innerHTML = '';
        popupFContainer.appendChild(window.createStrengthInputHTML(materialType, 'popup-f', currentStrength));
    }

    // ポップアップ内のE選択に応じてF入力欄を更新するイベントリスナーを追加
    const popupESelect = document.getElementById('popup-e-select');
    if (popupESelect) {
        popupESelect.addEventListener('change', () => {
            const selectedOpt = popupESelect.options[popupESelect.selectedIndex];
            let newMaterialType = 'steel';
            if (selectedOpt.textContent.includes('木材')) newMaterialType = 'wood';
            else if (selectedOpt.textContent.includes('ステンレス')) newMaterialType = 'stainless';
            else if (selectedOpt.textContent.includes('アルミニウム')) newMaterialType = 'aluminum';

            popupFContainer.innerHTML = '';
            popupFContainer.appendChild(window.createStrengthInputHTML(newMaterialType, 'popup-f'));

            // 密度も更新（自重考慮がオンの場合）
            const hasDensityColumn = document.querySelector('.density-column') && document.querySelector('.density-column').style.display !== 'none';
            if (hasDensityColumn && window.createDensityInputHTML) {
                const popupEInput = document.getElementById('popup-e-input');
                const eValue = popupESelect.value === 'custom' ? popupEInput.value : popupESelect.value;
                const newDensity = MATERIAL_DENSITY_DATA[eValue] || MATERIAL_DENSITY_DATA['custom'];

                // ポップアップの密度欄を更新
                const densityContainer = document.getElementById('popup-density-container');
                if (densityContainer) {
                    densityContainer.innerHTML = window.createDensityInputHTML('popup-density', newDensity);
                }
            }
        });
    }

    // その他のプロパティを設定
    document.getElementById('popup-iz').value = memberRow.cells[5].querySelector('input').value;
    document.getElementById('popup-iy').value = memberRow.cells[6].querySelector('input').value;
    document.getElementById('popup-j').value = memberRow.cells[7].querySelector('input').value;
    document.getElementById('popup-iw').value = memberRow.cells[8].querySelector('input').value;
    document.getElementById('popup-a').value = memberRow.cells[9].querySelector('input').value;
    document.getElementById('popup-zz').value = memberRow.cells[10].querySelector('input').value;
    document.getElementById('popup-zy').value = memberRow.cells[11].querySelector('input').value;

    // 密度欄の表示/非表示と値設定
    const hasDensityColumn = document.querySelector('.density-column') && document.querySelector('.density-column').style.display !== 'none';
    let existingDensityLabel = document.getElementById('popup-density-label');
    let existingDensityContainer = document.getElementById('popup-density-container');

    if (hasDensityColumn) {
        // 密度欄が必要な場合
        if (!existingDensityLabel || !existingDensityContainer) {
            // 密度欄を動的に作成
            const propsGrid = document.querySelector('#member-props-popup .props-grid');

            // 密度ラベルを作成
            const densityLabel = document.createElement('label');
            densityLabel.setAttribute('for', 'popup-density');
            densityLabel.textContent = '密度 ρ (kg/m³)';
            densityLabel.id = 'popup-density-label';

            // 密度入力欄を作成
            const densityContainer = document.createElement('div');
            densityContainer.id = 'popup-density-container';

            // 始端接合ラベルの前に挿入
            const iConnLabel = document.querySelector('label[for="popup-i-conn"]');
            if (iConnLabel && propsGrid) {
                propsGrid.insertBefore(densityLabel, iConnLabel);
                propsGrid.insertBefore(densityContainer, iConnLabel);
            } else if (propsGrid) {
                propsGrid.appendChild(densityLabel);
                propsGrid.appendChild(densityContainer);
            }

            existingDensityLabel = densityLabel;
            existingDensityContainer = densityContainer;
        }

        // 密度値を取得してポップアップに設定
        const densityCell = memberRow.cells[11];
        if (densityCell && densityCell.classList.contains('density-cell')) {
            const densitySelect = densityCell.querySelector('select');
            const densityInput = densityCell.querySelector('input[type="number"]');
            const currentDensity = (densitySelect && densitySelect.value === 'custom') ? densityInput.value : (densitySelect ? densitySelect.value : '7850');

            if (existingDensityContainer && window.createDensityInputHTML) {
                existingDensityContainer.innerHTML = window.createDensityInputHTML('popup-density', currentDensity);
            }
        }

        // 密度欄を表示
        if (existingDensityLabel) existingDensityLabel.style.display = '';
        if (existingDensityContainer) existingDensityContainer.style.display = '';

        // 密度フィールド表示後にポップアップ位置を再調整
        if (window.adjustPopupPosition) {
            setTimeout(() => window.adjustPopupPosition(elements.memberPropsPopup), 0);
        }
    } else {
        // 密度欄を非表示
        if (existingDensityLabel) existingDensityLabel.style.display = 'none';
        if (existingDensityContainer) existingDensityContainer.style.display = 'none';

        // 密度フィールド非表示後にポップアップ位置を再調整
        if (window.adjustPopupPosition) {
            setTimeout(() => window.adjustPopupPosition(elements.memberPropsPopup), 0);
        }
    }

    // 接合条件の設定
    const connectionTargets = resolveMemberConnectionTargets(memberRow);
    const popupIConn = document.getElementById('popup-i-conn');
    const popupJConn = document.getElementById('popup-j-conn');

    if (popupIConn) {
        popupIConn.value = connectionTargets.i.select?.value || 'rigid';
    }
    if (popupJConn) {
        popupJConn.value = connectionTargets.j.select?.value || 'rigid';
    }

    // 部材荷重の設定
    const memberLoadRow = Array.from(elements.memberLoadsTable.rows).find(row => parseInt(row.cells[0].querySelector('input').value) - 1 === memberIndex);
    document.getElementById('popup-w').value = memberLoadRow ? memberLoadRow.cells[1].querySelector('input').value : '0';

    // ポップアップを画面中央に表示
    const popup = elements.memberPropsPopup;
    if (!popup) {
        console.error('❌ memberPropsPopup 要素が見つかりません');
        return;
    }

    popup.style.display = 'block';
    popup.style.visibility = 'visible';

    const popupRect = popup.getBoundingClientRect();
    const popupWidth = popupRect.width || 400;
    const popupHeight = popupRect.height || 350;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const minMargin = 10;
    const bottomMargin = 20;

    const left = Math.max(minMargin, Math.min((windowWidth - popupWidth) / 2, windowWidth - popupWidth - minMargin));
    const top = Math.max(minMargin, Math.min((windowHeight - popupHeight) / 2, windowHeight - popupHeight - bottomMargin));

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.position = 'fixed';

    console.log('✅ 部材プロパティポップアップ表示完了 - 部材:', memberIndex + 1);
};

// グローバル関数として公開（DOMContentLoaded内で実行）

// --- 2D由来: AI生成/音声入力/例文（3D側へ移植） ---
function extractJsonFromAiApiResponse(apiResponse) {
    const text = apiResponse?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
        if (typeof apiResponse === 'string') return apiResponse;
        return JSON.stringify(apiResponse);
    }

    const codeBlockMatch = text.match(/```json[\s\r\n]*([\s\S]*?)[\s\r\n]*```/i);
    const candidate = codeBlockMatch ? codeBlockMatch[1] : text;
    const start = candidate.indexOf('{');
    if (start === -1) return candidate;

    let depth = 0;
    for (let i = start; i < candidate.length; i++) {
        if (candidate[i] === '{') depth++;
        if (candidate[i] === '}') depth--;
        if (depth === 0) return candidate.slice(start, i + 1);
    }
    return candidate.slice(start);
}

function buildStateFromAiModel(modelData) {
    const state = { nodes: [], members: [], nodeLoads: [], memberLoads: [] };

    const nodes = Array.isArray(modelData?.nodes) ? modelData.nodes : [];
    nodes.forEach((n) => {
        const x = n?.x ?? n?.X ?? 0;
        const y = n?.y ?? n?.Y ?? 0;
        const z = n?.z ?? n?.Z;
        const supportRaw = n?.support ?? n?.s ?? n?.fix ?? n?.boundary ?? 'free';
        state.nodes.push({
            x,
            y,
            z: (z === undefined || z === null || z === '') ? 0 : z,
            support: normalizeSupportValue(supportRaw),
            dx_forced: n?.dx_forced ?? n?.dx ?? 0,
            dy_forced: n?.dy_forced ?? n?.dy ?? 0,
            dz_forced: n?.dz_forced ?? n?.dz ?? 0,
        });
    });

    const members = Array.isArray(modelData?.members) ? modelData.members : [];
    members.forEach((m) => {
        const i = m?.i ?? m?.node1 ?? m?.n1 ?? 1;
        const j = m?.j ?? m?.node2 ?? m?.n2 ?? 2;
        const Iz = m?.Iz ?? m?.I ?? 1840;
        const Iy = m?.Iy ?? m?.I ?? Iz;
        const J = m?.J ?? 235;
        const A = m?.A ?? 2340;
        const Zz = m?.Zz ?? m?.Z ?? 1230;
        const Zy = m?.Zy ?? m?.Z ?? Zz;
        const E = m?.E ?? '205000';
        const i_conn = (m?.i_conn ?? m?.conn1 ?? 'rigid');
        const j_conn = (m?.j_conn ?? m?.conn2 ?? 'rigid');

        state.members.push({
            i,
            j,
            E,
            Iz,
            Iy,
            J,
            A,
            Zz,
            Zy,
            I: Iz,
            Z: Zz,
            i_conn: (String(i_conn).toLowerCase().includes('pin') ? 'pinned' : 'rigid'),
            j_conn: (String(j_conn).toLowerCase().includes('pin') ? 'pinned' : 'rigid'),
        });
    });

    const nodeLoads = Array.isArray(modelData?.nodeLoads) ? modelData.nodeLoads : [];
    nodeLoads.forEach((l) => {
        const node = l?.node ?? 1;
        const px = l?.px ?? l?.fx ?? 0;
        const py = l?.py ?? l?.fy ?? 0;
        const pz = l?.pz ?? l?.fz ?? 0;
        const mz = l?.mz ?? l?.Mz ?? l?.moment ?? 0;
        state.nodeLoads.push({ node, px, py, pz, mz });
    });

    const memberLoads = Array.isArray(modelData?.memberLoads) ? modelData.memberLoads : [];
    memberLoads.forEach((l) => {
        const member = l?.member ?? 1;
        const wx = l?.wx ?? 0;
        const wy = l?.wy ?? l?.w ?? 0;
        const wz = l?.wz ?? 0;
        state.memberLoads.push({ member, wx, wy, wz, w: wy });
    });

    return state;
}

// --- 2D由来: AI編集モードの統合（3D state対応） ---
function integrateEditDataFor3D(newState, userPrompt = '') {
    if (!newState || !Array.isArray(newState.nodes)) {
        console.error('integrateEditDataFor3D: invalid newState');
        return newState;
    }

    const existingState = (typeof window.getCurrentState === 'function') ? window.getCurrentState() : null;
    if (!existingState || !Array.isArray(existingState.nodes)) {
        // 既存が無い場合はそのまま適用
        return newState;
    }

    const prompt = String(userPrompt || '');

    // 荷重削除意図を検出
    const loadDeleteKeywords = /荷重.*削除|荷重.*消|荷重.*なし|荷重.*ゼロ|全.*削除.*荷重|荷重.*全.*削除|load.*delete|load.*remove|load.*clear/i;
    const hasLoadDeleteIntent = loadDeleteKeywords.test(prompt);

    // 材料変更意図を検出
    const materialChangeKeywords = /材料.*(変更|設定)|断面.*(変更|設定)|弾性係数.*(変更|設定)|ヤング係数.*(変更|設定)|ステンレス|アルミ|material.*(change|set)|section.*(change|set)|modulus.*(change|set)|elastic/i;
    const hasMaterialChangeIntent = materialChangeKeywords.test(prompt);

    // トラス構造の作成意図を検出（接合条件をAI生成に従う）
    const trussCreateKeywords = /トラス|truss|ワーレン|プラット|ハウ|warren|pratt|howe|弦材|斜材/i;
    const hasTrussCreateIntent = trussCreateKeywords.test(prompt);

    const normalizeNumber = (v, fallback = 0) => {
        const n = (typeof v === 'string' && v.trim() !== '') ? Number(v) : v;
        return Number.isFinite(n) ? n : fallback;
    };

    const normalizeNode = (node) => ({
        x: normalizeNumber(node?.x, 0),
        y: normalizeNumber(node?.y, 0),
        z: normalizeNumber(node?.z, 0),
        support: normalizeSupportValue(node?.support ?? node?.s ?? 'free'),
        dx_forced: normalizeNumber(node?.dx_forced ?? node?.dx, 0),
        dy_forced: normalizeNumber(node?.dy_forced ?? node?.dy, 0),
        dz_forced: normalizeNumber(node?.dz_forced ?? node?.dz, 0),
    });

    const existingNodes = (existingState.nodes || []).map(normalizeNode);
    const incomingNodes = (newState.nodes || []).map(normalizeNode);

    const integratedNodes = [];
    const maxNodes = Math.max(existingNodes.length, incomingNodes.length);
    for (let i = 0; i < maxNodes; i++) {
        if (incomingNodes[i]) integratedNodes.push(incomingNodes[i]);
        else if (existingNodes[i]) integratedNodes.push(existingNodes[i]);
    }

    const existingMembers = Array.isArray(existingState.members) ? existingState.members : [];
    const incomingMembers = Array.isArray(newState.members) ? newState.members : [];

    const integratedMembers = [];
    const maxMembers = Math.max(existingMembers.length, incomingMembers.length);
    for (let i = 0; i < maxMembers; i++) {
        const existingMember = existingMembers[i];
        const incomingMember = incomingMembers[i];

        if (incomingMember) {
            const merged = { ...incomingMember };

            if (existingMember) {
                // 材料変更が明示されていない場合は既存の物性を保持
                if (!hasMaterialChangeIntent) {
                    const keepKeys = ['E', 'Iz', 'Iy', 'J', 'A', 'Zz', 'Zy', 'I', 'Z'];
                    keepKeys.forEach((k) => {
                        if (existingMember[k] !== undefined) merged[k] = existingMember[k];
                    });
                }

                // トラス指示が無い場合は既存の接合条件を保持
                if (!hasTrussCreateIntent) {
                    if (existingMember.i_conn !== undefined) merged.i_conn = existingMember.i_conn;
                    if (existingMember.j_conn !== undefined) merged.j_conn = existingMember.j_conn;
                }

                // 断面情報/軸情報などのメタ情報は基本的に既存を保持（AIが明示した場合は上書き）
                const metaPrefix = ['section', 'axis'];
                Object.keys(existingMember).forEach((k) => {
                    const lower = k.toLowerCase();
                    const isMeta = metaPrefix.some(p => lower.startsWith(p)) || ['sectioninfo', 'sectioninfoencoded', 'sectionlabel', 'sectionsummary', 'sectionsource', 'sectionaxisk', 'sectionaxismode', 'sectionaxislabel'].includes(lower);
                    if (isMeta && merged[k] === undefined) merged[k] = existingMember[k];
                });
            }

            integratedMembers.push(merged);
        } else if (existingMember) {
            integratedMembers.push(existingMember);
        }
    }

    const normalizeNodeLoad = (l) => {
        const node = normalizeNumber(l?.node ?? l?.n, 1);
        const px = normalizeNumber(l?.px ?? l?.fx, 0);
        const py = normalizeNumber(l?.py ?? l?.fy, 0);
        const pz = normalizeNumber(l?.pz ?? l?.fz, 0);
        const mz = normalizeNumber(l?.mz ?? l?.Mz, 0);
        return { node, px, py, pz, mz };
    };
    const normalizeMemberLoad = (l) => {
        const member = normalizeNumber(l?.member ?? l?.m, 1);
        const wx = normalizeNumber(l?.wx, 0);
        const wy = normalizeNumber(l?.wy ?? l?.w, 0);
        const wz = normalizeNumber(l?.wz, 0);
        return { member, wx, wy, wz, w: wy };
    };

    const existingNodeLoads = (existingState.nodeLoads || []).map(normalizeNodeLoad);
    const incomingNodeLoads = (newState.nodeLoads || []).map(normalizeNodeLoad);
    const existingMemberLoads = (existingState.memberLoads || []).map(normalizeMemberLoad);
    const incomingMemberLoads = (newState.memberLoads || []).map(normalizeMemberLoad);

    const nodeLoadMap = new Map();
    if (!hasLoadDeleteIntent) {
        existingNodeLoads.forEach(l => nodeLoadMap.set(l.node, l));
    }
    incomingNodeLoads.forEach(l => {
        if (l.px !== 0 || l.py !== 0 || l.pz !== 0 || l.mz !== 0) nodeLoadMap.set(l.node, l);
    });

    const memberLoadMap = new Map();
    if (!hasLoadDeleteIntent) {
        existingMemberLoads.forEach(l => memberLoadMap.set(l.member, l));
    }
    incomingMemberLoads.forEach(l => {
        if (l.wx !== 0 || l.wy !== 0 || l.wz !== 0) memberLoadMap.set(l.member, l);
    });

    const integratedState = {
        nodes: integratedNodes,
        members: integratedMembers,
        nodeLoads: Array.from(nodeLoadMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => v),
        memberLoads: Array.from(memberLoadMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => v),
    };

    return integratedState;
}

async function generateModelWithAIFor3D(userPrompt, mode = 'new') {
    const btn = document.getElementById('generate-model-btn');
    const status = document.getElementById('ai-status-indicator');
    const API_URL = '/api/generate-model';

    if (!btn || !status) return;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '生成中...';
    status.style.display = 'block';
    status.style.color = '#005A9C';
    status.textContent = mode === 'edit' ? '🧠 AIがモデルを編集中です...' : '🧠 AIがモデルを生成中です...';

    try {
        const requestBody = {
            prompt: userPrompt,
            mode,
            currentModel: mode === 'edit' ? (typeof window.getCurrentState === 'function' ? window.getCurrentState() : null) : null
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.error || 'サーバーでエラーが発生しました。');
        }

        const jsonText = extractJsonFromAiApiResponse(data);
        const modelData = JSON.parse(jsonText);
        const aiState = buildStateFromAiModel(modelData);
        const applyState = mode === 'edit' ? integrateEditDataFor3D(aiState, userPrompt) : aiState;

        status.textContent = '✅ モデルデータを適用しています...';
        status.style.color = '#28a745';
        if (typeof window.restoreState === 'function') window.restoreState(applyState);
        if (typeof window.drawOnCanvas === 'function') window.drawOnCanvas();

        const autoScaleBtn = document.getElementById('auto-scale-btn');
        if (autoScaleBtn) setTimeout(() => autoScaleBtn.click(), 300);
    } catch (e) {
        console.error('AIモデル生成エラー:', e);
        status.textContent = '❌ ' + (e?.message || 'AI生成でエラーが発生しました');
        status.style.color = '#dc3545';
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
        setTimeout(() => {
            if (status) status.style.display = 'none';
        }, 5000);
    }
}

function getNewModeExamples() {
    return [
        { title: '門型ラーメン（基本）', text: '高さ5m、スパン10mの門型ラーメン。柱脚は固定支点とする。' },
        { title: '多層ラーメン', text: '3層、2スパンのラーメン構造。各階高3.5m、スパン6m。基礎は固定支点。' },
        { title: '門型ラーメン（ピン支点）', text: '高さ4m、スパン8mの門型ラーメン。柱脚はピン支点とする。' },
        { title: '単純梁', text: 'スパン12mの単純梁。両端はピン支点とする。' },
        { title: '連続梁', text: '3スパンの連続梁。スパン長は6m、8m、6m。両端はピン支点、中間は剛接合。' },
        { title: 'トラス構造', text: '高さ3m、スパン12mのワーレントラス。' },
        { title: 'キャンチレバー（片持ち梁）', text: '長さ5mのキャンチレバー（片持ち梁）。固定端は剛接合、自由端は荷重を作用。' },
        { title: '2層フレーム', text: '2層、3スパンのフレーム構造。階高3m、スパン5m。柱脚は固定支点。' },
        { title: 'アーチ構造', text: 'スパン20m、矢高4mのアーチ構造。両端はピン支点とする。' },
    ];
}

function getEditModeExamples() {
    return [
        { title: '部材断面変更', text: '柱部材をH-200×200×8×12に変更し、梁部材をH-588×300×12×20に変更する。' },
        { title: '層の追加', text: '現在の構造に3階部分を追加する。階高3.5m、既存の柱を延長して梁を追加。' },
        { title: 'スパンの追加', text: '右側に2スパン分を追加する。スパン長は6m、既存の梁と同様の断面とする。' },
        { title: '荷重の追加', text: '2階の梁に等分布荷重5kN/mを追加し、1階の柱に集中荷重10kNを追加する。' },
        { title: '境界条件変更', text: '全ての柱脚の境界条件をピン支点に変更する。' },
        { title: '部材の削除', text: '中央の柱1本を削除し、その部分の梁を単純梁に変更する。' },
        { title: '断面の最適化', text: '全ての柱部材をH-250×125に統一し、梁部材をH-400×200に統一する。' },
        { title: 'スパン長の変更', text: '左から2番目のスパンを8mに変更する。' },
        { title: '荷重条件の変更', text: '既存の荷重を全て削除し、新たに屋根荷重3kN/m、床荷重5kN/mを設定する。' },
        { title: '材料の変更', text: '全ての部材の材料をステンレス鋼に変更し、弾性係数を193GPaに設定する。' },
    ];
}

function updateExamplePrompts(mode) {
    const exampleSelect = document.getElementById('example-prompts-select');
    if (!exampleSelect) return;
    while (exampleSelect.children.length > 1) {
        exampleSelect.removeChild(exampleSelect.lastChild);
    }
    const examples = mode === 'new' ? getNewModeExamples() : getEditModeExamples();
    examples.forEach((example, idx) => {
        const option = document.createElement('option');
        option.value = example.text;
        option.textContent = `${idx + 1}. ${example.title} (${example.text})`;
        exampleSelect.appendChild(option);
    });
}

function updateModeDescription() {
    const modeRadios = document.getElementsByName('ai-generation-mode');
    const selectedMode = Array.from(modeRadios).find(r => r.checked)?.value || 'new';
    const desc = document.getElementById('mode-description');
    if (desc) {
        desc.textContent = selectedMode === 'edit'
            ? '現在のモデルに対して追加・編集したい内容を自然言語で入力してください。(例: 2階部分を追加、梁の断面をH-300x150に変更)'
            : '作成したい構造モデルを自然言語で入力してください。(例: 高さ5m、スパン10mの門型ラーメン。柱脚は固定。)';
    }
    updateExamplePrompts(selectedMode);
}

function setupVoiceInput() {
    const voiceInputBtn = document.getElementById('voice-input-btn');
    const voiceStatus = document.getElementById('voice-status');
    const textarea = document.getElementById('natural-language-input');
    if (!voiceInputBtn || !voiceStatus || !textarea) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        voiceInputBtn.disabled = true;
        voiceInputBtn.title = 'このブラウザでは音声入力が利用できません';
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = false;
    let isListening = false;

    voiceInputBtn.addEventListener('click', () => {
        if (isListening) {
            recognition.stop();
            return;
        }
        try {
            recognition.start();
        } catch (e) {
            console.warn('SpeechRecognition start failed:', e);
        }
    });

    recognition.onstart = () => {
        isListening = true;
        voiceInputBtn.textContent = '⏹';
        voiceStatus.textContent = '🎤 音声を認識中...';
        voiceStatus.style.display = 'block';
    };

    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        textarea.value = transcript;
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    };

    recognition.onerror = (event) => {
        voiceStatus.textContent = '❌ 音声認識エラー: ' + (event?.error || 'unknown');
        voiceStatus.style.display = 'block';
        setTimeout(() => (voiceStatus.style.display = 'none'), 5000);
    };

    recognition.onend = () => {
        isListening = false;
        voiceInputBtn.textContent = '🎤';
        if (voiceStatus.textContent === '🎤 音声を認識中...') {
            voiceStatus.textContent = '⏹️ 音声認識が終了しました';
            setTimeout(() => (voiceStatus.style.display = 'none'), 2000);
        }
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const aiToggle = document.getElementById('ai-features-toggle');
    const aiSection = document.getElementById('ai-generator-section');
    const exampleSelect = document.getElementById('example-prompts-select');
    const generateBtn = document.getElementById('generate-model-btn');
    const textarea = document.getElementById('natural-language-input');

    if (aiToggle && aiSection) {
        aiToggle.addEventListener('change', () => {
            aiSection.style.display = aiToggle.checked ? 'block' : 'none';
        });
    }

    const modeRadios = document.getElementsByName('ai-generation-mode');
    if (modeRadios && modeRadios.length) {
        modeRadios.forEach(r => r.addEventListener('change', updateModeDescription));
        updateModeDescription();
    }

    if (exampleSelect) {
        exampleSelect.addEventListener('change', () => {
            if (!textarea) return;
            if (exampleSelect.value) {
                textarea.value = exampleSelect.value;
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
            }
        });
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const mode = Array.from(document.getElementsByName('ai-generation-mode')).find(r => r.checked)?.value || 'new';
            const prompt = (textarea?.value || '').trim();
            if (!prompt) {
                alert('自然言語入力を入力してください。');
                return;
            }
            await generateModelWithAIFor3D(prompt, mode);
        });
    }

    setupVoiceInput();
});

// --- 2D由来: スプレッドシート入力（3D側へ接続） ---
function mapSupportToSpreadsheetFix(supportValue) {
    const normalized = normalizeSupportValue(supportValue);
    if (normalized === 'fixed') return 'Fixed';
    if (normalized === 'pinned') return 'Pinned';
    if (normalized === 'roller-x') return 'RollerX';
    if (normalized === 'roller-z') return 'RollerY';
    return 'Free';
}

function mapSpreadsheetFixToSupport(fixValue) {
    const v = String(fixValue || '').trim().toLowerCase();
    if (v === 'fixed') return 'fixed';
    if (v === 'pinned' || v === 'pin') return 'pinned';
    if (v === 'rollerx' || v === 'roller-x') return 'roller-x';
    if (v === 'rollery' || v === 'roller-y') return 'roller-z';
    return 'free';
}

// spreadsheet_input.html は2D想定の列構成のため、3D側では XZ平面として往復変換する
window.getSpreadsheetData = function () {
    if (typeof window.getCurrentState !== 'function') {
        return { nodes: [], members: [], nodeLoads: [], memberLoads: [] };
    }

    const state = window.getCurrentState();
    const nodes = (state.nodes || []).map(n => ({
        x: n.x,
        y: n.z, // spreadsheet Y ← 3DのZ
        fix: mapSupportToSpreadsheetFix(n.support),
        dx: n.dx_forced,
        dy: n.dz_forced,
        rot: ''
    }));

    const members = (state.members || []).map(m => ({
        node1: m.i,
        node2: m.j,
        E: m.E,
        F: m.strengthValue || '',
        I: m.Iz ?? m.I,
        A: m.A,
        Z: m.Zz ?? m.Z,
        i: m.ix || '',
        K: '',
        density: '',
        name: m.sectionLabel || '',
        axis: m.sectionAxisLabel || '',
        conn1: (String(m.i_conn).toLowerCase().includes('pin') ? 'Pinned' : 'Rigid'),
        conn2: (String(m.j_conn).toLowerCase().includes('pin') ? 'Pinned' : 'Rigid'),
        spring_i_Kx: '', spring_i_Ky: '', spring_i_Kr: '',
        spring_j_Kx: '', spring_j_Ky: '', spring_j_Kr: ''
    }));

    const nodeLoads = (state.nodeLoads || []).map(l => ({
        node: l.node,
        px: l.px,
        py: l.pz, // spreadsheet Py ← 3DのPz
        mz: l.mz ?? 0
    }));

    const memberLoads = (state.memberLoads || []).map(l => ({
        member: l.member,
        w: l.wz // spreadsheet w ← 3DのWz
    }));

    return { nodes, members, nodeLoads, memberLoads };
};

window.updateFromSpreadsheet = function ({ nodes = [], members = [], nodeLoads = [], memberLoads = [] } = {}) {
    if (typeof window.restoreState !== 'function') {
        alert('スプレッドシート反映に必要な復元関数が見つかりません。');
        return;
    }

    const state = { nodes: [], members: [], nodeLoads: [], memberLoads: [] };

    (nodes || []).forEach(n => {
        state.nodes.push({
            x: n.x ?? 0,
            y: 0,
            z: n.y ?? 0,
            support: mapSpreadsheetFixToSupport(n.fix),
            dx_forced: n.dx ?? 0,
            dy_forced: 0,
            dz_forced: n.dy ?? 0,
        });
    });

    (members || []).forEach(m => {
        state.members.push({
            i: m.node1 ?? 1,
            j: m.node2 ?? 2,
            E: m.E ?? '205000',
            Iz: m.I ?? 1840,
            Iy: m.I ?? 613,
            J: 235,
            A: m.A ?? 2340,
            Zz: m.Z ?? 1230,
            Zy: m.Z ?? 410,
            I: m.I ?? 1840,
            Z: m.Z ?? 1230,
            i_conn: (String(m.conn1).toLowerCase().includes('pin') ? 'pinned' : 'rigid'),
            j_conn: (String(m.conn2).toLowerCase().includes('pin') ? 'pinned' : 'rigid'),
        });
    });

    (nodeLoads || []).forEach(l => {
        state.nodeLoads.push({
            node: l.node ?? 1,
            px: l.px ?? 0,
            py: 0,
            pz: l.py ?? 0,
            mz: l.mz ?? 0,
        });
    });

    (memberLoads || []).forEach(l => {
        state.memberLoads.push({
            member: l.member ?? 1,
            wx: 0,
            wy: 0,
            wz: l.w ?? 0,
            w: 0,
        });
    });

    window.restoreState(state);
    if (typeof window.drawOnCanvas === 'function') window.drawOnCanvas();
    const autoScaleBtn = document.getElementById('auto-scale-btn');
    if (autoScaleBtn) setTimeout(() => autoScaleBtn.click(), 200);
};

document.addEventListener('DOMContentLoaded', () => {
    const spreadsheetBtn = document.getElementById('spreadsheet-input-btn');
    if (!spreadsheetBtn) return;

    spreadsheetBtn.addEventListener('click', () => {
        const w = 1200;
        const h = 800;
        const left = Math.max(0, (window.screen.width - w) / 2);
        const top = Math.max(0, (window.screen.height - h) / 2);
        window.open(
            'spreadsheet_input.html',
            'spreadsheetInput',
            `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
    });
});
