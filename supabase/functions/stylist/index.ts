import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type WardrobeItem = {
  id: string;
  name: string;
  category: string;
  size: string;
  image_path: string;
  ai_attributes?: unknown;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const geminiKey = Deno.env.get('GEMINI_API_KEY') || '';
const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function imagePart(item: WardrobeItem) {
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/public/clothes/${item.image_path}`);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return {
      text: `Image for wardrobe item ID ${item.id} (${item.name}).`,
      inline_data: { mime_type: response.headers.get('content-type') || 'image/jpeg', data: btoa(binary) },
    };
  } catch {
    return null;
  }
}

serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY is not configured' }, 500);

  try {
    let { userMessage, wardrobeItems } = await request.json() as { userMessage: string; wardrobeItems: WardrobeItem[] };
    if (!userMessage || !Array.isArray(wardrobeItems) || wardrobeItems.length === 0) {
      return json({ error: 'userMessage and wardrobeItems are required' }, 400);
    }

    const index = wardrobeItems.map(item =>
      `[${item.id}] name="${item.name}" declared_category="${item.category}" attributes=${JSON.stringify(item.ai_attributes || {})}`
    ).join('\n');
    userMessage = `${userMessage}\n\nSTYLE VARIETY REQUIREMENT: Return multiple wearable style approaches only when the wardrobe genuinely supports them. For a request such as summer outfit, use different approaches such as relaxed casual, polished/elegant, and sporty/trendy when those items exist. If only one style is genuinely possible, return only that single strongest outfit; never force duplicate or weak variations. Put the style direction in each outfit title and use different item combinations where the wardrobe allows.`;
    const prompt = `You are a world-class personal fashion director.
User request: "${userMessage}"
Inspect every clothing image and use only the indexed wardrobe items below:
${index}

Return exactly three distinct ranked outfits. Analyze color harmony, pattern, fabric, silhouette, proportions, layering, footwear, accessories, season, occasion, and the request. Each outfit must contain one dress OR at least one top and one bottom. Use only IDs from the index. Do not invent items. Outfit 1 is strongest, outfit 2 is best alternative, outfit 3 is most creative but wearable. Be honest about missing optional pieces. Hard season rule: for summer, hot weather, beach, or صيف, never select hoodies, sweatshirts, fleece, puffer jackets, thermal clothing, thick knitwear, wool coats, heavy coats, or other warm winter pieces. For winter, never use swimwear, beachwear, shorts, sandals, tank tops, or clearly summer-only pieces. A T-shirt is forbidden as a standalone winter top; it is allowed only when a jacket or coat is included in the same outfit. Winter outfits must include a warm layer when the base top is lightweight. For spring, reject heavy winter-only pieces unless the user asks for layering. For autumn, reject summer-only pieces and favor a layer when the base is lightweight. If the wardrobe cannot make a valid outfit for the requested season, return no outfits and explain exactly which rule blocked the available items and what is missing. Required item rule: if the user asks for a Hijab, hijab, headscarf, or حجاب and no indexed item is a Hijab, return no outfits and say that the Hijab is missing. Category safety: compare every image with its declared category. If trousers/pants are declared as Accessories, clothing is declared as Bags, shoes are declared as Socks, or socks are declared as Shoes, the item is invalid and must not be used. Add its ID to invalid_item_ids and explain that it must be removed or recategorized immediately.

Evaluate every valid Accessories or Bags item separately, including rings. Add each to accessory_notes with a realistic 0-100 fit_score, verdict, and reason, even when it is not needed in the core outfit.
Return only JSON: {"intro":"short expert overview","alerts":["category mismatch warnings, or []"],"invalid_item_ids":["visually mismatched IDs, or []"],"accessory_notes":[{"item_id":"id","fit_score":50,"verdict":"Works as a subtle accent","reason":"..."}],"outfits":[{"title":"...","item_ids":["id"],"reason":"two concise sentences","missing":[]},{"title":"...","item_ids":["id"],"reason":"two concise sentences","missing":[]},{"title":"...","item_ids":["id"],"reason":"two concise sentences","missing":[]}]}`;

    const finalPrompt = `${prompt}\n\nFINAL OUTPUT RULE: Return up to three outfits, not necessarily three. Return multiple only when the wardrobe supports genuinely different styles; if only one strong style is possible, return one outfit and do not create weak duplicates. Never invent or mention prices. Do not discuss item sizes unless the user explicitly asks about sizing. IMAGE-FIRST RULE: Identify each garment from its visible shape before using its name, category, or metadata. A visibly thick sweatshirt, hoodie, sweater, fleece, or winter layer is never valid for a summer outfit. If the name says T-shirt but the image is a sweatshirt, trust the image and exclude it for summer.`;
    const parts: Record<string, unknown>[] = [{ text: finalPrompt }];
    const images = await Promise.all(wardrobeItems.map(imagePart));
    images.forEach(part => {
      if (part) {
        parts.push({ text: part.text });
        parts.push({ inline_data: part.inline_data });
      }
    });

    const response = await fetch(`${geminiUrl}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.55, maxOutputTokens: 2400, responseMimeType: 'application/json' },
      }),
    });
    if (!response.ok) return json({ error: 'Stylist model request failed' }, 502);
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, '').trim());
    return json(parsed);
  } catch (error) {
    console.error(error);
    return json({ error: 'Unable to generate outfit recommendations' }, 500);
  }
});
