// CHATS LIST SCREEN — header (profile / theme / sign out), username search
// with suggestions, and the conversation list. Presentational: the summaries
// array is derived in ChatApp; search state lives there too (so the Escape
// handler can close results exactly like the original).

import { type KeyboardEvent, type MouseEvent } from "react";
import { ICON_ATTRS, ProfileIcon, SignOutIcon, ThemeToggleIcon, Tick } from "./icons";
import { fadeClass, type FadeState } from "@/lib/fade";
import type { Profile } from "@/lib/types";
import type { Theme } from "@/lib/theme";

export interface ChatListItem {
  partner: string;
  name: string;
  time: string;
  preview: string;
  mineLast: boolean;
  seenLast: boolean;
  unread: number;
  active: boolean;
}

interface ChatsScreenProps {
  fade: FadeState;
  items: ChatListItem[];
  theme: Theme;
  onToggleTheme: () => void;
  onSettings: () => void;
  onSignOut: () => void;
  onOpenChat: (partnerId: string) => void;
  searchTerm: string;
  onSearchTerm: (value: string) => void;
  searchResults: Profile[] | null;
  searchEmpty: string | null;
  searchFade: FadeState;
  onDismissSearch: () => void;
}

function openOnKey(e: KeyboardEvent, fn: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
}

export default function ChatsScreen({
  fade,
  items,
  theme,
  onToggleTheme,
  onSettings,
  onSignOut,
  onOpenChat,
  searchTerm,
  onSearchTerm,
  searchResults,
  searchEmpty,
  searchFade,
  onDismissSearch,
}: ChatsScreenProps) {
  const onScreenClick = (e: MouseEvent<HTMLDivElement>) => {
    // Dismiss search results when tapping elsewhere on the chats screen
    const target = e.target as Element | null;
    if (!target?.closest(".search-bar")) onDismissSearch();
  };

  const themeLabel = theme === "light" ? "Switch to dark theme" : "Switch to light theme";

  return (
    <div id="chats-screen" className={fadeClass("screen", fade)} onClick={onScreenClick}>
      <header className="chat-header">
        <div className="chat-header-info">
          <span className="chat-title">Chats</span>
        </div>
        <div className="header-actions">
          <button type="button" id="settings-button" className="icon-button" aria-label="Profile" data-tip="Profile" onClick={onSettings}>
            <svg {...ICON_ATTRS}>
              <ProfileIcon />
            </svg>
          </button>
          <button
            type="button"
            id="theme-toggle"
            className="icon-button"
            aria-label={themeLabel}
            data-tip={themeLabel}
            onClick={onToggleTheme}
          >
            <svg id="theme-icon" {...ICON_ATTRS}>
              <ThemeToggleIcon light={theme === "light"} />
            </svg>
          </button>
          <button type="button" id="sign-out" className="icon-button" aria-label="Sign out" data-tip="Sign out" onClick={onSignOut}>
            <svg {...ICON_ATTRS}>
              <SignOutIcon />
            </svg>
          </button>
        </div>
      </header>

      <div className="search-bar">
        <input
          id="user-search"
          type="search"
          placeholder="Search username…"
          autoComplete="off"
          aria-label="Search users by username"
          value={searchTerm}
          onChange={(e) => onSearchTerm(e.target.value)}
        />
        <div id="search-results" className={fadeClass("search-results", searchFade)}>
          {searchEmpty ? (
            <div className="search-empty">{searchEmpty}</div>
          ) : (
            searchResults?.map((p) => (
              <div
                key={p.id}
                className="search-result"
                role="button"
                tabIndex={0}
                onClick={() => onOpenChat(p.id)}
                onKeyDown={(e) => openOnKey(e, () => onOpenChat(p.id))}
              >
                <span className="search-result-name">{p.display_name}</span>
                <span className="search-result-username">{p.username}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <main id="chat-list" className="chat-list">
        {items.length === 0 ? (
          <div className="chat-list-empty">No chats yet — search for a username above to start one.</div>
        ) : (
          items.map((item) => (
            <div
              key={item.partner}
              className={"chat-item" + (item.active ? " active" : "")}
              data-partner={item.partner}
              role="button"
              tabIndex={0}
              onClick={() => onOpenChat(item.partner)}
              onKeyDown={(e) => openOnKey(e, () => onOpenChat(item.partner))}
            >
              <div className="chat-item-info">
                <div className="chat-item-top">
                  <span className="chat-item-name">{item.name}</span>
                  <span className="chat-item-right">
                    <span className="chat-item-time">{item.time}</span>
                  </span>
                </div>
                <div className="chat-item-bottom">
                  <span className="chat-item-preview">
                    {/* When the last message in a conversation is mine, show
                        its delivery tick ahead of the text — same vocabulary
                        as in the chat itself — so the preview is readable as
                        "I sent this" without any extra label. */}
                    {item.mineLast ? <Tick state={item.seenLast ? "seen" : "sent"} /> : null}
                    {item.preview}
                  </span>
                  {item.unread > 0 ? <span className="chat-item-badge">{item.unread}</span> : null}
                </div>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
