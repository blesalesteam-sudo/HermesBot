// OpenBot · móvil: los menús crecen como una burbuja desde el botón que los abre (ver openbot-movil.css).
// La hoja de estilo hace la animación; aquí solo se le dice desde qué esquina, según dónde cae el menú.
(() => {
  const phone = window.matchMedia("(max-width: 767.98px)");
  const aim = (menu) => {
    if (!phone.matches || menu.dataset.obOrigin) return;
    const place = () => {
      const box = menu.getBoundingClientRect();
      if (!box.width) return false;
      // El menú se pega al lado de su botón: el margen más pequeño dice de qué esquina sale.
      const x = box.left <= window.innerWidth - box.right ? "left" : "right";
      const y = box.top <= window.innerHeight - box.bottom ? "top" : "bottom";
      menu.style.transformOrigin = `${y} ${x}`;
      menu.dataset.obOrigin = `${y}-${x}`;
      return true;
    };
    if (!place()) requestAnimationFrame(place);
  };
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches('.popover-surface[role="menu"]')) aim(node);
    node.querySelectorAll?.('.popover-surface[role="menu"]').forEach(aim);
  };
  new MutationObserver((changes) => {
    for (const change of changes) change.addedNodes.forEach(scan);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
