// 新しい変位図描画関数の実装

// DOM要素の参照を取得（他のファイルとの競合を避けるため、diagramElementsに変更）
const diagramElements = {
    get displacementCanvas() {
        return document.getElementById('displacement-canvas') || 
               document.getElementById('displacementCanvas') || 
               document.querySelector('#displacement-canvas') ||
               document.querySelector('#displacementCanvas') ||
               document.querySelector('canvas[id*="displacement"]') ||
               document.querySelector('canvas[class*="displacement"]');
    },
    get momentCanvas() {
        return document.getElementById('moment-canvas') || 
               document.getElementById('momentCanvas') || 
               document.querySelector('#moment-canvas') ||
               document.querySelector('#momentCanvas') ||
               document.querySelector('canvas[id*="moment"]') ||
               document.querySelector('canvas[class*="moment"]');
    },
    get axialCanvas() {
        return document.getElementById('axial-canvas') || 
               document.getElementById('axialCanvas') || 
               document.querySelector('#axial-canvas') ||
               document.querySelector('#axialCanvas') ||
               document.querySelector('canvas[id*="axial"]') ||
               document.querySelector('canvas[class*="axial"]');
    },
    get shearCanvas() {
        return document.getElementById('shear-canvas') || 
               document.getElementById('shearCanvas') || 
               document.querySelector('#shear-canvas') ||
               document.querySelector('#shearCanvas') ||
               document.querySelector('canvas[id*="shear"]') ||
               document.querySelector('canvas[class*="shear"]');
    },
    get capacityRatioCanvas() {
        return document.getElementById('ratio-canvas') || 
               document.getElementById('capacityRatioCanvas') || 
               document.querySelector('#ratio-canvas') ||
               document.querySelector('#capacityRatioCanvas') ||
               document.querySelector('canvas[id*="ratio"]') ||
               document.querySelector('canvas[id*="capacity"]') ||
               document.querySelector('canvas[class*="ratio"]') ||
               document.querySelector('canvas[class*="capacity"]');
    },
    get dispScaleInput() {
        return document.getElementById('dispScaleInput') || 
               document.querySelector('#dispScaleInput') ||
               document.querySelector('input[id*="dispScale"]') ||
               document.querySelector('input[class*="dispScale"]');
    }
};

console.log('🎯 Diagram Elements found:', {
    displacementCanvas: !!diagramElements.displacementCanvas,
    momentCanvas: !!diagramElements.momentCanvas,
    axialCanvas: !!diagramElements.axialCanvas,
    shearCanvas: !!diagramElements.shearCanvas,
    capacityRatioCanvas: !!diagramElements.capacityRatioCanvas,
    dispScaleInput: !!diagramElements.dispScaleInput
});

/**
 * 部材途中の変形を計算する関数（3Dフレーム対応）
 * 曲げモーメントによるたわみを考慮した詳細な変形計算
 * 
 * @param {object} member - 部材オブジェクト
 * @param {array} nodes - 節点配列
 * @param {array} D_global - 全体変位ベクトル
 * @param {object} memberForce - 部材力オブジェクト
 * @param {number} xi - 部材長さ方向の無次元座標 (0.0 ~ 1.0)
 * @param {number} dispScale - 変位の拡大倍率
 * @returns {object} 変形後の3D座標 {x, y, z}
 */
const calculateMemberDeformation = (member, nodes, D_global, memberForce, xi, dispScale) => {
    const nodeI = nodes[member.i];
    const nodeJ = nodes[member.j];
    
    if (!nodeI || !nodeJ) return null;
    
    const is3D = D_global.length / nodes.length === 6;
    
    // 部材の元の座標（線形補間）
    const original_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
    const original_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
    const original_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
    
    if (!is3D) {
        // 2Dの場合は単純な線形補間
        const d_i = {
            dx: D_global[member.i * 3][0],
            dy: D_global[member.i * 3 + 1][0]
        };
        const d_j = {
            dx: D_global[member.j * 3][0],
            dy: D_global[member.j * 3 + 1][0]
        };
        
        const dx = d_i.dx + (d_j.dx - d_i.dx) * xi;
        const dy = d_i.dy + (d_j.dy - d_i.dy) * xi;
        
        return {
            x: original_x + dx * dispScale,
            y: original_y + dy * dispScale,
            z: original_z
        };
    }
    
    // 3Dの場合は節点変位と回転を考慮
    const d_i = {
        dx: D_global[member.i * 6][0],
        dy: D_global[member.i * 6 + 1][0],
        dz: D_global[member.i * 6 + 2][0],
        rx: D_global[member.i * 6 + 3][0],
        ry: D_global[member.i * 6 + 4][0],
        rz: D_global[member.i * 6 + 5][0]
    };
    const d_j = {
        dx: D_global[member.j * 6][0],
        dy: D_global[member.j * 6 + 1][0],
        dz: D_global[member.j * 6 + 2][0],
        rx: D_global[member.j * 6 + 3][0],
        ry: D_global[member.j * 6 + 4][0],
        rz: D_global[member.j * 6 + 5][0]
    };
    
    // 部材の長さ
    const L = Math.sqrt(
        Math.pow(nodeJ.x - nodeI.x, 2) +
        Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) +
        Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
    );
    
    if (L < 1e-10) return null;
    
    // 部材の局所座標系における変位を計算
    // エルミート補間を使用して曲げ変形を表現
    const x = xi; // 無次元座標（0~1）
    
    // エルミート基底関数（変位用）
    const H1 = 1 - 3*x*x + 2*x*x*x;
    const H2 = x - 2*x*x + x*x*x;
    const H3 = 3*x*x - 2*x*x*x;
    const H4 = -x*x + x*x*x;
    
    // 曲げ変形の計算
    // エルミート補間により、節点の変位と回転角から部材途中の変形を計算
    
    // 節点の変位と回転角
    // Y方向（全体座標系のY方向の変位）
    const v_i = d_i.dy;
    const v_j = d_j.dy;
    const theta_z_i = d_i.rz;
    const theta_z_j = d_j.rz;
    
    // Z方向（全体座標系のZ方向の変位）
    const w_i = d_i.dz;
    const w_j = d_j.dz;
    const theta_y_i = -d_i.ry; // 符号注意：右手系座標
    const theta_y_j = -d_j.ry;
    
    // エルミート補間による変形曲線
    // v(x) = H1 * v_i + H2 * L * θz_i + H3 * v_j + H4 * L * θz_j
    const dy = H1 * v_i + H2 * L * theta_z_i + H3 * v_j + H4 * L * theta_z_j;
    const dz = H1 * w_i + H2 * L * theta_y_i + H3 * w_j + H4 * L * theta_y_j;
    
    // 軸方向変位の線形補間
    const dx = d_i.dx + (d_j.dx - d_i.dx) * xi;
    
    // 変形後の座標
    return {
        x: original_x + dx * dispScale,
        y: original_y + dy * dispScale,
        z: original_z + dz * dispScale
    };
};

/**
 * 部材途中の曲げモーメントを計算する関数（3Dフレーム対応）
 * せん断力が一定の場合は線形、等分布荷重がある場合は二次曲線を考慮
 * 
 * @param {object} memberForce - 部材力オブジェクト
 * @param {number} L - 部材長さ (m)
 * @param {number} xi - 部材長さ方向の無次元座標 (0.0 ~ 1.0)
 * @param {string} axis - モーメント軸 ('y' or 'z')
 * @param {number} w - 等分布荷重 (kN/m) - オプション
 * @returns {number} 位置xiでの曲げモーメント値 (kN・m)
 */
const calculateMemberAxial = (memberForce, xi) => {
    if (!memberForce) return 0;
    const { Ni, Nj } = getAxialComponents(memberForce);
    const start = toNumber(Ni, 0);
    const end = toNumber(Nj, start);
    const rawValue = start + (end - start) * xi;
    const targetStart = convertAxialForDiagram(start, 'i');
    const targetEnd = convertAxialForDiagram(end, 'j');
    return adjustValueForEndpoints(rawValue, start, end, targetStart, targetEnd, xi);
};

// 3D構造用の軸別応力計算関数
const calculateMemberMomentForAxis = (memberForce, L, xi, axis, w = null) => {
    if (!memberForce) return 0;
    if (!Number.isFinite(L) || Math.abs(L) <= 1e-9) return 0;

    const { Mi, Mj } = getMomentComponentsForAxis(memberForce, axis);
    const { Qi, Qj } = getShearComponentsForAxis(memberForce, axis);

    const M_i = Mi;
    const M_j = Mj;
    const Q_i = Number.isFinite(Qi) ? Qi : 0;
    const Q_j = Number.isFinite(Qj) ? Qj : Q_i;

    const x_m = xi * L; // 実際の距離（m）

    let equivalentW;
    if (Number.isFinite(w) && w !== null) {
        equivalentW = w;
    } else if (Number.isFinite(Q_i) && Number.isFinite(Q_j)) {
        equivalentW = (Q_i - Q_j) / L;
    } else {
        equivalentW = 0;
    }

    let moment = M_i + Q_i * x_m - 0.5 * equivalentW * x_m * x_m;

    if (Number.isFinite(M_j)) {
        const predictedEndMoment = M_i + Q_i * L - 0.5 * equivalentW * L * L;
        const delta = predictedEndMoment - M_j;
        if (Number.isFinite(delta) && Math.abs(L) > 1e-9) {
            moment -= delta * (x_m / L);
        }
    }

    const rawStart = M_i;
    const rawEnd = M_j;
    const targetStart = convertMomentForDiagram(rawStart, 'i');
    const targetEnd = convertMomentForDiagram(rawEnd, 'j');
    return adjustValueForEndpoints(moment, rawStart, rawEnd, targetStart, targetEnd, xi);
};

const calculateMemberShearForAxis = (memberForce, L, xi, axis, w = null) => {
    if (!memberForce) return 0;
    const x_m = xi * L; // 実際の距離（m）

    const { Qi, Qj } = getShearComponentsForAxis(memberForce, axis);
    const Q_i = Number.isFinite(Qi) ? Qi : 0;
    const Q_j = Number.isFinite(Qj) ? Qj : Q_i;

    let equivalentW;
    if (Number.isFinite(w) && w !== null) {
        equivalentW = w;
    } else if (Number.isFinite(Q_i) && Number.isFinite(Q_j) && Math.abs(L) > 1e-9) {
        equivalentW = (Q_i - Q_j) / L;
    } else {
        equivalentW = 0;
    }

    const shear = Q_i - equivalentW * x_m;

    const rawStart = Q_i;
    const rawEnd = Q_j;
    const targetStart = convertShearForDiagram(rawStart, 'i');
    const targetEnd = convertShearForDiagram(rawEnd, 'j');
    return adjustValueForEndpoints(shear, rawStart, rawEnd, targetStart, targetEnd, xi);
};

const calculateMemberMoment = (memberForce, L, xi, axis = 'y', w = null) => {
    if (!memberForce) return 0;
    if (!Number.isFinite(L) || Math.abs(L) <= 1e-9) return 0;

    const { Mi, Mj } = getMomentComponentsForAxis(memberForce, axis);
    const { Qi, Qj } = getShearComponentsForAxis(memberForce, axis);

    const M_i = Mi;
    const M_j = Mj;
    const Q_i = Number.isFinite(Qi) ? Qi : 0;
    const Q_j = Number.isFinite(Qj) ? Qj : Q_i;

    const x_m = xi * L; // 実際の距離（m）

    let equivalentW;
    if (Number.isFinite(w) && w !== null) {
        equivalentW = w;
    } else if (Number.isFinite(Q_i) && Number.isFinite(Q_j)) {
        equivalentW = (Q_i - Q_j) / L;
    } else {
        equivalentW = 0;
    }

    let moment = M_i + Q_i * x_m - 0.5 * equivalentW * x_m * x_m;

    if (Number.isFinite(M_j)) {
        const predictedEndMoment = M_i + Q_i * L - 0.5 * equivalentW * L * L;
        const delta = predictedEndMoment - M_j;
        if (Number.isFinite(delta) && Math.abs(L) > 1e-9) {
            moment -= delta * (x_m / L);
        }
    }

    const rawStart = M_i;
    const rawEnd = M_j;
    const targetStart = convertMomentForDiagram(rawStart, 'i');
    const targetEnd = convertMomentForDiagram(rawEnd, 'j');

    return adjustValueForEndpoints(moment, rawStart, rawEnd, targetStart, targetEnd, xi);
};

/**
 * 部材途中のせん断力を計算する関数（3Dフレーム対応）
 * 
 * @param {object} memberForce - 部材力オブジェクト
 * @param {number} L - 部材長さ (m)
 * @param {number} xi - 部材長さ方向の無次元座標 (0.0 ~ 1.0)
 * @param {string} axis - せん断力方向 ('y' or 'z')
 * @param {number} w - 等分布荷重 (kN/m) - オプション
 * @returns {number} 位置xiでのせん断力値 (kN)
 */
const calculateMemberShear = (memberForce, L, xi, axis = 'y', w = null) => {
    if (!memberForce) return 0;
    const x_m = xi * L; // 実際の距離（m）

    const { Qi, Qj } = getShearComponentsForAxis(memberForce, axis);
    const Q_i = Number.isFinite(Qi) ? Qi : 0;
    const Q_j = Number.isFinite(Qj) ? Qj : Q_i;

    let equivalentW;
    if (Number.isFinite(w) && w !== null) {
        equivalentW = w;
    } else if (Number.isFinite(Q_i) && Number.isFinite(Q_j) && Math.abs(L) > 1e-9) {
        equivalentW = (Q_i - Q_j) / L;
    } else {
        equivalentW = 0;
    }

    const shear = Q_i - equivalentW * x_m;

    const rawStart = Q_i;
    const rawEnd = Q_j;
    const targetStart = convertShearForDiagram(rawStart, 'i');
    const targetEnd = convertShearForDiagram(rawEnd, 'j');

    return adjustValueForEndpoints(shear, rawStart, rawEnd, targetStart, targetEnd, xi);
};

const toNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

const pickDominantComponent = (primary, secondary) => {
    const p = toNumber(primary);
    const s = toNumber(secondary);
    if (Math.abs(p) >= Math.abs(s)) return p;
    return s;
};

const getMomentComponentsForAxis = (memberForce, axis) => {
    if (!memberForce) return { Mi: 0, Mj: 0 };

    const fallbackMi = toNumber(memberForce.M_i);
    const fallbackMj = toNumber(memberForce.M_j);

    switch (axis) {
        case 'z':
            return {
                Mi: toNumber(memberForce.Mz_i, fallbackMi),
                Mj: toNumber(memberForce.Mz_j, fallbackMj)
            };
        case 'y':
            return {
                Mi: toNumber(memberForce.My_i, fallbackMi),
                Mj: toNumber(memberForce.My_j, fallbackMj)
            };
        case 'x':
        default:
            return {
                Mi: toNumber(memberForce.Mx_i, fallbackMi),
                Mj: toNumber(memberForce.Mx_j, fallbackMj)
            };
    }
};

const getShearComponentsForAxis = (memberForce, axis) => {
    if (!memberForce) return { Qi: 0, Qj: 0 };

    const fallbackQi = toNumber(memberForce.Q_i);
    const fallbackQj = toNumber(memberForce.Q_j);

    // 注意:
    // ここでの axis は「曲げモーメントの軸」を意味する（My/Mz など）。
    // そのため対応するせん断力は同じ軸ではなく、直交する方向成分になる。
    // - Mz ↔ Qy（Y方向のせん断が Z軸周りの曲げを生む）
    // - My ↔ Qz（Z方向のせん断が Y軸周りの曲げを生む）
    switch (axis) {
        case 'z':
            return {
                Qi: toNumber(memberForce.Qy_i, fallbackQi),
                Qj: toNumber(memberForce.Qy_j, fallbackQj)
            };
        case 'y':
            return {
                Qi: toNumber(memberForce.Qz_i, fallbackQi),
                Qj: toNumber(memberForce.Qz_j, fallbackQj)
            };
        case 'x':
        default:
            // YZ平面系など（Mx）の場合は、表示上もっとも支配的なせん断成分を採用
            return {
                Qi: pickDominantComponent(memberForce.Qy_i, memberForce.Qz_i ?? fallbackQi),
                Qj: pickDominantComponent(memberForce.Qy_j, memberForce.Qz_j ?? fallbackQj)
            };
    }
};

const getAxialComponents = (memberForce) => ({
    Ni: toNumber(memberForce?.N_i),
    Nj: toNumber(memberForce?.N_j)
});

const getAxisForProjection = (projectionMode) => {
    switch (projectionMode) {
        case 'xy':
            return 'z';
        case 'xz':
            return 'y';
        case 'yz':
            return 'x';
        default:
            return 'y';
    }
};

const getDistributedLoadForAxis = (memberForce, axis) => {
    if (!memberForce) return null;
    if (axis === 'z') return toNumber(memberForce.w, null);
    if (axis === 'y') return toNumber(memberForce.wz, null);
    if (axis === 'x') return toNumber(memberForce.wx, null);
    return null;
};

const convertMomentForDiagram = (value, position) => {
    const v = toNumber(value, 0);
    return position === 'i' ? -v : v;
};

const convertShearForDiagram = (value, position) => {
    const v = toNumber(value, 0);
    return position === 'i' ? v : -v;
};

const convertAxialForDiagram = (value, position) => {
    const v = toNumber(value, 0);
    return position === 'i' ? -v : v;
};

const adjustValueForEndpoints = (rawValue, rawStart, rawEnd, targetStart, targetEnd, xi) => {
    const rs = toNumber(rawStart, 0);
    const re = toNumber(rawEnd, rs);
    const ts = toNumber(targetStart, rs);
    const te = toNumber(targetEnd, re);

    const startDiff = ts - rs;
    const endDiff = te - re;
    const correction = startDiff * (1 - xi) + endDiff * xi;
    const adjusted = toNumber(rawValue, 0) + correction;
    return Number.isFinite(adjusted) ? adjusted : 0;
};

