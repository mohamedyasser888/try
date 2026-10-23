/**
 * AI Stylist Chat Service
 * Primary:  Groq (Llama 4 Scout) — free, no credit card, vision, ultra-fast
 * Fallback: Gemini 1.5 Flash       — free tier 15 req/min
 *
 * Reads EVERY clothing image, understands them visually,
 * then picks the best full outfit (top, bottom, jacket, shoes, socks, accessories)
 * and tells the user what's missing from their wardrobe.
 */

import type { WardrobeItem } from '@/types';
import { supabase } from '@/services/supabase';

const GROQ_API_KEY   = import.meta.env.VITE_GROQ_API_KEY;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const SUPABASE_URL   = import.meta.env.VITE_SUPABASE_URL;

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
const GROQ_REASONING_MODEL = 'openai/gpt-oss-120b';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  outfitSuggestions?: OutfitSuggestion[];
  clarification?: {
    question: string;
    options: string[];
  };
  timestamp: Date;
}

export interface OutfitSuggestion {
  items: WardrobeItem[];
  reason: string;
  overallScore?: number;
  compatibility?: PairCompatibility[];
}

export interface PairCompatibility {
  firstItemId: string;
  secondItemId: string;
  firstItemName: string;
  secondItemName: string;
  score: number;
  reason: string;
}

export interface ChatResponse {
  message: string;
  outfitSuggestions?: OutfitSuggestion[];
  alerts?: string[];
  clarification?: {
    question: string;
    options: string[];
  };
  error?: Error;
}

interface MasterOutfitResult {
  intro: string;
  alerts?: string[];
  invalid_item_ids?: string[];
  accessory_notes?: Array<{ item_id: string; fit_score: number; verdict: string; reason: string }>;
  outfits: Array<{
    title: string;
    item_ids: string[];
    reason: string;
    missing?: string[];
  }>;
}

// ─── Slot mapping — which categories belong to which outfit slot ──────────────

const SLOT_MAP: Record<string, string[]> = {
  top:         ['tops', 'top', 'shirt', 'chemise', 'blouse', 't-shirt', 'tshirt', 'sweater', 'hoodie', 'polo'],
  bottom:      ['bottoms', 'bottom', 'jean', 'jeans', 'pant', 'pants', 'pantalon', 'trouser', 'trousers', 'skirt', 'shorts'],
  dress:       ['dress', 'dresses'],
  jacket:      ['jacket', 'jackets', 'coat', 'blazer'],
  shoes:       ['shoes', 'shoe', 'sneaker', 'sneakers', 'boots', 'boot', 'heels', 'heel', 'sandals', 'sandal'],
  socks:       ['socks', 'sock'],
  bag:         ['bags', 'bag'],
  accessories: ['accessories', 'accessory', 'belt', 'belts', 'scarf', 'hijab', 'hat', 'cap', 'caps', 'watch', 'necklace', 'bracelet', 'sunglasses'],
};

function getSlot(item: WardrobeItem): string {
  const cat = item.category.toLowerCase();
  for (const [slot, keywords] of Object.entries(SLOT_MAP)) {
    if (keywords.some(k => cat.includes(k))) return slot;
  }
  return 'other';
}

function obviousCategoryMismatch(item: WardrobeItem): string | null {
  const category = item.category.toLowerCase();
  const name = item.name.toLowerCase();
  const garmentWords = ['pantalon', 'pants', 'trouser', 'jean', 'jeans', 'skirt', 'shorts', 'legging', 'leggings'];
  const shoeWords = ['shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers', 'boot', 'boots', 'heel', 'heels', 'loafer', 'sandals', 'sandal', 'slipper'];
  const sockWords = ['sock', 'socks', 'hosiery'];
  const looksLikeGarment = garmentWords.some(word => name.includes(word));
  const looksLikeShoe = shoeWords.some(word => name.includes(word));
  const looksLikeSock = sockWords.some(word => name.includes(word));
  if (category === 'accessories' && looksLikeGarment) {
    return `Warning: ${item.name} appears to be clothing, not an accessory. Remove it or recategorize it immediately.`;
  }
  if (category === 'bags' && looksLikeGarment) {
    return `Warning: ${item.name} appears to be clothing, not a bag. Remove it or recategorize it immediately.`;
  }
  if (category === 'socks' && looksLikeShoe) {
    return `Warning: ${item.name} appears to be shoes but is categorized as Socks. Remove it or recategorize it immediately.`;
  }
  if (category === 'shoes' && looksLikeSock) {
    return `Warning: ${item.name} appears to be socks but is categorized as Shoes. Remove it or recategorize it immediately.`;
  }
  return null;
}

function asksForHijab(request: string): boolean {
  return /hijab|heads*scarf|headscarf|حجاب/i.test(request);
}

function needsClarification(request: string): boolean {
  const normalized = request.trim().toLowerCase();
  if (!normalized) return false;

  const hasUsefulIntent = /\b(top|shirt|t-shirt|blouse|sweater|hoodie|dress|skirt|pants?|jeans?|trousers?|shorts?|jacket|coat|blazer|shoes?|sneakers?|boots?|sandals?|socks?|hijab|headscarf|bag|accessor(?:y|ies)|outfit|look|wear|match|style|colour|color|summer|winter|spring|autumn|fall|hot|cold|rain|work|office|party|formal|casual|sport|date|wedding|travel|beach|صيف|شتاء|ربيع|خريف|حجاب)\b/i.test(normalized);
  if (hasUsefulIntent) return false;

  return /^(help|hi|hello|hey|advice|suggest|suggestion|what should i wear|choose for me|style me|i need help|anything|surprise me)[!.?\s]*$/i.test(normalized);
}

function clarificationResponse(): ChatResponse {
  return {
    message: 'I can build a much better look if you give me one detail first. What are you dressing for?',
    clarification: {
      question: 'Choose an occasion or direction:',
      options: ['Everyday casual', 'Work or office', 'Party or date', 'Summer weather', 'Formal event']
    }
  };
}

