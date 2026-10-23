/**
 * AI Stylist Chat Page
 * Conversational AI assistant for outfit suggestions
 */

import { useState, useRef, useEffect } from 'react';
import { TopBar } from '@/components/layout';
import { 
  AnimatedBackground, 
  Button, 
  Input,
  Loader
} from '@/components/common';
import { useT } from '@/i18n';
import { useWardrobe, useFavouriteItems } from '@/hooks/useWardrobe';
import { useLikedPosts } from '@/hooks/usePosts';
import { useToast } from '@/hooks/useToast';
import { chatWithStylist, scoreOutfitCompatibility, type ChatMessage } from '@/services/aiStylistChat';
import type { WardrobeItem } from '@/types/models';

function cleanStylistText(text: string): string {
  return text
    .replace(/\bfashion\b/gi, 'Remy')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function OutfitPieceRail({ items }: { items: WardrobeItem[] }) {
  const railRef = useRef<HTMLDivElement>(null);

  const move = (direction: number) => {
    railRef.current?.scrollBy({ left: direction * 210, behavior: 'smooth' });
  };

  return (
    <div className="group/rail relative px-4 py-4">
      <div ref={railRef} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {items.map((item) => (
          <div key={item.id} className="min-w-[155px] snap-start overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(80,55,100,0.08)] ring-1 ring-neutral-100 transition duration-300 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(80,55,100,0.16)] sm:min-w-[185px]">
            <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
              <img
                src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/clothes/${item.image_path}`}
                alt={item.name}
                className="h-full w-full object-cover transition duration-500 hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
                <span className="max-w-[75%] truncate rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">{item.name}</span>
                <span className="rounded-full bg-white/90 px-2 py-1 text-[9px] font-bold uppercase text-primary-700 shadow-sm">{item.category}</span>
              </div>
            </div>
            <p className="truncate px-3 py-3 text-xs font-semibold text-neutral-800" title={item.name}>{item.name}</p>
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <>
          <button type="button" onClick={() => move(-1)} aria-label="Previous clothing piece" className="absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-white/95 text-lg text-neutral-700 opacity-0 shadow-lg transition group-hover/rail:opacity-100 hover:bg-primary-500 hover:text-white">‹</button>
          <button type="button" onClick={() => move(1)} aria-label="Next clothing piece" className="absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-white/95 text-lg text-neutral-700 opacity-0 shadow-lg transition group-hover/rail:opacity-100 hover:bg-primary-500 hover:text-white">›</button>
        </>
      )}
    </div>
  );
}

function OutfitCarousel({ outfits }: { outfits: NonNullable<ChatMessage['outfitSuggestions']> }) {
  const move = (direction: number) => { void direction; };
  const active = 0;

  return (
    <div className="mt-4 -mx-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary-600">Curated looks</p>
          <p className="text-xs text-neutral-500">Compare your best options</p>
        </div>
        {outfits.length > 1 && (
          <div className="hidden flex gap-1.5">
            <button type="button" onClick={() => move(-1)} disabled={active === 0} aria-label="Previous outfit" className="h-8 w-8 rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-primary-300 hover:text-primary-600 disabled:opacity-30">‹</button>
            <button type="button" onClick={() => move(1)} disabled={active === outfits.length - 1} aria-label="Next outfit" className="h-8 w-8 rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-primary-300 hover:text-primary-600 disabled:opacity-30">›</button>
          </div>
        )}
      </div>

      <div className="grid gap-5 px-1 pb-3">
        {outfits.map((outfit, idx) => (
          <div key={idx} style={{ animationDelay: `${idx * 140}ms` }} className="stylist-card-enter stylist-card-border w-full overflow-hidden rounded-2xl bg-white/95 shadow-[0_18px_45px_rgba(86,55,100,0.12)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_55px_rgba(86,55,100,0.18)]">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${idx === 0 ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-700'}`}>{idx + 1}</span>
                <div>
                  <p className="text-sm font-bold text-neutral-900">{idx === 0 ? 'Best match' : idx === 1 ? 'Strong alternative' : 'Creative option'}</p>
                  <p className="text-[11px] text-neutral-500">{outfit.items.length} wardrobe pieces</p>
                </div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-primary-600 shadow-sm">LOOK {idx + 1}</span>
            </div>

            <OutfitPieceRail items={outfit.items} />

            {outfit.overallScore !== undefined && (
              <div className="border-t border-neutral-100 bg-primary-50/50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary-700">Style compatibility</p>
                  <span className="rounded-full bg-primary-500 px-2.5 py-1 text-xs font-bold text-white">{outfit.overallScore}%</span>
                </div>
                {outfit.compatibility && outfit.compatibility.length > 0 && (
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {outfit.compatibility.map(pair => (
                      <div key={`${pair.firstItemId}-${pair.secondItemId}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2.5 py-2 text-[11px] text-neutral-600">
                        <span className="min-w-0 truncate" title={`${pair.firstItemName} + ${pair.secondItemName}`}>{pair.firstItemName} + {pair.secondItemName}</span>
                        <span className="shrink-0 font-bold text-primary-700">{pair.score}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-neutral-100 px-4 py-3">
              <p className="text-xs leading-relaxed text-neutral-600">{cleanStylistText(outfit.reason)}</p>
            </div>
          </div>
        ))}
      </div>

      {outfits.length > 1 && (
        <div className="hidden flex justify-center gap-1.5 pt-1">
          {outfits.map((_, idx) => <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === active ? 'w-5 bg-primary-500' : 'w-1.5 bg-neutral-300'}`} />)}
        </div>
      )}
    </div>
  );
}

export function StylistPage() {
  const t = useT();
  const { showToast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Get all wardrobe items
  const { items: ownedItems, loading: ownedLoading } = useWardrobe();
  const { items: favouriteItems, loading: favouritesLoading } = useFavouriteItems();
  const { posts: likedPosts, loading: likedLoading } = useLikedPosts();
  
  const itemsLoading = ownedLoading || favouritesLoading || likedLoading;
  
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Hi! I'm your AI fashion stylist! 👗✨\n\nI'll read ALL your clothes (owned, favourites & liked) and use Groq AI + Gemini to find the best outfit for you.\n\nJust tell me:\n• "I want a casual outfit"\n• "Something for a party tonight"\n• "What to wear to work?"\n• "Show me a summer look"\n\nI'll tell you which pieces to wear AND what's missing from your wardrobe!`,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const saveFeedback = (messageIndex: number, feedback: 'helpful' | 'not-helpful') => {
    setMessages(prev => prev.map((message, index) => index === messageIndex ? { ...message, feedback } : message));
    try {
      const stored = JSON.parse(localStorage.getItem('remy-stylist-feedback') || '[]') as Array<{ messageIndex: number; feedback: string; timestamp: string }>;
      stored.push({ messageIndex, feedback, timestamp: new Date().toISOString() });
      localStorage.setItem('remy-stylist-feedback', JSON.stringify(stored.slice(-100)));
    } catch {
      // Feedback must never interrupt the styling conversation.
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const userInput = input;
    setInput('');
    setLoading(true);

    // Show "reading wardrobe" status immediately
    const thinkingMessage: ChatMessage = {
      role: 'assistant',
      content: '🔍 Reading your wardrobe and analyzing each item...',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, thinkingMessage]);

    try {
      // Combine all wardrobe items from all sources — deduplicated by ID
      const itemsMap = new Map<string, WardrobeItem>();

      ownedItems.forEach(item => itemsMap.set(item.id, item));
      favouriteItems.forEach(item => itemsMap.set(item.id, item));
      likedPosts.forEach(post => {
        if (!itemsMap.has(post.id)) {
          itemsMap.set(post.id, {
            id: post.id,
            user_id: post.user_id,
            name: post.description || 'Liked item',
            category: post.category,
            size: 'M',
            image_path: post.image_path,
            is_favourite: false,
            ai_attributes: null,
            created_at: post.created_at,
          });
        }
      });

      const allItems = Array.from(itemsMap.values());

      console.log(`\n=== Wardrobe loaded: ${allItems.length} unique items ===`);
      allItems.forEach((i, n) => console.log(`  ${n + 1}. ${i.name} [${i.category}]`));

      if (allItems.length === 0) {
        setMessages(prev => prev.slice(0, -1).concat({
          role: 'assistant',
          content: 'Your wardrobe is empty! 👗\nPlease add some items in the Wardrobe tab first.',
          timestamp: new Date()
        }));
        setLoading(false);
        return;
      }

      const response = await chatWithStylist(userInput, allItems, messages);

      // Accessories are useful finishing pieces even when they are not part
      // of the AI's required top/bottom/dress structure. Keep them visible so
      // a ring, belt, or bag is never silently lost from the recommendation.
      const accessoryItems = allItems.filter(item =>
        (item.category === 'Accessories' || item.category === 'Bags') &&
        !/pantalon|pants|trouser|jeans?|skirt|shorts|legging/i.test(item.name)
      );
      const shownAccessoryIds = new Set((response.outfitSuggestions || []).flatMap(outfit => outfit.items.map(item => item.id)));
      const unshownAccessories = accessoryItems.filter(item => !shownAccessoryIds.has(item.id));
      const accessoryMessage = unshownAccessories.length > 0
        ? `\n\n✨ Accessories from your wardrobe:\n${unshownAccessories.map(item => `• ${item.name} (${item.category}) — consider this as a finishing touch for the look.`).join('\n')}`
        : '';
      const accessorySuggestions = response.outfitSuggestions && response.outfitSuggestions.length > 0 && unshownAccessories.length > 0
        ? response.outfitSuggestions.map((outfit, index) => index === 0
          ? (() => {
              const items = [...outfit.items, ...unshownAccessories];
              return { ...outfit, items, ...scoreOutfitCompatibility(items, userInput), reason: `${outfit.reason}\nFinishing pieces: ${unshownAccessories.map(item => item.name).join(', ')}.` };
            })()
          : outfit)
        : response.outfitSuggestions;

      // Replace the thinking message with the real response
      setMessages(prev => prev.slice(0, -1).concat({
        role: 'assistant',
        content: `${response.message || 'Sorry, I could not process that request.'}${accessoryMessage}`,
        outfitSuggestions: accessorySuggestions,
        clarification: response.clarification,
        timestamp: new Date()
      }));

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => prev.slice(0, -1).concat({
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date()
      }));
      showToast('Failed to get response. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (itemsLoading) {
    return (
      <>
        <AnimatedBackground variant="stylist" />
        <TopBar title={t('stylist.title')} showProfile={false} />
        <div className="flex-1 flex items-center justify-center">
          <Loader size="lg" />
        </div>
      </>
    );
  }

  return (
    <>
      <AnimatedBackground variant="stylist" />
      <TopBar title={t('stylist.title')} showProfile={false} />
      
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10">
        {/* Wardrobe summary bar */}
        {!itemsLoading && (
          <div className="bg-white/80 backdrop-blur border-b border-neutral-100 px-4 py-2 flex items-center gap-3 text-xs text-neutral-600">
            <span>🧠 AI can see:</span>
            <span className="font-medium text-primary-600">{ownedItems.length} owned</span>
            <span>·</span>
            <span className="font-medium text-primary-600">{favouriteItems.length} favourites</span>
            <span>·</span>
            <span className="font-medium text-primary-600">{likedPosts.length} liked</span>
            <span className="ml-auto text-neutral-400">Master Stylist · Gemini Vision + Groq fallback</span>
          </div>
        )}
        {/* Chat Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-white/20 via-primary-50/10 to-white/30 p-4 sm:p-6">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`animate-slide-up flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`${message.role === 'user' ? 'max-w-[80%]' : 'w-full max-w-[920px]'} rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-primary-500 text-white'
                    : 'stylist-chat-surface border border-white/70 text-neutral-900'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{cleanStylistText(message.content)}</p>
                
                {message.outfitSuggestions && message.outfitSuggestions.length > 0 && (
                  <OutfitCarousel outfits={message.outfitSuggestions} />
                )}

                {message.clarification && (
                  <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50/70 p-3">
                    <p className="text-xs font-semibold text-primary-800">{message.clarification.question}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.clarification.options.map(option => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setInput(option)}
                          disabled={loading}
                          className="rounded-full border border-primary-200 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 transition hover:border-primary-400 hover:bg-primary-100 disabled:opacity-50"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {message.role === 'assistant' && index > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-neutral-500">
                    <span>Was this useful?</span>
                    <button
                      type="button"
                      aria-label="Mark stylist response helpful"
                      onClick={() => saveFeedback(index, 'helpful')}
                      className={`rounded-full px-2 py-1 transition ${message.feedback === 'helpful' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 hover:bg-emerald-50 hover:text-emerald-700'}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      aria-label="Mark stylist response not helpful"
                      onClick={() => saveFeedback(index, 'not-helpful')}
                      className={`rounded-full px-2 py-1 transition ${message.feedback === 'not-helpful' ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 hover:bg-rose-50 hover:text-rose-700'}`}
                    >
                      Not quite
                    </button>
                  </div>
                )}
                
                <p className="text-xs opacity-60 mt-2">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-3">
                <Loader size="sm" />
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-white/80 bg-white/85 p-4 shadow-[0_-12px_35px_rgba(86,55,100,0.08)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-4xl items-center gap-2 rounded-2xl bg-neutral-50 p-1.5 ring-1 ring-neutral-200 focus-within:ring-2 focus-within:ring-primary-300">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('stylist.chatPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              disabled={loading || itemsLoading}
              className="flex-1 border-0 bg-transparent shadow-none focus:ring-0"
            />
            <Button
              onClick={handleSend}
              disabled={loading || !input.trim() || itemsLoading}
              size="md"
            >
              {loading ? <Loader size="sm" /> : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </Button>
          </div>
          
          {/* Quick Suggestions */}
          <div className="max-w-4xl mx-auto mt-3 flex flex-wrap gap-2">
            {[
              t('stylist.casualOutfit'),
              t('stylist.formalOutfit'),
              t('stylist.partyOutfit'),
              t('stylist.summerOutfit'),
            ].map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => setInput(suggestion)}
                disabled={loading}
                className="px-3 py-1 text-xs bg-neutral-100 hover:bg-neutral-200 rounded-full text-neutral-700 transition-colors disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
