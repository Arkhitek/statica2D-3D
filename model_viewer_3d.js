// model_viewer_3d.js - モデル図の3D表示機能

// モデル図3Dビューア用のグローバル変数（windowスコープ共有のためvarを使用）
var modelScene = null;
var modelCamera = null;
var modelRenderer = null;
var modelControls = null;
var modelAnimationFrameId = null;

var modelLabelRenderer = null; // CSS2DRenderer for labels
var modelNodeLabelsGroup = null;
var modelMemberLabelsGroup = null;
var modelRaycaster = null;
var modelMouse = null;
var modelNodeMeshes = [];  // 節点メッシュの配列
var modelMemberMeshes = []; // 部材メッシュの配列
var modelSelectedNode = null;
var modelSelectedMember = null;
var modelFirstMemberNode = null;
var modelGridHelper = null;
var modelContainerResizeObserver = null; // コンテナのリサイズ監視用
var modelLastKnownSize = { width: 0, height: 0 }; // 最後に認識したコンテナサイズ
var modelAxisHelper = null; // 座標軸ヘルパー用のカメラとシーン
var modelAxisScene = null;
var modelAxisCamera = null;
var modelAxisRenderer = null;

if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded - 3D model view will not be available');
}

const MODEL_AXIS_CANVAS_SIZE = 120;
const MODEL_AXIS_MARGIN = 15;

const MODEL_SUPPORT_ALIAS_ENTRIES = [
    { target: 'free', aliases: ['f', 'free', '自由'] },
    { target: 'pinned', aliases: ['p', 'pin', 'pinned', 'hinge', 'hinged', 'ピン'] },
    { target: 'fixed', aliases: ['x', 'fix', 'fixed', '固定'] },
    { target: 'roller-x', aliases: ['roller-x', 'roller_x', 'rollerx', 'r-x', 'rx', 'ローラーx', 'ローラー(x)', 'ローラー(X軸固定)'] },
    { target: 'roller-y', aliases: ['roller-y', 'roller_y', 'rollery', 'r-y', 'ry', 'ローラー', 'ローラーy', 'ローラー(y)', 'ローラー(Y軸固定)', 'r', 'roller'] },
    { target: 'roller-z', aliases: ['roller-z', 'roller_z', 'rollerz', 'r-z', 'rz', 'ローラーz', 'ローラー(z)', 'ローラー(Z軸固定)'] }
];

const MODEL_SUPPORT_ALIAS_MAP = (() => {
    const map = new Map();
    MODEL_SUPPORT_ALIAS_ENTRIES.forEach(({ target, aliases }) => {
        aliases.forEach(alias => {
            const key = `${alias}`.trim();
            if (!key) return;
            map.set(key, target);
            map.set(key.toLowerCase(), target);
        });
    });
    return map;
})();

function modelNormalizeSupportValue(value) {
    if (typeof normalizeSupportValue === 'function') {
        try {
            const normalized = normalizeSupportValue(value);
            if (normalized) {
                return normalized;
            }
        } catch (e) {
            // フォールバックに進む
        }
    }

    if (value === undefined || value === null) return 'free';
    const raw = `${value}`.trim();
    if (!raw) return 'free';
    return MODEL_SUPPORT_ALIAS_MAP.get(raw) || MODEL_SUPPORT_ALIAS_MAP.get(raw.toLowerCase()) || raw;
}

function modelIsRollerSupport(value) {
    const normalized = modelNormalizeSupportValue(value);
    return normalized === 'roller-x' || normalized === 'roller-y' || normalized === 'roller-z';
}

function modelGetRollerAxis(value) {
    const normalized = modelNormalizeSupportValue(value);
    if (normalized === 'roller-x') return 'x';
    if (normalized === 'roller-y') return 'y';
    if (normalized === 'roller-z') return 'z';
    return null;
}

const MODEL_ROLLER_AXIS_COLORS = Object.freeze({
    x: { int: 0xe53935, hex: '#e53935', label: 'ローラー(X軸固定)' },
    y: { int: 0x1e88e5, hex: '#1e88e5', label: 'ローラー(Y軸固定)' },
    z: { int: 0x00897b, hex: '#00897b', label: 'ローラー(Z軸固定)' }
});

function modelCreateAxisDirection(axis) {
    switch (axis) {
        case 'x':
            return new THREE.Vector3(1, 0, 0);
        case 'y':
            return new THREE.Vector3(0, 0, 1);
        case 'z':
            return new THREE.Vector3(0, 1, 0);
        default:
            return null;
    }
}

function addModelRollerSupportIndicator(group, position, axis) {
    if (!group || !position || !axis) return;
    const color = MODEL_ROLLER_AXIS_COLORS[axis] || MODEL_ROLLER_AXIS_COLORS.x;
    const markerGroup = new THREE.Group();
    markerGroup.position.copy(position);

    const braceMaterial = new THREE.MeshStandardMaterial({
        color: color.int,
        emissive: color.int,
        emissiveIntensity: 0.35,
        metalness: 0.45,
        roughness: 0.25,
        transparent: true,
        opacity: 0.8
    });

    const plateSpan = 0.75;
    const plateThickness = 0.16;
    let plateGeometry = null;
    const offset = new THREE.Vector3();

    switch (axis) {
        case 'x':
            plateGeometry = new THREE.BoxGeometry(plateThickness, plateSpan, plateSpan);
            offset.set(0.5, 0, 0);
            break;
        case 'y':
            plateGeometry = new THREE.BoxGeometry(plateSpan, plateSpan, plateThickness);
            offset.set(0, 0, 0.5);
            break;
        case 'z':
            plateGeometry = new THREE.BoxGeometry(plateSpan, plateThickness, plateSpan);
            offset.set(0, 0.5, 0);
            break;
        default:
            return;
    }

    if (!plateGeometry) return;

    const brace = new THREE.Mesh(plateGeometry, braceMaterial);
    brace.position.copy(offset);
    markerGroup.add(brace);

    const clampGeometry = new THREE.BoxGeometry(plateThickness * 0.6, plateSpan * 0.6, plateSpan * 0.6);
    const clampMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.6,
        transparent: true,
        opacity: 0.3
    });
    const clamp = new THREE.Mesh(clampGeometry, clampMaterial);
    clamp.position.copy(offset.clone().multiplyScalar(0.6));
    markerGroup.add(clamp);

    if (typeof THREE.CSS2DObject !== 'undefined') {
        const labelElement = document.createElement('div');
        labelElement.className = 'support-label-3d';
        labelElement.textContent = color.label || `ローラー(${axis.toUpperCase()}軸固定)`;
        labelElement.style.color = color.hex;
        labelElement.style.fontWeight = 'bold';
        labelElement.style.fontSize = '11px';
        labelElement.style.backgroundColor = 'rgba(255, 255, 255, 0.92)';
        labelElement.style.padding = '2px 6px';
        labelElement.style.borderRadius = '3px';
        labelElement.style.border = `1px solid ${color.hex}`;
        labelElement.style.pointerEvents = 'none';
        labelElement.style.userSelect = 'none';

        const labelObject = new THREE.CSS2DObject(labelElement);
        const labelDirection = offset.clone();
        if (labelDirection.lengthSq() === 0) {
            labelDirection.set(0, 1, 0);
        }
        const labelDistance = Math.max(1.0, offset.length() + 0.45);
        labelObject.position.copy(labelDirection.normalize().multiplyScalar(labelDistance));
        if (axis !== 'y') {
            labelObject.position.y += 0.25;
        }
        markerGroup.add(labelObject);
    }

    group.add(markerGroup);
}

/**
 * モデル図3Dシーンの初期化
 */
