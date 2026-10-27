import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { t } from "./i18n";
export type MenuAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
};
type MenuState = {
  id: string;
  name: string;
  items: MenuAction[];
  x: number;
  y: number;
  trigger: HTMLElement;
};
const Context = createContext<{
  current: string | null;
  open: (menu: MenuState) => void;
  close: (restore?: boolean) => void;
}>({ current: null, open: () => {}, close: () => {} });
export function ItemMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null),
    [point, setPoint] = useState({ x: 0, y: 0 });
  const panel = useRef<HTMLDivElement>(null);
  function close(restore = false) {
    setMenu(null);
    if (restore && menu?.trigger.isConnected)
      menu.trigger.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const bounds = panel.current.getBoundingClientRect();
    setPoint({
      x: Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8)),
    });
    panel.current
      .querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        event.target
          .closest("[data-menu-trigger]")
          ?.getAttribute("data-menu-trigger") === menu.id
      )
        return;
      close();
    };
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close();
    };
    const dismiss = () => close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    // Focusing a row or revealing selection controls can scroll the table while
    // opening. Dismiss for user scrolling, rather than those layout adjustments.
    window.addEventListener("wheel", scroll, { capture: true, passive: true });
    window.addEventListener("touchmove", scroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("wheel", scroll, true);
      window.removeEventListener("touchmove", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);
  return (
    <Context.Provider
      value={{
        current: menu?.id || null,
        open: (value) => {
          setPoint({ x: value.x, y: value.y });
          setMenu(value);
        },
        close,
      }}
    >
      {children}
      {menu &&
        createPortal(
          <div
            ref={panel}
            className="item-context-menu"
            role="menu"
            aria-label={t("Actions for {0}", { 0: menu.name })}
            style={{ left: point.x, top: point.y }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (["Escape", "Tab"].includes(event.key)) {
                event.preventDefault();
                close(true);
                return;
              }
              const items = Array.from(
                panel.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"]:not(:disabled)',
                ) || [],
              );
              const index = items.indexOf(
                document.activeElement as HTMLElement,
              );
              const next =
                event.key === "ArrowDown"
                  ? (index + 1) % items.length
                  : event.key === "ArrowUp"
                    ? (index - 1 + items.length) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                items[next]?.focus();
              }
            }}
          >
            <div className="item-menu-heading" title={menu.name}>
              {menu.name}
            </div>
            {menu.items.map((item) => (
              <React.Fragment key={item.id}>
                {item.divider && (
                  <div role="separator" className="item-menu-divider" />
                )}
                {item.href && !item.disabled ? (
                  <a
                    role="menuitem"
                    className={item.danger ? "danger" : ""}
                    href={item.href}
                    onClick={() => close(true)}
                  >
                    <item.icon size={17} aria-hidden="true" />
                    {item.label}
                  </a>
                ) : (
                  <button
                    role="menuitem"
                    className={item.danger ? "danger" : ""}
                    disabled={item.disabled}
                    onClick={() => {
                      close(true);
                      item.onSelect?.();
                    }}
                  >
                    <item.icon size={17} aria-hidden="true" />
                    {item.label}
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}
function nativeTarget(target: EventTarget) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable="true"],.modal-backdrop,[role="dialog"],[role="menu"]',
    )
  );
}
export function ItemMenu({
  name,
  items,
  onOpen,
  children,
}: {
  name: string;
  items: MenuAction[];
  onOpen?: () => void;
  children: (value: {
    bind: React.HTMLAttributes<HTMLElement>;
    trigger: React.ReactNode;
  }) => React.ReactNode;
}) {
  const context = useContext(Context),
    id = useId();
  const held = useRef(false),
    touch = useRef<{
      x: number;
      y: number;
      timer: ReturnType<typeof setTimeout>;
    } | null>(null);
  const cancelTouch = () => {
    if (touch.current) clearTimeout(touch.current.timer);
    touch.current = null;
  };
  useEffect(() => cancelTouch, []);
  function open(x: number, y: number, trigger: HTMLElement) {
    onOpen?.();
    context.open({ id, name, items, x, y, trigger });
  }
  return (
    <>
      {children({
        bind: {
          tabIndex: 0,
          onContextMenu: (event) => {
            if (event.shiftKey || nativeTarget(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            cancelTouch();
            if (held.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            open(
              event.clientX || rect.left + 20,
              event.clientY || rect.top + 20,
              event.currentTarget,
            );
          },
          onKeyDown: (event) => {
            if (
              (event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")) &&
              !nativeTarget(event.target)
            ) {
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              open(rect.left + 20, rect.top + 20, event.currentTarget);
            }
          },
          onPointerDown: (event) => {
            held.current = false;
            cancelTouch();
            if (event.pointerType !== "touch" || nativeTarget(event.target))
              return;
            const trigger = event.currentTarget,
              x = event.clientX,
              y = event.clientY;
            touch.current = {
              x,
              y,
              timer: setTimeout(() => {
                held.current = true;
                open(x, y, trigger);
              }, 550),
            };
          },
          onPointerMove: (event) => {
            if (
              touch.current &&
              Math.hypot(
                touch.current.x - event.clientX,
                touch.current.y - event.clientY,
              ) > 10
            )
              cancelTouch();
          },
          onPointerUp: cancelTouch,
          onPointerCancel: cancelTouch,
          onClickCapture: (event) => {
            if (held.current) {
              held.current = false;
              event.preventDefault();
              event.stopPropagation();
            }
          },
        },
        trigger: (
          <button
            className="icon-button item-menu-trigger"
            data-menu-trigger={id}
            title={t("More actions")}
            aria-label={t("More actions for {0}", { 0: name })}
            aria-haspopup="menu"
            aria-expanded={context.current === id}
            onClick={(event) => {
              if (context.current === id) context.close(true);
              else {
                const rect = event.currentTarget.getBoundingClientRect();
                open(rect.right, rect.bottom, event.currentTarget);
              }
            }}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        ),
      })}
    </>
  );
}
