"use client";

// SETTINGS MODAL — change display name. Presentational: the save call and
// error handling contract is onSave(name) → error string or null.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { fadeClass, type FadeState } from "@/lib/fade";
import { validateName } from "@/lib/utils";

interface SettingsOverlayProps {
  fade: FadeState;
  initialName: string;
  onSave: (name: string) => Promise<string | null>;
  onCancel: () => void;
}

export default function SettingsOverlay({ fade, initialName, onSave, onCancel }: SettingsOverlayProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // openSettings(): prefill the current name and focus the field.
  useEffect(() => {
    if (!fade.hidden) {
      setName(initialName);
      setError("");
      inputRef.current?.focus();
    }
  }, [fade.hidden, initialName]);

  const save = async () => {
    const nameError = validateName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const saveError = await onSave(name);
      if (saveError) setError(saveError);
      // On success the parent closes the overlay (fade-out).
    } finally {
      setBusy(false);
    }
  };

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    // Click on the dark backdrop (outside the card) closes the modal too.
    if (e.target === e.currentTarget) onCancel();
  };

  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div
      id="settings-overlay"
      className={fadeClass("settings-overlay", fade)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onBackdropClick}
    >
      <div className="settings-card">
        <h2 id="settings-title">Profile</h2>
        <label className="settings-label" htmlFor="settings-name">
          Your name
        </label>
        <p className="settings-hint">
          Shown above the messages you send. Your username (what you sign in with) stays the same.
        </p>
        <input
          id="settings-name"
          ref={inputRef}
          type="text"
          maxLength={20}
          autoComplete="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <p id="settings-error" className="auth-error">
          {error}
        </p>
        <div className="settings-actions">
          <button type="button" id="settings-cancel" className="link-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" id="settings-save" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
