// viewer_3d.js

if (typeof THREE === 'undefined') {
    alert('3D描画ライブラリ(Three.js)が読み込まれていません。');
    throw new Error('Three.js not found');
}

// 3Dシーン用のグローバル変数
let scene, camera, renderer, controls, labelRenderer, animationFrameId;
let axisScene, axisCamera, axisRenderer, axisHelper;

const AXIS_CANVAS_SIZE = 120;
const AXIS_MARGIN = 15;

const VIEWER_SUPPORT_ALIAS_ENTRIES = [
    { target: 'free', aliases: ['f', 'free', '自由'] },
    { target: 'pinned', aliases: ['p', 'pin', 'pinned', 'hinge', 'hinged', 'ピン'] },
    { target: 'fixed', aliases: ['x', 'fix', 'fixed', '固定'] },
    { target: 'roller-x', aliases: ['roller-x', 'roller_x', 'rollerx', 'r-x', 'rx', 'ローラーx', 'ローラー(x)', 'ローラー(X軸固定)'] },
    { target: 'roller-y', aliases: ['roller-y', 'roller_y', 'rollery', 'r-y', 'ry', 'ローラー', 'ローラーy', 'ローラー(y)', 'ローラー(Y軸固定)', 'r', 'roller'] },
    { target: 'roller-z', aliases: ['roller-z', 'roller_z', 'rollerz', 'r-z', 'rz', 'ローラーz', 'ローラー(z)', 'ローラー(Z軸固定)'] }
];

const VIEWER_SUPPORT_ALIAS_MAP = (() => {
    const map = new Map();
    VIEWER_SUPPORT_ALIAS_ENTRIES.forEach(({ target, aliases }) => {
        aliases.forEach(alias => {
            const key = `${alias}`.trim();
            if (!key) return;
            map.set(key, target);
            map.set(key.toLowerCase(), target);
        });
    });
    return map;
})();

function viewerNormalizeSupportValue(value) {
    if (typeof normalizeSupportValue === 'function') {
        try {
            const normalized = normalizeSupportValue(value);
            if (normalized) {
                return normalized;
            }
        } catch (e) {
            // fall back to local map
        }
    }

    if (value === undefined || value === null) return 'free';
    const raw = `${value}`.trim();
    if (!raw) return 'free';
    return VIEWER_SUPPORT_ALIAS_MAP.get(raw) || VIEWER_SUPPORT_ALIAS_MAP.get(raw.toLowerCase()) || raw;
}

function viewerIsRollerSupport(value) {
    const normalized = viewerNormalizeSupportValue(value);
    return normalized === 'roller-x' || normalized === 'roller-y' || normalized === 'roller-z';
}

function viewerGetRollerAxis(value) {
    const normalized = viewerNormalizeSupportValue(value);
    if (normalized === 'roller-x') return 'x';
    if (normalized === 'roller-y') return 'y';
    if (normalized === 'roller-z') return 'z';
    return null;
}

const VIEWER_ROLLER_AXIS_COLORS = Object.freeze({
    x: { int: 0xe53935, hex: '#e53935', label: 'ローラー(X軸固定)' },
    y: { int: 0x1e88e5, hex: '#1e88e5', label: 'ローラー(Y軸固定)' },
    z: { int: 0x00897b, hex: '#00897b', label: 'ローラー(Z軸固定)' }
});

function viewerCreateAxisDirection(axis) {
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

function addViewerRollerSupportIndicator(group, position, axis) {
    if (!group || !position || !axis) return;
    const color = VIEWER_ROLLER_AXIS_COLORS[axis] || VIEWER_ROLLER_AXIS_COLORS.x;
    const markerGroup = new THREE.Group();
    markerGroup.position.copy(position);

    const braceMaterial = new THREE.MeshLambertMaterial({
        color: color.int,
        emissive: color.int,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.75
    });

    const plateSpan = 0.7;
    const plateThickness = 0.14;
    let plateGeometry = null;
    const offset = new THREE.Vector3();

    switch (axis) {
        case 'x':
            plateGeometry = new THREE.BoxGeometry(plateThickness, plateSpan, plateSpan);
            offset.set(0.45, 0, 0);
            break;
        case 'y':
            plateGeometry = new THREE.BoxGeometry(plateSpan, plateSpan, plateThickness);
            offset.set(0, 0, 0.45);
            break;
        case 'z':
            plateGeometry = new THREE.BoxGeometry(plateSpan, plateThickness, plateSpan);
            offset.set(0, 0.45, 0);
            break;
        default:
            return;
    }

    if (!plateGeometry) return;

    const brace = new THREE.Mesh(plateGeometry, braceMaterial);
    brace.position.copy(offset);
    markerGroup.add(brace);

    const clampGeometry = new THREE.BoxGeometry(plateThickness * 0.6, plateSpan * 0.6, plateSpan * 0.6);
    const clampMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
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
        const labelDistance = Math.max(0.9, offset.length() + 0.4);
        labelObject.position.copy(labelDirection.normalize().multiplyScalar(labelDistance));
        if (axis !== 'y') {
            labelObject.position.y += 0.2;
        }
        markerGroup.add(labelObject);
    }

    group.add(markerGroup);
}

