"use client";

// AUTH SCREEN — sign in / sign up form (presentational; Supabase calls and
// validation-error state live in ChatApp, exactly like the original script).

import { useEffect, useRef, useState, type FormEvent } from "react";
import { EyeIcon, ICON_ATTRS } from "./icons";
import { fadeClass, type FadeState } from "@/lib/fade";
import { validateName, validatePassword, validateUsername } from "@/lib/utils";

export type AuthMode = "signin" | "signup";

interface AuthScreenProps {
  fade: FadeState;
  mode: AuthMode;
  prefillUsername: string | null;
  message: { text: string; ok: boolean } | null;
  busy: boolean;
  onToggle: () => void;
  onMessage: (text: string, ok: boolean) => void;
  onSubmit: (data: { name: string; username: string; password: string }) => Promise<void>;
}

export default function AuthScreen({
  fade,
  mode,
  prefillUsername,
  message,
  busy,
  onToggle,
  onMessage,
  onSubmit,
}: AuthScreenProps) {
  const [fullName, setFullName] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isSignUp = mode === "signup";

  // Switching auth modes always starts with a completely fresh form. Used
  // right after a successful sign-up (prefillUsername set): lands the person
  // on the login form with the username they just chose already filled in,
  // instead of the toggle's usual wipe-everything reset.
  useEffect(() => {
    setFullName("");
    setName(prefillUsername ?? "");
    setPassword("");
    setShowPassword(false);
  }, [mode, prefillUsername]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (isSignUp) {
      const nameError = validateName(fullName);
      if (nameError) return onMessage(nameError, false);
      const usernameError = validateUsername(name.trim());
      if (usernameError) return onMessage(usernameError, false);
      const passwordError = validatePassword(password);
      if (passwordError) return onMessage(passwordError, false);
    }
    await onSubmit({ name: fullName, username: name.trim(), password });
  };

  return (
    <div id="auth-screen" className={fadeClass("screen", fade)}>
      <div className="auth-card">
        <h1 className="auth-title">Chat</h1>
        <p className="auth-sub">One app. Everyone's in it.</p>

        <form id="auth-form" onSubmit={handleSubmit}>
          <input
            id="auth-fullname"
            className={isSignUp ? "" : "hidden"}
            type="text"
            placeholder="Name"
            autoComplete="name"
            maxLength={20}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required={isSignUp}
          />
          <input
            id="auth-name"
            ref={nameRef}
            type="text"
            placeholder="Username"
            autoComplete="username"
            minLength={5}
            maxLength={10}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="password-field">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              autoComplete="current-password"
              minLength={8}
              maxLength={20}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              id="password-toggle"
              className="password-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={!showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              <svg
                id="password-toggle-icon"
                viewBox="0 0 24 24"
                width={20}
                height={20}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <EyeIcon open={!showPassword} />
              </svg>
            </button>
          </div>
          <button type="submit" id="auth-submit" disabled={busy}>
            {isSignUp ? "Sign up" : "Sign in"}
          </button>
        </form>

        <button id="auth-toggle" className="link-button" onClick={onToggle}>
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
        <p
          id="auth-error"
          className="auth-error"
          style={message?.ok ? { color: "#3A8B5C" } : message ? { color: "#C4574B" } : undefined}
        >
          {message?.text ?? ""}
        </p>
      </div>
    </div>
  );
}