// project3DTo2D関数はframe_analyzer.jsのグローバルスコープで定義済み

const getDisplacementOrientation = () => ({ x: 1, y: 1, z: 1 });

const applyOrientationToPoint = (originalPoint, displacedPoint, orientation) => {
    if (!originalPoint || !displacedPoint || !orientation) {
        return displacedPoint;
    }

    const adjusted = { ...displacedPoint };
    if (typeof originalPoint.x === 'number' && typeof displacedPoint.x === 'number') {
        adjusted.x = originalPoint.x + (displacedPoint.x - originalPoint.x) * (orientation.x ?? 1);
    }
    if (typeof originalPoint.y === 'number' && typeof displacedPoint.y === 'number') {
        adjusted.y = originalPoint.y + (displacedPoint.y - originalPoint.y) * (orientation.y ?? 1);
    }
    if (typeof originalPoint.z === 'number' && typeof displacedPoint.z === 'number') {
        adjusted.z = originalPoint.z + (displacedPoint.z - originalPoint.z) * (orientation.z ?? 1);
    }
    return adjusted;
};

const LABEL_CANDIDATE_OFFSETS = Object.freeze([
    { x: 0, y: -26 },
    { x: 26, y: 0 },
    { x: 0, y: 26 },
    { x: -26, y: 0 },
    { x: 20, y: -20 },
    { x: -20, y: -20 },
    { x: 20, y: 20 },
    { x: -20, y: 20 },
    { x: 0, y: -40 },
    { x: 32, y: -18 },
    { x: -32, y: -18 },
    { x: 32, y: 18 },
    { x: -32, y: 18 }
]);

const rectanglesOverlap = (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);

const createRectFromCenter = (cx, cy, width, height, padding = 2) => ({
    x1: cx - width / 2 - padding,
    y1: cy - height / 2 - padding,
    x2: cx + width / 2 + padding,
    y2: cy + height / 2 + padding
});

const measureTextDimensions = (ctx, text) => {
    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const ascent = metrics.actualBoundingBoxAscent ?? 10;
    const descent = metrics.actualBoundingBoxDescent ?? 4;
    return {
        width,
        ascent,
        descent,
        height: ascent + descent
    };
};

const findLabelPlacement = (baseX, baseY, size, obstacles, offsets = LABEL_CANDIDATE_OFFSETS) => {
    for (const offset of offsets) {
        const cx = baseX + offset.x;
        const cy = baseY + offset.y;
        const rect = createRectFromCenter(cx, cy, size, size, 3);
        if (!obstacles.some(obstacle => rectanglesOverlap(obstacle, rect))) {
            return { cx, cy, rect };
        }
    }
    const fallbackRect = createRectFromCenter(baseX, baseY, size, size, 3);
    return { cx: baseX, cy: baseY, rect: fallbackRect };
};

const drawSquareNumberLabel = (ctx, text, baseX, baseY, obstacles, options = {}) => {
    ctx.save();
    ctx.font = options.font || 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const { width, height } = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 8;
    const size = Math.max(width, height) + padding;
    const placement = findLabelPlacement(baseX, baseY, size, obstacles, options.offsets);

    ctx.fillStyle = options.background || 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = options.border || '#222';
    ctx.lineWidth = options.lineWidth || 1.5;
    ctx.beginPath();
    ctx.rect(placement.cx - size / 2, placement.cy - size / 2, size, size);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = options.color || '#000';
    ctx.fillText(text, placement.cx, placement.cy);

    obstacles.push(placement.rect);
    ctx.restore();
};

const drawCircleNumberLabel = (ctx, text, baseX, baseY, obstacles, options = {}) => {
    ctx.save();
    ctx.font = options.font || 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const { width, height } = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 8;
    const diameter = Math.max(width, height) + padding;
    const placement = findLabelPlacement(baseX, baseY, diameter, obstacles, options.offsets);

    const radius = diameter / 2;
    ctx.fillStyle = options.background || 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = options.border || '#222';
    ctx.lineWidth = options.lineWidth || 1.5;
    ctx.beginPath();
    ctx.arc(placement.cx, placement.cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = options.color || '#000';
    ctx.fillText(text, placement.cx, placement.cy);

    obstacles.push(createRectFromCenter(placement.cx, placement.cy, diameter, diameter, 0));
    ctx.restore();
};

const drawTextWithPlacement = (ctx, text, baseX, baseY, obstacles, options = {}) => {
    const offsets = options.offsets || LABEL_CANDIDATE_OFFSETS;
    const metrics = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 10;
    const size = Math.max(metrics.width, metrics.height) + padding;
    const placement = findLabelPlacement(baseX, baseY, size, obstacles, offsets);

    const prevStroke = ctx.strokeStyle;
    const prevFill = ctx.fillStyle;

    if (options.strokeStyle) ctx.strokeStyle = options.strokeStyle;
    if (options.fillStyle) ctx.fillStyle = options.fillStyle;

    const doStroke = options.strokeStyle && options.stroke !== false;
    const doFill = options.fill !== false;

    if (doStroke) {
        ctx.strokeText(text, placement.cx, placement.cy);
    }
    if (doFill) {
        ctx.fillText(text, placement.cx, placement.cy);
    }

    ctx.strokeStyle = prevStroke;
    ctx.fillStyle = prevFill;

    registerTextObstacle(obstacles, ctx, text, placement.cx, placement.cy, {
        padding: options.textPadding ?? 4,
        align: options.align,
        baseline: options.baseline
    });

    return placement;
};

const registerTextObstacle = (obstacles, ctx, text, x, y, options = {}) => {
    const { width, ascent, descent, height } = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 4;
    const textAlign = options.align || ctx.textAlign || 'start';
    const textBaseline = options.baseline || ctx.textBaseline || 'alphabetic';

    let x1 = x;
    if (textAlign === 'center') {
        x1 = x - width / 2;
    } else if (textAlign === 'right' || textAlign === 'end') {
        x1 = x - width;
    }
    const x2 = x1 + width;

    let yTop = y;
    if (textBaseline === 'middle') {
        yTop = y - height / 2;
    } else if (textBaseline === 'alphabetic' || textBaseline === 'ideographic') {
        yTop = y - ascent;
    }

    const rect = {
        x1: x1 - padding,
        y1: yTop - padding,
        x2: x2 + padding,
        y2: yTop + height + padding
    };

    obstacles.push(rect);
};

const registerCircleObstacle = (obstacles, cx, cy, radius, padding = 4) => {
    obstacles.push({
        x1: cx - radius - padding,
        y1: cy - radius - padding,
        x2: cx + radius + padding,
        y2: cy + radius + padding
    });
};

// 各投影面の全ての座標値を取得する関数
const getAllFrameCoordinates = (nodes, projectionMode) => {
    const uniqueCoords = new Set();
    const tolerance = 0.01;

    nodes.forEach(node => {
        let coord = 0;
        if (projectionMode === 'xy') {
            coord = node.z !== undefined ? node.z : 0;
        } else if (projectionMode === 'xz') {
            coord = node.y !== undefined ? node.y : 0;
        } else if (projectionMode === 'yz') {
            coord = node.x;
        }

        // 誤差範囲内で丸める
        const roundedCoord = Math.round(coord / tolerance) * tolerance;
        uniqueCoords.add(roundedCoord);
    });

    return [...uniqueCoords].sort((a, b) => a - b);
};

// 3D表示モードをデフォルトでfalseに設定
if (typeof window.is3DDisplayMode === 'undefined') {
    window.is3DDisplayMode = false;
}

// 3D表示状態を自動検出する関数（簡略化版）
const detect3DDisplayMode = () => {
    // まず、明示的に設定されたフラグのみをチェック
    if (window.is3DDisplayMode === true) {
        console.log('✅ 3D mode explicitly enabled');
        return true;
    }
    
    // それ以外の場合は2D表示をデフォルトとする
    console.log('✅ 3D mode disabled, using 2D');
    return false;
};

// 3D表示モードの自動検出を有効にする（安全版）
const enableAuto3DDetection = () => {
    // 既存のインターバルをクリア
    if (window.auto3DDetectionInterval) {
        clearInterval(window.auto3DDetectionInterval);
    }
    
    // 定期的に3D表示状態をチェック（より安全に）
    window.auto3DDetectionInterval = setInterval(() => {
        try {
            const is3D = detect3DDisplayMode();
            if (window.is3DDisplayMode !== is3D) {
                window.is3DDisplayMode = is3D;
                console.log(`3D表示モード自動検出: ${is3D ? 'ON' : 'OFF'}`);
                
                // 図面を再描画
                if (window.redrawDiagrams) {
                    window.redrawDiagrams();
                }
            }
        } catch (error) {
            console.warn('Auto 3D detection error:', error);
        }
    }, 2000); // 2秒ごとにチェック（頻度を下げる）
};

// 3D表示モードの自動検出を無効にする
const disableAuto3DDetection = () => {
    if (window.auto3DDetectionInterval) {
        clearInterval(window.auto3DDetectionInterval);
        window.auto3DDetectionInterval = null;
        console.log('3D表示モード自動検出を無効にしました');
    }
};

// グローバル関数として公開
window.detect3DDisplayMode = detect3DDisplayMode;
window.enableAuto3DDetection = enableAuto3DDetection;

const drawDisplacementDiagram = (nodes, members, D_global, memberForces, manualScale = null) => {
    console.log('🎨 drawDisplacementDiagram called:', {
        nodesCount: nodes?.length,
        membersCount: members?.length,
        D_globalLength: D_global?.length,
        memberForcesLength: memberForces?.length,
        manualScale
    });

    // キャンバス要素を動的に取得
    let canvas = diagramElements.displacementCanvas;
    
    // キャンバスが見つからない場合は、より広範囲で検索
    if (!canvas) {
        console.warn('⚠️ displacementCanvas not found, searching alternatives...');
        canvas = document.querySelector('canvas') || 
                document.querySelector('[id*="canvas"]') ||
                document.querySelector('[class*="canvas"]');
        
        if (canvas) {
            console.log('✅ Found alternative canvas:', canvas.id || canvas.className);
        }
    }

    if (!canvas) {
        console.error('❌ No canvas element found for displacement diagram');
        console.log('Available canvas elements:', document.querySelectorAll('canvas'));
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('❌ canvas context not found');
        return;
    }

    console.log('✅ Canvas found and context obtained:', canvas.id || 'unnamed');

    // 3D表示モードの検出（安全な方法）
    let is3DDisplayMode = false;
    try {
        is3DDisplayMode = detect3DDisplayMode();
        console.log('🔍 3D detection result:', is3DDisplayMode);
    } catch (error) {
        console.warn('⚠️ 3D detection failed, using 2D mode:', error);
        is3DDisplayMode = false;
    }
    
    if (is3DDisplayMode) {
        console.log('🚀 Using 3D displacement diagram');
        try {
            draw3DDisplacementDiagram(nodes, members, D_global, memberForces, manualScale);
            return;
        } catch (error) {
            console.warn('⚠️ 3D displacement diagram failed, falling back to 2D:', error);
            // 3D描画に失敗した場合は2D描画にフォールバック
        }
    }

    console.log('📐 Using 2D displacement diagram');

    const clampDispScale = (value) => {
        if (!isFinite(value)) return 1;
        if (value <= 0) return 0;
        return Math.min(value, 100000);
    };

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2D/3D判定（自由度数から判定）
    const dofPerNode = D_global.length / nodes.length;
    const is3D = dofPerNode === 6;

    // 投影面を定義（等角投影を含む）
    const projectionModes = ['iso'];

    // 各投影面の構面座標を取得し、変位図を表示（値が0でも表示）
    const frameData = [];
    const tolerance = 0.01;
    
    projectionModes.forEach(mode => {
        if (mode === 'iso') {
            // 等角投影の場合は全ての節点を対象とし、変位が0でも表示
            frameData.push({ mode: 'iso', coord: 0 });
        } else {
            const coords = getAllFrameCoordinates(nodes, mode);
            if (coords.length > 0) {
                coords.forEach(coord => {
                    // この構面に含まれる節点をチェック
                    let hasNonZeroDisplacement = false;
                    
                    for (let i = 0; i < nodes.length; i++) {
                        let coordToCheck = 0;
                        if (mode === 'xy') coordToCheck = nodes[i].z;
                        else if (mode === 'xz') coordToCheck = nodes[i].y;
                        else if (mode === 'yz') coordToCheck = nodes[i].x;
                        
                        if (Math.abs(coordToCheck - coord) < tolerance) {
                            // この節点の変位をチェック
                            const dx = D_global[i * (is3D ? 6 : 3)][0];
                            const dy = D_global[i * (is3D ? 6 : 3) + 1][0];
                            const dz = is3D ? D_global[i * 6 + 2][0] : 0;
                            
                            const totalDisp = Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000; // mm単位
                            if (totalDisp > 0.01) { // 0.01mm以上の変位があれば表示
                                hasNonZeroDisplacement = true;
                                break;
                            }
                        }
                    }
                    
                    // 変位が0以外の構面のみを追加
                    if (hasNonZeroDisplacement) {
                        frameData.push({ mode, coord });
                    }
                });
            }
        }
    });

    if (frameData.length === 0) return;

    // 横スクロール式のレイアウト: 各構面を元のキャンバスサイズで横に並べる
    const frameWidth = 1200;  // 各構面の幅
    const frameHeight = 900; // 各構面の高さ
    const framePadding = 40; // 構面間の余白
    const headerHeight = 80; // ヘッダー高さ
    const margin = 40; // 描画領域の余白
    const drawAreaWidth = frameWidth - 2 * margin;
    const drawAreaHeight = frameHeight - 2 * margin;

    const prepareFrameGeometry = (frame) => {
        const visibleNodeSet = new Set();
        
        if (frame.mode === 'iso') {
            // 等角投影の場合は全ての節点を対象とする
            nodes.forEach((node, idx) => {
                visibleNodeSet.add(idx);
            });
        } else {
            nodes.forEach((node, idx) => {
                let coordToCheck = 0;
                if (frame.mode === 'xy') {
                    coordToCheck = node.z;
                } else if (frame.mode === 'xz') {
                    coordToCheck = node.y;
                } else if (frame.mode === 'yz') {
                    coordToCheck = node.x;
                }
                if (Math.abs(coordToCheck - frame.coord) < tolerance) {
                    visibleNodeSet.add(idx);
                }
            });
        }

        const visibleMemberIndices = [];
        members.forEach((member, idx) => {
            if (visibleNodeSet.has(member.i) && visibleNodeSet.has(member.j)) {
                visibleMemberIndices.push(idx);
            }
        });

        if (visibleMemberIndices.length === 0) {
            return { frame, hasContent: false };
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visibleMemberIndices.forEach(idx => {
            const member = members[idx];
            const pi = project3DTo2D(nodes[member.i], frame.mode);
            const pj = project3DTo2D(nodes[member.j], frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
            return { frame, hasContent: false };
        }

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        let scale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            scale = Math.min(drawAreaWidth / modelWidth, drawAreaHeight / modelHeight) * 0.9;
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        return {
            frame,
            hasContent: true,
            visibleNodeIndices: Array.from(visibleNodeSet),
            visibleMemberIndices,
            minX,
            maxX,
            minY,
            maxY,
            scale,
            centerX,
            centerY
        };
    };

    const frameGeometries = frameData
        .map(frame => prepareFrameGeometry(frame))
        .filter(geometry => geometry.hasContent);

    if (frameGeometries.length === 0) return;

    // キャンバスサイズを調整（横スクロール対応）
    const totalWidth = frameGeometries.length * (frameWidth + framePadding) + framePadding;
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

    // 全体の変位スケールを計算
    let dispScale = 0;
    if (D_global.length > 0) {
        if (manualScale !== null) {
            dispScale = clampDispScale(manualScale);
        } else {
            let max_disp = 0;
            if (is3D) {
                for (let i = 0; i < nodes.length; i++) {
                    const dx = Math.abs(D_global[i*6][0]);
                    const dy = Math.abs(D_global[i*6+1][0]);
                    const dz = Math.abs(D_global[i*6+2][0]);
                    max_disp = Math.max(max_disp, dx, dy, dz);
                }
            } else {
                for (let i = 0; i < nodes.length; i++) {
                    const dx = Math.abs(D_global[i*3][0]);
                    const dy = Math.abs(D_global[i*3+1][0]);
                    max_disp = Math.max(max_disp, dx, dy);
                }
            }

            // 構造のサイズを計算
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

            // 変位倍率の計算: 構造サイズと変位量の比率を考慮
            // 目標: 最大変位が構造サイズの5%程度に表示されるようにする
            if (max_disp > 1e-12 && structureSize > 0) {
                dispScale = clampDispScale((structureSize * 0.05) / max_disp);
            } else if (max_disp > 1e-12) {
                // 構造サイズが取得できない場合のフォールバック
                dispScale = clampDispScale(1000);
            }
        }
    }

    const calculateFrameDispScaleLimit = (geometry) => {
        if (!geometry.hasContent || geometry.scale <= 0) return Infinity;

        const localTransform = (px, py) => ({
            x: frameWidth / 2 + (px - geometry.centerX) * geometry.scale,
            y: frameHeight / 2 - (py - geometry.centerY) * geometry.scale
        });

        const minAllowedX = margin;
        const maxAllowedX = frameWidth - margin;
        const minAllowedY = margin;
        const maxAllowedY = frameHeight - margin;

    const numDivisions = 20;
    let frameLimit = Infinity;
    const orientation = getDisplacementOrientation(geometry.frame.mode);

        for (const memberIdx of geometry.visibleMemberIndices) {
            const member = members[memberIdx];
            const memberForce = memberForces && memberForces[memberIdx] ? memberForces[memberIdx] : null;

            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                const originalPoint = calculateMemberDeformation(member, nodes, D_global, memberForce, xi, 0);
        const deformedUnitRaw = calculateMemberDeformation(member, nodes, D_global, memberForce, xi, 1);
        const deformedUnit = applyOrientationToPoint(originalPoint, deformedUnitRaw, orientation);
                if (!originalPoint || !deformedUnit) continue;

                const originalProjected = project3DTo2D(originalPoint, geometry.frame.mode);
                const deformedProjected = project3DTo2D(deformedUnit, geometry.frame.mode);

                const originalPixel = localTransform(originalProjected.x, originalProjected.y);
                const unitPixel = localTransform(deformedProjected.x, deformedProjected.y);

                const deltaX = unitPixel.x - originalPixel.x;
                const deltaY = unitPixel.y - originalPixel.y;

                if (Math.abs(deltaX) > 1e-6) {
                    const availableX = deltaX > 0
                        ? maxAllowedX - originalPixel.x
                        : originalPixel.x - minAllowedX;
                    if (availableX <= 0) return 0;
                    frameLimit = Math.min(frameLimit, availableX / Math.abs(deltaX));
                }

                if (Math.abs(deltaY) > 1e-6) {
                    const availableY = deltaY > 0
                        ? maxAllowedY - originalPixel.y
                        : originalPixel.y - minAllowedY;
                    if (availableY <= 0) return 0;
                    frameLimit = Math.min(frameLimit, availableY / Math.abs(deltaY));
                }
            }
        }

        if (!isFinite(frameLimit) || frameLimit <= 0) return Infinity;
        return frameLimit * 0.98;
    };

    let autoScaleLimit = Infinity;
    frameGeometries.forEach(geometry => {
        const limit = calculateFrameDispScaleLimit(geometry);
        if (limit < autoScaleLimit) {
            autoScaleLimit = limit;
        }
    });

    if (autoScaleLimit < Infinity) {
        if (dispScale > 0) {
            dispScale = clampDispScale(Math.min(dispScale, autoScaleLimit));
        } else {
            dispScale = clampDispScale(autoScaleLimit);
        }
    } else if (dispScale > 0) {
        dispScale = clampDispScale(dispScale);
    }

    if (typeof window.updateAnimationAutoScale === 'function') {
        window.updateAnimationAutoScale(dispScale);
    } else {
        window.lastDisplacementScale = dispScale;
    }
    if (diagramElements.dispScaleInput) {
        diagramElements.dispScaleInput.value = dispScale.toFixed(2);
    }

    // 各フレームを描画（横並び）
    frameGeometries.forEach((geometry, index) => {
        const frame = geometry.frame;
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // 構面のタイトルを描画（フレームの上部）
        let frameTitle;
        if (frame.mode === 'iso') {
            frameTitle = '等角投影図';
        } else {
            const axisName = frame.mode === 'xy' ? 'Z' : (frame.mode === 'xz' ? 'Y' : 'X');
            frameTitle = `${frame.mode.toUpperCase()}平面 (${axisName}=${frame.coord.toFixed(2)}m)`;
        }
        
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(frameTitle, x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(`変位倍率: ${dispScale.toFixed(2)}`, x + frameWidth / 2, framePadding + 50);

        // 構面の背景を描画
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 構面の境界を描画
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        // 構面内に描画するための座標変換を設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        const transform = (px, py) => ({
            x: x + frameWidth / 2 + (px - geometry.centerX) * geometry.scale,
            y: y + frameHeight / 2 - (py - geometry.centerY) * geometry.scale
        });
        const orientation = getDisplacementOrientation(frame.mode);
        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        geometry.visibleMemberIndices.forEach(memberIdx => {
            const member = members[memberIdx];
            const pi = project3DTo2D(nodes[member.i], frame.mode);
            const pj = project3DTo2D(nodes[member.j], frame.mode);
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
                memberIndex: memberIdx,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                tangent: { x: dx / length, y: dy / length },
                normal: { x: -dy / length, y: dx / length }
            });
        });

        // 変形後の構造を描画（赤、太線）- 曲げ変形を考慮
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2.5;
        geometry.visibleMemberIndices.forEach(memberIdx => {
            const member = members[memberIdx];
            const memberForce = memberForces && memberForces[memberIdx] ? memberForces[memberIdx] : null;

            ctx.beginPath();
            const numDivisions = 20;
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                const originalPoint = calculateMemberDeformation(
                    member,
                    nodes,
                    D_global,
                    memberForce,
                    xi,
                    0
                );
                const deformedRaw = calculateMemberDeformation(
                    member,
                    nodes,
                    D_global,
                    memberForce,
                    xi,
                    dispScale
                );
                const deformed = applyOrientationToPoint(originalPoint, deformedRaw, orientation);

                if (deformed) {
                    const projected = project3DTo2D(deformed, frame.mode);
                    const point = transform(projected.x, projected.y);

                    if (k === 0) ctx.moveTo(point.x, point.y);
                    else ctx.lineTo(point.x, point.y);
                }
            }
            ctx.stroke();
        });

        // 節点の変位量を表示
        ctx.fillStyle = 'blue';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        geometry.visibleNodeIndices.forEach(nodeIdx => {
            const node = nodes[nodeIdx];
            const projected = project3DTo2D(node, frame.mode);
            const point = transform(projected.x, projected.y);

            ctx.fillStyle = 'blue';
            ctx.beginPath();
            ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
            ctx.fill();

             registerCircleObstacle(labelObstacles, point.x, point.y, 6);
             nodeScreenData.push({ nodeIndex: nodeIdx, x: point.x, y: point.y });

            if (is3D && D_global.length > nodeIdx * 6 + 2) {
                const dx = D_global[nodeIdx * 6][0] * 1000;
                const dy = D_global[nodeIdx * 6 + 1][0] * 1000;
                const dz = D_global[nodeIdx * 6 + 2][0] * 1000;
                const totalDisp = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (totalDisp > 0.1) {
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 5;
                    const dispText = `${totalDisp.toFixed(1)}mm`;
                    const textX = point.x;
                    const textY = point.y - 15;
                    ctx.strokeText(dispText, textX, textY);
                    ctx.fillStyle = 'darkblue';
                    ctx.fillText(dispText, textX, textY);
                    registerTextObstacle(labelObstacles, ctx, dispText, textX, textY);
                }
            }
        });

        const nodeLabelOffsets = [
            { x: 0, y: 28 },
            { x: 26, y: 12 },
            { x: -26, y: 12 },
            { x: 0, y: -32 },
            { x: 32, y: -16 },
            { x: -32, y: -16 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 28, y: normal.y * 28 },
                { x: -normal.x * 28, y: -normal.y * 28 },
                { x: tangent.x * 32, y: tangent.y * 32 },
                { x: -tangent.x * 32, y: -tangent.y * 32 },
                { x: normal.x * 42, y: normal.y * 42 },
                { x: -normal.x * 42, y: -normal.y * 42 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
    });
};

// 3D変位図描画関数
const draw3DDisplacementDiagram = (nodes, members, D_global, memberForces, manualScale = null) => {
    // キャンバス要素を動的に取得
    let canvas = diagramElements.displacementCanvas;
    
    // キャンバスが見つからない場合は、より広範囲で検索
    if (!canvas) {
        console.warn('⚠️ displacementCanvas not found for 3D diagram, searching alternatives...');
        canvas = document.querySelector('canvas') || 
                document.querySelector('[id*="canvas"]') ||
                document.querySelector('[class*="canvas"]');
        
        if (canvas) {
            console.log('✅ Found alternative canvas for 3D:', canvas.id || canvas.className);
        }
    }

    if (!canvas) {
        console.error('❌ No canvas element found for 3D displacement diagram');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('❌ canvas context not found for 3D diagram');
        return;
    }

    console.log('✅ 3D Canvas found and context obtained:', canvas.id || 'unnamed');

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2D/3D判定（自由度数から判定）
    const dofPerNode = D_global.length / nodes.length;
    const is3D = dofPerNode === 6;

    // 変位スケールの計算
    const clampDispScale = (value) => {
        if (!isFinite(value)) return 1;
        if (value <= 0) return 0;
        return Math.min(value, 100000);
    };

    let dispScale = 0;
    if (D_global.length > 0) {
        if (manualScale !== null) {
            dispScale = clampDispScale(manualScale);
        } else {
            let max_disp = 0;
            if (is3D) {
                for (let i = 0; i < nodes.length; i++) {
                    const dx = Math.abs(D_global[i*6][0]);
                    const dy = Math.abs(D_global[i*6+1][0]);
                    const dz = Math.abs(D_global[i*6+2][0]);
                    max_disp = Math.max(max_disp, dx, dy, dz);
                }
            } else {
                for (let i = 0; i < nodes.length; i++) {
                    const dx = Math.abs(D_global[i*3][0]);
                    const dy = Math.abs(D_global[i*3+1][0]);
                    max_disp = Math.max(max_disp, dx, dy);
                }
            }

            // 構造のサイズを計算
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

            // 変位倍率の計算
            if (max_disp > 1e-12 && structureSize > 0) {
                dispScale = clampDispScale((structureSize * 0.05) / max_disp);
            } else if (max_disp > 1e-12) {
                dispScale = clampDispScale(1000);
            }
        }
    }

    // 3D表示用のカメラ設定
    const camera = window.camera3D || {
        position: { x: 0, y: 0, z: 10 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fov: 45,
        zoom: 1
    };

    // 3D座標を2Dスクリーン座標に変換（回転を考慮）
    const project3DToScreen = (point3D) => {
        const { x, y, z } = point3D;
        
        // 回転行列を適用
        const cosX = Math.cos(camera.rotationX || 0);
        const sinX = Math.sin(camera.rotationX || 0);
        const cosY = Math.cos(camera.rotationY || 0);
        const sinY = Math.sin(camera.rotationY || 0);
        
        // Y軸回転
        let x1 = x * cosY - z * sinY;
        let y1 = y;
        let z1 = x * sinY + z * cosY;
        
        // X軸回転
        let x2 = x1;
        let y2 = y1 * cosX - z1 * sinX;
        let z2 = y1 * sinX + z1 * cosX;
        
        // 透視投影
        const distance = Math.sqrt(x2*x2 + y2*y2 + z2*z2);
        const scale = camera.zoom * 200 / (distance + 1);
        
        return {
            x: canvas.width / 2 + x2 * scale,
            y: canvas.height / 2 - y2 * scale
        };
    };

    // 元の構造を描画（グレー）
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    members.forEach(member => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return;

        const p1 = project3DToScreen(nodeI);
        const p2 = project3DToScreen(nodeJ);
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    });

    // 変形後の構造を描画（赤、太線）
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2.5;
    members.forEach(member => {
        const memberForce = memberForces && memberForces[members.indexOf(member)] ? memberForces[members.indexOf(member)] : null;

        ctx.beginPath();
        const numDivisions = 20;
        for (let k = 0; k <= numDivisions; k++) {
            const xi = k / numDivisions;
            const deformed = calculateMemberDeformation(
                member,
                nodes,
                D_global,
                memberForce,
                xi,
                dispScale
            );

            if (deformed) {
                const projected = project3DToScreen(deformed);

                if (k === 0) ctx.moveTo(projected.x, projected.y);
                else ctx.lineTo(projected.x, projected.y);
            }
        }
        ctx.stroke();
    });

    // 節点の変位量を表示
    ctx.fillStyle = 'blue';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    nodes.forEach((node, nodeIdx) => {
        const projected = project3DToScreen(node);

        ctx.fillStyle = 'blue';
        ctx.beginPath();
        ctx.arc(projected.x, projected.y, 6, 0, 2 * Math.PI);
        ctx.fill();

        if (is3D && D_global.length > nodeIdx * 6 + 2) {
            const dx = D_global[nodeIdx * 6][0] * 1000;
            const dy = D_global[nodeIdx * 6 + 1][0] * 1000;
            const dz = D_global[nodeIdx * 6 + 2][0] * 1000;
            const totalDisp = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (totalDisp > 0.1) {
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 5;
                const dispText = `${totalDisp.toFixed(1)}mm`;
                const textX = projected.x;
                const textY = projected.y - 15;
                ctx.strokeText(dispText, textX, textY);
                ctx.fillStyle = 'darkblue';
                ctx.fillText(dispText, textX, textY);
            }
        }
    });

    // 節点番号を表示
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    nodes.forEach((node, nodeIdx) => {
        const projected = project3DToScreen(node);
        ctx.fillText(String(nodeIdx + 1), projected.x + 15, projected.y - 15);
    });

    // 部材番号を表示
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    members.forEach((member, memberIdx) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return;

        const p1 = project3DToScreen(nodeI);
        const p2 = project3DToScreen(nodeJ);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        ctx.fillText(String(memberIdx + 1), midX, midY);
    });

    // 変位倍率を表示
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`変位倍率: ${dispScale.toFixed(2)}`, 20, 30);
    
    console.log('✅ 2D displacement diagram completed');
};