const canvasContainer = document.getElementById('canvas-3d-container');
const infoPanel = document.getElementById('info-panel');

// ラベルグループ（表示/非表示制御用）
let nodeLabelsGroup, memberLabelsGroup, sectionLabelsGroup;

// ラベル表示状態
let labelVisibility = {
    nodes: true,
    members: true,
    sections: true
};

/**
 * 3Dシーンの初期化
 */
function init() {
    if (!canvasContainer) {
        console.error('3D canvas container not found');
        return;
    }

    if (getComputedStyle(canvasContainer).position === 'static') {
        canvasContainer.style.position = 'relative';
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(0, 5, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    canvasContainer.appendChild(renderer.domElement);

    if (axisRenderer) {
        if (axisRenderer.domElement && axisRenderer.domElement.parentNode) {
            axisRenderer.domElement.parentNode.removeChild(axisRenderer.domElement);
        }
        axisRenderer.dispose();
    }
    axisRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    axisRenderer.setPixelRatio(pixelRatio);
    axisRenderer.setSize(AXIS_CANVAS_SIZE, AXIS_CANVAS_SIZE);
    axisRenderer.autoClear = true;
    axisRenderer.setClearColor(0xf0f0f0, 1);

    const axisCanvas = axisRenderer.domElement;
    axisCanvas.style.position = 'absolute';
    axisCanvas.style.left = `${AXIS_MARGIN}px`;
    axisCanvas.style.bottom = `${AXIS_MARGIN}px`;
    axisCanvas.style.width = `${AXIS_CANVAS_SIZE}px`;
    axisCanvas.style.height = `${AXIS_CANVAS_SIZE}px`;
    axisCanvas.style.pointerEvents = 'none';
    axisCanvas.style.userSelect = 'none';
    axisCanvas.style.zIndex = '2';
    canvasContainer.appendChild(axisCanvas);

    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    canvasContainer.appendChild(labelRenderer.domElement);

    initAxisHelper();

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(50, 50, 50).normalize();
    scene.add(directionalLight);

    animate();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('message', receiveModelData);

    // localStorageの変更監視（メイン画面との接続が切れた場合のフォールバック）
    window.addEventListener('storage', (e) => {
        if (e.key === 'latestModelForViewer' && e.newValue) {
            try {
                const data = JSON.parse(e.newValue);
                console.log('viewer_3d: received model update via localStorage');

                if (infoPanel) {
                    const p = infoPanel.querySelector('p:last-child') || document.createElement('p');
                    if (!infoPanel.contains(p)) infoPanel.appendChild(p);
                    p.textContent = `最終更新(同期): ${new Date().toLocaleTimeString()}`;
                }

                update3DModel(data);
            } catch (err) {
                console.warn('viewer_3d: failed to parse latestModelForViewer from storage event', err);
            }
        }
    });

    // 起動時に localStorage に最新モデルがあれば反映する（ポップアップが後から開かれた場合のフォールバック）
    try {
        const latest = localStorage.getItem('latestModelForViewer');
        if (latest) {
            try {
                const parsed = JSON.parse(latest);
                console.log('viewer_3d: loaded latestModelForViewer from localStorage (fallback)');
                update3DModel(parsed);
            } catch (e) {
                console.warn('viewer_3d: failed to parse latestModelForViewer from localStorage', e);
            }
        }
    } catch (err) {
        console.warn('viewer_3d: unable to access localStorage for latestModelForViewer', err);
    }

    // チェックボックスのイベントリスナー設定
    setupLabelControls();
}

/**
 * メインウィンドウからのデータ受信と3Dモデル更新
 */
function receiveModelData(event) {
    try {
        console.log('viewer_3d: receiveModelData event received', event && event.data && event.data.type);
    } catch (e) { /* ignore */ }

    if (event.data && event.data.type === 'updateModel') {
        if (infoPanel) {
            const p = infoPanel.querySelector('p:last-child');
            if(p) p.textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
        }
        try {
            update3DModel(event.data.data);
            // ACK を localStorage に記録
            try {
                const ack = { ts: Date.now(), members: (event.data.data?.members || []).length };
                localStorage.setItem('latestModelForViewerAck', JSON.stringify(ack));
            } catch (lsErr) {
                console.warn('viewer_3d: failed to write latestModelForViewerAck', lsErr);
            }
        } catch (err) {
            console.error('viewer_3d: update3DModel failed on received message', err);
        }
    }
}

/**
 * 3Dモデルの再描画
 */
function update3DModel(data) {
    if (!data || !data.nodes || !data.members) return;

    // シーン内の全オブジェクトを完全に削除する再帰関数
    function disposeObject(obj) {
        if (!obj) return;

        if (obj.children && obj.children.length > 0) {
            const children = [...obj.children];
            children.forEach(child => {
                disposeObject(child);
                if (obj.children.includes(child)) {
                    obj.remove(child);
                }
            });
        }

        if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
            obj.element.parentNode.removeChild(obj.element);
        }

        if (obj.geometry && typeof obj.geometry.dispose === 'function') {
            obj.geometry.dispose();
        }

        const disposeMaterial = material => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach(m => m && typeof m.dispose === 'function' && m.dispose());
            } else if (typeof material.dispose === 'function') {
                material.dispose();
            }
        };

        if (obj.material) {
            disposeMaterial(obj.material);
        }
    }

    // シーン内の全オブジェクトを削除（ライトは除く）
    const objectsToRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => {
        scene.remove(obj);
        disposeObject(obj);
    });

    if (labelRenderer) {
        while (labelRenderer.domElement.firstChild) {
            labelRenderer.domElement.removeChild(labelRenderer.domElement.firstChild);
        }
    }

    const {
        nodes = [],
        members = [],
        nodeLoads = [],
        memberLoads = [],
        memberSelfWeights = [],
        nodeSelfWeights = []
    } = data;

    // 新しいモデルを構築
    build3DModel(scene, nodes, members, {
        nodeLoads,
        memberLoads,
        memberSelfWeights,
        nodeSelfWeights
    });
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (controls) controls.update();

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }

    renderAxisHelper();

    if (labelRenderer && scene && camera) {
        labelRenderer.render(scene, camera);
    }
}

