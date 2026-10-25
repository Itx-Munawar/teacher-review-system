import { extractCourses } from './courses';

const review = (courses: unknown) => ({ courses } as any);

describe('extractCourses', () => {
    test('parses a JSON array and trims entries', () => {
        expect(extractCourses(review('["Math", " Physics "]'))).toEqual(['Math', 'Physics']);
    });

    test('wraps a single JSON string', () => {
        expect(extractCourses(review('"Calculus I"'))).toEqual(['Calculus I']);
    });

    test('treats legacy plain text as one course', () => {
        expect(extractCourses(review('Legacy Course'))).toEqual(['Legacy Course']);
    });

    test('returns [] for empty values', () => {
        expect(extractCourses(review(null))).toEqual([]);
        expect(extractCourses(review(''))).toEqual([]);
        expect(extractCourses(review('null'))).toEqual([]);
        expect(extractCourses(review('[]'))).toEqual([]);
    });

    test('decodes a Buffer-shaped object without the Node Buffer global', () => {
        const text = '["Data Structures"]';
        const bytes = Array.from(text, (char) => char.charCodeAt(0));
        expect(extractCourses(review({ type: 'Buffer', data: bytes }))).toEqual(['Data Structures']);
    });

    test('ignores nested objects instead of rendering [object Object]', () => {
        expect(extractCourses(review('["Math", {"bad": true}]'))).toEqual(['Math']);
    });

    test('falls back to the course alias', () => {
        expect(extractCourses({ course: 'Operating Systems' } as any)).toEqual(['Operating Systems']);
    });
});
