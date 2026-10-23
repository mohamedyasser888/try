/**
 * Core Domain Models
 * TypeScript type definitions for all data models in the application
 */

// ============================================================================
// Enums and Basic Types
// ============================================================================

/**
 * User gender - determines available clothing categories
 * Immutable after registration
 */
export type Gender = 'female' | 'male';

/**
 * Clothing sizes - standardized across all items
 */
export type Size = string;

/**
 * Female-specific clothing categories
 */
export type FemaleCategory =
  | 'Dresses'
  | 'Tops'
  | 'Bottoms'
  | 'Jackets'
  | 'Swimwear'
  | 'Scarf'
  | 'Hijab'
  | 'Shoes'
  | 'Socks'
  | 'Formal wear'
  | 'Bags'
  | 'Accessories'
  | 'Sports wear';

/**
 * Male-specific clothing categories
 */
export type MaleCategory =
  | 'Tops'
  | 'Bottoms'
  | 'Jackets'
  | 'Shoes'
  | 'Socks'
  | 'Belts'
  | 'Accessories';

/**
 * Union of all clothing categories
 */
export type Category = FemaleCategory | MaleCategory;

// ============================================================================
// Database Models
// ============================================================================

/**
 * User profile information
 * Created automatically via trigger on auth.users insert
 */
export interface Profile {
  id: string;
  display_name: string;
  gender: Gender;
  age: number | null;
  created_at: string;
}

/**
 * AI attributes for clothing items
 * Reserved for future AI stylist functionality
 */
export interface AIAttributes {
  color?: string;
  colors?: string[];
  garment_type?: string;
  style?: string;
  occasion?: string[];
  season?: string[];
  pattern?: string;
  material?: string;
  fabric?: string;
  weight?: 'light' | 'medium' | 'heavy' | string;
  warmth?: 'cool' | 'medium' | 'warm' | string;
  fit?: string;
  formality?: 'casual' | 'smart-casual' | 'formal' | string;
  description?: string;
}

/**
 * Wardrobe item - user's personal clothing collection
 */
export interface WardrobeItem {
  id: string;
  user_id: string;
  name: string;
  size: Size;
  category: Category;
  image_path: string;
  is_favourite: boolean;
  ai_attributes: AIAttributes | null;
  created_at: string;
}

/**
 * Community post - shared clothing item
 */
export interface Post {
  id: string;
  user_id: string;
  name: string;
  size: Size;
  category: Category;
  description: string;
  image_path: string;
  brand?: string | null;
  brand_partner_id?: string | null;
  review?: string | null;
  created_at: string;
}

/**
 * Post like relationship
 */
export interface PostLike {
  user_id: string;
  post_id: string;
  created_at: string;
}

/**
 * Extended post with joined data
 * Includes poster information and like counts
 */
export interface PostWithLikes extends Post {
  display_name: string;
  poster_gender: Gender;
  likes_count: number;
  is_liked_by_user?: boolean;
}

// ============================================================================
// AI Stylist Integration Types
// ============================================================================

/**
 * Stylist item format for AI integration
 * Used to provide wardrobe context to AI and display outfit recommendations
 */
export interface StylistItem {
  id: string;
  name: string;
  size: Size;
  category: Category;
  image_url: string; // Full public URL (not path)
  is_favourite: boolean;
  ai_attributes: AIAttributes | null;
}

/**
 * AI outfit recommendation response
 * Future implementation - not used yet
 */
export interface AIOutfitResponse {
  reply: string;
  outfit_item_ids: string[];
}

// ============================================================================
// Form Input Types
// ============================================================================

/**
 * Sign up form data
 */
export interface SignUpData {
  email: string;
  password: string;
  displayName: string;
  gender: Gender;
  age: number;
}

/**
 * Sign in form data
 */
export interface SignInData {
  email: string;
  password: string;
}

/**
 * Wardrobe item form data (create/edit)
 */
export interface WardrobeItemFormData {
  name: string;
  size: Size;
  category: Category;
  image?: File;
  is_favourite?: boolean;
}

/**
 * Post form data (create)
 */
export interface PostFormData {
  name: string;
  size: Size;
  category: Category;
  description: string;
  image?: File;
}

// ============================================================================
// UI State Types
// ============================================================================

/**
 * Loading state for async operations
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Generic error type
 */
export interface AppError {
  message: string;
  code?: string;
  userMessage?: string;
}

/**
 * Filter state for wardrobe/posts
 */
export interface FilterState {
  category: Category | 'All';
}

/**
 * Wardrobe tab types
 */
export type WardrobeTab = 'owned' | 'favourites' | 'liked';

// ============================================================================
// Supabase Response Types
// ============================================================================

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  data: T | null;
  error: AppError | null;
}

/**
 * Pagination params
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}
