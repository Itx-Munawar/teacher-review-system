import { isUsableImageUrl, thumbUrl, thumbSrcSet, originalViaSite } from './imageThumb';

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
    it('routes UMT profile photos through our own domain (works where wsrv.nl is blocked)', () => {
        expect(thumbUrl(UMT_PHOTO, 160)).toBe('/img/t/160/636753931581232459123.JPG');
        expect(thumbUrl('http://admin.umt.edu.pk/Media/UserProfile/1.png', 48)).toBe('/img/t/48/1.png');
    });

    it('keeps the width inside what the rewrite accepts', () => {
        expect(thumbUrl(UMT_PHOTO, 4)).toBe('/img/t/10/636753931581232459123.JPG');
        expect(thumbUrl(UMT_PHOTO, 2000)).toBe('/img/t/999/636753931581232459123.JPG');
    });

    it('uses wsrv.nl directly for other UMT addresses', () => {
        const other = 'https://www.umt.edu.pk/images/staff/a.jpg';
        const result = thumbUrl(other, 160);
        expect(result.startsWith('https://wsrv.nl/?')).toBe(true);
        const params = new URLSearchParams(result.split('?')[1]);
        expect(params.get('url')).toBe(other);
        expect(params.get('w')).toBe('160');
        expect(params.get('output')).toBe('webp');
    });

    it('does not let odd filenames into the site path', () => {
        const odd = 'https://admin.umt.edu.pk/Media/UserProfile/a%2F..%2Fb.jpg';
        expect(thumbUrl(odd, 80).startsWith('/img/')).toBe(false);
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

describe('originalViaSite', () => {
    it('serves the full UMT photo through our own domain', () => {
        expect(originalViaSite(UMT_PHOTO)).toBe('/img/o/636753931581232459123.JPG');
    });

    it('leaves anything else untouched', () => {
        expect(originalViaSite('https://some-other-site.com/photo.jpg')).toBe('https://some-other-site.com/photo.jpg');
        expect(originalViaSite('https://admin.umt.edu.pk/Media/UserProfile/')).toBe('https://admin.umt.edu.pk/Media/UserProfile/');
    });
});

describe('thumbSrcSet', () => {
    it('provides 1x and 2x variants for high-DPI screens', () => {
        const srcSet = thumbSrcSet(UMT_PHOTO, 160);
        expect(srcSet).toBeDefined();
        expect(srcSet).toBe('/img/t/160/636753931581232459123.JPG 1x, /img/t/320/636753931581232459123.JPG 2x');
        expect(srcSet).toContain('1x');
        expect(srcSet).toContain('2x');
    });

    it('returns undefined when the URL is not proxied', () => {
        expect(thumbSrcSet('https://some-other-site.com/photo.jpg', 160)).toBeUndefined();
    });
});
