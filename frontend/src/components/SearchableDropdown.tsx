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
    placeholder = 'Search or scroll to select...',
    required = false,
    id,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

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
                setSearchTerm('');
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Close on Escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setSearchTerm('');
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, []);

    const handleSelect = (option: string) => {
        onChange(option);
        setSearchTerm('');
        setIsOpen(false);
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange('');
        setSearchTerm('');
        inputRef.current?.focus();
    };

    const handleToggle = () => {
        if (isOpen) {
            setIsOpen(false);
            setSearchTerm('');
        } else {
            setIsOpen(true);
            setSearchTerm('');
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        if (!isOpen) setIsOpen(true);
    };

    return (
        <div className="searchable-dropdown" ref={containerRef}>
            <label htmlFor={id}>{label}{required && ' *'}</label>
            <div className="searchable-dropdown-display" onClick={handleToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); } }}>
                <span className={`searchable-dropdown-value ${!value ? 'placeholder' : ''}`}>
                    {value || 'Select a course...'}
                </span>
                <span className="searchable-dropdown-arrows">
                    {value && (
                        <span className="searchable-dropdown-clear" onClick={handleClear} role="button" aria-label="Clear selection">×</span>
                    )}
                    <span className={`searchable-dropdown-chevron ${isOpen ? 'open' : ''}`}>▾</span>
                </span>
            </div>
            {isOpen && (
                <div className="searchable-dropdown-panel">
                    <div className="searchable-dropdown-search">
                        <input
                            ref={inputRef}
                            id={id}
                            type="text"
                            className="searchable-dropdown-input"
                            value={searchTerm}
                            onChange={handleInputChange}
                            placeholder="Type to filter..."
                            autoComplete="off"
                            role="combobox"
                            aria-expanded={isOpen}
                            aria-haspopup="listbox"
                        />
                    </div>
                    <div ref={listRef} className="searchable-dropdown-list" role="listbox">
                        {filtered.length === 0 ? (
                            <div className="searchable-dropdown-empty">No courses found</div>
                        ) : (
                            filtered.map((option, idx) => (
                                <div
                                    key={idx}
                                    className={`searchable-dropdown-item ${option === value ? 'selected' : ''}`}
                                    onClick={() => handleSelect(option)}
                                    role="option"
                                    aria-selected={option === value}
                                >
                                    {option}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableDropdown;