function initModel3DView() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js is not loaded');
        return false;
    }

    const container = document.getElementById('model-3d-container');
    if (!container) {
        console.error('Model 3D container not found');
        return false;
    }

    // 既存のシーンをクリア
    if (modelRenderer) {
        container.removeChild(modelRenderer.domElement);
        modelRenderer.dispose();
    }
    if (modelLabelRenderer) {
        // CSS2DRendererのDOM要素内のすべてのラベルを削除
        while (modelLabelRenderer.domElement.firstChild) {
            modelLabelRenderer.domElement.removeChild(modelLabelRenderer.domElement.firstChild);
        }
        container.removeChild(modelLabelRenderer.domElement);
    }
    if (modelAxisRenderer) {
        if (modelAxisRenderer.domElement && modelAxisRenderer.domElement.parentNode) {
            modelAxisRenderer.domElement.parentNode.removeChild(modelAxisRenderer.domElement);
        }
        modelAxisRenderer.dispose();
        modelAxisRenderer = null;
    }
    if (modelAnimationFrameId) {
        cancelAnimationFrame(modelAnimationFrameId);
    }
    if (modelContainerResizeObserver) {
        modelContainerResizeObserver.disconnect();
        modelContainerResizeObserver = null;
    }
    modelLastKnownSize = { width: 0, height: 0 };

    // シーン作成
    modelScene = new THREE.Scene();
    modelScene.background = new THREE.Color(0xf5f5f5);

    // カメラ作成（親コンテナのサイズを使用）
    const parentContainer = container.parentElement;
    const containerWidth = parentContainer ? parentContainer.clientWidth : container.clientWidth;
    const containerHeight = parentContainer ? parentContainer.clientHeight : container.clientHeight;
    const actualWidth = Math.max(1, containerWidth - 20); // パディング考慮
    const actualHeight = Math.max(1, containerHeight - 20);
    
    const aspect = actualWidth / actualHeight;
    modelCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    modelCamera.position.set(10, 10, 10);

    // レンダラー作成（高品質設定）
    modelRenderer = new THREE.WebGLRenderer({ 
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        precision: 'highp',
        stencil: false,
        depth: true
    });
    modelRenderer.setSize(actualWidth, actualHeight);
    
    // ピクセル比率を設定（高解像度ディスプレイ対応、最大2倍まで）
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    modelRenderer.setPixelRatio(pixelRatio);
    
    // 出力エンコーディングを設定（色の正確性向上）
    if (modelRenderer.outputEncoding !== undefined) {
        modelRenderer.outputEncoding = THREE.sRGBEncoding;
    }
    
    // シャドウとトーンマッピングの設定
    modelRenderer.shadowMap.enabled = false; // シャドウは不要なのでパフォーマンス向上
    modelRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    modelRenderer.toneMappingExposure = 1.0;
    
    container.appendChild(modelRenderer.domElement);

    // 座標軸用の小型レンダラーを作成
    modelAxisRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    modelAxisRenderer.setPixelRatio(pixelRatio);
    modelAxisRenderer.setSize(MODEL_AXIS_CANVAS_SIZE, MODEL_AXIS_CANVAS_SIZE);
    modelAxisRenderer.autoClear = true;
    modelAxisRenderer.setClearColor(0xf5f5f5, 1);

    const axisCanvas = modelAxisRenderer.domElement;
    axisCanvas.style.position = 'absolute';
    axisCanvas.style.left = `${MODEL_AXIS_MARGIN}px`;
    axisCanvas.style.bottom = `${MODEL_AXIS_MARGIN}px`;
    axisCanvas.style.width = `${MODEL_AXIS_CANVAS_SIZE}px`;
    axisCanvas.style.height = `${MODEL_AXIS_CANVAS_SIZE}px`;
    axisCanvas.style.pointerEvents = 'none';
    axisCanvas.style.userSelect = 'none';
    container.appendChild(axisCanvas);

    // CSS2DRendererを作成（ラベル用）
    if (typeof THREE.CSS2DRenderer !== 'undefined') {
        modelLabelRenderer = new THREE.CSS2DRenderer();
        modelLabelRenderer.setSize(actualWidth, actualHeight);
        modelLabelRenderer.domElement.style.position = 'absolute';
        modelLabelRenderer.domElement.style.top = '0';
        modelLabelRenderer.domElement.style.pointerEvents = 'none';
        container.appendChild(modelLabelRenderer.domElement);
    }

    // コントロール作成
    modelControls = new THREE.OrbitControls(modelCamera, modelRenderer.domElement);
    modelControls.enableDamping = true;
    modelControls.dampingFactor = 0.05;

    // Raycaster初期化
    modelRaycaster = new THREE.Raycaster();
    modelMouse = new THREE.Vector2();

    // グリッド追加
    const gridSize = 50;
    const gridDivisions = 50;
    modelGridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x888888, 0xcccccc);
    modelScene.add(modelGridHelper);

    // ライト追加（改善版：より鮮明な表示）
    // 環境光を少し強めに
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    modelScene.add(ambientLight);
    
    // メインのディレクショナルライト（上から）
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight1.position.set(50, 50, 50);
    modelScene.add(directionalLight1);
    
    // サブのディレクショナルライト（反対側から）
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-50, 30, -50);
    modelScene.add(directionalLight2);
    
    // 補助ライト（横から）
    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.2);
    directionalLight3.position.set(0, 20, 50);
    modelScene.add(directionalLight3);

    // マウスイベント追加
    modelRenderer.domElement.addEventListener('click', onModel3DClick);
    modelRenderer.domElement.addEventListener('dblclick', onModel3DDoubleClick);
    modelRenderer.domElement.addEventListener('contextmenu', onModel3DContextMenu);
    modelRenderer.domElement.addEventListener('mousemove', onModel3DMouseMove);

    // 座標軸ヘルパーを初期化
    initAxisHelper();

    // アニメーションループ開始
    animateModel3D();

    // リサイズ対応
    window.addEventListener('resize', onModel3DResize);
    
    // コンテナ自体のリサイズを監視（ユーザーがハンドルで伸縮した場合）
    if (typeof ResizeObserver !== 'undefined') {
        const canvasContainer = container.parentElement;
        if (canvasContainer && canvasContainer.classList.contains('canvas-container')) {
            // 初期サイズを記録
            const rect = canvasContainer.getBoundingClientRect();
            modelLastKnownSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
            
            modelContainerResizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    const currentSize = { width: Math.round(width), height: Math.round(height) };
                    
                    // サイズが実際に変更された場合のみ処理
                    if (currentSize.width !== modelLastKnownSize.width || 
                        currentSize.height !== modelLastKnownSize.height) {
                        modelLastKnownSize = currentSize;
                        onModel3DResize();
                    }
                }
            });
            modelContainerResizeObserver.observe(canvasContainer);
        }
    }

    return true;
}

/**
 * モデル図3Dのアニメーションループ
 */
function animateModel3D() {
    modelAnimationFrameId = requestAnimationFrame(animateModel3D);
    if (modelControls) modelControls.update();

    if (modelRenderer && modelScene && modelCamera) {
        // メインシーンをレンダリング
        modelRenderer.clear();
        modelRenderer.render(modelScene, modelCamera);

        // 座標軸ヘルパーを描画（メインシーンの後）
        renderAxisHelper();
    }

    if (modelLabelRenderer && modelScene && modelCamera) {
        modelLabelRenderer.render(modelScene, modelCamera);
    }
}

/**
 * モデル図3Dのリサイズ処理
 */
function onModel3DResize() {
    const container = document.getElementById('model-3d-container');
    if (!container || !modelCamera || !modelRenderer) return;

    // 親コンテナ（.canvas-container）のサイズを取得
    const parentContainer = container.parentElement;
    const width = parentContainer ? parentContainer.clientWidth : container.clientWidth;
    const height = parentContainer ? parentContainer.clientHeight : container.clientHeight;

    // パディングを考慮（.canvas-containerには10pxのパディングがある）
    const actualWidth = Math.max(1, width - 20);
    const actualHeight = Math.max(1, height - 20);

    modelCamera.aspect = actualWidth / actualHeight;
    modelCamera.updateProjectionMatrix();
    modelRenderer.setSize(actualWidth, actualHeight);
    if (modelLabelRenderer) {
        modelLabelRenderer.setSize(actualWidth, actualHeight);
    }
    if (modelAxisRenderer) {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        modelAxisRenderer.setPixelRatio(pixelRatio);
        modelAxisRenderer.setSize(MODEL_AXIS_CANVAS_SIZE, MODEL_AXIS_CANVAS_SIZE);
    }
}

