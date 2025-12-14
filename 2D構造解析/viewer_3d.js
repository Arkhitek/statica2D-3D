// viewer_3d.js

if (typeof THREE === 'undefined') {
    alert('3D描画ライブラリ(Three.js)が読み込まれていません。');
    throw new Error('Three.js not found');
}

// 3Dシーン用のグローバル変数
let scene, camera, renderer, controls, labelRenderer, animationFrameId;
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
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(0, 5, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    canvasContainer.appendChild(renderer.domElement);

    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    canvasContainer.appendChild(labelRenderer.domElement);

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

    // ▼▼▼ 追加: localStorageの変更監視（メイン画面との接続が切れた場合のフォールバック）
    window.addEventListener('storage', (e) => {
        if (e.key === 'latestModelForViewer' && e.newValue) {
            try {
                const data = JSON.parse(e.newValue);
                console.log('🔧 viewer_3d: localStorage経由でモデル更新を受信しました');

                if (infoPanel) {
                    const p = infoPanel.querySelector('p:last-child') || document.createElement('p');
                    if (!infoPanel.contains(p)) infoPanel.appendChild(p);
                    p.textContent = `最終更新(同期): ${new Date().toLocaleTimeString()}`;
                }

                update3DModel(data);
            } catch (err) {
                console.warn('viewer_3d: localStorageデータのパースに失敗しました', err);
            }
        }
    });
    // ▲▲▲ 追加終了 ▲▲▲

    // 起動時に localStorage に最新モデルがあれば反映する（ポップアップが後から開かれた場合のフォールバック）
    try {
        const latest = localStorage.getItem('latestModelForViewer');
        if (latest) {
            try {
                const parsed = JSON.parse(latest);
                console.log('🔧 viewer_3d: loaded latestModelForViewer from localStorage (fallback)');
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
    // ログと ACK を追加して受信確認をしやすくする
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
                console.log('viewer_3d: wrote latestModelForViewerAck to localStorage', ack);
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

    // 受信データの要約ログ
    try {
        console.log('viewer_3d: update3DModel called', {
            nodes: data.nodes.length,
            members: data.members.length,
            sampleMember0: data.members[0] ? { sectionInfo: data.members[0].sectionInfo?.typeKey || null } : null
        });
    } catch (e) { /* ignore */ }

    // シーン内の全オブジェクトを完全に削除する再帰関数
    function disposeObject(obj) {
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
        // 子要素を再帰的に削除
        while (obj.children.length > 0) {
            const child = obj.children[0];
            disposeObject(child);
            obj.remove(child);
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
        disposeObject(obj);
        scene.remove(obj);
    });

    // 新しいモデルを構築
    build3DModel(scene, data.nodes, data.members);
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// --- 以下、frame_analyzer.jsから移植した3Dモデル構築ロジック ---

function build3DModel(scene, nodes, members) {
    const memberGroup = new THREE.Group();
    const nodeMaterial = new THREE.MeshLambertMaterial({ color: 0x1565C0 });
    const nodeGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);

    // ラベルグループを初期化
    nodeLabelsGroup = new THREE.Group();
    memberLabelsGroup = new THREE.Group();
    sectionLabelsGroup = new THREE.Group();

    nodes.forEach((node, i) => {
        const nodeMesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        nodeMesh.position.set(node.x, node.y, 0);
        memberGroup.add(nodeMesh);

        // 支点描画を追加
        let direction = 'floor';
        const support = node.support || node.s;
        if (support === 'fixed') {
             // 節点に接続する部材を探す
             const connectedMembers = members.filter(m => m.i === i || m.j === i);
             if (connectedMembers.length > 0) {
                let allDown = true;
                let allRight = true;
                let allLeft = true;
                let isHorizontal = true;

                for (const m of connectedMembers) {
                    const otherNodeIndex = (m.i === i) ? m.j : m.i;
                    const otherNode = nodes[otherNodeIndex];
                    
                    const dx = otherNode.x - node.x;
                    const dy = otherNode.y - node.y;
                    
                    // Three.js (数学座標系) なので y上向き正
                    if (dy > 1e-5) allDown = false;
                    if (dx < -1e-5) allRight = false;
                    if (dx > 1e-5) allLeft = false;
                    
                    if (Math.abs(dy) > Math.abs(dx) * 0.5) isHorizontal = false;
                }

                if (allDown && !isHorizontal) direction = 'ceiling';
                else if (allRight && isHorizontal) direction = 'left-wall';
                else if (allLeft && isHorizontal) direction = 'right-wall';
             }
        }

        const supportMesh = createSupportMesh(support, direction);
        if (supportMesh) {
            supportMesh.position.set(node.x, node.y, 0);
            memberGroup.add(supportMesh);
        }

        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'label';
        nodeDiv.textContent = `N${i + 1}`;
        const nodeLabel = new THREE.CSS2DObject(nodeDiv);
        nodeLabel.position.set(node.x, node.y, 0.5);
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
                const centerY = (p1.y + p2.y) / 2;

                // 部材番号ラベル
                const memberDiv = document.createElement('div');
                memberDiv.className = 'label';
                memberDiv.textContent = `M${index + 1}`;
                const memberLabel = new THREE.CSS2DObject(memberDiv);
                memberLabel.position.set(centerX, centerY, 0);
                memberLabelsGroup.add(memberLabel);

                // 断面名称ラベル（部材ラベルの少し下に配置）
                const sectionName = getSectionName(member);
                if (sectionName) {
                    const sectionDiv = document.createElement('div');
                    sectionDiv.className = 'label-section';
                    sectionDiv.textContent = sectionName;
                    const sectionLabel = new THREE.CSS2DObject(sectionDiv);
                    sectionLabel.position.set(centerX, centerY - 0.3, 0);
                    sectionLabelsGroup.add(sectionLabel);
                }
            }
        } catch(e) {
            console.warn(`部材 ${member.i+1}-${member.j+1} の3Dメッシュ作成に失敗しました:`, e);
        }
    });

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

    const p1 = new THREE.Vector3(nodeI.x, nodeI.y, 0);
    const p2 = new THREE.Vector3(nodeJ.x, nodeJ.y, 0);
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

    mesh.position.copy(p1);
    mesh.up.set(isVertical ? 1 : 0, isVertical ? 0 : 1, 0);
    mesh.lookAt(p2);

    if (member.sectionAxis && member.sectionAxis.key === 'y') {
        mesh.rotateZ(Math.PI / 2);
    }

    const hingeGroup = new THREE.Group();
    const redMaterial = new THREE.MeshLambertMaterial({ color: 0xFF0000 });
    const whiteMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });

    const createHinge = () => {
        const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 32), redMaterial);
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.051, 32), whiteMaterial);
        outer.rotation.x = inner.rotation.x = Math.PI / 2;
        const group = new THREE.Group();
        group.add(outer, inner);
        return group;
    };

    if (member.i_conn === 'pinned') {
        const hingeI = createHinge();
        hingeI.position.copy(p1).addScaledVector(direction, 0.35);
        hingeGroup.add(hingeI);
    }

    if (member.j_conn === 'pinned') {
        const hingeJ = createHinge();
        hingeJ.position.copy(p2).addScaledVector(direction, -0.35);
        hingeGroup.add(hingeJ);
    }

    if (hingeGroup.children.length > 0) {
        const combinedGroup = new THREE.Group();
        combinedGroup.add(mesh, hingeGroup);
        return combinedGroup;
    }

    return mesh;
}

