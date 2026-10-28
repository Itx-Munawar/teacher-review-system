import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import ChatCat from './ChatCat';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (el: React.ReactElement) => act(() => root.render(el));

describe('ChatCat', () => {
    it('perch variant has a tail and paws, face variant does not', () => {
        render(<ChatCat variant="perch" />);
        expect(container.querySelector('.chat-cat-tail')).not.toBeNull();
        expect(container.querySelector('.chat-cat-paws')).not.toBeNull();
        render(<ChatCat />);
        expect(container.querySelector('.chat-cat-tail')).toBeNull();
        expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    });

    it('swaps open eyes for smiling eyes when happy', () => {
        render(<ChatCat mood="thinking" />);
        expect(container.querySelector('svg')!.getAttribute('class')).toContain('chat-cat--thinking');
        expect(container.querySelector('.chat-cat-eyes')).not.toBeNull();
        render(<ChatCat mood="happy" />);
        expect(container.querySelector('.chat-cat-eyes')).toBeNull();
        expect(container.querySelector('.chat-cat-happy-eyes')).not.toBeNull();
    });
});