function disposeModelObject(object) {
    if (!object) return;

    // まず子要素を再帰的に処理
    if (object.children && object.children.length > 0) {
        // コピーを作成してから処理（ループ中の変更を避ける）
        const children = [...object.children];
        children.forEach(child => {
            disposeModelObject(child);
            if (object.children.includes(child)) {
                object.remove(child);
            }
        });
    }

    // CSS2DラベルのDOM要素を削除
    if (object.isCSS2DObject && object.element && object.element.parentNode) {
        object.element.parentNode.removeChild(object.element);
    }

    // ジオメトリとマテリアルを解放
    if (object.geometry && typeof object.geometry.dispose === 'function') {
        object.geometry.dispose();
    }

    const disposeMaterial = material => {
        if (!material) return;
        if (Array.isArray(material)) {
            material.forEach(m => m && typeof m.dispose === 'function' && m.dispose());
        } else if (typeof material.dispose === 'function') {
            material.dispose();
        }
    };

    if (object.material) {
        disposeMaterial(object.material);
    }
}

/**
 * モデル図3Dの更新
 */
function updateModel3DView(nodes, members, loadData = {}) {
    if (!modelScene) return;

    const loadBundle = Array.isArray(loadData)
        ? { memberLoads: loadData }
        : (loadData || {});

    const memberLoads = Array.isArray(loadBundle.memberLoads) ? loadBundle.memberLoads : [];
    const nodeLoads = Array.isArray(loadBundle.nodeLoads) ? loadBundle.nodeLoads : [];
    const memberSelfWeights = Array.isArray(loadBundle.memberSelfWeights) ? loadBundle.memberSelfWeights : [];
    const nodeSelfWeights = Array.isArray(loadBundle.nodeSelfWeights) ? loadBundle.nodeSelfWeights : [];

    const COLORS = {
        externalDistributed: { int: 0xff4500, hex: '#ff4500' },
        externalConcentrated: { int: 0x1e90ff, hex: '#1e90ff' },
        selfWeight: { int: 0x00aa00, hex: '#00aa00' }
    };

    const showExternalLoads = document.getElementById('show-external-loads')?.checked ?? true;
    const showSelfWeight = document.getElementById('show-self-weight')?.checked ?? true;
    const considerSelfWeight = document.getElementById('consider-self-weight-checkbox')?.checked ?? false;
    const includeSelfWeightLoads = showSelfWeight && considerSelfWeight;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const formatLoadValue = (value, decimals = 2) => {
        if (!isFinite(value)) return '0.00';
        const fixed = Number(value).toFixed(decimals);
        return fixed.replace('-0.00', '0.00');
    };

    const createLoadLabel = (text, position, colorHex) => {
        if (typeof THREE.CSS2DObject === 'undefined') return null;
        const element = document.createElement('div');
        element.className = 'load-label-3d';
        element.textContent = text;
        element.style.color = colorHex;
        element.style.fontSize = '11px';
        element.style.fontWeight = 'bold';
        element.style.backgroundColor = 'rgba(255, 255, 255, 0.92)';
        element.style.padding = '2px 4px';
        element.style.borderRadius = '3px';
        element.style.border = `1px solid ${colorHex}`;
        element.style.pointerEvents = 'none';
        element.style.userSelect = 'none';

        const labelObject = new THREE.CSS2DObject(element);
        labelObject.position.copy(position);
        return labelObject;
    };

    const createSupportLabel = (text, position, colorHex) => {
        if (typeof THREE.CSS2DObject === 'undefined') return null;
        const element = document.createElement('div');
        element.className = 'support-label-3d';
        element.textContent = text;
        element.style.color = colorHex;
        element.style.fontWeight = 'bold';
        element.style.fontSize = '11px';
        element.style.backgroundColor = 'rgba(255, 255, 255, 0.94)';
        element.style.padding = '2px 6px';
        element.style.borderRadius = '3px';
        element.style.border = `1px solid ${colorHex}`;
        element.style.pointerEvents = 'none';
        element.style.userSelect = 'none';

        const label = new THREE.CSS2DObject(element);
        label.position.copy(position);
        return label;
    };

    const addForceArrow = (group, origin, axis, magnitude, color, labelPrefix, unit) => {
        if (!axis || !isFinite(magnitude) || Math.abs(magnitude) < 1e-6) return;

        const normalizedAxis = axis.clone().normalize();
        if (!isFinite(normalizedAxis.lengthSq()) || normalizedAxis.lengthSq() === 0) return;

        const direction = normalizedAxis.clone().multiplyScalar(Math.sign(magnitude) || 1);
        const arrowLength = clamp(Math.abs(magnitude) * 0.2 + 0.6, 0.6, 3.0);
        const arrowOrigin = origin.clone().sub(direction.clone().multiplyScalar(arrowLength));
        const arrowHeadLength = Math.min(arrowLength * 0.3, 0.6);
        const arrowHeadWidth = arrowHeadLength * 0.6;

        const arrow = new THREE.ArrowHelper(direction, arrowOrigin, arrowLength, color.int, arrowHeadLength, arrowHeadWidth);
        group.add(arrow);

        const labelText = `${labelPrefix}${formatLoadValue(magnitude)}${unit}`;
    const labelShift = Math.min(arrowLength * 0.25, 0.35);
    const labelPosition = arrowOrigin.clone().sub(direction.clone().multiplyScalar(labelShift));
        const label = createLoadLabel(labelText, labelPosition, color.hex);
        if (label) {
            group.add(label);
        }
    };

    const addMomentIndicator = (group, origin, axis, magnitude, color, labelPrefix) => {
        if (!axis || !isFinite(magnitude) || Math.abs(magnitude) < 1e-6) return;

        const normalizedAxis = axis.clone().normalize();
        if (!isFinite(normalizedAxis.lengthSq()) || normalizedAxis.lengthSq() === 0) return;

        const radius = clamp(0.45 + Math.abs(magnitude) * 0.05, 0.45, 1.6);
        const tubeRadius = radius * 0.08;

        const geometry = new THREE.TorusGeometry(radius, tubeRadius, 16, 48);
        const material = new THREE.MeshBasicMaterial({ color: color.int, transparent: true, opacity: 0.85 });
        const torus = new THREE.Mesh(geometry, material);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalizedAxis);
        torus.quaternion.copy(quaternion);
        torus.position.copy(origin);
        group.add(torus);

        const labelPosition = origin.clone()
            .add(normalizedAxis.clone().multiplyScalar(radius + 0.25))
            .add(new THREE.Vector3(0, 0.15, 0));
        const label = createLoadLabel(`${labelPrefix}${formatLoadValue(magnitude)}kN·m`, labelPosition, color.hex);
        if (label) {
            group.add(label);
        }
    };

    // 既存のオブジェクトを削除（グリッドとライトは保持）
    const objectsToRemove = [];
    modelScene.children.forEach(child => {
        if (!child.isLight && child !== modelGridHelper) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => {
        modelScene.remove(obj);
        disposeModelObject(obj);
    });

    if (modelLabelRenderer) {
        while (modelLabelRenderer.domElement.firstChild) {
            modelLabelRenderer.domElement.removeChild(modelLabelRenderer.domElement.firstChild);
        }
    }

    // 配列をクリア
    modelNodeMeshes = [];
    modelMemberMeshes = [];

    if (!nodes || nodes.length === 0) return;

    const modelGroup = new THREE.Group();
    const loadGroup = new THREE.Group();
    const nodePositions = [];

    // 節点を描画（高品質マテリアルを使用）
    const nodeGeometry = new THREE.SphereGeometry(0.15, 32, 32); // セグメント数を増やして滑らかに
    const nodeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1565C0,
        metalness: 0.3,
        roughness: 0.4,
        emissive: 0x1565C0,
        emissiveIntensity: 0.1
    });
    const selectedNodeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF6600,
        metalness: 0.3,
        roughness: 0.4,
        emissive: 0xFF6600,
        emissiveIntensity: 0.2
    });

    nodes.forEach((node, i) => {
        const material = (modelSelectedNode === i) ? selectedNodeMaterial : nodeMaterial;
        const nodeMesh = new THREE.Mesh(nodeGeometry, material.clone());
        const nodeY = node.y !== undefined ? node.y : 0;
        const nodeZ = node.z !== undefined ? node.z : 0;
        const nodePosition = new THREE.Vector3(node.x, nodeZ, nodeY);
        nodeMesh.position.copy(nodePosition);
        nodeMesh.userData = { type: 'node', index: i };
        modelGroup.add(nodeMesh);
        modelNodeMeshes.push(nodeMesh);
        nodePositions[i] = nodePosition.clone();

        // 節点ラベルを追加（CSS2DObject）
        if (typeof THREE.CSS2DObject !== 'undefined') {
            const nodeLabel = document.createElement('div');
            nodeLabel.className = 'node-label-3d';
            nodeLabel.textContent = i + 1;
            nodeLabel.style.color = '#1565C0';
            nodeLabel.style.fontSize = '14px';
            nodeLabel.style.fontWeight = 'bold';
            nodeLabel.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            nodeLabel.style.padding = '2px 4px';
            nodeLabel.style.borderRadius = '3px';
            nodeLabel.style.border = '1px solid #1565C0';
            nodeLabel.style.pointerEvents = 'none';
            nodeLabel.style.userSelect = 'none';
            
            const labelObject = new THREE.CSS2DObject(nodeLabel);
            labelObject.position.copy(nodePosition).add(new THREE.Vector3(0, 0.3, 0)); // 節点の少し上に配置
            modelGroup.add(labelObject);
        }

        const supportType = modelNormalizeSupportValue(node.support);

        // ピン支持の場合は赤い球体を追加
        if (supportType === 'pinned') {
            const supportMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xFF0000,
                metalness: 0.4,
                roughness: 0.3,
                emissive: 0xFF0000,
                emissiveIntensity: 0.15
            });
            const supportSphere = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 32), supportMaterial);
            supportSphere.position.copy(nodePosition);
            modelGroup.add(supportSphere);

            const label = createSupportLabel('ピン', nodePosition.clone().add(new THREE.Vector3(0, -0.4, 0)), '#ff0000');
            if (label) modelGroup.add(label);
        }

        // 固定支持の場合は緑の立方体を追加
        else if (supportType === 'fixed') {
            const supportMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x00AA00,
                metalness: 0.4,
                roughness: 0.3,
                emissive: 0x00AA00,
                emissiveIntensity: 0.15
            });
            const supportBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), supportMaterial);
            supportBox.position.copy(nodePosition);
            modelGroup.add(supportBox);

            const label = createSupportLabel('固定', nodePosition.clone().add(new THREE.Vector3(0, -0.4, 0)), '#00aa00');
            if (label) modelGroup.add(label);
        } else if (modelIsRollerSupport(supportType)) {
            const axis = modelGetRollerAxis(supportType);
            if (axis) {
                addModelRollerSupportIndicator(modelGroup, nodePosition, axis);
            }
        }
    });

    // 部材を描画（高品質マテリアルを使用）
    const memberMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x888888,
        metalness: 0.6,
        roughness: 0.4,
        emissive: 0x444444,
        emissiveIntensity: 0.05
    });
    const selectedMemberMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF6600,
        metalness: 0.5,
        roughness: 0.3,
        emissive: 0xFF6600,
        emissiveIntensity: 0.2
    });

    members.forEach((member, index) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return;

        const y1 = nodeI.y !== undefined ? nodeI.y : 0;
        const y2 = nodeJ.y !== undefined ? nodeJ.y : 0;
        const z1 = nodeI.z !== undefined ? nodeI.z : 0;
        const z2 = nodeJ.z !== undefined ? nodeJ.z : 0;

        const p1 = new THREE.Vector3(nodeI.x, z1, y1);
        const p2 = new THREE.Vector3(nodeJ.x, z2, y2);

        const directionVector = new THREE.Vector3().subVectors(p2, p1);
        const length = directionVector.length();
        if (length <= 0) return;

        const directionNormalized = directionVector.clone().normalize();
        const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const baseMaterial = (modelSelectedMember === index) ? selectedMemberMaterial.clone() : memberMaterial.clone();

        const resolveAxisKey = () => {
            const rawKey = (member.sectionAxis && member.sectionAxis.key)
                || member.sectionAxisKey
                || (member.sectionInfo && member.sectionInfo.axis && member.sectionInfo.axis.key)
                || '';
            const rawMode = (member.sectionAxis && member.sectionAxis.mode)
                || member.sectionAxisMode
                || (member.sectionInfo && member.sectionInfo.axis && member.sectionInfo.axis.mode)
                || '';
            const normalizedKey = typeof rawKey === 'string' ? rawKey.trim().toLowerCase() : '';
            const normalizedMode = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : '';

            if (normalizedKey === 'both' || normalizedMode === 'both') return 'both';
            if (normalizedKey === 'y' || normalizedMode === 'weak') return 'y';
            if (normalizedKey === 'x' || normalizedMode === 'strong') return 'x';
            if (normalizedKey === 'weak') return 'y';
            if (normalizedKey === 'strong') return 'x';
            return 'x';
        };

        const axisKey = resolveAxisKey();

        let memberMesh = null;
        const sectionShape = createSectionShapeFromInfo(member.sectionInfo, member);

        if (sectionShape) {
            try {
                const extrudeSettings = { depth: length, bevelEnabled: false };
                const extrudeGeometry = new THREE.ExtrudeGeometry(sectionShape, extrudeSettings);
                memberMesh = new THREE.Mesh(extrudeGeometry, baseMaterial);

                const edgesGeometry = new THREE.EdgesGeometry(extrudeGeometry, 15);
                const edgesMaterial = new THREE.LineBasicMaterial({
                    color: 0x000000,
                    linewidth: 1,
                    transparent: true,
                    opacity: 0.35,
                    depthTest: false
                });
                const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
                memberMesh.add(edges);

                const isVertical = Math.abs(directionNormalized.y) > 0.95;
                memberMesh.position.copy(p1);
                memberMesh.up.set(isVertical ? 1 : 0, isVertical ? 0 : 1, 0);
                memberMesh.lookAt(p2);

                if (isVertical) {
                    memberMesh.rotateZ(Math.PI / 2);
                    if (axisKey === 'y') {
                        memberMesh.rotateZ(Math.PI / 2);
                    }
                } else if (axisKey === 'y') {
                    memberMesh.rotateZ(Math.PI / 2);
                }
            } catch (error) {
                console.warn('Extrude failed for member; falling back to cylinder geometry.', error, member.sectionInfo);
                memberMesh = null;
            }
        }

        if (!memberMesh) {
            const radius = 0.05;
            const fallbackGeometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1);
            memberMesh = new THREE.Mesh(fallbackGeometry, baseMaterial);
            memberMesh.position.copy(midpoint);
            const axis = new THREE.Vector3(0, 1, 0);
            memberMesh.quaternion.setFromUnitVectors(axis, directionNormalized);
        }

        memberMesh.userData = { type: 'member', index: index };
        modelGroup.add(memberMesh);
        modelMemberMeshes.push(memberMesh);

        // 部材ラベルを追加（CSS2DObject）
        if (typeof THREE.CSS2DObject !== 'undefined') {
            const memberLabel = document.createElement('div');
            memberLabel.className = 'member-label-3d';
            memberLabel.textContent = index + 1;
            memberLabel.style.color = '#666666';
            memberLabel.style.fontSize = '12px';
            memberLabel.style.fontWeight = 'normal';
            memberLabel.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
            memberLabel.style.padding = '1px 3px';
            memberLabel.style.borderRadius = '2px';
            memberLabel.style.border = '1px solid #888888';
            memberLabel.style.pointerEvents = 'none';
            memberLabel.style.userSelect = 'none';
            
            const labelObject = new THREE.CSS2DObject(memberLabel);
            // 部材の中点に配置（少しオフセット）
            const offset = new THREE.Vector3(0, 0.2, 0);
            labelObject.position.copy(midpoint).add(offset);
            modelGroup.add(labelObject);
        }

        // ピン接合の表示（高品質マテリアル）
        const redMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFF0000,
            metalness: 0.5,
            roughness: 0.3,
            emissive: 0xFF0000,
            emissiveIntensity: 0.2
        });

        if (member.i_conn === 'pinned') {
            const hingeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), redMaterial);
            hingeSphere.position.copy(p1).addScaledVector(directionNormalized, 0.3);
            modelGroup.add(hingeSphere);
        }

        if (member.j_conn === 'pinned') {
            const hingeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), redMaterial);
            hingeSphere.position.copy(p2).addScaledVector(directionNormalized, -0.3);
            modelGroup.add(hingeSphere);
        }
    });

    // 部材荷重の描画（等分布荷重の矢印）
    const distributedLoads = [];

    memberLoads.forEach(load => {
        distributedLoads.push({
            memberIndex: load.memberIndex,
            wx: load.wx || 0,
            wy: load.wy || 0,
            wz: load.wz || 0,
            w: load.w || 0,  // 従来のw（後方互換）
            isFromSelfWeight: !!load.isFromSelfWeight
        });
    });

    // 3Dビューでは部材自重の等分布荷重を描画しない

    if (distributedLoads.length > 0) {
        const numArrows = 5;
        const arrowLength = 0.8;
        const arrowHeadLength = arrowLength * 0.25;
        const arrowHeadWidth = arrowLength * 0.18;

        distributedLoads.forEach(load => {
            const isSelfWeight = !!load.isFromSelfWeight;
            if (isSelfWeight) return;
            if (!showExternalLoads) return;

            const member = members[load.memberIndex];
            if (!member) return;

            const startPos = nodePositions[member.i];
            const endPos = nodePositions[member.j];
            if (!startPos || !endPos) return;

            const p1 = startPos.clone();
            const p2 = endPos.clone();
            const color = isSelfWeight ? COLORS.selfWeight : COLORS.externalDistributed;
            
            // グローバル座標系の荷重成分を取得（構造解析座標系）
            const wx = load.wx || 0;      // 構造解析のX方向
            const wy = load.wy || 0;      // 構造解析のY方向
            const wz = load.wz || 0;      // 構造解析のZ方向（鉛直）
            const legacyW = load.w || 0;  // 後方互換性のため

            // 荷重が0の場合はスキップ
            if (wx === 0 && wy === 0 && wz === 0 && legacyW === 0) return;

            // グローバル座標系の単位ベクトル（Three.js座標系に変換）
            // 構造解析: (X, Y, Z) → Three.js: (X, Z, -Y)
            const globalX = new THREE.Vector3(1, 0, 0);    // 構造解析X → Three.js X
            const globalY = new THREE.Vector3(0, 0, 1);    // 構造解析Y → Three.js Z
            const globalZ = new THREE.Vector3(0, -1, 0);   // 構造解析Z（鉛直上向き） → Three.js Y（下向き）

            for (let i = 0; i <= numArrows; i++) {
                const t = i / numArrows;
                const position = new THREE.Vector3().lerpVectors(p1, p2, t);
                const drawDistributedArrow = (value, axisKey, baseVector) => {
                    if (!value) return;
                    const sign = Math.sign(value) || 1;
                    const baseDir = baseVector.clone().multiplyScalar(sign);
                    const shouldFlipDirection = axisKey === 'wx' || axisKey === 'wy';
                    let arrowOrigin;
                    let arrowDir;

                    if (shouldFlipDirection) {
                        arrowOrigin = position.clone().sub(baseDir.clone().multiplyScalar(arrowLength));
                        arrowDir = baseDir.clone();
                    } else {
                        arrowOrigin = position.clone().add(baseDir.clone().multiplyScalar(arrowLength));
                        arrowDir = baseDir.clone().multiplyScalar(-1);
                    }

                    const arrow = new THREE.ArrowHelper(arrowDir, arrowOrigin, arrowLength, color.int, arrowHeadLength, arrowHeadWidth);
                    loadGroup.add(arrow);
                };

                // グローバルX方向の荷重（構造解析X）
                drawDistributedArrow(wx, 'wx', globalX);
                // グローバルY方向の荷重（構造解析Y）
                drawDistributedArrow(wy, 'wy', globalY);
                // グローバルZ方向の荷重（構造解析Z = 鉛直方向）
                drawDistributedArrow(wz, 'wz', globalZ);
                // 後方互換性: 従来のwプロパティ（構造解析Z方向=鉛直と想定）
                if (legacyW !== 0 && wz === 0) {
                    drawDistributedArrow(legacyW, 'legacyW', globalZ);
                }
            }

            // ラベル作成
            const labelParts = [];
            if (wx !== 0) labelParts.push(`Wx=${formatLoadValue(wx)}kN/m`);
            if (wy !== 0) labelParts.push(`Wy=${formatLoadValue(wy)}kN/m`);
            if (wz !== 0) labelParts.push(`Wz=${formatLoadValue(wz)}kN/m`);
            if (legacyW !== 0 && wz === 0) labelParts.push(`W=${formatLoadValue(legacyW)}kN/m`);
            
            const loadText = labelParts.join(' ');

            if (loadText.trim()) {
                const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                const labelOffset = new THREE.Vector3();
                if (wx !== 0) labelOffset.add(globalX.clone().multiplyScalar(Math.sign(wx) * 0.6));
                if (wy !== 0) labelOffset.add(globalY.clone().multiplyScalar(Math.sign(wy) * 0.6));
                if (wz !== 0) labelOffset.add(globalZ.clone().multiplyScalar(Math.sign(wz) * 0.6));
                if (legacyW !== 0 && wz === 0) labelOffset.add(globalZ.clone().multiplyScalar(Math.sign(legacyW) * 0.6));
                if (labelOffset.lengthSq() === 0) labelOffset.y = 0.6;

                const labelPosition = midpoint.clone().add(labelOffset);
                const label = createLoadLabel(loadText, labelPosition, color.hex);
                if (label) {
                    loadGroup.add(label);
                }
            }
        });
    }

    // 節点荷重の描画（集中荷重・モーメント）
    const nodeLoadsToRender = [];
    if (showExternalLoads) {
        nodeLoads.forEach(load => {
            nodeLoadsToRender.push({ ...load, isFromSelfWeight: false });
        });
    }
    // 3Dビューでは節点自重荷重を描画しない

    if (nodeLoadsToRender.length > 0) {
        nodeLoadsToRender.forEach(load => {
            const nodePos = nodePositions[load.nodeIndex];
            if (!nodePos) return;

            const color = COLORS.externalConcentrated;
            const prefix = '';

            addForceArrow(loadGroup, nodePos, new THREE.Vector3(1, 0, 0), load.px || 0, color, `${prefix}Px=`, 'kN');
            addForceArrow(loadGroup, nodePos, new THREE.Vector3(0, 0, 1), load.py || 0, color, `${prefix}Py=`, 'kN');
            addForceArrow(loadGroup, nodePos, new THREE.Vector3(0, 1, 0), load.pz || 0, color, `${prefix}Pz=`, 'kN');

            addMomentIndicator(loadGroup, nodePos, new THREE.Vector3(1, 0, 0), load.mx || 0, color, `${prefix}Mx=`);
            addMomentIndicator(loadGroup, nodePos, new THREE.Vector3(0, 0, 1), load.my || 0, color, `${prefix}My=`);
            addMomentIndicator(loadGroup, nodePos, new THREE.Vector3(0, 1, 0), load.mz || 0, color, `${prefix}Mz=`);
        });
    }

    // 作成した荷重グループを追加
    if (loadGroup.children.length > 0) {
        modelGroup.add(loadGroup);
    }

    // 部材追加モードで第一節点が選択されている場合
    if (modelFirstMemberNode !== null && nodes[modelFirstMemberNode]) {
        const node = nodes[modelFirstMemberNode];
        const nodeY = node.y !== undefined ? node.y : 0;
        const nodeZ = node.z !== undefined ? node.z : 0;
        const highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xFFA500, opacity: 0.7, transparent: true });
        const highlightSphere = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), highlightMaterial);
        highlightSphere.position.set(node.x, nodeZ, nodeY);
        modelGroup.add(highlightSphere);
    }

    modelScene.add(modelGroup);

    // 初回のみカメラ位置を調整
    if (modelGroup.children.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        if (isFinite(maxDim) && maxDim > 0 && !modelControls.target.length()) {
            const distance = maxDim * 2;
            modelCamera.position.set(center.x + distance, center.y + distance, center.z + distance);
            modelControls.target.copy(center);
            modelControls.update();
        }
    }
}

