type RequestLike = {
  method?: string;
  body?: { imageUrl?: string; itemName?: string; category?: string };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

function sendError(res: ResponseLike, code: number, message: string) {
  res.status(code).json({ error: message });
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== 'POST') return sendError(res, 405, 'POST required');
  const apiKey = process.env.GEMINI_API_KEY;
  const { imageUrl, itemName, category } = req.body || {};
  if (!apiKey) return sendError(res, 500, 'GEMINI_API_KEY is not configured in Vercel');
  if (!imageUrl || !itemName || !category) return sendError(res, 400, 'imageUrl, itemName, and category are required');

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) return sendError(res, 400, 'The clothing image could not be read');
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    if (imageBytes.byteLength > 10 * 1024 * 1024) return sendError(res, 413, 'Image is too large');
    const mime = imageResponse.headers.get('content-type') || 'image/jpeg';

    const prompt = `You are a careful wardrobe cataloging expert. Analyze this uploaded image.
Item name: "${itemName}"
User category: "${category}"

Return only JSON with these fields:
{
  "is_clothing": true,
  "category_match": true,
  "image_quality": "clear",
  "confidence": 0.0,
  "colors": ["up to 3 normalized colors"],
  "color": "main normalized color",
  "garment_type": "specific garment type",
  "style": "casual, smart-casual, formal, sporty, elegant, vintage, or modest",
  "occasion": ["daily", "work", "party", "formal", "sport", "beach", "travel"],
  "season": ["spring", "summer", "autumn", "winter", "all-season"],
  "fabric": "best visual estimate or unknown",
  "material": "best visual estimate or unknown",
  "weight": "light, medium, heavy, or unknown",
  "warmth": "cool, medium, warm, or unknown",
  "fit": "slim, regular, relaxed, oversized, tailored, or unknown",
  "formality": "casual, smart-casual, or formal",
  "pattern": "solid, stripe, plaid, floral, graphic, textured, or unknown",
  "description": "one precise sentence",
  "warnings": []
}

Use "is_clothing": false for non-clothing images. Set category_match false when the visible item clearly does not belong to the user's category. Do not invent details that are not visible. Confidence must be between 0 and 1. Add short warnings when the image is blurry, the item is not clothing, or the category looks wrong.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: imageBytes.toString('base64') } }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 900, responseMimeType: 'application/json' },
      }),
    });
    const result = await response.json();
    if (!response.ok) return sendError(res, 502, result.error?.message || 'Gemini analysis failed');
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return sendError(res, 502, 'Gemini returned invalid analysis');
    const parsed = JSON.parse(match[0]);
    const attributes = {
      ...parsed,
      colors: Array.isArray(parsed.colors) ? parsed.colors.slice(0, 3).map((value: unknown) => String(value)) : [],
      occasion: Array.isArray(parsed.occasion) ? parsed.occasion.map((value: unknown) => String(value)) : [],
      season: Array.isArray(parsed.season) ? parsed.season.map((value: unknown) => String(value)) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((value: unknown) => String(value)).slice(0, 4) : [],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      analyzed_at: new Date().toISOString(),
      analysis_source: 'gemini-2.5-flash',
    };
    return res.status(200).json({ attributes });
  } catch (error) {
    console.error('Clothing analysis error:', error);
    return sendError(res, 500, 'Unable to analyze clothing image');
  }
}
