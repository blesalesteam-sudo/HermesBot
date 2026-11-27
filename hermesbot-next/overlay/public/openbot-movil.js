// OpenBot · móvil: los menús crecen como una burbuja desde el botón que los abre (ver openbot-movil.css).
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

  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches(MENU)) aim(node);
    node.querySelectorAll?.(MENU).forEach((menu) => aim(menu));
  };
  new MutationObserver((changes) => {
    for (const change of changes) change.addedNodes.forEach(scan);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
