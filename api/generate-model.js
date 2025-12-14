// /api/generate-model を提供するための薄いラッパー。
// 実装本体は api/generate-model-impl.mjs に分離している（ESM）。

async function handler(req, res) {
    const mod = await import('./generate-model-impl.mjs');
    const inner = mod?.default;
    if (typeof inner !== 'function') {
        res.status(500).json({ error: 'AI handler is not available.' });
        return;
    }
    return inner(req, res);
}

module.exports = handler;
module.exports.default = handler;
