// ルート統合版から /api/generate-model を提供するための薄いラッパー。
// 実装本体は 2D 側の既存ロジックをそのまま再利用する。

async function handler(req, res) {
    const mod = await import('../2D構造解析/api/generate-model.js');
    const inner = mod?.default;
    if (typeof inner !== 'function') {
        res.status(500).json({ error: 'AI handler is not available.' });
        return;
    }
    return inner(req, res);
}

module.exports = handler;
module.exports.default = handler;
