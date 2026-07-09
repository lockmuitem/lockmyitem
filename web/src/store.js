import { categoryImages, seedItems } from './data.js';
import { classifyByText } from './utils.js';

const STORAGE_KEY = 'shanghaitech_lostfound_web_v1';

export function loadItems() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return seedItems;
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed.items) ? parsed.items : seedItems;
  } catch {
    return seedItems;
  }
}

export function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }));
}

export function createItem(payload) {
  const classification = payload.category
    ? { category: payload.category, tags: payload.tags || [] }
    : classifyByText(`${payload.title} ${payload.description}`);

  return {
    id: `item_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: payload.type,
    title: payload.title.trim(),
    description: payload.description.trim(),
    category: classification.category,
    tags: Array.from(new Set([classification.category, ...(payload.tags || classification.tags || [])])).filter(Boolean),
    image: payload.image || categoryImages[classification.category] || categoryImages.其他,
    locationId: payload.locationId,
    ownerName: payload.ownerName || '网页用户',
    status: 'active',
    createdAt: new Date().toISOString()
  };
}