// 応力図描画関数（全投影・各構面対応）
const drawStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    console.log('🎨 drawStressDiagram called:', {
        canvas: !!canvas,
        nodesCount: nodes?.length,
        membersCount: members?.length,
        memberForcesLength: memberForces?.length,
        stressType,
        title
    });

    if (!canvas) {
        console.error('❌ canvas not provided');
        return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('❌ canvas context not found');
        return;
    }

    // 3D表示モードの検出（安全な方法）
    let is3DDisplayMode = false;
    try {
        is3DDisplayMode = detect3DDisplayMode();
        console.log('🔍 3D detection result:', is3DDisplayMode);
    } catch (error) {
        console.warn('⚠️ 3D detection failed, using 2D mode:', error);
        is3DDisplayMode = false;
    }
    
    if (is3DDisplayMode) {
        console.log('🚀 Using 3D stress diagram');
        try {
            // Y軸の応力図を描画
            draw3DStressDiagram(canvas, nodes, members, memberForces, stressType, title + ' (Y軸)');
            
            // Z軸の応力図も描画（別のキャンバス）
            if (stressType === 'moment' || stressType === 'shear') {
                // Z軸用のキャンバスを取得または作成
                let zAxisCanvas = document.getElementById('z-axis-' + stressType + '-canvas');
                if (!zAxisCanvas) {
                    // Z軸用のキャンバスを作成
                    zAxisCanvas = document.createElement('canvas');
                    zAxisCanvas.id = 'z-axis-' + stressType + '-canvas';
                    zAxisCanvas.width = canvas.width;
                    zAxisCanvas.height = canvas.height;
                    zAxisCanvas.style.position = 'absolute';
                    zAxisCanvas.style.top = canvas.offsetTop + 'px';
                    zAxisCanvas.style.left = (canvas.offsetLeft + canvas.width + 20) + 'px';
                    zAxisCanvas.style.border = '1px solid #ccc';
                    zAxisCanvas.style.backgroundColor = 'white';
                    canvas.parentNode.appendChild(zAxisCanvas);
                }
                
                // Z軸の応力図を描画
                draw3DStressDiagramZAxis(zAxisCanvas, nodes, members, memberForces, stressType, title + ' (Z軸)');
            }
            return;
        } catch (error) {
            console.warn('⚠️ 3D stress diagram failed, falling back to 2D:', error);
            // 3D描画に失敗した場合は2D描画にフォールバック
        }
    }

    console.log('📐 Using 2D stress diagram');

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2D/3D判定
    const dofPerNode = 6; // 3Dフレーム想定
    const is3D = true;

    // 投影面を定義（等角投影を含む）
    const projectionModes = ['iso'];

    // 各投影面の構面座標を取得し、応力図を表示（値が0でも表示）
    const frameData = [];
    const tolerance = 0.01;
    
    projectionModes.forEach(mode => {
        if (mode === 'iso') {
            // 等角投影の場合は全ての部材を対象とし、応力が0でも表示
            frameData.push({ mode: 'iso', coord: 0 });
        } else {
            const coords = getAllFrameCoordinates(nodes, mode);
            if (coords.length > 0) {
                coords.forEach(coord => {
                    // この構面に含まれる部材をチェック
                    let hasNonZeroStress = false;
                    
                    for (let idx = 0; idx < members.length; idx++) {
                        const m = members[idx];
                        const nodeI = nodes[m.i];
                        const nodeJ = nodes[m.j];
                        if (!nodeI || !nodeJ) continue;
                        
                        // 部材の両端節点がこの構面上にあるかチェック
                        let coordI = 0, coordJ = 0;
                        if (mode === 'xy') {
                            coordI = nodeI.z;
                            coordJ = nodeJ.z;
                        } else if (mode === 'xz') {
                            coordI = nodeI.y;
                            coordJ = nodeJ.y;
                        } else if (mode === 'yz') {
                            coordI = nodeI.x;
                            coordJ = nodeJ.x;
                        }
                        
                        // 両端点がこの構面上にある場合
                        if (Math.abs(coordI - coord) < tolerance && Math.abs(coordJ - coord) < tolerance) {
                            if (memberForces[idx]) {
                                const forces = memberForces[idx];
                                
                                // 投影面に応じて適切な軸を選択
                                let axis = 'y'; // デフォルト
                                if (mode === 'xy') {
                                    axis = 'z'; // XY平面ではZ軸周りのモーメント
                                } else if (mode === 'xz') {
                                    axis = 'y'; // XZ平面ではY軸周りのモーメント
                                } else if (mode === 'yz') {
                                    axis = 'x'; // YZ平面ではX軸周りのモーメント
                                }

                                let stress = 0;
                                if (stressType === 'moment') {
                                    const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                                    const start = convertMomentForDiagram(Mi, 'i');
                                    const end = convertMomentForDiagram(Mj, 'j');
                                    stress = Math.max(Math.abs(start), Math.abs(end));
                                } else if (stressType === 'axial') {
                                    const { Ni, Nj } = getAxialComponents(forces);
                                    const start = convertAxialForDiagram(Ni, 'i');
                                    const end = convertAxialForDiagram(Nj, 'j');
                                    stress = Math.max(Math.abs(start), Math.abs(end));
                                } else if (stressType === 'shear') {
                                    const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                                    const start = convertShearForDiagram(Qi, 'i');
                                    const end = convertShearForDiagram(Qj, 'j');
                                    stress = Math.max(Math.abs(start), Math.abs(end));
                                }

                                if (stress > 0.001) { // 0.001以上の応力があれば表示
                                    hasNonZeroStress = true;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // 応力が0以外の構面のみを追加
                    if (hasNonZeroStress) {
                        frameData.push({ mode, coord });
                    }
                });
            }
        }
    });

    if (frameData.length === 0) return;

    // 横スクロール式のレイアウト: 各構面を元のキャンバスサイズで横に並べる
    const frameWidth = 1200;  // 各構面の幅
    const frameHeight = 900; // 各構面の高さ
    const framePadding = 40; // 構面間の余白
    const headerHeight = 80; // ヘッダー高さ
    
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

    // 応力の最大値を計算（スケール決定用）
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];

        // 各投影面に応じて適切な軸をチェック
        const axesToCheck = [];
        frameData.forEach(frame => {
            if (frame.mode === 'iso') {
                // 等角投影ではY軸をチェック（Z軸は別途描画）
                if (!axesToCheck.includes('y')) axesToCheck.push('y');
            } else {
                // 2D投影の場合は投影面に応じて適切な軸を選択
                let axis = 'y'; // デフォルト
                if (frame.mode === 'xy') {
                    axis = 'z'; // XY平面ではZ軸周りのモーメント
                } else if (frame.mode === 'xz') {
                    axis = 'y'; // XZ平面ではY軸周りのモーメント
                } else if (frame.mode === 'yz') {
                    axis = 'x'; // YZ平面ではX軸周りのモーメント
                }
                if (!axesToCheck.includes(axis)) axesToCheck.push(axis);
            }
        });

        axesToCheck.forEach(axis => {
            if (stressType === 'moment') {
                const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                const start = convertMomentForDiagram(Mi, 'i');
                const end = convertMomentForDiagram(Mj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            } else if (stressType === 'axial') {
                const { Ni, Nj } = getAxialComponents(forces);
                const start = convertAxialForDiagram(Ni, 'i');
                const end = convertAxialForDiagram(Nj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            } else if (stressType === 'shear') {
                const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                const start = convertShearForDiagram(Qi, 'i');
                const end = convertShearForDiagram(Qj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            }
        });
    });

    // 各フレームを描画（横並び）
    frameData.forEach((frame, index) => {
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // 構面のタイトルを描画（フレームの上部）
        let frameTitle;
        if (frame.mode === 'iso') {
            frameTitle = '等角投影図';
        } else {
            const axisName = frame.mode === 'xy' ? 'Z' : (frame.mode === 'xz' ? 'Y' : 'X');
            frameTitle = `${frame.mode.toUpperCase()}平面 (${axisName}=${frame.coord.toFixed(2)}m)`;
        }
        
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(frameTitle, x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(title, x + frameWidth / 2, framePadding + 50);

        // 構面の背景を描画
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 構面の境界を描画
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        // 構面内に描画するための座標変換を設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        // この構面の節点と部材を取得
        const tolerance = 0.01;
        const visibleNodes = new Set();
        
        if (frame.mode === 'iso') {
            // 等角投影の場合は全ての節点と部材を対象とする
            nodes.forEach((node, idx) => {
                visibleNodes.add(idx);
            });
        } else {
            nodes.forEach((node, idx) => {
                let coordToCheck = 0;
                if (frame.mode === 'xy') {
                    coordToCheck = node.z;
                } else if (frame.mode === 'xz') {
                    coordToCheck = node.y;
                } else if (frame.mode === 'yz') {
                    coordToCheck = node.x;
                }
                if (Math.abs(coordToCheck - frame.coord) < tolerance) {
                    visibleNodes.add(idx);
                }
            });
        }

        // この構面の部材のみをフィルタリング
        const visibleMembers = members.filter(m =>
            visibleNodes.has(m.i) && visibleNodes.has(m.j)
        );

        if (visibleMembers.length === 0) {
            ctx.restore();
            return;
        }

        // モデルの範囲を計算
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visibleMembers.forEach(m => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        const margin = 40;
        const drawWidth = frameWidth - 2 * margin;
        const drawHeight = frameHeight - 2 * margin;

        let modelScale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            modelScale = Math.min(drawWidth / modelWidth, drawHeight / modelHeight) * 0.9;
        }

        // 応力図のスケール（ピクセル単位）- 描画領域のサイズに応じて調整
        // 最大応力が描画領域からはみ出さないように制限
        // まず仮のスケールを計算
        let maxStressPixels = Math.min(drawWidth, drawHeight) * 0.06; // 8%から6%に縮小
        
        let stressScale = maxStress > 0 ? maxStressPixels / maxStress : 1;
        
        // 第2軸でも同じスケールを使用するためグローバル変数に保存
        window.lastStressScale = stressScale;
        window.lastStressScaleInfo = {
            stressScale,
            maxStressPixels,
            maxStress,
            stressType,
            frameIndex: index,
            drawWidth,
            drawHeight
        };

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = x + frameWidth / 2;
        const offsetY = y + frameHeight / 2;

        // 構面内座標変換関数
        const transform = (px, py) => {
            return {
                x: offsetX + (px - centerX) * modelScale,
                y: offsetY - (py - centerY) * modelScale
            };
        };

        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        visibleNodes.forEach(idx => {
            const node = nodes[idx];
            const projected = project3DTo2D(node, frame.mode);
            const pos = transform(projected.x, projected.y);
            nodeScreenData.push({ nodeIndex: idx, x: pos.x, y: pos.y });
            registerCircleObstacle(labelObstacles, pos.x, pos.y, 4);
        });

        // 枠外にはみ出さないよう、許容スケール上限を算出
        const EPS = 1e-9;
        let scaleLimit = Infinity;
        const frameAxis = frame.mode === 'iso' ? 'y' : getAxisForProjection(frame.mode);
        visibleMembers.forEach(m => {
            if (scaleLimit <= EPS) return;
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1 || !memberForces[memberIndex]) return;

            const forces = memberForces[memberIndex];
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);

            const L = Math.sqrt(
                Math.pow(nj.x - ni.x, 2) +
                Math.pow((nj.y || 0) - (ni.y || 0), 2) +
                Math.pow((nj.z || 0) - (ni.z || 0), 2)
            );
            if (!isFinite(L) || L < EPS) return;

            const distributedLoad = getDistributedLoadForAxis(forces, frameAxis);
            const numDivisions = 20;

            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;

                if (stressType === 'moment') {
                    stressValue = calculateMemberMoment(forces, L, xi, frameAxis, distributedLoad);
                } else if (stressType === 'axial') {
                    stressValue = calculateMemberAxial(forces, xi);
                } else if (stressType === 'shear') {
                    stressValue = calculateMemberShear(forces, L, xi, frameAxis, distributedLoad);
                }

                const absStress = Math.abs(stressValue);
                if (absStress < EPS) continue;

                const pos_x = pi.x + (pj.x - pi.x) * xi;
                const pos_y = pi.y + (pj.y - pi.y) * xi;
                const p = transform(pos_x, pos_y);

                const distToLeft = p.x - x;
                const distToRight = (x + frameWidth) - p.x;
                const distToTop = p.y - y;
                const distToBottom = (y + frameHeight) - p.y;
                const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

                if (minDist <= EPS) {
                    scaleLimit = 0;
                    return;
                }

                const candidateScale = minDist / absStress;
                if (candidateScale < scaleLimit) {
                    scaleLimit = candidateScale;
                }
            }
        });

        if (scaleLimit < Infinity) {
            stressScale = Math.min(stressScale, scaleLimit * 0.95);
        }

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1) return;
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
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
                memberIndex,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                tangent: { x: dx / length, y: dy / length },
                normal: { x: -dy / length, y: dx / length }
            });
        });

        // 応力図を描画（部材途中の値も考慮）
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1 || !memberForces[memberIndex]) return;

            const forces = memberForces[memberIndex];
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            
            // 部材の長さを計算
            const L = Math.sqrt(
                Math.pow(nj.x - ni.x, 2) +
                Math.pow((nj.y || 0) - (ni.y || 0), 2) +
                Math.pow((nj.z || 0) - (ni.z || 0), 2)
            );
            
            // 部材の方向ベクトル（2D投影面上）
            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length === 0) return;

            // 垂直方向（応力図を描画する方向）
            const perpX = -dy / length;
            const perpY = dx / length;

            // 部材の等分布荷重を取得（memberForcesに含まれる）
            // 等角投影の場合は主要な軸成分を使用
            const axisForLoad = frame.mode === 'iso' ? 'y' : frameAxis;
            const distributedLoad = getDistributedLoadForAxis(forces, axisForLoad); // kN/m

            if (window?.DEBUG_STRESS_DIAGRAMS) {
                console.log(`📊 応力図描画: 部材 ${m.i + 1}-${m.j + 1}, axis=${frameAxis}, w=${distributedLoad}, stressType=${stressType}`);
            }

            // 部材を分割して応力値を計算
            const numDivisions = 20; // 部材を20分割
            const stressPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;

                if (stressType === 'moment') {
                    // 曲げモーメント（等分布荷重を考慮）
                    if (frame.mode === 'iso') {
                        // 等角投影の場合はY軸のモーメントを使用（Z軸は別途描画）
                        stressValue = calculateMemberMomentForAxis(forces, L, xi, 'y', distributedLoad);
                    } else {
                        // 2D投影の場合は投影面に応じて適切な軸を選択
                        let momentAxis = 'y'; // デフォルト
                        if (frame.mode === 'xy') {
                            momentAxis = 'z'; // XY平面ではZ軸周りのモーメント
                        } else if (frame.mode === 'xz') {
                            momentAxis = 'y'; // XZ平面ではY軸周りのモーメント
                        } else if (frame.mode === 'yz') {
                            momentAxis = 'x'; // YZ平面ではX軸周りのモーメント
                        }
                        stressValue = calculateMemberMomentForAxis(forces, L, xi, momentAxis, distributedLoad);
                        
                        // デバッグ情報を追加
                        if (memberIndex === 0 && k === 0) {
                            console.log(`🔍 曲げモーメント計算: 投影面=${frame.mode}, 軸=${momentAxis}, 値=${stressValue.toFixed(3)}`);
                            console.log(`   部材力: M${momentAxis}_i=${forces[`M${momentAxis}_i`]}, M${momentAxis}_j=${forces[`M${momentAxis}_j`]}`);
                        }
                    }
                } else if (stressType === 'axial') {
                    // 軸力（線形分布を想定）
                    stressValue = calculateMemberAxial(forces, xi);
                } else if (stressType === 'shear') {
                    // せん断力（等分布荷重を考慮）
                    if (frame.mode === 'iso') {
                        // 等角投影の場合はY軸のせん断力を使用（Z軸は別途描画）
                        stressValue = calculateMemberShearForAxis(forces, L, xi, 'y', distributedLoad);
                    } else {
                        // 2D投影の場合は投影面に応じて適切な軸を選択
                        let shearAxis = 'y'; // デフォルト
                        if (frame.mode === 'xy') {
                            shearAxis = 'z'; // XY平面ではZ方向のせん断力
                        } else if (frame.mode === 'xz') {
                            shearAxis = 'y'; // XZ平面ではY方向のせん断力
                        } else if (frame.mode === 'yz') {
                            shearAxis = 'x'; // YZ平面ではX方向のせん断力
                        }
                        stressValue = calculateMemberShearForAxis(forces, L, xi, shearAxis, distributedLoad);
                        
                        // デバッグ情報を追加
                        if (memberIndex === 0 && k === 0) {
                            console.log(`🔍 せん断力計算: 投影面=${frame.mode}, 軸=${shearAxis}, 値=${stressValue.toFixed(3)}`);
                            console.log(`   部材力: Q${shearAxis}_i=${forces[`Q${shearAxis}_i`]}, Q${shearAxis}_j=${forces[`Q${shearAxis}_j`]}`);
                        }
                    }
                }

                const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
                
                // 部材上の位置（2D投影）
                const pos_x = pi.x + (pj.x - pi.x) * xi;
                const pos_y = pi.y + (pj.y - pi.y) * xi;
                const p = transform(pos_x, pos_y);
                
                stressPoints.push({
                    x: p.x,
                    y: p.y,
                    value: finiteStressValue,
                    offset: finiteStressValue * stressScale
                });
            }

            // 応力図を塗りつぶし - セグメント別に確実に塗る方式
            const positiveFillColor = 'rgba(255, 100, 100, 0.5)';
            const negativeFillColor = 'rgba(100, 100, 255, 0.5)';

            // Canvas状態を保存
            ctx.save();
            
            // グローバルアルファを明示的に設定
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            
            // デバッグ: 最初の部材のセグメントをログ出力
            if (window.DEBUG_STRESS_FILL && stressPoints.length > 0) {
                console.log(`部材 ${memberIndex + 1}: ${stressPoints.length}点, 値範囲=[${Math.min(...stressPoints.map(p => p.value)).toFixed(2)}, ${Math.max(...stressPoints.map(p => p.value)).toFixed(2)}], scale=${stressScale.toFixed(2)}, perp=(${perpX.toFixed(3)}, ${perpY.toFixed(3)})`);
            }

            // 各セグメント（隣接2点）ごとに台形を描画
            let segmentsFilled = 0;
            for (let k = 0; k < stressPoints.length - 1; k++) {
                const p1 = stressPoints[k];
                const p2 = stressPoints[k + 1];
                
                // 両方とも値がほぼゼロの場合はスキップ
                if (Math.abs(p1.value) < 1e-9 && Math.abs(p2.value) < 1e-9) {
                    continue;
                }
                
                // 平均値で色を決定
                const avgValue = (p1.value + p2.value) / 2;
                const fillColor = avgValue >= 0 ? positiveFillColor : negativeFillColor;
                
                // 台形の4点を時計回りに定義
                const base1X = p1.x;
                const base1Y = p1.y;
                const base2X = p2.x;
                const base2Y = p2.y;
                
                const offset1 = Number.isFinite(p1.offset) ? p1.offset : 0;
                const offset2 = Number.isFinite(p2.offset) ? p2.offset : 0;
                
                const off1X = p1.x + perpX * offset1;
                const off1Y = p1.y - perpY * offset1;
                const off2X = p2.x + perpX * offset2;
                const off2Y = p2.y - perpY * offset2;
                
                // デバッグ: 最初のセグメントの座標をログ出力
                if (window.DEBUG_STRESS_FILL && k === 0 && memberIndex === 0) {
                    console.log(`  セグメント0: base=(${base1X.toFixed(1)},${base1Y.toFixed(1)})→(${base2X.toFixed(1)},${base2Y.toFixed(1)}), offset=(${off1X.toFixed(1)},${off1Y.toFixed(1)})→(${off2X.toFixed(1)},${off2Y.toFixed(1)}), color=${fillColor}`);
                }
                
                // 台形を描画（時計回り）
                ctx.fillStyle = fillColor;
                ctx.beginPath();
                ctx.moveTo(base1X, base1Y);
                ctx.lineTo(base2X, base2Y);
                ctx.lineTo(off2X, off2Y);
                ctx.lineTo(off1X, off1Y);
                ctx.closePath();
                ctx.fill();
                segmentsFilled++;
            }
            
            if (window.DEBUG_STRESS_FILL) {
                console.log(`  → ${segmentsFilled}個のセグメントを塗りつぶしました`);
            }
            
            // Canvas状態を復元
            ctx.restore();

            // 応力図の輪郭を描画（滑らかな曲線）
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let k = 0; k <= numDivisions; k++) {
                const p = stressPoints[k];
                const px = Math.max(x, Math.min(x + drawWidth, p.x + perpX * p.offset));
                const py = Math.max(y, Math.min(y + drawHeight, p.y - perpY * p.offset));
                
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            
            // 最大応力値の位置を見つけて表示
            let maxAbsValue = 0;
            let maxAbsIndex = 0;
            stressPoints.forEach((p, idx) => {
                if (Math.abs(p.value) > maxAbsValue) {
                    maxAbsValue = Math.abs(p.value);
                    maxAbsIndex = idx;
                }
            });
            
            // 部材端の応力値を表示
            const p1 = stressPoints[0];
            const pN = stressPoints[numDivisions];
            
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.lineWidth = 5;
            
            if (Math.abs(p1.value) > 0.01) {
                const startValueText = p1.value.toFixed(2);
                const baseX = p1.x + perpX * p1.offset;
                const baseY = p1.y - perpY * p1.offset - 8;
                drawTextWithPlacement(ctx, startValueText, baseX, baseY, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: '#000',
                    padding: 14
                });
            }
            
            if (Math.abs(pN.value) > 0.01) {
                const endValueText = pN.value.toFixed(2);
                const baseX = pN.x + perpX * pN.offset;
                const baseY = pN.y - perpY * pN.offset - 8;
                drawTextWithPlacement(ctx, endValueText, baseX, baseY, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: '#000',
                    padding: 14
                });
            }
            
            // 最大応力値の位置にマーカーと値を表示（端点以外の場合のみ）
            if (maxAbsIndex > 0 && maxAbsIndex < numDivisions && maxAbsValue > 0.01) {
                const pMax = stressPoints[maxAbsIndex];
                const maxX = pMax.x + perpX * pMax.offset;
                const maxY = pMax.y - perpY * pMax.offset;
                
                // マーカー（円）を描画
                ctx.fillStyle = pMax.value >= 0 ? 'red' : 'blue';
                ctx.beginPath();
                ctx.arc(maxX, maxY, 5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                // 最大値を表示
                ctx.font = 'bold 16px Arial';
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'white';
                const maxText = `Max: ${pMax.value.toFixed(2)}`;
                const fillColor = pMax.value >= 0 ? '#cc0000' : '#0000cc';
                drawTextWithPlacement(ctx, maxText, maxX, maxY - 12, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: fillColor,
                    padding: 16
                });
            }
        });

        const nodeLabelOffsets = [
            { x: 0, y: 26 },
            { x: 24, y: 0 },
            { x: -24, y: 0 },
            { x: 0, y: -28 },
            { x: 28, y: -18 },
            { x: -28, y: -18 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 28, y: normal.y * 28 },
                { x: -normal.x * 28, y: -normal.y * 28 },
                { x: tangent.x * 30, y: tangent.y * 30 },
                { x: -tangent.x * 30, y: -tangent.y * 30 },
                { x: normal.x * 40, y: normal.y * 40 },
                { x: -normal.x * 40, y: -normal.y * 40 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
    });
};