/**
 * 3Dビューの自動スケーリング（カメラ位置をモデル全体に合わせる）
 */
function autoScaleModel3DView() {
    if (!modelScene || !modelCamera || !modelControls) {
        console.warn('3D view not initialized');
        return;
    }

    // シーン内のすべてのメッシュからバウンディングボックスを計算
    const objectsToFit = [];
    modelScene.traverse((obj) => {
        if (obj.isMesh || obj.isGroup) {
            objectsToFit.push(obj);
        }
    });

    if (objectsToFit.length === 0) {
        console.warn('No objects to fit in 3D view');
        return;
    }

    // モデル全体のバウンディングボックスを計算
    const box = new THREE.Box3();
    objectsToFit.forEach(obj => {
        const objBox = new THREE.Box3().setFromObject(obj);
        box.union(objBox);
    });

    if (box.isEmpty()) {
        console.warn('Bounding box is empty');
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z)) {
        console.warn('Invalid model dimensions');
        return;
    }

    // カメラの視野角とアスペクト比を取得
    const fov = modelCamera.fov * (Math.PI / 180);
    const aspect = modelCamera.aspect;
    
    // 現在のカメラの方向を保持（現在の向きを基準にする）
    const currentDirection = new THREE.Vector3();
    modelCamera.getWorldDirection(currentDirection);
    
    // モデルの対角線の長さを計算
    const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    
    // カメラの視野角とアスペクト比を考慮した距離を計算
    // 縦方向と横方向の両方を考慮し、大きい方を採用
    const fovVertical = fov;
    const fovHorizontal = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    
    // 表示枠一杯に収めるため、より厳密な計算を行う
    const distanceVertical = diagonal / (2 * Math.tan(fovVertical / 2));
    const distanceHorizontal = diagonal / (2 * Math.tan(fovHorizontal / 2));
    
    // 両方に収まる距離を採用（大きい方）+ わずかなマージン（5%）
    const distance = Math.max(distanceVertical, distanceHorizontal) * 1.05;

    // カメラ位置を更新（斜め上から見下ろす位置）
    const angle = Math.PI / 4; // 45度
    const elevation = Math.PI / 6; // 30度の仰角
    
    modelCamera.position.set(
        center.x + distance * Math.cos(angle) * Math.cos(elevation),
        center.y + distance * Math.sin(elevation),
        center.z + distance * Math.sin(angle) * Math.cos(elevation)
    );

    // コントロールのターゲットを中心に設定
    modelControls.target.copy(center);
    modelControls.update();

    console.log('3D view auto-scaled:', {
        center: center.toArray(),
        size: size.toArray(),
        diagonal: diagonal.toFixed(2),
        distance: distance.toFixed(2),
        cameraPosition: modelCamera.position.toArray().map(v => v.toFixed(2))
    });
}

