// import React from 'react';
// import { Teacher } from '../types';

// interface Props {
//     teacher: Teacher;
//     onClick: () => void;
// }

// const TeacherCard: React.FC<Props> = ({ teacher, onClick }) => {
//     const renderStars = (rating: number) => {
//         const fullStars = Math.floor(rating);
//         const emptyStars = 5 - fullStars;
//         return '⭐'.repeat(fullStars) + '☆'.repeat(emptyStars);
//     };

//     // Fallback image if teacher.image_url is missing
//     const imageUrl = teacher.image_url || 'https://via.placeholder.com/80/667eea/ffffff?text=Teacher';

//     return (
//         <div className="teacher-card" onClick={onClick}>
//             <div className="teacher-card-image">
//                 <img src={imageUrl} alt={teacher.name} />
//             </div>
//             <div className="teacher-card-info">
//                 <h3>{teacher.name}</h3>
//                 <p className="department">{teacher.department}</p>
//                 <div className="rating">
//                     <span className="stars">{renderStars(teacher.avg_rating)}</span>
//                     <span className="reviews-count">({teacher.review_count} reviews)</span>
//                 </div>
//             </div>
//         </div>
//     );
// };

// export default TeacherCard;