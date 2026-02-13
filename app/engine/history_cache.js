/**
 * FERIXDI Studio — History Cache
 * Предотвращает повторы локаций, реквизита, паттернов
 */

const STORAGE_KEY = 'ferixdi_history_cache';
const MAX_HISTORY = 20;

export class HistoryCache {
  constructor() {
    this.locations = [];
    this.props = [];
    this.wardrobes = [];
    this.categories = [];
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        this.locations = data.locations || [];
        this.props = data.props || [];
        this.wardrobes = data.wardrobes || [];
        this.categories = data.categories || [];
      }
    } catch { /* ignore */ }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        locations: this.locations.slice(-MAX_HISTORY),
        props: this.props.slice(-MAX_HISTORY),
        wardrobes: this.wardrobes.slice(-MAX_HISTORY),
        categories: this.categories.slice(-MAX_HISTORY),
      }));
    } catch { /* ignore */ }
  }

  _normalize(str) {
    return (str || '').toLowerCase().trim();
  }

  hasLocation(location) {
    return this.locations.some(l => this._normalize(l) === this._normalize(location));
  }

  hasProp(prop) {
    return this.props.some(p => this._normalize(p) === this._normalize(prop));
  }

  hasWardrobe(w) {
    return this.wardrobes.some(x => this._normalize(x) === this._normalize(w));
  }

  addGeneration(data) {
    if (data.location) { this.locations.push(data.location); }
    if (data.props) { this.props.push(...data.props); }
    if (data.wardrobeA) { this.wardrobes.push(data.wardrobeA); }
    if (data.wardrobeB) { this.wardrobes.push(data.wardrobeB); }
    if (data.category) { this.categories.push(data.category); }
    this._save();
  }

  getRecentLocations(n = 5) {
    return this.locations.slice(-n);
  }

  clear() {
    this.locations = [];
    this.props = [];
    this.wardrobes = [];
    this.categories = [];
    this._save();
  }

  getStats() {
    return {
      locations: this.locations.length,
      props: this.props.length,
      wardrobes: this.wardrobes.length,
      categories: this.categories.length,
    };
  }
}

export const historyCache = new HistoryCache();