/**
 * モデル図3Dビューの表示/非表示を切り替え
 */
function toggleModel3DView(show) {
    const canvas2D = document.getElementById('model-canvas');
    const container3D = document.getElementById('model-3d-container');
    const projectionLabel = document.getElementById('projection-mode-label');
    const projectionSelect = document.getElementById('projection-mode');
    const hiddenAxisLabel = document.getElementById('hidden-axis-label');
    const hiddenAxisSelect = document.getElementById('hidden-axis-coord');

    if (show) {
        // 3D表示
        window.is3DMode = true;

        if (!modelScene) {
            const success = initModel3DView();
            if (!success) {
                console.error('Failed to initialize 3D view');
                return;
            }
        }

        canvas2D.style.display = 'none';
        container3D.style.display = 'block';

        // 2D専用コントロールを非表示
        if (projectionLabel) projectionLabel.style.display = 'none';
        if (projectionSelect) projectionSelect.style.display = 'none';
        if (hiddenAxisLabel) hiddenAxisLabel.style.display = 'none';
        if (hiddenAxisSelect) hiddenAxisSelect.style.display = 'none';

        // 現在のモデルデータを描画
        try {
            const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
            updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
            
            // 3D表示に切り替えた後、自動スケーリングを実行
            setTimeout(() => {
                autoScaleModel3DView();
            }, 150);
        } catch (e) {
            console.error('Error updating 3D view:', e);
        }

        // リサイズ処理
        setTimeout(() => {
            onModel3DResize();
        }, 100);
    } else {
        // 2D表示
        window.is3DMode = false;

        canvas2D.style.display = 'block';
        container3D.style.display = 'none';

        // 2D専用コントロールを表示
        if (projectionLabel) projectionLabel.style.display = '';
        if (projectionSelect) projectionSelect.style.display = '';
        if (hiddenAxisLabel) hiddenAxisLabel.style.display = '';
        if (hiddenAxisSelect) hiddenAxisSelect.style.display = '';

        // 2D描画を更新
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
    }
}