function onWindowResize() {
    if (!canvasContainer || !camera || !renderer) return;

    const width = Math.max(1, canvasContainer.clientWidth);
    const height = Math.max(1, canvasContainer.clientHeight);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);

    if (labelRenderer) {
        labelRenderer.setSize(width, height);
    }

    if (axisRenderer) {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        axisRenderer.setPixelRatio(pixelRatio);
        axisRenderer.setSize(AXIS_CANVAS_SIZE, AXIS_CANVAS_SIZE);
    }
}

function initAxisHelper() {
    if (!axisRenderer) return;

    axisScene = new THREE.Scene();

    axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    axisCamera.position.set(0, 0, 4);

    axisHelper = new THREE.Group();
    axisScene.add(axisHelper);

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
        if (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
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
        if (arrow.cone.material) {
            arrow.cone.material.depthTest = false;
            arrow.cone.material.depthWrite = false;
        }
        if (arrow.line.material) {
            arrow.line.material.depthTest = false;
            arrow.line.material.depthWrite = false;
        }
        axisHelper.add(arrow);

        const labelSprite = createTextSprite(label, `#${color.toString(16).padStart(6, '0')}`);
        labelSprite.position.copy(normalized.clone().multiplyScalar(labelOffset));
        axisHelper.add(labelSprite);
    });

    const originSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x555555, depthTest: false, depthWrite: false })
    );
    originSphere.renderOrder = 1;
    axisHelper.add(originSphere);
}

function renderAxisHelper() {
    if (!axisScene || !axisCamera || !axisRenderer || !camera) {
        return;
    }

    if (axisHelper && camera) {
        axisHelper.quaternion.copy(camera.quaternion);
    }

    axisCamera.position.set(0, 0, 4);
    axisCamera.lookAt(0, 0, 0);
    axisCamera.updateMatrixWorld();

    axisRenderer.render(axisScene, axisCamera);
}

// --- 以下、frame_analyzer.jsから移植した3Dモデル構築ロジック ---

