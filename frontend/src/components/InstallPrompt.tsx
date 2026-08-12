import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const InstallPrompt: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        // iOS Safari doesn't fire beforeinstallprompt; show a manual hint instead
        const ua = navigator.userAgent;
        setIsIOS(/iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream);

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
        <div className="install-prompt" role="dialog" aria-label="Install app">
            <div className="install-prompt-content">
                {isIOS ? (
                    <p className="install-prompt-text">
                        📲 Install <strong>UMT Teacher Reviews</strong> on your home screen: tap the Share button, then
                        "Add to Home Screen".
                    </p>
                ) : (
                    <p className="install-prompt-text">
                        📲 Install <strong>UMT Teacher Reviews</strong> for quick access and offline use.
                    </p>
                )}
                {!isIOS && (
                    <button onClick={handleInstall} className="install-prompt-btn">
                        Install
                    </button>
                )}
                <button onClick={dismiss} className="install-prompt-close" aria-label="Dismiss install prompt">
                    ✕
                </button>
            </div>
        </div>
    );
};

export default InstallPrompt;
