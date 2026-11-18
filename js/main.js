/**
 * Propuesta E-commerce · Motos, Accesorios y Servicio Mecánico
 * Comportamiento del documento. Sin dependencias.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function focusTarget(target) {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var id = (link.getAttribute('href') || '').slice(1);
      var target = id ? document.getElementById(id) : null;
      if (!target) return;

      event.preventDefault();
      if (document.documentElement.classList.contains('deck-mode')) {
        /* el modo deck manda: su navegación controla el destino del salto */
        return;
      }
      focusTarget(target);
      /* avisa a la secuencia de escenas para que no frene el salto */
      document.dispatchEvent(new CustomEvent('anchorjump', { detail: { id: id } }));
      target.scrollIntoView({
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
        block: 'start'
      });
      history.pushState(null, '', '#' + id);
    });
  });
})();