// 3D応力図描画関数
const draw3DStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 3D表示用のカメラ設定
    const camera = window.camera3D || {
        position: { x: 0, y: 0, z: 10 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fov: 45,
        zoom: 1
    };

    // 3D座標を2Dスクリーン座標に変換（回転を考慮）
    const project3DToScreen = (point3D) => {
        const { x, y, z } = point3D;
        
        // 回転行列を適用
        const cosX = Math.cos(camera.rotationX || 0);
        const sinX = Math.sin(camera.rotationX || 0);
        const cosY = Math.cos(camera.rotationY || 0);
        const sinY = Math.sin(camera.rotationY || 0);
        
        // Y軸回転
        let x1 = x * cosY - z * sinY;
        let y1 = y;
        let z1 = x * sinY + z * cosY;
        
        // X軸回転
        let x2 = x1;
        let y2 = y1 * cosX - z1 * sinX;
        let z2 = y1 * sinX + z1 * cosX;
        
        // 透視投影
        const distance = Math.sqrt(x2*x2 + y2*y2 + z2*z2);
        const scale = camera.zoom * 200 / (distance + 1);
        
        return {
            x: canvas.width / 2 + x2 * scale,
            y: canvas.height / 2 - y2 * scale
        };
    };

    // 応力の最大値を計算
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];

        if (stressType === 'moment') {
            // Y軸のモーメントの最大値を計算（Z軸は別途描画）
            const { Mi, Mj } = getMomentComponentsForAxis(forces, 'y');
            const start = convertMomentForDiagram(Mi, 'i');
            const end = convertMomentForDiagram(Mj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        } else if (stressType === 'axial') {
            const { Ni, Nj } = getAxialComponents(forces);
            const start = convertAxialForDiagram(Ni, 'i');
            const end = convertAxialForDiagram(Nj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        } else if (stressType === 'shear') {
            // Y軸のせん断力の最大値を計算（Z軸は別途描画）
            const { Qi, Qj } = getShearComponentsForAxis(forces, 'y');
            const start = convertShearForDiagram(Qi, 'i');
            const end = convertShearForDiagram(Qj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        }
    });

    // 応力図のスケール
    const maxStressPixels = Math.min(canvas.width, canvas.height) * 0.06;
    const stressScale = maxStress > 0 ? maxStressPixels / maxStress : 1;

    // 元の構造を描画（グレー）
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    members.forEach(member => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return;

        const p1 = project3DToScreen(nodeI);
        const p2 = project3DToScreen(nodeJ);
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    });

    // 応力図を描画
    members.forEach(member => {
        const memberIndex = members.findIndex(mem => mem.i === member.i && mem.j === member.j);
        if (memberIndex === -1 || !memberForces[memberIndex]) return;

        const forces = memberForces[memberIndex];
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        
        // 部材の長さを計算
        const L = Math.sqrt(
            Math.pow(nodeJ.x - nodeI.x, 2) +
            Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) +
            Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
        );
        
        // 部材の方向ベクトル（3D）
        const dx = nodeJ.x - nodeI.x;
        const dy = (nodeJ.y || 0) - (nodeI.y || 0);
        const dz = (nodeJ.z || 0) - (nodeI.z || 0);
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length === 0) return;

        // 垂直方向（応力図を描画する方向）
        const perpX = -dy / length;
        const perpY = dx / length;
        const perpZ = 0;

        // 部材を分割して応力値を計算
        const numDivisions = 20;
        const stressPoints = [];
        
        for (let k = 0; k <= numDivisions; k++) {
            const xi = k / numDivisions;
            let stressValue = 0;

            if (stressType === 'moment') {
                // 3D表示ではY軸のモーメントを使用（Z軸は別途描画）
                stressValue = calculateMemberMomentForAxis(forces, L, xi, 'y', null);
            } else if (stressType === 'axial') {
                stressValue = calculateMemberAxial(forces, xi);
            } else if (stressType === 'shear') {
                // 3D表示ではY軸のせん断力を使用（Z軸は別途描画）
                stressValue = calculateMemberShearForAxis(forces, L, xi, 'y', null);
            }

            const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
            
            // 部材上の位置（3D）
            const pos_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
            const pos_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
            const pos_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
            
            stressPoints.push({
                x: pos_x,
                y: pos_y,
                z: pos_z,
                value: finiteStressValue,
                offset: finiteStressValue * stressScale
            });
        }

        // 応力図を塗りつぶし
        const positiveFillColor = 'rgba(255, 100, 100, 0.5)';
        const negativeFillColor = 'rgba(100, 100, 255, 0.5)';

        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';

        // 各セグメントごとに台形を描画
        for (let k = 0; k < stressPoints.length - 1; k++) {
            const p1 = stressPoints[k];
            const p2 = stressPoints[k + 1];
            
            if (Math.abs(p1.value) < 1e-9 && Math.abs(p2.value) < 1e-9) {
                continue;
            }
            
            const avgValue = (p1.value + p2.value) / 2;
            const fillColor = avgValue >= 0 ? positiveFillColor : negativeFillColor;
            
            // 3D座標を2Dスクリーン座標に変換
            const base1 = project3DToScreen({ x: p1.x, y: p1.y, z: p1.z });
            const base2 = project3DToScreen({ x: p2.x, y: p2.y, z: p2.z });
            
            const offset1 = Number.isFinite(p1.offset) ? p1.offset : 0;
            const offset2 = Number.isFinite(p2.offset) ? p2.offset : 0;
            
            const off1 = project3DToScreen({ 
                x: p1.x + perpX * offset1, 
                y: p1.y + perpY * offset1, 
                z: p1.z + perpZ * offset1 
            });
            const off2 = project3DToScreen({ 
                x: p2.x + perpX * offset2, 
                y: p2.y + perpY * offset2, 
                z: p2.z + perpZ * offset2 
            });
            
            // 台形を描画
            ctx.fillStyle = fillColor;
            ctx.beginPath();
            ctx.moveTo(base1.x, base1.y);
            ctx.lineTo(base2.x, base2.y);
            ctx.lineTo(off2.x, off2.y);
            ctx.lineTo(off1.x, off1.y);
            ctx.closePath();
            ctx.fill();
        }
        
        ctx.restore();

        // 応力図の輪郭を描画
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = 0; k <= numDivisions; k++) {
            const p = stressPoints[k];
            const projected = project3DToScreen({ 
                x: p.x + perpX * p.offset, 
                y: p.y + perpY * p.offset, 
                z: p.z + perpZ * p.offset 
            });
            
            if (k === 0) ctx.moveTo(projected.x, projected.y);
            else ctx.lineTo(projected.x, projected.y);
        }
        ctx.stroke();
    });

    // 節点番号を表示
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    nodes.forEach((node, nodeIdx) => {
        const projected = project3DToScreen(node);
        ctx.fillText(String(nodeIdx + 1), projected.x + 15, projected.y - 15);
    });

    // 部材番号を表示
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    members.forEach((member, memberIdx) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return;

        const p1 = project3DToScreen(nodeI);
        const p2 = project3DToScreen(nodeJ);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        ctx.fillText(String(memberIdx + 1), midX, midY);
    });

    // タイトルを表示
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(title, 20, 30);
    
