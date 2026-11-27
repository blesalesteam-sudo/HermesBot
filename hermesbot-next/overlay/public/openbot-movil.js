// OpenBot · móvil (ver openbot-movil.css). Tres cosas que una hoja de estilo sola no puede hacer:
// 1) los menús crecen como una burbuja desde el botón que los abre; 2) las hojas y paneles se cierran con animación;
// 3) se sale del chat deslizando el dedo desde el borde izquierdo.
// La hoja de estilo hace la animación; aquí se le dice el punto exacto del que sale: el centro del botón
// que se acaba de pulsar. Si no se encuentra el botón, sale de la esquina del menú más pegada al borde.
(() => {
  const phone = window.matchMedia("(max-width: 767.98px)");
  const MENU = '.popover-surface[role="menu"]';
  let lastTap = null;

  // El último toque dice qué botón abrió el menú, también cuando la app no marca aria-expanded.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target instanceof Element ? event.target.closest("button, [role='button'], a") : null;
      lastTap = target ? { el: target, at: performance.now() } : null;
    },
    true,
  );

  const trigger = (menu, box) => {
    const centre = (el) => {
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    };
    const gap = (p) => Math.hypot(Math.max(box.left - p.x, 0, p.x - box.right), Math.max(box.top - p.y, 0, p.y - box.bottom));
    const options = [];
    if (lastTap && performance.now() - lastTap.at < 1500 && document.contains(lastTap.el) && !menu.contains(lastTap.el)) options.push(lastTap.el);
    document.querySelectorAll('[aria-expanded="true"]').forEach((el) => !menu.contains(el) && options.push(el));
    let best = null;
    for (const el of options) {
      const p = centre(el);
      if (!p) continue;
      const d = gap(p);
      // El botón queda pegado al menú; uno lejano no es el que lo abrió.
      if (d < 120 && (!best || d < best.d)) best = { p, d };
    }
    return best?.p ?? null;
  };

  const aim = (menu, tries = 0) => {
    if (!phone.matches || menu.dataset.obOrigin) return;
    // La app coloca el menú un instante después de crearlo; hasta entonces está oculto en la esquina.
    if (getComputedStyle(menu).visibility === "hidden" && tries < 10) {
      requestAnimationFrame(() => aim(menu, tries + 1));
      return;
    }
    // Se mide sin la animación (que lo encoge) y se vuelve a lanzar ya con el origen bueno.
    menu.style.animation = "none";
    const box = menu.getBoundingClientRect();
    if (!box.width) {
      menu.style.animation = "";
      return;
    }
    const from = trigger(menu, box);
    if (from) {
      const x = Math.min(Math.max(from.x - box.left, 0), box.width);
      const y = Math.min(Math.max(from.y - box.top, 0), box.height);
      menu.style.transformOrigin = `${x}px ${y}px`;
      menu.dataset.obOrigin = "boton";
    } else {
      const x = box.left <= window.innerWidth - box.right ? "left" : "right";
      const y = box.top <= window.innerHeight - box.bottom ? "top" : "bottom";
      menu.style.transformOrigin = `${x} ${y}`;
      menu.dataset.obOrigin = "esquina";
    }
    void menu.offsetWidth;
    menu.style.animation = "";
  };

  // ---------- Cierre animado de hojas y paneles ----------
  // La app quita la hoja de golpe al cerrarla. Aquí se deja un instante una copia en su mismo sitio, que baja
  // (hojas con X) o se va hacia la derecha (perfil del bot), y luego se borra. La copia no se puede tocar.
  const SHEETS = [
    { sel: 'aside[role="dialog"]', way: "right" },
    { sel: "[data-page-pane]", way: "down" },
    { sel: '[data-look="settings"]', way: "down" },
    { sel: "form[data-bot-look]", way: "down" },
    { sel: "[data-inbox-panel]", way: "down" },
  ];
  const ALL_SHEETS = SHEETS.map((sheet) => sheet.sel).join(", ");
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "true";
  let boxes = new WeakMap();
  // Justo antes de cada toque o tecla se apunta dónde está cada hoja abierta (y lo que la envuelve).
  const remember = () => {
    if (!phone.matches) return;
    boxes = new WeakMap();
    document.querySelectorAll(ALL_SHEETS).forEach((sheet) => {
      // La app puede quitar la hoja o la caja que la envuelve (su fondo oscuro): se apuntan ambas.
      for (let el = sheet, depth = 0; el && el !== document.body && depth < 3; el = el.parentElement, depth++) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) boxes.set(el, r);
      }
    });
  };
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("keydown", remember, true);

  const leave = (node) => {
    if (!(node instanceof Element) || !phone.matches || still() || node.closest?.(".ob-exit")) return;
    const box = boxes.get(node);
    if (!box) return;
    const kind = SHEETS.find((sheet) => node.matches(sheet.sel) || node.querySelector(sheet.sel));
    if (!kind) return;
    const copy = node.cloneNode(true);
    const target = copy.matches(kind.sel) ? copy : copy.querySelector(kind.sel);
    if (!target) return;
    // Una página dentro de la copia volvería a cargarse: se deja en blanco.
    copy.querySelectorAll("iframe").forEach((frame) => frame.removeAttribute("src"));
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    target.dataset.obExit = kind.way;
    const holder = document.createElement("div");
    holder.className = "ob-exit";
    for (let el = target.parentElement; el; el = el.parentElement) el.dataset.obVeil = "";
    holder.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    holder.appendChild(copy);
    document.body.appendChild(holder);
    setTimeout(() => holder.remove(), 420);
  };

  // ---------- Deslizar desde el borde izquierdo para salir del chat ----------
  const root = document.documentElement;
  const backButton = () => document.querySelector('[data-look="app"] button:is([aria-label="Abrir la lista de bots"], [aria-label="Open the bot list"])');
  let drag = null;
  const inChat = () => {
    const list = document.querySelector('[data-look="sidebar"]');
    if (!list || list.hasAttribute("data-sidebar-root")) return false;
    // Con una hoja, un panel o un menú abierto encima, el gesto no es para el chat.
    return !document.querySelector(`${ALL_SHEETS}, ${MENU}, [role="dialog"]`);
  };
  document.addEventListener(
    "touchstart",
    (event) => {
      drag = null;
      if (!phone.matches || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX > 28 || !inChat() || !backButton()) return;
      drag = { x: touch.clientX, y: touch.clientY, at: performance.now(), on: false, last: touch.clientX, lastAt: performance.now(), speed: 0 };
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      if (!drag) return;
      const touch = event.touches[0];
      const dx = touch.clientX - drag.x;
      const dy = touch.clientY - drag.y;
      if (!drag.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return void (drag = null);
        if (dx < 8) return;
        drag.on = true;
        root.classList.add("ob-drag");
      }
      const now = performance.now();
      if (now > drag.lastAt) drag.speed = (touch.clientX - drag.last) / (now - drag.lastAt);
      drag.last = touch.clientX;
      drag.lastAt = now;
      root.style.setProperty("--ob-drag", `${Math.max(0, dx)}px`);
      if (event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  const drop = () => {
    if (!drag) return;
    const moved = drag.on ? drag.last - drag.x : 0;
    // Un empujón rápido también vale, pero solo si el dedo seguía moviéndose al soltar.
    const flick = performance.now() - drag.lastAt < 90 && drag.speed > 0.45;
    const go = drag.on && (moved > window.innerWidth * 0.35 || flick);
    const was = drag.on;
    drag = null;
    if (!was) return;
    if (go) backButton()?.click();
    // Al quitar la marca, el chat sigue desde donde está el dedo hasta su sitio final (dentro o fuera).
    requestAnimationFrame(() => {
      root.classList.remove("ob-drag");
      root.style.removeProperty("--ob-drag");
    });
  };
  document.addEventListener("touchend", drop, { passive: true });
  document.addEventListener("touchcancel", drop, { passive: true });

  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches(MENU)) aim(node);
    node.querySelectorAll?.(MENU).forEach((menu) => aim(menu));
  };
  new MutationObserver((changes) => {
    for (const change of changes) {
      change.addedNodes.forEach(scan);
      change.removedNodes.forEach(leave);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