function build3DModel(scene, nodes, members, loadData = {}) {
    const {
        nodeLoads = [],
        memberLoads = [],
        memberSelfWeights = [],
        nodeSelfWeights = []
    } = loadData || {};

    const COLORS = {
        externalDistributed: { int: 0xff4500, hex: '#ff4500' },
        externalConcentrated: { int: 0x1e90ff, hex: '#1e90ff' },
        selfWeight: { int: 0x00aa00, hex: '#00aa00' }
    };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const formatValue = (value, decimals = 2) => {
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
        element.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        element.style.padding = '2px 4px';
        element.style.borderRadius = '3px';
        element.style.border = `1px solid ${colorHex}`;
        element.style.pointerEvents = 'none';
        element.style.userSelect = 'none';

        const label = new THREE.CSS2DObject(element);
        label.position.copy(position);
        return label;
    };

    const createSupportLabel = (text, position, colorHex) => {
        if (typeof THREE.CSS2DObject === 'undefined') return null;
        const element = document.createElement('div');
        element.className = 'support-label-3d';
        element.textContent = text;
        element.style.color = colorHex;
        element.style.fontWeight = 'bold';
        element.style.fontSize = '11px';
        element.style.backgroundColor = 'rgba(255, 255, 255, 0.92)';
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
        const normalized = axis.clone().normalize();
        if (!isFinite(normalized.lengthSq()) || normalized.lengthSq() === 0) return;

        const direction = normalized.clone().multiplyScalar(Math.sign(magnitude) || 1);
        const arrowLength = clamp(Math.abs(magnitude) * 0.2 + 0.6, 0.6, 3.0);
        const arrowOrigin = origin.clone().sub(direction.clone().multiplyScalar(arrowLength));
        const arrowHeadLength = Math.min(arrowLength * 0.3, 0.6);
        const arrowHeadWidth = arrowHeadLength * 0.6;

        const arrow = new THREE.ArrowHelper(direction, arrowOrigin, arrowLength, color.int, arrowHeadLength, arrowHeadWidth);
        group.add(arrow);

        const labelShift = Math.min(arrowLength * 0.25, 0.35);
        const labelPosition = arrowOrigin.clone().add(direction.clone().multiplyScalar(arrowLength - labelShift));
        const label = createLoadLabel(`${labelPrefix}${formatValue(magnitude)}${unit}`, labelPosition, color.hex);
        if (label) group.add(label);
    };

    const addMomentIndicator = (group, origin, axis, magnitude, color, labelPrefix) => {
        if (!axis || !isFinite(magnitude) || Math.abs(magnitude) < 1e-6) return;

        const normalized = axis.clone().normalize();
        if (!isFinite(normalized.lengthSq()) || normalized.lengthSq() === 0) return;

        const radius = clamp(0.45 + Math.abs(magnitude) * 0.05, 0.45, 1.6);
        const tubeRadius = radius * 0.08;

        const geometry = new THREE.TorusGeometry(radius, tubeRadius, 16, 48);
        const material = new THREE.MeshBasicMaterial({ color: color.int, transparent: true, opacity: 0.85 });
        const torus = new THREE.Mesh(geometry, material);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalized);
        torus.quaternion.copy(quaternion);
        torus.position.copy(origin);
        group.add(torus);

        const labelPosition = origin.clone()
            .add(normalized.clone().multiplyScalar(radius + 0.25))
            .add(new THREE.Vector3(0, 0.15, 0));
        const label = createLoadLabel(`${labelPrefix}${formatValue(magnitude)}kN·m`, labelPosition, color.hex);
        if (label) group.add(label);
    };

    const memberGroup = new THREE.Group();
    const loadGroup = new THREE.Group();
    const nodePositions = [];
    const nodeMaterial = new THREE.MeshLambertMaterial({ color: 0x1565C0 });
    const nodeGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);

    // ラベルグループを初期化
    nodeLabelsGroup = new THREE.Group();
    memberLabelsGroup = new THREE.Group();
    sectionLabelsGroup = new THREE.Group();

    nodes.forEach((node, i) => {
        const nodeMesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        const nodeY = node.y !== undefined ? node.y : 0;  // 入力Y座標(水平)
        const nodeZ = node.z !== undefined ? node.z : 0;  // 入力Z座標(鉛直)
        const nodePosition = new THREE.Vector3(node.x, nodeZ, nodeY);
        nodeMesh.position.copy(nodePosition);  // Three.js: (X水平, Y鉛直上向き, Z水平)
        memberGroup.add(nodeMesh);
        nodePositions[i] = nodePosition.clone();

        const supportType = viewerNormalizeSupportValue(node.support);

        if (supportType === 'pinned') {
            const supportMaterial = new THREE.MeshLambertMaterial({ color: 0xFF0000 });
            const supportSphere = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), supportMaterial);
            supportSphere.position.copy(nodePosition);
            memberGroup.add(supportSphere);

            const label = createSupportLabel('ピン', nodePosition.clone().add(new THREE.Vector3(0, -0.45, 0)), '#ff0000');
            if (label) memberGroup.add(label);
        } else if (supportType === 'fixed') {
            const supportMaterial = new THREE.MeshLambertMaterial({ color: 0x00FF00 });
            const supportBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), supportMaterial);
            supportBox.position.copy(nodePosition);
            memberGroup.add(supportBox);

            const label = createSupportLabel('固定', nodePosition.clone().add(new THREE.Vector3(0, -0.45, 0)), '#00ff00');
            if (label) memberGroup.add(label);
        } else if (viewerIsRollerSupport(supportType)) {
            const axis = viewerGetRollerAxis(supportType);
            if (axis) {
                addViewerRollerSupportIndicator(memberGroup, nodePosition, axis);
            }
        }

        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'label';
        nodeDiv.textContent = `N${i + 1}`;
        const nodeLabel = new THREE.CSS2DObject(nodeDiv);
        nodeLabel.position.copy(nodePosition).add(new THREE.Vector3(0, 0.5, 0));
        nodeLabelsGroup.add(nodeLabel);
    });

    members.forEach((member, index) => {
        try {
            const memberMesh = createMemberMesh(member, nodes);
            if (memberMesh) {
                memberGroup.add(memberMesh);

                const p1 = nodes[member.i];
                const p2 = nodes[member.j];
                const centerX = (p1.x + p2.x) / 2;
                const y1 = p1.y !== undefined ? p1.y : 0;  // 入力Y座標(実際はZ方向)
                const y2 = p2.y !== undefined ? p2.y : 0;
                const z1 = p1.z !== undefined ? p1.z : 0;  // 入力Z座標(実際はY方向)
                const z2 = p2.z !== undefined ? p2.z : 0;
                const centerY = (y1 + y2) / 2;
                const centerZ = (z1 + z2) / 2;

                // 部材番号ラベル(Three.js座標系)
                const memberDiv = document.createElement('div');
                memberDiv.className = 'label';
                memberDiv.textContent = `M${index + 1}`;
                const memberLabel = new THREE.CSS2DObject(memberDiv);
                memberLabel.position.set(centerX, centerZ, centerY);
                memberLabelsGroup.add(memberLabel);

                // 断面名称ラベル（部材ラベルの少し下に配置）
                const sectionName = getSectionName(member);
                if (sectionName) {
                    const sectionDiv = document.createElement('div');
                    sectionDiv.className = 'label-section';
                    sectionDiv.textContent = sectionName;
                    const sectionLabel = new THREE.CSS2DObject(sectionDiv);
                    sectionLabel.position.set(centerX, centerZ - 0.3, centerY);
                    sectionLabelsGroup.add(sectionLabel);
                }
            }
        } catch(e) {
            console.warn(`部材 ${member.i+1}-${member.j+1} の3Dメッシュ作成に失敗しました:`, e);
        }
    });

    // 部材等分布荷重の描画
    const distributedLoads = [];
    memberLoads.forEach(load => {
        distributedLoads.push({
            memberIndex: load.memberIndex,
            wx: Number(load.wx) || 0,
            wy: Number(load.wy) || 0,
            wz: Number(load.wz) || 0,
            legacyW: Number(load.w) || 0,
            isFromSelfWeight: !!load.isFromSelfWeight
        });
    });

    // 3Dビューワでは部材自重の等分布荷重は描画しない

    if (distributedLoads.length > 0) {
        const numArrows = 5;
        const arrowLength = 0.8;
        const arrowHeadLength = arrowLength * 0.25;
        const arrowHeadWidth = arrowLength * 0.18;

        distributedLoads.forEach(load => {
            if (load.isFromSelfWeight) return;

            const member = members[load.memberIndex];
            if (!member) return;
            const p1 = nodePositions[member.i];
            const p2 = nodePositions[member.j];
            if (!p1 || !p2) return;

            const wx = load.wx || 0;
            const wy = load.wy || 0;
            const wz = load.wz || 0;
            const legacyW = (!wz && load.legacyW) ? load.legacyW : 0;

            const components = [];
            const addComponent = (key, value, vector) => {
                if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return;
                components.push({ key, value, vector });
            };

            addComponent('wx', wx, new THREE.Vector3(1, 0, 0));
            addComponent('wy', wy, new THREE.Vector3(0, 0, 1));
            addComponent('wz', wz, new THREE.Vector3(0, -1, 0));
            if (!wz) {
                addComponent('legacyW', legacyW, new THREE.Vector3(0, -1, 0));
            }

            if (components.length === 0) return;

            const color = COLORS.externalDistributed;

            for (let i = 0; i <= numArrows; i++) {
                const t = i / numArrows;
                const position = new THREE.Vector3().lerpVectors(p1, p2, t);

                components.forEach(component => {
                    const sign = Math.sign(component.value) || 1;
                    const baseDir = component.vector.clone().normalize().multiplyScalar(sign);
                    const offset = baseDir.clone().multiplyScalar(arrowLength);
                    const shouldFlipOrigin = component.key === 'wx' || component.key === 'wy';
                    const origin = shouldFlipOrigin ? position.clone().sub(offset) : position.clone().add(offset);
                    const direction = shouldFlipOrigin ? baseDir : baseDir.clone().multiplyScalar(-1);
                    const arrow = new THREE.ArrowHelper(direction, origin, arrowLength, color.int, arrowHeadLength, arrowHeadWidth);
                    loadGroup.add(arrow);
                });
            }

            const labelParts = [];
            const labelMap = {
                wx: value => `Wx=${formatValue(value)}kN/m`,
                wy: value => `Wy=${formatValue(value)}kN/m`,
                wz: value => `Wz=${formatValue(value)}kN/m`,
                legacyW: value => `W=${formatValue(value)}kN/m`
            };
            components.forEach(component => {
                const formatter = labelMap[component.key];
                if (formatter) {
                    labelParts.push(formatter(component.value));
                }
            });
            if (labelParts.length > 0) {
                const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                const offset = new THREE.Vector3();
                components.forEach(component => {
                    const sign = Math.sign(component.value) || 1;
                    const baseOffset = component.vector.clone().normalize().multiplyScalar(sign * 0.6);
                    offset.add(baseOffset);
                });
                if (offset.lengthSq() === 0) offset.y = 0.6;

                const label = createLoadLabel(labelParts.join(' '), midpoint.clone().add(offset), color.hex);
                if (label) loadGroup.add(label);
            }
        });
    }

    // 節点荷重の描画
    const nodeLoadsCombined = [];
    nodeLoads.forEach(load => nodeLoadsCombined.push({ ...load, isFromSelfWeight: false }));
    // 3Dビューワでは節点自重荷重は描画しない

    if (nodeLoadsCombined.length > 0) {
        nodeLoadsCombined.forEach(load => {
            const position = nodePositions[load.nodeIndex];
            if (!position) return;
            const color = COLORS.externalConcentrated;

            addForceArrow(loadGroup, position, new THREE.Vector3(1, 0, 0), load.px || 0, color, 'Px=', 'kN');
            addForceArrow(loadGroup, position, new THREE.Vector3(0, 0, 1), load.py || 0, color, 'Py=', 'kN');
            addForceArrow(loadGroup, position, new THREE.Vector3(0, 1, 0), load.pz || 0, color, 'Pz=', 'kN');

            addMomentIndicator(loadGroup, position, new THREE.Vector3(1, 0, 0), load.mx || 0, color, 'Mx=');
            addMomentIndicator(loadGroup, position, new THREE.Vector3(0, 0, 1), load.my || 0, color, 'My=');
            addMomentIndicator(loadGroup, position, new THREE.Vector3(0, 1, 0), load.mz || 0, color, 'Mz=');
        });
    }

    if (loadGroup.children.length > 0) {
        memberGroup.add(loadGroup);
    }

    scene.add(memberGroup);
    scene.add(nodeLabelsGroup);
    scene.add(memberLabelsGroup);
    scene.add(sectionLabelsGroup);

    // 現在の表示状態を適用
    setGroupVisibility(nodeLabelsGroup, labelVisibility.nodes);
    setGroupVisibility(memberLabelsGroup, labelVisibility.members);
    setGroupVisibility(sectionLabelsGroup, labelVisibility.sections);

    const box = new THREE.Box3().setFromObject(memberGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (!isFinite(maxDim) || maxDim === 0) {
        camera.position.set(0, 0, 50);
        controls.target.set(0, 0, 0);
    } else {
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;

        camera.position.set(center.x, center.y, center.z + cameraZ);
        controls.target.copy(center);
    }
    controls.update();
}

