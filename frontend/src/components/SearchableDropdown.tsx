import React, { useState, useRef, useEffect, useMemo } from 'react';

interface SearchableDropdownProps {
    label: string;
    value: string[];
    onChange: (value: string[]) => void;
    options: string[];
    placeholder?: string;
    required?: boolean;
    id?: string;
    /** 'page' renders a full-height picker: no label/display bar, list always open */
    variant?: 'inline' | 'page';
    /** When provided, tapping the field on mobile opens the full-screen course page */
    onPageRequest?: () => void;
    /** Page variant: called when the user taps Done */
    onDone?: () => void;
}

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
    label,
    value,
    onChange,
    options,
    placeholder = 'Search or scroll to select...',
    required = false,
    id,
    variant = 'inline',
    onPageRequest,
    onDone,
}) => {
    const isPage = variant === 'page';
    const [isOpen, setIsOpen] = useState(isPage);
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

    // Full-page picker: bring already-selected courses into view when it opens
    useEffect(() => {
        if (!isPage) return;
        const t = setTimeout(() => {
            listRef.current?.querySelector('.selected')?.scrollIntoView({ block: 'center' });
        }, 80);
        return () => clearTimeout(t);
    }, [isPage]);

    // Close on outside click (inline mode only — the page picker owns the screen)
    useEffect(() => {
        if (isPage) return;
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
    }, [isPage]);

    // Close on Escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isPage) {
                    // Page picker stays open; just exit custom-entry mode
                    setIsCustomMode(false);
                    setCustomInput('');
                    return;
                }
                setIsOpen(false);
                setSearchTerm('');
                setIsCustomMode(false);
                setCustomInput('');
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isPage]);

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
        // Mobile: open the dedicated full-screen course page instead of the inline panel
        if (onPageRequest && window.matchMedia('(max-width: 768px)').matches) {
            onPageRequest();
            return;
        }
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

    // Close the list and move focus to the review textarea (keyboard opens there)
    const handleDone = () => {
        if (isPage) {
            onDone?.();
            return;
        }
        setIsOpen(false);
        setSearchTerm('');
        setIsCustomMode(false);
        setCustomInput('');
        setTimeout(() => {
            document.getElementById('review-comment')?.focus();
        }, 0);
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

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && searchTerm.trim() && filtered.length === 0) {
            e.preventDefault();
            handleQuickAdd(searchTerm);
        }
    };

    // Quick-add: when no results match, add the search term directly as a custom course
    const handleQuickAdd = (term: string) => {
        const trimmed = term.trim();
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
        }
        setSearchTerm('');
        setIsCustomMode(false);
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

    // ---- Shared pieces -----------------------------------------------------

    const chipsNode = value.length > 0 && (
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
    );

    const searchRow = (
        <div className="searchable-dropdown-search">
            <div className="searchable-dropdown-search-row">
                <input
                    ref={inputRef}
                    id={id}
                    type="text"
                    className="searchable-dropdown-input"
                    value={searchTerm}
                    onChange={handleInputChange}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Type to filter..."
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                />
                <button
                    type="button"
                    className="searchable-dropdown-done-btn"
                    onClick={handleDone}
                    aria-label="Done selecting courses"
                >
                    Done
                </button>
            </div>
        </div>
    );

    const listNode = (
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
                            onClick={() => handleQuickAdd(searchTerm)}
                        >
                            <span className="searchable-dropdown-check">➕</span>
                            Add "{searchTerm}" as custom course
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
    );

    // ---- Render ------------------------------------------------------------

    // Full-screen picker: no label or display bar — search + Done + list only
    if (isPage) {
        return (
            <div className="searchable-dropdown searchable-dropdown-page">
                {chipsNode}
                {searchRow}
                {listNode}
            </div>
        );
    }

    return (
        <div className="searchable-dropdown" ref={containerRef}>
            <label htmlFor={id}>{label}{required && ' *'}</label>
            {chipsNode}
            <div className="searchable-dropdown-display" onClick={handleToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); } }} aria-haspopup="listbox" aria-expanded={isOpen}>
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
            {isOpen && (
                <div className="searchable-dropdown-panel">
                    {searchRow}
                    {listNode}
                </div>
            )}
        </div>
    );
};

export default SearchableDropdown;
