/**
 * Navegación de escenas (deck): la página no se recorre libremente.
 * Sólo se cambia de sección con los puntos de la izquierda y las flechas de
 * la derecha. Dentro de cada sección el scroll es libre hasta sus bordes, así
 * que todo el contenido se puede ver sin salir de ella.
 */
(function () {
  'use strict';

  var sections = Array.prototype.slice.call(document.querySelectorAll('body > section[id]'));
  if (sections.length < 2) return;

  var dotsBox = document.getElementById('deckDots');
  var prevBtn = document.getElementById('deckPrev');
  var nextBtn = document.getElementById('deckNext');
  var counter = document.getElementById('deckCount');
  var contactCta = document.querySelector('.hero-cta');
  if (!dotsBox || !prevBtn || !nextBtn || !counter) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var MOVE_TIMEOUT = 6000;  // tope de seguridad si el desplazamiento no llega

  var stops = [];
  var tops = [];
  var dots = [];
  var indexes = {};
  var jailIndex = 0;
  var moving = false;
  var movingTimer = 0;
  var movingSection = null;
  var moveTarget = 0;
  var moveDir = 1;
  var watchToken = 0;
  var tweenToken = 0;
  var queued = null;
  var queueTimer = 0;
  var ticking = false;
  var resizeTimer = 0;
  var RETURN_KEY = 'deck:return';

  sections.forEach(function (section, i) {
    if (section.id) indexes[section.id] = i;
  });

  function label(section) {
    var text = section.getAttribute('data-nav');
    return text || section.id || ('Sección ' + (sections.indexOf(section) + 1));
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function isLocked() {
    return document.documentElement.classList.contains('seq-locked');
  }

  function maxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  /* ---------- paradas y límites ---------- */

  /* una sola parada por sección: dentro de cada una el scroll recorre todo su
     contenido y se detiene en los bordes, nunca pasa a la siguiente */
  function buildStops() {
    var limit = maxScroll();
    tops = [];
    stops = sections.map(function (section, i) {
      var box = section.getBoundingClientRect();
      var top = Math.round(box.top + window.scrollY);
      tops[i] = top;
      return { y: Math.max(0, Math.min(top, limit)), section: i };
    });
  }

  function bounds(index) {
    var section = sections[index];
    if (!section) return { min: 0, max: maxScroll() };
    var box = section.getBoundingClientRect();
    var top = Math.round(box.top + window.scrollY);
    var min = Math.max(0, top);
    var max = Math.min(top + Math.round(box.height) - window.innerHeight, maxScroll());
    return { min: min, max: Math.max(min, max) };
  }

  function activeIndex() {
    var probe = window.scrollY + window.innerHeight * 0.35;
    var best = 0;
    for (var i = 0; i < tops.length; i++) {
      if (tops[i] <= probe) best = i;
    }
    return best;
  }

  function stepTarget(direction) {
    var y = window.scrollY;
    var i;
    if (direction > 0) {
      for (i = 0; i < stops.length; i++) if (stops[i].y > y + 8) return i;
      return -1;
    }
    for (i = stops.length - 1; i >= 0; i--) if (stops[i].y < y - 8) return i;
    return -1;
  }

  function sectionStart(sectionIndex) {
    var box = sections[sectionIndex].getBoundingClientRect();
    return Math.max(0, Math.min(Math.round(box.top + window.scrollY), maxScroll()));
  }

  /* ---------- mando de la vista ---------- */

  function syncUI() {
    var active = activeIndex();
    if (contactCta) contactCta.classList.toggle('is-at-contact', active === sections.length - 1);
    for (var i = 0; i < dots.length; i++) {
      var on = i === active;
      dots[i].classList.toggle('is-active', on);
      if (on) dots[i].setAttribute('aria-current', 'true');
      else dots[i].removeAttribute('aria-current');
    }
    counter.textContent = pad(active + 1) + ' / ' + pad(sections.length);
    prevBtn.disabled = stepTarget(-1) < 0;
    nextBtn.disabled = stepTarget(1) < 0;
  }

  function requestSync() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      clampToJail();
      syncUI();
    });
  }

  /* el scroll nunca sale de la sección actual (ni por inercia táctil) */
  function clampToJail() {
    if (moving || isLocked()) return;
    var b = bounds(jailIndex);
    var y = window.scrollY;
    if (y < b.min - 1) window.scrollTo(0, b.min);
    else if (y > b.max + 1) window.scrollTo(0, b.max);
  }

  function setHash(id) {
    if (!id || ('#' + id) === window.location.hash) return;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + id);
    }
  }

  function perform(y, sectionIndex) {
    y = Math.max(0, Math.min(y, maxScroll()));
    if (Math.abs(y - window.scrollY) < 2) {
      syncUI();
      return;
    }

    moving = true;
    movingSection = sectionIndex == null ? null : sectionIndex;
    if (sectionIndex != null) jailIndex = sectionIndex;
    moveTarget = y;
    moveDir = y > window.scrollY ? 1 : -1;
    /* abre la ventana de salto: la secuencia de escenas no debe frenar ni
       reencuadrar el desplazamiento que estamos haciendo */
    document.dispatchEvent(new CustomEvent('anchorjump'));

    smoothTo(y);

    window.clearTimeout(movingTimer);
    movingTimer = window.setTimeout(finishMove, MOVE_TIMEOUT);
    watchToken++;
    watchArrival(watchToken);
    if (sectionIndex != null) setHash(sections[sectionIndex].id);
  }

  /* pase corto y de duración acotada: el scroll suave nativo tarda segundos
     en saltos largos y deja la sensación de que el botón no responde */
  function smoothTo(target) {
    var start = window.scrollY;
    var delta = target - start;
    if (!delta) return;
    if (reducedMotion.matches || document.hidden) {
      window.scrollTo(0, target);
      return;
    }
    var token = ++tweenToken;
    /* arranque y frenada suaves: el ease-out puro dejaba casi todo el recorrido
       en los primeros 150 ms y el cambio de sección se leía como un corte */
    var duration = Math.min(880, Math.max(500, Math.abs(delta) * 0.62));
    var begin = 0;
    var step = function (now) {
      if (token !== tweenToken) return;
      if (!begin) begin = now;
      var t = Math.min(1, (now - begin) / duration);
      var eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(0, Math.round(start + delta * eased));
      if (t < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
    /* pestaña en segundo plano: no llegan frames, así que se salta directo */
    window.setTimeout(function () {
      if (token !== tweenToken || begin) return;
      window.scrollTo(0, target);
    }, 220);
  }

  /* espera a estar realmente en el destino: cerrar la ventana de salto antes
     de tiempo haría que la escena reencuadre la página a mitad de camino */
  function watchArrival(token) {
    window.setTimeout(function () {
      if (!moving || token !== watchToken) return;
      if (Math.abs(window.scrollY - moveTarget) < 2) {
        finishMove();
        return;
      }
      watchArrival(token);
    }, 80);
  }

  function finishMove() {
    if (!moving) return;
    moving = false;
    window.clearTimeout(movingTimer);
    /* cierra la ventana de salto y deja que la escena evalúe el destino:
       así arranca el video de la portada a la que acabamos de llegar */
    window.dispatchEvent(new Event('scrollend'));
    poke(moveDir);
    /* las escenas que quedaron fuera de pantalla vuelven a quedar listas */
    document.dispatchEvent(new CustomEvent('seqreset'));
    notifyArrival();
    pulse(movingSection, 0);
    ensureArrival(0);
    syncUI();
  }

  /* avisa a la escena de destino que la navegación terminó: es lo que hace que
     el video se reproduzca igual al bajar y al subir */
  function notifyArrival() {
    if (movingSection == null) return;
    var section = sections[movingSection];
    if (!section) return;
    document.dispatchEvent(new CustomEvent('seqarrive', {
      detail: { id: section.id, dir: moveDir }
    }));
  }

  /* si el documento cambió de alto durante el salto (fuentes, modo sin
     movimiento) se recalcula el destino una vez más */
  function ensureArrival(attempt) {
    if (movingSection == null || attempt > 2) return;
    window.setTimeout(function () {
      if (moving) return;
      var section = sections[movingSection];
      if (!section) return;
      if (section.getBoundingClientRect().top > window.innerHeight * 0.6) {
        navigate(sectionStart(movingSection), movingSection);
      }
    }, 320);
  }

  function poke(dir) {
    document.dispatchEvent(new CustomEvent('seqmove', { detail: { dir: dir || 0 } }));
  }

  /* si la portada de destino no llegó a revelarse (porque otra escena aún
     tenía el scroll retenido) se le vuelve a dar el turno */
  function pulse(sectionIndex, attempt) {
    if (sectionIndex == null || attempt > 5) return;
    window.setTimeout(function () {
      if (isLocked()) {
        pulse(sectionIndex, attempt + 1);
        return;
      }
      var section = sections[sectionIndex];
      if (!section || section.classList.contains('is-revealed') || section.classList.contains('is-static')) return;
      poke(moveDir);
      pulse(sectionIndex, attempt + 1);
    }, attempt ? 420 : 220);
  }

  function navigate(y, sectionIndex) {
    if (isLocked()) {
      queued = { y: y, section: sectionIndex };
      waitForUnlock();
      return;
    }
    perform(y, sectionIndex);
  }

  function waitForUnlock() {
    if (queueTimer) return;
    var start = Date.now();
    var loop = function () {
      if (!isLocked() || Date.now() - start > 2600) {
        queueTimer = 0;
        var pending = queued;
        queued = null;
        if (pending) perform(pending.y, pending.section);
        return;
      }
      queueTimer = window.setTimeout(loop, 120);
    };
    queueTimer = window.setTimeout(loop, 120);
  }

  function goToSection(sectionIndex) {
    if (sectionIndex < 0 || sectionIndex >= sections.length) return;
    navigate(sectionStart(sectionIndex), sectionIndex);
  }

  function goToStep(index) {
    if (index < 0 || index >= stops.length) return;
    navigate(stops[index].y, stops[index].section);
  }

  /* ---------- controles ---------- */

  function buildDots() {
    dotsBox.innerHTML = '';
    dots = sections.map(function (section, i) {
      var item = document.createElement('li');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'deck-dot';
      button.setAttribute('aria-label', 'Ir a ' + label(section));

      var core = document.createElement('span');
      core.className = 'deck-dot-core';

      var text = document.createElement('span');
      text.className = 'deck-dot-label';
      text.setAttribute('aria-hidden', 'true');
      text.textContent = pad(i + 1) + ' · ' + label(section);

      button.appendChild(core);
      button.appendChild(text);
      button.addEventListener('click', function () { goToSection(i); });
      item.appendChild(button);
      dotsBox.appendChild(item);
      return button;
    });
  }

  prevBtn.addEventListener('click', function () { goToStep(stepTarget(-1)); });
  nextBtn.addEventListener('click', function () { goToStep(stepTarget(1)); });

  /* ---------- volver desde el detalle de un plan ---------- */

  function saveReturn() {
    try {
      var b = bounds(jailIndex);
      var span = b.max - b.min;
      var ratio = span > 0 ? (window.scrollY - b.min) / span : 0;
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify({
        id: sections[jailIndex] ? sections[jailIndex].id : '',
        ratio: Math.min(1, Math.max(0, ratio))
      }));
    } catch (e) {}
  }

  function readReturn() {
    try {
      var raw = window.sessionStorage.getItem(RETURN_KEY);
      if (!raw) return null;
      window.sessionStorage.removeItem(RETURN_KEY);
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function applyReturn(saved) {
    if (!saved || !saved.id || !(saved.id in indexes)) return;
    var index = indexes[saved.id];
    var b = bounds(index);
    var y = b.min + Math.round((b.max - b.min) * Math.min(1, Math.max(0, saved.ratio || 0)));
    jailIndex = index;
    window.scrollTo(0, y);
    setHash(sections[index].id);
    poke(1);
    syncUI();
  }

  /* al abrir "Ver detalles" se guarda el punto exacto de la sección */
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href^="planes/"]') : null;
    if (!link) return;
    saveReturn();
  });

  /* los enlaces internos (#contacto, #planes…) también entran por el deck */
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    var id = (link.getAttribute('href') || '').slice(1);
    if (!id || !(id in indexes)) return;
    event.preventDefault();
    goToSection(indexes[id]);
  });

  /* ---------- la página no se recorre a mano ---------- */

  function insideScroller(node) {
    return !!(findScroller(node, false) || findScroller(node, true));
  }

  function findScroller(node, horizontal) {
    while (node && node !== document.body) {
      if (node.nodeType === 1) {
        var style = window.getComputedStyle(node);
        var overflow = horizontal ? style.overflowX : style.overflowY;
        if (overflow === 'auto' || overflow === 'scroll') {
          var hidden = horizontal
            ? node.scrollWidth - node.clientWidth
            : node.scrollHeight - node.clientHeight;
          if (hidden > 2) return node;
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  function blockWheel(event) {
    if (!event.cancelable) return;
    var horizontal = findScroller(event.target, true);
    if (horizontal && !findScroller(event.target, false)) {
      /* tablas anchas: la rueda mueve la tabla, no la página */
      event.preventDefault();
      horizontal.scrollLeft += Math.abs(event.deltaY) > Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
      return;
    }
    if (findScroller(event.target, false)) return;

    var b = bounds(jailIndex);
    if (b.max - b.min < 4) { event.preventDefault(); return; }

    var y = window.scrollY;
    var target = y + (event.deltaY || 0);
    if (target < b.min) {
      event.preventDefault();
      if (y > b.min + 1) window.scrollTo(0, b.min);
    } else if (target > b.max) {
      event.preventDefault();
      if (y < b.max - 1) window.scrollTo(0, b.max);
    }
  }

  var touchStartY = 0;

  function onTouchStart(event) {
    if (event.touches && event.touches.length === 1) touchStartY = event.touches[0].clientY;
  }

  function blockTouch(event) {
    if (!event.cancelable) return;
    if (insideScroller(event.target)) return;
    var b = bounds(jailIndex);
    if (b.max - b.min < 4) { event.preventDefault(); return; }
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    var delta = touch.clientY - touchStartY;   // >0: el dedo baja, el contenido sube
    if (delta > 0 && window.scrollY <= b.min + 1) event.preventDefault();
    else if (delta < 0 && window.scrollY >= b.max - 1) event.preventDefault();
  }

  function blockKeys(event) {
    var tag = event.target && event.target.tagName;
    if ((tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') &&
        (event.key === ' ' || event.key === 'Spacebar')) {
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      return;
    }
    var down = event.key === 'ArrowDown' || event.key === 'PageDown' ||
      event.key === ' ' || event.key === 'Spacebar';
    var up = event.key === 'ArrowUp' || event.key === 'PageUp';
    if (!down && !up) return;

    var b = bounds(jailIndex);
    if (b.max - b.min < 4) { event.preventDefault(); return; }
    if (down && window.scrollY >= b.max - 1) event.preventDefault();
    if (up && window.scrollY <= b.min + 1) event.preventDefault();
  }

  /* ---------- arranque ---------- */

  function refresh() {
    buildStops();
    syncUI();
  }

  document.documentElement.classList.add('deck-mode');
  buildDots();
  refresh();

  var savedReturn = readReturn();
  var returnApplied = false;

  function restoreReturn(saved) {
    if (returnApplied) return;
    returnApplied = true;
    applyReturn(saved);
  }

  window.addEventListener('scroll', requestSync, { passive: true });
  window.addEventListener('scrollend', function () {
    if (moving) finishMove();
  }, { passive: true });
  /* al volver con el botón de atrás (bfcache) se retoma la sección actual */
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    try { window.sessionStorage.removeItem(RETURN_KEY); } catch (e) {}
    refresh();
    jailIndex = activeIndex();
  });
  window.addEventListener('wheel', blockWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', blockTouch, { passive: false });
  window.addEventListener('keydown', blockKeys);
  window.addEventListener('load', function () { window.setTimeout(refresh, 60); });

  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(refresh, 180);
  });
  window.addEventListener('orientationchange', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(refresh, 320);
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { window.setTimeout(refresh, 60); });
  }
  /* la secuencia reencaucha las portadas después de medir: recalcula las paradas */
  window.setTimeout(refresh, 700);
  window.setTimeout(refresh, 1600);

  if (savedReturn) {
    /* se viene del detalle de un plan: se vuelve al punto exacto */
    window.addEventListener('load', function () {
      window.setTimeout(function () { restoreReturn(savedReturn); }, 120);
    });
    window.setTimeout(function () { restoreReturn(savedReturn); }, 900);
  } else if (window.location.hash) {
    var id = window.location.hash.slice(1);
    if (id in indexes) {
      jailIndex = indexes[id];
      window.setTimeout(function () { goToSection(indexes[id]); }, 120);
    }
  }
})();
