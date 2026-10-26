import React from 'react';
import TiltCard from './TiltCard';
import TeacherAutocomplete from './TeacherAutocomplete';
import Avatar from './Avatar';
import { TeacherCardSkeleton } from './Skeleton';
import type { Teacher } from '../types';

interface TeacherSidebarProps {
    /** Detail/compare/Q&A is open on a phone, where the list is its own page. */
    hiddenOnMobile: boolean;
    searchTerm: string;
    handleSearch: (value: string) => void;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    handleAutocompleteSelect: (teacher: Teacher) => void;
    handleCompareToggle: (teacher: Teacher) => void;
    compareList: Teacher[];
    isSearching: boolean;
    searchResults: Teacher[];
    sortBy: string;
    setSortBy: (value: string) => void;
    departmentFilter: string;
    setDepartmentFilter: (value: string) => void;
    departments: { department: string; teacher_count: number }[];
    loading: boolean;
    error: string | null;
    loadTeachers: (page?: number) => unknown;
    displayTeachers: Teacher[];
    handleTeacherClick: (teacher: Teacher) => void;
    loadingMore: boolean;
    hasMore: boolean;
    loadMore: () => void;
    teachers: Teacher[];
    totalTeachersCount: number;
}

/** Left column: teacher search, sort/department filters and the paginated teacher list. */
const TeacherSidebar: React.FC<TeacherSidebarProps> = ({
    hiddenOnMobile,
    searchTerm,
    handleSearch,
    searchInputRef,
    handleAutocompleteSelect,
    handleCompareToggle,
    compareList,
    isSearching,
    searchResults,
    sortBy,
    setSortBy,
    departmentFilter,
    setDepartmentFilter,
    departments,
    loading,
    error,
    loadTeachers,
    displayTeachers,
    handleTeacherClick,
    loadingMore,
    hasMore,
    loadMore,
    teachers,
    totalTeachersCount,
}) => (
    <div className={`sidebar${hiddenOnMobile ? ' sidebar-hidden-mobile' : ''}`}>
        <div className="search-box">
            <TeacherAutocomplete
                value={searchTerm}
                onQueryChange={handleSearch}
                inputRef={searchInputRef}
                onSelect={handleAutocompleteSelect}
                onCompare={handleCompareToggle}
                isInCompare={(teacher) => compareList.some(t => t.id === teacher.id)}
            />
            {isSearching && searchTerm && (
                <div className="search-info">
                    Found {searchResults.length} teacher{searchResults.length !== 1 ? 's' : ''} matching "{searchTerm}"
                </div>
            )}
        </div>

        {!isSearching && (
            <div className="filter-bar">
                <select
                    className="filter-select"
                    aria-label="Sort teachers"
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value); }}
                >
                    <option value="reviews">Sort: Most Reviews</option>
                    <option value="name">Sort: Name</option>
                </select>
                <select
                    className="filter-select"
                    aria-label="Filter by department"
                    value={departmentFilter}
                    onChange={(e) => { setDepartmentFilter(e.target.value); }}
                >
                    <option value="">All Departments</option>
                    {departments.map((d) => (
                        <option key={d.department} value={d.department}>
                            {d.department} ({d.teacher_count})
                        </option>
                    ))}
                </select>
            </div>
        )}

        <div className="teacher-list">
            {loading ? (
                <>
                    {[...Array(5)].map((_, i) => (
                        <TeacherCardSkeleton key={i} />
                    ))}
                </>
            ) : error ? (
                <div className="error-message">
                    {error} <button onClick={() => loadTeachers(1)} className="retry-btn">Retry</button>
                </div>
            ) : displayTeachers.length === 0 ? (
                <div className="no-results">No teachers match your search. Try a shorter name or a department.</div>
            ) : (
                <>
                    {displayTeachers.map((teacher: Teacher, index: number) => (
                        <div
                            key={teacher.id}
                            className="teacher-card-enter"
                            style={{ animationDelay: `${Math.min(index * 0.06, 0.6)}s` }}
                        >
                            <TiltCard
                                className="teacher-card"
                                maxTilt={6}
                                onClick={() => handleTeacherClick(teacher)}
                            >
                                <Avatar name={teacher.name} imageUrl={teacher.image_url} className="teacher-card-image" priority={index < 6} />
                                <div className="teacher-card-info">
                                    <h3 title={teacher.name}>{teacher.name}</h3>
                                    <p className="department" title={teacher.department}>{teacher.department}</p>
                                    <span className="reviews-count">
                                        ({teacher.review_count} {teacher.review_count === 1 ? 'review' : 'reviews'})
                                    </span>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleCompareToggle(teacher);
                                    }}
                                    className={`compare-toggle-btn ${compareList.some(t => t.id === teacher.id) ? 'compare-toggle-btn-active' : ''}`}
                                    aria-label={`Compare ${teacher.name}`}
                                    title="Add to comparison"
                                >
                                    <span className="compare-check">{compareList.some(t => t.id === teacher.id) ? '✓' : '+'}</span>
                                </button>
                            </TiltCard>
                        </div>
                    ))}
                    {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                    {!isSearching && hasMore && !loadingMore && (
                        <div className="load-more-container">
                            <button onClick={loadMore} className="load-more-btn">
                                Show more teachers ({teachers.length} / {totalTeachersCount})
                            </button>
                        </div>
                    )}
                    {!isSearching && !hasMore && teachers.length > 0 && (
                <div className="end-of-list">You've seen all {totalTeachersCount} teachers</div>
                    )}
                </>
            )}
        </div>
    </div>
);

export default TeacherSidebar;
