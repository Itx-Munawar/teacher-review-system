import React, { useState, useRef, useEffect, useMemo } from 'react';

interface SearchableDropdownProps {
    label: string;
    value: string[];
    onChange: (value: string[]) => void;
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
    const [isCustomMode, setIsCustomMode] = useState(false);
    const [customInput, setCustomInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const customInputRef = useRef<HTMLInputElement>(null);
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
                setIsCustomMode(false);
                setCustomInput('');
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
                setIsCustomMode(false);
                setCustomInput('');
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, []);

    const handleToggleSelect = (option: string) => {
        if (value.includes(option)) {
            onChange(value.filter(v => v !== option));
        } else {
            onChange([...value, option]);
        }
        setSearchTerm('');
    };

    const handleRemoveChip = (option: string) => {
        onChange(value.filter(v => v !== option));
    };

    const handleClearAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange([]);
        setSearchTerm('');
        setIsCustomMode(false);
        setCustomInput('');
    };

    const handleToggle = () => {
        if (isOpen) {
            setIsOpen(false);
            setSearchTerm('');
            setIsCustomMode(false);
            setCustomInput('');
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

    const handleOtherClick = () => {
        setIsCustomMode(true);
        setTimeout(() => customInputRef.current?.focus(), 0);
    };

    const handleCustomSubmit = () => {
        const trimmed = customInput.trim();
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
        }
        setCustomInput('');
        setIsCustomMode(false);
        setSearchTerm('');
    };

    const handleCustomKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCustomSubmit();
        } else if (e.key === 'Escape') {
            setIsCustomMode(false);
            setCustomInput('');
        }
    };

    return (
        <div className="searchable-dropdown" ref={containerRef}>
            <label htmlFor={id}>{label}{required && ' *'}</label>

            {/* Selected chips */}
            {value.length > 0 && (
                <div className="searchable-dropdown-chips">
                    {value.map((item, idx) => (
                        <span key={idx} className="searchable-dropdown-chip">
                            {item}
                            <button
                                type="button"
                                className="searchable-dropdown-chip-remove"
                                onClick={() => handleRemoveChip(item)}
                                aria-label={`Remove ${item}`}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Display bar */}
            <div className="searchable-dropdown-display" onClick={handleToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); } }}>
                <span className={`searchable-dropdown-value ${value.length === 0 ? 'placeholder' : ''}`}>
                    {value.length === 0 ? 'Select courses...' : `${value.length} course${value.length > 1 ? 's' : ''} selected`}
                </span>
                <span className="searchable-dropdown-arrows">
                    {value.length > 0 && (
                        <span className="searchable-dropdown-clear" onClick={handleClearAll} role="button" aria-label="Clear all">×</span>
                    )}
                    <span className={`searchable-dropdown-chevron ${isOpen ? 'open' : ''}`}>▾</span>
                </span>
            </div>

            {/* Dropdown panel */}
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
                        {isCustomMode ? (
                            <div className="searchable-dropdown-custom">
                                <div className="searchable-dropdown-custom-label">Type your course name:</div>
                                <div className="searchable-dropdown-custom-row">
                                    <input
                                        ref={customInputRef}
                                        type="text"
                                        className="searchable-dropdown-custom-input"
                                        value={customInput}
                                        onChange={(e) => setCustomInput(e.target.value)}
                                        onKeyDown={handleCustomKeyDown}
                                        placeholder="e.g. Introduction to Psychology"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        className="searchable-dropdown-custom-btn"
                                        onClick={handleCustomSubmit}
                                        disabled={!customInput.trim()}
                                    >
                                        Add
                                    </button>
                                    <button
                                        type="button"
                                        className="searchable-dropdown-custom-cancel"
                                        onClick={() => { setIsCustomMode(false); setCustomInput(''); }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {filtered.length === 0 && searchTerm ? (
                                    <div
                                        className="searchable-dropdown-item searchable-dropdown-other"
                                        onClick={handleOtherClick}
                                    >
                                        <span className="searchable-dropdown-check">✏️</span>
                                        Other — type "{searchTerm}" as custom course
                                    </div>
                                ) : (
                                    <>
                                        <div
                                            className="searchable-dropdown-item searchable-dropdown-other"
                                            onClick={handleOtherClick}
                                        >
                                            <span className="searchable-dropdown-check">✏️</span>
                                            Other (type a custom course name)
                                        </div>
                                        {filtered.map((option, idx) => (
                                            <div
                                                key={idx}
                                                className={`searchable-dropdown-item ${value.includes(option) ? 'selected' : ''}`}
                                                onClick={() => handleToggleSelect(option)}
                                                role="option"
                                                aria-selected={value.includes(option)}
                                            >
                                                <span className="searchable-dropdown-check">
                                                    {value.includes(option) ? '✓' : ''}
                                                </span>
                                                {option}
                                            </div>
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableDropdown;
