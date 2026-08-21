import React, { useState, useEffect, useRef } from 'react';
import { searchAllTeachers } from '../services/api';
import { debounce } from '../utils/debounce';
import Avatar from './Avatar';
import Icon from './Icon';
import { useRecentSearches } from '../hooks/useRecentSearches';
import type { Teacher } from '../types';

interface TeacherAutocompleteProps {
    value: string;
    onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSelect: (teacher: Teacher) => void;
    onClear: () => void;
    onCompare?: (teacher: Teacher) => void;
    isInCompare?: (teacher: Teacher) => boolean;
    placeholder?: string;
    inputRef?: React.RefObject<HTMLInputElement>;
}

const TeacherAutocomplete: React.FC<TeacherAutocompleteProps> = ({
    value,
    onInputChange,
    onSelect,
    onClear,
    onCompare,
    isInCompare,
    placeholder = 'Search by teacher name or department...',
    inputRef
}) => {
    const [suggestions, setSuggestions] = useState<Teacher[]>([]);
    const [trending, setTrending] = useState<Teacher[]>([]);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [showRecent, setShowRecent] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const { recentSearches, addSearch, removeSearch, clearSearches } = useRecentSearches();

    // Load trending teachers on mount
    useEffect(() => {
        searchAllTeachers('', 5).then((res) => {
            // Sort by review_count descending for trending
            const sorted = (res.data || [])
                .sort((a: Teacher, b: Teacher) => (b.review_count || 0) - (a.review_count || 0))
                .slice(0, 5);
            setTrending(sorted);
        }).catch(() => {});
    }, []);

    const debouncedSuggest = useRef(debounce(async (query: string) => {
        try {
            const res = await searchAllTeachers(query, 8);
            setSuggestions(res.data || []);
            setOpen(true);
            setActiveIndex(-1);
        } catch {
            setSuggestions([]);
            setOpen(false);
        }
    }, 250));

    useEffect(() => {
        const query = value.trim();
        if (!query) {
            setSuggestions([]);
            // Don't close if showing recent
            if (!showRecent) setOpen(false);
            return;
        }
        setShowRecent(false);
        debouncedSuggest.current(query);
    }, [value]);

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

    const handleFocus = () => {
        if (value.trim()) {
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
        // Trigger search with this term
        const syntheticEvent = {
            target: { value: term }
        } as React.ChangeEvent<HTMLInputElement>;
        onInputChange(syntheticEvent);
    };

    const handleRecentRemove = (e: React.MouseEvent, term: string) => {
        e.stopPropagation();
        removeSearch(term);
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
                addSearch(value.trim());
                onSelect(suggestions[activeIndex]);
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
                value={value}
                onChange={onInputChange}
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
                                addSearch(value.trim());
                                onSelect(t);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                        >
                            <Avatar name={t.name} imageUrl={t.image_url} className="autocomplete-avatar" />
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