function isHijab(item: WardrobeItem): boolean {
  return /hijab|heads*scarf|headscarf|حجاب/i.test(`${item.name} ${item.category}`);
}

function requiredItemResponse(request: string, items: WardrobeItem[]): ChatResponse | null {
  if (!asksForHijab(request) || items.some(isHijab)) return null;
  return {
    message: `I cannot complete this request because you do not have a Hijab in your wardrobe. Please add or categorize a Hijab item first, then I can build the outfit around it.`,
    alerts: ['The requested item is missing: Hijab.']
  };
}

function isFormalRequest(request: string): boolean {
  return /formal|formel|office|work|business|interview|wedding|ceremony|ceremonial|elegant|dressy|professional|meeting|black tie|smart dress/i.test(request);
}

type RequestedSeason = 'summer' | 'winter' | 'spring' | 'autumn' | null;

function requestedSeason(request: string): RequestedSeason {
  if (/summer|hot weather|hot day|beach|pool|صيف/i.test(request)) return 'summer';
  if (/winter|cold weather|cold day|snow|شتاء/i.test(request)) return 'winter';
  if (/spring|ربيع/i.test(request)) return 'spring';
  if (/autumn|fall|خريف/i.test(request)) return 'autumn';
  return null;
}

function itemSearchText(item: WardrobeItem): string {
  return `${item.name} ${item.category} ${JSON.stringify(item.ai_attributes || {})}`.toLowerCase();
}

function itemSeasons(item: WardrobeItem): string[] {
  const attributes = item.ai_attributes || {};
  const seasons = Array.isArray(attributes.season) ? attributes.season : [];
  return seasons.map(season => season.toLowerCase());
}

function isTooWarmForSummer(item: WardrobeItem): boolean {
  const text = itemSearchText(item);
  const attributes = item.ai_attributes || {};
  return /hoodie|sweatshirt|fleece|puffer|parka|heavy coat|winter coat|thermal|thick knit|wool coat/i.test(text) ||
    attributes.weight === 'heavy' || attributes.warmth === 'warm';
}

function isTooLightForWinter(item: WardrobeItem): boolean {
  const text = itemSearchText(item);
  const attributes = item.ai_attributes || {};
  return /swimwear|bikini|tank top|vest top|shorts|sandals|beachwear/i.test(text) ||
    attributes.weight === 'light' && attributes.warmth === 'cool';
}

function isSeasonCompatible(item: WardrobeItem, request: string): boolean {
  const season = requestedSeason(request);
  if (!season) return true;
  const seasons = itemSeasons(item);
  if (season === 'summer') {
    return !isTooWarmForSummer(item) && (!seasons.length || seasons.includes('summer') || seasons.includes('spring') || seasons.includes('all-season'));
  }
  if (season === 'winter') {
    return !isTooLightForWinter(item) && (!seasons.length || seasons.includes('winter') || seasons.includes('autumn') || seasons.includes('all-season'));
  }
  return !seasons.length || seasons.includes(season) || seasons.includes('all-season');
}

function seasonEligibleItems(items: WardrobeItem[], request: string): WardrobeItem[] {
  return items.filter(item => isSeasonCompatible(item, request));
}

function itemColors(item: WardrobeItem): string[] {
  const attributes = item.ai_attributes || {};
  const values = Array.isArray(attributes.colors) ? attributes.colors : attributes.color ? [attributes.color] : [];
  return values.map(color => color.toLowerCase());
}

function colorPairScore(first: WardrobeItem, second: WardrobeItem): number {
  const firstColors = itemColors(first);
  const secondColors = itemColors(second);
  if (!firstColors.length || !secondColors.length) return 60;
  if (firstColors.some(color => secondColors.includes(color))) return 78;
  if (firstColors.some(color => ['black', 'white', 'grey', 'gray', 'beige', 'cream', 'navy'].includes(color)) ||
      secondColors.some(color => ['black', 'white', 'grey', 'gray', 'beige', 'cream', 'navy'].includes(color))) return 86;
  const harmonious: Record<string, string[]> = {
    blue: ['orange', 'brown', 'beige', 'white'], red: ['green', 'blue', 'black', 'white'],
    green: ['red', 'brown', 'beige', 'white'], yellow: ['purple', 'blue', 'black'],
    purple: ['yellow', 'white', 'beige'], orange: ['blue', 'white', 'beige'],
    brown: ['blue', 'green', 'white', 'beige'], pink: ['grey', 'gray', 'white', 'navy']
  };
  if (firstColors.some(color => harmonious[color]?.some(match => secondColors.includes(match))) ||
      secondColors.some(color => harmonious[color]?.some(match => firstColors.includes(match)))) return 82;
  return 48;
}

function pairCompatibility(first: WardrobeItem, second: WardrobeItem, request: string): PairCompatibility {
  let score = colorPairScore(first, second);
  const firstText = itemSearchText(first);
  const secondText = itemSearchText(second);
  const firstStyle = String(first.ai_attributes?.style || '').toLowerCase();
  const secondStyle = String(second.ai_attributes?.style || '').toLowerCase();
  if (firstStyle && secondStyle && firstStyle.split(/[, ]+/).some(style => secondStyle.includes(style))) score += 8;
  if (requestedSeason(request) && isSeasonCompatible(first, request) && isSeasonCompatible(second, request)) score += 7;
  if (isFormalRequest(request) && (isTooCasualForFormal(first) || isTooCasualForFormal(second))) score -= 35;
  if (/summer|hot weather|beach|صيف/i.test(request) && (isTooWarmForSummer(first) || isTooWarmForSummer(second))) score -= 45;
  if (/hoodie|sweatshirt/i.test(firstText) && /blazer|formal|dress shoe/i.test(secondText)) score -= 12;
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const reason = finalScore >= 80 ? 'Strong color and style harmony.' : finalScore >= 65 ? 'Works together with a balanced contrast.' : 'Weak match; choose another piece if available.';
  return { firstItemId: first.id, secondItemId: second.id, firstItemName: first.name, secondItemName: second.name, score: finalScore, reason };
}