/**
 * 支点メッシュを作成する関数
 */
function createSupportMesh(supportType, direction = 'floor') {
    if (!supportType || supportType === 'free') return null;

    const group = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color: 0x008000 }); // 緑色

    if (supportType === 'fixed') {
        const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const mesh = new THREE.Mesh(geometry, material);
        
        if (direction === 'left-wall') {
             // 左壁固定 (右向き)
             const plateGeo = new THREE.BoxGeometry(0.1, 1.0, 1.0);
             const plate = new THREE.Mesh(plateGeo, material);
             plate.position.x = -0.4;
             group.add(mesh);
             group.add(plate);
        } else if (direction === 'right-wall') {
             // 右壁固定 (左向き)
             const plateGeo = new THREE.BoxGeometry(0.1, 1.0, 1.0);
             const plate = new THREE.Mesh(plateGeo, material);
             plate.position.x = 0.4;
             group.add(mesh);
             group.add(plate);
        } else if (direction === 'ceiling') {
             // 天井固定 (上向き)
             const plateGeo = new THREE.BoxGeometry(1.0, 0.1, 1.0);
             const plate = new THREE.Mesh(plateGeo, material);
             plate.position.y = 0.4;
             group.add(mesh);
             group.add(plate);
        } else {
             // 床固定 (下向き) - デフォルト
             const plateGeo = new THREE.BoxGeometry(1.0, 0.1, 1.0);
             const plate = new THREE.Mesh(plateGeo, material);
             plate.position.y = -0.4;
             group.add(mesh);
             group.add(plate);
        }
    } else if (supportType === 'fixed-x') {
        // 後方互換性のため残すが、基本は fixed + direction で処理される
        const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const mesh = new THREE.Mesh(geometry, material);
        const plateGeo = new THREE.BoxGeometry(0.1, 1.0, 1.0);
        const plate = new THREE.Mesh(plateGeo, material);
        plate.position.x = -0.4;
        group.add(mesh);
        group.add(plate);
    } else if (supportType === 'fixed-top') {
        // 後方互換性
        const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const mesh = new THREE.Mesh(geometry, material);
        const plateGeo = new THREE.BoxGeometry(1.0, 0.1, 1.0);
        const plate = new THREE.Mesh(plateGeo, material);
        plate.position.y = 0.4;
        group.add(mesh);
        group.add(plate);
    } else if (supportType === 'pinned') {
        const geometry = new THREE.ConeGeometry(0.4, 0.6, 4);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = Math.PI; // 逆さまにする（頂点が下）
        mesh.rotation.y = Math.PI / 4; // 45度回転させて角を合わせる
        mesh.position.y = -0.5; // 節点の下に配置
        group.add(mesh);
    } else if (supportType === 'roller' || supportType === 'roller_y_fixed') {
        // 床ローラー (水平自由)
        const coneGeo = new THREE.ConeGeometry(0.4, 0.6, 4);
        const cone = new THREE.Mesh(coneGeo, material);
        cone.rotation.x = Math.PI;
        cone.rotation.y = Math.PI / 4;
        cone.position.y = -0.5;
        
        const plateGeo = new THREE.BoxGeometry(0.8, 0.1, 0.8);
        const plate = new THREE.Mesh(plateGeo, material);
        plate.position.y = -0.9;
        
        group.add(cone);
        group.add(plate);
    } else if (supportType === 'roller_x_fixed') {
        // 壁ローラー (垂直自由) - 右側に壁がある想定
        const coneGeo = new THREE.ConeGeometry(0.4, 0.6, 4);
        const cone = new THREE.Mesh(coneGeo, material);
        cone.rotation.z = Math.PI / 2; // 横向き
        cone.rotation.y = Math.PI / 4;
        cone.position.x = 0.5;
        
        const plateGeo = new THREE.BoxGeometry(0.1, 0.8, 0.8);
        const plate = new THREE.Mesh(plateGeo, material);
        plate.position.x = 0.9;
        
        group.add(cone);
        group.add(plate);
    }
    
    return group;
}

