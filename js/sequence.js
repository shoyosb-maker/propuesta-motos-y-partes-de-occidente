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
  var heroSection = document.querySelector('[data-scene]');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SOURCE_TYPES = [['mp4', 'video/mp4'], ['webm', 'video/webm']];

  var RELEASE_MS = 360;    // deja terminar el fundido del texto antes de liberar el scroll
  var CARDS_MS = 400;      // las cards entran cuando el texto ya apareció
  var SAFETY_MS = 4200;    // si el video no termina, se libera igual
  var rewindLimit = 220;   // px de sobregiro que se corrigen alineando la portada (se recalcula al medir)

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
    var tag = event.target && event.target.tagName;
    /* espacio sobre un botón enfocado debe activarlo, no bloquearse */
    if ((tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') &&
        (event.key === ' ' || event.key === 'Spacebar')) return;
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

    var state = 'idle'; // idle | forward | revealed | reverse
    var timer = 0;
    var cardsTimer = 0;
    var upPlayed = false;   // la reversa de esta sección ya corrió
    var top = 0;
    var height = 1;
    var bodyTop = 0;      // inicio de las cards: dispara el velo del video
    var headTop = 0;      // card de texto: sirve para medir sin forzar layout

    section.classList.add('is-armed');

    function measure() {
      /* la card de texto se coloca en la parte alta del video y las cards de la
         sección quedan justo debajo del pliegue: aparecen al hacer scroll */
      if (head && !section.classList.contains('is-static')) {
        head.style.marginTop = '0px';
        /* la portada del video es sticky: su rectángulo depende del scroll, así
           que la referencia es el inicio de la sección, no el stage */
        var scroll = window.scrollY;
        var sectionTop = section.getBoundingClientRect().top + scroll;
        var naturalHead = head.getBoundingClientRect().top + scroll;
        var goalHead = sectionTop + Math.max(40, Math.round(viewportH * 0.06));
        head.style.marginTop = Math.round(goalHead - naturalHead) + 'px';

        if (body) {
          body.style.marginTop = '0px';
        }
      }

      /* la sección debe medir exactamente una pantalla: si sobra contenido se
         encoge el bloque de cards (hasta 85%) y si falta se estira */
      if (body && !section.classList.contains('is-static')) {
        body.style.zoom = '';
        body.style.minHeight = '';
        var bodyH = body.getBoundingClientRect().height;
        var sectionH = section.getBoundingClientRect().height;
        var delta = viewportH - sectionH;

        if (bodyH > 0 && delta < -2) {
          var scale = (bodyH + delta) / bodyH;
          if (scale >= 0.85) {
            body.style.zoom = scale.toFixed(3);
            /* el zoom deja un residuo: se corrige con la altura ya medida */
            var rest = section.getBoundingClientRect().height - viewportH;
            if (Math.abs(rest) > 2) {
              var tuned = scale - rest / bodyH;
              if (tuned >= 0.85 && tuned < 1) body.style.zoom = tuned.toFixed(3);
            }
          }
        } else if (bodyH > 0 && delta > 2) {
          body.style.minHeight = (bodyH + delta) + 'px';
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
      measure();   // la portada ya tiene su alto final: se recalcula el encaje
      queue();
    }

    function settle() {
      state = 'idle';
      upPlayed = false;
      activate(null);
      reverse.pause();
      window.clearTimeout(cardsTimer);
      section.classList.remove('is-revealed', 'is-cards');
      content.classList.remove('is-revealed');
      if (forward.readyState >= 1) forward.currentTime = 0;
      unlock();
      queue();   // reevalúa por si el usuario ya está dentro de la sección
    }

    /* deja la escena como recién cargada (la usa la navegación por saltos) */
    function reset() {
      window.clearTimeout(timer);
      window.clearTimeout(cardsTimer);
      state = 'idle';
      upPlayed = false;
      activate(null);
      reverse.pause();
      section.classList.remove('is-revealed', 'is-cards', 'is-content');
      content.classList.remove('is-revealed');
      if (forward.readyState >= 1) forward.currentTime = 0;
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

    /* al terminar la reversa vuelve el fotograma de entrada del video */
    function endReverse() {
      if (state !== 'reverse') return;
      window.clearTimeout(timer);
      reverse.pause();
      state = 'forward';    // reveal() exige ese estado
      reveal();             // mismo ritmo que al bajar: texto y luego cards
      activate(null);
      /* se deja el video de avance en su primer frame, que es donde terminó la
         reversa: el cambio de fondo no se nota */
      if (forward.readyState >= 1) seekTo(forward, 0);
    }

    forward.addEventListener('ended', reveal);
    forward.addEventListener('error', function () {
      if (state === 'forward') reveal();
    });
    /* el contenido entra un poco antes del último frame: el fundido se
       solapa con el final del video y la llegada se siente menos cortada */
    forward.addEventListener('timeupdate', function () {
      if (state !== 'forward') return;
      var duration = forward.duration;
      if (!duration) return;
      if (forward.currentTime >= duration - 0.3) reveal();
    });
    reverse.addEventListener('ended', endReverse);
    reverse.addEventListener('error', endReverse);

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
      section.classList.add('is-revealed', 'is-cards');
      content.classList.add('is-revealed');
      prefetchReverse();
      measure();
    }

    /* subiendo: primero rebobina la escena y después entra el contenido, igual
       que al bajar (lo que cambia es el sentido del video) */
    function enterReverse() {
      if (state === 'reverse' || state === 'forward') return;
      var wasLoaded = !!reverse.getAttribute('data-loaded');
      loadVideo(reverse);
      state = 'reverse';
      upPlayed = true;
      window.clearTimeout(timer);
      window.clearTimeout(cardsTimer);
      section.classList.remove('is-revealed', 'is-cards');
      content.classList.remove('is-revealed');
      activate(null);
      lock();     // igual que al bajar: el scroll espera a que termine la escena

      var started = false;
      var run = function () {
        if (started || state !== 'reverse') return;
        started = true;
        activate(reverse);
        seekTo(reverse, 0);
        playSafe(reverse, endReverse);
      };
      if (reverse.readyState >= 2) {
        run();
      } else {
        /* si el archivo ya se había pedido pero quedó sin datos, se reintenta
           la descarga; y por si el navegador no avisa, arranca igual al rato */
        if (wasLoaded) reverse.load();
        reverse.addEventListener('canplay', run, { once: true });
        window.setTimeout(run, 600);
      }
      timer = window.setTimeout(endReverse, SAFETY_MS);
    }

    /* llegada desde la navegación del deck: la escena corre siempre, en los dos
       sentidos (al bajar avanza y al subir rebobina) */
    function arrive(dir) {
      if (reducedMotion.matches) return;
      if (dir > 0) {
        if (state === 'idle') playForward(0);
        return;
      }
      enterReverse();
    }

    function update(dir) {
      var y = window.scrollY;
      var rectTop = top - y;
      var rectBottom = rectTop + height;
      var jumping = Date.now() < jumpUntil;

      /* La escena sólo la dispara la navegación (flechas y puntos). El scroll
         únicamente recorre el contenido de la sección: nunca anima ni cambia
         de sección. La única excepción es la carga inicial o un enlace directo,
         donde la sección ya está arriba y sin animar. */
      if (!jumping && state === 'idle' && rectTop <= 1 && rectBottom > 0 && (dir > 0 || y <= 1)) {
        if (-rectTop <= rewindLimit) playForward(0);
        else skipScene();
      }
      /* al alejarse hacia arriba, la sección vuelve a quedar lista para la bajada */
      if (!jumping && state === 'revealed' && upPlayed && dir < 0 && rectTop > viewportH - 40) settle();
    }

    return {
      el: section,
      update: update,
      measure: measure,
      skip: skipScene,
      reset: reset,
      arrive: arrive,
      goStatic: function () {
        window.clearTimeout(timer);
        window.clearTimeout(cardsTimer);
        state = 'revealed';
        if (head) head.style.marginTop = '';   // en estático manda la hoja de estilos
        section.classList.add('is-static', 'is-revealed', 'is-cards');
        content.classList.add('is-revealed');
        activate(null);
      }
    };
  }

  /* Portada (escena 1): no es [data-seq], pero al subir desde Planes se rebobina
     su propio video y después entra el contenido, igual que en las secciones. */
  function createHero(section) {
    var forward = section.querySelector('[data-scene-forward]');
    var reverse = section.querySelector('[data-scene-reverse]');
    var content = section.querySelector('[data-scene-content]');
    if (!forward || !reverse || !content) return null;

    var state = 'shown';   // shown | hidden | reversing
    var timer = 0;
    var primed = false;

    function prime() {
      if (primed) return;
      primed = true;
      if (reverse.getAttribute('data-loaded')) return;
      reverse.setAttribute('data-loaded', '1');
      reverse.load();
    }

    /* la portada queda lista para rebobinarse en cuanto sale de pantalla */
    function hide() {
      window.clearTimeout(timer);
      reverse.pause();
      reverse.classList.remove('is-active');
      section.classList.remove('is-revealed');
      content.classList.remove('is-revealed');
      state = 'hidden';
      prime();
    }

    function endReverse() {
      if (state !== 'reversing') return;
      window.clearTimeout(timer);
      reverse.pause();
      reverse.classList.remove('is-active');
      /* el avance queda en su primer frame: es el último de la reversa */
      if (forward.readyState >= 1) seekTo(forward, 0);
      section.classList.add('is-revealed');
      content.classList.add('is-revealed');
      state = 'shown';
      timer = window.setTimeout(unlock, RELEASE_MS);
    }

    function playReverse() {
      if (state === 'reversing') return;
      prime();
      state = 'reversing';
      window.clearTimeout(timer);
      section.classList.remove('is-revealed');
      content.classList.remove('is-revealed');
      lock();

      var started = false;
      var run = function () {
        if (started || state !== 'reversing') return;
        started = true;
        forward.pause();
        reverse.classList.add('is-active');
        seekTo(reverse, 0);
        playSafe(reverse, endReverse);
      };
      if (reverse.readyState >= 2) {
        run();
      } else {
        reverse.addEventListener('canplay', run, { once: true });
        window.setTimeout(run, 600);
      }
      timer = window.setTimeout(endReverse, SAFETY_MS);
    }

    reverse.addEventListener('ended', endReverse);
    reverse.addEventListener('error', endReverse);

    return {
      el: section,
      update: function () {
        if (reducedMotion.matches) return;
        if (state === 'shown' && section.getBoundingClientRect().bottom <= 1) hide();
      },
      arrive: function (dir) {
        if (reducedMotion.matches) return;
        if (dir < 0 && state === 'hidden') playReverse();
      }
    };
  }

  function queue() {
    onScroll();
  }

  function measureAll() {
    viewportH = window.innerHeight;
    rewindLimit = Math.max(220, Math.round(viewportH * 0.42));
    instances.forEach(function (instance) { instance.measure(); });
  }

  function updateAll() {
    var y = window.scrollY;
    if (y !== lastY) direction = y > lastY ? 1 : -1;
    lastY = y;
    for (var i = 0; i < instances.length; i++) instances[i].update(direction);
    if (hero) hero.update();
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
  var hero = heroSection ? createHero(heroSection) : null;

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

  /* la navegación por puntos y flechas avisa al terminar un salto: las escenas
     que quedaron fuera de pantalla vuelven a quedar listas para animarse */
  document.addEventListener('seqreset', function () {
    instances.forEach(function (instance) {
      var box = instance.el.getBoundingClientRect();
      if (box.top > viewportH - 40 || box.bottom < 40) instance.reset();
    });
  });

  /* la navegación por saltos avisa a la escena de destino: así el video corre
     también al subir entre secciones (antes sólo reaccionaba a la bajada) */
  document.addEventListener('seqarrive', function (event) {
    var detail = event.detail || {};
    if (!detail.id) return;
    for (var i = 0; i < instances.length; i++) {
      if (instances[i].el.id === detail.id) {
        instances[i].arrive(detail.dir);
        return;
      }
    }
    if (hero && hero.el.id === detail.id) hero.arrive(detail.dir);
  });

  /* la navegación por saltos avisa la dirección real del desplazamiento:
     el scroll sintético no cambia la posición y por eso no la deduce sola */
  document.addEventListener('seqmove', function (event) {
    var detail = event.detail || {};
    lastY = window.scrollY;
    if (detail.dir) direction = detail.dir < 0 ? -1 : 1;
    queue();
  });

  /* la navegación por ancla o teclas End/Home: la secuencia no debe frenar el salto */
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