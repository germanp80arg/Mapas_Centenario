(() => {
  'use strict';

  const PRESUPUESTO_TOTAL = 300;
  const COSTOS = {
    semaforo: 40,
    cruce: 20,
    parada_nueva: 25,
    parada_mejora: 10
  };

  const NOMBRES = {
    semaforo: 'Semáforo',
    cruce: 'Cruce peatonal elevado',
    bicisenda: 'Bicisenda',
    parada_nueva: 'Nueva parada de colectivo',
    parada_mejora: 'Mejora de parada de colectivo'
  };

  const ICONOS = {
    semaforo: '🚦',
    cruce: '🚸',
    bicisenda: '🚲',
    parada_nueva: '🚌',
    parada_mejora: '🛠️'
  };

  const COLORES = {
    semaforo: '#d62828',
    cruce: '#f4a261',
    bicisenda: '#2a9d8f',
    parada_nueva: '#264653',
    parada_mejora: '#6a4c93'
  };

  let saldo = PRESUPUESTO_TOTAL;
  let tipoActivo = null;
  let modoActivo = null;
  let intervenciones = [];
  let verticesBicisenda = [];
  let capaBicisendaTemporal = null;
  let propuestaPreparada = null;

  const mapa = L.map('mapa', { zoomControl: true }).setView([-38.829, -68.132], 14);

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

  const controlCapas = L.control.layers(null, {
    'Siniestros registrados': capas.siniestros,
    'Semáforos existentes': capas.semaforos,
    'Paradas existentes': capas.paradas,
    'Mi propuesta': capas.propuestas
  }, { collapsed: false }).addTo(mapa);

  function escapar(texto) {
    return String(texto ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function iconoEmoji(emoji, clase = '') {
    return L.divIcon({
      className: `marcador-emoji ${clase}`,
      html: `<span>${emoji}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18]
    });
  }

  function cargarCapasBase() {
    if (typeof json_Siniestrosmayo2025aabril2026_6 !== 'undefined') {
      L.geoJSON(json_Siniestrosmayo2025aabril2026_6, {
        pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
          radius: 5,
          color: '#7f1d1d',
          weight: 1,
          fillColor: '#ef4444',
          fillOpacity: 0.72
        }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {};
          layer.bindPopup(`
            <strong>${escapar(p.tipo || 'Siniestro')}</strong><br>
            ${escapar(p.ubicacion || 'Ubicación sin dato')}<br>
            <small>${escapar(p.fecha || '')} ${escapar(p.hora || '')}</small>
          `);
        }
      }).addTo(capas.siniestros);
    }

    if (typeof json_semaforos_cente_2 !== 'undefined') {
      L.geoJSON(json_semaforos_cente_2, {
        pointToLayer: (_f, latlng) => L.marker(latlng, { icon: iconoEmoji('🚦', 'existente') }),
        onEachFeature: (_feature, layer) => layer.bindPopup('<strong>Semáforo existente</strong><br><small>Dato de OpenStreetMap</small>')
      }).addTo(capas.semaforos);
    }

    if (typeof json_paradas_bondi_3 !== 'undefined') {
      L.geoJSON(json_paradas_bondi_3, {
        pointToLayer: (_f, latlng) => L.marker(latlng, { icon: iconoEmoji('🚌', 'existente') }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {};
          layer.bindPopup(`<strong>${escapar(p.name || 'Parada existente')}</strong><br><small>Dato de OpenStreetMap</small>`);
        }
      }).addTo(capas.paradas);
    }
  }

  function distanciaMetros(a, b) {
    const R = 6371000;
    const rad = grados => grados * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lng - a.lng);
    const lat1 = rad(a.lat);
    const lat2 = rad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function longitudTotal(vertices) {
    return vertices.slice(1).reduce((total, punto, indice) => total + distanciaMetros(vertices[indice], punto), 0);
  }

  function costoBicisenda(longitud) {
    if (longitud <= 0) return 0;
    return Math.ceil(longitud / 100) * 40;
  }

  function actualizarPresupuesto() {
    const gastado = PRESUPUESTO_TOTAL - saldo;
    document.getElementById('saldo').textContent = saldo;
    document.getElementById('gastado').textContent = gastado;
    document.getElementById('barra-gasto').style.width = `${Math.min(100, (gastado / PRESUPUESTO_TOTAL) * 100)}%`;
  }

  function seleccionarHerramienta(boton) {
    document.querySelectorAll('#herramientas button').forEach(b => b.classList.remove('activo'));
    boton.classList.add('activo');
    tipoActivo = boton.dataset.tipo;
    modoActivo = boton.dataset.modo;

    if (modoActivo === 'linea') {
      verticesBicisenda = [];
      document.getElementById('acciones-linea').hidden = false;
      document.getElementById('instruccion').textContent = 'Hacé clic sobre el mapa para marcar el recorrido. Luego finalizá la bicisenda.';
      actualizarEstimacionLinea();
    } else {
      cancelarLinea(false);
      document.getElementById('instruccion').textContent = `Hacé clic sobre el mapa para colocar: ${NOMBRES[tipoActivo]}.`;
    }
  }

  function agregarPunto(latlng) {
    const costo = COSTOS[tipoActivo];
    if (saldo < costo) {
      alert('No tenés suficientes CENTEcoins para esta intervención.');
      return;
    }

    const marcador = L.marker(latlng, { icon: iconoEmoji(ICONOS[tipoActivo], 'propuesta') }).addTo(capas.propuestas);
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      tipo: tipoActivo,
      nombre: NOMBRES[tipoActivo],
      costo,
      geometria: { type: 'Point', coordinates: [latlng.lng, latlng.lat] },
      capa: marcador
    };
    marcador.bindPopup(`<strong>${escapar(item.nombre)}</strong><br>${costo} CENTEcoins`);
    intervenciones.push(item);
    saldo -= costo;
    actualizarTodo();
  }

  function agregarVerticeBicisenda(latlng) {
    verticesBicisenda.push(latlng);
    if (capaBicisendaTemporal) mapa.removeLayer(capaBicisendaTemporal);
    capaBicisendaTemporal = L.polyline(verticesBicisenda, {
      color: COLORES.bicisenda,
      weight: 5,
      dashArray: '8 6'
    }).addTo(mapa);
    actualizarEstimacionLinea();
  }

  function actualizarEstimacionLinea() {
    const longitud = longitudTotal(verticesBicisenda);
    const costo = costoBicisenda(longitud);
    document.getElementById('estimacion-linea').textContent = `Longitud: ${Math.round(longitud)} m · Costo estimado: ${costo} CENTEcoins`;
  }

  function finalizarBicisenda() {
    if (verticesBicisenda.length < 2) {
      alert('Marcá al menos dos puntos para definir el recorrido.');
      return;
    }
    const longitud = longitudTotal(verticesBicisenda);
    const costo = costoBicisenda(longitud);
    if (saldo < costo) {
      alert(`Ese recorrido cuesta ${costo} CENTEcoins y tu saldo es ${saldo}. Acortá el trazado.`);
      return;
    }

    if (capaBicisendaTemporal) mapa.removeLayer(capaBicisendaTemporal);
    const vertices = verticesBicisenda.map(p => [p.lat, p.lng]);
    const linea = L.polyline(vertices, { color: COLORES.bicisenda, weight: 6 }).addTo(capas.propuestas);
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      tipo: 'bicisenda',
      nombre: NOMBRES.bicisenda,
      costo,
      longitud_m: Math.round(longitud),
      geometria: { type: 'LineString', coordinates: verticesBicisenda.map(p => [p.lng, p.lat]) },
      capa: linea
    };
    linea.bindPopup(`<strong>Bicisenda propuesta</strong><br>${item.longitud_m} m · ${costo} CENTEcoins`);
    intervenciones.push(item);
    saldo -= costo;
    cancelarLinea(true);
    actualizarTodo();
  }

  function cancelarLinea(mantenerSeleccion = false) {
    verticesBicisenda = [];
    if (capaBicisendaTemporal) {
      mapa.removeLayer(capaBicisendaTemporal);
      capaBicisendaTemporal = null;
    }
    document.getElementById('acciones-linea').hidden = true;
    if (!mantenerSeleccion) {
      tipoActivo = null;
      modoActivo = null;
      document.querySelectorAll('#herramientas button').forEach(b => b.classList.remove('activo'));
      document.getElementById('instruccion').textContent = 'Elegí una intervención para comenzar.';
    }
  }

  function eliminarIntervencion(id) {
    const indice = intervenciones.findIndex(i => i.id === id);
    if (indice < 0) return;
    const [item] = intervenciones.splice(indice, 1);
    capas.propuestas.removeLayer(item.capa);
    saldo += item.costo;
    actualizarTodo();
  }

  function renderLista() {
    const contenedor = document.getElementById('lista-propuestas');
    if (!intervenciones.length) {
      contenedor.className = 'lista-vacia';
      contenedor.textContent = 'Todavía no agregaste intervenciones.';
      return;
    }
    contenedor.className = 'lista-propuestas';
    contenedor.innerHTML = intervenciones.map((item, indice) => `
      <article>
        <span class="numero">${indice + 1}</span>
        <div><strong>${ICONOS[item.tipo]} ${escapar(item.nombre)}</strong><small>${item.longitud_m ? `${item.longitud_m} m · ` : ''}${item.costo} CENTEcoins</small></div>
        <button type="button" data-eliminar="${item.id}" aria-label="Eliminar intervención">×</button>
      </article>
    `).join('');
    contenedor.querySelectorAll('[data-eliminar]').forEach(boton => {
      boton.addEventListener('click', () => eliminarIntervencion(boton.dataset.eliminar));
    });
  }

  function actualizarTodo() {
    actualizarPresupuesto();
    renderLista();
    propuestaPreparada = null;
    document.getElementById('descargar-json').disabled = true;
    document.getElementById('descargar-geojson').disabled = true;
  }

  function reiniciar() {
    if (intervenciones.length && !confirm('¿Querés borrar todas las intervenciones?')) return;
    capas.propuestas.clearLayers();
    intervenciones = [];
    saldo = PRESUPUESTO_TOTAL;
    cancelarLinea(false);
    actualizarTodo();
    document.getElementById('resultado').hidden = true;
  }

  function deshacer() {
    const ultimo = intervenciones.at(-1);
    if (ultimo) eliminarIntervencion(ultimo.id);
  }

  function prepararPropuesta(evento) {
    evento.preventDefault();
    if (!intervenciones.length) {
      alert('Agregá al menos una intervención antes de preparar la propuesta.');
      return;
    }
    const motivos = [...document.querySelectorAll('input[name="motivo"]:checked')].map(c => c.value);
    if (!motivos.length) {
      alert('Seleccioná al menos un motivo de desplazamiento.');
      return;
    }

    propuestaPreparada = {
      id_participacion: `CENTE-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
      fecha_hora: new Date().toISOString(),
      version: 'prototipo-0.1',
      datos_participante: {
        esquina_proxima: document.getElementById('esquina').value.trim(),
        edad: Number(document.getElementById('edad').value),
        sexo_identidad: document.getElementById('sexo').value,
        movilidad_frecuente: document.getElementById('movilidad').value,
        motivos,
        justificacion: document.getElementById('justificacion').value.trim()
      },
      presupuesto_inicial: PRESUPUESTO_TOTAL,
      presupuesto_utilizado: PRESUPUESTO_TOTAL - saldo,
      presupuesto_restante: saldo,
      intervenciones: intervenciones.map(({ capa, ...item }, indice) => ({ ...item, orden: indice + 1 }))
    };

    localStorage.setItem('centecoin_ultima_propuesta', JSON.stringify(propuestaPreparada));
    document.getElementById('descargar-json').disabled = false;
    document.getElementById('descargar-geojson').disabled = false;
    const resultado = document.getElementById('resultado');
    resultado.hidden = false;
    resultado.innerHTML = `<strong>Propuesta preparada.</strong> Usaste ${propuestaPreparada.presupuesto_utilizado} CENTEcoins en ${intervenciones.length} intervenciones. En esta versión de prueba los datos quedaron guardados solamente en este navegador.`;
    resultado.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function descargar(nombre, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  }

  function descargarJSON() {
    if (!propuestaPreparada) return;
    descargar(`${propuestaPreparada.id_participacion}.json`, JSON.stringify(propuestaPreparada, null, 2), 'application/json');
  }

  function descargarGeoJSON() {
    if (!propuestaPreparada) return;
    const geojson = {
      type: 'FeatureCollection',
      features: propuestaPreparada.intervenciones.map(item => ({
        type: 'Feature',
        properties: {
          id_participacion: propuestaPreparada.id_participacion,
          tipo: item.tipo,
          nombre: item.nombre,
          costo: item.costo,
          longitud_m: item.longitud_m || null,
          orden: item.orden
        },
        geometry: item.geometria
      }))
    };
    descargar(`${propuestaPreparada.id_participacion}.geojson`, JSON.stringify(geojson, null, 2), 'application/geo+json');
  }

  document.querySelectorAll('#herramientas button').forEach(boton => boton.addEventListener('click', () => seleccionarHerramienta(boton)));
  document.getElementById('finalizar-linea').addEventListener('click', finalizarBicisenda);
  document.getElementById('cancelar-linea').addEventListener('click', () => cancelarLinea(false));
  document.getElementById('deshacer').addEventListener('click', deshacer);
  document.getElementById('reiniciar').addEventListener('click', reiniciar);
  document.getElementById('form-participacion').addEventListener('submit', prepararPropuesta);
  document.getElementById('descargar-json').addEventListener('click', descargarJSON);
  document.getElementById('descargar-geojson').addEventListener('click', descargarGeoJSON);

  mapa.on('click', evento => {
    if (!tipoActivo) return;
    if (modoActivo === 'punto') agregarPunto(evento.latlng);
    if (modoActivo === 'linea') agregarVerticeBicisenda(evento.latlng);
  });

  cargarCapasBase();
  actualizarTodo();
})();