// Z軸応力図描画関数（3D構造用）
const draw3DStressDiagramZAxis = (canvas, nodes, members, memberForces, stressType, title) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 最大応力の計算（Z軸）
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];

        if (stressType === 'moment') {
            // Z軸のモーメントの最大値を計算
            const { Mi, Mj } = getMomentComponentsForAxis(forces, 'z');
            const start = convertMomentForDiagram(Mi, 'i');
            const end = convertMomentForDiagram(Mj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        } else if (stressType === 'axial') {
            const { Ni, Nj } = getAxialComponents(forces);
            const start = convertAxialForDiagram(Ni, 'i');
            const end = convertAxialForDiagram(Nj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        } else if (stressType === 'shear') {
            // Z軸のせん断力の最大値を計算
            const { Qi, Qj } = getShearComponentsForAxis(forces, 'z');
            const start = convertShearForDiagram(Qi, 'i');
            const end = convertShearForDiagram(Qj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        }
    });

    // 応力図のスケール
    const maxStressPixels = Math.min(canvas.width, canvas.height) * 0.06;
    const stressScale = maxStress > 0 ? maxStressPixels / maxStress : 1;

    // 元の構造を描画（グレー）
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    members.forEach(member => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        
        const p1 = project3DToScreen(nodeI);
        const p2 = project3DToScreen(nodeJ);
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    });

    // 応力図を描画
    const numDivisions = 20;
    members.forEach((member, memberIdx) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        const forces = memberForces[memberIdx];
        
        if (!forces) return;

        const L = Math.sqrt(
            Math.pow(nodeJ.x - nodeI.x, 2) + 
            Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) + 
            Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
        );

        if (L <= 1e-9) return;

        const stressPoints = [];
        
        for (let k = 0; k <= numDivisions; k++) {
            const xi = k / numDivisions;
            let stressValue = 0;

            if (stressType === 'moment') {
                // Z軸のモーメントを使用
                stressValue = calculateMemberMomentForAxis(forces, L, xi, 'z', null);
            } else if (stressType === 'axial') {
                stressValue = calculateMemberAxial(forces, xi);
            } else if (stressType === 'shear') {
                // Z軸のせん断力を使用
                stressValue = calculateMemberShearForAxis(forces, L, xi, 'z', null);
            }

            const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
            
            // 部材上の位置（3D）
            const pos_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
            const pos_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
            const pos_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
            
            stressPoints.push({
                x: pos_x,
                y: pos_y,
                z: pos_z,
                stress: finiteStressValue
            });
        }

        // 応力図を描画（Z軸方向に部材軸と直交する方向）
        ctx.strokeStyle = finiteStressValue >= 0 ? '#ff0000' : '#0000ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        stressPoints.forEach((point, idx) => {
            const projected = project3DToScreen(point);
            // Z軸方向の応力を部材軸と直交する方向に描画
            const offsetY = finiteStressValue >= 0 ? 
                projected.y - point.stress * stressScale : 
                projected.y + point.stress * stressScale;
            
            if (idx === 0) {
                ctx.moveTo(projected.x, offsetY);
            } else {
                ctx.lineTo(projected.x, offsetY);
            }
        });
        
        ctx.stroke();
    });

    // 節点番号を表示
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    nodes.forEach((node, nodeIdx) => {
        const projected = project3DToScreen(node);
        ctx.fillText(String(nodeIdx + 1), projected.x + 15, projected.y - 15);
    });

    // 部材番号を表示
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial';
    members.forEach((member, memberIdx) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        const p1 = project3DToScreen(nodeI);
        const p2 = project3DToScreen(nodeJ);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        ctx.fillText(String(memberIdx + 1), midX, midY);
    });

    // タイトルを表示
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(title, 20, 30);
    
    console.log('✅ Z軸応力図描画完了:', title);
};

