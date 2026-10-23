import type { AIAttributes } from '@/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function analyzeClothingForWardrobe(
  imagePath: string,
  itemName: string,
  category: string,
): Promise<{ attributes: AIAttributes | null; warning: string | null; error: Error | null }> {
  try {
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/clothes/${imagePath}`;
    const response = await fetch('/api/analyze-clothing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, itemName, category }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Clothing analysis failed');

    const attributes = data.attributes as AIAttributes | null;
    const warning = attributes?.is_clothing === false
      ? 'This image may not contain clothing. Please verify the item before relying on the stylist.'
      : attributes?.category_match === false
        ? 'This item may not match its selected category. Consider recategorizing it.'
        : Array.isArray(attributes?.warnings) && attributes.warnings.length
          ? attributes.warnings.join(' ')
          : null;
    return { attributes, warning, error: null };
  } catch (error) {
    console.warn('Wardrobe analysis unavailable:', error);
    return { attributes: null, warning: null, error: error as Error };
  }
}