function createMemberMesh(member, nodes) {
    const nodeI = nodes[member.i];
    const nodeJ = nodes[member.j];

    if (!nodeI || !nodeJ) return null;

    // 3D対応: 入力(X,Y,Z) → Three.js(X,Z,Y)でZ=鉛直
    const y1 = nodeI.y !== undefined ? nodeI.y : 0;
    const y2 = nodeJ.y !== undefined ? nodeJ.y : 0;
    const z1 = nodeI.z !== undefined ? nodeI.z : 0;
    const z2 = nodeJ.z !== undefined ? nodeJ.z : 0;
    const p1 = new THREE.Vector3(nodeI.x, z1, y1);  // Three.js: (X水平, Y鉛直, Z水平)
    const p2 = new THREE.Vector3(nodeJ.x, z2, y2);
    const memberLength = p1.distanceTo(p2);
    if (memberLength <= 0) return null;

    if (!member.sectionInfo || !member.sectionInfo.rawDims) {
        // 推定断面は円形で計算
        // member.Aはm²単位なので、cm²に変換
        const A_m2 = member.A || 1e-3; // m²
        const A_cm2 = A_m2 * 1e4; // m² → cm²

        // A = π * r^2 より r = sqrt(A / π)
        const radius_cm = Math.sqrt(A_cm2 / Math.PI); // cm
        const diameter_cm = radius_cm * 2; // cm
        const diameter_mm = diameter_cm * 10; // mm に変換

        member.sectionInfo = {
            rawDims: {
                D: diameter_mm,  // 実際の直径（mm）を保存
                D_scaled: diameter_mm  // 3D表示用の直径（スケーリングなし）
            },
            typeKey: 'estimated',
            label: '推定断面（円形）'
        };
    }

    const shape = createSectionShape(member.sectionInfo, member);
    if (!shape) return null;

    const extrudeSettings = { depth: memberLength, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const isEstimated = member.sectionInfo.typeKey === 'estimated';

    // より見やすいマテリアル設定
    const material = new THREE.MeshStandardMaterial({
        color: isEstimated ? 0xFF8C00 : 0x8B9DC3,  // 推定断面:オレンジ / 通常:ライトブルー
        metalness: 0.3,
        roughness: 0.7,
        flatShading: false
    });

    const mesh = new THREE.Mesh(geometry, material);

    // エッジラインを追加（断面形状を強調）
    const edgesGeometry = new THREE.EdgesGeometry(geometry, 15); // 15度以上の角度のエッジのみ
    const edgesMaterial = new THREE.LineBasicMaterial({
        color: 0x000000,
        linewidth: 1,
        transparent: true,
        opacity: 0.5,
        depthTest: false // 正面からも見えるように
    });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    mesh.add(edges);

    const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
    const isVertical = Math.abs(direction.y) > 0.95;

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

    mesh.position.copy(p1);
    mesh.up.set(isVertical ? 1 : 0, isVertical ? 0 : 1, 0);
    mesh.lookAt(p2);

    if (isVertical) {
        mesh.rotateZ(Math.PI / 2);
        if (axisKey === 'y') {
            mesh.rotateZ(Math.PI / 2);
        }
    } else if (axisKey === 'y') {
        mesh.rotateZ(Math.PI / 2);
    }

    const hingeGroup = new THREE.Group();
    const redMaterial = new THREE.MeshLambertMaterial({ color: 0xFF0000 });
    const whiteMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });

    const springGroup = new THREE.Group();
    const springLineMaterial = new THREE.LineBasicMaterial({ color: 0xE65100 });

    const createSpring = (origin, axisDir, opts = {}) => {
        const length = opts.length ?? 0.35;
        const radius = opts.radius ?? 0.06;
        const turns = opts.turns ?? 5;
        const segments = opts.segments ?? 60;

        const dir = axisDir.clone().normalize();
        const tmpUp = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0))) > 0.9
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 1, 0);
        const n1 = new THREE.Vector3().crossVectors(dir, tmpUp).normalize();
        const n2 = new THREE.Vector3().crossVectors(dir, n1).normalize();

        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const along = t * length;
            const ang = t * turns * Math.PI * 2;
            const offset = new THREE.Vector3()
                .addScaledVector(n1, Math.cos(ang) * radius)
                .addScaledVector(n2, Math.sin(ang) * radius);
            const p = origin.clone()
                .addScaledVector(dir, along)
                .add(offset);
            points.push(p);
        }
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geom, springLineMaterial);
    };

    const createHinge = () => {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 32), redMaterial);
        const group = new THREE.Group();
        group.add(sphere);
        return group;
    };

    if (member.i_conn === 'pinned') {
        const hingeI = createHinge();
        hingeI.position.copy(p1).addScaledVector(direction, 0.35);
        hingeGroup.add(hingeI);
    }

    if (member.i_conn === 'spring') {
        const origin = p1.clone().addScaledVector(direction, 0.2);
        springGroup.add(createSpring(origin, direction));
    }

    if (member.j_conn === 'pinned') {
        const hingeJ = createHinge();
        hingeJ.position.copy(p2).addScaledVector(direction, -0.35);
        hingeGroup.add(hingeJ);
    }

    if (member.j_conn === 'spring') {
        const origin = p2.clone().addScaledVector(direction, -0.2);
        springGroup.add(createSpring(origin, direction.clone().negate()));
    }

    if (hingeGroup.children.length > 0 || springGroup.children.length > 0) {
        const combinedGroup = new THREE.Group();
        combinedGroup.add(mesh);
        if (hingeGroup.children.length > 0) combinedGroup.add(hingeGroup);
        if (springGroup.children.length > 0) combinedGroup.add(springGroup);
        return combinedGroup;
    }

    return mesh;
}