// 3D表示用のカメラ制御機能
const init3DCameraControls = () => {
    // 3Dカメラの初期設定
    window.camera3D = {
        position: { x: 0, y: 0, z: 10 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fov: 45,
        zoom: 1,
        rotationX: 0,
        rotationY: 0
    };

    // マウスイベントリスナーを追加
    let isMouseDown = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // 変位図キャンバスにイベントリスナーを追加
    const displacementCanvas = diagramElements.displacementCanvas;
    if (displacementCanvas) {
        displacementCanvas.addEventListener('mousedown', (e) => {
            if (window.is3DDisplayMode) {
                isMouseDown = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                displacementCanvas.style.cursor = 'grabbing';
            }
        });

        displacementCanvas.addEventListener('mousemove', (e) => {
            if (window.is3DDisplayMode && isMouseDown) {
                const deltaX = e.clientX - lastMouseX;
                const deltaY = e.clientY - lastMouseY;

                // 回転の更新
                window.camera3D.rotationY += deltaX * 0.01;
                window.camera3D.rotationX += deltaY * 0.01;

                // 回転を制限
                window.camera3D.rotationX = Math.max(-Math.PI/2, Math.min(Math.PI/2, window.camera3D.rotationX));

                lastMouseX = e.clientX;
                lastMouseY = e.clientY;

                // 図面を再描画
                if (window.redrawDiagrams) {
                    window.redrawDiagrams();
                }
            }
        });

        displacementCanvas.addEventListener('mouseup', () => {
            if (window.is3DDisplayMode) {
                isMouseDown = false;
                displacementCanvas.style.cursor = 'grab';
            }
        });

        displacementCanvas.addEventListener('wheel', (e) => {
            if (window.is3DDisplayMode) {
                e.preventDefault();
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                window.camera3D.zoom *= zoomFactor;
                window.camera3D.zoom = Math.max(0.1, Math.min(5.0, window.camera3D.zoom));

                // 図面を再描画
                if (window.redrawDiagrams) {
                    window.redrawDiagrams();
                }
            }
        });

        displacementCanvas.style.cursor = 'grab';
    }

    // 応力図キャンバスにも同様のイベントリスナーを追加
    const stressCanvases = [
        diagramElements.momentCanvas,
        diagramElements.axialCanvas,
        diagramElements.shearCanvas,
        diagramElements.capacityRatioCanvas
    ];

    stressCanvases.forEach(canvas => {
        if (canvas) {
            canvas.addEventListener('mousedown', (e) => {
                if (window.is3DDisplayMode) {
                    isMouseDown = true;
                    lastMouseX = e.clientX;
                    lastMouseY = e.clientY;
                    canvas.style.cursor = 'grabbing';
                }
            });

            canvas.addEventListener('mousemove', (e) => {
                if (window.is3DDisplayMode && isMouseDown) {
                    const deltaX = e.clientX - lastMouseX;
                    const deltaY = e.clientY - lastMouseY;

                    // 回転の更新
                    window.camera3D.rotationY += deltaX * 0.01;
                    window.camera3D.rotationX += deltaY * 0.01;

                    // 回転を制限
                    window.camera3D.rotationX = Math.max(-Math.PI/2, Math.min(Math.PI/2, window.camera3D.rotationX));

                    lastMouseX = e.clientX;
                    lastMouseY = e.clientY;

                    // 図面を再描画
                    if (window.redrawDiagrams) {
                        window.redrawDiagrams();
                    }
                }
            });

            canvas.addEventListener('mouseup', () => {
                if (window.is3DDisplayMode) {
                    isMouseDown = false;
                    canvas.style.cursor = 'grab';
                }
            });

            canvas.addEventListener('wheel', (e) => {
                if (window.is3DDisplayMode) {
                    e.preventDefault();
                    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                    window.camera3D.zoom *= zoomFactor;
                    window.camera3D.zoom = Math.max(0.1, Math.min(5.0, window.camera3D.zoom));

                    // 図面を再描画
                    if (window.redrawDiagrams) {
                        window.redrawDiagrams();
                    }
                }
            });

            canvas.style.cursor = 'grab';
        }
    });
};

// 3D表示モードの切り替え関数（改善版）
const toggle3DDisplayMode = (forceMode = null) => {
    if (forceMode !== null) {
        // 強制的にモードを設定
        window.is3DDisplayMode = forceMode;
    } else {
        // 現在の状態を反転
        window.is3DDisplayMode = !window.is3DDisplayMode;
    }
    
    console.log(`3D表示モード: ${window.is3DDisplayMode ? 'ON' : 'OFF'}`);
    
    // 図面を再描画
    if (window.redrawDiagrams) {
        window.redrawDiagrams();
    }
    
    return window.is3DDisplayMode;
};

// 3D表示モードを強制的に有効にする関数
const enable3DDisplayMode = () => {
    return toggle3DDisplayMode(true);
};

// 3D表示モードを強制的に無効にする関数
const disable3DDisplayMode = () => {
    return toggle3DDisplayMode(false);
};

// デバッグ用：3D表示状態を確認する関数
const debug3DDisplayMode = () => {
    console.log('=== 3D表示状態デバッグ ===');
    console.log('window.is3DDisplayMode:', window.is3DDisplayMode);
    console.log('detect3DDisplayMode():', detect3DDisplayMode());
    
    // 3Dビューアーの状態をチェック
    console.log('window.viewer3D:', window.viewer3D);
    if (window.viewer3D && window.viewer3D.isVisible) {
        console.log('viewer3D.isVisible():', window.viewer3D.isVisible());
    }
    
    // DOM要素の状態をチェック
    const viewer3D = document.querySelector('.viewer-3d') || 
                   document.querySelector('#viewer-3d') ||
                   document.querySelector('[id*="3d"]') ||
                   document.querySelector('[class*="3d"]');
    console.log('3D viewer element:', viewer3D);
    if (viewer3D) {
        console.log('display style:', viewer3D.style.display);
        console.log('offsetParent:', viewer3D.offsetParent);
    }
    
    // Three.jsレンダラーの状態をチェック
    console.log('window.renderer:', window.renderer);
    if (window.renderer && window.renderer.domElement) {
        console.log('renderer.domElement.style.display:', window.renderer.domElement.style.display);
    }
    
    console.log('========================');
};

// デバッグ用：図面描画の状態を確認する関数
const debugDrawingMode = () => {
    console.log('=== 図面描画モードデバッグ ===');
    console.log('window.is3DDisplayMode:', window.is3DDisplayMode);
    console.log('detect3DDisplayMode():', detect3DDisplayMode());
    
    // キャンバスの状態をチェック
    const displacementCanvas = diagramElements.displacementCanvas;
    if (displacementCanvas) {
        console.log('displacementCanvas exists:', !!displacementCanvas);
        console.log('displacementCanvas size:', displacementCanvas.width, 'x', displacementCanvas.height);
    }
    
    // 3D関連の要素をチェック
    const viewer3D = document.querySelector('.viewer-3d') || 
                   document.querySelector('#viewer-3d') ||
                   document.querySelector('[id*="3d"]') ||
                   document.querySelector('[class*="3d"]');
    console.log('3D viewer element found:', !!viewer3D);
    if (viewer3D) {
        console.log('viewer3D display:', viewer3D.style.display);
        console.log('viewer3D visible:', viewer3D.offsetParent !== null);
    }
    
    console.log('========================');
};

// 強制的に2D表示モードにする関数
const force2DDisplayMode = () => {
    window.is3DDisplayMode = false;
    disableAuto3DDetection();
    console.log('強制的に2D表示モードに設定しました');
    
    // 図面を再描画
    if (window.redrawDiagrams) {
        window.redrawDiagrams();
    }
};

// デバッグ用：利用可能なキャンバス要素を確認する関数
const debugAvailableCanvases = () => {
    console.log('=== 利用可能なキャンバス要素 ===');
    
    const allCanvases = document.querySelectorAll('canvas');
    console.log('Total canvas elements found:', allCanvases.length);
    
    allCanvases.forEach((canvas, index) => {
        console.log(`Canvas ${index + 1}:`, {
            id: canvas.id || 'no-id',
            className: canvas.className || 'no-class',
            width: canvas.width,
            height: canvas.height,
            visible: canvas.offsetParent !== null,
            display: canvas.style.display || 'default'
        });
    });
    
    // 特定のIDで検索
    const specificIds = ['displacementCanvas', 'momentCanvas', 'axialCanvas', 'shearCanvas', 'capacityRatioCanvas'];
    specificIds.forEach(id => {
        const element = document.getElementById(id);
        console.log(`${id}:`, element ? 'found' : 'not found');
    });
    
    console.log('========================');
};

// グローバル関数として公開
window.toggle3DDisplayMode = toggle3DDisplayMode;
window.enable3DDisplayMode = enable3DDisplayMode;
window.disable3DDisplayMode = disable3DDisplayMode;
window.init3DCameraControls = init3DCameraControls;
window.detect3DDisplayMode = detect3DDisplayMode;
window.enableAuto3DDetection = enableAuto3DDetection;
window.disableAuto3DDetection = disableAuto3DDetection;
window.debug3DDisplayMode = debug3DDisplayMode;
window.debugDrawingMode = debugDrawingMode;
window.force2DDisplayMode = force2DDisplayMode;
window.debugAvailableCanvases = debugAvailableCanvases;

// 検定比図描画関数（全投影・各構面対応）
const drawCapacityRatioDiagram = (canvas, nodes, members, sectionCheckResults) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 投影面を定義（等角投影を含む）
    const projectionModes = ['iso'];

    // 各投影面の構面座標を取得し、検定比図を表示（値が0でも表示）
    const frameData = [];
    const tolerance = 0.01;
    
    projectionModes.forEach(mode => {
        if (mode === 'iso') {
            // 等角投影の場合は全ての部材を対象とし、検定比が0でも表示
            frameData.push({ mode: 'iso', coord: 0 });
        } else {
            const coords = getAllFrameCoordinates(nodes, mode);
            if (coords.length > 0) {
                coords.forEach(coord => {
                    // この構面に含まれる部材をチェック
                    let hasNonZeroRatio = false;
                    
                    for (let idx = 0; idx < members.length; idx++) {
                        const m = members[idx];
                        const nodeI = nodes[m.i];
                        const nodeJ = nodes[m.j];
                        if (!nodeI || !nodeJ) continue;
                        
                        // 部材の両端節点がこの構面上にあるかチェック
                        let coordI = 0, coordJ = 0;
                        if (mode === 'xy') {
                            coordI = nodeI.z;
                            coordJ = nodeJ.z;
                        } else if (mode === 'xz') {
                            coordI = nodeI.y;
                            coordJ = nodeJ.y;
                        } else if (mode === 'yz') {
                            coordI = nodeI.x;
                            coordJ = nodeJ.x;
                        }
                        
                        // 両端点がこの構面上にある場合
                        if (Math.abs(coordI - coord) < tolerance && Math.abs(coordJ - coord) < tolerance) {
                            if (sectionCheckResults && sectionCheckResults[idx]) {
                                const result = sectionCheckResults[idx];
                                const ratio = (typeof result.maxRatio === 'number') ? result.maxRatio : 0;
                                
                                if (ratio > 0.001) { // 0.001以上の検定比があれば表示
                                    hasNonZeroRatio = true;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // 検定比が0以外の構面のみを追加
                    if (hasNonZeroRatio) {
                        frameData.push({ mode, coord });
                    }
                });
            }
        }
    });

    if (frameData.length === 0) return;

    // 横スクロール式のレイアウト: 各構面を元のキャンバスサイズで横に並べる
    const frameWidth = 1200;  // 各構面の幅
    const frameHeight = 900; // 各構面の高さ
    const framePadding = 40; // 構面間の余白
    const headerHeight = 80; // ヘッダー高さ
    
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

    // 検定比の最大値を計算
    let maxRatio = 0;
    members.forEach((m, idx) => {
        if (sectionCheckResults && sectionCheckResults[idx]) {
            const result = sectionCheckResults[idx];
            const ratio = (typeof result.maxRatio === 'number') ? result.maxRatio : 0;
            maxRatio = Math.max(maxRatio, ratio);
        }
    });

    // 各フレームを描画（横並び）
    frameData.forEach((frame, index) => {
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // 構面のタイトルを描画（フレームの上部）
        let frameTitle;
        if (frame.mode === 'iso') {
            frameTitle = '等角投影図';
        } else {
            const axisName = frame.mode === 'xy' ? 'Z' : (frame.mode === 'xz' ? 'Y' : 'X');
            frameTitle = `${frame.mode.toUpperCase()}平面 (${axisName}=${frame.coord.toFixed(2)}m)`;
        }
        
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(frameTitle, x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(`検定比図 (最大: ${maxRatio.toFixed(3)})`, x + frameWidth / 2, framePadding + 50);

        // 構面の背景を描画
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 構面の境界を描画
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        // 構面内に描画するための座標変換を設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        // この構面の節点と部材を取得
        const tolerance = 0.01;
        const visibleNodes = new Set();
        
        if (frame.mode === 'iso') {
            // 等角投影の場合は全ての節点と部材を対象とする
            nodes.forEach((node, idx) => {
                visibleNodes.add(idx);
            });
        } else {
            nodes.forEach((node, idx) => {
                let coordToCheck = 0;
                if (frame.mode === 'xy') {
                    coordToCheck = node.z;
                } else if (frame.mode === 'xz') {
                    coordToCheck = node.y;
                } else if (frame.mode === 'yz') {
                    coordToCheck = node.x;
                }
                if (Math.abs(coordToCheck - frame.coord) < tolerance) {
                    visibleNodes.add(idx);
                }
            });
        }

        // この構面の部材のみをフィルタリング
        const visibleMembers = members.filter(m =>
            visibleNodes.has(m.i) && visibleNodes.has(m.j)
        );

        if (visibleMembers.length === 0) {
            ctx.restore();
            return;
        }

        // モデルの範囲を計算
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visibleMembers.forEach(m => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        const margin = 40;
        const drawWidth = frameWidth - 2 * margin;
        const drawHeight = frameHeight - 2 * margin;

        let scale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            scale = Math.min(drawWidth / modelWidth, drawHeight / modelHeight) * 0.9;
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = x + frameWidth / 2;
        const offsetY = y + frameHeight / 2;

        // 構面内座標変換関数
        const transform = (px, py) => {
            return {
                x: offsetX + (px - centerX) * scale,
                y: offsetY - (py - centerY) * scale
            };
        };

        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        visibleNodes.forEach(idx => {
            const node = nodes[idx];
            const projected = project3DTo2D(node, frame.mode);
            const pos = transform(projected.x, projected.y);
            nodeScreenData.push({ nodeIndex: idx, x: pos.x, y: pos.y });
            registerCircleObstacle(labelObstacles, pos.x, pos.y, 4);
        });

        // 検定比に応じた色を返す関数
        const getRatioColor = (ratio) => {
            if (ratio < 0.5) return '#00ff00';      // 緑
            if (ratio < 0.7) return '#90ee90';      // 薄緑
            if (ratio < 0.9) return '#ffff00';      // 黄色
            if (ratio < 1.0) return '#ffa500';      // オレンジ
            return '#ff0000';                        // 赤
        };

        // 最大検定比を計算してスケーリング
        let maxRatioValue = 0;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            const result = (memberIndex !== -1 && sectionCheckResults && sectionCheckResults[memberIndex])
                ? sectionCheckResults[memberIndex]
                : null;
            if (result && result.ratios) {
                result.ratios.forEach(r => {
                    if (r > maxRatioValue) maxRatioValue = r;
                });
            }
        });

        // 検定比図のスケール（描画領域の8%程度）
        const maxRatioPixels = Math.min(drawWidth, drawHeight) * 0.08;
        const ratioScale = maxRatioValue > 0 ? maxRatioPixels / maxRatioValue : 1;

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            if (memberIndex !== -1) {
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const length = Math.hypot(dx, dy) || 1;
                memberScreenData.push({
                    memberIndex,
                    midX: (p1.x + p2.x) / 2,
                    midY: (p1.y + p2.y) / 2,
                    tangent: { x: dx / length, y: dy / length },
                    normal: { x: -dy / length, y: dx / length }
                });
            }
        });

        // 検定比分布を描画
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            const result = (memberIndex !== -1 && sectionCheckResults && sectionCheckResults[memberIndex])
                ? sectionCheckResults[memberIndex]
                : null;

            if (!result || !result.ratios || result.ratios.length === 0) return;

            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);

            // 部材の方向ベクトル
            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length === 0) return;

            // 垂直方向（検定比図を描画する方向）
            const perpX = -dy / length;
            const perpY = dx / length;

            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);

            const numPoints = result.ratios.length;
            console.log(`部材${memberIndex + 1}: ${numPoints}箇所の検定比データを使用して分布描画`);

            // 検定比分布を塗りつぶしで描画（確実に塗るためパス構築を明示的に）
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = getRatioColor(result.maxRatio);
            ctx.beginPath();
            
            // ベースライン（部材）
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            // オフセットライン（検定比分布）を逆順で
            for (let k = numPoints - 1; k >= 0; k--) {
                const t = k / (numPoints - 1);
                const ratio = result.ratios[k];
                const baseX = p1.x + t * (p2.x - p1.x);
                const baseY = p1.y + t * (p2.y - p1.y);
                const offset = ratio * ratioScale;
                const px = baseX + perpX * offset;
                const py = baseY + perpY * offset;
                ctx.lineTo(px, py);
            }
            
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // 輪郭線を描画（色分け）
            ctx.lineWidth = 3;
            for (let k = 0; k < numPoints - 1; k++) {
                const t1 = k / (numPoints - 1);
                const t2 = (k + 1) / (numPoints - 1);
                const ratio1 = result.ratios[k];
                const ratio2 = result.ratios[k + 1];
                const avgRatio = (ratio1 + ratio2) / 2;

                const base1X = p1.x + t1 * (p2.x - p1.x);
                const base1Y = p1.y + t1 * (p2.y - p1.y);
                const offset1 = ratio1 * ratioScale;
                const px1 = base1X + perpX * offset1;
                const py1 = base1Y + perpY * offset1;

                const base2X = p1.x + t2 * (p2.x - p1.x);
                const base2Y = p1.y + t2 * (p2.y - p1.y);
                const offset2 = ratio2 * ratioScale;
                const px2 = base2X + perpX * offset2;
                const py2 = base2Y + perpY * offset2;

                ctx.strokeStyle = getRatioColor(avgRatio);
                ctx.beginPath();
                ctx.moveTo(px1, py1);
                ctx.lineTo(px2, py2);
                ctx.stroke();
            }

            // 最大検定比の位置にマーカーと値を表示
            const maxRatio = result.maxRatio;
            let maxRatioIndex = 0;
            let maxValue = 0;
            result.ratios.forEach((r, idx) => {
                if (r > maxValue) {
                    maxValue = r;
                    maxRatioIndex = idx;
                }
            });

            const maxT = maxRatioIndex / (numPoints - 1);
            const maxBaseX = p1.x + maxT * (p2.x - p1.x);
            const maxBaseY = p1.y + maxT * (p2.y - p1.y);
            const maxOffset = maxRatio * ratioScale;
            const maxX = maxBaseX + perpX * maxOffset;
            const maxY = maxBaseY + perpY * maxOffset;

            // 最大検定比位置にマーカー（円）を描画
            ctx.fillStyle = getRatioColor(maxRatio);
            ctx.beginPath();
            ctx.arc(maxX, maxY, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 最大検定比の値をテキストで表示
            const textColor = maxRatio > 1.0 ? '#ff0000' : '#000';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.lineWidth = 5;
            // 白い縁取り
            ctx.strokeStyle = 'white';
            const ratioText = maxRatio.toFixed(3);
            ctx.strokeText(ratioText, maxX, maxY - 12);
            // カラーテキスト
            ctx.fillStyle = textColor;
            ctx.fillText(ratioText, maxX, maxY - 12);
            registerTextObstacle(labelObstacles, ctx, ratioText, maxX, maxY - 12);
        });

        const nodeLabelOffsets = [
            { x: 0, y: 26 },
            { x: 24, y: 0 },
            { x: -24, y: 0 },
            { x: 0, y: -28 },
            { x: 28, y: -18 },
            { x: -28, y: -18 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 26, y: normal.y * 26 },
                { x: -normal.x * 26, y: -normal.y * 26 },
                { x: tangent.x * 32, y: tangent.y * 32 },
                { x: -tangent.x * 32, y: -tangent.y * 32 },
                { x: normal.x * 40, y: normal.y * 40 },
                { x: -normal.x * 40, y: -normal.y * 40 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
    });
    };
};

