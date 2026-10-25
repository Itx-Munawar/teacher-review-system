import React from 'react';
import type { Teacher } from '../types';

interface CompareBarProps {
    compareList: Teacher[];
    compareLoading: boolean;
    toggleCompare: (teacher: Teacher) => void;
    clearCompare: () => void;
    runCompare: () => void;
}

/** Floating bar listing the teachers picked for comparison. */
const CompareBar: React.FC<CompareBarProps> = ({ compareList, compareLoading, toggleCompare, clearCompare, runCompare }) => (
    <div className="compare-bar">
        <div className="compare-bar-info">
            <span className="compare-bar-count">{compareList.length}/3 selected</span>
            <div className="compare-bar-names">
                {compareList.map((t) => (
                    <span key={t.id} className="compare-bar-name" onClick={() => toggleCompare(t)} title="Remove">
                        {t.name} ✕
                    </span>
                ))}
            </div>
        </div>
        <div className="compare-bar-actions">
            <button onClick={clearCompare} className="compare-clear-btn">Clear</button>
            <button onClick={runCompare} disabled={compareList.length < 2 || compareLoading} className="compare-go-btn">
                {compareLoading ? <><span className="spinner-small"></span> Loading...</> : 'Compare'}
            </button>
        </div>
    </div>
);

export default CompareBar;
