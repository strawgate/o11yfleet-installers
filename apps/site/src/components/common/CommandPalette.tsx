import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";

export interface CommandItem {
  id: string;
  label: string;
  href: string;
  section?: string;
  disabled?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder: string;
}

export function CommandPalette({ open, onClose, items, placeholder }: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.section ?? ""} ${item.label}`.toLowerCase().includes(normalized),
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(firstEnabledIndex(visibleItems));
  }, [visibleItems]);

  function activate(item: CommandItem) {
    if (item.disabled) return;
    navigate(item.href);
    onClose();
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => nextEnabledIndex(visibleItems, index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => nextEnabledIndex(visibleItems, index, -1));
    } else if (event.key === "Enter") {
      const item = visibleItems[selectedIndex];
      if (item && !item.disabled) {
        event.preventDefault();
        activate(item);
      }
    }
  }

  if (!open) return null;

  return (
    <div className="cmd-overlay" role="presentation" onClick={onClose}>
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onListKeyDown}
      >
        <div className="cmd-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5l3 3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmd-list">
          {visibleItems.length === 0 ? (
            <div className="cmd-empty">No commands found.</div>
          ) : (
            visibleItems.map((item, index) => (
              <button
                key={item.id}
                className={`cmd-item${index === selectedIndex ? " selected" : ""}`}
                disabled={item.disabled}
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => activate(item)}
              >
                <span>
                  <strong>{item.label}</strong>
                  {item.section ? <small>{item.section}</small> : null}
                </span>
                {item.disabled ? <em>Soon</em> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function firstEnabledIndex(items: CommandItem[]): number {
  const index = items.findIndex((item) => !item.disabled);
  return index >= 0 ? index : 0;
}

function nextEnabledIndex(items: CommandItem[], currentIndex: number, direction: 1 | -1): number {
  if (items.length === 0) return 0;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (currentIndex + offset * direction + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return currentIndex;
}
