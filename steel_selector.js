// 設定オブジェクト
const CONFIG = {
    ui: {
        keyboardNavigation: true,
        animationDuration: 200,
        errorDisplayTime: 3000
    },
    validation: {
        minDimension: 0.1,
        maxDimension: 10000,
        requiredPrecision: 3
    }
};

// Ensure outgoing props always contain a usable `sectionInfo` object
function ensureOutgoingSectionInfo(props) {
    try {
        if (!props || typeof props !== 'object') return props;

        props.dims = props.dims || (props.sectionInfo && props.sectionInfo.dims) || {};

        if (!props.sectionInfo || typeof props.sectionInfo !== 'object') {
            props.sectionInfo = {
                label: props.sectionLabel || props.sectionName || 'unknown',
                typeKey: props.selectedTypeKey || props.typeKey || 'estimated',
                rawDims: props.dims || {},
                svgMarkup: ''
            };
        }

        // ensure typeKey and axis exist
        props.sectionInfo.typeKey = props.sectionInfo.typeKey || props.selectedTypeKey || props.typeKey || 'estimated';
        props.sectionInfo.rawDims = props.sectionInfo.rawDims || props.dims || {};

        if (!props.sectionInfo.svgMarkup) {
            try {
                if (typeof serializeSectionSvg === 'function') {
                    props.sectionInfo.svgMarkup = serializeSectionSvg(props.sectionInfo.typeKey, props.sectionInfo.rawDims) || '';
                }
            } catch (sErr) {
                // ignore serialization errors — leave empty string
                console.warn('ensureOutgoingSectionInfo: svg generation failed', sErr);
            }
        }

        if (!props.sectionInfo.axis) {
            props.sectionInfo.axis = props.sectionAxis || (props.sectionAxisLabel ? { label: props.sectionAxisLabel } : null) || props.sectionInfo.axis;
        }
    } catch (e) {
        console.warn('ensureOutgoingSectionInfo failed', e);
    }
    return props;
}

const utils = (() => {
    const globalUtils = window.utils || (window.utils = {});

    if (typeof globalUtils.setImageWithErrorHandling !== 'function') {
        globalUtils.setImageWithErrorHandling = (imageElement, imageUrl, wrapperElement) => {
            if (!imageElement) return;

            const cleanup = () => {
                imageElement.removeEventListener('load', onLoad);
                imageElement.removeEventListener('error', onError);
            };

            const onLoad = () => {
                cleanup();
                if (wrapperElement) {
                    wrapperElement.classList.remove('hidden');
                }
            };

            const onError = () => {
                cleanup();
                if (wrapperElement) {
                    wrapperElement.classList.add('hidden');
                }
            };

            if (!imageUrl) {
                if (wrapperElement) {
                    wrapperElement.classList.add('hidden');
                }
                imageElement.removeAttribute('src');
                return;
            }

            imageElement.addEventListener('load', onLoad, { once: true });
            imageElement.addEventListener('error', onError, { once: true });

            // 一旦非表示にしてロード結果に応じて表示を切り替える
            if (wrapperElement) {
                wrapperElement.classList.add('hidden');
            }

            imageElement.alt = imageElement.alt || '鋼材断面図';
            imageElement.src = imageUrl;
        };
    }

    return globalUtils;
})();

const dimensionLabelMap = {
    H: 'H',
    B: 'B',
    A: 'A',
    D: 'D',
    t: 't',
    t1: 't₁',
    t2: 't₂',
    C: 'C',
    tw: 't_w',
    tf: 't_f'
};

const termMap = {
    Ix: '断面2次モーメント Ix',
    Iy: '断面2次モーメント Iy',
    ix: '断面2次半径 ix',
    iy: '断面2次半径 iy',
    Zx: '断面係数 Zx',
    Zy: '断面係数 Zy',
    ib: '座屈軸回り断面2次半径 ib',
    'η': '有効細長比 η',
    J: 'ねじり定数 J',
    Iw: '曲げねじり定数 Iw',
    Zpx: '塑性断面係数 Zpx',
    Zpy: '塑性断面係数 Zpy',
    Cx: '図心距離 Cx',
    Cy: '図心距離 Cy',
    Iu: '主断面2次モーメント Iu',
    Iv: '主断面2次モーメント Iv',
    iu: '主断面2次半径 iu',
    iv: '主断面2次半径 iv',
    'tanα': '主軸の傾き tanα',
    Sx: '静的モーメント Sx',
    Sy: '静的モーメント Sy',
    I: '断面2次モーメント I',
    Z: '断面係数 Z',
    i: '断面2次半径 i'
};

const translateHeader = (header) => {
    if (typeof header !== 'string') return header;
    const key = header.split('(')[0].trim();
    const unitMatch = header.match(/[（(](.*?)[)）]/);
    const translated = termMap[key];
    if (translated) {
        return unitMatch ? `${translated} (${unitMatch[1]})` : translated;
    }
    return header;
};

const normalizeKey = (key) => (key ?? '').toString().trim().toLowerCase();

const normalizeHeaderKey = (header) => {
    if (header === undefined || header === null) return '';
    return header
        .toString()
        .trim()
        .normalize('NFKC')
        .replace(/[（(].*?[)）]/g, '')
        .replace(/[\s＿‐－–—]/g, '')
        .replace(/[＊*×✕✖]/g, 'x')
        .toLowerCase();
};

const valuesApproximatelyEqual = (a, b, tolerance = 1e-6) => {
    if (a === undefined || b === undefined || a === null || b === null) return false;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const diff = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return diff <= scale * tolerance;
};

const parseNumericValue = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const normalized = value.replace(/,/g, '').trim();
        const match = normalized.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (match) {
            const parsed = parseFloat(match[0]);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }
    return null;
};

const findFirstMatchingValue = (results, tokens) => {
    if (!results || typeof results !== 'object') return undefined;
    const tokenList = Array.isArray(tokens) ? tokens : [tokens];
    for (const [key, value] of Object.entries(results)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const normalizedKey = normalizeKey(key);
        if (tokenList.some(token => normalizedKey.includes(token.toLowerCase()))) {
            return value;
        }
    }
    return undefined;
};

const collectMatchingValues = (results, token) => {
    if (!results || typeof results !== 'object') return [];
    const normalizedToken = token.toLowerCase();
    const collected = [];
    for (const [key, value] of Object.entries(results)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        if (normalizeKey(key).includes(normalizedToken)) {
            collected.push(value);
        }
    }
    return collected;
};

const determineAxisSymmetry = (results) => {
    if (!results || typeof results !== 'object') return 'none';

    const ixVal = findFirstMatchingValue(results, '断面2次モーメント ix');
    const iyVal = findFirstMatchingValue(results, '断面2次モーメント iy');
    const zxVal = findFirstMatchingValue(results, '断面係数 zx');
    const zyVal = findFirstMatchingValue(results, '断面係数 zy (cm³)');
    const zyGenericVal = zyVal === undefined
        ? findFirstMatchingValue(results, ['断面係数 zy (上縁', '断面係数 zy (右縁', '断面係数 zy (フランジ'])
        : zyVal;
    const ixRadius = findFirstMatchingValue(results, '断面2次半径 ix');
    const iyRadius = findFirstMatchingValue(results, '断面2次半径 iy');

    const comparablePairs = [
        [ixVal, iyVal],
        [zxVal, zyGenericVal],
        [ixRadius, iyRadius]
    ];

    let comparableFound = false;
    for (const [xVal, yVal] of comparablePairs) {
        if (xVal === undefined || yVal === undefined) continue;
        comparableFound = true;
        if (!valuesApproximatelyEqual(xVal, yVal)) {
            return 'none';
        }
    }

    return comparableFound ? 'both' : 'none';
};

const formatCommonLabel = (label) => {
    if (typeof label !== 'string') return label;
    const delimiterIndex = label.indexOf('(');
    if (delimiterIndex === -1) {
        return `${label}（両軸共通）`;
    }
    const namePart = label.slice(0, delimiterIndex).trim();
    const unitPart = label.slice(delimiterIndex).trim();
    return `${namePart}（両軸共通） ${unitPart}`;
};

const coalesceSymmetricProperties = (results, options = {}) => {
    const { enabled = true } = options;
    if (!enabled || !results || typeof results !== 'object') {
        return { ...results };
    }

    const output = {};
    const processedKeys = new Set();

    const axisPairs = [
        { xToken: '断面2次モーメント ix', yToken: '断面2次モーメント iy' },
        { xToken: '断面係数 zx', yToken: '断面係数 zy (cm³)' },
        { xToken: '断面2次半径 ix', yToken: '断面2次半径 iy' }
    ];

    const entries = Object.entries(results);

    for (const [key, value] of entries) {
        if (processedKeys.has(key)) continue;
        const normalizedKey = normalizeKey(key);
        const matchingPair = axisPairs.find(pair => normalizedKey.includes(pair.xToken.toLowerCase()));

        if (matchingPair) {
            const yValue = findFirstMatchingValue(results, matchingPair.yToken);
            if (yValue !== undefined && valuesApproximatelyEqual(value, yValue)) {
                processedKeys.add(key);
                for (const [otherKey] of entries) {
                    if (normalizeKey(otherKey).includes(matchingPair.yToken.toLowerCase())) {
                        processedKeys.add(otherKey);
                    }
                }
                output[formatCommonLabel(key)] = value;
                continue;
            }
        }

        output[key] = value;
        processedKeys.add(key);
    }

    return output;
};

const buildAxisInfo = (axisKey) => {
    const normalized = typeof axisKey === 'string' ? axisKey.trim().toLowerCase() : 'x';
    switch (normalized) {
        case 'y':
        case 'weak':
            return { key: 'y', mode: 'weak', label: '弱軸 (Y軸)' };
        case 'both':
            return { key: 'both', mode: 'both', label: '両軸 (X=Y)' };
        case 'x':
        case 'strong':
        default:
            return { key: 'x', mode: 'strong', label: '強軸 (X軸)' };
    }
};

