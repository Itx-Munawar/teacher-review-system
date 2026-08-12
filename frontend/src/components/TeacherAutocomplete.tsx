import React, { useState, useEffect, useRef } from 'react';
import { searchAllTeachers } from '../services/api';
import { debounce } from '../utils/debounce';

interface Teacher {
    id: number;
    name: string;
    department: string;
    review_count: number;
    image_url?: string;
}

interface TeacherAutocompleteProps {
    value: string;
    onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSelect: (teacher: Teacher) => void;
    onClear: () => void;
    placeholder?: string;
}

const TeacherAutocomplete: React.FC<TeacherAutocompleteProps> = ({
    value,
    onInputChange,
    onSelect,
    onClear,
    placeholder = 'Search by teacher name or department...'
}) => {
    const [suggestions, setSuggestions] = useState<Teacher[]>([]);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const boxRef = useRef<HTMLDivElement>(null);

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
            setOpen(false);
            return;
        }
        debouncedSuggest.current(query);
    }, [value]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!open || suggestions.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(prev => (prev + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        } else if (e.key === 'Enter') {
            if (activeIndex >= 0 && suggestions[activeIndex]) {
                e.preventDefault();
                onSelect(suggestions[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <div className="autocomplete" ref={boxRef}>
            <input
                type="text"
                placeholder={placeholder}
                aria-label={placeholder}
                value={value}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
                className="search-input"
            />
            {open && suggestions.length > 0 && (
                <ul className="autocomplete-dropdown" role="listbox">
                    {suggestions.map((t, idx) => (
                        <li
                            key={t.id}
                            role="option"
                            aria-selected={idx === activeIndex}
                            className={`autocomplete-item ${idx === activeIndex ? 'autocomplete-item-active' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onSelect(t);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                        >
                            {t.image_url ? (
                                <img src={t.image_url} alt="" className="autocomplete-avatar" loading="lazy" />
                            ) : (
                                <div className="autocomplete-avatar autocomplete-avatar-fallback">👤</div>
                            )}
                            <div className="autocomplete-text">
                                <span className="autocomplete-name">{t.name}</span>
                                <span className="autocomplete-dept">{t.department}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default TeacherAutocomplete;
