/**
 * Escena 1 (portada): el video arranca solo al cargar la página, mudo y en línea.
 * Al terminar aparecen los elementos y la escena queda fija, sin bloquear el scroll.
 */
(function () {
  'use strict';

  var section = document.querySelector('[data-scene]');
  if (!section) return;

  var forward = section.querySelector('[data-scene-forward]');
  var content = section.querySelector('[data-scene-content]');
  var hint = section.querySelector('[data-scene-hint]');
  if (!forward || !content) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SOURCE_TYPES = [['mp4', 'video/mp4'], ['webm', 'video/webm']];
  var SAFETY_MS = 2400;   // si el video no arranca, se muestra el contenido igual
  var EARLY_MS = 120;     // el texto entra un pelo antes de que el video termine

  var done = false;
  var timer = 0;
  var counters = section.querySelectorAll('[data-count]');

  /* los números de la portada suben hasta su valor final */
  function runCounters() {
    if (!counters.length || reducedMotion.matches) return;
    var duration = 1100;
    var origin = 0;
    var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
    Array.prototype.forEach.call(counters, function (el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
      if (isNaN(target)) return;
      var format = function (value) {
        return decimals ? value.toFixed(decimals) : String(Math.round(value));
      };
      el.textContent = format(0);
      var step = function (now) {
        if (!origin) origin = now;
        var t = Math.min(1, (now - origin) / duration);
        el.textContent = format(target * ease(t));
        if (t < 1) window.requestAnimationFrame(step);
        else el.textContent = format(target);
      };
      window.requestAnimationFrame(step);
    });
  }

  function loadVideo() {
    if (forward.getAttribute('data-loaded')) return;
    forward.setAttribute('data-loaded', '1');
    if (forward.querySelector('source') || forward.getAttribute('src')) {
      forward.load();
      return;
    }
    SOURCE_TYPES.forEach(function (pair) {
      var url = forward.getAttribute('data-src-' + pair[0]);
      if (!url) return;
      var source = document.createElement('source');
      source.src = url;
      source.type = pair[1];
      forward.appendChild(source);
    });
    forward.load();
  }

  function hideHint() {
    if (hint) hint.classList.add('is-hidden');
  }

  function reveal() {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    section.classList.add('is-revealed');
    content.classList.add('is-revealed');
    hideHint();
    runCounters();
    document.dispatchEvent(new CustomEvent('herorevealed'));
  }

  function goStatic() {
    section.classList.add('is-static', 'is-revealed');
    content.classList.add('is-revealed');
    hideHint();
    document.dispatchEvent(new CustomEvent('herorevealed'));
  }

  function autoplay() {
    loadVideo();
    forward.classList.add('is-active');
    var promise = forward.play();
    if (promise && promise.catch) {
      promise.catch(function () {
        /* si el navegador bloquea la reproducción, la portada igual se ve */
        reveal();
      });
    }
    timer = window.setTimeout(reveal, SAFETY_MS);
  }

  forward.addEventListener('ended', reveal);
  forward.addEventListener('error', reveal);
  forward.addEventListener('timeupdate', function () {
    if (done) return;
    var duration = forward.duration;
    if (!duration) return;
    if (forward.currentTime * 1000 >= duration * 1000 - EARLY_MS) reveal();
  });

  function start() {
    if (window.scrollY > 4) {
      /* recarga a mitad de página: la portada ya no debe animarse */
      done = true;
      section.classList.add('is-revealed');
      content.classList.add('is-revealed');
      hideHint();
      runCounters();
      document.dispatchEvent(new CustomEvent('herorevealed'));
      return;
    }
    autoplay();
  }

  if (reducedMotion.matches) {
    done = true;
    goStatic();
    return;
  }

  /* la escena arranca cuando la pantalla de carga se retira: así la animación
     no se consume detrás del overlay */
  if (document.documentElement.classList.contains('is-loading') && !window.__loaderDone) {
    document.addEventListener('loaderdone', start, { once: true });
    window.setTimeout(function () {
      if (!done && !forward.getAttribute('data-loaded')) start();
    }, 12000);
  } else {
    start();
  }

  var onMotionChange = function (event) {
    if (!event.matches) return;
    done = true;
    window.clearTimeout(timer);
    if (forward.pause) forward.pause();
    goStatic();
  };
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
  else if (reducedMotion.addListener) reducedMotion.addListener(onMotionChange);
})();