/**
 * マウス座標を正規化してRayca sterに設定
 */
function updateMousePosition(event) {
    const rect = modelRenderer.domElement.getBoundingClientRect();
    modelMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    modelMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

/**
 * 3Dビューのクリックイベント
 */
function onModel3DClick(event) {
    event.preventDefault();

    // canvasModeを取得（グローバル変数）
    if (typeof canvasMode === 'undefined') return;

    updateMousePosition(event);
    modelRaycaster.setFromCamera(modelMouse, modelCamera);

    if (canvasMode === 'select') {
        // 選択モード：節点または部材を選択
        const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);
        const memberIntersects = modelRaycaster.intersectObjects(modelMemberMeshes);

        if (nodeIntersects.length > 0) {
            const nodeIndex = nodeIntersects[0].object.userData.index;
            modelSelectedNode = nodeIndex;
            modelSelectedMember = null;

            // 2D側の選択状態も更新
            if (typeof window.selectNode === 'function') {
                window.selectNode(nodeIndex);
            }

            // 再描画
            try {
                const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
                updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
            } catch (e) {
                console.error('Error updating view:', e);
            }
        } else if (memberIntersects.length > 0) {
            const memberIndex = memberIntersects[0].object.userData.index;
            modelSelectedMember = memberIndex;
            modelSelectedNode = null;

            // 2D側の選択状態も更新
            if (typeof window.selectMember === 'function') {
                window.selectMember(memberIndex);
            }

            // 再描画
            try {
                const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
                updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
            } catch (e) {
                console.error('Error updating view:', e);
            }
        } else {
            // 何もクリックしなかった場合は選択解除
            modelSelectedNode = null;
            modelSelectedMember = null;

            try {
                const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
                updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
            } catch (e) {
                console.error('Error updating view:', e);
            }
        }
    } else if (canvasMode === 'addNode') {
        // 節点追加モード：グリッド平面上に節点を配置
        const intersects = modelRaycaster.intersectObject(modelGridHelper);

        if (intersects.length > 0) {
            const point = intersects[0].point;
            // グリッドに吸着
            const gridSpacing = parseFloat(document.getElementById('grid-spacing')?.value || 1.0);
            const x = Math.round(point.x / gridSpacing) * gridSpacing;
            const y = Math.round(point.z / gridSpacing) * gridSpacing; // Three.jsのZ → 入力のY
            const z = Math.round(point.y / gridSpacing) * gridSpacing; // Three.jsのY → 入力のZ

            // 節点追加関数を呼び出し
            if (typeof window.addNodeProgrammatically === 'function') {
                window.addNodeProgrammatically(x, y, z);
            }
        }
    } else if (canvasMode === 'addMember') {
        // 部材追加モード：2つの節点を選択
        const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);

        if (nodeIntersects.length > 0) {
            const nodeIndex = nodeIntersects[0].object.userData.index;

            if (modelFirstMemberNode === null) {
                // 第一節点を選択
                modelFirstMemberNode = nodeIndex;

                // 2D側の変数も更新
                if (typeof window.setFirstMemberNode === 'function') {
                    window.setFirstMemberNode(nodeIndex);
                }

                // 再描画
                try {
                    const { nodes, members, nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights } = parseInputs();
                    updateModel3DView(nodes, members, { nodeLoads, memberLoads, memberSelfWeights, nodeSelfWeights });
                } catch (e) {
                    console.error('Error updating view:', e);
                }
            } else {
                // 第二節点を選択して部材を追加
                if (typeof window.addMemberProgrammatically === 'function') {
                    window.addMemberProgrammatically(modelFirstMemberNode, nodeIndex);
                }
                modelFirstMemberNode = null;

                // 2D側の変数も更新
                if (typeof window.setFirstMemberNode === 'function') {
                    window.setFirstMemberNode(null);
                }
            }
        }
    }
}

/**
 * 3Dビューのコンテキストメニューイベント
 */
