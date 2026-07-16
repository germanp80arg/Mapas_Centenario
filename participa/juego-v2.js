(() => {
  'use strict';

  const TOTAL = 300;
  const costos = { semaforo: 40, cruce: 20, parada_nueva: 25, parada_mejora: 10 };
  const nombres = {
    semaforo: 'Semáforo',
    cruce: 'Cruce peatonal elevado',
    bicisenda: 'Bicisenda',
    parada_nueva: 'Nueva parada de colectivo',
    parada_mejora: 'Mejora de parada de colectivo'
  };
  const iconos = { semaforo: '🚦', cruce: '🚸', bicisenda: '🚲', parada_nueva: '🚌', parada_mejora: '🛠️' };

  let saldo = TOTAL;
  let seleccion = null;
  let intervenciones = [];
  let vertices = [];
  let lineaTemporal = null;
  let propuesta = null;

  const mapa = L.map('mapa').setView([-38.829, -68.132], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapa);

  const capas = {
    siniestros: L.layerGroup().addTo(mapa),
    semaforos: L.layerGroup().addTo(mapa),
    paradas: L.layerGroup().addTo(mapa),
    propuestas: L.layerGroup().addTo(mapa)
  };

  L.control.layers(null, {
    'Siniestros registrados': capas.siniestros,
    'Semáforos existentes': capas.semaforos,
    'Paradas existentes': capas.paradas,
    'Mi propuesta': capas.propuestas
  }, { collapsed: false }).addTo(mapa);

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function emoji(valor, clase = '') {
    return L.divIcon({
      className: `marcador-emoji ${clase}`,
      html: `<span style="font-size:25px">${valor}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function cargarDatos() {
    if (typeof json_Siniestrosmayo2025aabril2026_6 !== 'undefined') {
      L.geoJSON(json_Siniestrosmayo2025aabril2026_6, {
        pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 5, color: '#7f1d1d', weight: 1, fillColor: '#ef4444', fillOpacity: .72 }),
        onEachFeature: (f, l) => {
          const p = f.properties || {};
          l.bindPopup(`<strong>${esc(p.tipo || 'Siniestro')}</strong><br>${esc(p.ubicacion || '')}<br><small>${esc(p.fecha || '')} ${esc(p.hora || '')}</small>`);
        }
      }).addTo(capas.siniestros);
    }
    if (typeof json_semaforos_cente_2 !== 'undefined') {
      L.geoJSON(json_semaforos_cente_2, {
        pointToLayer: (_f, ll) => L.marker(ll, { icon: emoji('🚦', 'existente') }),
        onEachFeature: (_f, l) => l.bindPopup('<strong>Semáforo existente</strong>')
      }).addTo(capas.semaforos);
    }
    if (typeof json_paradas_bondi_3 !== 'undefined') {
      L.geoJSON(json_paradas_bondi_3, {
        pointToLayer: (_f, ll) => L.marker(ll, { icon: emoji('🚌', 'existente') }),
        onEachFeature: (f, l) => l.bindPopup(`<strong>${esc((f.properties || {}).name || 'Parada existente')}</strong>`)
      }).addTo(capas.paradas);
    }
  }

  function idNuevo() {
    return (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function distancia(a, b) {
    const R = 6371000;
    const rad = g => g * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function longitud() {
    let total = 0;
    for (let i = 1; i < vertices.length; i++) total += distancia(vertices[i - 1], vertices[i]);
    return total;
  }

  function costoBicisenda(metros) {
    return metros > 0 ? Math.ceil(metros / 100) * 40 : 0;
  }

  function actualizar() {
    const gastado = TOTAL - saldo;
    document.getElementById('saldo').textContent = saldo;
    document.getElementById('gastado').textContent = gastado;
    document.getElementById('barra-gasto').style.width = `${(gastado / TOTAL) * 100}%`;
    const lista = document.getElementById('lista-propuestas');
    if (!intervenciones.length) {
      lista.className = 'lista-vacia';
      lista.textContent = 'Todavía no agregaste intervenciones.';
    } else {
      lista.className = 'lista-propuestas';
      lista.innerHTML = intervenciones.map((x, i) => `<article style="display:grid;grid-template-columns:25px 1fr 32px;gap:7px;align-items:center;padding:8px 0;border-bottom:1px solid #ddd"><span>${i + 1}</span><div><strong>${iconos[x.tipo]} ${esc(x.nombre)}</strong><br><small>${x.longitud_m ? x.longitud_m + ' m · ' : ''}${x.costo} CENTEcoins</small></div><button type="button" data-borrar="${x.id}">×</button></article>`).join('');
      lista.querySelectorAll('[data-borrar]').forEach(b => b.onclick = () => borrar(b.dataset.borrar));
    }
    propuesta = null;
    document.getElementById('descargar-json').disabled = true;
    document.getElementById('descargar-geojson').disabled = true;
  }

  function limpiarTrazado() {
    vertices = [];
    if (lineaTemporal) mapa.removeLayer(lineaTemporal);
    lineaTemporal = null;
    document.getElementById('acciones-linea').hidden = true;
    document.getElementById('estimacion-linea').textContent = 'Longitud: 0 m · Costo estimado: 0';
  }

  function activar(boton) {
    document.querySelectorAll('#herramientas button').forEach(b => b.classList.remove('activo', 'activa'));
    boton.classList.add('activo', 'activa');
    limpiarTrazado();
    seleccion = { tipo: boton.dataset.tipo, modo: boton.dataset.modo };
    if (seleccion.modo === 'linea') {
      document.getElementById('acciones-linea').hidden = false;
      document.getElementById('instruccion').textContent = 'Hacé varios clics sobre el mapa para marcar el recorrido y luego finalizá la bicisenda.';
    } else {
      document.getElementById('instruccion').textContent = `Hacé clic sobre el mapa para colocar: ${nombres[seleccion.tipo]}.`;
    }
  }

  function agregarPunto(ll) {
    const tipo = seleccion.tipo;
    const costo = costos[tipo];
    if (saldo < costo) return alert('No tenés suficientes CENTEcoins.');
    const capa = L.marker(ll, { icon: emoji(iconos[tipo], 'propuesta') }).addTo(capas.propuestas);
    const item = { id: idNuevo(), tipo, nombre: nombres[tipo], costo, geometria: { type: 'Point', coordinates: [ll.lng, ll.lat] }, capa };
    capa.bindPopup(`<strong>${esc(item.nombre)}</strong><br>${costo} CENTEcoins`);
    intervenciones.push(item);
    saldo -= costo;
    actualizar();
  }

  function agregarVertice(ll) {
    vertices.push(ll);
    if (lineaTemporal) mapa.removeLayer(lineaTemporal);
    lineaTemporal = L.polyline(vertices, { color: '#2a9d8f', weight: 5, dashArray: '8 6' }).addTo(mapa);
    const m = longitud();
    document.getElementById('estimacion-linea').textContent = `Longitud: ${Math.round(m)} m · Costo estimado: ${costoBicisenda(m)} CENTEcoins`;
  }

  function finalizarLinea() {
    if (vertices.length < 2) return alert('Marcá al menos dos puntos.');
    const metros = longitud();
    const costo = costoBicisenda(metros);
    if (saldo < costo) return alert(`Ese recorrido cuesta ${costo} CENTEcoins y solamente te quedan ${saldo}.`);
    if (lineaTemporal) mapa.removeLayer(lineaTemporal);
    const coords = vertices.map(p => [p.lat, p.lng]);
    const capa = L.polyline(coords, { color: '#2a9d8f', weight: 6 }).addTo(capas.propuestas);
    intervenciones.push({ id: idNuevo(), tipo: 'bicisenda', nombre: nombres.bicisenda, costo, longitud_m: Math.round(metros), geometria: { type: 'LineString', coordinates: vertices.map(p => [p.lng, p.lat]) }, capa });
    saldo -= costo;
    limpiarTrazado();
    seleccion = null;
    document.querySelectorAll('#herramientas button').forEach(b => b.classList.remove('activo', 'activa'));
    document.getElementById('instruccion').textContent = 'Elegí una intervención para continuar.';
    actualizar();
  }

  function borrar(id) {
    const i = intervenciones.findIndex(x => x.id === id);
    if (i < 0) return;
    const [x] = intervenciones.splice(i, 1);
    capas.propuestas.removeLayer(x.capa);
    saldo += x.costo;
    actualizar();
  }

  function reiniciar() {
    if (intervenciones.length && !confirm('¿Querés borrar todas las intervenciones?')) return;
    capas.propuestas.clearLayers();
    intervenciones = [];
    saldo = TOTAL;
    seleccion = null;
    limpiarTrazado();
    document.querySelectorAll('#herramientas button').forEach(b => b.classList.remove('activo', 'activa'));
    actualizar();
  }

  function preparar(e) {
    e.preventDefault();
    if (!intervenciones.length) return alert('Agregá al menos una intervención.');
    const motivos = [...document.querySelectorAll('input[name="motivo"]:checked')].map(x => x.value);
    if (!motivos.length) return alert('Seleccioná al menos un motivo de desplazamiento.');
    propuesta = {
      id_participacion: `CENTE-${Date.now()}`,
      fecha_hora: new Date().toISOString(),
      version: 'prototipo-0.2',
      datos_participante: {
        esquina_proxima: document.getElementById('esquina').value.trim(),
        edad: Number(document.getElementById('edad').value),
        sexo_identidad: document.getElementById('sexo').value,
        movilidad_frecuente: document.getElementById('movilidad').value,
        motivos,
        justificacion: document.getElementById('justificacion').value.trim()
      },
      presupuesto_inicial: TOTAL,
      presupuesto_utilizado: TOTAL - saldo,
      presupuesto_restante: saldo,
      intervenciones: intervenciones.map(({ capa, ...x }, i) => ({ ...x, orden: i + 1 }))
    };
    localStorage.setItem('centecoin_ultima_propuesta', JSON.stringify(propuesta));
    document.getElementById('descargar-json').disabled = false;
    document.getElementById('descargar-geojson').disabled = false;
    const r = document.getElementById('resultado');
    r.hidden = false;
    r.innerHTML = `<strong>Propuesta preparada.</strong> Usaste ${TOTAL - saldo} CENTEcoins en ${intervenciones.length} intervenciones.`;
  }

  function descargar(nombre, texto, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.querySelectorAll('#herramientas button').forEach(b => b.addEventListener('click', () => activar(b)));
  document.getElementById('finalizar-linea').addEventListener('click', finalizarLinea);
  document.getElementById('cancelar-linea').addEventListener('click', () => { limpiarTrazado(); seleccion = null; });
  document.getElementById('deshacer').addEventListener('click', () => { const x = intervenciones.at(-1); if (x) borrar(x.id); });
  document.getElementById('reiniciar').addEventListener('click', reiniciar);
  document.getElementById('form-participacion').addEventListener('submit', preparar);
  document.getElementById('descargar-json').addEventListener('click', () => propuesta && descargar(`${propuesta.id_participacion}.json`, JSON.stringify(propuesta, null, 2), 'application/json'));
  document.getElementById('descargar-geojson').addEventListener('click', () => {
    if (!propuesta) return;
    const geo = { type: 'FeatureCollection', features: propuesta.intervenciones.map(x => ({ type: 'Feature', properties: { id_participacion: propuesta.id_participacion, tipo: x.tipo, nombre: x.nombre, costo: x.costo, longitud_m: x.longitud_m || null, orden: x.orden }, geometry: x.geometria })) };
    descargar(`${propuesta.id_participacion}.geojson`, JSON.stringify(geo, null, 2), 'application/geo+json');
  });

  mapa.on('click', e => {
    if (!seleccion) return;
    if (seleccion.modo === 'punto') agregarPunto(e.latlng);
    else agregarVertice(e.latlng);
  });

  cargarDatos();
  actualizar();
})();