function compatibilityFor(items: WardrobeItem[], request: string): { overallScore: number; compatibility: PairCompatibility[] } {
  const pairs: PairCompatibility[] = [];
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      pairs.push(pairCompatibility(items[first], items[second], request));
    }
  }
  const overallScore = pairs.length ? Math.round(pairs.reduce((sum, pair) => sum + pair.score, 0) / pairs.length) : 100;
  return { overallScore, compatibility: pairs };
}

export function scoreOutfitCompatibility(items: WardrobeItem[], request: string): { overallScore: number; compatibility: PairCompatibility[] } {
  return compatibilityFor(items, request);
}

function noSeasonOutfitResponse(items: WardrobeItem[], request: string): ChatResponse | null {
  const season = requestedSeason(request);
  if (!season) return null;
  const eligible = seasonEligibleItems(items, request);
  const slots = new Set(eligible.map(getSlot));
  if (slots.has('dress') || (slots.has('top') && slots.has('bottom'))) return null;
  const missing: string[] = [];
  if (!slots.has('dress') && !slots.has('top')) missing.push('a suitable top');
  if (!slots.has('dress') && !slots.has('bottom')) missing.push('a suitable bottom');
  const unsuitable = items.filter(item => !eligible.includes(item)).map(item => item.name);
  return {
    message: `I could not build a complete ${season} outfit from your wardrobe. You are missing ${missing.join(' and ')}.\n\n${unsuitable.length ? `These pieces were not used because they are not suitable for ${season}: ${unsuitable.join(', ')}.` : ''}`,
    alerts: [`No complete ${season} outfit was found from the available wardrobe.`]
  };
}

function isTooCasualForFormal(item: WardrobeItem): boolean {
  return /sweatshirt|sweat shirt|sweat-shirt|switchirt|swichirt|hoodie|t-shirt|tshirt|sportswear|sport wear|athleisure|jogger|track suit|tracksuit|sneaker|trainers|flip flop|running shoe|gym shoe/i.test(itemSearchText(item));
}

function fitsRequestedOccasion(items: WardrobeItem[], request: string): boolean {
  return !isFormalRequest(request) || !items.some(isTooCasualForFormal);
}

function fitsRequestedSeason(items: WardrobeItem[], request: string): boolean {
  return items.every(item => isSeasonCompatible(item, request));
}

function requestAwareScore(item: WardrobeItem, request: string): number {
  const text = itemSearchText(item);
  let score = 0;
  if (isFormalRequest(request)) {
    if (/formal|chemise|shirt|blouse|blazer|tailored|trouser|dress|business|elegant|dress shoe|heel|loafer|oxford/i.test(text)) score += 12;
    if (/cotton|linen|wool|silk|satin|structured|classic|smart/i.test(text)) score += 2;
    if (/shorts|cargo|flip flop|slipper/i.test(text)) score -= 12;
    if (isTooCasualForFormal(item)) score -= 30;
  } else if (/casual|relaxed|everyday|weekend/i.test(request)) {
    if (/jeans|denim|sweatpants|sweat pants|jogger|joggers|sweatshirt|hoodie|t-shirt|sneaker/i.test(text)) score += 14;
    if (/classic trouser|formal trouser|tailored trouser|dress pant|dress pants|blazer|oxford|loafer/i.test(text)) score -= 6;
  }
  if (requestedSeason(request) === 'summer') {
    if (/linen|cotton|light|breathable|airy|shorts|skirt|dress|sandals|t-shirt|shirt/i.test(text)) score += 12;
    if (isTooWarmForSummer(item)) score -= 40;
  }
  if (requestedSeason(request) === 'winter') {
    if (/wool|fleece|knit|coat|jacket|hoodie|boot|warm|thermal/i.test(text)) score += 12;
    if (isTooLightForWinter(item)) score -= 30;
  }
  return score;
}

function outfitDecisionScore(items: WardrobeItem[], request: string): number {
  const slots = new Set(items.map(getSlot));
  let score = items.reduce((total, item) => total + requestAwareScore(item, request), 0);
  if (slots.has('dress') || (slots.has('top') && slots.has('bottom'))) score += 8;
  if (slots.has('shoes')) score += 4;
  if (isFormalRequest(request) && slots.has('jacket')) score += 3;
  score += Math.round(compatibilityFor(items, request).overallScore / 10);
  return score;
}

function chooseForRequest(items: WardrobeItem[], request: string): WardrobeItem | undefined {
  return [...items]
    .filter(item => (!isFormalRequest(request) || !isTooCasualForFormal(item)) && isSeasonCompatible(item, request))
    .sort((a, b) => requestAwareScore(b, request) - requestAwareScore(a, request))[0];
}

// ─── Convert image URL to base64 ─────────────────────────────────────────────

async function toBase64(imagePath: string): Promise<{ data: string; mime: string } | null> {
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/public/clothes/${imagePath}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || 'image/jpeg';
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ data: (reader.result as string).split(',')[1], mime });
      reader.onerror   = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ─── Describe ONE item using Groq Vision (Llama 4 Scout) ─────────────────────

async function describeWithGroq(item: WardrobeItem): Promise<string | null> {
  if (!GROQ_API_KEY) return null;
  const img = await toBase64(item.image_path);
  if (!img) return null;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this clothing item in ONE sentence (max 15 words). Include: color, pattern, garment type. Only output the sentence.'
            },
            {
              type: 'image_url',
              image_url: { url: `data:${img.mime};base64,${img.data}` }
            }
          ]
        }],
        max_tokens: 60,
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Groq vision error:', err);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn('Groq vision failed:', e);
    return null;
  }
}