function onModel3DContextMenu(event) {
    event.preventDefault();

    updateMousePosition(event);
    modelRaycaster.setFromCamera(modelMouse, modelCamera);

    // 節点を右クリック
    const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);
    if (nodeIntersects.length > 0) {
        const nodeIndex = nodeIntersects[0].object.userData.index;

        // 節点編集ポップアップを直接表示
        if (typeof window.openNodeEditor === 'function') {
            window.openNodeEditor(nodeIndex);
        }
        return;
    }

    // 部材を右クリック
    const memberIntersects = modelRaycaster.intersectObjects(modelMemberMeshes);
    if (memberIntersects.length > 0) {
        const memberIndex = memberIntersects[0].object.userData.index;

        // 部材プロパティポップアップを表示
        if (typeof window.showMemberProperties === 'function') {
            window.showMemberProperties(memberIndex);
        }
    }
}

/**
 * 3Dビューのマウス移動イベント
 */
function onModel3DMouseMove(event) {
    // 現在はホバー表示などは未実装
    // 将来的にはツールチップ表示などを追加可能
}

/**
 * 3Dビューのダブルクリックイベント
 */
function onModel3DDoubleClick(event) {
    event.preventDefault();

    updateMousePosition(event);
    modelRaycaster.setFromCamera(modelMouse, modelCamera);

    // 節点をダブルクリック
    const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);
    if (nodeIntersects.length > 0) {
        const nodeIndex = nodeIntersects[0].object.userData.index;

        // 節点編集ポップアップを直接表示
        if (typeof window.openNodeEditor === 'function') {
            window.openNodeEditor(nodeIndex);
        }
        return;
    }

    // 部材をダブルクリック
    const memberIntersects = modelRaycaster.intersectObjects(modelMemberMeshes);
    if (memberIntersects.length > 0) {
        const memberIndex = memberIntersects[0].object.userData.index;

        // 部材プロパティポップアップを表示
        if (typeof window.showMemberProperties === 'function') {
            window.showMemberProperties(memberIndex);
        }
    }
}

/**
 * モデル図3Dビューのクリーンアップ
 */
function disposeModel3DView() {
    if (modelAnimationFrameId) {
        cancelAnimationFrame(modelAnimationFrameId);
        modelAnimationFrameId = null;
    }

    if (modelRenderer) {
        // イベントリスナー削除
        modelRenderer.domElement.removeEventListener('click', onModel3DClick);
        modelRenderer.domElement.removeEventListener('dblclick', onModel3DDoubleClick);
        modelRenderer.domElement.removeEventListener('contextmenu', onModel3DContextMenu);
        modelRenderer.domElement.removeEventListener('mousemove', onModel3DMouseMove);

        const container = document.getElementById('model-3d-container');
        if (container && modelRenderer.domElement.parentNode === container) {
            container.removeChild(modelRenderer.domElement);
        }
        modelRenderer.dispose();
        modelRenderer = null;
    }

    if (modelLabelRenderer) {
        // CSS2DRendererのDOM要素内のすべてのラベルを削除
        while (modelLabelRenderer.domElement.firstChild) {
            modelLabelRenderer.domElement.removeChild(modelLabelRenderer.domElement.firstChild);
        }
        const container = document.getElementById('model-3d-container');
        if (container && modelLabelRenderer.domElement.parentNode === container) {
            container.removeChild(modelLabelRenderer.domElement);
        }
        modelLabelRenderer = null;
    }

    if (modelScene) {
        while (modelScene.children.length > 0) {
            const obj = modelScene.children[0];
            // CSS2DObjectの場合、DOM要素も削除
            if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
                obj.element.parentNode.removeChild(obj.element);
            }
            if (obj.userData && typeof obj.userData.dispose === 'function') {
                obj.userData.dispose();
            }
            if (obj.geometry) obj.geometry.dispose();
            const disposeMaterial = (material) => {
                if (!material) return;
                if (material.map) material.map.dispose();
                if (typeof material.dispose === 'function') material.dispose();
            };
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(disposeMaterial);
                } else {
                    disposeMaterial(obj.material);
                }
            }
            modelScene.remove(obj);
        }
        modelScene = null;
    }

    modelCamera = null;
    modelControls = null;
    modelNodeMeshes = [];
    modelMemberMeshes = [];
    modelSelectedNode = null;
    modelSelectedMember = null;
    modelFirstMemberNode = null;

    window.removeEventListener('resize', onModel3DResize);
    
    // ResizeObserverのクリーンアップ
    if (modelContainerResizeObserver) {
        modelContainerResizeObserver.disconnect();
        modelContainerResizeObserver = null;
    }
    modelLastKnownSize = { width: 0, height: 0 };

    // 座標軸ヘルパーのクリーンアップ
    if (modelAxisScene) {
        while (modelAxisScene.children.length > 0) {
            const obj = modelAxisScene.children[0];
            if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
                obj.element.parentNode.removeChild(obj.element);
            }
            if (obj.userData && typeof obj.userData.dispose === 'function') {
                obj.userData.dispose();
            }
            if (obj.geometry) obj.geometry.dispose();
            const disposeMaterial = (material) => {
                if (!material) return;
                if (material.map) material.map.dispose();
                if (typeof material.dispose === 'function') material.dispose();
            };
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(disposeMaterial);
                } else {
                    disposeMaterial(obj.material);
                }
            }
            modelAxisScene.remove(obj);
        }
        modelAxisScene = null;
    }
    modelAxisCamera = null;
    modelAxisHelper = null;
}

/**
 * 座標軸ヘルパーの初期化
 */
function initAxisHelper() {
    if (!modelRenderer) return;

    modelAxisScene = new THREE.Scene();

    modelAxisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    modelAxisCamera.position.set(0, 0, 4);

    modelAxisHelper = new THREE.Group();
    modelAxisScene.add(modelAxisHelper);

    const createTextSprite = (text, color) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 128;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = color;
        context.font = 'bold 90px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 64, 64);

        const texture = new THREE.CanvasTexture(canvas);
        if (modelRenderer.capabilities && typeof modelRenderer.capabilities.getMaxAnisotropy === 'function') {
            texture.anisotropy = modelRenderer.capabilities.getMaxAnisotropy();
        }
        texture.needsUpdate = true;

        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(0.32, 0.32, 1);
        sprite.renderOrder = 2;
        sprite.userData.dispose = () => {
            texture.dispose();
        };
        return sprite;
    };

    const arrowLength = 1.4;
    const arrowHeadLength = 0.35;
    const arrowHeadWidth = 0.22;
    const labelOffset = arrowLength + 0.25;

    const axes = [
        { label: 'X', color: 0xff3b30, dir: new THREE.Vector3(1, 0, 0) },
        { label: 'Y', color: 0x34c759, dir: new THREE.Vector3(0, 0, 1) },
        { label: 'Z', color: 0x007aff, dir: new THREE.Vector3(0, 1, 0) }
    ];

    axes.forEach(({ label, color, dir }) => {
        const normalized = dir.clone().normalize();
        const arrow = new THREE.ArrowHelper(
            normalized,
            new THREE.Vector3(0, 0, 0),
            arrowLength,
            color,
            arrowHeadLength,
            arrowHeadWidth
        );
        arrow.frustumCulled = false;
        arrow.cone.renderOrder = 1;
        arrow.line.renderOrder = 1;
        arrow.cone.material.depthTest = false;
        arrow.cone.material.depthWrite = false;
        arrow.line.material.depthTest = false;
        arrow.line.material.depthWrite = false;
        modelAxisHelper.add(arrow);

    const labelSprite = createTextSprite(label, `#${color.toString(16).padStart(6, '0')}`);
    labelSprite.position.copy(normalized.clone().multiplyScalar(labelOffset));
        modelAxisHelper.add(labelSprite);
    });

    const originSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x555555, depthTest: false, depthWrite: false })
    );
    originSphere.renderOrder = 1;
    modelAxisHelper.add(originSphere);
}

/**
 * 座標軸ヘルパーの描画
 */
function renderAxisHelper() {
    if (!modelAxisScene || !modelAxisCamera || !modelAxisRenderer || !modelCamera) {
        return;
    }

    if (modelAxisHelper) {
        modelAxisHelper.quaternion.copy(modelCamera.quaternion);
    }

    modelAxisCamera.position.set(0, 0, 4);
    modelAxisCamera.lookAt(0, 0, 0);
    modelAxisCamera.updateMatrixWorld();

    modelAxisRenderer.render(modelAxisScene, modelAxisCamera);
}

/**
 * Create a simple THREE.Shape from sectionInfo.rawDims when possible.
 * Supports a subset of section types (rectangular, pipe, circular/estimated).
 * Returns null if shape cannot be created.
 */
