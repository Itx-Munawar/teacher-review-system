import { isUsableImageUrl, thumbUrl, thumbSrcSet } from './imageThumb';

const UMT_PHOTO = 'https://admin.umt.edu.pk/Media/UserProfile/636753931581232459123.JPG';

describe('isUsableImageUrl', () => {
    it('accepts real UMT photo URLs', () => {
        expect(isUsableImageUrl(UMT_PHOTO)).toBe(true);
        expect(isUsableImageUrl('https://admin.umt.edu.pk/Media/UserProfile/1.jpg')).toBe(true);
        expect(isUsableImageUrl('https://admin.umt.edu.pk/Media/UserProfile/1.png')).toBe(true);
        expect(isUsableImageUrl('https://example.com/a/b.webp')).toBe(true);
    });

    it('rejects blank and non-http values', () => {
        expect(isUsableImageUrl(null)).toBe(false);
        expect(isUsableImageUrl(undefined)).toBe(false);
        expect(isUsableImageUrl('')).toBe(false);
        expect(isUsableImageUrl('   ')).toBe(false);
        expect(isUsableImageUrl('/local/photo.jpg')).toBe(false);
        expect(isUsableImageUrl('not a url')).toBe(false);
    });

    it('rejects truncated directory URLs with no filename (real data has these)', () => {
        expect(isUsableImageUrl('https://admin.umt.edu.pk/Media/UserProfile/')).toBe(false);
        expect(isUsableImageUrl('https://admin.umt.edu.pk/Media/UserProfile')).toBe(false);
    });
});

describe('thumbUrl', () => {
    it('routes UMT photos through the resize proxy as a small WebP', () => {
        const result = thumbUrl(UMT_PHOTO, 160);
        expect(result.startsWith('https://wsrv.nl/?')).toBe(true);

        const params = new URLSearchParams(result.split('?')[1]);
        expect(params.get('url')).toBe(UMT_PHOTO);
        expect(params.get('w')).toBe('160');
        expect(params.get('h')).toBe('160');
        expect(params.get('fit')).toBe('cover');
        expect(params.get('output')).toBe('webp');
    });

    it('leaves hosts we do not own untouched, so this is not an open proxy', () => {
        const other = 'https://some-other-site.com/photo.jpg';
        expect(thumbUrl(other, 160)).toBe(other);
    });

    it('leaves unusable values untouched instead of building a broken proxy URL', () => {
        expect(thumbUrl('https://admin.umt.edu.pk/Media/UserProfile/', 160))
            .toBe('https://admin.umt.edu.pk/Media/UserProfile/');
        expect(thumbUrl('', 160)).toBe('');
    });
});

describe('thumbSrcSet', () => {
    it('provides 1x and 2x variants for high-DPI screens', () => {
        const srcSet = thumbSrcSet(UMT_PHOTO, 160);
        expect(srcSet).toBeDefined();
        expect(srcSet).toContain('w=160');
        expect(srcSet).toContain('w=320');
        expect(srcSet).toContain('1x');
        expect(srcSet).toContain('2x');
    });

    it('returns undefined when the URL is not proxied', () => {
        expect(thumbSrcSet('https://some-other-site.com/photo.jpg', 160)).toBeUndefined();
    });
});