const findRowValueByKeys = (headers, normalizedHeaders, rowData, ...keys) => {
    if (!Array.isArray(headers) || !Array.isArray(rowData)) return undefined;

    const normalizedTokens = keys
        .flatMap(key => {
            if (key === undefined || key === null) return [];
            const str = key.toString();
            return [normalizeHeaderKey(str), normalizeKey(str)];
        })
        .filter(Boolean);

    if (normalizedTokens.length === 0) return undefined;

    const longTokens = normalizedTokens.filter(token => token.length > 1);
    const shortTokens = normalizedTokens.filter(token => token.length <= 1);

    const ensureNormalizedHeader = (index) => normalizedHeaders?.[index] ?? normalizeHeaderKey(headers[index]);

    if (longTokens.length > 0) {
        let bestIndex = null;
        let bestScore = -1;

        for (let index = 0; index < headers.length; index++) {
            const normalizedHeader = ensureNormalizedHeader(index);
            if (!normalizedHeader) continue;

            for (const token of longTokens) {
                if (normalizedHeader.includes(token)) {
                    const score = token.length;
                    if (score > bestScore) {
                        bestScore = score;
                        bestIndex = index;
                    }
                }
            }
        }

        if (bestIndex !== null) {
            return rowData[bestIndex];
        }
    }

    if (shortTokens.length > 0) {
        for (let index = 0; index < headers.length; index++) {
            const normalizedHeader = ensureNormalizedHeader(index);
            if (!normalizedHeader) continue;
            if (shortTokens.some(token => normalizedHeader === token)) {
                return rowData[index];
            }
        }
    }

    return undefined;
};

const normalizeSectionDimensions = (typeKey, rawDims = {}) => {
    if (!rawDims || typeof rawDims !== 'object') return {};

    const result = {};

    const readValue = (...keys) => {
        for (const key of keys) {
            if (key === undefined || key === null) continue;
            const numeric = parseNumericValue(rawDims[key]);
            if (numeric !== null && numeric > 0) {
                return numeric;
            }
        }
        return null;
    };

    const assignIfPresent = (targetKey, ...candidateKeys) => {
        const value = readValue(...candidateKeys);
        if (value !== null) {
            result[targetKey] = value;
        }
    };

    const lowerType = typeof typeKey === 'string' ? typeKey.toLowerCase() : '';

    switch (lowerType) {
        case 'hkatakou_hiro':
        case 'hkatakou_naka':
        case 'hkatakou_hoso':
        case 'ikatakou':
        case 'keiryouhkatakou':
            assignIfPresent('H', 'H', 'h');
            assignIfPresent('B', 'B', 'b');
            assignIfPresent('t1', 't1', 'tw');
            assignIfPresent('t2', 't2', 'tf', 't');
            break;
        case 'keiryourippuhkatakou':
            assignIfPresent('H', 'H', 'h');
            assignIfPresent('B', 'B', 'b');
            assignIfPresent('C', 'C', 'c');
            assignIfPresent('t1', 't1', 'tw');
            assignIfPresent('t2', 't2', 'tf', 't');
            break;
        case 'mizogatakou':
            assignIfPresent('H', 'H', 'h');
            assignIfPresent('B', 'B', 'b');
            assignIfPresent('t1', 't1', 'tw', 't');
            assignIfPresent('t2', 't2', 'tf');
            break;
        case 'keimizogatakou':
            assignIfPresent('H', 'H', 'h');
            assignIfPresent('A', 'A', 'a');
            assignIfPresent('B', 'B', 'b');
            assignIfPresent('t', 't', 't1', 't2');
            break;
        case 'rippumizokatakou':
            assignIfPresent('H', 'H', 'h');
            assignIfPresent('A', 'A', 'a');
            assignIfPresent('C', 'C', 'c');
            assignIfPresent('t', 't', 't1', 't2');
            break;
        case 'touhenyamakatakou':
            assignIfPresent('A', 'A', 'a');
            assignIfPresent('B', 'B', 'b', 'A');
            assignIfPresent('t', 't');
            break;
        case 'futouhenyamagata':
            assignIfPresent('A', 'A', 'a');
            assignIfPresent('B', 'B', 'b');
            assignIfPresent('t', 't');
            break;
        case 'seihoukei':
            assignIfPresent('A', 'A', 'a', 'B', 'b');
            assignIfPresent('t', 't');
            if (result.A !== undefined && result.B === undefined) {
                result.B = result.A;
            }
            break;
        case 'tyouhoukei':
            assignIfPresent('A', 'A', 'a');
            assignIfPresent('B', 'B', 'b');
            assignIfPresent('t', 't');
            break;
        case 'koukan':
            assignIfPresent('D', 'D', 'd', 'φ');
            assignIfPresent('t', 't');
            break;
        case '矩形':
        case '\u77e9\u5f62':
            assignIfPresent('H', 'H', 'h');
            assignIfPresent('B', 'B', 'b');
            break;
        case '円形':
        case '\u5186\u5f62':
            assignIfPresent('D', 'D', 'd', 'φ');
            break;
        default:
            break;
    }

    for (const [key, value] of Object.entries(rawDims)) {
        if (result[key] !== undefined) continue;
        const numeric = parseNumericValue(value);
        if (numeric !== null && numeric > 0) {
            result[key] = numeric;
        }
    }

    return result;
};