function createSectionShapeFromInfo(sectionInfo, member) {
    const MM_TO_M = 0.001;

    const toNumber = (value) => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') return null;
            const parsed = parseFloat(trimmed);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    };

    let info = sectionInfo;

    if ((!info || !info.rawDims) && member && typeof member.A === 'number' && member.A > 0) {
        const A_m2 = member.A;
        const A_cm2 = A_m2 * 1e4;
        const radius_cm = Math.sqrt(A_cm2 / Math.PI);
        const diameter_cm = radius_cm * 2;
        const diameter_mm = diameter_cm * 10;
        info = {
            typeKey: 'estimated',
            label: '推定断面（円形）',
            rawDims: {
                D: diameter_mm,
                D_scaled: diameter_mm
            }
        };
    }

    if (!info || !info.rawDims) return null;

    const dims = info.rawDims;
    const typeKey = info.typeKey || '';
    const shape = new THREE.Shape();

    try {
        switch (typeKey) {
            case 'hkatakou_hiro':
            case 'hkatakou_naka':
            case 'hkatakou_hoso':
            case 'ikatakou':
            case 'keiryouhkatakou':
            case 'keiryourippuhkatakou': {
                const H = toNumber(dims.H);
                const B = toNumber(dims.B);
                const t1 = toNumber(dims.t1);
                const t2 = toNumber(dims.t2);
                if (!H || !B || !t1 || !t2) return null;
                const halfH = (H * MM_TO_M) / 2;
                const halfB = (B * MM_TO_M) / 2;
                const halfT1 = (t1 * MM_TO_M) / 2;
                const t2m = t2 * MM_TO_M;
                shape.moveTo(-halfB, halfH);
                shape.lineTo(halfB, halfH);
                shape.lineTo(halfB, halfH - t2m);
                shape.lineTo(halfT1, halfH - t2m);
                shape.lineTo(halfT1, -halfH + t2m);
                shape.lineTo(halfB, -halfH + t2m);
                shape.lineTo(halfB, -halfH);
                shape.lineTo(-halfB, -halfH);
                shape.lineTo(-halfB, -halfH + t2m);
                shape.lineTo(-halfT1, -halfH + t2m);
                shape.lineTo(-halfT1, halfH - t2m);
                shape.lineTo(-halfB, halfH - t2m);
                shape.lineTo(-halfB, halfH);
                return shape;
            }
            case 'seihoukei':
            case 'tyouhoukei': {
                const A = toNumber(dims.A);
                const B = toNumber(dims.B) || A;
                const t = toNumber(dims.t);
                if (!A || !B || !t) return null;
                const halfA = (A * MM_TO_M) / 2;
                const halfB = (B * MM_TO_M) / 2;
                const tm = t * MM_TO_M;
                shape.moveTo(-halfB, -halfA);
                shape.lineTo(halfB, -halfA);
                shape.lineTo(halfB, halfA);
                shape.lineTo(-halfB, halfA);
                shape.lineTo(-halfB, -halfA);
                const hole = new THREE.Path();
                hole.moveTo(-halfB + tm, -halfA + tm);
                hole.lineTo(-halfB + tm, halfA - tm);
                hole.lineTo(halfB - tm, halfA - tm);
                hole.lineTo(halfB - tm, -halfA + tm);
                hole.lineTo(-halfB + tm, -halfA + tm);
                shape.holes.push(hole);
                return shape;
            }
            case 'koukan':
            case 'pipe': {
                const D = toNumber(dims.D);
                const t = toNumber(dims.t);
                if (!D || !t) return null;
                const outer = (D * MM_TO_M) / 2;
                const inner = outer - (t * MM_TO_M);
                shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
                const hole = new THREE.Path();
                hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
                shape.holes.push(hole);
                return shape;
            }
            case 'mizogatakou':
            case 'keimizogatakou': {
                const H = toNumber(dims.H);
                const B = toNumber(dims.B) || toNumber(dims.A);
                const t1 = toNumber(dims.t1) || toNumber(dims.t);
                const t2 = toNumber(dims.t2) || toNumber(dims.t);
                if (!H || !B || !t1 || !t2) return null;
                const halfH = (H * MM_TO_M) / 2;
                const flangeWidth = B * MM_TO_M;
                const webThick = t1 * MM_TO_M;
                const flangeThick = t2 * MM_TO_M;
                shape.moveTo(-flangeWidth / 2, halfH);
                shape.lineTo(flangeWidth / 2, halfH);
                shape.lineTo(flangeWidth / 2, halfH - flangeThick);
                shape.lineTo(webThick / 2, halfH - flangeThick);
                shape.lineTo(webThick / 2, -halfH + flangeThick);
                shape.lineTo(flangeWidth / 2, -halfH + flangeThick);
                shape.lineTo(flangeWidth / 2, -halfH);
                shape.lineTo(-flangeWidth / 2, -halfH);
                shape.lineTo(-flangeWidth / 2, -halfH + flangeThick);
                shape.lineTo(-webThick / 2, -halfH + flangeThick);
                shape.lineTo(-webThick / 2, halfH - flangeThick);
                shape.lineTo(-flangeWidth / 2, halfH - flangeThick);
                shape.lineTo(-flangeWidth / 2, halfH);
                return shape;
            }
            case 'rippumizokatakou': {
                const H = toNumber(dims.H);
                const A = toNumber(dims.A);
                const C = toNumber(dims.C);
                const t = toNumber(dims.t);
                if (!H || !A || !C || !t) return null;
                const halfH = (H * MM_TO_M) / 2;
                const flangeWidth = A * MM_TO_M;
                const lip = C * MM_TO_M;
                const thick = t * MM_TO_M;
                shape.moveTo(-flangeWidth / 2, halfH);
                shape.lineTo(flangeWidth / 2, halfH);
                shape.lineTo(flangeWidth / 2, halfH - lip);
                shape.lineTo(flangeWidth / 2 - thick, halfH - lip);
                shape.lineTo(flangeWidth / 2 - thick, halfH - thick);
                shape.lineTo(-flangeWidth / 2 + thick, halfH - thick);
                shape.lineTo(-flangeWidth / 2 + thick, -halfH + thick);
                shape.lineTo(flangeWidth / 2 - thick, -halfH + thick);
                shape.lineTo(flangeWidth / 2 - thick, -halfH + lip);
                shape.lineTo(flangeWidth / 2, -halfH + lip);
                shape.lineTo(flangeWidth / 2, -halfH);
                shape.lineTo(-flangeWidth / 2, -halfH);
                shape.lineTo(-flangeWidth / 2, halfH);
                return shape;
            }
            case 'touhenyamakatakou':
            case 'futouhenyamagata': {
                const A = toNumber(dims.A);
                const B = toNumber(dims.B) || A;
                const t = toNumber(dims.t);
                if (!A || !B || !t) return null;
                const height = A * MM_TO_M;
                const width = B * MM_TO_M;
                const thick = t * MM_TO_M;
                shape.moveTo(0, height);
                shape.lineTo(width, height);
                shape.lineTo(width, height - thick);
                shape.lineTo(thick, height - thick);
                shape.lineTo(thick, 0);
                shape.lineTo(0, 0);
                shape.lineTo(0, height);
                return shape;
            }
            case '矩形':
            case 'rectangular': {
                const H = toNumber(dims.H);
                const B = toNumber(dims.B);
                if (!H || !B) return null;
                const halfH = (H * MM_TO_M) / 2;
                const halfB = (B * MM_TO_M) / 2;
                shape.moveTo(-halfB, -halfH);
                shape.lineTo(halfB, -halfH);
                shape.lineTo(halfB, halfH);
                shape.lineTo(-halfB, halfH);
                shape.lineTo(-halfB, -halfH);
                return shape;
            }
            case '円形':
            case 'circular':
            case 'circle':
            case 'round':
            case 'estimated': {
                const D = toNumber(dims.D) || toNumber(dims.D_scaled) || toNumber(dims.d) || toNumber(dims.diameter) || toNumber(dims.Dm);
                if (!D) return null;
                const radius = (D * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
                return shape;
            }
            default:
                return null;
        }
    } catch (err) {
        console.warn('createSectionShapeFromInfo failed:', err, info);
        return null;
    }
}
