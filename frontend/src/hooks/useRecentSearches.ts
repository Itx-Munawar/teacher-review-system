import { useState, useCallback } from 'react';

const STORAGE_KEY = 'recent_teacher_searches';
const MAX_RECENT = 5;

function getStoredSearches(): string[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function storeSearches(searches: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function useRecentSearches() {
    const [recentSearches, setRecentSearches] = useState<string[]>(getStoredSearches);

    const addSearch = useCallback((term: string) => {
        const trimmed = term.trim();
        if (!trimmed) return;

        setRecentSearches((prev) => {
            // Remove duplicate if exists, then prepend
            const filtered = prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
            const next = [trimmed, ...filtered].slice(0, MAX_RECENT);
            storeSearches(next);
            return next;
        });
    }, []);

    const removeSearch = useCallback((term: string) => {
        setRecentSearches((prev) => {
            const next = prev.filter((s) => s !== term);
            storeSearches(next);
            return next;
        });
    }, []);

    const clearSearches = useCallback(() => {
        setRecentSearches([]);
        storeSearches([]);
    }, []);

    return { recentSearches, addSearch, removeSearch, clearSearches };
}
