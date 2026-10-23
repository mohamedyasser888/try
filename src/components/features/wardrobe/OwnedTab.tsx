/**
 * Owned Tab Component
 * Display and manage user's wardrobe items
 */

import { useState, useMemo } from 'react';
import { useWardrobe } from '@/hooks/useWardrobe';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { useT } from '@/i18n';
import { ItemCard } from './ItemCard';
import { ItemForm } from './ItemForm';
import { FilterChips, EmptyState, EmptyStateIcons, SkeletonGrid, Button } from '@/components/common';
import { getCategoriesForGender } from '@/utils/constants';
import { getErrorMessage } from '@/utils/errorHandling';
import type { WardrobeItem, Category } from '@/types';
import { getCategoryLabel } from '@/utils/categoryLabels';
import { analyzeClothingForWardrobe } from '@/services/clothingAnalysis';

interface OwnedTabProps {
  onShareToHome?: (item: WardrobeItem) => void;
}

export function OwnedTab({ onShareToHome }: OwnedTabProps) {
  const t = useT();
  const { profile } = useAuth();
  const { items, loading, addItem, updateItem, deleteItem, toggleFavourite } = useWardrobe();
  const { showToast } = useToast();

  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<WardrobeItem | null>(null);

  const categories = profile ? getCategoriesForGender(profile.gender) : [];
  const filterOptions: (Category | 'All')[] = ['All', ...categories];

  // Filter items by category
  const filteredItems = useMemo(() => {
    if (selectedCategory === 'All') {
      return items;
    }
    return items.filter(item => item.category === selectedCategory);
  }, [items, selectedCategory]);

  const handleAddItem = async (formData: any) => {
    if (!profile) return;

    let aiAttributes = null;
    if (formData.imagePath) {
      const analysis = await analyzeClothingForWardrobe(formData.imagePath, formData.name, formData.category);
      aiAttributes = analysis.attributes;
      if (analysis.warning) showToast(analysis.warning, 'warning');
    }

    const { error } = await addItem({
      user_id: profile.id,
      name: formData.name,
      size: formData.size || null,
      category: formData.category,
      image_path: formData.imagePath,
      is_favourite: false,
      ai_attributes: aiAttributes,
      rating: formData.rating || null,
    } as any);

    if (error) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  const handleEditItem = async (formData: any) => {
    if (!editingItem) return;

    const updates: any = {
      name: formData.name,
      size: formData.size || null,
      category: formData.category,
      rating: formData.rating || null,
    };

    if (formData.imagePath !== editingItem.image_path) {
      updates.image_path = formData.imagePath;
      if (formData.imagePath) {
        const analysis = await analyzeClothingForWardrobe(formData.imagePath, formData.name, formData.category);
        updates.ai_attributes = analysis.attributes;
        if (analysis.warning) showToast(analysis.warning, 'warning');
      }
    } else if (formData.name !== editingItem.name || formData.category !== editingItem.category) {
      const analysis = await analyzeClothingForWardrobe(editingItem.image_path, formData.name, formData.category);
      updates.ai_attributes = analysis.attributes;
      if (analysis.warning) showToast(analysis.warning, 'warning');
    }

    const { error } = await updateItem(editingItem.id, updates);

    if (error) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingItem) return;

    const { error } = await deleteItem(deletingItem.id, deletingItem.image_path);

    if (error) {
      showToast(getErrorMessage(error), 'error');
    } else {
      showToast(t('success.itemDeleted'), 'success');
    }

    setDeletingItem(null);
  };

  const handleToggleFavourite = async (itemId: string, currentStatus: boolean) => {
    const { error } = await toggleFavourite(itemId, currentStatus);

    if (error) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  const openAddForm = () => {
    setEditingItem(null);
    setIsFormOpen(true);
  };

  const openEditForm = (item: WardrobeItem) => {
    setEditingItem(item);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingItem(null);
  };

  if (loading) {
    return <SkeletonGrid count={6} />;
  }

  return (
    <div className="space-y-4">
      {/* Header with Add Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-neutral-900">
          {t('wardrobe.owned')}
        </h2>
        <Button onClick={openAddForm} size="md">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('wardrobe.addItem')}
        </Button>
      </div>

      {/* Category Filter */}
      {items.length > 0 && (
        <FilterChips
          options={filterOptions}
          selected={selectedCategory}
          onChange={setSelectedCategory}
          getLabel={(category) => getCategoryLabel(t, category)}
          showMoreLabel={t('common.showMore')}
          showLessLabel={t('common.showLess')}
        />
      )}

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<EmptyStateIcons.Wardrobe />}
          title={selectedCategory === 'All' ? t('wardrobe.emptyOwned') : t('emptyState.noResults')}
          description={selectedCategory === 'All' ? t('wardrobe.emptyOwnedSubtitle') : t('emptyState.tryDifferentFilter')}
          action={selectedCategory === 'All' ? {
            label: t('wardrobe.addItem'),
            onClick: openAddForm,
          } : undefined}
        />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredItems.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              onToggleFavourite={handleToggleFavourite}
              onEdit={openEditForm}
              onDelete={setDeletingItem}
              onShare={onShareToHome}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Form */}
      <ItemForm
        isOpen={isFormOpen}
        onClose={closeForm}
        onSubmit={editingItem ? handleEditItem : handleAddItem}
        editItem={editingItem}
      />

      {/* Delete Confirmation */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">
              {t('wardrobe.deleteItem')}
            </h3>
            <p className="text-neutral-600 mb-6">
              {t('wardrobe.confirmDelete')}
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setDeletingItem(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                fullWidth
                onClick={handleDeleteConfirm}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
