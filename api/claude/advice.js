// Claude API Proxy - 姿勢分析アドバイス生成
// Vercel Serverless Function

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowed);

  try {
    const { analysisData, viewMode, customerName } = req.body;
    if (!analysisData || !analysisData.items) {
      return res.status(400).json({ error: 'analysisData is required' });
    }

    const itemsSummary = analysisData.items
      .filter(item => item.confidence == null || item.confidence >= 0.5)
      .map(item => `- ${item.label}: ${item.score}点 (${item.detail}, ${item.value})`)
      .join('\n');

    const viewLabel = viewMode === 'front' ? '正面' : viewMode === 'back' ? '背面' : viewMode === 'seated' ? '座位' : '側面';
    const total = analysisData.items
      .filter(i => i.confidence == null || i.confidence >= 0.5)
      .reduce((s, i, _, arr) => s + i.score / arr.length, 0);

    const prompt = `あなたは整体院の姿勢分析AIアシスタントです。以下の姿勢分析結果に基づいて、お客様向けの改善アドバイスを生成してください。

## 分析結果（${viewLabel}）
総合スコア: ${Math.round(total)}点/100点
${itemsSummary}

## 出力ルール
- 整体院のスタッフがお客様に説明する口調（丁寧語）で書いてください
- 以下の3セクションで構成してください:
  1. **現状の評価**（2-3文で簡潔に）
  2. **改善のためのセルフケア**（具体的なストレッチ・エクササイズを2-3個、やり方を1文ずつ）
  3. **施術の推奨頻度**（スコアに応じた来院ペースの提案）
- 各セクションの見出しは【】で囲んでください
- 全体で200文字〜350文字に収めてください
- スコアが80以上の項目は褒めてください
- スコアが40未満の項目は優先的に改善提案してください`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', response.status, errText);
      return res.status(502).json({ error: 'Claude API request failed', status: response.status });
    }

    const data = await response.json();
    const advice = data.content?.[0]?.text || '';

    return res.status(200).json({ advice });
  } catch (err) {
    console.error('Advice generation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
