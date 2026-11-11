/**
 * Escenas de sección: el video queda fijo mientras dura la sección.
 *
 * Ciclo por sección (bajando):  video completo  ->  texto  ->  cards
 * Subiendo: la sección nunca queda vacía y la reversa corre de fondo.
 *
 * Rendimiento: las posiciones se miden una vez (init, resize, fuentes) y cada
 * frame sólo hace aritmética; no se fuerza layout al hacer scroll.
 */
(function () {
  'use strict';

  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-seq]'));
  if (!sections.length) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SOURCE_TYPES = [['mp4', 'video/mp4'], ['webm', 'video/webm']];

  var RELEASE_MS = 420;    // deja terminar el fundido del texto antes de liberar el scroll
  var CARDS_MS = 620;      // las cards entran cuando el texto ya apareció
  var TEXT_BELOW_MS = 460; // subiendo: el texto entra después de las cards
  var SAFETY_MS = 4200;    // si el video no termina, se libera igual
  var rewindLimit = 220;   // px de sobregiro que se corrigen alineando la portada (se recalcula al medir)
  var upWindow = 340;      // px de margen para disparar la reversa al subir (se recalcula al medir)

  var SCROLL_KEYS = {
    ArrowDown: 1, ArrowUp: 1, PageDown: 1, PageUp: 1, Home: 1, End: 1, ' ': 1, Spacebar: 1
  };

  var locked = false;
  var ticking = false;
  var lastY = window.scrollY;
  var direction = 1;
  var viewportH = window.innerHeight;
  var jumpUntil = 0;
  var instances = [];
  var warmQueue = [];
  var warmed = false;

  /* la portada tiene prioridad de red: el resto despierta cuando ya apareció */
  function warmSections() {
    if (warmed) return;
    warmed = true;
    for (var i = 0; i < warmQueue.length; i++) warmQueue[i]();
  }

  var slowConnection = (function () {
    var conn = navigator.connection;
    return !!(conn && (conn.saveData || /2g/.test(conn.effectiveType || '')));
  })();

  function loadVideo(video) {
    if (video.getAttribute('data-loaded')) return;
    video.setAttribute('data-loaded', '1');
    SOURCE_TYPES.forEach(function (pair) {
      var url = video.getAttribute('data-src-' + pair[0]);
      if (!url) return;
      var source = document.createElement('source');
      source.src = url;
      source.type = pair[1];
      video.appendChild(source);
    });
    video.load();
  }

  function playSafe(video, onFail) {
    var promise = video.play();
    if (!promise || !promise.catch) return;
    promise.catch(function () {
      video.muted = true;
      var retry = video.play();
      if (retry && retry.catch) retry.catch(onFail);
    });
  }

  function lock() {
    if (locked) return;
    locked = true;
    document.documentElement.classList.add('seq-locked');
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    document.documentElement.classList.remove('seq-locked');
  }

  function blockScroll(event) {
    if (!locked) return;
    if (event.cancelable) event.preventDefault();
  }

  function blockKeys(event) {
    if (!locked) return;
    if (SCROLL_KEYS[event.key]) event.preventDefault();
  }

  function create(section) {
    var stage = section.querySelector('.seq-stage');
    var body = section.querySelector('.sec-body');
    var head = section.querySelector('.sec-head-wrap');
    var forward = section.querySelector('[data-seq-forward]');
    var reverse = section.querySelector('[data-seq-reverse]');
    var content = section.querySelector('[data-seq-content]');
    if (!stage || !forward || !reverse || !content) return null;

    var state = 'idle'; // idle | forward | revealed | rewinding
    var timer = 0;
    var cardsTimer = 0;
    var quietReverse = false;
    var upPlayed = false;   // la reversa de esta sección ya corrió
    var top = 0;
    var height = 1;
    var bodyTop = 0;      // inicio de las cards: dispara el velo del video
    var headTop = 0;      // card de texto: sirve para medir sin forzar layout

    section.classList.add('is-armed');

    function measure() {
      /* la card de texto se coloca en la parte alta del video y las cards de la
         sección quedan justo debajo del pliegue: aparecen al hacer scroll */
      if (head) {
        head.style.marginTop = '0px';
        var stageRect = stage.getBoundingClientRect();
        var naturalHead = head.getBoundingClientRect().top;
        var goalHead = stageRect.top + Math.max(56, Math.round(viewportH * 0.10));
        head.style.marginTop = Math.round(goalHead - naturalHead) + 'px';

        if (body) {
          body.style.marginTop = '0px';
        }
      }
      var y = window.scrollY;
      var box = section.getBoundingClientRect();
      top = box.top + y;
      height = box.height || 1;
      headTop = head ? head.getBoundingClientRect().top + y : top;
      bodyTop = body ? body.getBoundingClientRect().top + y : headTop;
    }

    function activate(el) {
      forward.classList.toggle('is-active', el === forward);
      reverse.classList.toggle('is-active', el === reverse);
    }

    function seekTo(video, time) {
      var target = Math.max(0, time || 0);
      if (video.readyState >= 1) {
        video.currentTime = Math.min(target, video.duration || target);
        return;
      }
      var onMeta = function () {
        video.removeEventListener('loadedmetadata', onMeta);
        video.currentTime = Math.min(target, video.duration || target);
      };
      video.addEventListener('loadedmetadata', onMeta);
    }

    function forwardTime(offset) {
      var duration = forward.duration || reverse.duration || 2.04;
      return Math.max(0, duration - (offset || 0));
    }

    function prefetchReverse() {
      if (reverse.getAttribute('data-loaded')) return;
      if (slowConnection) return;
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(function () { loadVideo(reverse); }, { timeout: 2500 });
      } else {
        window.setTimeout(function () { loadVideo(reverse); }, 1200);
      }
    }

    /* deja cargado el video de la siguiente sección mientras el usuario lee esta */
    function prefetchNext() {
      if (slowConnection) return;
      var next = section.nextElementSibling;
      while (next && !next.hasAttribute('data-seq')) next = next.nextElementSibling;
      if (!next) return;
      var video = next.querySelector('[data-seq-forward]');
      if (video) loadVideo(video);
    }

    function release() {
      window.clearTimeout(timer);
      timer = window.setTimeout(unlock, RELEASE_MS);
    }

    function showCards() {
      window.clearTimeout(cardsTimer);
      section.classList.add('is-cards');
      queue();   // el velo entra junto con las cards
    }

    function reveal() {
      if (state !== 'forward') return;
      state = 'revealed';
      section.classList.add('is-revealed');
      content.classList.add('is-revealed');
      prefetchReverse();
      prefetchNext();
      release();
      window.clearTimeout(cardsTimer);
      cardsTimer = window.setTimeout(showCards, CARDS_MS);
      queue();
    }

    function settle() {
      state = 'idle';
      upPlayed = false;
      activate(null);
      window.clearTimeout(cardsTimer);
      section.classList.remove('is-revealed', 'is-cards');
      content.classList.remove('is-revealed');
      if (forward.readyState >= 1) forward.currentTime = 0;
      unlock();
      queue();   // reevalúa por si el usuario ya está dentro de la sección
    }

    function playForward(startAt) {
      if (state === 'forward' || state === 'revealed') return;
      if (locked) return;                 // otra sección ya está reproduciendo
      state = 'forward';
      upPlayed = false;
      loadVideo(forward);
      activate(forward);
      seekTo(forward, startAt || 0);
      lock();

      /* si el scroll se pasó del inicio de la sección, se alinea a la portada */
      var liveTop = section.getBoundingClientRect().top;
      if (liveTop < -2) {
        window.scrollTo(0, Math.max(0, Math.round(window.scrollY + liveTop)));
      }

      playSafe(forward, reveal);
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        if (state === 'forward') reveal();
        unlock();
      }, SAFETY_MS);
    }

    /* subiendo: la portada se alinea, se limpia el contenido y corre la reversa
       con el scroll retenido, igual que la bajada pero al revés */
    function playReverseHeld() {
      if (locked) return;
      window.clearTimeout(timer);
      window.clearTimeout(cardsTimer);
      state = 'rewinding';
      var liveTop = section.getBoundingClientRect().top;
      if (Math.abs(liveTop) > 1) {
        window.scrollTo(0, Math.round(window.scrollY + liveTop));
      }
      section.classList.remove('is-revealed', 'is-cards');
      content.classList.remove('is-revealed');
      loadVideo(reverse);
      activate(reverse);
      seekTo(reverse, 0);
      lock();
      playSafe(reverse, finishReverse);
      window.clearTimeout(timer);
      timer = window.setTimeout(finishReverse, SAFETY_MS);
    }

    /* al terminar la reversa: primero las cards y luego la card de texto */
    function finishReverse() {
      if (state !== 'rewinding') return;
      window.clearTimeout(timer);
      unlock();
      state = 'revealed';
      upPlayed = true;
      section.classList.add('is-cards');
      window.clearTimeout(cardsTimer);
      cardsTimer = window.setTimeout(function () {
        section.classList.add('is-revealed');
        content.classList.add('is-revealed');
        queue();
      }, TEXT_BELOW_MS);
      queue();
    }

    forward.addEventListener('ended', reveal);
    forward.addEventListener('error', function () {
      if (state === 'forward') reveal();
    });
    reverse.addEventListener('ended', function () {
      if (quietReverse) {
        quietReverse = false;
        activate(null);
        return;
      }
      if (state === 'rewinding') finishReverse();
    });
    reverse.addEventListener('error', function () {
      if (state === 'rewinding') finishReverse();
    });

    /* los videos de sección se descargan después de la portada, para no competir con ella */
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          loadVideo(forward);
          observer.disconnect();
        });
      }, { rootMargin: '120% 0px' });
      warmQueue.push(function () { observer.observe(section); });
    } else {
      warmQueue.push(function () { loadVideo(forward); });
    }

    function skipScene() {
      state = 'revealed';
      section.classList.add('is-revealed', 'is-content', 'is-cards');
      content.classList.add('is-revealed');
      prefetchReverse();
    }

    /* entrada desde abajo: se ven primero las cards y luego la card de texto */
    function enterFromBelow() {
      var ready = forward.getAttribute('data-loaded') !== null;
      loadVideo(forward);
      state = 'revealed';
      window.clearTimeout(timer);
      window.clearTimeout(cardsTimer);
      section.classList.add('is-content', 'is-cards');
      section.classList.remove('is-revealed');
      content.classList.remove('is-revealed');
      upPlayed = true;
      prefetchReverse();
      cardsTimer = window.setTimeout(function () {
        section.classList.add('is-revealed');
        content.classList.add('is-revealed');
      }, TEXT_BELOW_MS);
      if (!ready || slowConnection) return;
      if (!reverse.getAttribute('data-loaded')) loadVideo(reverse);
      quietReverse = true;
      activate(reverse);
      seekTo(reverse, 0);
      playSafe(reverse, function () {
        quietReverse = false;
        activate(null);
      });
    }

    function update(dir) {
      var y = window.scrollY;
      var rectTop = top - y;
      var rectBottom = rectTop + height;
      var jumping = Date.now() < jumpUntil;

      if (!jumping && state === 'idle' && dir > 0 && rectTop <= 0) {
        /* llegada normal: se alinea la portada y corre el video completo.
           En saltos grandes (ancla, End, fling) no se arrastra al usuario. */
        if (-rectTop <= rewindLimit) playForward(0);
        else skipScene();
      } else if (!jumping && !locked && state === 'idle' && dir < 0 && rectTop < -4 && rectBottom > 0) {
        enterFromBelow();
      } else if (!jumping && !locked && state === 'revealed' && !upPlayed && dir < 0 && rectTop >= 0 && rectTop <= upWindow) {
        /* al salir de una sección hacia arriba se reproduce la reversa */
        playReverseHeld();
      }
      /* al alejarse hacia arriba, la sección vuelve a quedar lista para la bajada */
      if (!jumping && state === 'revealed' && upPlayed && dir < 0 && rectTop > viewportH - 40) settle();

      /* el velo sólo existe cuando las cards están en pantalla:
         nunca durante la animación (ni de bajada ni de reversa) */
      var covered = section.classList.contains('is-cards') &&
        (bodyTop - y < viewportH - Math.min(180, viewportH * 0.28));
      section.classList.toggle('is-content', covered);
    }

    return {
      el: section,
      update: update,
      measure: measure,
      skip: skipScene,
      goStatic: function () {
        window.clearTimeout(timer);
        window.clearTimeout(cardsTimer);
        state = 'revealed';
        section.classList.add('is-static', 'is-revealed', 'is-cards');
        content.classList.add('is-revealed');
        activate(null);
      }
    };
  }

  function queue() {
    onScroll();
  }

  function measureAll() {
    viewportH = window.innerHeight;
    rewindLimit = Math.max(220, Math.round(viewportH * 0.42));
    upWindow = Math.max(220, Math.round(viewportH * 0.4));
    instances.forEach(function (instance) { instance.measure(); });
  }

  function updateAll() {
    var y = window.scrollY;
    if (y !== lastY) direction = y > lastY ? 1 : -1;
    lastY = y;
    for (var i = 0; i < instances.length; i++) instances[i].update(direction);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      updateAll();
    });
  }

  sections.forEach(function (section) {
    var instance = create(section);
    if (instance) instances.push(instance);
  });
  if (!instances.length) return;

  measureAll();
  /* marca como vistas las secciones que ya quedaron por encima al cargar */
  for (var i = 0; i < instances.length; i++) {
    if (instances[i].el.getBoundingClientRect().top < -4) instances[i].skip();
  }

  /* el calentamiento de las secciones espera a que la portada haya aparecido */
  document.addEventListener('herorevealed', warmSections);
  window.addEventListener('load', function () { window.setTimeout(warmSections, 1600); });

  function staticAll() {
    instances.forEach(function (instance) { instance.goStatic(); });
    unlock();
  }

  /* navegación por ancla o teclas End/Home: la secuencia no debe frenar el salto */
  function openJumpWindow() {
    jumpUntil = Date.now() + 5000;   // tope de seguridad si no hay 'scrollend'
  }
  document.addEventListener('anchorjump', openJumpWindow);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'End' || event.key === 'Home') openJumpWindow();
  });
  window.addEventListener('hashchange', openJumpWindow);
  window.addEventListener('scrollend', function () { jumpUntil = 0; }, { passive: true });

  if (reducedMotion.matches) {
    staticAll();
    return;
  }

  window.addEventListener('wheel', blockScroll, { passive: false });
  window.addEventListener('touchmove', blockScroll, { passive: false });
  window.addEventListener('keydown', blockKeys);
  window.addEventListener('scroll', onScroll, { passive: true });

  var resizeTimer = 0;
  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      measureAll();
      updateAll();
    }, 150);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measureAll(); updateAll(); });
  }
  window.addEventListener('load', function () { measureAll(); updateAll(); });

  /* al volver del bfcache o de una pestaña en segundo plano no debe quedar bloqueo */
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    unlock();
    measureAll();
    updateAll();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) unlock();
  });

  var onMotionChange = function (event) {
    if (!event.matches) return;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('wheel', blockScroll);
    window.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('keydown', blockKeys);
    staticAll();
  };
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
  else if (reducedMotion.addListener) reducedMotion.addListener(onMotionChange);

  updateAll();
})();