// 方向別応力図描画関数
const drawDirectionalStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    console.log('🎨 drawDirectionalStressDiagram called:', { stressType, title });
    
    if (!canvas) {
        console.warn('⚠️ Canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('⚠️ Canvas context not available');
        return;
    }
    
    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 3D構造の場合のみ方向別表示
    const dofPerNode = nodes.length > 0 ? (memberForces.length > 0 ? 6 : 3) : 3;
    const is3D = dofPerNode === 6;
    
    if (!is3D) {
        // 2D構造の場合は従来の表示
        drawStressDiagram(canvas, nodes, members, memberForces, stressType, title);
        return;
    }
    
    // 方向別応力図の定義
    const directionalStresses = [
        { axis: 'x', label: 'X軸', color: '#ff0000', title: `${title} - X軸方向` },
        { axis: 'y', label: 'Y軸', color: '#00ff00', title: `${title} - Y軸方向` },
        { axis: 'z', label: 'Z軸', color: '#0000ff', title: `${title} - Z軸方向` }
    ];
    
    // 既存のキャンバスサイズを維持
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // レイアウト設定（キャンバスサイズに合わせて調整）
    const diagramPadding = 40;
    const headerHeight = 80;
    const availableWidth = canvasWidth - diagramPadding * 2;
    const availableHeight = canvasHeight - headerHeight - diagramPadding * 2;
    const diagramWidth = Math.floor(availableWidth / directionalStresses.length) - diagramPadding;
    const diagramHeight = availableHeight;
    
    // 応力の最大値を計算
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];
        
        directionalStresses.forEach(({ axis }) => {
            if (stressType === 'moment') {
                const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                const start = convertMomentForDiagram(Mi, 'i');
                const end = convertMomentForDiagram(Mj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            } else if (stressType === 'shear') {
                const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                const start = convertShearForDiagram(Qi, 'i');
                const end = convertShearForDiagram(Qj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            }
        });
    });
    
    if (maxStress < 0.001) {
        ctx.fillStyle = '#666';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('応力が検出されませんでした', totalWidth / 2, totalHeight / 2);
        return;
    }
    
    // スケール設定
    const maxOffsetModelUnits = Math.min(diagramWidth, diagramHeight) * 0.3;
    const stressScale = maxOffsetModelUnits / maxStress;
    
    // 各方向の応力図を描画
    directionalStresses.forEach((direction, index) => {
        const x = diagramPadding + index * (diagramWidth + diagramPadding);
        const y = headerHeight + diagramPadding;
        
        // 方向のタイトルを描画
        ctx.fillStyle = direction.color;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(direction.title, x + diagramWidth / 2, y - 20);
        
        // 座標変換関数（モデル座標を画面座標に変換）
        const transform = (modelX, modelY) => {
            // モデル座標を画面座標に変換
            const screenX = x + diagramWidth / 2 + modelX;
            const screenY = y + diagramHeight / 2 - modelY;
            return { x: screenX, y: screenY };
        };
        
        // 部材を描画
        members.forEach((m, memberIndex) => {
            if (!memberForces[memberIndex]) return;
            
            const nodeI = nodes[m.i];
            const nodeJ = nodes[m.j];
            const forces = memberForces[memberIndex];
            
            // 部材の長さ
            const L = Math.sqrt(
                Math.pow(nodeJ.x - nodeI.x, 2) + 
                Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) + 
                Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
            );
            
            if (L < 0.001) return;
            
            // 応力図を描画（部材を20分割）
            const numDivisions = 20;
            const stressPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;
                
                if (stressType === 'moment') {
                    stressValue = calculateMemberMomentForAxis(forces, L, xi, direction.axis, null);
                } else if (stressType === 'shear') {
                    stressValue = calculateMemberShearForAxis(forces, L, xi, direction.axis, null);
                }
                
                const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
                
                // 部材上の位置（3D座標）
                const pos_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
                const pos_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
                const pos_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
                
                // 3D座標を2D投影（等角投影を使用）
                const projected = project3DTo2D({ x: pos_x, y: pos_y, z: pos_z }, 'iso');
                
                stressPoints.push({
                    x: projected.x,
                    y: projected.y,
                    z: pos_z,
                    value: finiteStressValue,
                    offset: finiteStressValue * stressScale
                });
            }
            
            // 応力図を塗りつぶし
            const positiveFillColor = 'rgba(255, 100, 100, 0.5)';
            const negativeFillColor = 'rgba(100, 100, 255, 0.5)';
            
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            
            // 各セグメントごとに台形を描画
            for (let k = 0; k < stressPoints.length - 1; k++) {
                const p1 = stressPoints[k];
                const p2 = stressPoints[k + 1];
                
                // 部材線上の点
                const base1 = transform(p1.x, p1.y);
                const base2 = transform(p2.x, p2.y);
                
                // 応力図の点（垂直方向にオフセット）
                const offset1 = transform(p1.x, p1.y + p1.offset);
                const offset2 = transform(p2.x, p2.y + p2.offset);
                
                // 塗りつぶし色を決定
                const avgValue = (p1.value + p2.value) / 2;
                ctx.fillStyle = avgValue >= 0 ? positiveFillColor : negativeFillColor;
                
                // 台形を描画
                ctx.beginPath();
                ctx.moveTo(base1.x, base1.y);
                ctx.lineTo(offset1.x, offset1.y);
                ctx.lineTo(offset2.x, offset2.y);
                ctx.lineTo(base2.x, base2.y);
                ctx.closePath();
                ctx.fill();
                
                // 境界線を描画
                ctx.strokeStyle = direction.color;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            
            ctx.restore();
            
            // 部材線を描画（3D座標を2D投影）
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const startNode = project3DTo2D({ x: nodeI.x, y: nodeI.y || 0, z: nodeI.z || 0 }, 'iso');
            const endNode = project3DTo2D({ x: nodeJ.x, y: nodeJ.y || 0, z: nodeJ.z || 0 }, 'iso');
            const start = transform(startNode.x, startNode.y);
            const end = transform(endNode.x, endNode.y);
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            
            // 最大応力位置をマーカー表示
            let maxValue = 0;
            let maxIndex = 0;
            stressPoints.forEach((point, idx) => {
                if (Math.abs(point.value) > Math.abs(maxValue)) {
                    maxValue = point.value;
                    maxIndex = idx;
                }
            });
            
            if (Math.abs(maxValue) > 0.001) {
                const maxPoint = stressPoints[maxIndex];
                const maxScreen = transform(maxPoint.x, maxPoint.y + maxPoint.offset);
                
                // マーカーを描画
                ctx.fillStyle = direction.color;
                ctx.beginPath();
                ctx.arc(maxScreen.x, maxScreen.y, 6, 0, 2 * Math.PI);
                ctx.fill();
                
                // 値を表示
                ctx.fillStyle = '#000';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(maxValue.toFixed(2), maxScreen.x, maxScreen.y - 15);
            }
        });
        
        // スケール表示
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`最大応力: ${maxStress.toFixed(2)}`, x + 10, y + diagramHeight - 10);
    });
};

// 部材直交軸応力図描画関数
const drawMemberOrthogonalStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    console.log('🎨 drawMemberOrthogonalStressDiagram called:', { 
        stressType, 
        title, 
        canvas: !!canvas,
        nodes: nodes?.length,
        members: members?.length,
        memberForces: memberForces?.length
    });
    
    if (!canvas) {
        console.warn('⚠️ Canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('⚠️ Canvas context not available');
        return;
    }
    
    console.log('🔍 キャンバス情報:', { 
        width: canvas.width, 
        height: canvas.height,
        styleWidth: canvas.style.width,
        styleHeight: canvas.style.height
    });
    
    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 3D構造の場合のみ部材直交軸表示
    const dofPerNode = nodes.length > 0 ? (memberForces.length > 0 ? 6 : 3) : 3;
    const is3D = dofPerNode === 6;
    
    console.log('🔍 構造判定:', { dofPerNode, is3D });
    
    if (!is3D) {
        console.log('📐 2D構造: 従来の表示を使用');
        // 2D構造の場合は従来の表示
        drawStressDiagram(canvas, nodes, members, memberForces, stressType, title);
        return;
    }
    
    // 部材直交軸の定義
    const orthogonalAxes = [
        { axis: 'y', label: 'Y\'軸（部材直交）', color: '#00ff00', title: `${title} - Y\'軸方向` },
        { axis: 'z', label: 'Z\'軸（部材直交）', color: '#0000ff', title: `${title} - Z\'軸方向` }
    ];
    
    // 既存のキャンバスサイズを維持
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // レイアウト設定（キャンバスサイズに合わせて調整）
    const diagramPadding = 40;
    const headerHeight = 80;
    const availableWidth = canvasWidth - diagramPadding * 2;
    const availableHeight = canvasHeight - headerHeight - diagramPadding * 2;
    const diagramWidth = Math.floor(availableWidth / orthogonalAxes.length) - diagramPadding;
    const diagramHeight = availableHeight;
    
    // 応力の最大値を計算
    let maxStress = 0;
    console.log('🔍 応力計算開始:', { members: members.length, memberForces: memberForces.length });
    
    members.forEach((m, idx) => {
        if (!memberForces[idx]) {
            console.warn(`⚠️ 部材${idx + 1}の応力データがありません`);
            return;
        }
        const forces = memberForces[idx];
        
        orthogonalAxes.forEach(({ axis }) => {
            if (stressType === 'moment') {
                const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                const start = convertMomentForDiagram(Mi, 'i');
                const end = convertMomentForDiagram(Mj, 'j');
                const stress = Math.max(Math.abs(start), Math.abs(end));
                maxStress = Math.max(maxStress, stress);
                
                if (idx === 0) {
                    console.log(`🔍 部材${idx + 1} ${axis}軸モーメント:`, { Mi, Mj, start, end, stress });
                }
            } else if (stressType === 'shear') {
                const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                const start = convertShearForDiagram(Qi, 'i');
                const end = convertShearForDiagram(Qj, 'j');
                const stress = Math.max(Math.abs(start), Math.abs(end));
                maxStress = Math.max(maxStress, stress);
                
                if (idx === 0) {
                    console.log(`🔍 部材${idx + 1} ${axis}軸せん断力:`, { Qi, Qj, start, end, stress });
                }
            }
        });
    });
    
    console.log('🔍 最大応力:', maxStress);
    
    if (maxStress < 0.001) {
        ctx.fillStyle = '#666';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('応力が検出されませんでした', canvasWidth / 2, canvasHeight / 2);
        return;
    }
    
    // スケール設定
    const maxOffsetModelUnits = Math.min(diagramWidth, diagramHeight) * 0.3;
    const stressScale = maxOffsetModelUnits / maxStress;
    
    // 各直交軸の応力図を描画
    orthogonalAxes.forEach((direction, index) => {
        const x = diagramPadding + index * (diagramWidth + diagramPadding);
        const y = headerHeight + diagramPadding;
        
        // 方向のタイトルを描画
        ctx.fillStyle = direction.color;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(direction.title, x + diagramWidth / 2, y - 20);
        
        // 座標変換関数（モデル座標を画面座標に変換）
        const transform = (modelX, modelY) => {
            const screenX = x + diagramWidth / 2 + modelX;
            const screenY = y + diagramHeight / 2 - modelY;
            return { x: screenX, y: screenY };
        };
        
        // 部材を描画
        members.forEach((m, memberIndex) => {
            if (!memberForces[memberIndex]) return;
            
            const nodeI = nodes[m.i];
            const nodeJ = nodes[m.j];
            const forces = memberForces[memberIndex];
            
            // 部材の長さ
            const L = Math.sqrt(
                Math.pow(nodeJ.x - nodeI.x, 2) + 
                Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) + 
                Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
            );
            
            if (L < 0.001) return;
            
            // 応力図を描画（部材を20分割）
            const numDivisions = 20;
            const stressPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;
                
                if (stressType === 'moment') {
                    stressValue = calculateMemberMomentForAxis(forces, L, xi, direction.axis, null);
                } else if (stressType === 'shear') {
                    stressValue = calculateMemberShearForAxis(forces, L, xi, direction.axis, null);
                }
                
                const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
                
                // 部材上の位置（3D座標）
                const pos_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
                const pos_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
                const pos_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
                
                // 3D座標を2D投影（等角投影を使用）
                const projected = project3DTo2D({ x: pos_x, y: pos_y, z: pos_z }, 'iso');
                
                stressPoints.push({
                    x: projected.x,
                    y: projected.y,
                    z: pos_z,
                    value: finiteStressValue,
                    offset: finiteStressValue * stressScale
                });
            }
            
            // 応力図を塗りつぶし
            const positiveFillColor = 'rgba(255, 100, 100, 0.5)';
            const negativeFillColor = 'rgba(100, 100, 255, 0.5)';
            
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            
            // 各セグメントごとに台形を描画
            for (let k = 0; k < stressPoints.length - 1; k++) {
                const p1 = stressPoints[k];
                const p2 = stressPoints[k + 1];
                
                // 部材線上の点
                const base1 = transform(p1.x, p1.y);
                const base2 = transform(p2.x, p2.y);
                
                // 応力図の点（垂直方向にオフセット）
                const offset1 = transform(p1.x, p1.y + p1.offset);
                const offset2 = transform(p2.x, p2.y + p2.offset);
                
                // 塗りつぶし色を決定
                const avgValue = (p1.value + p2.value) / 2;
                ctx.fillStyle = avgValue >= 0 ? positiveFillColor : negativeFillColor;
                
                // 台形を描画
                ctx.beginPath();
                ctx.moveTo(base1.x, base1.y);
                ctx.lineTo(offset1.x, offset1.y);
                ctx.lineTo(offset2.x, offset2.y);
                ctx.lineTo(base2.x, base2.y);
                ctx.closePath();
                ctx.fill();
                
                // 境界線を描画
                ctx.strokeStyle = direction.color;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            
            ctx.restore();
            
            // 部材線を描画（3D座標を2D投影）
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const startNode = project3DTo2D({ x: nodeI.x, y: nodeI.y || 0, z: nodeI.z || 0 }, 'iso');
            const endNode = project3DTo2D({ x: nodeJ.x, y: nodeJ.y || 0, z: nodeJ.z || 0 }, 'iso');
            const start = transform(startNode.x, startNode.y);
            const end = transform(endNode.x, endNode.y);
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            
            // 最大応力位置をマーカー表示
            let maxValue = 0;
            let maxIndex = 0;
            stressPoints.forEach((point, idx) => {
                if (Math.abs(point.value) > Math.abs(maxValue)) {
                    maxValue = point.value;
                    maxIndex = idx;
                }
            });
            
            if (Math.abs(maxValue) > 0.001) {
                const maxPoint = stressPoints[maxIndex];
                const maxScreen = transform(maxPoint.x, maxPoint.y + maxPoint.offset);
                
                // マーカーを描画
                ctx.fillStyle = direction.color;
                ctx.beginPath();
                ctx.arc(maxScreen.x, maxScreen.y, 6, 0, 2 * Math.PI);
                ctx.fill();
                
                // 値を表示
                ctx.fillStyle = '#000';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(maxValue.toFixed(2), maxScreen.x, maxScreen.y - 15);
            }
        });
        
        // スケール表示
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`最大応力: ${maxStress.toFixed(2)}`, x + 10, y + diagramHeight - 10);
    });
};

// 部材の局所座標系を計算する関数
const calculateMemberLocalAxes = (nodeI, nodeJ) => {
    const dx = nodeJ.x - nodeI.x;
    const dy = (nodeJ.y || 0) - (nodeI.y || 0);
    const dz = (nodeJ.z || 0) - (nodeI.z || 0);
    const L = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (L < 1e-9) {
        return { localX: { x: 1, y: 0, z: 0 }, localY: { x: 0, y: 1, z: 0 }, localZ: { x: 0, y: 0, z: 1 } };
    }
    
    // X'軸（部材軸方向）
    const localX = { x: dx / L, y: dy / L, z: dz / L };
    
    // Y'軸とZ'軸の決定
    let localY, localZ;
    const cz = localX.z;
    
    if (Math.abs(cz) < 0.9) {
        // 部材が垂直でない場合、Z'軸を水平面に投影した方向を基準
        const temp = Math.sqrt(localX.x*localX.x + localX.y*localX.y);
        localZ = { x: -cz*localX.x/temp, y: -cz*localX.y/temp, z: temp };
        const len_localZ = Math.sqrt(localZ.x*localZ.x + localZ.y*localZ.y + localZ.z*localZ.z);
        localZ = { x: localZ.x/len_localZ, y: localZ.y/len_localZ, z: localZ.z/len_localZ };
        
        // Y'軸 = Z'軸 × X'軸
        localY = {
            x: localZ.y*localX.z - localZ.z*localX.y,
            y: localZ.z*localX.x - localZ.x*localX.z,
            z: localZ.x*localX.y - localZ.y*localX.x
        };
    } else {
        // 部材がほぼ垂直の場合、Y軸を基準
        localY = { x: 0, y: 1, z: 0 };
        localZ = {
            x: localX.y*0 - localX.z*1,
            y: localX.z*0 - localX.x*0,
            z: localX.x*1 - localX.y*0
        };
        const len_localZ = Math.sqrt(localZ.x*localZ.x + localZ.y*localZ.y + localZ.z*localZ.z);
        if (len_localZ > 1e-6) {
            localZ = { x: localZ.x/len_localZ, y: localZ.y/len_localZ, z: localZ.z/len_localZ };
        }
    }
    
    return { localX, localY, localZ };
};

