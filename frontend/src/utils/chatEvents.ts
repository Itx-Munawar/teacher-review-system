/** Fired by buttons outside the chat widget (bottom nav, home hero) to open it. */
export const OPEN_CHAT_EVENT = 'trs:open-chat';

export const openChat = () => {
    window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT));
};
