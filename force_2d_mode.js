// 2D表示を強制的に有効にする関数
const force2DDisplayMode = () => {
    console.log('📐 Forcing 2D display mode...');
    window.force2DMode = true;
    window.is3DDisplayMode = false;
    
    // 既存の図面を再描画
    if (window.redrawAllDiagrams) {
        window.redrawAllDiagrams();
    }
    
    console.log('✅ 2D display mode forced');
};

// グローバルに公開する関数
window.drawDisplacementDiagram = drawDisplacementDiagram;
window.drawStressDiagram = drawStressDiagram;
window.drawCapacityRatioDiagram = drawCapacityRatioDiagram;
window.detect3DDisplayMode = detect3DDisplayMode;
window.toggle3DDisplayMode = toggle3DDisplayMode;
window.enable3DDisplayMode = enable3DDisplayMode;
window.disable3DDisplayMode = disable3DDisplayMode;
window.debugAvailableCanvases = debugAvailableCanvases;
window.force2DDisplayMode = force2DDisplayMode;
window.temporarilyDisable3D = temporarilyDisable3D;