// 改善された部材直交軸応力図描画関数
const drawImprovedMemberOrthogonalStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    console.log('🎨 drawImprovedMemberOrthogonalStressDiagram called:', { stressType, title });
    
    if (!canvas) {
        console.warn('⚠️ Canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('⚠️ Canvas context not available');
        return;
    }
    
    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 3D構造の場合のみ部材直交軸表示
    const dofPerNode = nodes.length > 0 ? (memberForces.length > 0 ? 6 : 3) : 3;
    const is3D = dofPerNode === 6;
    
    if (!is3D) {
        console.log('📐 2D構造: 従来の表示を使用');
        drawStressDiagram(canvas, nodes, members, memberForces, stressType, title);
        return;
    }
    
    // 部材直交軸の定義
    const orthogonalAxes = [
        { axis: 'y', label: 'Y\'軸（部材直交）', color: '#00ff00', title: `${title} - Y\'軸方向` },
        { axis: 'z', label: 'Z\'軸（部材直交）', color: '#0000ff', title: `${title} - Z\'軸方向` }
    ];
    
    // キャンバスサイズを取得（初期化されていない場合はデフォルト値を使用）
    const canvasWidth = canvas.width || 1200;
    const canvasHeight = canvas.height || 900;
    
    // レイアウト設定
    const diagramPadding = 40;
    const headerHeight = 80;
    const availableWidth = canvasWidth - diagramPadding * 2;
    const availableHeight = canvasHeight - headerHeight - diagramPadding * 2;
    const diagramWidth = Math.floor(availableWidth / orthogonalAxes.length) - diagramPadding;
    const diagramHeight = availableHeight;
    
    // キャンバスサイズが0の場合はデフォルト値に設定
    if (canvasWidth === 0 || canvasHeight === 0) {
        canvas.width = 1200;
        canvas.height = 900;
        canvas.style.width = '1200px';
        canvas.style.height = '900px';
    }
    
    console.log('🔍 レイアウト情報:', { canvasWidth, canvasHeight, diagramWidth, diagramHeight });
    
    // 応力の最大値を計算
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];
        
        orthogonalAxes.forEach(({ axis }) => {
            if (stressType === 'moment') {
                const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                const start = convertMomentForDiagram(Mi, 'i');
                const end = convertMomentForDiagram(Mj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            } else if (stressType === 'shear') {
                const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                const start = convertShearForDiagram(Qi, 'i');
                const end = convertShearForDiagram(Qj, 'j');
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            }
        });
    });
    
    if (maxStress < 0.001) {
        ctx.fillStyle = '#666';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('応力が検出されませんでした', canvasWidth / 2, canvasHeight / 2);
        return;
    }
    
    // スケール設定
    const maxOffsetModelUnits = Math.min(diagramWidth, diagramHeight) * 0.3;
    const stressScale = maxOffsetModelUnits / maxStress;
    
    console.log('🔍 応力スケール:', { maxStress, stressScale });
    
    // 各直交軸の応力図を描画
    orthogonalAxes.forEach((direction, index) => {
        const x = diagramPadding + index * (diagramWidth + diagramPadding);
        const y = headerHeight + diagramPadding;
        
        // 方向のタイトルを描画
        ctx.fillStyle = direction.color;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(direction.title, x + diagramWidth / 2, y - 20);
        
        // 座標変換関数（モデル座標を画面座標に変換）
        const transform = (modelX, modelY) => {
            // モデル座標を画面座標に変換（スケール調整）
            const scale = Math.min(diagramWidth, diagramHeight) * 0.4; // スケールファクター
            const screenX = x + diagramWidth / 2 + modelX * scale;
            const screenY = y + diagramHeight / 2 - modelY * scale;
            return { x: screenX, y: screenY };
        };
        
        // 部材を描画
        members.forEach((m, memberIndex) => {
            if (!memberForces[memberIndex]) return;
            
            const nodeI = nodes[m.i];
            const nodeJ = nodes[m.j];
            const forces = memberForces[memberIndex];
            
            // 部材の局所座標系を計算
            const { localX, localY, localZ } = calculateMemberLocalAxes(nodeI, nodeJ);
            
            // 部材の長さ
            const L = Math.sqrt(
                Math.pow(nodeJ.x - nodeI.x, 2) + 
                Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) + 
                Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
            );
            
            if (L < 0.001) return;
            
            // 応力図を描画（部材を20分割）
            const numDivisions = 20;
            const stressPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;
                
                if (stressType === 'moment') {
                    stressValue = calculateMemberMomentForAxis(forces, L, xi, direction.axis, null);
                } else if (stressType === 'shear') {
                    stressValue = calculateMemberShearForAxis(forces, L, xi, direction.axis, null);
                }
                
                const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
                
                // 部材上の位置（3D座標）
                const pos_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
                const pos_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
                const pos_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
                
                // 3D座標を2D投影（等角投影を使用）
                const projected = project3DTo2D({ x: pos_x, y: pos_y, z: pos_z }, 'iso');
                
                stressPoints.push({
                    x: projected.x,
                    y: projected.y,
                    z: pos_z,
                    value: finiteStressValue,
                    offset: finiteStressValue * stressScale
                });
            }
            
            // 応力図を塗りつぶし
            const positiveFillColor = 'rgba(255, 100, 100, 0.5)';
            const negativeFillColor = 'rgba(100, 100, 255, 0.5)';
            
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            
            // 各セグメントごとに台形を描画
            for (let k = 0; k < stressPoints.length - 1; k++) {
                const p1 = stressPoints[k];
                const p2 = stressPoints[k + 1];
                
                // 部材線上の点
                const base1 = transform(p1.x, p1.y);
                const base2 = transform(p2.x, p2.y);
                
                // 応力図の点（垂直方向にオフセット）
                const offset1 = transform(p1.x, p1.y + p1.offset);
                const offset2 = transform(p2.x, p2.y + p2.offset);
                
                // 塗りつぶし色を決定
                const avgValue = (p1.value + p2.value) / 2;
                ctx.fillStyle = avgValue >= 0 ? positiveFillColor : negativeFillColor;
                
                // 台形を描画
                ctx.beginPath();
                ctx.moveTo(base1.x, base1.y);
                ctx.lineTo(offset1.x, offset1.y);
                ctx.lineTo(offset2.x, offset2.y);
                ctx.lineTo(base2.x, base2.y);
                ctx.closePath();
                ctx.fill();
                
                // 境界線を描画
                ctx.strokeStyle = direction.color;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            
            ctx.restore();
            
            // 部材線を描画（3D座標を2D投影）
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const startNode = project3DTo2D({ x: nodeI.x, y: nodeI.y || 0, z: nodeI.z || 0 }, 'iso');
            const endNode = project3DTo2D({ x: nodeJ.x, y: nodeJ.y || 0, z: nodeJ.z || 0 }, 'iso');
            const start = transform(startNode.x, startNode.y);
            const end = transform(endNode.x, endNode.y);
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            
            // 最大応力位置をマーカー表示
            let maxValue = 0;
            let maxIndex = 0;
            stressPoints.forEach((point, idx) => {
                if (Math.abs(point.value) > Math.abs(maxValue)) {
                    maxValue = point.value;
                    maxIndex = idx;
                }
            });
            
            if (Math.abs(maxValue) > 0.001) {
                const maxPoint = stressPoints[maxIndex];
                const maxScreen = transform(maxPoint.x, maxPoint.y + maxPoint.offset);
                
                // マーカーを描画
                ctx.fillStyle = direction.color;
                ctx.beginPath();
                ctx.arc(maxScreen.x, maxScreen.y, 6, 0, 2 * Math.PI);
                ctx.fill();
                
                // 値を表示
                ctx.fillStyle = '#000';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(maxValue.toFixed(2), maxScreen.x, maxScreen.y - 15);
            }
        });
        
        // スケール表示
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`最大応力: ${maxStress.toFixed(2)}`, x + 10, y + diagramHeight - 10);
    });
};

// 第2軸応力図描画関数（第1軸と同様の描画方式を使用）
const drawSecondaryAxisStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    console.log('🎨 drawSecondaryAxisStressDiagram called:', { stressType, title });
    
    if (!canvas) {
        console.warn('⚠️ Canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('⚠️ Canvas context not available');
        return;
    }
    
    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 3D構造の場合のみ第2軸表示
    const dofPerNode = nodes.length > 0 ? (memberForces.length > 0 ? 6 : 3) : 3;
    const is3D = dofPerNode === 6;
    
    if (!is3D) {
        console.log('📐 2D構造: 第2軸表示は不要');
        return;
    }
    
    // 現在の投影モードを取得
    const projectionMode = getCurrentProjectionMode();
    
    // 現在表示されている軸と第2軸を決定
    let currentAxis, secondaryAxis, secondaryTitle;
    
    if (projectionMode === 'xy') {
        currentAxis = 'z'; // 現在表示: Z軸周り
        secondaryAxis = 'y'; // 第2軸: Y軸周り
        secondaryTitle = `${title} - My (Y軸周り)`;
    } else if (projectionMode === 'xz') {
        currentAxis = 'y'; // 現在表示: Y軸周り
        secondaryAxis = 'z'; // 第2軸: Z軸周り
        secondaryTitle = `${title} - Mz (Z軸周り)`;
    } else if (projectionMode === 'yz') {
        currentAxis = 'x'; // 現在表示: X軸周り
        secondaryAxis = 'z'; // 第2軸: Z軸周り
        secondaryTitle = `${title} - Mz (Z軸周り)`;
    } else {
        // 等角投影の場合は第2軸としてZ軸を表示
        currentAxis = 'y'; // 現在表示: Y軸周り
        secondaryAxis = 'z'; // 第2軸: Z軸周り
        secondaryTitle = `${title} - Mz (Z軸周り)`;
    }
    
    console.log('🔍 軸選択:', { projectionMode, currentAxis, secondaryAxis });
    
    // 第1軸と同じレイアウト/描画スタイルに揃える
    const projectionModes = ['iso'];
    const frameData = [];
    projectionModes.forEach(mode => {
        if (mode === 'iso') frameData.push({ mode: 'iso', coord: 0 });
    });

    if (frameData.length === 0) return;

    // drawStressDiagram と同じ固定サイズ
    const frameWidth = 1200;
    const frameHeight = 900;
    const framePadding = 40;
    const headerHeight = 80;

    const totalWidth = frameData.length * (frameWidth + framePadding) + framePadding;
    const totalHeight = frameHeight + headerHeight + framePadding * 2;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = totalHeight + 'px';
    ctx.scale(dpr, dpr);

    // 応力の最大値を計算（スケール決定用）
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];

        if (stressType === 'moment') {
            const { Mi, Mj } = getMomentComponentsForAxis(forces, secondaryAxis);
            const start = convertMomentForDiagram(Mi, 'i');
            const end = convertMomentForDiagram(Mj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        } else if (stressType === 'axial') {
            const { Ni, Nj } = getAxialComponents(forces);
            const start = convertAxialForDiagram(Ni, 'i');
            const end = convertAxialForDiagram(Nj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        } else if (stressType === 'shear') {
            const { Qi, Qj } = getShearComponentsForAxis(forces, secondaryAxis);
            const start = convertShearForDiagram(Qi, 'i');
            const end = convertShearForDiagram(Qj, 'j');
            maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
        }
    });

    // 応力図のスケール（第1軸と同じ係数）
    const maxStressPixels = Math.min(frameWidth, frameHeight) * 0.06;
    let baseStressScale = maxStress > 0 ? maxStressPixels / maxStress : 1;

    frameData.forEach((frame, index) => {
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // タイトル（第1軸と同じ位置に表示）
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('等角投影図', x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(secondaryTitle, x + frameWidth / 2, framePadding + 50);

        // 背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 枠線
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        // iso は全節点/全要素
        const visibleNodes = new Set();
        nodes.forEach((_, idx) => visibleNodes.add(idx));
        const visibleMembers = members.filter(m => visibleNodes.has(m.i) && visibleNodes.has(m.j));

        if (visibleMembers.length === 0) {
            ctx.restore();
            return;
        }

        // モデル範囲（第1軸と同じ計算）
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        visibleMembers.forEach(m => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        const margin = 40;
        const drawWidth = frameWidth - 2 * margin;
        const drawHeight = frameHeight - 2 * margin;

        let modelScale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            modelScale = Math.min(drawWidth / modelWidth, drawHeight / modelHeight) * 0.9;
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = x + frameWidth / 2;
        const offsetY = y + frameHeight / 2;

        const transform = (px, py) => ({
            x: offsetX + (px - centerX) * modelScale,
            y: offsetY - (py - centerY) * modelScale
        });

        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        visibleNodes.forEach(idx => {
            const node = nodes[idx];
            const projected = project3DTo2D(node, frame.mode);
            const pos = transform(projected.x, projected.y);
            nodeScreenData.push({ nodeIndex: idx, x: pos.x, y: pos.y });
            registerCircleObstacle(labelObstacles, pos.x, pos.y, 4);
        });

        // 枠外にはみ出さないよう、許容スケール上限を算出（第1軸と同等の考え方）
        const EPS = 1e-9;
        let scaleLimit = Infinity;
        visibleMembers.forEach(m => {
            if (scaleLimit <= EPS) return;
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1 || !memberForces[memberIndex]) return;

            const forces = memberForces[memberIndex];
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);

            const L = Math.sqrt(
                Math.pow(nj.x - ni.x, 2) +
                Math.pow((nj.y || 0) - (ni.y || 0), 2) +
                Math.pow((nj.z || 0) - (ni.z || 0), 2)
            );
            if (!isFinite(L) || L < EPS) return;

            const distributedLoad = getDistributedLoadForAxis(forces, secondaryAxis);
            const numDivisions = 20;

            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;

                if (stressType === 'moment') {
                    stressValue = calculateMemberMomentForAxis(forces, L, xi, secondaryAxis, distributedLoad);
                } else if (stressType === 'axial') {
                    stressValue = calculateMemberAxial(forces, xi);
                } else if (stressType === 'shear') {
                    stressValue = calculateMemberShearForAxis(forces, L, xi, secondaryAxis, distributedLoad);
                }

                const absStress = Math.abs(stressValue);
                if (absStress < EPS) continue;

                const pos_x = pi.x + (pj.x - pi.x) * xi;
                const pos_y = pi.y + (pj.y - pi.y) * xi;
                const p = transform(pos_x, pos_y);

                const distToLeft = p.x - x;
                const distToRight = (x + frameWidth) - p.x;
                const distToTop = p.y - y;
                const distToBottom = (y + frameHeight) - p.y;
                const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

                if (minDist <= EPS) {
                    scaleLimit = 0;
                    return;
                }

                const candidateScale = minDist / absStress;
                if (candidateScale < scaleLimit) scaleLimit = candidateScale;
            }
        });

        let stressScale = baseStressScale;
        if (scaleLimit < Infinity) {
            stressScale = Math.min(stressScale, scaleLimit * 0.95);
        }

        // 元の構造（グレー）＋ラベル用の法線/接線
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1) return;
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
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
                memberIndex,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                tangent: { x: dx / length, y: dy / length },
                normal: { x: -dy / length, y: dx / length }
            });
        });

        // 応力図（塗り/輪郭/値表示）
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1 || !memberForces[memberIndex]) return;

            const forces = memberForces[memberIndex];
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);

            const L = Math.sqrt(
                Math.pow(nj.x - ni.x, 2) +
                Math.pow((nj.y || 0) - (ni.y || 0), 2) +
                Math.pow((nj.z || 0) - (ni.z || 0), 2)
            );
            if (!isFinite(L) || L <= 1e-9) return;

            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length === 0) return;

            const perpX = -dy / length;
            const perpY = dx / length;

            const distributedLoad = getDistributedLoadForAxis(forces, secondaryAxis);
            const numDivisions = 20;
            const stressPoints = [];

            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;

                if (stressType === 'moment') {
                    stressValue = calculateMemberMomentForAxis(forces, L, xi, secondaryAxis, distributedLoad);
                } else if (stressType === 'axial') {
                    stressValue = calculateMemberAxial(forces, xi);
                } else if (stressType === 'shear') {
                    stressValue = calculateMemberShearForAxis(forces, L, xi, secondaryAxis, distributedLoad);
                }

                const finiteStressValue = Number.isFinite(stressValue) ? stressValue : 0;
                const pos_x = pi.x + (pj.x - pi.x) * xi;
                const pos_y = pi.y + (pj.y - pi.y) * xi;
                const p = transform(pos_x, pos_y);
                stressPoints.push({
                    x: p.x,
                    y: p.y,
                    value: finiteStressValue,
                    offset: finiteStressValue * stressScale
                });
            }

            const positiveFillColor = 'rgba(255, 100, 100, 0.5)';
            const negativeFillColor = 'rgba(100, 100, 255, 0.5)';

            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';

            for (let k = 0; k < stressPoints.length - 1; k++) {
                const p1 = stressPoints[k];
                const p2 = stressPoints[k + 1];
                if (Math.abs(p1.value) < 1e-9 && Math.abs(p2.value) < 1e-9) continue;

                const avgValue = (p1.value + p2.value) / 2;
                const fillColor = avgValue >= 0 ? positiveFillColor : negativeFillColor;

                const offset1 = Number.isFinite(p1.offset) ? p1.offset : 0;
                const offset2 = Number.isFinite(p2.offset) ? p2.offset : 0;
                const off1X = p1.x + perpX * offset1;
                const off1Y = p1.y - perpY * offset1;
                const off2X = p2.x + perpX * offset2;
                const off2Y = p2.y - perpY * offset2;

                ctx.fillStyle = fillColor;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(off2X, off2Y);
                ctx.lineTo(off1X, off1Y);
                ctx.closePath();
                ctx.fill();
            }

            ctx.restore();

            ctx.strokeStyle = 'red';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let k = 0; k <= numDivisions; k++) {
                const p = stressPoints[k];
                const px = Math.max(x, Math.min(x + drawWidth, p.x + perpX * p.offset));
                const py = Math.max(y, Math.min(y + drawHeight, p.y - perpY * p.offset));
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            let maxAbsValue = 0;
            let maxAbsIndex = 0;
            stressPoints.forEach((p, idx) => {
                if (Math.abs(p.value) > maxAbsValue) {
                    maxAbsValue = Math.abs(p.value);
                    maxAbsIndex = idx;
                }
            });

            const p1 = stressPoints[0];
            const pN = stressPoints[numDivisions];

            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.lineWidth = 5;

            if (Math.abs(p1.value) > 0.01) {
                const startValueText = p1.value.toFixed(2);
                const baseX = p1.x + perpX * p1.offset;
                const baseY = p1.y - perpY * p1.offset - 8;
                drawTextWithPlacement(ctx, startValueText, baseX, baseY, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: '#000',
                    padding: 14
                });
            }

            if (Math.abs(pN.value) > 0.01) {
                const endValueText = pN.value.toFixed(2);
                const baseX = pN.x + perpX * pN.offset;
                const baseY = pN.y - perpY * pN.offset - 8;
                drawTextWithPlacement(ctx, endValueText, baseX, baseY, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: '#000',
                    padding: 14
                });
            }

            if (maxAbsIndex > 0 && maxAbsIndex < numDivisions && maxAbsValue > 0.01) {
                const pMax = stressPoints[maxAbsIndex];
                const maxX = pMax.x + perpX * pMax.offset;
                const maxY = pMax.y - perpY * pMax.offset;

                ctx.fillStyle = pMax.value >= 0 ? 'red' : 'blue';
                ctx.beginPath();
                ctx.arc(maxX, maxY, 5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.font = 'bold 16px Arial';
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'white';
                const maxText = `Max: ${pMax.value.toFixed(2)}`;
                const fillColor = pMax.value >= 0 ? '#cc0000' : '#0000cc';
                drawTextWithPlacement(ctx, maxText, maxX, maxY - 12, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: fillColor,
                    padding: 16
                });
            }
        });

        // 節点/部材番号ラベル（第1軸と同じ）
        const nodeLabelOffsets = [
            { x: 0, y: 26 },
            { x: 24, y: 0 },
            { x: -24, y: 0 },
            { x: 0, y: -28 },
            { x: 28, y: -18 },
            { x: -28, y: -18 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 28, y: normal.y * 28 },
                { x: -normal.x * 28, y: -normal.y * 28 },
                { x: tangent.x * 30, y: tangent.y * 30 },
                { x: -tangent.x * 30, y: -tangent.y * 30 },
                { x: normal.x * 40, y: normal.y * 40 },
                { x: -normal.x * 40, y: -normal.y * 40 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
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

// グローバルスコープにdrawDisplacementDiagram関数を公開
window.drawDisplacementDiagram = drawDisplacementDiagram;
window.drawDirectionalStressDiagram = drawDirectionalStressDiagram;
window.drawMemberOrthogonalStressDiagram = drawMemberOrthogonalStressDiagram;
window.drawImprovedMemberOrthogonalStressDiagram = drawImprovedMemberOrthogonalStressDiagram;
window.drawSecondaryAxisStressDiagram = drawSecondaryAxisStressDiagram;
window.calculateMemberDeformation = calculateMemberDeformation;
window.getRatioColor = getRatioColor;
