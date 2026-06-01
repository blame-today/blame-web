// Per-browser visitor identifier — 32 random bytes generated on first
// visit and persisted in localStorage. Same shape as a nostr pubkey
// (hex, 64 chars), but it's NOT a real keypair yet — we don't have a
// matching private key. That's a future upgrade: when we wire the
// marketing site into the public ledger (e.g. so visitors can sign a
// "I read this page" event), we'll generate a proper schnorr keypair
// in the same slot and the visible identifier upgrades in place.
//
// For now it's an honest "you have an identity at blame.today the
// moment you load a page" signal. Click the rendered key to copy the
// full hex to clipboard.
(function () {
    const STORAGE_KEY = "blame.visitor.id";

    function ensureKey() {
        let hex;
        try {
            hex = localStorage.getItem(STORAGE_KEY);
        } catch {
            // Private mode or localStorage disabled — fall through to
            // an in-memory key that won't persist across page loads.
            hex = null;
        }
        if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
            const bytes = new Uint8Array(32);
            crypto.getRandomValues(bytes);
            hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
            try { localStorage.setItem(STORAGE_KEY, hex); } catch { /* private mode */ }
        }
        return hex;
    }

    function shortForm(hex) {
        return hex.slice(0, 8) + "…" + hex.slice(-8);
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    function wireUp() {
        const el = document.getElementById("visitor-key");
        if (!el) return;
        const hex = ensureKey();
        el.textContent = shortForm(hex);
        el.setAttribute("data-full", hex);
        el.setAttribute("title", "32-byte identifier stored in your browser. nostr-pubkey-shaped. click to copy.");
        el.addEventListener("click", async () => {
            const ok = await copyToClipboard(hex);
            const original = el.textContent;
            el.textContent = ok ? "copied!" : "couldn't copy";
            el.classList.add("copied");
            setTimeout(() => {
                el.textContent = original;
                el.classList.remove("copied");
            }, 1200);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", wireUp);
    } else {
        wireUp();
    }
})();