const drawSectionWithDimensions = (svgElement, type, dims) => {
    svgElement.innerHTML = '';
    if (!dims || Object.values(dims).some(v => v === undefined || isNaN(v))) return;

    const createSvgElement = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);

    const g = createSvgElement('g');
    g.setAttribute('fill', '#34495e');

    const dimGroup = createSvgElement('g');
    dimGroup.setAttribute('class', 'dimensions');

    const thickDimGroup = createSvgElement('g');
    thickDimGroup.setAttribute('class', 'dimensions thickness');
    
    let viewBox = "0 0 100 100";

    try {
        const {H, t1, t2, A, B, t, C, D} = dims;
        const maxDim = Math.max(H || A || D || 0, B || 0);
        const strokeWidth = maxDim / 150;
        dimGroup.setAttribute('stroke-width', strokeWidth);
        thickDimGroup.setAttribute('stroke-width', strokeWidth * 0.8);
        const fontSize = maxDim / 12;
        dimGroup.setAttribute('font-size', fontSize);
        thickDimGroup.setAttribute('font-size', fontSize * 0.9);
        const textOffset = maxDim / 25;

        switch(type) {
            case 'hkatakou_hiro': case 'hkatakou_naka': case 'hkatakou_hoso': case 'ikatakou': case 'keiryouhkatakou': case 'keiryourippuhkatakou': {
                viewBox = `${-B * 0.75} ${-H * 0.75} ${B * 1.5} ${H * 1.5}`;
                g.innerHTML = `<rect x="${-t1 / 2}" y="${-H / 2}" width="${t1}" height="${H}" /><rect x="${-B / 2}" y="${-H / 2}" width="${B}" height="${t2}" /><rect x="${-B / 2}" y="${H / 2 - t2}" width="${B}" height="${t2}" />`;
                if (type === 'keiryourippuhkatakou' && C) {
                    g.innerHTML += `<rect x="${-B/2}" y="${-H/2}" width="${t2}" height="${C}" /><rect x="${B/2-t2}" y="${-H/2}" width="${t2}" height="${C}" />`;
                    g.innerHTML += `<rect x="${-B/2}" y="${H/2-C}" width="${t2}" height="${C}" /><rect x="${B/2-t2}" y="${H/2-C}" width="${t2}" height="${C}" />`;
                    const cDimX = -B / 2 - B * 0.4;
                    dimGroup.innerHTML += `<line x1="${cDimX}" y1="${-H/2}" x2="${cDimX}" y2="${-H/2+C}" /><text x="${cDimX - textOffset}" y="${-H/2+C/2}" dominant-baseline="middle" text-anchor="end">C=${C.toFixed(1)}</text>`;
                }
                const hDimX = -B / 2 - B * 0.2;
                dimGroup.innerHTML += `<line x1="${hDimX}" y1="${-H/2}" x2="${hDimX}" y2="${H/2}" /><text x="${hDimX - textOffset}" y="0" dominant-baseline="middle" text-anchor="end">${H.toFixed(1)}</text>`;
                const bDimY = H / 2 + H * 0.15;
                dimGroup.innerHTML += `<line x1="${-B/2}" y1="${bDimY}" x2="${B/2}" y2="${bDimY}" /><text x="0" y="${bDimY + textOffset}" dominant-baseline="hanging" text-anchor="middle">${B.toFixed(1)}</text>`;
                const t1DimY = -H / 2 - H * 0.1;
                thickDimGroup.innerHTML += `<line x1="${-t1/2}" y1="${t1DimY}" x2="${t1/2}" y2="${t1DimY}" /><text x="0" y="${t1DimY - textOffset}" dominant-baseline="alphabetic" text-anchor="middle">t₁=${t1.toFixed(1)}</text>`;
                const t2DimX = B / 2 + B * 0.1;
                thickDimGroup.innerHTML += `<line x1="${t2DimX}" y1="${-H/2}" x2="${t2DimX}" y2="${-H/2+t2}" /><text x="${t2DimX + textOffset}" y="${-H/2+t2/2}" dominant-baseline="middle" text-anchor="start">t₂=${t2.toFixed(1)}</text>`;
                break;
            }
            case 'mizogatakou': case 'keimizogatakou': {
                const width = (type === 'mizogatakou') ? B : A;
                viewBox = `${-width * 0.3} ${-H * 0.2} ${width * 1.6} ${H * 1.4}`;
                const webT = (type === 'mizogatakou') ? t1 : t;
                const flangeT = (type === 'mizogatakou') ? t2 : t;
                g.innerHTML = `<rect x="0" y="0" width="${webT}" height="${H}" /><rect x="0" y="0" width="${width}" height="${flangeT}" /><rect x="0" y="${H - flangeT}" width="${width}" height="${flangeT}" />`;
                const hDimX_mizo = -width * 0.15;
                dimGroup.innerHTML += `<line x1="${hDimX_mizo}" y1="0" x2="${hDimX_mizo}" y2="${H}" /><text x="${hDimX_mizo - textOffset}" y="${H/2}" dominant-baseline="middle" text-anchor="end">${H.toFixed(1)}</text>`;
                const bDimY_mizo = H + H * 0.15;
                dimGroup.innerHTML += `<line x1="0" y1="${bDimY_mizo}" x2="${width}" y2="${bDimY_mizo}" /><text x="${width/2}" y="${bDimY_mizo + textOffset}" dominant-baseline="hanging" text-anchor="middle">${width.toFixed(1)}</text>`;
                const t2DimX_mizo = width + width * 0.1;
                thickDimGroup.innerHTML += `<line x1="${t2DimX_mizo}" y1="0" x2="${t2DimX_mizo}" y2="${flangeT}" /><text x="${t2DimX_mizo+textOffset}" y="${flangeT/2}" dominant-baseline="middle" text-anchor="start">t₂=${flangeT.toFixed(1)}</text>`;
                const t1DimY_mizo = -H * 0.1;
                thickDimGroup.innerHTML += `<line x1="0" y1="${t1DimY_mizo}" x2="${webT}" y2="${t1DimY_mizo}" /><text x="${webT/2}" y="${t1DimY_mizo-textOffset}" dominant-baseline="alphabetic" text-anchor="middle">t₁=${webT.toFixed(1)}</text>`;
                break;
            }
            case 'rippumizokatakou': {
                viewBox = `${-A * 0.3} ${-H * 0.2} ${A * 1.6} ${H * 1.4}`;
                g.innerHTML = `<rect x="0" y="0" width="${t}" height="${H}" /><rect x="0" y="0" width="${A}" height="${t}" /><rect x="0" y="${H - t}" width="${A}" height="${t}" /><rect x="${A - t}" y="0" width="${t}" height="${C}" /><rect x="${A - t}" y="${H - C}" width="${t}" height="${C}" />`;
                const hDimX_rip = -A * 0.15;
                dimGroup.innerHTML += `<line x1="${hDimX_rip}" y1="0" x2="${hDimX_rip}" y2="${H}" /><text x="${hDimX_rip - textOffset}" y="${H/2}" dominant-baseline="middle" text-anchor="end">${H.toFixed(1)}</text>`;
                const bDimY_rip = H + H * 0.15;
                dimGroup.innerHTML += `<line x1="0" y1="${bDimY_rip}" x2="${A}" y2="${bDimY_rip}" /><text x="${A/2}" y="${bDimY_rip+textOffset}" dominant-baseline="hanging" text-anchor="middle">${A.toFixed(1)}</text>`;
                const tDimX_rip = A + A * 0.1;
                thickDimGroup.innerHTML += `<line x1="${tDimX_rip}" y1="${H/2 - t/2}" x2="${tDimX_rip}" y2="${H/2 + t/2}" /><text x="${tDimX_rip+textOffset}" y="${H/2}" dominant-baseline="middle" text-anchor="start">板厚t=${t.toFixed(1)}</text>`;
                const cDimX_rip = A + A * 0.1;
                dimGroup.innerHTML += `<line x1="${cDimX_rip}" y1="0" x2="${cDimX_rip}" y2="${C}" /><text x="${cDimX_rip+textOffset}" y="${C/2}" dominant-baseline="middle" text-anchor="start">C=${C.toFixed(1)}</text>`;
                break;
            }
            case 'touhenyamakatakou': case 'futouhenyamagata': {
                const B = (type === 'touhenyamakatakou') ? A : dims.B; // ▼▼▼ この行を追加 ▼▼▼
                viewBox = `${-B * 0.3} ${-A * 0.2} ${B * 1.5} ${A * 1.4}`;
                g.innerHTML = `<path d="M0,0 L0,${A} L${B},${A} L${B},${A-t} L${t},${A-t} L${t},0 Z" />`;
                const hDimX_yama = -B * 0.15;
                dimGroup.innerHTML += `<line x1="${hDimX_yama}" y1="0" x2="${hDimX_yama}" y2="${A}" /><text x="${hDimX_yama - textOffset}" y="${A/2}" dominant-baseline="middle" text-anchor="end">${A.toFixed(1)}</text>`;
                const bDimY_yama = A + A * 0.15;
                dimGroup.innerHTML += `<line x1="0" y1="${bDimY_yama}" x2="${B}" y2="${bDimY_yama}" /><text x="${B/2}" y="${bDimY_yama+textOffset}" dominant-baseline="hanging" text-anchor="middle">${B.toFixed(1)}</text>`;
                const tDimX_yama = B + B * 0.1;
                thickDimGroup.innerHTML += `<line x1="${tDimX_yama}" y1="${A-t}" x2="${tDimX_yama}" y2="${A}" /><text x="${tDimX_yama + textOffset}" y="${A-t/2}" dominant-baseline="middle" text-anchor="start">板厚t=${t.toFixed(1)}</text>`;
                break;
            }
            case 'seihoukei': case 'tyouhoukei': {
                const height = A;
                // widthの宣言を1つに修正
                const width = (type === 'seihoukei') ? A : B; 
                viewBox = `${-width * 0.2} ${-height * 0.2} ${width * 1.5} ${height * 1.5}`;
                g.setAttribute('fill-rule', 'evenodd');
                g.innerHTML = `<path d="M0,0 H${width} V${height} H0 Z M${t},${t} V${height-t} H${width-t} V${t} Z" />`;
                const hDimX_kaku = -width * 0.15;
                dimGroup.innerHTML += `<line x1="${hDimX_kaku}" y1="0" x2="${hDimX_kaku}" y2="${height}" /><text x="${hDimX_kaku-textOffset}" y="${height/2}" dominant-baseline="middle" text-anchor="end">${height.toFixed(1)}</text>`;
                const bDimY_kaku = height + height * 0.15;
                dimGroup.innerHTML += `<line x1="0" y1="${bDimY_kaku}" x2="${width}" y2="${bDimY_kaku}" /><text x="${width/2}" y="${bDimY_kaku+textOffset}" dominant-baseline="hanging" text-anchor="middle">${width.toFixed(1)}</text>`;
                const tDimY_kaku = -height * 0.1;
                thickDimGroup.innerHTML += `<line x1="${width}" y1="${tDimY_kaku}" x2="${width-t}" y2="${tDimY_kaku}" /><text x="${width - t/2}" y="${tDimY_kaku - textOffset}" dominant-baseline="alphabetic" text-anchor="middle">板厚t=${t.toFixed(1)}</text>`;
                break;
            }
            case 'koukan': {
                viewBox = `${-D * 0.2} ${-D * 0.2} ${D * 1.5} ${D * 1.5}`;
                const R = D / 2;
                const r_inner = R - t;
                g.setAttribute('fill-rule', 'evenodd');
                g.innerHTML = `<path d="M${R},0 A${R},${R} 0 1,1 ${R},${D} A${R},${R} 0 1,1 ${R},0 Z M${R},${t} A${r_inner},${r_inner} 0 1,0 ${R},${D-t} A${r_inner},${r_inner} 0 1,0 ${R},${t} Z"/>`;
                const dDimY = D + D * 0.1;
                dimGroup.innerHTML += `<line x1="0" y1="${dDimY}" x2="${D}" y2="${dDimY}" /><text x="${R}" y="${dDimY+textOffset}" dominant-baseline="hanging" text-anchor="middle">φ${D.toFixed(1)}</text>`;
                const tDimY_koukan = -D * 0.1;
                thickDimGroup.innerHTML += `<line x1="${D}" y1="${tDimY_koukan}" x2="${D-t}" y2="${tDimY_koukan}" /><text x="${D - t/2}" y="${tDimY_koukan-textOffset}" dominant-baseline="alphabetic" text-anchor="middle">板厚t=${t.toFixed(1)}</text>`;
                break;
            }
            case '矩形': {
                const {H, B} = dims;
                viewBox = `${-B * 0.2} ${-H * 0.2} ${B * 1.4} ${H * 1.4}`;
                g.innerHTML = `<rect x="0" y="0" width="${B}" height="${H}" />`;
                const hDimX_r = -B * 0.15;
                dimGroup.innerHTML += `<line x1="${hDimX_r}" y1="0" x2="${hDimX_r}" y2="${H}" /><text x="${hDimX_r-textOffset}" y="${H/2}" dominant-baseline="middle" text-anchor="end">${H.toFixed(1)}</text>`;
                const bDimY_r = H + H * 0.15;
                dimGroup.innerHTML += `<line x1="0" y1="${bDimY_r}" x2="${B}" y2="${bDimY_r}" /><text x="${B/2}" y="${bDimY_r+textOffset}" dominant-baseline="hanging" text-anchor="middle">${B.toFixed(1)}</text>`;
                break;
            }
            case '円形': {
                const {D} = dims;
                viewBox = `${-D * 0.2} ${-D * 0.2} ${D * 1.4} ${D * 1.4}`;
                g.innerHTML = `<circle cx="${D/2}" cy="${D/2}" r="${D/2}" />`;
                const dDimY_c = D + D * 0.1;
                dimGroup.innerHTML += `<line x1="0" y1="${dDimY_c}" x2="${D}" y2="${dDimY_c}" /><text x="${D/2}" y="${dDimY_c+textOffset}" dominant-baseline="hanging" text-anchor="middle">φ${D.toFixed(1)}</text>`;
                break;
            }
        }
        svgElement.setAttribute('viewBox', viewBox);
        svgElement.appendChild(g);
        svgElement.appendChild(dimGroup);
        svgElement.appendChild(thickDimGroup);
    } catch (error) {
        console.error("SVG Drawing Error:", error);
        svgElement.innerHTML = '';
    }
};


