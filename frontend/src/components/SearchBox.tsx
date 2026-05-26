// import React, { useState, useEffect, useRef } from 'react';
// import { searchTeachers } from '../services/api';
// import { Teacher } from '../types';

// interface Props {
//     onSelect: (teacher: Teacher) => void;
// }

// const SearchBox: React.FC<Props> = ({ onSelect }) => {
//     const [query, setQuery] = useState('');
//     const [suggestions, setSuggestions] = useState<Teacher[]>([]);
//     const [showSuggestions, setShowSuggestions] = useState(false);
//     const wrapperRef = useRef<HTMLDivElement>(null);

//     useEffect(() => {
//         const handleClickOutside = (event: MouseEvent) => {
//             if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
//                 setShowSuggestions(false);
//             }
//         };
//         document.addEventListener('mousedown', handleClickOutside);
//         return () => document.removeEventListener('mousedown', handleClickOutside);
//     }, []);

//     useEffect(() => {
//         const fetchSuggestions = async () => {
//             if (query.length >= 2) {
//                 try {
//                     const response = await searchTeachers(query);
//                     setSuggestions(response.data);
//                     setShowSuggestions(true);
//                 } catch (error) {
//                     console.error('Search error:', error);
//                 }
//             } else {
//                 setSuggestions([]);
//                 setShowSuggestions(false);
//             }
//         };
        
//         const timeoutId = setTimeout(fetchSuggestions, 300);
//         return () => clearTimeout(timeoutId);
//     }, [query]);

//     return (
//         <div ref={wrapperRef} className="search-box">
//             <input
//                 type="text"
//                 value={query}
//                 onChange={(e) => setQuery(e.target.value)}
//                 onFocus={() => query.length >= 2 && setShowSuggestions(true)}
//                 placeholder="Search for a teacher..."
//                 className="search-input"
//             />
//             {showSuggestions && suggestions.length > 0 && (
//                 <ul className="suggestions">
//                     {suggestions.map(teacher => (
//                         <li
//                             key={teacher.id}
//                             onClick={() => {
//                                 onSelect(teacher);
//                                 setQuery(teacher.name);
//                                 setShowSuggestions(false);
//                             }}
//                         >
//                             <strong>{teacher.name}</strong>
//                             <span>{teacher.department}</span>
//                         </li>
//                     ))}
//                 </ul>
//             )}
//         </div>
//     );
// };

// export default SearchBox;