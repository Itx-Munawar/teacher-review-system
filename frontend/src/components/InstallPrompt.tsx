import React, { useEffect, useState } from 'react';
import Icon from './Icon';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const InstallPrompt: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        // iOS Safari doesn't fire beforeinstallprompt; show a manual hint instead.
        const ua = navigator.userAgent;
        const ios = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
        setIsIOS(ios);

        // This component is only mounted after a review is submitted, so it is
        // safe to offer installation now. If the browser already fired its
        // install event before mount, show the manual path instead of nothing.
        const standalone = window.matchMedia('(display-mode: standalone)').matches;
        if (!standalone) setVisible(true);

        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setVisible(true);
        };

        const handleAppInstalled = () => {
            setVisible(false);
            setDeferredPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    // Auto-dismiss after 15 seconds if not interacted with
    useEffect(() => {
        if (!visible) return;
        const timer = setTimeout(() => setVisible(false), 15000);
        return () => clearTimeout(timer);
    }, [visible]);

    if (!visible) return null;

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
            setVisible(false);
            setDeferredPrompt(null);
        } else {
            // Keep showing so the user can retry
            setDeferredPrompt(null);
            setVisible(false);
        }
    };

    const dismiss = () => setVisible(false);

    return (
        <div className="install-prompt" role="region" aria-label="Add to home screen">
            <div className="install-prompt-content">
                {isIOS ? (
                    <p className="install-prompt-text">
                        <Icon name="download" size={18} />
                        <span>Add <strong>UMT Teacher Reviews</strong> to your home screen: tap the Share button, then
                        "Add to Home Screen".</span>
                    </p>
                ) : deferredPrompt ? (
                    <p className="install-prompt-text">
                        <Icon name="download" size={18} />
                        <span>Add <strong>UMT Teacher Reviews</strong> to your home screen. It opens like an app, with no download.</span>
                    </p>
                ) : (
                    <p className="install-prompt-text">
                        <Icon name="download" size={18} />
                        <span>Add <strong>UMT Teacher Reviews</strong> to your home screen from your browser menu — “Add to Home screen”.</span>
                    </p>
                )}
                {!isIOS && deferredPrompt && (
                    <button onClick={handleInstall} className="install-prompt-btn">
                        Add to home screen
                    </button>
                )}
                <button onClick={dismiss} className="install-prompt-close" aria-label="Not now">
                    Not now
                </button>
            </div>
        </div>
    );
};

export default InstallPrompt;