// ─── Describe ONE item using Gemini Vision (fallback) ────────────────────────

/** Analyze the complete wardrobe in one multimodal pass and rank three looks. */
async function buildMasterOutfitsWithGemini(
  userRequest: string,
  wardrobeItems: WardrobeItem[],
): Promise<{ message: string; outfitSuggestions?: OutfitSuggestion[]; alerts?: string[] } | null> {
  if (!GEMINI_API_KEY) return null;

  const images = await Promise.all(wardrobeItems.map(async item => ({ item, image: await toBase64(item.image_path) })));
  const usableImages = images.filter((entry): entry is { item: WardrobeItem; image: { data: string; mime: string } } => Boolean(entry.image));
  if (!usableImages.length) return null;

  const wardrobeIndex = wardrobeItems.map(item =>
    `[${item.id}] name="${item.name}" declared_category="${item.category}" size="${item.size}" attributes=${JSON.stringify(item.ai_attributes || {})}`
  ).join('\n');
  const prompt = `You are a world-class personal fashion director and wardrobe editor.
The user asks: "${userRequest}"
Inspect every wardrobe image below. The text index is authoritative for IDs:
${wardrobeIndex}

Create exactly THREE distinct, high-quality outfits from the user's actual wardrobe. Analyze color harmony, patterns, fabric, silhouette, proportions, layering, footwear, accessories, season, occasion, and the user's request.
Hard season rule: for summer, hot weather, beach, or صيف, never select hoodies, sweatshirts, fleece, puffer jackets, thermal clothing, thick knitwear, wool coats, or other heavy warm pieces. For winter, do not select swimwear, beachwear, or clearly lightweight summer-only pieces. If the wardrobe cannot make a valid outfit for the requested season, return no outfits and explain exactly what is missing.
Rules: use only indexed IDs; never invent clothing; each look needs a dress OR at least a top and bottom; add optional pieces only when they improve the look; make all three looks meaningfully different; obey any requested color, garment, occasion, or season; rank 1 strongest, 2 best alternative, 3 most creative wearable option. Formal decision rule: when the request includes formal, office, business, interview, wedding, elegant, dressy, or professional, prioritize chemise/shirts, blazers, tailored trousers or skirts, dresses, loafers, heels, or dress shoes. Reject sweatshirts, hoodies, T-shirts, joggers, sportswear, and sneakers unless the user explicitly asks for them. Do not call a sweatshirt formal just because its color matches. Casual decision rule: when the request includes casual, relaxed, everyday, or weekend, prefer jeans/denim, sweatpants, joggers, casual sneakers, hoodies, and relaxed tops over classic trousers, tailored pants, dress shoes, or blazers.
Category safety: compare every image with its declared category. If an image is trousers/pants but declared as Accessories, it is invalid and must not be used at all. If an image is clothing but declared as Bags, it is invalid and must not be used at all. Do not reinterpret a mismatched item as an accessory. Add the ID to invalid_item_ids and explain the mismatch in alerts. Only use category-compatible items in outfits.
Evaluate every valid item declared as Accessories or Bags separately. Rings, belts, scarves, bags, and similar pieces must appear in accessory_notes even when not needed in the core outfit. Give each a realistic 0-100 fit_score, verdict, and reason. Never omit a valid accessory without evaluating it.
Return ONLY valid JSON: {"intro":"one short expert overview","alerts":["category mismatch warnings, or []"],"invalid_item_ids":["IDs of visually mismatched items, or []"],"accessory_notes":[{"item_id":"id","fit_score":50,"verdict":"Works as a subtle accent","reason":"..."}],"outfits":[{"title":"...","item_ids":["id"],"reason":"2 concise sentences explaining the styling logic","missing":["optional missing slot"]},{"title":"...","item_ids":["id"],"reason":"...","missing":[]},{"title":"...","item_ids":["id"],"reason":"...","missing":[]}]}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const { item, image } of usableImages) {
    parts.push({ text: `Image for wardrobe item ID ${item.id} (${item.name}).` });
    parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.65, maxOutputTokens: 2400, responseMimeType: 'application/json' } }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const parsed = parseMasterOutfits(data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '');
    if (!parsed) return null;

    const validIds = new Set(wardrobeItems.map(item => item.id));
    const invalidIds = new Set(parsed.invalid_item_ids || []);
    const seen = new Set<string>();
    const suggestions = parsed.outfits.map(outfit => {
      const ids = [...new Set((outfit.item_ids || []).filter(id => validIds.has(id) && !invalidIds.has(id)))];
      const signature = [...ids].sort().join('|');
      if (!ids.length || seen.has(signature)) return null;
      seen.add(signature);
      const selectedItems = ids.map(id => wardrobeItems.find(item => item.id === id)).filter((item): item is WardrobeItem => Boolean(item));
      if (!isStructurallyValidOutfit(selectedItems) || !fitsRequestedOccasion(selectedItems, userRequest) || !fitsRequestedSeason(selectedItems, userRequest)) return null;
      const missing = outfit.missing?.length ? `\nMissing: ${outfit.missing.join(', ')}` : '';
      return makeOutfitSuggestion(selectedItems, `${outfit.title}: ${outfit.reason}${missing}`, userRequest);
    }).filter((outfit: OutfitSuggestion | null): outfit is OutfitSuggestion => Boolean(outfit))
      .sort((a: OutfitSuggestion, b: OutfitSuggestion) => outfitDecisionScore(b.items, userRequest) - outfitDecisionScore(a.items, userRequest))
      .slice(0, 3);
    const alertText = parsed.alerts?.length ? `\n\n⚠️ Wardrobe check:\n${parsed.alerts.map(alert => `• ${alert}`).join('\n')}` : '';
    if (!suggestions.length && parsed.alerts?.length) {
      return { message: `I could not build a safe outfit from the available pieces.${alertText}${formatAccessoryNotes(parsed.accessory_notes, validIds)}`, alerts: parsed.alerts };
    }
    return suggestions.length ? { message: `${parsed.intro || 'Here are my three strongest looks for you.'}${alertText}${formatAccessoryNotes(parsed.accessory_notes, validIds)}`, outfitSuggestions: suggestions, alerts: parsed.alerts } : null;
  } catch (error) {
    console.warn('Master stylist request failed:', error);
    return null;
  }
}

function isStructurallyValidOutfit(items: WardrobeItem[]): boolean {
  const slots = new Set(items.map(getSlot));
  return slots.has('dress') || (slots.has('top') && slots.has('bottom'));
}

function makeOutfitSuggestion(items: WardrobeItem[], reason: string, request: string): OutfitSuggestion {
  const scores = scoreOutfitCompatibility(items, request);
  return { items, reason, overallScore: scores.overallScore, compatibility: scores.compatibility };
}

async function requestSecureStylist(
  userRequest: string,
  wardrobeItems: WardrobeItem[],
): Promise<ChatResponse | null> {
  if (import.meta.env.VITE_USE_SECURE_STYLIST !== 'true') return null;
  try {
    const { data, error } = await supabase.functions.invoke('stylist', {
      body: { userMessage: userRequest, wardrobeItems },
    });
    if (error || !data?.outfits) return null;
    const validItems = new Map(wardrobeItems.map(item => [item.id, item]));
    const invalidIds = new Set<string>(Array.isArray(data.invalid_item_ids) ? data.invalid_item_ids : []);
    const suggestions = data.outfits.map((outfit: { title?: string; item_ids?: string[]; reason?: string }) => {
      const items = [...new Set(outfit.item_ids || [])].filter(id => !invalidIds.has(id)).map(id => validItems.get(id)).filter(Boolean) as WardrobeItem[];
      return isStructurallyValidOutfit(items) && fitsRequestedOccasion(items, userRequest) && fitsRequestedSeason(items, userRequest)
        ? makeOutfitSuggestion(items, `${outfit.title || 'Look'}: ${outfit.reason || ''}`, userRequest)
        : null;
    }).filter((outfit: OutfitSuggestion | null): outfit is OutfitSuggestion => Boolean(outfit))
      .sort((a: OutfitSuggestion, b: OutfitSuggestion) => outfitDecisionScore(b.items, userRequest) - outfitDecisionScore(a.items, userRequest))
      .slice(0, 3) as OutfitSuggestion[];
    const alertText = Array.isArray(data.alerts) && data.alerts.length ? `\n\n⚠️ Wardrobe check:\n${data.alerts.map((alert: string) => `• ${alert}`).join('\n')}` : '';
    if (!suggestions.length && alertText) {
      return { message: `I could not build a safe outfit from the available pieces.${alertText}${formatAccessoryNotes(data.accessory_notes, new Set(validItems.keys()))}`, alerts: data.alerts };
    }
    return suggestions.length ? { message: `${data.intro || 'Here are my strongest looks for you.'}${alertText}${formatAccessoryNotes(data.accessory_notes, new Set(validItems.keys()))}`, outfitSuggestions: suggestions, alerts: data.alerts } : null;
  } catch {
    return null;
  }
}

function formatAccessoryNotes(
  notes: MasterOutfitResult['accessory_notes'],
  validIds: Set<string>,
): string {
  const usable = (notes || []).filter(note => validIds.has(note.item_id));
  if (!usable.length) return '';
  return `\n\n✨ Accessory check:\n${usable.map(note => `• ${note.verdict} — ${note.reason}`).join('\n')}`;
}

function parseMasterOutfits(text: string): MasterOutfitResult | null {
  try {
    const clean = text.replace(/```json\n?|```\n?/g, '').trim();
    const json = clean.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<MasterOutfitResult>;
    if (!Array.isArray(parsed.outfits)) return null;
    return { intro: typeof parsed.intro === 'string' ? parsed.intro : '', alerts: Array.isArray(parsed.alerts) ? parsed.alerts.filter(alert => typeof alert === 'string') : [], invalid_item_ids: Array.isArray(parsed.invalid_item_ids) ? parsed.invalid_item_ids.filter(id => typeof id === 'string') : [], accessory_notes: Array.isArray(parsed.accessory_notes) ? parsed.accessory_notes.filter(note => note && typeof note.item_id === 'string') as MasterOutfitResult['accessory_notes'] : [], outfits: parsed.outfits.filter(outfit => outfit && Array.isArray(outfit.item_ids)) as MasterOutfitResult['outfits'] };
  } catch { return null; }
}

async function describeWithGemini(item: WardrobeItem): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const img = await toBase64(item.image_path);
  if (!img) return null;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Describe this clothing item in ONE sentence (max 15 words). Include: color, pattern, garment type. Only output the sentence.' },
          { inline_data: { mime_type: img.mime, data: img.data } }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 60 }
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}

// ─── Describe an item — try Groq first, then Gemini, then fallback ───────────

async function describeItem(item: WardrobeItem): Promise<string> {
  const desc =
    await describeWithGroq(item) ||
    await describeWithGemini(item) ||
    `${item.category} item`;

  console.log(`  ✓ [${getSlot(item)}] "${item.name}" → ${desc}`);
  return desc;
}

// ─── Ask Groq (text only) to build the best outfit from described items ───────

async function buildOutfitWithGroq(
  userRequest: string,
  items: { id: string; slot: string; name: string; desc: string }[],
  forcedPicks: Record<string, string> = {}
): Promise<{ picks: Record<string, string>; message: string; missing: string[] } | null> {
  if (!GROQ_API_KEY) return null;

  const itemList = addHints(userRequest, items);
  const prompt = buildOutfitPrompt(userRequest, itemList, forcedPicks);

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_REASONING_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    console.log('Groq outfit response:', text);
    return parseOutfitJson(text);
  } catch { return null; }
}

// ─── Ask Gemini (text) to build outfit — fallback ────────────────────────────

async function buildOutfitWithGemini(
  userRequest: string,
  items: { id: string; slot: string; name: string; desc: string }[],
  forcedPicks: Record<string, string> = {}
): Promise<{ picks: Record<string, string>; message: string; missing: string[] } | null> {
  if (!GEMINI_API_KEY) return null;

  const itemList = addHints(userRequest, items);
  const prompt = buildOutfitPrompt(userRequest, itemList, forcedPicks);

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 600 }
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    console.log('Gemini outfit response:', text);
    return parseOutfitJson(text);
  } catch { return null; }
}

// ─── Pre-filter: extract color/item hints from request ───────────────────────

/**
 * Directly match color + slot from user request against vision descriptions.
 * Returns forced slot→id picks that override the AI's choices.
 * 
 * "yellow dress" → finds item described as yellow/golden/cream in dress slot
 * "red top"      → finds item described as red in top slot
 */
function extractForcedPicks(
  request: string,
  items: { id: string; slot: string; name: string; desc: string }[]
): Record<string, string> {
  const req = request.toLowerCase();
  const forced: Record<string, string> = {};

  // Color synonyms — map many words to canonical colors
  const colorGroups: Record<string, string[]> = {
    yellow:  ['yellow', 'golden', 'gold', 'mustard', 'lemon', 'canary', 'buttercup', 'champagne', 'cream', 'butter'],
    red:     ['red', 'crimson', 'scarlet', 'burgundy', 'maroon', 'ruby', 'wine', 'cherry', 'rose'],
    blue:    ['blue', 'navy', 'cobalt', 'royal blue', 'sky blue', 'turquoise', 'teal', 'azure', 'indigo', 'denim'],
    green:   ['green', 'olive', 'khaki', 'sage', 'forest', 'mint', 'emerald', 'lime'],
    black:   ['black', 'dark', 'ebony', 'onyx', 'charcoal'],
    white:   ['white', 'ivory', 'off-white', 'ecru', 'pearl'],
    pink:    ['pink', 'blush', 'rose', 'fuchsia', 'magenta', 'coral', 'salmon'],
    purple:  ['purple', 'violet', 'lavender', 'lilac', 'plum', 'mauve'],
    orange:  ['orange', 'peach', 'apricot', 'rust', 'copper', 'terracotta'],
    brown:   ['brown', 'tan', 'camel', 'beige', 'nude', 'taupe', 'mocha', 'chocolate'],
    grey:    ['grey', 'gray', 'silver', 'ash', 'slate'],
  };

  // Slot keywords in request
  const slotKeywords: Record<string, string[]> = {
    dress:       ['dress', 'gown', 'frock'],
    top:         ['shirt', 'top', 'blouse', 'chemise', 'tshirt', 't-shirt', 'sweater', 'hoodie'],
    bottom:      ['jeans', 'jean', 'pants', 'pant', 'pantalon', 'trousers', 'skirt', 'shorts'],
    jacket:      ['jacket', 'coat', 'blazer'],
    shoes:       ['shoes', 'shoe', 'sneakers', 'boots', 'heels', 'sandals'],
    socks:       ['socks', 'sock'],
    accessories: ['bag', 'belt', 'scarf', 'accessory', 'accessories'],
  };

  // Find which colors and slots are in the request
  const reqColors: { canonical: string; synonyms: string[] }[] = [];
  for (const [canonical, synonyms] of Object.entries(colorGroups)) {
    if (synonyms.some(s => req.includes(s))) {
      reqColors.push({ canonical, synonyms });
    }
  }

  const reqSlots: string[] = [];
  for (const [slot, keywords] of Object.entries(slotKeywords)) {
    if (keywords.some(k => req.includes(k))) reqSlots.push(slot);
  }

  console.log('Detected colors in request:', reqColors.map(c => c.canonical));
  console.log('Detected slots in request:', reqSlots);

  if (reqColors.length === 0) return forced; // no color specified, let AI decide

  // Find items that match the requested color(s) AND slot(s)
  for (const colorGroup of reqColors) {
    for (const targetSlot of reqSlots.length > 0 ? reqSlots : Object.keys(slotKeywords)) {
      const match = items.find(item => {
        if (item.slot !== targetSlot) return false;
        const descLower = item.desc.toLowerCase();
        return colorGroup.synonyms.some(syn => descLower.includes(syn));
      });

      if (match) {
        console.log(`✅ FORCED: "${targetSlot}" = "${match.name}" (matched color: ${colorGroup.canonical}, desc: ${match.desc})`);
        forced[targetSlot] = match.id;
      } else {
        console.log(`❌ No ${colorGroup.canonical} ${targetSlot} found in descriptions`);
        // Log what IS available in that slot for debugging
        const slotItems = items.filter(i => i.slot === targetSlot);
        slotItems.forEach(i => console.log(`   Available: "${i.name}" → "${i.desc}"`));
      }
    }
  }

  return forced;
}

// ─── Add color hints to item list ────────────────────────────────────────────

function addHints(
  request: string,
  items: { id: string; slot: string; name: string; desc: string }[]
): string {
  const req = request.toLowerCase();
  const colors = ['yellow','golden','gold','red','blue','green','black','white',
    'pink','purple','orange','brown','grey','gray','beige','navy','cream'];
  return items.map((i, n) => {
    const descLower = i.desc.toLowerCase();
    const matchedColor = colors.find(c => req.includes(c) && descLower.includes(c));
    const hint = matchedColor ? ` <<⭐ MATCHES "${matchedColor}" — PRIORITIZE>>` : '';
    return `${n + 1}. [ID:${i.id}] [SLOT:${i.slot}] ${i.name} — ${i.desc}${hint}`;
  }).join('\n');
}

function buildOutfitPrompt(request: string, itemList: string, _forced?: Record<string, string>): string {
  return `You are an expert fashion stylist with deep knowledge of color theory, style matching, and occasion dressing.

The user wants: "${request}"

Here are ALL items in their wardrobe (with AI visual descriptions):
${itemList}

CRITICAL RULES — READ CAREFULLY:

⚡ SPECIFIC ITEM REQUESTS: If the user mentions a specific color (e.g. "yellow", "red", "blue") or specific item type (e.g. "yellow dress", "blue jeans"), you MUST pick the item whose AI description contains that color/type. This overrides ALL other preferences. Example: "yellow dress" → find the item described as yellow in the dress slot and pick it. Do NOT pick a different colored item.

⚡ WHEN MULTIPLE OPTIONS EXIST: If there are 2 dresses, pick the one whose description matches the color/style the user asked for. Check the description field carefully.

1. UNDERSTAND THE REQUEST:
   - "yellow dress" → find dress described as yellow → pick it
   - "casual outfit" → pick casual-looking top + bottom
   - "party outfit" → pick most elegant/dressy items
   - "formal/work" → pick structured, professional items
   - "summer look" → pick light, breathable, airy items; never force a hoodie or heavy warm item

2. COLOR MATCH — when user specifies a color, THAT item is mandatory
   - Search descriptions for that color word
   - Pick that exact item regardless of other factors

3. STYLE CONSISTENCY — all items should match the same style level

4. SLOTS:
   - top: shirt, blouse, t-shirt (set null if dress chosen)
   - bottom: jeans, trousers, skirt (set null if dress chosen)
   - dress: pick when user asks for a dress specifically, or occasion suits it
   - jacket: only if weather/occasion needs it
   - shoes: always include if available
   - socks: include if appropriate
   - accessories: belt, bag, scarf if available and matching

5. MISSING — list slots where wardrobe has ZERO items of that type

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "message": "2-3 enthusiastic sentences explaining WHY you picked these specific pieces. If user asked for a color, confirm you found it.",
  "picks": {
    "top": "exact_item_id or null",
    "bottom": "exact_item_id or null",
    "dress": "exact_item_id or null",
    "jacket": "exact_item_id or null",
    "shoes": "exact_item_id or null",
    "socks": "exact_item_id or null",
    "accessories": "exact_item_id or null"
  },
  "missing": ["list slots with zero items, e.g. shoes"]
}`;
}

// ─── Parse JSON from AI response ─────────────────────────────────────────────

function parseOutfitJson(text: string): { picks: Record<string, string>; message: string; missing: string[] } | null {
  try {
    const clean  = text.replace(/```json\n?|```\n?/g, '').trim();
    const jsonStr = clean.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);
    return {
      picks:   parsed.picks   || {},
      message: parsed.message || 'Here is your outfit!',
      missing: parsed.missing || []
    };
  } catch { return null; }
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function chatWithStylist(
  userMessage: string,
  wardrobeItems: WardrobeItem[],
  _history: ChatMessage[]
): Promise<ChatResponse> {
  console.log('\n=== AI Stylist ===');
  console.log('Request:', userMessage);
  console.log('Wardrobe items:', wardrobeItems.length);
  wardrobeItems.forEach(i => console.log(`  - ${i.name} [${i.category}] img:${i.image_path}`));

  if (wardrobeItems.length === 0) {
    return { message: "Your wardrobe is empty! 👗\n\nPlease add some items to your wardrobe first." };
  }

  if (needsClarification(userMessage)) {
    return clarificationResponse();
  }

  const localAlerts = wardrobeItems.map(obviousCategoryMismatch).filter((alert): alert is string => Boolean(alert));
  const locallySafeItems = wardrobeItems.filter(item => !obviousCategoryMismatch(item));
  if (locallySafeItems.length === 0 && localAlerts.length > 0) {
    return { message: `I cannot build a safe outfit from these pieces.\n\n⚠️ Wardrobe check:\n${localAlerts.map(alert => `• ${alert}`).join('\n')}`, alerts: localAlerts };
  }

  const requiredResponse = requiredItemResponse(userMessage, locallySafeItems);
  if (requiredResponse) {
    return localAlerts.length
      ? { ...requiredResponse, message: `${requiredResponse.message}\n\nWardrobe check:\n${localAlerts.map(alert => `• ${alert}`).join('\n')}`, alerts: [...(requiredResponse.alerts || []), ...localAlerts] }
      : requiredResponse;
  }

  const seasonResponse = noSeasonOutfitResponse(locallySafeItems, userMessage);
  if (seasonResponse) {
    return localAlerts.length
      ? { ...seasonResponse, message: `${seasonResponse.message}\n\nWardrobe check:\n${localAlerts.map(alert => `• ${alert}`).join('\n')}`, alerts: [...(seasonResponse.alerts || []), ...localAlerts] }
      : seasonResponse;
  }
  const requestableItems = seasonEligibleItems(locallySafeItems, userMessage);

  const secureResult = await requestSecureStylist(userMessage, requestableItems);
  if (secureResult) return localAlerts.length ? { ...secureResult, message: `${secureResult.message}\n\n⚠️ Wardrobe check:\n${localAlerts.map(alert => `• ${alert}`).join('\n')}`, alerts: [...(secureResult.alerts || []), ...localAlerts] } : secureResult;

  const masterResult = await buildMasterOutfitsWithGemini(userMessage, requestableItems);
  if (masterResult) return localAlerts.length ? { ...masterResult, message: `${masterResult.message}\n\n⚠️ Wardrobe check:\n${localAlerts.map(alert => `• ${alert}`).join('\n')}`, alerts: [...(masterResult.alerts || []), ...localAlerts] } : masterResult;

  // ── Step 1: Visually describe every item with AI vision ───────────────────
  console.log('\nDescribing all items with AI vision...');
  const describedItems: { id: string; slot: string; name: string; desc: string }[] = [];

  for (let i = 0; i < requestableItems.length; i++) {
    const item = requestableItems[i];
    console.log(`  [${i + 1}/${wardrobeItems.length}] Analyzing: ${item.name} (${item.category})`);
    const desc = await describeItem(item);
    describedItems.push({ id: item.id, slot: getSlot(item), name: item.name, desc });
    if (i < requestableItems.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n✅ All items described:');
  describedItems.forEach(d => console.log(`  [${d.slot}] "${d.name}": ${d.desc}`));

  // ── Step 2: Direct color+slot match BEFORE sending to AI ─────────────────
  // This prevents the AI from ignoring an explicit "yellow dress" request
  const forcedPicks = extractForcedPicks(userMessage, describedItems);
  console.log('\nForced picks from color/type matching:', forcedPicks);

  // ── Step 3: Build outfit with AI (Groq → Gemini → fallback) ─────────────
  console.log('\nBuilding outfit with AI...');
  const result =
    await buildOutfitWithGroq(userMessage, describedItems, forcedPicks) ||
    await buildOutfitWithGemini(userMessage, describedItems, forcedPicks) ||
    null;

  if (!result) {
    console.warn('Both AI models failed, using rule-based fallback');
    return ruleFallback(userMessage, locallySafeItems, forcedPicks, describedItems);
  }

  // ── Step 4: Override AI picks with forced picks (color match wins) ────────
  const finalPicks = { ...result.picks, ...forcedPicks };
  console.log('\nFinal picks (after color override):', finalPicks);

  // ── Step 5: Map IDs back to WardrobeItem objects ──────────────────────────
  const hasDress = finalPicks.dress && finalPicks.dress !== 'null';
  const pickedItems: WardrobeItem[] = [];

  for (const [slot, id] of Object.entries(finalPicks)) {
    if (!id || id === 'null') continue;
    if (hasDress && (slot === 'top' || slot === 'bottom')) continue;
    const item = requestableItems.find(w => w.id === id);
    if (item) pickedItems.push(item);
  }

  if (pickedItems.length === 0 || !fitsRequestedOccasion(pickedItems, userMessage) || !fitsRequestedSeason(pickedItems, userMessage)) {
    return ruleFallback(userMessage, requestableItems, forcedPicks, describedItems);
  }

  // ── Step 6: Build final message ───────────────────────────────────────────
  const slotEmoji: Record<string, string> = {
    top: '👕', bottom: '👖', dress: '👗', jacket: '🧥',
    shoes: '👟', socks: '🧦', accessories: '👜', other: '✨'
  };

  const itemLines = pickedItems
    .map(i => {
      const d = describedItems.find(x => x.id === i.id);
      return `${slotEmoji[getSlot(i)] || '✨'} **${i.name}** — ${d?.desc || i.category}`;
    })
    .join('\n');

  const missingNote = result.missing.length > 0
    ? `\n\n⚠️ **Not in your wardrobe:** ${result.missing.map(s => `${slotEmoji[s] || ''}${s}`).join(', ')}\nConsider adding these for a complete look!`
    : '\n\n✅ Your wardrobe has everything for this outfit!';

  return {
    message: `${result.message}\n\n${itemLines}${missingNote}`,
    outfitSuggestions: [makeOutfitSuggestion(pickedItems, result.message, userMessage)],
    alerts: localAlerts.length ? localAlerts : undefined,
  };
}

// ─── Rule-based fallback when both AIs fail ───────────────────────────────────

function ruleFallback(
  request: string,
  items: WardrobeItem[],
  _forced?: Record<string, string>,
  _described?: { id: string; slot: string; name: string; desc: string }[]
): ChatResponse {
  const req = request.toLowerCase();

  const bySlot: Record<string, WardrobeItem[]> = {};
  for (const item of items) {
    const s = getSlot(item);
    if (!bySlot[s]) bySlot[s] = [];
    bySlot[s].push(item);
  }

  const picked: WardrobeItem[] = [];
  const missing: string[] = [];

  const wantsDress = req.includes('dress') || req.includes('elegant') || req.includes('party');

  if (wantsDress && bySlot.dress?.length) {
    const dress = chooseForRequest(bySlot.dress, request);
    if (dress) picked.push(dress);
  } else {
    const top = chooseForRequest(bySlot.top || [], request);
    const bottom = chooseForRequest(bySlot.bottom || [], request);
    if (top) picked.push(top); else missing.push('top');
    if (bottom) picked.push(bottom); else missing.push('bottom');
  }

  const jacket = chooseForRequest(bySlot.jacket || [], request);
  if (jacket && !isTooCasualForFormal(jacket)) picked.push(jacket);
  const shoes = chooseForRequest(bySlot.shoes || [], request);
  if (shoes) picked.push(shoes); else missing.push('shoes');
  const socks = chooseForRequest(bySlot.socks || [], request);
  if (socks) picked.push(socks);
  // Do not guess with optional accessories in the fallback. A misplaced
  // garment must never be silently presented as an accessory.

  if (picked.length === 0) {
    return {
      message: `I couldn't build an outfit. You have:\n${items.map(i => `• ${i.name} (${i.category})`).join('\n')}`
    };
  }

  const slotEmoji: Record<string, string> = {
    top: '👕', bottom: '👖', dress: '👗', jacket: '🧥',
    shoes: '👟', socks: '🧦', accessories: '👜'
  };

  const itemLines = picked.map(i => `${slotEmoji[getSlot(i)] || '✨'} **${i.name}** (${i.category})`).join('\n');
  const occasionNote = isFormalRequest(request)
    ? '\n\nI treated this as a formal occasion, so casual sportswear was deliberately left out.'
    : '';

  const missingNote = missing.length > 0
    ? `\n\n⚠️ **Not in your wardrobe:** ${missing.join(', ')} — consider adding these!`
    : '';

  return {
    message: `Here's my outfit suggestion for you! 👗✨\n\n${itemLines}${missingNote}`,
    outfitSuggestions: [makeOutfitSuggestion(picked, `${occasionNote}Best match for: ${request}`, request)]
  };
}