function createSectionShape(sectionInfo, member) {
    const dims = sectionInfo.rawDims;
    const typeKey = sectionInfo.typeKey;
    if (!dims || !typeKey) return null;
    const shape = new THREE.Shape();
    const MM_TO_M = 0.001;

    switch (typeKey) {
        case 'hkatakou_hiro':
        case 'hkatakou_naka':
        case 'hkatakou_hoso':
        case 'ikatakou':
        case 'keiryouhkatakou':
        case 'keiryourippuhkatakou': {
            const { H, B, t1, t2 } = dims;
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
            break;
        }
        case 'seihoukei':
        case 'tyouhoukei': {
            const A = dims.A, B = dims.B || A, t = dims.t;
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
            break;
        }
        case 'koukan': {
            const { D, t } = dims;
            if (!D || !t) return null;
            const Dm = D * MM_TO_M;
            const tm = t * MM_TO_M;
            const outerRadius = Dm / 2;
            const innerRadius = outerRadius - tm;
            shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
            const hole = new THREE.Path();
            hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            break;
        }
        case 'mizogatakou':
        case 'keimizogatakou': {
            const { H, B, t1, t2, A, t } = dims;
            const height = H * MM_TO_M;
            const flangeWidth = (B || A) * MM_TO_M;
            const webThick = (t1 || t) * MM_TO_M;
            const flangeThick = (t2 || t) * MM_TO_M;
            if(!height || !flangeWidth || !webThick || !flangeThick) return null;
            const halfH = height / 2;
            shape.moveTo(0, halfH);
            shape.lineTo(flangeWidth, halfH);
            shape.lineTo(flangeWidth, halfH - flangeThick);
            shape.lineTo(webThick, halfH - flangeThick);
            shape.lineTo(webThick, -halfH + flangeThick);
            shape.lineTo(flangeWidth, -halfH + flangeThick);
            shape.lineTo(flangeWidth, -halfH);
            shape.lineTo(0, -halfH);
            shape.lineTo(0, halfH);
            break;
        }
        case 'rippumizokatakou': {
            const { H, A, C, t } = dims;
            if (!H || !A || !C || !t) return null;
            const height = H * MM_TO_M;
            const flangeWidth = A * MM_TO_M;
            const lip = C * MM_TO_M;
            const thick = t * MM_TO_M;
            const halfH = height / 2;
            shape.moveTo(0, halfH);
            shape.lineTo(flangeWidth, halfH);
            shape.lineTo(flangeWidth, halfH - lip);
            shape.lineTo(flangeWidth - thick, halfH - lip);
            shape.lineTo(flangeWidth - thick, halfH - thick);
            shape.lineTo(thick, halfH - thick);
            shape.lineTo(thick, -halfH + thick);
            shape.lineTo(flangeWidth-thick, -halfH+thick);
            shape.lineTo(flangeWidth-thick, -halfH+lip);
            shape.lineTo(flangeWidth,-halfH+lip);
            shape.lineTo(flangeWidth,-halfH);
            shape.lineTo(0,-halfH);
            shape.lineTo(0,halfH);
            break;
        }
        case 'touhenyamakatakou':
        case 'futouhenyamagata': {
            const { A, B, t } = dims;
            const a = (A || 0) * MM_TO_M;
            const b = (B || A || 0) * MM_TO_M;
            const thick = (t || 0) * MM_TO_M;
            if (!a || !b || !thick) return null;
            shape.moveTo(0, a);
            shape.lineTo(thick, a);
            shape.lineTo(thick, thick);
            shape.lineTo(b, thick);
            shape.lineTo(b, 0);
            shape.lineTo(0, 0);
            shape.lineTo(0, a);
            break;
        }
        case '矩形':
        case 'rectangular': {
            const { H, B } = dims;
            if (!H || !B) return null;
            const height = H * MM_TO_M;
            const width = B * MM_TO_M;
            const halfH = height / 2;
            const halfB = width / 2;
            shape.moveTo(-halfB, -halfH);
            shape.lineTo(halfB, -halfH);
            shape.lineTo(halfB, halfH);
            shape.lineTo(-halfB, halfH);
            shape.lineTo(-halfB, -halfH);
            break;
        }
        case '円形':
        case 'circular': {
            const { D } = dims;
            if (!D) return null;
            const radius = (D * MM_TO_M) / 2;
            shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            break;
        }
        case 'estimated':
        default: {
            // 推定断面は円形で表示
            // 3D表示用のスケール済み直径を使用
            if (dims.D_scaled) {
                const radius = (dims.D_scaled * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            } else if (dims.D) {
                // D_scaledがない場合はDを使用（スケーリングなし）
                const radius = (dims.D * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            } else {
                // 旧データ対応: memberから直接計算
                const A_m2 = member.A || 1e-3; // m²
                const A_cm2 = A_m2 * 1e4; // m² → cm²
                const radius_cm = Math.sqrt(A_cm2 / Math.PI);
                const diameter_mm = radius_cm * 2 * 10; // cm → mm（スケーリングなし）
                const radius = (diameter_mm * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            }
            break;
        }
    }
    return shape;
}

/**
 * 部材の断面名称を取得（板厚まで含んだ完全な名称）
 */
function getSectionName(member) {
    if (!member.sectionInfo) return null;

    const typeKey = member.sectionInfo.typeKey;
    const dims = member.sectionInfo.rawDims;

    // typeKeyから推定の場合
    if (typeKey === 'estimated') {
        // 直径情報がある場合は表示（実際の直径をそのまま使用）
        if (dims && dims.D) {
            const diameter = dims.D.toFixed(1);
            return `推定断面 φ${diameter}`;
        }
        return '推定断面（円形）';
    }

    // rawDimsがない場合は既存のlabelを使用
    if (!dims) {
        return member.sectionInfo.label || null;
    }

    // 形状タイプに応じて板厚まで含んだ名称を生成
    switch (typeKey) {
        case 'hkatakou_hiro':
        case 'hkatakou_naka':
        case 'hkatakou_hoso':
            return `H-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'ikatakou':
            return `I-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'keiryouhkatakou':
            return `H-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'keiryourippuhkatakou':
            return `H-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'seihoukei':
        case 'tyouhoukei':
            return `□-${dims.A}×${dims.B || dims.A}×${dims.t}`;
        case 'koukan':
            return `○-${dims.D}×${dims.t}`;
        case 'mizogatakou':
        case 'keimizogatakou':
            return `C-${dims.H}×${dims.B || dims.A}×${dims.t1 || dims.t}×${dims.t2 || dims.t}`;
        case 'rippumizokatakou':
            return `C-${dims.H}×${dims.A}×${dims.C}×${dims.t}`;
        case 'touhenyamakatakou':
            return `L-${dims.A}×${dims.A}×${dims.t}`;
        case 'futouhenyamagata':
            return `L-${dims.A}×${dims.B}×${dims.t}`;
        case '矩形':
        case 'rectangular':
            return `矩形-${dims.H}×${dims.B}`;
        case '円形':
        case 'circular':
            return `円形-φ${dims.D}`;
        default:
            // typeKeyがあるがswitchに該当しない場合、labelを使用
            return member.sectionInfo.label || null;
    }
}

/**
 * ラベルグループ内の全要素のvisibleを設定
 */
function setGroupVisibility(group, visible) {
    if (!group) return;
    group.visible = visible;
    group.children.forEach(child => {
        child.visible = visible;
    });
}

/**
 * ラベル表示制御のセットアップ
 */
function setupLabelControls() {
    const showNodeLabels = document.getElementById('show-node-labels');
    const showMemberLabels = document.getElementById('show-member-labels');
    const showSectionLabels = document.getElementById('show-section-labels');

    if (showNodeLabels) {
        showNodeLabels.addEventListener('change', (e) => {
            labelVisibility.nodes = e.target.checked;
            setGroupVisibility(nodeLabelsGroup, e.target.checked);
        });
    }

    if (showMemberLabels) {
        showMemberLabels.addEventListener('change', (e) => {
            labelVisibility.members = e.target.checked;
            setGroupVisibility(memberLabelsGroup, e.target.checked);
        });
    }

    if (showSectionLabels) {
        showSectionLabels.addEventListener('change', (e) => {
            labelVisibility.sections = e.target.checked;
            setGroupVisibility(sectionLabelsGroup, e.target.checked);
        });
    }
}

// アプリケーションを開始
init();
