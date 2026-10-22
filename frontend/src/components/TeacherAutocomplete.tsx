import React, { useState, useEffect, useRef } from 'react';
import { searchAllTeachers } from '../services/api';
import { debounce } from '../utils/debounce';
import type { DebouncedFunction } from '../utils/debounce';
import Avatar from './Avatar';
import Icon from './Icon';
import { useRecentSearches } from '../hooks/useRecentSearches';
import type { Teacher } from '../types';

interface TeacherAutocompleteProps {
    value: string;
    onQueryChange: (value: string) => void;
    onSelect: (teacher: Teacher) => void;
    onCompare?: (teacher: Teacher) => void;
    isInCompare?: (teacher: Teacher) => boolean;
    placeholder?: string;
    inputRef?: React.RefObject<HTMLInputElement>;
}

const TeacherAutocomplete: React.FC<TeacherAutocompleteProps> = ({
    value,
    onQueryChange,
    onSelect,
    onCompare,
    isInCompare,
    // The sidebar input is ~180px of usable width on a small laptop; a long
    // placeholder gets clipped mid-word. Keep it short and unambiguous.
    placeholder = 'Search by teacher or department',
    inputRef
}) => {
    // The input owns its text while the user types. Updating App state on every
    // keystroke re-rendered the whole page (and pushed a history entry per key
    // on mobile), which made typing feel delayed. Local state keeps each
    // keystroke inside this component; the parent is notified once the user
    // pauses.
    const [query, setQuery] = useState(value);
    const [suggestions, setSuggestions] = useState<Teacher[]>([]);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [showRecent, setShowRecent] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const onQueryChangeRef = useRef(onQueryChange);

    // Last value sent to (or received from) the parent, so the controlled-prop
    // echo does not overwrite text typed during the debounce window.
    const lastNotifiedValue = useRef(value);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const debouncedSuggest = useRef<DebouncedFunction<[string]> | null>(null);
    const notifyParent = useRef<DebouncedFunction<[string]> | null>(null);

    if (debouncedSuggest.current === null) {
        debouncedSuggest.current = debounce(async (rawQuery: string) => {
            const requestId = ++requestIdRef.current;
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            try {
                const res = await searchAllTeachers(rawQuery, 8, controller.signal);
                if (requestId !== requestIdRef.current || controller.signal.aborted) return;
                setSuggestions(res.data || []);
                setActiveIndex(-1);
                // Don't pop the dropdown open if the user has already left.
                if (boxRef.current && boxRef.current.contains(document.activeElement)) {
                    setOpen(true);
                }
            } catch {
                if (requestId !== requestIdRef.current || controller.signal.aborted) return;
                setSuggestions([]);
                setOpen(false);
            }
        }, 250);
    }

    if (notifyParent.current === null) {
        notifyParent.current = debounce((next: string) => {
            lastNotifiedValue.current = next;
            onQueryChangeRef.current(next);
        }, 400);
    }

    const { recentSearches, addSearch, removeSearch, clearSearches } = useRecentSearches();

    useEffect(() => {
        onQueryChangeRef.current = onQueryChange;
    }, [onQueryChange]);

    // Sync only genuine external changes (deep links, clearing after a
    // selection). Echoes of our own debounced update are ignored.
    useEffect(() => {
        if (value === lastNotifiedValue.current) return;
        notifyParent.current?.cancel();
        debouncedSuggest.current?.cancel();
        abortRef.current?.abort();
        requestIdRef.current += 1;
        lastNotifiedValue.current = value;
        setQuery(value);

        if (!value.trim()) {
            setSuggestions([]);
            setOpen(false);
            setShowRecent(false);
            setActiveIndex(-1);
        }
    }, [value]);

    useEffect(() => {
        const trimmed = query.trim();
        if (!trimmed) return;
        setShowRecent(false);
        debouncedSuggest.current?.(trimmed);
    }, [query]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
                setOpen(false);
                setShowRecent(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => () => {
        debouncedSuggest.current?.cancel();
        notifyParent.current?.cancel();
        abortRef.current?.abort();
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        setQuery(next);
        setActiveIndex(-1);
        setShowRecent(false);

        // A newer keystroke makes any in-flight suggestion request stale.
        abortRef.current?.abort();
        requestIdRef.current += 1;

        if (!next.trim()) {
            debouncedSuggest.current?.cancel();
            notifyParent.current?.cancel();
            lastNotifiedValue.current = '';
            setSuggestions([]);
            setOpen(false);
            onQueryChangeRef.current('');
            return;
        }

        notifyParent.current?.(next);
    };

    const handleFocus = () => {
        if (query.trim()) {
            if (suggestions.length > 0) setOpen(true);
        } else {
            // Show recent searches when focused with empty input
            setShowRecent(true);
            setOpen(true);
            setActiveIndex(-1);
        }
    };

    const handleRecentSelect = (term: string) => {
        addSearch(term);
        setShowRecent(false);
        setActiveIndex(-1);
        setQuery(term);
        notifyParent.current?.cancel();
        lastNotifiedValue.current = term;
        onQueryChangeRef.current(term);
    };

    const handleRecentRemove = (e: React.MouseEvent, term: string) => {
        e.stopPropagation();
        removeSearch(term);
    };

    const selectTeacher = (teacher: Teacher) => {
        addSearch(query.trim());
        debouncedSuggest.current?.cancel();
        notifyParent.current?.cancel();
        abortRef.current?.abort();
        requestIdRef.current += 1;
        lastNotifiedValue.current = '';
        setQuery('');
        setSuggestions([]);
        setOpen(false);
        setShowRecent(false);
        setActiveIndex(-1);
        onSelect(teacher);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const items = showRecent ? recentSearches : suggestions;
        if (!open || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(prev => (prev + 1) % items.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(prev => (prev - 1 + items.length) % items.length);
        } else if (e.key === 'Enter') {
            if (showRecent && activeIndex >= 0 && recentSearches[activeIndex]) {
                e.preventDefault();
                handleRecentSelect(recentSearches[activeIndex]);
            } else if (!showRecent && activeIndex >= 0 && suggestions[activeIndex]) {
                e.preventDefault();
                selectTeacher(suggestions[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
            setShowRecent(false);
        }
    };

    const dropdownItems = showRecent ? recentSearches : suggestions;
    const showDropdown = open && dropdownItems.length > 0;

    return (
        <div className="autocomplete" ref={boxRef}>
            <input
                type="text"
                placeholder={placeholder}
                aria-label={placeholder}
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                className="search-input"
                ref={inputRef}
            />
            {showDropdown && (
                <ul className="autocomplete-dropdown" role="listbox">
                    {showRecent && (
                        <li className="autocomplete-header">
                            <span>Recent Searches</span>
                            <button
                                className="autocomplete-clear-btn"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    clearSearches();
                                    setShowRecent(false);
                                }}
                            >
                                Clear all
                            </button>
                        </li>
                    )}
                    {showRecent && recentSearches.map((term, idx) => (
                        <li
                            key={term}
                            role="option"
                            aria-selected={idx === activeIndex}
                            className={`autocomplete-item autocomplete-item-recent ${idx === activeIndex ? 'autocomplete-item-active' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleRecentSelect(term);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                        >
                            <Icon name="search" size={14} className="autocomplete-recent-icon" />
                            <span className="autocomplete-recent-text">{term}</span>
                            <button
                                className="autocomplete-remove-btn"
                                onMouseDown={(e) => handleRecentRemove(e, term)}
                                aria-label={`Remove ${term} from recent searches`}
                            >
                                ×
                            </button>
                        </li>
                    ))}
                    {!showRecent && suggestions.map((t, idx) => (
                        <li
                            key={t.id}
                            role="option"
                            aria-selected={idx === activeIndex}
                            className={`autocomplete-item ${idx === activeIndex ? 'autocomplete-item-active' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                selectTeacher(t);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                        >
                            <Avatar name={t.name} imageUrl={t.image_url} className="autocomplete-avatar" size={48} />
                            <div className="autocomplete-text">
                                <span className="autocomplete-name">{t.name}</span>
                                <span className="autocomplete-dept">{t.department}</span>
                            </div>
                            {onCompare && (
                                <button
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onCompare(t);
                                    }}
                                    className={`autocomplete-compare-btn ${isInCompare && isInCompare(t) ? 'autocomplete-compare-btn-active' : ''}`}
                                    aria-label={`Compare ${t.name}`}
                                    title="Add to comparison"
                                >
                                    <span>{isInCompare && isInCompare(t) ? '✓' : '+'}</span>
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default TeacherAutocomplete;
