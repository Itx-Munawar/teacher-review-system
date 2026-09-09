import React, { useState, useRef, useEffect, useMemo } from 'react';

interface SearchableDropdownProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
    placeholder?: string;
    required?: boolean;
    id?: string;
}

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
    label,
    value,
    onChange,
    options,
    placeholder = 'Type to search...',
    required = false,
    id,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSearchTerm(value);
    }, [value]);

    const filtered = useMemo(() => {
        if (!searchTerm) return options;
        const lower = searchTerm.toLowerCase();
        return options.filter(opt => opt.toLowerCase().includes(lower));
    }, [searchTerm, options]);

    // Close on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearchTerm(value);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [value]);

    // Close on Escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setSearchTerm(value);
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [value]);

    const handleSelect = (option: string) => {
        onChange(option);
        setSearchTerm(option);
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange('');
        setSearchTerm('');
        inputRef.current?.focus();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setSearchTerm(val);
        if (!isOpen) setIsOpen(true);
        // If the user types an exact match from options, select it
        const match = options.find(opt => opt.toLowerCase() === val.toLowerCase());
        if (match) {
            onChange(match);
        } else {
            onChange(val);
        }
    };

    return (
        <div className="searchable-dropdown" ref={containerRef}>
            <label htmlFor={id}>{label}{required && ' *'}</label>
            <div className="searchable-dropdown-input-wrapper">
                <input
                    ref={inputRef}
                    id={id}
                    type="text"
                    className="searchable-dropdown-input"
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                />
                {searchTerm && (
                    <button
                        type="button"
                        className="searchable-dropdown-clear"
                        onClick={handleClear}
                        aria-label="Clear selection"
                    >
                        ×
                    </button>
                )}
            </div>
            {isOpen && filtered.length > 0 && (
                <div
                    ref={listRef}
                    className="searchable-dropdown-list"
                    role="listbox"
                >
                    {filtered.map((option, idx) => (
                        <div
                            key={idx}
                            className={`searchable-dropdown-item ${option === value ? 'selected' : ''}`}
                            onClick={() => handleSelect(option)}
                            role="option"
                            aria-selected={option === value}
                        >
                            {option}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SearchableDropdown;