function createSectionShape(sectionInfo, member) {
    const rawDims = sectionInfo.rawDims;
    const typeKey = sectionInfo.typeKey;
    if (!rawDims || !typeKey) return null;

    // 【追加】寸法データを強制的に数値に変換した新しいオブジェクトを作成
    const dims = {};
    for (const key in rawDims) {
        if (Object.prototype.hasOwnProperty.call(rawDims, key)) {
            const val = Number(rawDims[key]);
            // 有効な数値のみ採用、NaNなら0
            dims[key] = Number.isFinite(val) ? val : 0;
        }
    }

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
    console.log('🔍 getSectionName呼び出し:', member);
    if (!member.sectionInfo) {
        console.log('⚠️ sectionInfoが存在しません');
        return null;
    }

    const typeKey = member.sectionInfo.typeKey;
    const dims = member.sectionInfo.rawDims;
    console.log('🔍 typeKey:', typeKey, 'dims:', dims);

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
        console.log('🔍 rawDimsがないためlabelを使用:', member.sectionInfo.label);
        return member.sectionInfo.label || null;
    }

    // 形状タイプに応じて板厚まで含んだ名称を生成
    let sectionName;
    console.log('🔍 形状タイプに応じて名称を生成:', typeKey);
    switch (typeKey) {
        case 'hkatakou_hiro':
            if (dims.t1 && dims.t2) {
                sectionName = `H形鋼（広幅） ${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `H形鋼（広幅） ${dims.H}×${dims.B}`;
            }
            break;
        case 'hkatakou_naka':
            if (dims.t1 && dims.t2) {
                sectionName = `H形鋼（中幅） ${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `H形鋼（中幅） ${dims.H}×${dims.B}`;
            }
            break;
        case 'hkatakou_hoso':
            if (dims.t1 && dims.t2) {
                sectionName = `H形鋼（細幅） ${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `H形鋼（細幅） ${dims.H}×${dims.B}`;
            }
            break;
        case 'ikatakou':
            if (dims.t1 && dims.t2) {
                sectionName = `I形鋼 ${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `I形鋼 ${dims.H}×${dims.B}`;
            }
            break;
        case 'keiryouhkatakou':
            if (dims.t1 && dims.t2) {
                sectionName = `軽量H形鋼 ${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `軽量H形鋼 ${dims.H}×${dims.B}`;
            }
            break;
        case 'keiryourippuhkatakou':
            if (dims.t1 && dims.t2) {
                sectionName = `軽量リップH形鋼 ${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `軽量リップH形鋼 ${dims.H}×${dims.B}`;
            }
            break;
        case 'seihoukei':
            if (dims.t) {
                sectionName = `角形鋼管（正方形） ${dims.A}×${dims.A}×${dims.t}`;
            } else {
                sectionName = `角形鋼管（正方形） ${dims.A}×${dims.A}`;
            }
            break;
        case 'tyouhoukei':
            if (dims.t) {
                sectionName = `角形鋼管（長方形） ${dims.A}×${dims.B}×${dims.t}`;
            } else {
                sectionName = `角形鋼管（長方形） ${dims.A}×${dims.B}`;
            }
            break;
        case 'koukan':
            if (dims.t) {
                sectionName = `丸形鋼管 φ${dims.D}×${dims.t}`;
            } else {
                sectionName = `丸形鋼管 φ${dims.D}`;
            }
            break;
        case 'mizogatakou':
            if (dims.t1 && dims.t2) {
                sectionName = `みぞ形鋼 ${dims.H}×${dims.B || dims.A}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `みぞ形鋼 ${dims.H}×${dims.B || dims.A}`;
            }
            break;
        case 'keimizogatakou':
            if (dims.t1 && dims.t2) {
                sectionName = `軽みぞ形鋼 ${dims.H}×${dims.B || dims.A}×${dims.t1}×${dims.t2}`;
            } else {
                sectionName = `軽みぞ形鋼 ${dims.H}×${dims.B || dims.A}`;
            }
            break;
        case 'rippumizokatakou':
            if (dims.t) {
                sectionName = `リップみぞ形鋼 ${dims.H}×${dims.A}×${dims.t}`;
            } else {
                sectionName = `リップみぞ形鋼 ${dims.H}×${dims.A}`;
            }
            break;
        case 'touhenyamakatakou':
            if (dims.t) {
                sectionName = `等辺山形鋼 ${dims.A}×${dims.A}×${dims.t}`;
            } else {
                sectionName = `等辺山形鋼 ${dims.A}×${dims.A}`;
            }
            break;
        case 'futouhenyamagata':
            if (dims.t) {
                sectionName = `不等辺山形鋼 ${dims.A}×${dims.B}×${dims.t}`;
            } else {
                sectionName = `不等辺山形鋼 ${dims.A}×${dims.B}`;
            }
            break;
        case '矩形':
        case 'rectangular':
            sectionName = `矩形断面 ${dims.H}×${dims.B}`;
            break;
        case '円形':
        case 'circular':
            sectionName = `円形断面 φ${dims.D}`;
            break;
        default:
            // typeKeyがあるがswitchに該当しない場合、labelを使用
            console.log('🔍 デフォルトケース: labelを使用:', member.sectionInfo.label);
            sectionName = member.sectionInfo.label || null;
            break;
    }

    // 軸方向情報を追加
    if (member.sectionAxis && member.sectionAxis.label) {
        sectionName += ` (${member.sectionAxis.label})`;
    }

    console.log('🔍 生成された断面名称:', sectionName);
    return sectionName;
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
