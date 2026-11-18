/**
 * Cotizador · Propuesta E-commerce Motos y Partes de Occidente
 * Precio = plan base + (sedes - 1) × sede adicional + módulo de IA.
 * Sin dependencias.
 */
(function () {
  'use strict';

  var PLANES = {
    esencial:   { n: 'Esencial',   base: 2800000, mkt: [12000000, 18000000] },
    intermedio: { n: 'Intermedio', base: 3800000, mkt: [15000000, 22000000] },
    elite:      { n: 'Élite',      base: 5000000, mkt: [20000000, 30000000] }
  };
  var SEDE = 1000000;              // cada sede después de la primera
  var IA_LISTA = 5900000;          // valor real del módulo de IA
  var IA_BUNDLE = 1000000;         // descuento extra por integrar la IA al plan
  var PILOTOS = {
    a: { pct: 25, precio: 4425000 },
    b: { pct: 30, precio: 4130000 },
    c: { pct: 35, precio: 3835000 }
  };
  var PILOTO_TEXTO = {
    a: 'Caso de estudio con métricas publicables · 3 sesiones de feedback · garantía de 90 días · firma dentro de la vigencia.',
    b: 'Todo lo del Piloto A · pago 40% al inicio, 30% en la revisión de mitad de proyecto y 30% contra entrega.',
    c: 'Todo lo del Piloto B · pago 50% al inicio y 50% contra entrega · calendario de insumos y validaciones en 48 h. Si el proyecto se retrasa por falta de insumos, el descuento vuelve a −25%.'
  };
  var MKT_IA = [7000000, 15000000];
  var SEDE_PCT = [0.45, 0.75];     // el mercado cobra +45% a +75% por sede
  var INFRA_SEDE = 110559;         // Vercel + Neon + dominio año 1, por sede
  var WA = '573177366474';
  var MAX_SEDES = 6;

  var root = document.getElementById('pickPlan');
  var pilotRoot = document.getElementById('pickPiloto');
  var pilotHint = document.getElementById('pilotHint');
  var selSedes = document.getElementById('calcSedes');
  var btnIa = document.getElementById('calcIa');
  var title = document.getElementById('crTitle');
  var totalEl = document.getElementById('crTotal');
  var linesEl = document.getElementById('crLines');
  var monthlyEl = document.getElementById('crMonthly');
  var infraEl = document.getElementById('crInfra');
  var marketEl = document.getElementById('crMarket');
  var ctaEl = document.getElementById('crCta');
  if (!root || !selSedes || !btnIa || !totalEl) return;

  var steps = document.querySelectorAll('.calc-controls .step');
  var state = { plan: 'esencial', sedes: 1, ia: false, piloto: 'a' };

  var nf = new Intl.NumberFormat('es-CO');

  function money(value) {
    return '$' + nf.format(Math.round(value / 1000) * 1000);
  }

  function plural(count, one, many) {
    return count === 1 ? one : many;
  }

  function render() {
    var plan = PLANES[state.plan];
    var piloto = PILOTOS[state.piloto];
    var extraSedes = state.sedes - 1;
    var iaFinal = piloto.precio - IA_BUNDLE;
    var total = plan.base + extraSedes * SEDE + (state.ia ? iaFinal : 0);
    var nombre = state.plan === 'elite' && state.ia ? 'Agéntico' : plan.n;

    title.textContent = 'Plan ' + nombre + ' · ' + state.sedes + ' ' + plural(state.sedes, 'sede', 'sedes');
    totalEl.textContent = nf.format(total);

    var lines = '<li><span>Plan ' + plan.n + ' (1 sede)</span><b>' + money(plan.base) + '</b></li>';
    if (extraSedes > 0) {
      lines += '<li><span>' + extraSedes + ' ' + plural(extraSedes, 'sede adicional', 'sedes adicionales') +
        '</span><b>' + money(extraSedes * SEDE) + '</b></li>';
    }
    if (state.ia) {
      lines += '<li><span>Módulo de IA (valor real)</span><b>' + money(IA_LISTA) + '</b></li>';
      lines += '<li class="discount"><span>Piloto ' + state.piloto.toUpperCase() + ' · −' + piloto.pct +
        '% de implementación</span><b>−' + money(IA_LISTA - piloto.precio) + '</b></li>';
      lines += '<li class="discount"><span>Descuento por integrar la IA a tu plan</span><b>−' +
        money(IA_BUNDLE) + '</b></li>';
    }
    linesEl.innerHTML = lines;

    monthlyEl.textContent = state.ia ? '$550.000 / mes' : '$200.000 – $450.000';

    var infra = Math.round((state.sedes * INFRA_SEDE) / 1000) * 1000;
    infraEl.textContent = '≈ ' + money(infra) + ' / mes';

    var mktMin = plan.mkt[0] * (1 + extraSedes * SEDE_PCT[0]) + (state.ia ? MKT_IA[0] : 0);
    var mktMax = plan.mkt[1] * (1 + extraSedes * SEDE_PCT[1]) + (state.ia ? MKT_IA[1] : 0);
    var ahorro = Math.round((1 - total / mktMax) * 100);
    marketEl.innerHTML = 'Equivale a <strong>' + money(mktMin) + ' – ' + money(mktMax) +
      '</strong> en el mercado <span>(−' + ahorro + '%)</span>';

    var texto = 'Hola, quiero cotizar el Plan ' + nombre + ' con ' + state.sedes + ' ' +
      plural(state.sedes, 'sede', 'sedes') + (state.ia ? ' y módulo de IA (Piloto ' + state.piloto.toUpperCase() + ')' : '') +
      '. Total estimado: ' + money(total) + '.';
    ctaEl.href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(texto);

    Array.prototype.forEach.call(root.querySelectorAll('.pick'), function (btn) {
      var on = btn.getAttribute('data-plan') === state.plan;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    selSedes.value = String(state.sedes);
    btnIa.setAttribute('aria-checked', state.ia ? 'true' : 'false');
    btnIa.classList.toggle('is-on', state.ia);

    if (pilotRoot) {
      Array.prototype.forEach.call(pilotRoot.querySelectorAll('.pick'), function (btn) {
        var on = btn.getAttribute('data-piloto') === state.piloto;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      pilotRoot.classList.toggle('is-muted', !state.ia);
      if (pilotHint) {
        pilotHint.innerHTML = state.ia
          ? '<strong>Piloto ' + state.piloto.toUpperCase() + '</strong> · ' + PILOTO_TEXTO[state.piloto] +
            ' <span class="hint-bundle">Además, −$1.000.000 por integrar la IA a tu plan.</span>'
          : 'Aplica solo si activas el módulo de IA. El piloto va del 25% al 35%, más $1.000.000 por integrarlo a tu plan.';
      }
    }
  }

  root.addEventListener('click', function (event) {
    var btn = event.target.closest('.pick');
    if (!btn) return;
    state.plan = btn.getAttribute('data-plan');
    render();
  });

  selSedes.addEventListener('change', function () {
    state.sedes = Math.min(MAX_SEDES, Math.max(1, parseInt(selSedes.value, 10) || 1));
    render();
  });

  Array.prototype.forEach.call(steps, function (btn) {
    btn.addEventListener('click', function () {
      var delta = parseInt(btn.getAttribute('data-step'), 10);
      state.sedes = Math.min(MAX_SEDES, Math.max(1, state.sedes + delta));
      render();
    });
  });

  btnIa.addEventListener('click', function () {
    state.ia = !state.ia;
    render();
  });

  if (pilotRoot) {
    pilotRoot.addEventListener('click', function (event) {
      var btn = event.target.closest('.pick');
      if (!btn) return;
      state.piloto = btn.getAttribute('data-piloto');
      render();
    });
  }

  render();
})();
