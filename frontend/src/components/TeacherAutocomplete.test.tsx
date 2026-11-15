import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import TeacherAutocomplete from './TeacherAutocomplete';
import type { Teacher } from '../types';

vi.mock('../services/api', () => ({
    searchAllTeachers: vi.fn(),
}));

import { searchAllTeachers } from '../services/api';

const mockedSearch = vi.mocked(searchAllTeachers);

const ALI_HARRIS: Teacher = {
    id: 53,
    name: 'Ali Harris',
    department: 'School of Systems and Technology',
    review_count: 2,
};

function setup(onSelect = vi.fn(), onQueryChange = vi.fn()) {
    render(
        <TeacherAutocomplete
            value=""
            onQueryChange={onQueryChange}
            onSelect={onSelect}
        />
    );
    return { onSelect, onQueryChange };
}

describe('TeacherAutocomplete — mouse selection (regression)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedSearch.mockResolvedValue({ data: [ALI_HARRIS] } as never);
    });

    it('opens the teacher when a suggestion is clicked with the mouse', async () => {
        const { onSelect } = setup();
        const input = screen.getByLabelText('Search by teacher or department');

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Ali' } });

        const option = await waitFor(() => screen.getByRole('option', { name: /Ali Harris/ }));
        expect(option).toBeInTheDocument();

        // A real mouse click: mousedown on the suggestion (the component
        // listens for onMouseDown, not onClick).
        fireEvent.mouseDown(option);

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(ALI_HARRIS);
    });

    it('opens the teacher when a suggestion is picked with the keyboard', async () => {
        const { onSelect } = setup();
        const input = screen.getByLabelText('Search by teacher or department');

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Ali' } });

        await waitFor(() => screen.getByRole('option', { name: /Ali Harris/ }));

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(ALI_HARRIS);
    });
});