const buildSectionDiagramData = (typeKey, rawDims = {}, options = {}) => {
        const {
            labelScaleMultiplier = 1,
            showDimensions = true  // 寸法線と寸法値の表示/非表示を制御
        } = options || {};

        const numericDims = Object.fromEntries(
            Object.entries(rawDims || {}).map(([key, value]) => {
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
    const baseGap = Math.max(maxDim * 0.02, fontSize * 0.5, 10);
    const smallGap = Math.max(maxDim * 0.01, fontSize * 0.4, 8);
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

            // 変更後（<text> タグに font-size 属性を追加）
const horizontalDim = (x1, x2, y, label, { position = 'below', gap = baseGap, anchor = 'middle', extraClass = '' } = {}) => {
    const textX = anchor === 'start' ? x1 : anchor === 'end' ? x2 : (x1 + x2) / 2;
    const lines = normalizeLabelLines(label);
    const lineCount = lines.length;
    const adjustedGap = adjustGapForLines(gap, lineCount);
    const textY = position === 'below' ? y + adjustedGap : y - adjustedGap;
    const markup = buildLabelMarkup(lines, textX);
    return `
        <g class="dimension horizontal ${extraClass}">
            <text class="dim-label" x="${textX}" y="${textY}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${fontSize.toFixed(2)}px">${markup}</text>
        </g>
    `;
};

            // 変更後（<text> タグに font-size 属性を追加）
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
            <text class="dim-label" x="${finalX}" y="${textY}" text-anchor="${textAnchor}" dominant-baseline="middle" font-size="${fontSize.toFixed(2)}px">${markup}</text>
        </g>
    `;
};

            return { horizontalDim, verticalDim, baseGap, smallGap };
        };

    // steel_selector.js ファイル内

// steel_selector.js ファイル内

const calculateLabelOptions = (maxDim, scale = 1) => {
    // 断面の大きさ(maxDim)に関わらず、常に固定のフォントサイズを返すように変更します。
    // この数値を変更すると、表示されるフォントサイズを調整できます。
    const fontSize = 24; 
    
    // その他の値も固定値またはfontSizeに基づく単純な計算に修正
    const labelStrokeWidth = 0.6;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const baseFontSize = fontSize;

    return { fontSize, baseFontSize, scale: safeScale, labelStrokeWidth };
};


        const calculateDiagramMargin = (maxDim, labelOptions = {}) => {
    let options = labelOptions;
    if (typeof labelOptions === 'number') {
        options = { fontSize: labelOptions };
    } else if (!labelOptions || typeof labelOptions !== 'object') {
        options = {};
    }

    const { fontSize } = options;
    const safeFont = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 32;

    // 断面の大きさ(maxDim)への依存をなくし、フォントサイズにのみ基づいてマージンを計算します。
    // これにより、どの断面サイズでもSVGの座標系のスケールが安定し、文字サイズも一定に見えるようになります。
    const fontBasedMargin = safeFont * 4.5; // フォントサイズの4.5倍をマージンとする
    
    return Math.max(80, fontBasedMargin); // 最小マージンとして80を確保
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
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            const t = sanitize(dims.t) || sanitize(dims.t1) || sanitize(dims.t2); // 統一された板厚 't' を使用
            const lip = sanitize(dims.C);

            if (!H || !flangeWidth || !t) return null;

            const width = flangeWidth;
            const height = H;
            const maxDim = Math.max(width, height);
            const labelOptions = calculateLabelOptions(maxDim, labelScaleMultiplier);
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            const margin = calculateDiagramMargin(maxDim, labelOptions.fontSize);
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
            mizogatakou: (dims) => renderChannelSection(dims),
            keimizogatakou: (dims) => renderChannelSection(dims),
            rippumizokatakou: (dims) => renderChannelSection(dims),
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

    const serializeSectionSvg = (typeKey, dims) => {
        if (!typeKey || !dims || Object.keys(dims).length === 0) return '';
        const preparedDims = normalizeSectionDimensions(typeKey, dims);
        const diagram = buildSectionDiagramData(typeKey, preparedDims, { labelScaleMultiplier: 0.5, showDimensions: false });
        if (!diagram || !diagram.markup) return '';
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        tempSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        tempSvg.setAttribute('viewBox', diagram.viewBox);
        tempSvg.setAttribute('width', '240');
        tempSvg.setAttribute('height', '180');
        tempSvg.innerHTML = diagram.markup;
        return tempSvg.outerHTML;
    };

    const buildSectionInfoFromDims = ({ typeKey, typeLabel, designation = '', dims = {}, imageUrl = '', source = 'library', axisInfo = null }) => {
        const validDims = Object.entries(dims)
            .filter(([_, value]) => typeof value === 'number' && isFinite(value) && value > 0)
            .map(([key, value]) => ({
                key,
                label: dimensionLabelMap[key] || key,
                value: Number(value.toFixed(2))
            }));

        const dimensionSummary = validDims.map(d => `${d.label}=${d.value}`).join(', ');
        const svgMarkup = serializeSectionSvg(typeKey, dims);

        return {
            typeKey,
            typeLabel,
            designation,
            label: designation ? `${typeLabel} ${designation}`.trim() : typeLabel,
            dimensions: validDims,
            dimensionSummary,
            svgMarkup,
            imageUrl,
            rawDims: dims,
            source,
            axis: axisInfo || null
        };
    };

    document.addEventListener('DOMContentLoaded', () => {
        const urlParams = new URLSearchParams(window.location.search);
        const materialType = urlParams.get('material') || 'steel';
        const initialE = urlParams.get('eValue');
        const initialStrength = urlParams.get('strengthValue');
        const targetMemberParam = urlParams.get('targetMember');
        const targetMemberIndex = (() => {
            if (targetMemberParam === null || targetMemberParam === '') return null;
            const parsed = parseInt(targetMemberParam, 10);
            return Number.isFinite(parsed) ? parsed : null;
        })();
        if (targetMemberIndex !== null) {
            try {
                sessionStorage.setItem('steelSelectorTargetMemberIndex', String(targetMemberIndex));
            } catch (storageError) {
                console.warn('ターゲット部材インデックスの保存に失敗しました:', storageError);
            }
        } else {
            try {
                sessionStorage.removeItem('steelSelectorTargetMemberIndex');
            } catch (storageError) {
                console.warn('ターゲット部材インデックスの初期化に失敗しました:', storageError);
            }
        }

        const typeSelect = document.getElementById('steel-type-select');
        const steelTitle = document.getElementById('steel-title');
        const tableSection = document.getElementById('table-section');
        const imageWrapper = document.getElementById('image-wrapper');
        const steelImage = document.getElementById('steel-image');
        const fullTableContainer = document.getElementById('full-table-container');
        const fullTableThead = document.querySelector('.full-table thead');
        const fullTableTbody = document.querySelector('.full-table tbody');
        const pickupWrapper = document.getElementById('pickup-wrapper');
        const pickupTbody = document.querySelector('.pickup-table tbody');
        const sectionSvg = document.getElementById('section-svg');
        const customCalculatorWrapper = document.getElementById('custom-calculator-wrapper');
        const customInputs = document.getElementById('custom-inputs');
        const customResultsTbody = document.querySelector('#custom-results-table tbody');
        const customSectionSvg = document.getElementById('custom-section-svg');
        const applySelectionBtn = document.getElementById('apply-selection-btn');
        const applyCustomBtn = document.getElementById('apply-custom-btn');

    let latestCustomRawResults = null;
    let latestCustomDisplayResults = null;
    let latestCustomInputs = null;

    const updatePickupDisplay = (rowIndex) => {
        const selectedTypeKey = typeSelect.value;
        if (!selectedTypeKey || rowIndex === null) {
            pickupWrapper.classList.add('hidden');
            return;
        }
        const steel = steelData[selectedTypeKey];
        if (!steel || !steel.data || !steel.data[rowIndex]) return;
        const rowData = steel.data[rowIndex];
        pickupTbody.innerHTML = '';
        steel.headers.forEach((header, index) => {
            if (header.includes('単位質量')) return;
            const tr = document.createElement('tr');
            const th = document.createElement('th'); th.textContent = translateHeader(header); tr.appendChild(th);
            const td = document.createElement('td'); td.textContent = rowData[index] === null ? '' : rowData[index]; tr.appendChild(td);
            pickupTbody.appendChild(tr);
        });
        
        const dims = getDimensionsFromRow(selectedTypeKey, rowData, steel.headers);
    drawSectionWithDimensions(sectionSvg, selectedTypeKey, dims, { labelScaleMultiplier: 0.1 });
        const pickupAxisSelector = document.getElementById('pickup-axis-selector');
        const hasIx = steel.headers.some(h => h.startsWith('Ix'));
        const hasIy = steel.headers.some(h => h.startsWith('Iy'));
        if (hasIx && hasIy) { pickupAxisSelector.classList.remove('hidden'); } 
        else { pickupAxisSelector.classList.add('hidden'); }
        pickupWrapper.classList.remove('hidden');
    };

    /**
     * 断面タイプ変更時の処理
     */
    typeSelect.addEventListener('change', () => {
        try {
            const selectedTypeKey = typeSelect.value;
            
            // 全セクションを隠す
            [tableSection, pickupWrapper, imageWrapper, customCalculatorWrapper]
                .forEach(el => el.classList.add('hidden'));
            
            // テーブル内容をクリア（選択状態もリセット）
            fullTableThead.innerHTML = '';
            fullTableTbody.innerHTML = '';
            
            // ピックアップ表示もクリア
            pickupWrapper.classList.add('hidden');

            if (steelData[selectedTypeKey]) {
                const steel = steelData[selectedTypeKey];
                if (!steel.headers || !steel.data || steel.data.length === 0) { 
                    alert('「' + typeSelect.options[typeSelect.selectedIndex].text + '」のデータは現在利用できません。'); 
                    return; 
                }
                
                // 鋼材タイトルを設定
                if (steelTitle) {
                    steelTitle.textContent = `${typeSelect.options[typeSelect.selectedIndex].text} 規格表`;
                }
                
                // 鋼材画像を設定
                const imageUrl = steelImages[selectedTypeKey];
                if (imageUrl) {
                    utils.setImageWithErrorHandling(steelImage, imageUrl, imageWrapper);
                }
                
                // テーブルを生成して表示
                populateFullTable(steel);
                tableSection.classList.remove('hidden');
                
                // カスタム計算ツールも表示
                generateCustomInputs(selectedTypeKey);
                customCalculatorWrapper.classList.remove('hidden');
                
            } else if (selectedTypeKey === '矩形' || selectedTypeKey === '円形') {
                // カスタム断面形状の場合
                if (steelTitle) {
                    steelTitle.textContent = `${typeSelect.options[typeSelect.selectedIndex].text} 性能値計算`;
                }
                generateCustomInputs(selectedTypeKey);
                customCalculatorWrapper.classList.remove('hidden');
            }
        } catch (error) { 
            console.error("断面タイプ変更エラー:", {
                error: error.message,
                selectedType: typeSelect.value,
                stack: error.stack
            }); 
            alert(`データの処理中にエラーが発生しました: ${error.message}`); 
        }
    });

    const populateFullTable = (steel) => {
        // ヘッダー行を生成
        const headerRow = document.createElement('tr');
        steel.headers.forEach(headerText => { 
            const th = document.createElement('th'); 
            th.textContent = translateHeader(headerText); 
            headerRow.appendChild(th); 
        });
        fullTableThead.appendChild(headerRow);
        
        // データ行を生成
        steel.data.forEach((rowData, index) => {
            const tr = document.createElement('tr');
            tr.dataset.index = index;
            
            // セルを生成
            rowData.forEach(cellData => { 
                const td = document.createElement('td'); 
                td.textContent = cellData === null ? '' : String(cellData); 
                tr.appendChild(td); 
            });
            
            // 行クリックイベントを追加
            tr.addEventListener('click', () => {
                // 既存の選択を解除
                fullTableTbody.querySelectorAll('tr').forEach(row => {
                    row.classList.remove('selected-row');
                });
                
                // 新しい行を選択
                tr.classList.add('selected-row');
                
                // ピックアップ表示を更新
                updatePickupDisplay(index);
            });
            
            fullTableTbody.appendChild(tr);
        });
    };
        
    // キーボードナビゲーション（矢印キーでの行選択）
    window.addEventListener('keydown', (e) => { 
        if (!['ArrowUp', 'ArrowDown'].includes(e.key) || fullTableContainer.classList.contains('hidden')) return; 
        e.preventDefault(); 
        
        let selectedRow = fullTableTbody.querySelector('.selected-row'), nextRow; 
        
        if (e.key === 'ArrowDown') { 
            nextRow = !selectedRow ? fullTableTbody.querySelector('tr') : selectedRow.nextElementSibling; 
        } else if (e.key === 'ArrowUp') { 
            nextRow = selectedRow ? selectedRow.previousElementSibling : null; 
        } 
        
        if (nextRow) { 
            if (selectedRow) selectedRow.classList.remove('selected-row'); 
            nextRow.classList.add('selected-row'); 
            nextRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); 
            updatePickupDisplay(nextRow.dataset.index); 
        } 
    });
    
    applySelectionBtn.addEventListener('click', () => {
        console.log('🎯 適用ボタンがクリックされました');
        const selectedRow = document.querySelector('.full-table .selected-row');
        if (!selectedRow) {
            console.warn('⚠️ 行が選択されていません');
            alert('テーブルから適用したい鋼材の行を選択してください。');
            return;
        }
        console.log('✅ 選択行:', selectedRow);
        const selectedTypeKey = document.getElementById('steel-type-select').value;
        console.log('✅ 選択された鋼材タイプ:', selectedTypeKey);
        const steel = steelData[selectedTypeKey], rowIndex = selectedRow.dataset.index, rowData = steel.data[rowIndex];
        const normalizedHeaders = steel.headers.map(normalizeHeaderKey);
        const getProp = (...keys) => findRowValueByKeys(steel.headers, normalizedHeaders, rowData, ...keys);
        const selectedAxis = document.querySelector('#pickup-axis-selector input[name="axis-select"]:checked')?.value || 'x';
        console.log('✅ 選択された軸:', selectedAxis);

        const areaValue = getProp('断面積', '面積', 'A');
        const ixValue = getProp('Ix', '強軸断面2次モーメント', 'I');
        const iyValue = getProp('Iy', '弱軸断面2次モーメント', 'I');
        const jValue = getProp('J', 'ねじり定数', 'torsion');
        const iwValue = getProp('Iw', '曲げねじり定数', 'warp');
        const zxValue = getProp('Zx', '強軸断面係数', 'Z');
        const zyValue = getProp('Zy', '弱軸断面係数', 'Z');
        const radiusXValue = getProp('ix', '強軸断面2次半径', 'i');
        const radiusYValue = getProp('iy', '弱軸断面2次半径', 'i');
        const densityValue = getProp('単位体積重量', '比重', '密度');

        const numericZx = parseNumericValue(zxValue ?? zyValue ?? getProp('Z'));
        const numericZy = parseNumericValue(zyValue ?? zxValue ?? getProp('Z'));
        const numericIx = parseNumericValue(ixValue ?? iyValue ?? getProp('I'));
        const numericIy = parseNumericValue(iyValue ?? ixValue ?? getProp('I'));
        const isSymmetricAxis = valuesApproximatelyEqual(numericZx, numericZy) || valuesApproximatelyEqual(numericIx, numericIy);
        const resolvedAxisKey = isSymmetricAxis ? 'both' : selectedAxis;

        const props = {
            E: '205000', // JIS規格は鋼材なのでE値を固定
            strengthType: 'F-value', // JIS規格は鋼材なのでF-value固定
            strengthValue: '235', // JIS規格選択時はF値をデフォルト値に戻す
            Ix: ixValue,
            Iy: iyValue,
            J: jValue,
            Iw: iwValue,
            I: resolvedAxisKey === 'y' ? (iyValue ?? ixValue ?? getProp('I')) : (ixValue ?? iyValue ?? getProp('I')),
            A: areaValue,
            Zx: zxValue ?? (isSymmetricAxis ? getProp('Z') : undefined),
            Zy: zyValue ?? (isSymmetricAxis ? getProp('Z') : undefined),
            Z: (() => {
                if (resolvedAxisKey === 'y') return zyValue ?? zxValue ?? getProp('Z');
                if (resolvedAxisKey === 'x') return zxValue ?? zyValue ?? getProp('Z');
                return zxValue ?? zyValue ?? getProp('Z');
            })(),
            ix: resolvedAxisKey === 'y' ? (radiusYValue ?? radiusXValue ?? getProp('i')) : (radiusXValue ?? radiusYValue ?? getProp('i')),
            iy: radiusYValue,
            density: densityValue
        };

        const dims = getDimensionsFromRow(selectedTypeKey, rowData, steel.headers);
        const typeLabel = typeSelect.options[typeSelect.selectedIndex]?.text || selectedTypeKey;
        const sectionAxisInfo = buildAxisInfo(resolvedAxisKey);
        const sectionInfo = buildSectionInfoFromDims({
            typeKey: selectedTypeKey,
            typeLabel,
            designation: rowData?.[0] ? String(rowData[0]) : '',
            dims,
            imageUrl: steelImages[selectedTypeKey] || '',
            source: 'library',
            axisInfo: sectionAxisInfo
        });

        props.sectionInfo = sectionInfo;
        props.sectionLabel = sectionInfo.label;
        props.sectionName = sectionInfo.label; // 互換性のため追加
        props.sectionAxis = sectionAxisInfo;
        props.sectionAxisLabel = sectionAxisInfo.label;
        props.sectionAxisMode = sectionAxisInfo.mode;
        props.sectionAxisKey = sectionAxisInfo.key;
        props.sectionSummary = sectionInfo.dimensionSummary;
        props.sectionSource = sectionInfo.source;
        props.selectedAxis = sectionAxisInfo.label; // 互換性のため追加
        if (targetMemberIndex !== null) {
            props.targetMemberIndex = targetMemberIndex;
        }

        console.log('📋 送信準備完了 - props:', {
            sectionName: props.sectionName,
            sectionLabel: props.sectionLabel,
            selectedAxis: props.selectedAxis,
            sectionAxisLabel: props.sectionAxisLabel,
            I: props.I,
            A: props.A,
            Z: props.Z,
            targetMemberIndex: props.targetMemberIndex
        });

        if (props.I !== undefined && props.A !== undefined) {
            console.log('✅ 必須プロパティ確認OK、sendDataToParentを呼び出します');
            try { ensureOutgoingSectionInfo(props); } catch (e) { /* ignore */ }
            sendDataToParent(props);
        } else {
            console.error('❌ 必須プロパティが不足:', { I: props.I, A: props.A });
            alert('性能値の取得に失敗しました。');
        }
    });

    applyCustomBtn.addEventListener('click', () => {
        const resultsTable = document.getElementById('custom-results-table');
        if (resultsTable.rows.length === 0) {
            alert('有効なカスタム計算結果がありません。');
            return;
        }

        if (!latestCustomInputs || Object.keys(latestCustomInputs).length === 0) {
            alert('カスタム寸法が正しく認識できませんでした。入力内容を確認してください。');
            return;
        }

        if (!latestCustomRawResults || Object.keys(latestCustomRawResults).length === 0) {
            alert('カスタム計算結果が取得できませんでした。寸法を入力して再計算してください。');
            return;
        }
        
        let strengthType;
        switch(materialType) {
            case 'wood': strengthType = 'wood-type'; break;
            case 'concrete': strengthType = 'Fc'; break;
            case 'stainless': strengthType = 'F-stainless'; break;
            case 'aluminum': strengthType = 'F-aluminum'; break;
            default: strengthType = 'F-value';
        }

        const props = {
            E: initialE, 
            strengthType: strengthType,
            strengthValue: initialStrength // 親画面から渡された値をそのまま返す
        };
        
        const calculatedProps = {};
        let zx_vals = [], zy_vals = [];
        for (const [key, value] of Object.entries(latestCustomRawResults)) {
            if (typeof value !== 'number' || !isFinite(value)) continue;

            const normalizedKey = key.toLowerCase();

            if (normalizedKey.includes('断面積')) {
                calculatedProps.A = value;
            }

            if (normalizedKey.includes('断面2次モーメント ix')) {
                calculatedProps.Ix = value;
            } else if (normalizedKey.includes('断面2次モーメント iy')) {
                calculatedProps.Iy = value;
            } else if (normalizedKey.includes('断面2次モーメント i (')) {
                calculatedProps.Ix = value;
                calculatedProps.Iy = value;
            }

            if (normalizedKey.includes('断面係数 zx')) {
                zx_vals.push(value);
            } else if (normalizedKey.includes('断面係数 zy')) {
                zy_vals.push(value);
            } else if (normalizedKey.includes('断面係数 z (')) {
                zx_vals.push(value);
                zy_vals.push(value);
            }

            if (normalizedKey.includes('断面2次半径 ix')) {
                calculatedProps.ix = value;
            } else if (normalizedKey.includes('断面2次半径 iy')) {
                calculatedProps.iy = value;
            } else if (normalizedKey.includes('断面2次半径 i (')) {
                calculatedProps.ix = value;
                calculatedProps.iy = value;
            }

            const isIwKey = normalizedKey.includes('曲げねじり定数')
                || normalizedKey.includes('warping')
                || normalizedKey.includes('iw (cm');
            const isJKey = (normalizedKey.includes('ねじり定数')
                || normalizedKey.includes(' torsion')
                || normalizedKey.includes('j (cm'))
                && !isIwKey;

            // NOTE: 「曲げねじり定数 Iw」が「ねじり定数」を含むため、Iw判定を優先する
            if (isIwKey) {
                calculatedProps.Iw = value;
            } else if (isJKey) {
                calculatedProps.J = value;
            }
        }

        if (calculatedProps.Ix !== undefined && calculatedProps.Iy === undefined) {
            calculatedProps.Iy = calculatedProps.Ix;
        }
        if (calculatedProps.Iy !== undefined && calculatedProps.Ix === undefined) {
            calculatedProps.Ix = calculatedProps.Iy;
        }

        const selectedTypeKey = typeSelect.value;
        const selectedAxis = document.querySelector('#custom-axis-selector input[name="custom-axis-select"]:checked')?.value || 'x';
        const zxValue = zx_vals.length > 0 ? Math.min(...zx_vals) : undefined;
        const zyValue = zy_vals.length > 0 ? Math.min(...zy_vals) : undefined;
        const unifiedZ = zxValue !== undefined ? zxValue : zyValue;

        props.A = calculatedProps.A;
        props.Ix = calculatedProps.Ix;
        props.Iy = calculatedProps.Iy;
        props.J = calculatedProps.J;
        props.Iw = calculatedProps.Iw;
        props.I = (selectedAxis === 'y' && calculatedProps.Iy !== undefined) ? calculatedProps.Iy : calculatedProps.Ix;
        props.ix = calculatedProps.ix;
        props.iy = calculatedProps.iy;
        props.Zx = zxValue !== undefined ? zxValue : (unifiedZ !== undefined ? unifiedZ : undefined);
        props.Zy = zyValue !== undefined ? zyValue : (unifiedZ !== undefined ? unifiedZ : undefined);
        props.Z = (selectedAxis === 'y' && props.Zy !== undefined) ? props.Zy : (props.Zx !== undefined ? props.Zx : unifiedZ);

        const typeLabel = typeSelect.options[typeSelect.selectedIndex]?.text || selectedTypeKey;
        const numericZx = parseNumericValue(props.Zx ?? props.Z);
        const numericZy = parseNumericValue(props.Zy ?? props.Z);
        const numericIx = parseNumericValue(calculatedProps.Ix ?? props.I);
        const numericIy = parseNumericValue(calculatedProps.Iy ?? props.I);
        const isSymmetricAxis = valuesApproximatelyEqual(numericZx, numericZy) || valuesApproximatelyEqual(numericIx, numericIy);
        const resolvedAxisKey = isSymmetricAxis ? 'both' : selectedAxis;
        const sectionAxisInfo = buildAxisInfo(resolvedAxisKey);
        const sectionInfo = buildSectionInfoFromDims({
            typeKey: selectedTypeKey,
            typeLabel,
            designation: '',
            dims: latestCustomInputs,
            imageUrl: steelImages[selectedTypeKey] || '',
            source: 'custom',
            axisInfo: sectionAxisInfo
        });
        props.sectionInfo = sectionInfo;
        props.sectionLabel = sectionInfo.label;
        props.sectionName = sectionInfo.label; // 互換性のため追加
        props.sectionAxis = sectionAxisInfo;
        props.sectionAxisLabel = sectionAxisInfo.label;
        props.sectionAxisMode = sectionAxisInfo.mode;
        props.sectionAxisKey = sectionAxisInfo.key;
        props.sectionSummary = sectionInfo.dimensionSummary;
        props.sectionSource = sectionInfo.source;
        props.selectedAxis = sectionAxisInfo.label; // 互換性のため追加
        if (targetMemberIndex !== null) {
            props.targetMemberIndex = targetMemberIndex;
        }

        if (props.I !== undefined && props.A !== undefined) {
            try { ensureOutgoingSectionInfo(props); } catch (e) { /* ignore */ }
            sendDataToParent(props);
        } else {
            alert('カスタム計算結果から必要な性能値を取得できませんでした。');
        }
    });

    const getDimensionsFromRow = (type, rowData, headers) => { 
        const dims = {}; 
        const findValue = (namePart) => { 
            const name = namePart.toLowerCase(); 
            const index = headers.findIndex(h => h.toLowerCase().startsWith(name)); 
            const value = index !== -1 ? parseFloat(rowData[index]) : NaN; 
            return isNaN(value) ? 0 : value; // NaNの場合は0を返す
        }; 
        
        try {
            switch(type) { 
                case 'hkatakou_hiro': 
                case 'hkatakou_naka': 
                case 'hkatakou_hoso': 
                case 'ikatakou': 
                case 'keiryouhkatakou': 
                    const hSizes = String(rowData[0] || '0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.H, dims.B] = hSizes.length >= 2 ? hSizes : [0, 0];
                    dims.t1 = findValue('t1'); 
                    dims.t2 = findValue('t2'); 
                    break; 
                case 'keiryourippuhkatakou': 
                    const rippuSizes = String(rowData[0] || '0×0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.H, dims.B, dims.C] = rippuSizes.length >= 3 ? rippuSizes : [0, 0, 0];
                    dims.t1 = findValue('t1'); 
                    dims.t2 = findValue('t2'); 
                    break; 
                case 'mizogatakou': 
                    const mizoSizes = String(rowData[0] || '0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.H, dims.B] = mizoSizes.length >= 2 ? mizoSizes : [0, 0];
                    dims.t1 = findValue('t1'); 
                    dims.t2 = findValue('t2'); 
                    break; 
                case 'touhenyamakatakou': 
                case 'futouhenyamagata': 
                    const yamaSizes = String(rowData[0] || '0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.A, dims.B] = yamaSizes.length >= 2 ? yamaSizes : [0, 0];
                    dims.t = findValue('t'); 
                    break; 
                case 'keimizogatakou': 
                    const keimizoSizes = String(rowData[0] || '0×0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.H, dims.A, dims.B] = keimizoSizes.length >= 3 ? keimizoSizes : [0, 0, 0];
                    dims.t = findValue('t'); 
                    break; 
                case 'rippumizokatakou': 
                    const rippumizoSizes = String(rowData[0] || '0×0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.H, dims.A, dims.C] = rippumizoSizes.length >= 3 ? rippumizoSizes : [0, 0, 0];
                    dims.t = findValue('t'); 
                    break; 
                case 'seihoukei': 
                case 'tyouhoukei': 
                    const kakuSizes = String(rowData[0] || '0×0').split('×').map(v => parseFloat(v) || 0);
                    [dims.A, dims.B] = kakuSizes.length >= 2 ? kakuSizes : [0, 0];
                    dims.t = findValue('t'); 
                    break; 
                case 'koukan': 
                    dims.D = parseFloat(rowData[0]) || 0; 
                    dims.t = findValue('板厚'); 
                    break; 
            } 
        } catch (error) {
            console.error('Error parsing dimensions:', error);
            // エラーが発生した場合はデフォルト値を設定
            dims.H = dims.A = dims.B = dims.C = dims.D = dims.t = dims.t1 = dims.t2 = 10;
        }
        
        return dims; 
    };
    const generateCustomInputs = (typeKey) => {
        customInputs.innerHTML = '';
        customResultsTbody.innerHTML = '';
        let params = [];
        switch (typeKey) {
            case 'hkatakou_hiro': case 'hkatakou_naka': case 'hkatakou_hoso': case 'ikatakou': case 'keiryouhkatakou': params = [['H', '高さ'], ['B', '幅'], ['t1', 'ウェブ厚'], ['t2', 'フランジ厚']]; break;
            case 'keiryourippuhkatakou': params = [['H', '高さ'], ['B', '幅'], ['C', 'リップ'], ['t1', 'ウェブ厚'], ['t2', 'フランジ厚']]; break;
            case 'mizogatakou': params = [['H', '高さ'], ['B', '幅'], ['t1', 'ウェブ厚'], ['t2', 'フランジ厚']]; break;
            case 'touhenyamakatakou': params = [['A', '辺'], ['t', '板厚']]; break;
            case 'futouhenyamagata': params = [['A', '辺A'], ['B', '辺B'], ['t', '板厚']]; break;
            case 'keimizogatakou': params = [['H', '高さ'], ['A', 'フランジ'],['B','ウェブ'], ['t', '板厚']]; break;
            case 'rippumizokatakou': params = [['H', '高さ'], ['A', '幅'], ['C', 'リップ'], ['t', '板厚']]; break;
            case 'seihoukei': params = [['A', '辺'], ['t', '板厚']]; break;
            case 'tyouhoukei': params = [['A', '高さA'], ['B', '幅B'], ['t', '板厚']]; break;
            case 'koukan': params = [['D', '外径'], ['t', '板厚']]; break;
            case '矩形': params = [['H', '高さ'], ['B', '幅']]; break;
            case '円形': params = [['D', '直径']]; break;
            default:
                customInputs.innerHTML = '<p>この断面形状のカスタム計算は現在対応していません。</p>';
                document.getElementById('custom-results').classList.add('hidden');
                document.getElementById('custom-svg-wrapper').classList.add('hidden');
                return;
        }
        document.getElementById('custom-results').classList.remove('hidden');
        document.getElementById('custom-svg-wrapper').classList.remove('hidden');

        params.forEach(([id, label]) => {
            const labelEl = document.createElement('label');
            labelEl.htmlFor = `custom-${id}`;
            labelEl.textContent = `${label} (mm):`;
            const inputEl = document.createElement('input');
            inputEl.type = 'number';
            inputEl.id = `custom-${id}`;
            inputEl.name = id;
            inputEl.step = '0.1';
            inputEl.min = '0';
            customInputs.appendChild(labelEl);
            customInputs.appendChild(inputEl);
        });
        const steel = steelData[typeKey];
        if (steel && steel.data.length > 0) {
            const initialDims = getDimensionsFromRow(typeKey, steel.data[0], steel.headers);
            for (const key in initialDims) {
                const inputEl = document.getElementById(`custom-${key}`);
                if(inputEl) inputEl.value = initialDims[key];
            }
        } else {
            if(typeKey === '矩形'){
                document.getElementById('custom-H').value = 200;
                document.getElementById('custom-B').value = 100;
            } else if (typeKey === '円形'){
                document.getElementById('custom-D').value = 150;
            }
        }
        customInputs.removeEventListener('input', updateCustomCalculation);
        customInputs.addEventListener('input', updateCustomCalculation);
        updateCustomCalculation();
    };

    const updateCustomCalculation = () => { 
        const selectedTypeKey = typeSelect.value; 
        const inputs = {}; 
        const inputElements = customInputs.querySelectorAll('input[type="number"]'); 
        let hasError = false; 
        
        inputElements.forEach(input => { 
            const value = parseFloat(input.value); 
            if (isNaN(value) || value <= 0) { 
                hasError = true; 
            } 
            inputs[input.name] = value; 
        }); 
        
        console.log('Custom calculation inputs:', {selectedTypeKey, inputs, hasError});
        
    drawSectionWithDimensions(customSectionSvg, selectedTypeKey, inputs, { labelScaleMultiplier: 0.2 }); 
        
        if (hasError) { 
            latestCustomInputs = {}; 
            latestCustomRawResults = {}; 
            latestCustomDisplayResults = {}; 
            customResultsTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;">すべての寸法に正の数値を入力してください。</td></tr>'; 
            return; 
        } 
        
        latestCustomInputs = { ...inputs };
        const results = calculateProperties(selectedTypeKey, inputs); 
        console.log('Calculation results:', results);
        
        displayCustomResults(results); 
        
        const customAxisSelector = document.getElementById('custom-axis-selector'); 
        const hasIx = Object.keys(results).some(key => key.includes('Ix')); 
        const hasIy = Object.keys(results).some(key => key.includes('Iy')); 
        if (hasIx && hasIy) { 
            customAxisSelector.classList.remove('hidden'); 
        } else { 
            customAxisSelector.classList.add('hidden'); 
        } 
    };
    
    const calculateProperties = (typeKey, dims) => {
        const results = {};
        const dimsCm = Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v / 10]));
        try {
            switch (typeKey) {
                case 'hkatakou_hiro': case 'hkatakou_naka': case 'hkatakou_hoso': case 'ikatakou': case 'keiryouhkatakou': case 'keiryourippuhkatakou': {
                    const { H, B, t1, t2 } = dimsCm;
                    if (!H || !B || !t1 || !t2 || H <= 2 * t2 || B <= t1) return {};
                    const A_h = 2 * B * t2 + (H - 2 * t2) * t1;
                    const Ix_h = (B * H**3 - (B - t1) * (H - 2 * t2)**3) / 12;
                    const Iy_h = (2 * t2 * B**3 + (H - 2 * t2) * t1**3) / 12;

                    // ねじり定数J（薄肉近似：矩形板の和）
                    const J = (1 / 3) * (2 * B * Math.pow(t2, 3) + (H - 2 * t2) * Math.pow(t1, 3));
                    // 曲げねじり定数Iw（AISC系の近似：Cw ≒ (b_f^3 * t_f * h0^2) / 24）
                    const h0 = H - t2; // フランジ重心間距離の近似
                    const Iw = (Math.pow(B, 3) * t2 * Math.pow(h0, 2)) / 24;

                    Object.assign(results, {
                        '断面積 (cm²)': A_h,
                        '断面2次モーメント Ix (cm⁴)': Ix_h,
                        '断面2次モーメント Iy (cm⁴)': Iy_h,
                        '断面2次半径 ix (cm)': Math.sqrt(Ix_h / A_h),
                        '断面2次半径 iy (cm)': Math.sqrt(Iy_h / A_h),
                        '断面係数 Zx (cm³)': Ix_h / (H / 2),
                        '断面係数 Zy (cm³)': Iy_h / (B / 2),
                        'ねじり定数 J (cm⁴)': J,
                        '曲げねじり定数 Iw (cm⁶)': Iw
                    });
                    break;
                }
                case 'mizogatakou': case 'keimizogatakou': case 'rippumizokatakou': { 
                    let H, B_flange, t_web, t_flange, C = 0;
                    
                    if (typeKey === 'mizogatakou') {
                        // 一般みぞ形鋼: H, B, t1(ウェブ厚), t2(フランジ厚)
                        H = dimsCm.H;
                        B_flange = dimsCm.B;
                        t_web = dimsCm.t1;
                        t_flange = dimsCm.t2;
                    } else if (typeKey === 'keimizogatakou') {
                        // 軽量みぞ形鋼: H, A(フランジ), B(ウェブ), t(板厚)
                        H = dimsCm.H;
                        B_flange = dimsCm.A;
                        t_web = dimsCm.t;
                        t_flange = dimsCm.t;
                    } else if (typeKey === 'rippumizokatakou') {
                        // リップみぞ形鋼: H, A(幅), C(リップ), t(板厚)
                        H = dimsCm.H;
                        B_flange = dimsCm.A;
                        t_web = dimsCm.t;
                        t_flange = dimsCm.t;
                        C = dimsCm.C;
                    }
                    
                    const hasLips = typeKey === 'rippumizokatakou';
                    
                    if (!H || !B_flange || !t_web || !t_flange) {
                        console.error('Missing required dimensions for mizogatakou calculation:', {H, B_flange, t_web, t_flange});
                        return {};
                    }
                    
                    const lip_h = hasLips ? C : 0;
                    if (H <= 2*t_flange || B_flange <= t_web || (hasLips && lip_h < t_flange)) {
                        console.error('Invalid dimensions for mizogatakou:', {H, B_flange, t_web, t_flange, lip_h});
                        return {};
                    } 
                    
                    const web_A = (H-2*t_flange)*t_web;
                    const flange_A = B_flange*t_flange;
                    const lip_A = hasLips ? (lip_h-t_flange)*t_flange : 0;
                    const total_A = web_A + 2*flange_A + 2*lip_A; 
                    
                    const web_Cy = t_web/2;
                    const flange_Cy = B_flange/2;
                    const lip_Cy = B_flange - t_flange/2;
                    const global_Cy = (web_A*web_Cy + 2*flange_A*flange_Cy + 2*lip_A*lip_Cy) / total_A; 
                    
                    const Ix_web = t_web*Math.pow(H-2*t_flange,3)/12; 
                    const Ix_flange = B_flange*Math.pow(t_flange,3)/12 + flange_A*Math.pow(H/2-t_flange/2,2); 
                    const Ix_lip_centroidal = hasLips ? t_flange*Math.pow(lip_h-t_flange,3)/12 : 0; 
                    const Ix_lip = hasLips ? Ix_lip_centroidal + lip_A*Math.pow(H/2-t_flange-(lip_h-t_flange)/2,2) : 0; 
                    const Ix = Ix_web + 2*Ix_flange + 2*Ix_lip; 
                    
                    const Iy_web = (H-2*t_flange)*Math.pow(t_web,3)/12 + web_A*Math.pow(global_Cy-web_Cy,2); 
                    const Iy_flange = t_flange*Math.pow(B_flange,3)/12 + flange_A*Math.pow(global_Cy-flange_Cy,2); 
                    const Iy_lip_centroidal = hasLips ? (lip_h-t_flange)*Math.pow(t_flange,3)/12 : 0; 
                    const Iy_lip = hasLips ? Iy_lip_centroidal + lip_A*Math.pow(global_Cy-lip_Cy,2) : 0; 
                    const Iy = Iy_web + 2*Iy_flange + 2*Iy_lip; 

                    // ねじり定数J（薄肉近似：矩形板の和）
                    const lipLen = hasLips ? Math.max(0, (lip_h - t_flange)) : 0;
                    const J = (1 / 3) * (
                        2 * B_flange * Math.pow(t_flange, 3) +
                        (H - 2 * t_flange) * Math.pow(t_web, 3) +
                        2 * lipLen * Math.pow(t_flange, 3)
                    );
                    // 曲げねじり定数Iw（簡易近似：I形の式を準用）
                    const h0 = H - t_flange;
                    const Iw = (Math.pow(B_flange, 3) * t_flange * Math.pow(h0, 2)) / 24;
                    
                    Object.assign(results, {
                        '断面積 (cm²)': total_A, 
                        '図心距離 Cy (cm)': global_Cy, 
                        '断面2次モーメント Ix (cm⁴)': Ix, 
                        '断面2次モーメント Iy (cm⁴)': Iy, 
                        '断面2次半径 ix (cm)': Math.sqrt(Ix/total_A), 
                        '断面2次半径 iy (cm)': Math.sqrt(Iy/total_A), 
                        '断面係数 Zx (cm³)': Ix/(H/2), 
                        '断面係数 Zy (フランジ先端側, cm³)': Iy/(B_flange - global_Cy), 
                        '断面係数 Zy (ウェブ側, cm³)': Iy/global_Cy,
                        'ねじり定数 J (cm⁴)': J,
                        '曲げねじり定数 Iw (cm⁶)': Iw
                    }); 
                    break; 
                } 
                case 'touhenyamakatakou': case 'futouhenyamagata': { const sideA = dimsCm.A, sideB = (typeKey==='touhenyamakatakou')?dimsCm.A:dimsCm.B, t = dimsCm.t; if(!sideA||!sideB||!t||sideA<t||sideB<t) return {}; const r1_A=sideA*t, r2_A=(sideB-t)*t, total_A=r1_A+r2_A; const r1_Cx=t/2, r1_Cy=sideA/2, r2_Cx=t+(sideB-t)/2, r2_Cy=t/2; const global_Cx=(r1_A*r1_Cx+r2_A*r2_Cx)/total_A, global_Cy=(r1_A*r1_Cy+r2_A*r2_Cy)/total_A; const Ix1=t*sideA**3/12+r1_A*(r1_Cy-global_Cy)**2, Iy1=sideA*t**3/12+r1_A*(r1_Cx-global_Cx)**2; const Ixy1=r1_A*(r1_Cx-global_Cx)*(r1_Cy-global_Cy); const Ix2=(sideB-t)*t**3/12+r2_A*(r2_Cy-global_Cy)**2, Iy2=t*(sideB-t)**3/12+r2_A*(r2_Cx-global_Cx)**2; const Ixy2=r2_A*(r2_Cx-global_Cx)*(r2_Cy-global_Cy); const Ix=Ix1+Ix2, Iy=Iy1+Iy2, Ixy=Ixy1+Ixy2; const I_avg=(Ix+Iy)/2, R=Math.sqrt(((Ix-Iy)/2)**2+Ixy**2); const Iu=I_avg+R, Iv=I_avg-R; const alpha=(Ix===Iy)?0:Math.atan2(-2*Ixy,Ix-Iy)/2; const Zx_upper=Ix/(sideA-global_Cy), Zx_lower=Ix/global_Cy, Zy_right=Iy/(sideB-global_Cx), Zy_left=Iy/global_Cx; Object.assign(results, { '断面積 (cm²)':total_A, '図心距離 Cx (cm)':global_Cx, '図心距離 Cy (cm)':global_Cy, '断面2次モーメント Ix (cm⁴)':Ix, '断面2次モーメント Iy (cm⁴)':Iy, '断面係数 Zx (上縁, cm³)':Zx_upper, '断面係数 Zx (下縁, cm³)':Zx_lower, '断面係数 Zy (右縁, cm³)':Zy_right, '断面係数 Zy (左縁, cm³)':Zy_left, '断面2次半径 ix (cm)':Math.sqrt(Ix/total_A), '断面2次半径 iy (cm)':Math.sqrt(Iy/total_A), '主軸の傾き α (deg)':alpha*180/Math.PI, '主断面2次モーメント Iu(最大) (cm⁴)':Iu, '主断面2次モーメント Iv(最小) (cm⁴)':Iv, '主断面2次半径 iu(最大) (cm)':Math.sqrt(Iu/total_A), '主断面2次半径 iv(最小) (cm)':Math.sqrt(Iv/total_A) }); break; } 
                case 'seihoukei':
                case 'tyouhoukei': {
                    const A_dim = dimsCm.A;
                    const B_dim = (typeKey==='seihoukei') ? dimsCm.A : dimsCm.B;
                    const t = dimsCm.t;
                    if(!A_dim||!B_dim||!t||A_dim<=2*t||B_dim<=2*t) return {};
                    const A = A_dim*B_dim-(A_dim-2*t)*(B_dim-2*t);
                    const Ix=(B_dim*Math.pow(A_dim,3)-(B_dim-2*t)*Math.pow(A_dim-2*t,3))/12;
                    const Iy=(A_dim*Math.pow(B_dim,3)-(A_dim-2*t)*Math.pow(B_dim-2*t,3))/12;

                    // 閉断面：薄肉閉断面近似 J = 4 Am^2 / Σ(s/t)
                    const a_m = A_dim - t;
                    const b_m = B_dim - t;
                    const Am = a_m * b_m;
                    const sum_s_over_t = (2*a_m + 2*b_m) / t;
                    const J = (sum_s_over_t > 0) ? (4 * Math.pow(Am, 2) / sum_s_over_t) : 0;
                    const Iw = 0;

                    Object.assign(results, {
                        '断面積 (cm²)':A,
                        '断面2次モーメント Ix (cm⁴)':Ix,
                        '断面2次モーメント Iy (cm⁴)':Iy,
                        '断面2次半径 ix (cm)':Math.sqrt(Ix/A),
                        '断面2次半径 iy (cm)':Math.sqrt(Iy/A),
                        '断面係数 Zx (cm³)':Ix/(A_dim/2),
                        '断面係数 Zy (cm³)':Iy/(B_dim/2),
                        'ねじり定数 J (cm⁴)': J,
                        '曲げねじり定数 Iw (cm⁶)': Iw
                    });
                    break;
                }
                case 'koukan': {
                    const { D,t } = dimsCm;
                    if(!D||!t||D<=2*t) return {};
                    const d=D-2*t;
                    const A=Math.PI/4*(D**2-d**2);
                    const I=Math.PI/64*(D**4-d**4);
                    const J = (Math.PI/32) * (D**4 - d**4); // 閉断面：極二次モーメント
                    const Iw = 0;
                    Object.assign(results, {
                        '断面積 (cm²)':A,
                        '断面2次モーメント I (cm⁴)':I,
                        '断面2次半径 i (cm)':Math.sqrt(I/A),
                        '断面係数 Z (cm³)':I/(D/2),
                        'ねじり定数 J (cm⁴)': J,
                        '曲げねじり定数 Iw (cm⁶)': Iw
                    });
                    break;
                }
                case '矩形': {
                    const { H,B } = dimsCm;
                    if(!H||!B) return {};
                    const A=B*H;
                    const Ix=(B*Math.pow(H,3))/12;
                    const Iy=(H*Math.pow(B,3))/12;

                    // ねじり定数J（矩形断面の近似式；H>=Bを想定して並べ替え）
                    const a = Math.max(H, B);
                    const b = Math.min(H, B);
                    const ratio = b / a;
                    const J = a*Math.pow(b,3) * (1/3 - 0.21*ratio*(1 - Math.pow(ratio,4)/12));
                    const Iw = 0;

                    Object.assign(results, {
                        '断面積 (cm²)':A,
                        '断面2次モーメント Ix (cm⁴)':Ix,
                        '断面2次モーメント Iy (cm⁴)':Iy,
                        '断面2次半径 ix (cm)':Math.sqrt(Ix/A),
                        '断面2次半径 iy (cm)':Math.sqrt(Iy/A),
                        '断面係数 Zx (cm³)':Ix/(H/2),
                        '断面係数 Zy (cm³)':Iy/(B/2),
                        'ねじり定数 J (cm⁴)': J,
                        '曲げねじり定数 Iw (cm⁶)': Iw
                    });
                    break;
                }
                case '円形': {
                    const { D } = dimsCm;
                    if(!D) return {};
                    const R=D/2;
                    const A=Math.PI*R**2;
                    const I=(Math.PI*D**4)/64;
                    const J=(Math.PI*D**4)/32;
                    const Iw=0;
                    Object.assign(results, {
                        '断面積 (cm²)':A,
                        '断面2次モーメント I (cm⁴)':I,
                        '断面2次半径 i (cm)':R/2,
                        '断面係数 Z (cm³)':I/R,
                        'ねじり定数 J (cm⁴)': J,
                        '曲げねじり定数 Iw (cm⁶)': Iw
                    });
                    break;
                }
            }
        } catch(e) { console.error("Calculation Error:", e); return {}; }
        return results;
    };
    
    const displayCustomResults = (results) => { 
        console.log('Displaying custom results:', results);
        customResultsTbody.innerHTML = ''; 
        
        if (!results || Object.keys(results).length === 0) {
            latestCustomRawResults = {};
            latestCustomDisplayResults = {};
            console.log('No results to display');
            return;
        }

        latestCustomRawResults = { ...results };
        const symmetryMode = determineAxisSymmetry(results);
        const normalizedResults = coalesceSymmetricProperties(results, { enabled: symmetryMode === 'both' });
        latestCustomDisplayResults = { ...normalizedResults };

        for (const [key, rawValue] of Object.entries(normalizedResults)) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            const td = document.createElement('td');
            th.textContent = key;

            if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
                td.textContent = Number(rawValue.toFixed(3)).toLocaleString();
            } else {
                td.textContent = rawValue ?? '';
            }

            tr.appendChild(th);
            tr.appendChild(td);
            customResultsTbody.appendChild(tr);
        }

        if (symmetryMode === 'both') {
            const noteRow = document.createElement('tr');
            const noteCell = document.createElement('td');
            noteCell.colSpan = 2;
            noteCell.className = 'custom-results-note';
            noteCell.textContent = '※ この断面は上下左右対称のため、両軸で共通の値になっています。';
            noteRow.appendChild(noteCell);
            customResultsTbody.appendChild(noteRow);
        }
        console.log('Results displayed successfully');
    };

    // 初期化処理
    typeSelect.dispatchEvent(new Event('change'));
});